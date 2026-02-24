import { getClaudeToken } from "./claude-auth";
import type {
  IAIClient,
  ToolDefinition,
  ChatMessage,
  ChatResponse,
  ToolCall,
  OnChunkCallback,
  OnRetryCallback,
} from "./types";
import { arch, platform } from "os";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages?beta=true";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 16384;

const OS_NAME = platform() === "darwin" ? "MacOS" : platform() === "win32" ? "Windows" : "Linux";
const ARCH = arch();

class AIClientClaude implements IAIClient {
  private model: string;

  constructor(model?: string) {
    this.model = model || "claude-sonnet-4-6";
  }

  private transformTools(tools: ToolDefinition[]): any[] {
    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }

  private transformMessages(messages: ChatMessage[]): { system: any[]; messages: any[] } {
    let systemText = "";
    const out: any[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemText = msg.content;
        continue;
      }

      if (msg.role === "user") {
        out.push({ role: "user", content: msg.content });
        continue;
      }

      if (msg.role === "assistant") {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const content: any[] = [];
          if (msg.content) {
            content.push({ type: "text", text: msg.content });
          }
          for (const tc of msg.tool_calls) {
            let input: any;
            try {
              input = JSON.parse(tc.function.arguments);
            } catch {
              input = {};
            }
            content.push({
              type: "tool_use",
              id: tc.id,
              name: tc.function.name,
              input,
            });
          }
          out.push({ role: "assistant", content });
        } else {
          out.push({ role: "assistant", content: msg.content ?? "" });
        }
        continue;
      }

      if (msg.role === "tool") {
        const lastMsg = out[out.length - 1];
        const resultBlock = {
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        };

        if (lastMsg?.role === "user" && Array.isArray(lastMsg.content) && lastMsg.content[0]?.type === "tool_result") {
          lastMsg.content.push(resultBlock);
        } else {
          out.push({ role: "user", content: [resultBlock] });
        }
      }
    }

    // System prompt must be structured as array and include Claude Code identity
    const system: any[] = [
      { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
    ];
    if (systemText) {
      system.push({ type: "text", text: systemText });
    }

    return { system, messages: out };
  }

  private async parseSSEStream(
    res: Response,
    onChunk?: OnChunkCallback
  ): Promise<{ text: string; toolCalls: ToolCall[]; usage?: { input_tokens: number; output_tokens: number } }> {
    const body = res.body;
    if (!body) throw new Error("No response body");

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    let text = "";
    const toolCalls: ToolCall[] = [];
    let currentToolIndex = -1;
    let usage: { input_tokens: number; output_tokens: number } | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const event = JSON.parse(data);

          if (event.type === "message_start" && event.message?.usage) {
            usage = {
              input_tokens: event.message.usage.input_tokens ?? 0,
              output_tokens: 0,
            };
          }

          if (event.type === "content_block_start") {
            if (event.content_block?.type === "tool_use") {
              currentToolIndex = toolCalls.length;
              toolCalls.push({
                id: event.content_block.id,
                type: "function",
                function: {
                  name: event.content_block.name,
                  arguments: "",
                },
              });
            }
          }

          if (event.type === "content_block_delta") {
            if (event.delta?.type === "text_delta") {
              text += event.delta.text;
              onChunk?.(event.delta.text);
            }
            if (event.delta?.type === "input_json_delta" && currentToolIndex >= 0) {
              toolCalls[currentToolIndex]!.function.arguments += event.delta.partial_json;
            }
            // Handle thinking deltas (just skip them, don't surface)
          }

          if (event.type === "content_block_stop") {
            currentToolIndex = -1;
          }

          if (event.type === "message_delta") {
            if (event.usage?.output_tokens && usage) {
              usage.output_tokens = event.usage.output_tokens;
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    return { text, toolCalls, usage };
  }

  async chatCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    onChunk?: OnChunkCallback,
    options?: { signal?: AbortSignal; onRetry?: OnRetryCallback }
  ): Promise<ChatResponse> {
    const maxRetries = 3;
    const { system, messages: anthropicMessages } = this.transformMessages(messages);

    const hasTools = tools.length > 0;
    const betaFlags = hasTools
      ? "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,prompt-caching-2024-07-31"
      : "oauth-2025-04-20,interleaved-thinking-2025-05-14";

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: anthropicMessages,
      stream: true,
    };

    if (hasTools) {
      body.tools = this.transformTools(tools);
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        options?.signal?.throwIfAborted();

        const token = await getClaudeToken();

        const res = await fetch(ANTHROPIC_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Authorization": `Bearer ${token}`,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-beta": betaFlags,
            "anthropic-dangerous-direct-browser-access": "true",
            "x-app": "cli",
            "User-Agent": "claude-cli/2.1.52 (external, sdk-cli)",
            "x-stainless-lang": "js",
            "x-stainless-runtime": "node",
            "x-stainless-runtime-version": process.version,
            "x-stainless-package-version": "0.74.0",
            "x-stainless-os": OS_NAME,
            "x-stainless-arch": ARCH,
            "x-stainless-retry-count": String(attempt),
            "x-stainless-timeout": "600",
            "x-stainless-helper-method": "stream",
            "Connection": "keep-alive",
          },
          body: JSON.stringify(body),
          signal: options?.signal,
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Anthropic API error ${res.status}: ${err}`);
        }

        const { text, toolCalls, usage } = await this.parseSSEStream(res, onChunk);

        return {
          id: "claude-response",
          model: this.model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: text || null,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              },
              finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
            },
          ],
          usage: usage
            ? {
                prompt_tokens: usage.input_tokens,
                completion_tokens: usage.output_tokens,
                total_tokens: usage.input_tokens + usage.output_tokens,
              }
            : undefined,
        };
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

export default AIClientClaude;
