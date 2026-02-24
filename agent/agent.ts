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

RULES — follow these strictly:
1. ACT IMMEDIATELY using your tools. When the user asks you to do something, call the appropriate tools right away. Do NOT explain what you plan to do. Do NOT output code in your response. Do NOT create plans or todo lists. Just call the tools.
2. NEVER OUTPUT CODE AS TEXT. This is critical. When you need to create or modify code, ALWAYS use the write or edit tools. NEVER put code in your text response — the user cannot use code from your response, only tool calls actually change files.
3. USE TOOLS, NOT WORDS. Never ask the user to paste code or share files. Use glob, read, grep, bash to find what you need yourself.
4. COMPLETE THE FULL TASK. Don't stop partway to ask "should I continue?" or "ready for the next step?". Finish the entire request, then report back.
5. BE CONCISE. After completing work, briefly state what you did and what changed. No preamble, no bullet-point plans, no "I'll now proceed to..." — just results.
6. All file paths should be relative to or absolute from the working directory shown above. You already know the project structure — use it.
7. The todo_read/todo_write tools are ONLY for very long multi-session projects where you need persistent task tracking across separate conversations. Do NOT use them for normal requests.
8. ALWAYS use the write/edit tools for creating or modifying files — NEVER use bash with echo/printf/cat/sed for file operations. The write/edit tools show diffs and are safer.
9. If you realize you described changes instead of making them, immediately call the tools to make the actual changes. Self-correction is expected.`;

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

  /**
   * Detect when the model outputs code or describes changes in text
   * instead of using tools to actually make them.
   */
  private looksLikeUnexecutedWork(content: string | null): boolean {
    if (!content || content.length < 80) return false;

    // Large code blocks (>200 chars) in the response = model showing code instead of writing it
    const hasLargeCodeBlock = /```[\w]*\n[\s\S]{200,}?\n```/.test(content);

    // Patterns that suggest the model intended to make changes but didn't
    const actionPatterns = [
      /\bI (?:would|will|can|shall) (?:now |then )?(?:create|modify|edit|change|update|add|write|implement|replace|fix|refactor)/i,
      /\bI'(?:ll|m going to) (?:create|modify|edit|change|update|add|write|implement|replace|fix|refactor)/i,
      /\bHere(?:'s| is) (?:the |an? )?(?:updated|modified|new|complete|full|fixed|refactored)\s*(?:code|file|implementation|version)/i,
      /\bI (?:didn't|did not) (?:actually |really )?(?:run|execute|make|apply)/i,
    ];
    const hasActionLanguage = actionPatterns.some((p) => p.test(content));

    return hasLargeCodeBlock || hasActionLanguage;
  }

  private async nextCompletion(
    totalUsage: TokenUsage
  ): Promise<{ choice: ChatChoice | null }> {
    this.onStatusChange?.({ phase: "thinking" });
    const response = await this.aiClient.chatCompletion(
      this.messages,
      this.toolDefinitions,
      this.onMessage,
      { signal: this.signal, onRetry: this.onRetry }
    );
    this.accumulateUsage(totalUsage, response.usage);
    if (!response.choices?.length) {
      return { choice: null };
    }
    return { choice: response.choices[0]! };
  }

  async run(prompt: string): Promise<AgentResult> {
    this.messages = [
      { role: "system", content: this.systemPrompt },
      ...this.conversationHistory,
      { role: "user", content: prompt },
    ];

    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const { choice: firstChoice } = await this.nextCompletion(totalUsage);
    if (!firstChoice) {
      this.onStatusChange?.({ phase: "idle" });
      return { answer: "Error: API returned no response", iterations: 0, usage: totalUsage };
    }
    let choice = firstChoice;

    let iterations = 0;
    let nudgeCount = 0;
    const MAX_NUDGES = 2;

    while (iterations < this.maxIterations) {
      const hasToolCalls =
        choice.message.tool_calls && choice.message.tool_calls.length > 0;
      const isLengthTruncated = choice.finish_reason === "length";

      if (hasToolCalls) {
        // ── Model wants to use tools — execute them ──
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

        const { choice: next } = await this.nextCompletion(totalUsage);
        if (!next) {
          this.onStatusChange?.({ phase: "idle" });
          return { answer: "Error: API returned no response mid-loop", iterations, usage: totalUsage };
        }
        choice = next;

      } else if (isLengthTruncated) {
        // ── Model was cut off mid-response — ask it to continue ──
        iterations++;
        this.messages.push(choice.message);
        this.messages.push({ role: "user", content: "Continue." });

        const { choice: next } = await this.nextCompletion(totalUsage);
        if (!next) {
          this.onStatusChange?.({ phase: "idle" });
          return { answer: "Error: API returned no response mid-loop", iterations, usage: totalUsage };
        }
        choice = next;

      } else if (
        nudgeCount < MAX_NUDGES &&
        this.looksLikeUnexecutedWork(choice.message.content)
      ) {
        // ── Model described changes instead of making them — nudge it ──
        nudgeCount++;
        iterations++;
        this.messages.push(choice.message);
        this.messages.push({
          role: "user",
          content:
            "You described changes or wrote code in your response instead of using your tools. " +
            "Do not explain or show code — use the edit, write, and bash tools to make the changes directly. Act now.",
        });

        const { choice: next } = await this.nextCompletion(totalUsage);
        if (!next) {
          this.onStatusChange?.({ phase: "idle" });
          return { answer: "Error: API returned no response mid-loop", iterations, usage: totalUsage };
        }
        choice = next;

      } else {
        // ── Model is genuinely done ──
        break;
      }
    }

    this.onStatusChange?.({ phase: "idle" });

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
