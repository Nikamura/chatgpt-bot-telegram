import * as dotenv from "dotenv";
dotenv.config();

import { writeFileSync } from "fs";
import { Bot, Context, InputFile } from "grammy";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { PersonalHistory } from "./personal-history";
import { SharedHistory } from "./shared-history";

import { run, sequentialize } from "@grammyjs/runner";

import { HfInference } from "@huggingface/inference";
import { Config } from "./config";
import sdwebui, { SamplingMethod } from "node-sd-webui";

const hf = new HfInference(process.env.HF_API_KEY);

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const BOT_NAME = "Oracle";

const sdweb = sdwebui({
  apiUrl: process.env.AUTOMATIC1111_API,
});

const bot = new Bot(process.env.TELEGRAM_BOT_KEY!);

bot.catch(async (err) => {
  console.error(err.error);
  err.ctx?.reply("An error occurred, sorry!");
  if (process.env.OWNER_USER_ID) {
    await err.ctx.api
      .sendMessage(process.env.OWNER_USER_ID, err.message)
      .catch((err) => {
        console.error("Error while sending log to myself", err);
      });
  } else {
    console.error(err.error);
  }
});

bot.use(
  sequentialize((ctx) => {
    if (ctx.message?.text?.toLowerCase().startsWith("/sd ")) {
      return "sd";
    }
    if (ctx.message?.text?.toLowerCase().startsWith("/n18 ")) {
      return "automatic1111";
    }
    return undefined;
  })
);

const configurationPrompts: () => Array<ChatCompletionRequestMessage> = () => [
  {
    role: "system",
    content: `You are a helpful assistant ${BOT_NAME}. Integrated as Telegram Bot. Your price is $0.002 / 1K tokens. You should try to provide answers that are short and to the point. You should also try to provide answers that are useful to the user. Today is ${new Date().toDateString()}.`,
  },
];

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: "db/database.sqlite",
  logging: false,
  models: [SharedHistory, PersonalHistory, Config],
});

const getMessage = async (
  ctx: Context,
  prompt: Array<ChatCompletionRequestMessage>
): Promise<string> => {
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [...configurationPrompts(), ...prompt],
    temperature: 0.8,
    top_p: 0.8,
  });
  const tokensUsed = completion.data.usage?.total_tokens ?? 0;
  const logMessage = `Tokens used: ${tokensUsed} by ${
    prompt[prompt.length - 1].name
  } (price: ${(tokensUsed / 1000) * 0.002}$)`;
  if (process.env.OWNER_USER_ID) {
    await ctx.api
      .sendMessage(process.env.OWNER_USER_ID, logMessage)
      .catch((err) => {
        console.error("Error while sending log to myself", err);
      });
  } else {
    console.log(logMessage);
  }
  return `${completion.data.choices[0].message?.content}`;
};

bot.command("commands", (ctx) => {
  ctx.reply(
    `Commands: \n
- /sd - uses stable-diffusion-2.1 to generate images.\n
- /simple - use gpt-3.5-turbo to answer questions without any history.\n
- /chat - uses gpt-3.5-turbo to answer questions with personal history (6 your messages + 6 AI responses).\n
- /shared - uses gpt-3.5-turbo to answer questions with shared history (6 messages + 6 AI responses).`
  );
});

bot.command("simple", async (ctx) => {
  const message = ctx.message?.text?.replace("/simple ", "");
  if (!message) return;
  const reply = await getMessage(ctx, [{ role: "user", content: message }]);
  ctx.reply(reply, {
    reply_to_message_id: ctx.message?.message_id,
  });
});

bot.command("n18", async (ctx) => {
  const message = ctx.message?.text?.replace("/n18 ", "");
  if (!message) return;
  console.log(`Running: ${message}`);

  let prompt: string = message;
  let negative: string = "";

  const includesNegative = message.toLocaleLowerCase().includes("negative:");
  if (includesNegative) {
    const [msg, ngtv] = message.toLocaleLowerCase().split("negative:", 2);
    prompt = msg?.trim() ?? "";
    negative = ngtv?.trim() ?? "";
  }

  console.log({ prompt, negative });
  const { images } = await sdweb.txt2img({
    prompt: prompt,
    negativePrompt: negative,
    samplingMethod: SamplingMethod.DPMPlusPlus_2M,
    width: 512,
    height: 512,
    steps: 30,
    batchSize: 1,
    cfgScale: 7.5,
  });

  writeFileSync("/tmp/image.png", images[0], "base64");

  ctx.replyWithPhoto(new InputFile("/tmp/image.png"), {
    reply_to_message_id: ctx.message?.message_id,
    has_spoiler: true,
  });
});

bot.command("chat", async (ctx) => {
  const fromId = ctx.from?.id ?? 0;
  const message = ctx.message?.text?.replace("/chat ", "");
  if (!message) return;

  new PersonalHistory({
    userId: fromId,
    role: "user",
    content: message,
    name: ctx.from?.username ?? ctx.from?.first_name ?? "Unknown name",
  }).save();

  const messages = (
    await PersonalHistory.findAll({
      order: [["id", "DESC"]],
      limit: 12,
      where: { userId: { [Op.eq]: fromId } },
    })
  )
    .reverse()
    .map(
      (m) =>
        <ChatCompletionRequestMessage>{
          role: m.role,
          content: m.content,
          name: m.name,
        }
    );

  const reply = await getMessage(ctx, messages);
  ctx.reply(reply, {
    reply_to_message_id: ctx.message?.message_id,
  });

  new PersonalHistory({
    role: "assistant",
    content: reply,
    name: BOT_NAME,
    userId: fromId,
  }).save();
});

bot.command("sd", async (ctx) => {
  const message = ctx.message?.text?.replace("/sd ", "");
  if (!message) return;

  console.log(`RUNNING IMAGE: ${message}`);
  try {
    const image = await hf.textToImage({
      inputs: message,
      model: "stabilityai/stable-diffusion-2-1",
    });

    console.log("RAN IMAGE");

    ctx.replyWithPhoto(new InputFile(new Uint8Array(image)), {
      reply_to_message_id: ctx.message?.message_id,
    });
  } catch (err: any) {
    console.error(err);
    ctx.reply(
      `Error generating image: ${
        "message" in err ? err.message : "Unknown err"
      }`,
      {
        reply_to_message_id: ctx.message?.message_id,
      }
    );
  }
});

bot.command("shared", async (ctx) => {
  const message = ctx.message?.text?.replace("/shared ", "");
  if (!message) return;

  new SharedHistory({
    role: "user",
    content: message,
    name: ctx.from?.username ?? ctx.from?.first_name ?? "Unknown name",
  }).save();

  const messages = (
    await SharedHistory.findAll({ order: [["id", "DESC"]], limit: 12 })
  )
    .reverse()
    .map(
      (m) =>
        <ChatCompletionRequestMessage>{
          role: m.role,
          content: m.content,
          name: m.name,
        }
    );
  const reply = await getMessage(ctx, messages);
  ctx.reply(reply, {
    reply_to_message_id: ctx.message?.message_id,
  });

  new SharedHistory({
    role: "assistant",
    content: reply,
    name: BOT_NAME,
  }).save();
});

sequelize.sync().then(() => {
  console.log("Database synced! Running bot!");

  run(bot);
});
