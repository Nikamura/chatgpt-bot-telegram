import * as dotenv from "dotenv";
dotenv.config();

import { Bot, InputFile } from "grammy";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { Op } from "sequelize";
import { Sequelize } from "sequelize-typescript";
import { PersonalHistory } from "./personal-history";
import { SharedHistory } from "./shared-history";

import { run } from "@grammyjs/runner";

import { HfInference } from "@huggingface/inference";

const hf = new HfInference(process.env.HF_API_KEY);

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const BOT_NAME = "Oracle";

const bot = new Bot(process.env.TELEGRAM_BOT_KEY!);

const configurationPrompts: Array<ChatCompletionRequestMessage> = [
  {
    role: "system",
    content: `You are a helpful assistant ${BOT_NAME}. Integrated as Telegram Bot. Your responses should be short and to the point.`,
  },
];

const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: "db/database.sqlite",
  logging: false,
  models: [SharedHistory, PersonalHistory],
});

const getMessage = async (
  prompt: Array<ChatCompletionRequestMessage>
): Promise<string> => {
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [...configurationPrompts, ...prompt],
  });
  console.log(
    `Tokens used: ${completion.data.usage?.total_tokens} by ${
      prompt[prompt.length - 1].name
    }`
  );
  return completion.data.choices[0].message?.content ?? "Reply not found!";
};

bot.command("simple", async (ctx) => {
  const message = ctx.message?.text?.replace("/simple ", "");
  if (!message) return;
  const reply = await getMessage([{ role: "user", content: message }]);
  ctx.reply(reply, {
    reply_to_message_id: ctx.message?.message_id,
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
      limit: 25,
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

  const reply = await getMessage(messages);
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
    await SharedHistory.findAll({ order: [["id", "DESC"]], limit: 25 })
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
  const reply = await getMessage(messages);
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
