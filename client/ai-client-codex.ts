import { getAccessToken } from "./codex-auth";
import type {
  IAIClient,
  ToolDefinition,
  ChatMessage,
  ChatResponse,
  ToolCall,
  OnChunkCallback,
  OnRetryCallback,
} from "./types";

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

class AIClientCodex implements IAIClient {
  private model: string;
  private accessToken: string;

  constructor(model?: string) {
    this.model = model || "gpt-5.3-codex";
    this.accessToken = getAccessToken();
  }

  private transformTools(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  }

  private transformMessages(messages: ChatMessage[]): any[] {
    const input: any[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        input.push({
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: msg.content }],
        });
      } else if (msg.role === "user") {
        input.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        // Always include text content if present
        if (msg.content) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: msg.content }],
          });
        }
        // Always include tool calls if present (they're separate items in the Responses API)
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            input.push({
              type: "function_call",
              name: tc.function.name,
              arguments: tc.function.arguments,
              call_id: tc.id,
            });
          }
        }
        // If neither content nor tool calls, send empty message
        if (!msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "" }],
          });
        }
      } else if (msg.role === "tool") {
        input.push({
          type: "function_call_output",
          call_id: msg.tool_call_id,
          output: msg.content,
        });
      }
    }

    return input;
  }

  private async parseSSEStream(
    res: Response,
    onChunk?: OnChunkCallback
  ): Promise<any> {
    const body = res.body;
    if (!body) throw new Error("No response body");

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let responseData: any = null;
    let buffer = "";
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          streamDone = true;
          break;
        }

        try {
          const event = JSON.parse(data);
          if (
            event.type === "response.output_text.delta" &&
            event.delta &&
            onChunk
          ) {
            onChunk(event.delta);
          }
          if (event.type === "response.completed" && event.response) {
            responseData = event.response;
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    return responseData;
  }

  private transformResponse(data: any): ChatResponse {
    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const item of data.output || []) {
      if (item.type === "message" && item.role === "assistant") {
        for (const c of item.content || []) {
          if (c.type === "output_text") {
            textContent += c.text;
          }
        }
      } else if (item.type === "function_call") {
        toolCalls.push({
          id: item.call_id,
          type: "function",
          function: {
            name: item.name,
            arguments: item.arguments,
          },
        });
      }
    }

    return {
      id: data.id || "codex-response",
      model: data.model || this.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: textContent || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
        },
      ],
      usage: data.usage
        ? {
          prompt_tokens: data.usage.input_tokens || 0,
          completion_tokens: data.usage.output_tokens || 0,
          total_tokens:
            (data.usage.input_tokens || 0) +
            (data.usage.output_tokens || 0),
        }
        : undefined,
    };
  }

  async chatCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onChunk?: OnChunkCallback,
    options?: { signal?: AbortSignal; onRetry?: OnRetryCallback; toolChoice?: "auto" | "required" | "none" }
  ): Promise<ChatResponse> {
    const maxRetries = 3;

    const systemMsg = messages.find((m) => m.role === "system");
    const instructions = systemMsg?.content ?? "You are a helpful assistant.";

    const body = {
      model: this.model,
      instructions,
      input: this.transformMessages(messages),
      tools: this.transformTools(tools),
      tool_choice: options?.toolChoice ?? "auto",
      parallel_tool_calls: false,
      reasoning: { summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
    };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        options?.signal?.throwIfAborted();
        const res = await fetch(CODEX_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Codex API error ${res.status}: ${err}`);
        }

        const data = await this.parseSSEStream(res, onChunk);
        if (!data) {
          throw new Error("No response.completed event found in stream");
        }
        return this.transformResponse(data);
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

export default AIClientCodex;
