import type {
  IAIClient,
  ChatMessage,
  ToolEntry,
  ToolHandler,
} from "../client/types";

export interface AgentOptions {
  /** Maximum number of tool-use loop iterations before aborting. D*/
  maxIterations?: number;
  /** System prompt prepended to the conversation. */
  systemPrompt?: string;
  /** Label used in log output to identify this agent. Default: "agent" */
  label?: string;
}

export interface AgentResult {
  /** The final text answer from the agent. */
  answer: string;
  /** How many tool-use loop iterations were executed. */
  iterations: number;
}

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful coding assistant. Use the tools available to you to complete the user's request.";

class Agent {
  private aiClient: IAIClient;
  private maxIterations: number;
  private systemPrompt: string;
  private label: string;
  private messages: ChatMessage[] = [];
  private toolHandlers: Record<string, ToolHandler>;
  private toolDefinitions: ToolEntry["definition"][];

  constructor(
    aiClient: IAIClient,
    toolEntries: ToolEntry[],
    options?: AgentOptions
  ) {
    this.aiClient = aiClient;
    this.maxIterations = options?.maxIterations ?? 30;
    this.systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.label = options?.label ?? "agent";

    // Build the handler lookup map and definition list from unified entries
    this.toolHandlers = {};
    this.toolDefinitions = [];
    for (const entry of toolEntries) {
      const name = entry.definition.function.name;
      this.toolHandlers[name] = entry.handler;
      this.toolDefinitions.push(entry.definition);
    }
  }

  /** Returns the tool definitions for passing to the AI client. */
  getToolDefinitions(): ToolEntry["definition"][] {
    return this.toolDefinitions;
  }

  private async handleToolCall(
    name: string,
    rawArgs: string
  ): Promise<string> {
    const handler = this.toolHandlers[name];
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

  async run(prompt: string): Promise<AgentResult> {
    this.messages = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: prompt },
    ];

    let response = await this.aiClient.chatCompletion(
      this.messages,
      this.toolDefinitions
    );
    let choice = response.choices[0]!;

    let iterations = 0;

    while (
      choice.finish_reason === "tool_calls" &&
      iterations < this.maxIterations
    ) {
      iterations++;
      this.messages.push(choice.message);

      // Execute all tool calls in parallel
      const toolNames = choice.message.tool_calls!
        .filter((tc) => tc.type === "function")
        .map((tc) => tc.function.name);
      console.log(
        `  [${this.label}] iteration ${iterations}: calling ${toolNames.join(", ")}`
      );

      const toolCallResults = await Promise.all(
        choice.message.tool_calls!.map(async (toolCall) => {
          if (toolCall.type !== "function") {
            return { tool_call_id: toolCall.id, content: "{}" };
          }
          const content = await this.handleToolCall(
            toolCall.function.name,
            toolCall.function.arguments
          );
          return { tool_call_id: toolCall.id, content };
        })
      );

      // Push all tool results into the conversation
      for (const result of toolCallResults) {
        this.messages.push({
          role: "tool",
          tool_call_id: result.tool_call_id,
          content: result.content,
        });
      }

      response = await this.aiClient.chatCompletion(
        this.messages,
        this.toolDefinitions
      );
      choice = response.choices[0]!;
    }

    if (iterations >= this.maxIterations) {
      return { answer: "Error: Max iterations reached", iterations };
    }

    return {
      answer: choice.message.content ?? "No response",
      iterations,
    };
  }
}

export default Agent;
