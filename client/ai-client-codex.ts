import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type {
  IAIClient,
  ToolDefinition,
  ChatMessage,
  ChatResponse,
  ToolCall,
} from "./types";

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

class AIClientCodex implements IAIClient {
  private model = "gpt-5.3-codex";
  private accessToken: string;
  private tools: ToolDefinition[] = [];
  private systemInstruction = `You are a coding agent working inside a local project.
Use tools proactively before asking clarifying questions.
- First inspect the project structure and identify the correct files and paths.
- If a path is ambiguous, discover it with available tools (read/grep/bash) instead of guessing.
- Read relevant files before editing and apply minimal targeted changes.
- Only ask the user a question after tool-based investigation if a real blocker remains.
Always verify assumptions about the project using tools.`;

  constructor(tools: ToolDefinition[]) {
    this.tools = tools;
    const auth = JSON.parse(
      readFileSync(join(homedir(), ".codex", "auth.json"), "utf-8")
    );
    this.accessToken = auth.tokens.access_token;
  }

  private transformTools(): any[] {
    return this.tools.map((tool) => ({
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
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            input.push({
              type: "function_call",
              name: tc.function.name,
              arguments: tc.function.arguments,
              call_id: tc.id,
            });
          }
        } else {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: msg.content ?? "" }],
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

  private async parseSSEResponse(res: Response): Promise<any> {
    const text = await res.text();
    const lines = text.split("\n");
    let responseData: any = null;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;

      try {
        const event = JSON.parse(data);
        if (event.type === "response.completed" && event.response) {
          responseData = event.response;
        }
      } catch {
        // skip malformed lines
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

  async chatCompletion(messages: ChatMessage[]): Promise<ChatResponse> {
    const maxRetries = 3;
    const fullMessages: ChatMessage[] = [
      { role: "system", content: this.systemInstruction },
      ...messages,
    ];

    const body = {
      model: this.model,
      instructions: this.systemInstruction,
      input: this.transformMessages(fullMessages),
      tools: this.transformTools(),
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
    };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(CODEX_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Codex API error ${res.status}: ${err}`);
        }

        const data = await this.parseSSEResponse(res);
        if (!data) {
          throw new Error("No response.completed event found in stream");
        }
        return this.transformResponse(data);
      } catch (e) {
        if (attempt === maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }

    throw new Error("Failed to get chat completion after max retries");
  }
}

export default AIClientCodex;
