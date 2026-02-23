import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import type {
  IAIClient,
  ChatMessage,
  ToolEntry,
  ToolHandler,
  ToolCallEvent,
  ApprovalHandler,
  TokenUsage,
  OnChunkCallback,
} from "../client/types";

export interface AgentOptions {
  maxIterations?: number;
  systemPrompt?: string;
  label?: string;
  onToolCall?: (event: ToolCallEvent) => void;
  onApprovalNeeded?: ApprovalHandler;
  conversationHistory?: ChatMessage[];
  onMessage?: OnChunkCallback;
}

export interface AgentResult {
  answer: string;
  iterations: number;
  usage?: TokenUsage;
}

function getShallowTree(dir: string, depth = 2, prefix = ""): string[] {
  const lines: string[] = [];
  try {
    const entries = readdirSync(dir)
      .filter((e) => !e.startsWith(".") && e !== "node_modules" && e !== "dist" && e !== "build")
      .sort();
    for (const entry of entries) {
      const full = join(dir, entry);
      let isDir = false;
      try { isDir = statSync(full).isDirectory(); } catch { continue; }
      lines.push(`${prefix}${isDir ? entry + "/" : entry}`);
      if (isDir && depth > 1) {
        lines.push(...getShallowTree(full, depth - 1, prefix + "  "));
      }
    }
  } catch {}
  return lines;
}

function buildWorkspaceContext(cwd: string): string {
  const parts: string[] = [];

  parts.push(`Working directory: ${cwd}`);

  // Git info
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
    parts.push(`Git branch: ${branch}`);
    try {
      const remote = execSync("git remote get-url origin", { cwd, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
      parts.push(`Git remote: ${remote}`);
    } catch {}
  } catch {
    parts.push("Git: not a git repository");
  }

  // Package info
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const info = [`Project: ${pkg.name || basename(cwd)}`];
      if (pkg.description) info.push(`Description: ${pkg.description}`);
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});
      if (deps.length > 0) info.push(`Dependencies: ${deps.join(", ")}`);
      if (devDeps.length > 0) info.push(`Dev dependencies: ${devDeps.join(", ")}`);
      parts.push(info.join("\n"));
    } catch {}
  }

  // File tree
  const tree = getShallowTree(cwd);
  if (tree.length > 0) {
    parts.push(`File tree:\n${tree.join("\n")}`);
  }

  return parts.join("\n\n");
}

const SYSTEM_PROMPT_TEMPLATE = `You are a coding agent running in a terminal. You operate inside a workspace and have full access to it via your tools.

WORKSPACE:
{workspace}

RULES — follow these strictly:
1. ACT IMMEDIATELY. When the user asks you to do something, start doing it right away using your tools. Do not explain what you plan to do first. Do not create todo lists or plans. Just do the work.
2. BE CONCISE. After completing work, briefly state what you did and what changed. No preamble, no bullet-point plans, no "I'll now proceed to..." — just results.
3. USE TOOLS, NOT WORDS. Never ask the user to paste code or share files. Use glob, read, grep, bash to find what you need yourself.
4. COMPLETE THE FULL TASK. Don't stop partway to ask "should I continue?" or "ready for the next step?". Finish the entire request, then report back.
5. WRITE CODE DIRECTLY. When asked to implement something, read the relevant files, make the edits with write/edit, and confirm the changes. Don't describe the changes you would make — make them.
6. All file paths should be relative to or absolute from the working directory shown above. You already know the project structure — use it.
7. The todo_read/todo_write tools are ONLY for very long multi-session projects where you need persistent task tracking across separate conversations. Do NOT use them for normal requests.`;

function buildSystemPrompt(cwd: string): string {
  const ctx = buildWorkspaceContext(cwd);
  return SYSTEM_PROMPT_TEMPLATE.replace("{workspace}", ctx);
}

class Agent {
  private aiClient: IAIClient;
  private maxIterations: number;
  private systemPrompt: string;
  private label: string;
  private onToolCall?: (event: ToolCallEvent) => void;
  private onApprovalNeeded?: ApprovalHandler;
  private onMessage?: OnChunkCallback;
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
    this.systemPrompt = options?.systemPrompt ?? buildSystemPrompt(process.cwd());
    this.label = options?.label ?? "agent";
    this.onToolCall = options?.onToolCall;
    this.onApprovalNeeded = options?.onApprovalNeeded;
    this.onMessage = options?.onMessage;
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

  private accumulateUsage(
    acc: TokenUsage,
    raw?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  ): void {
    if (!raw) return;
    acc.promptTokens = raw.prompt_tokens;
    acc.completionTokens += raw.completion_tokens;
    acc.totalTokens += raw.total_tokens;
  }

  async run(prompt: string): Promise<AgentResult> {
    this.messages = [
      { role: "system", content: this.systemPrompt },
      ...this.conversationHistory,
      { role: "user", content: prompt },
    ];

    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    let response = await this.aiClient.chatCompletion(
      this.messages,
      this.toolDefinitions,
      this.onMessage
    );
    this.accumulateUsage(totalUsage, response.usage);

    if (!response.choices?.length) {
      return { answer: "Error: API returned no response", iterations: 0, usage: totalUsage };
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
        this.toolDefinitions,
        this.onMessage
      );
      this.accumulateUsage(totalUsage, response.usage);

      if (!response.choices?.length) {
        return { answer: "Error: API returned no response mid-loop", iterations, usage: totalUsage };
      }
      choice = response.choices[0]!;
    }

    if (iterations >= this.maxIterations) {
      return { answer: "Error: Max iterations reached", iterations, usage: totalUsage };
    }

    return {
      answer: choice.message.content ?? "No response",
      iterations,
      usage: totalUsage,
    };
  }
}

export default Agent;
