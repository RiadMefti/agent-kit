import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import type {
  IAIClient,
  ChatMessage,
  ChatChoice,
  ToolEntry,
  ToolHandler,
  ToolCallEvent,
  ApprovalHandler,
  TokenUsage,
  OnChunkCallback,
  OnRetryCallback,
} from "../client/types";
import { requiresApproval } from "../core/policy";

export type { AgentStatus } from "../core/types";

export interface AgentOptions {
  maxIterations?: number;
  systemPrompt?: string;
  label?: string;
  onToolCall?: (event: ToolCallEvent) => void;
  onApprovalNeeded?: ApprovalHandler;
  conversationHistory?: ChatMessage[];
  onMessage?: OnChunkCallback;
  onStatusChange?: (status: AgentStatus) => void;
  onRetry?: OnRetryCallback;
  signal?: AbortSignal;
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

CRITICAL: You MUST use tools for ALL actions. You cannot respond with plain text — every response must include at least one tool call. When you are done with the task, call the attempt_completion tool with your result message.

RULES:
1. ACT using tools. Read files with read, search with grep/glob, modify with edit/write, run commands with bash. Do NOT output code as text in your response — only tool calls change files.
2. COMPLETE THE FULL TASK. Don't stop partway. Finish everything, then call attempt_completion.
3. USE TOOLS, NOT WORDS. Never ask the user for files or code. Find what you need with glob, read, grep, bash.
4. All file paths should be relative to or absolute from the working directory shown above.
5. ALWAYS use write/edit tools for file changes — NEVER use bash with echo/printf/cat/sed for file operations.
6. When done, call attempt_completion with a brief summary of what you did.`;

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
  private onStatusChange?: (status: AgentStatus) => void;
  private onRetry?: OnRetryCallback;
  private signal?: AbortSignal;
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
    this.onStatusChange = options?.onStatusChange;
    this.onRetry = options?.onRetry;
    this.signal = options?.signal;
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
    if (!requiresApproval(name) || !this.onApprovalNeeded) return "proceed";
    this.onStatusChange?.({ phase: "approval", name });
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

  private async nextCompletion(
    totalUsage: TokenUsage,
    toolChoice?: "auto" | "required" | "none"
  ): Promise<{ choice: ChatChoice | null }> {
    this.onStatusChange?.({ phase: "thinking" });
    const response = await this.aiClient.chatCompletion(
      this.messages,
      this.toolDefinitions,
      this.onMessage,
      { signal: this.signal, onRetry: this.onRetry, toolChoice }
    );
    this.accumulateUsage(totalUsage, response.usage);
    if (!response.choices?.length) {
      return { choice: null };
    }
    return { choice: response.choices[0]! };
  }

  private async executeToolCalls(
    choice: ChatChoice
  ): Promise<{ completionResult: string | null }> {
    this.messages.push(choice.message);
    let completionResult: string | null = null;

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

        // Handle attempt_completion — agent is signaling it's done
        if (name === "attempt_completion") {
          const result = (parsedArgs as { result: string }).result ?? "Done.";
          completionResult = result;
          this.onToolCall?.({ name, args: parsedArgs, status: "completed", result });
          return {
            tool_call_id: toolCall.id,
            content: JSON.stringify({ result: "Completion accepted." }),
          };
        }

        const approval = await this.requestApproval(toolCall.id, name, parsedArgs);
        if (approval === "denied") {
          this.onToolCall?.({ name, args: parsedArgs, status: "denied" });
          return {
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Tool '${name}' was denied by the user.` }),
          };
        }

        this.onStatusChange?.({ phase: "tool", name });
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

    return { completionResult };
  }

  async run(prompt: string): Promise<AgentResult> {
    this.messages = [
      { role: "system", content: this.systemPrompt },
      ...this.conversationHistory,
      { role: "user", content: prompt },
    ];

    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let iterations = 0;

    while (iterations < this.maxIterations) {
      iterations++;

      // Always force tool use — model must call a tool every turn
      const { choice } = await this.nextCompletion(totalUsage, "required");
      if (!choice) {
        this.onStatusChange?.({ phase: "idle" });
        return { answer: "Error: API returned no response", iterations, usage: totalUsage };
      }

      const hasToolCalls =
        choice.message.tool_calls && choice.message.tool_calls.length > 0;

      if (!hasToolCalls) {
        // Model returned text despite tool_choice: "required" — use the text and stop
        this.onStatusChange?.({ phase: "idle" });
        return {
          answer: choice.message.content ?? "No response",
          iterations,
          usage: totalUsage,
        };
      }

      // Execute tool calls — check if attempt_completion was called
      const { completionResult } = await this.executeToolCalls(choice);

      if (completionResult !== null) {
        // Agent explicitly signaled it's done
        this.onStatusChange?.({ phase: "idle" });
        return { answer: completionResult, iterations, usage: totalUsage };
      }
    }

    this.onStatusChange?.({ phase: "idle" });
    return { answer: "Error: Max iterations reached", iterations, usage: totalUsage };
  }
}

export default Agent;
