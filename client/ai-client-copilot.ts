import { getCopilotToken } from "./copilot-auth";
import type {
  IAIClient,
  ToolDefinition,
  ChatMessage,
  ChatResponse,
  ToolCall,
  OnChunkCallback,
  OnRetryCallback,
} from "./types";

const COPILOT_ENDPOINT = "https://api.githubcopilot.com/chat/completions";

class AIClientCopilot implements IAIClient {
  private model: string;
  private accessToken: string;

  constructor(model?: string) {
    this.model = model || "claude-sonnet-4.6";
    this.accessToken = getCopilotToken();
  }

  private async parseSSEStream(
    res: Response,
    onChunk?: OnChunkCallback
  ): Promise<ChatResponse> {
    const body = res.body;
    if (!body) throw new Error("No response body");

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let id = "";
    let model = this.model;
    let content = "";
    const toolCalls: Record<number, { id: string; type: "function"; function: { name: string; arguments: string } }> = {};
    let finishReason: string = "stop";
    let usage: ChatResponse["usage"] | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const event = JSON.parse(data);
          if (event.id) id = event.id;
          if (event.model) model = event.model;
          if (event.usage) {
            usage = {
              prompt_tokens: event.usage.prompt_tokens ?? 0,
              completion_tokens: event.usage.completion_tokens ?? 0,
              total_tokens: event.usage.total_tokens ?? 0,
            };
          }

          const choice = event.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason) finishReason = choice.finish_reason;

          const delta = choice.delta;
          if (!delta) continue;

          if (delta.content) {
            content += delta.content;
            onChunk?.(delta.content);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCalls[idx]) {
                toolCalls[idx] = {
                  id: tc.id ?? "",
                  type: "function",
                  function: { name: tc.function?.name ?? "", arguments: "" },
                };
              }
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    const assembledToolCalls: ToolCall[] = Object.values(toolCalls);

    return {
      id: id || "copilot-response",
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content || null,
            ...(assembledToolCalls.length > 0 ? { tool_calls: assembledToolCalls } : {}),
          },
          finish_reason: finishReason as any,
        },
      ],
      usage,
    };
  }

  async chatCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onChunk?: OnChunkCallback,
    options?: { signal?: AbortSignal; onRetry?: OnRetryCallback }
  ): Promise<ChatResponse> {
    const maxRetries = 3;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      tool_choice: "auto",
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    if (onChunk) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        options?.signal?.throwIfAborted();
        const res = await fetch(COPILOT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`,
            "User-Agent": "agent-kit/0.1.0",
            "Openai-Intent": "conversation-edits",
            "x-initiator": "user",
          },
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Copilot API error ${res.status}: ${err}`);
        }

        if (onChunk) {
          return await this.parseSSEStream(res, onChunk);
        }

        const data = await res.json();
        return data as ChatResponse;
      } catch (e) {
        if (options?.signal?.aborted) throw e;
        if (attempt === maxRetries - 1) throw e;
        options?.onRetry?.(attempt + 1, maxRetries, String(e));
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }

    throw new Error("Failed to get chat completion after max retries");
  }
}

export default AIClientCopilot;
