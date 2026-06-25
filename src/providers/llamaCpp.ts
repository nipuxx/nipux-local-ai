import { IS_FAKE_LLM, LLAMA_BASE_URL } from "../config.ts";
import type { ChatMessage } from "../types.ts";

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateMessageTokens(messages: ChatMessage[]) {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
}

function fakeText(messages: ChatMessage[]) {
  const last = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  return [
    "I am running in Nipux Local AI dev mode, so this response is generated without an external model.",
    "",
    `Received: ${last}`,
    "",
    "When llama.cpp is running, this same route proxies to the local OpenAI-compatible backend.",
  ].join("\n");
}

export function fakeChatResponse(body: ChatCompletionRequest) {
  const content = fakeText(body.messages);
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "dev-fake",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: estimateMessageTokens(body.messages),
      completion_tokens: estimateTokens(content),
      total_tokens: estimateMessageTokens(body.messages) + estimateTokens(content),
    },
  };
}

export function fakeChatStream(body: ChatCompletionRequest) {
  const encoder = new TextEncoder();
  const chunks = fakeText(body.messages).split(/(\s+)/).filter(Boolean);
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        const payload = {
          id: `chatcmpl-${crypto.randomUUID()}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "dev-fake",
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        await Bun.sleep(22);
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export async function chatCompletion(body: ChatCompletionRequest) {
  if (IS_FAKE_LLM) {
    if (body.stream) {
      return new Response(fakeChatStream(body), {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }
    return Response.json(fakeChatResponse(body));
  }

  const res = await fetch(`${LLAMA_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`llama.cpp backend returned ${res.status}: ${text}`);
  }
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? (body.stream ? "text/event-stream" : "application/json"),
      "cache-control": body.stream ? "no-cache" : "no-store",
    },
  });
}

export async function chatText(messages: ChatMessage[], model: string) {
  if (IS_FAKE_LLM) {
    return fakeChatResponse({ messages, model }).choices[0].message.content;
  }
  const res = await fetch(`${LLAMA_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`llama.cpp backend returned ${res.status}: ${await res.text()}`);
  const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return payload.choices?.[0]?.message?.content ?? "";
}

export async function testLlamaBackend(baseUrl = LLAMA_BASE_URL) {
  if (IS_FAKE_LLM) return { ok: true, mode: "fake" };
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`);
    return { ok: res.ok, status: res.status, mode: "llama.cpp" };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      mode: "llama.cpp",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
