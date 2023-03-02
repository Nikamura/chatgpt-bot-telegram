import * as dotenv from "dotenv";
dotenv.config();

import { Bot } from "grammy";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const bot = new Bot(process.env.TELEGRAM_BOT_KEY!);

const history: Record<number, Array<ChatCompletionRequestMessage>> = {};
const sharedHistory: Array<ChatCompletionRequestMessage> = [];

const configurationPrompts: Array<ChatCompletionRequestMessage> = [
  {
    role: "system",
    content:
      "You are a helpful assistant Oracle. Integrated as Telegram Bot. Your responses should be short and to the point.",
  },
];

const getMessage = async (
  prompt: Array<ChatCompletionRequestMessage>
): Promise<string> => {
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [...configurationPrompts, ...prompt],
  });
  console.log(`Tokens used: ${completion.data.usage?.total_tokens}`);
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

  history[fromId] = history[fromId] ?? [];
  history[fromId].push({ role: "user", content: message });
  const reply = await getMessage(history[fromId].slice(-10));
  ctx.reply(reply, {
    reply_to_message_id: ctx.message?.message_id,
  });

  history[fromId].push({
    role: "assistant",
    content: reply,
  });
});

bot.command("shared", async (ctx) => {
  const message = ctx.message?.text?.replace("/shared ", "");
  if (!message) return;

  sharedHistory.push({ role: "user", content: message });
  const reply = await getMessage(sharedHistory.slice(-25));
  ctx.reply(reply, {
    reply_to_message_id: ctx.message?.message_id,
  });

  sharedHistory.push({
    role: "assistant",
    content: reply,
  });
});

bot.start();
