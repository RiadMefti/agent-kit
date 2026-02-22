import type {
  IAIClient,
  ChatMessage,
  ToolEntry,
  ToolHandler,
  ToolCallEvent,
  ApprovalHandler,
} from "../client/types";

export interface AgentOptions {
  maxIterations?: number;
  systemPrompt?: string;
  label?: string;
  onToolCall?: (event: ToolCallEvent) => void;
  onApprovalNeeded?: ApprovalHandler;
  conversationHistory?: ChatMessage[];
}

export interface AgentResult {
  answer: string;
  iterations: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful coding assistant running inside a terminal. You have tools to read files, search code, run shell commands, fetch URLs, and more.

IMPORTANT: Never ask the user to share or paste code. Always use your tools to find information yourself:
- Use glob to explore the project structure
- Use read to inspect files
- Use grep to search for patterns
- Use bash to run commands

When asked about a repo or codebase, immediately start exploring with your tools — do not ask for clarification first. Act, then report what you found.`;

class Agent {
  private aiClient: IAIClient;
  private maxIterations: number;
  private systemPrompt: string;
  private label: string;
  private onToolCall?: (event: ToolCallEvent) => void;
  private onApprovalNeeded?: ApprovalHandler;
  private conversationHistory: ChatMessage[];
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
    this.onToolCall = options?.onToolCall;
    this.onApprovalNeeded = options?.onApprovalNeeded;
    this.conversationHistory = options?.conversationHistory ?? [];

    this.toolHandlers = {};
    this.toolDefinitions = [];
    for (const entry of toolEntries) {
      const name = entry.definition.function.name;
      this.toolHandlers[name] = entry.handler;
      this.toolDefinitions.push(entry.definition);
    }
  }

  getToolDefinitions(): ToolEntry["definition"][] {
    return this.toolDefinitions;
  }

  private async requestApproval(
    toolCallId: string,
    name: string,
    args: unknown
  ): Promise<"proceed" | "denied"> {
    const SAFE_TOOLS = new Set(["read", "glob", "grep", "web_fetch", "todo_read"]);
    if (SAFE_TOOLS.has(name) || !this.onApprovalNeeded) return "proceed";
    const decision = await this.onApprovalNeeded({ toolCallId, name, args });
    return decision === "allow_once" || decision === "allow_always" ? "proceed" : "denied";
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
      ...this.conversationHistory,
      { role: "user", content: prompt },
    ];

    let response = await this.aiClient.chatCompletion(
      this.messages,
      this.toolDefinitions
    );
    if (!response.choices?.length) {
      return { answer: "Error: API returned no response", iterations: 0 };
    }
    let choice = response.choices[0]!;

    let iterations = 0;

    while (
      choice.finish_reason === "tool_calls" &&
      iterations < this.maxIterations
    ) {
      iterations++;
      this.messages.push(choice.message);

      const toolCallResults = await Promise.all(
        choice.message.tool_calls!.map(async (toolCall) => {
          if (toolCall.type !== "function") {
            return { tool_call_id: toolCall.id, content: "{}" };
          }
          const name = toolCall.function.name;
          let parsedArgs: unknown;
          try {
            parsedArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            parsedArgs = toolCall.function.arguments;
          }
          const approval = await this.requestApproval(toolCall.id, name, parsedArgs);
          if (approval === "denied") {
            this.onToolCall?.({ name, args: parsedArgs, status: "denied" });
            return {
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: `Tool '${name}' was denied by the user.` }),
            };
          }

          this.onToolCall?.({ name, args: parsedArgs, status: "started" });
          const start = Date.now();
          const content = await this.handleToolCall(
            name,
            toolCall.function.arguments
          );
          const duration = Date.now() - start;
          this.onToolCall?.({ name, args: parsedArgs, status: "completed", result: content, duration });
          return { tool_call_id: toolCall.id, content };
        })
      );

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
      if (!response.choices?.length) {
        return { answer: "Error: API returned no response mid-loop", iterations };
      }
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
