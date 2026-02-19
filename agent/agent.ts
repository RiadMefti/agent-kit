import type OpenAI from "openai";
import type AIClient from "../client/ai-client";
import { command } from "../tools/bash-tool";
import { editFile, readFile, writeFile } from "../tools/file-tools";
import { grep } from "../tools/ripgrep-tool";
import { todoRead, todoWrite } from "../tools/todo-tool";
import type AIClientCodex from "../client/ai-client-codex";


type ToolHandler = (args: unknown) => Promise<unknown>;

const toolHandlers: Record<string, ToolHandler> = {
  bash: async (args) => {
    const { command: cmd } = args as { command: string };
    return await command(cmd);
  },
  read: async (args) => {
    const { file_path, start_line, end_line } = args as {
      file_path: string;
      start_line: number | null;
      end_line: number | null;
    };
    return await readFile(file_path, start_line ?? undefined, end_line ?? undefined);
  },
  write: async (args) => {
    const { file_path, content } = args as { file_path: string; content: string };
    return await writeFile(file_path, content);
  },
  edit: async (args) => {
    const { file_path, old_text, new_text } = args as {
      file_path: string;
      old_text: string;
      new_text: string;
    };
    return await editFile(file_path, old_text, new_text);
  },
  grep: async (args) => {
    const { pattern, path, max_results } = args as {
      pattern: string;
      path: string;
      max_results: number | null;
    };
    return await grep(pattern, path, max_results ?? undefined);
  },
  todo_read: async () => {
    return await todoRead();
  },
  todo_write: async (args) => {
    const { todos } = args as {
      todos: Array<{ content: string; status: string; priority: string }>;
    };
    return await todoWrite(todos);
  },
};
class Agent {
  private aiClient: AIClientCodex;
  private maxIterations: number;
  private messages: OpenAI.ChatCompletionMessageParam[] = [];

  constructor(aiClient: AIClientCodex, maxIterations: number = 30) {
    this.aiClient = aiClient;
    this.maxIterations = maxIterations;
  }

  private async handleToolCall(name: string, rawArgs: string): Promise<string> {
    const handler = toolHandlers[name];
    if (!handler) {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    try {
      const args = JSON.parse(rawArgs);
      const result = await handler(args);
      return JSON.stringify({ result });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  async run(prompt: string): Promise<string> {
    this.messages.push({ role: "user", content: prompt });

    let response = await this.aiClient.chatCompletion(this.messages);
    let choice = response.choices[0]!;

    let iterations = 0;

    while (choice.finish_reason === "tool_calls" && iterations < this.maxIterations) {
      iterations++;
      this.messages.push(choice.message);

      for (const toolCall of choice.message.tool_calls!) {
        if (toolCall.type !== "function") continue;
        const content = await this.handleToolCall(
          toolCall.function.name,
          toolCall.function.arguments
        );


        this.messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content,
        });
      }

      response = await this.aiClient.chatCompletion(this.messages);
      choice = response.choices[0]!;
    }

    if (iterations >= this.maxIterations) {
      return "Error: Max iterations reached";
    }

    return choice.message.content ?? "No response";
  }
}

export default Agent;
