import type OpenAI from "openai";
import type AIClient from "../client/ai-client";
import { command } from "../tools/bash-tool";
type ToolHandler = (args: unknown) => Promise<unknown> | unknown;

const toolHandlers: Record<string, ToolHandler> = {
  bash: async (args) => {
    const { command: cmd } = args as { command: string };
    return await command(cmd);
  }

};

class Agent {
  private aiClient: AIClient;
  private maxIterations: number;
  private messages: OpenAI.ChatCompletionMessageParam[] = [];

  constructor(aiClient: AIClient, maxIterations: number = 10) {
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
