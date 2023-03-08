import { createParser } from "eventsource-parser";

import { v4 as uuidv4 } from "uuid";
import pTimeout from "p-timeout";
export type Role = "user" | "assistant" | "system";

export type Message = {
  id: string;
  content: MessageContent;
  role: Role;
  user: string | null;
  create_time: string | null;
  update_time: string | null;
  end_turn: null;
  weight: number;
  recipient: string;
  metadata: MessageMetadata;
};

export type MessageContent = {
  content_type: string;
  parts: string[];
};

export type MessageMetadata = any;

export type ConversationResponseEvent = {
  message?: Message;
  conversation_id?: string;
  error?: string | null;
};

export type Prompt = {
  /**
   * The content of the prompt
   */
  content: PromptContent;

  /**
   * The ID of the prompt
   */
  id: string;

  /**
   * The role played in the prompt
   */
  role: Role;
};

export type ContentType = "text";

export type PromptContent = {
  /**
   * The content type of the prompt
   */
  content_type: ContentType;

  /**
   * The parts to the prompt
   */
  parts: string[];
};

export type ConversationJSONBody = {
  /**
   * The action to take
   */
  action: string;

  /**
   * The ID of the conversation
   */
  conversation_id?: string;

  /**
   * Prompts to provide
   */
  messages: Prompt[];

  /**
   * The model to use
   */
  model: string;

  /**
   * The parent message ID
   */
  parent_message_id: string;
};

export interface ChatMessage {
  id: string;
  text: string;
  role: Role;
  name?: string;
  delta?: string;
  detail?: any;

  // relevant for both ChatGPTAPI and ChatGPTUnofficialProxyAPI
  parentMessageId?: string;
  // only relevant for ChatGPTUnofficialProxyAPI
  conversationId?: string;
}

export type MessageActionType = "next" | "variant";
export type SendMessageBrowserOptions = {
  conversationId?: string;
  parentMessageId?: string;
  messageId?: string;
  action?: MessageActionType;
  timeoutMs?: number;
  onProgress?: (partialResponse: ChatMessage) => void;
  abortSignal?: AbortSignal;
};

export async function* streamAsyncIterable<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export class ChatGPTProxy {
  private proxyUrl = "https://chat.duti.tech/api/conversation";
  private model = "text-davinci-002-render-sha";

  constructor(private accessToken: string) {}

  public async getConversationLastMessageId(
    conversationId: string
  ): Promise<string> {
    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "User-Agent": "curl",
    };

    const resp = await fetch(this.proxyUrl + `/${conversationId}`, {
      headers,
    });
    const msg = await resp.json().then((json) => json.current_node);
    console.log({ getConversationLastMessageId: msg });
    return msg;
  }
  public async sendMessage(
    text: string,
    opts: SendMessageBrowserOptions
  ): Promise<ChatMessage> {
    if (!!opts.conversationId !== !!opts.parentMessageId) {
      throw new Error(
        "ChatGPTUnofficialProxyAPI.sendMessage: conversationId and parentMessageId must both be set or both be undefined"
      );
    }

    const {
      conversationId,
      parentMessageId = uuidv4(),
      messageId = uuidv4(),
      action = "next",
      timeoutMs,
      onProgress,
    } = opts;

    const body: ConversationJSONBody = {
      action,
      messages: [
        {
          id: messageId,
          role: "user",
          content: {
            content_type: "text",
            parts: [text],
          },
        },
      ],
      model: this.model,
      parent_message_id: parentMessageId,
    };

    if (conversationId) {
      body.conversation_id = conversationId;
    }

    const result: ChatMessage = {
      role: "assistant",
      id: uuidv4(),
      parentMessageId: messageId,
      conversationId,
      text: "",
    };

    const abortController: AbortController = new AbortController();

    const responseP = new Promise<ChatMessage>((resolve, reject) => {
      const url = this.proxyUrl;
      const headers = {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "User-Agent": "curl",
      };

      const onMessage = (data: string) => {
        if (data === "[DONE]") {
          return resolve(result);
        }

        try {
          const convoResponseEvent: ConversationResponseEvent =
            JSON.parse(data);
          if (convoResponseEvent.conversation_id) {
            result.conversationId = convoResponseEvent.conversation_id;
          }

          if (convoResponseEvent.message?.id) {
            result.id = convoResponseEvent.message.id;
          }

          const message = convoResponseEvent.message;
          // console.log('event', JSON.stringify(convoResponseEvent, null, 2))

          if (message) {
            let text = message?.content?.parts?.[0];

            if (text) {
              result.text = text;

              if (onProgress) {
                onProgress(result);
              }
            }
          }
        } catch (err) {
          // ignore for now; there seem to be some non-json messages
          // console.warn('fetchSSE onMessage unexpected error', err)
        }
      };
      const parser = createParser((event) => {
        // console.log({ event });
        if (event.type === "event") {
          console.log(event.data);
          onMessage(event.data);
        }
      });

      // console.log({ headers, body });

      fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      }).then(async (res) => {
        if (!res.ok) {
          res.text().then((text) => {
            const msg = `ChatGPT error ${res.status}: ${text}`;
            return reject(msg);
          });
        } else {
          for await (const chunk of streamAsyncIterable(res.body!)) {
            const str = new TextDecoder().decode(chunk);
            parser.feed(str);
          }
        }
      });
    });
    (responseP as any).cancel = () => {
      abortController.abort();
    };
    return pTimeout(responseP, 600000);
  }
}
