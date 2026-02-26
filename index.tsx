import { useState, useCallback, useRef } from "react";
import { render, Box, Text, Static, useApp, useInput } from "ink";
import { spawn } from "child_process";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import Agent from "./agent/agent";
import type { AgentStatus } from "./agent/agent";
import { baseToolEntries } from "./tools";
import { createTaskToolEntry } from "./tools/task-tool";
import type { ToolEntry, ToolCallEvent, ApprovalDecision, ApprovalRequest, ChatMessage } from "./client/types";
import { PROVIDERS, getContextWindow } from "./client/providers";
import { listSessions, type Session } from "./sessions";
import { Message, type ChatEntry } from "./components/Message";
import { ApprovalPrompt, APPROVAL_HEIGHT, formatArgs } from "./components/ApprovalPrompt";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { SessionsPicker } from "./components/SessionsPicker";
import { useApproval } from "./hooks/useApproval";
import { useSession } from "./hooks/useSession";
import { useContextManager } from "./hooks/useContextManager";
import { useInputHistory } from "./hooks/useInputHistory";

type Provider = "codex" | "copilot" | "claude";

type InputMode =
  | { kind: "chat" }
  | { kind: "command" }
  | { kind: "model"; models: { slug: string; display_name: string; description: string }[] }
  | { kind: "provider" }
  | { kind: "approval"; request: ApprovalRequest; resolve: (d: ApprovalDecision) => void }
  | { kind: "sessions"; sessions: Session[] };

const COMMANDS: Command[] = [
  { value: "/models", desc: "List and select a model" },
  { value: "/provider", desc: "Switch AI provider" },
  { value: "/login", desc: "Login to current provider" },
  { value: "/status", desc: "Show auth & model status" },
  { value: "/tokens", desc: "Show token usage for current session" },
  { value: "/sessions", desc: "Browse and resume past sessions" },
  { value: "/diff", desc: "Show git diff summary for this workspace" },
  { value: "/clear", desc: "Clear chat messages from the screen" },
];

const PROVIDER_ITEMS = Object.values(PROVIDERS).map((p) => ({
  label: p.displayName,
  value: p.name,
})).concat({ label: "cancel", value: "__cancel__" });

function statusText(status: AgentStatus): string {
  switch (status.phase) {
    case "thinking": return "Thinking...";
    case "tool": return `Running ${status.name}...`;
    case "approval": return `Waiting for approval: ${status.name}`;
    case "retrying": return `Retrying (${status.attempt}/${status.maxRetries})...`;
    case "idle": return "";
  }
}

function App() {
  const { exit } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(PROVIDERS.codex!.defaultModel);
  const [provider, setProvider] = useState<Provider>("codex");
  const [mode, setMode] = useState<InputMode>({ kind: "chat" });
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ phase: "idle" });

  // Track how many entries have been committed to Static (never changes mid-exchange)
  const [committedCount, setCommittedCount] = useState(0);

  const { handleApprovalNeeded, clearApprovalCache } = useApproval(setMode);
  const { conversationHistoryRef, resumeSession } = useSession(entries, loading, provider, selectedModel);
  const { addUsage, pruneHistory, formatTokenDisplay, resetTokens, isWarning, totalUsage, utilization } = useContextManager(selectedModel);
  const { push: pushHistory, navigate: navigateHistory } = useInputHistory();

  const streamingIndexRef = useRef<number>(-1);
  const abortRef = useRef<AbortController | null>(null);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      if (loading && abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
        return;
      }
      exit();
      return;
    }

    if (mode.kind === "chat") {
      if (key.upArrow) {
        const prev = navigateHistory("up", input);
        if (prev !== null) setInput(prev);
        return;
      }
      if (key.downArrow) {
        const next = navigateHistory("down", input);
        if (next !== null) setInput(next);
        return;
      }
    }

    if (mode.kind === "command" && key.escape) setMode({ kind: "chat" });
    if (mode.kind === "model" && key.escape) setMode({ kind: "chat" });
    if (mode.kind === "provider" && key.escape) setMode({ kind: "chat" });
    if (mode.kind === "approval" && key.escape) {
      mode.resolve("deny_once");
      setMode({ kind: "chat" });
    }
    if (mode.kind === "sessions" && key.escape) setMode({ kind: "chat" });
  });

  const addEntry = (entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  };

  const handleInputChange = (value: string) => {
    if (value.startsWith("/") && mode.kind === "chat") {
      setInput(value);
      setMode({ kind: "command" });
      return;
    }
    if (mode.kind === "command") {
      if (!value.startsWith("/")) {
        setInput("");
        setMode({ kind: "chat" });
        return;
      }
      setInput(value);
      return;
    }
    setInput(value);
  };

  const runCommand = useCallback(
    async (cmd: string) => {
      const providerConfig = PROVIDERS[provider]!;
      addEntry({ type: "user", content: cmd });

      if (cmd === "/models") {
        setLoading(true);
        try {
          const models = await providerConfig.getModels();
          if (models.length === 0) {
            addEntry({ type: "system", content: "No models available." });
          } else {
            setMode({ kind: "model", models });
          }
        } catch (e) {
          addEntry({ type: "system", content: String(e) });
        }
        setLoading(false);
        return;
      }

      if (cmd === "/login") {
        try {
          const msg = await providerConfig.login((asyncMsg) => addEntry({ type: "system", content: asyncMsg }));
          addEntry({ type: "system", content: msg });
        } catch (e) {
          addEntry({ type: "system", content: String(e) });
        }
        return;
      }

      if (cmd === "/status") {
        addEntry({ type: "system", content: providerConfig.getStatus(selectedModel) });
        return;
      }

      if (cmd === "/tokens") {
        const usage = totalUsage;
        const contextUsedPct = (utilization * 100).toFixed(1);
        const warning = isWarning ? " ⚠️ nearing context limit" : "";
        addEntry({
          type: "system",
          content: [
            `Session token usage (${selectedModel}):`,
            `- Prompt tokens: ${usage.promptTokens.toLocaleString()}`,
            `- Completion tokens: ${usage.completionTokens.toLocaleString()}`,
            `- Total tokens: ${usage.totalTokens.toLocaleString()}`,
            `- Context utilization: ${contextUsedPct}%${warning}`,
          ].join("\n"),
        });
        return;
      }

      if (cmd === "/provider") {
        setMode({ kind: "provider" });
        return;
      }

      if (cmd === "/sessions") {
        const sessions = await listSessions();
        if (sessions.length === 0) {
          addEntry({ type: "system", content: "No saved sessions found." });
          return;
        }
        setMode({ kind: "sessions", sessions });
        return;
      }

      if (cmd === "/diff") {
        try {
          const output = await new Promise<string>((resolve, reject) => {
            const child = spawn("git", ["diff", "--stat"], { cwd: process.cwd() });
            let stdout = "";
            let stderr = "";

            child.stdout.on("data", (chunk) => {
              stdout += String(chunk);
            });
            child.stderr.on("data", (chunk) => {
              stderr += String(chunk);
            });
            child.on("error", (err) => reject(err));
            child.on("close", (code) => {
              if (code === 0) resolve(stdout.trim());
              else reject(new Error(stderr.trim() || `git diff --stat exited with code ${code}`));
            });
          });

          addEntry({
            type: "system",
            content: output.length > 0 ? output : "No changes in current working tree.",
          });
        } catch (e) {
          addEntry({ type: "system", content: `Failed to get diff summary: ${String(e)}` });
        }
        return;
      }

      if (cmd === "/clear") {
        setEntries([]);
        setCommittedCount(0);
        return;
      }

      addEntry({ type: "system", content: `Unknown command: ${cmd}` });
    },
    [selectedModel, provider, totalUsage, utilization, isWarning],
  );

  const handleModelSelect = useCallback(
    (item: { value: string }) => {
      if (item.value === "__cancel__") {
        setMode({ kind: "chat" });
        return;
      }
      setSelectedModel(item.value);
      resetTokens();
      setMode({ kind: "chat" });
      addEntry({ type: "system", content: `Model set to ${item.value}` });
    },
    [resetTokens],
  );

  const handleProviderSelect = useCallback(
    (item: { value: string }) => {
      if (item.value === "__cancel__") {
        setMode({ kind: "chat" });
        return;
      }
      const newProvider = item.value as Provider;
      setProvider(newProvider);
      const defaultModel = PROVIDERS[newProvider]!.defaultModel;
      setSelectedModel(defaultModel);
      resetTokens();
      setMode({ kind: "chat" });
      addEntry({ type: "system", content: `Switched to ${newProvider} (model: ${defaultModel})` });
    },
    [resetTokens],
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || loading) return;

      if (
        trimmed.toLowerCase() === "exit" ||
        trimmed.toLowerCase() === "quit"
      ) {
        exit();
        return;
      }

      if (trimmed.startsWith("/")) {
        setInput("");
        setMode({ kind: "chat" });

        const filter = trimmed.toLowerCase();
        const exact = COMMANDS.find((c) => c.value === filter);
        if (exact) {
          await runCommand(exact.value);
          return;
        }
        const matches = COMMANDS.filter((c) => c.value.startsWith(filter));
        if (matches.length === 1) {
          await runCommand(matches[0]!.value);
          return;
        }
        if (matches.length > 1) {
          addEntry({ type: "system", content: `Ambiguous: ${matches.map((m) => m.value).join(", ")}` });
          return;
        }
        addEntry({ type: "system", content: `Unknown command: ${trimmed}` });
        return;
      }

      setInput("");
      pushHistory(trimmed);

      // COMMIT all current entries to Static before starting new exchange
      setCommittedCount(entries.length);

      addEntry({ type: "user", content: trimmed });
      setLoading(true);

      // Create empty streaming entry for the assistant response
      setEntries((prev) => {
        streamingIndexRef.current = prev.length;
        return [...prev, { type: "assistant", content: "", streaming: true }];
      });

      // Prune conversation history if needed
      const prunedHistory = pruneHistory(conversationHistoryRef.current);
      conversationHistoryRef.current = prunedHistory;

      const aiClient = PROVIDERS[provider]!.createClient(selectedModel);
      let allToolEntries: ToolEntry[] = [];
      const taskToolEntry = createTaskToolEntry(aiClient, () => allToolEntries);
      allToolEntries = [...baseToolEntries, taskToolEntry];

      const onToolCall = (event: ToolCallEvent) => {
        if (event.status === "started") {
          const argsStr = formatArgs(event.args);
          const detail = argsStr ? `(${argsStr})` : "";
          addEntry({ type: "tool", content: `▶ ${event.name} ${detail}` });
        } else if (event.status === "denied") {
          addEntry({ type: "tool", content: `✗ ${event.name} denied` });
        } else {
          const time = event.duration
            ? `${(event.duration / 1000).toFixed(1)}s`
            : "";

          if (event.name === "edit" && event.result) {
            try {
              const parsed = JSON.parse(event.result);
              if (typeof parsed.result === "string" && parsed.result.includes("\n- ") && parsed.result.includes("\n+ ")) {
                addEntry({ type: "tool", content: parsed.result });
                return;
              }
            } catch {}
          }

          addEntry({ type: "tool", content: `✓ ${event.name} completed ${time}` });
        }
      };

      // Streaming
      let streamBuffer = "";
      let throttleTimer: ReturnType<typeof setTimeout> | null = null;

      const flushStream = () => {
        const currentContent = streamBuffer;
        setEntries((prev) => {
          const idx = streamingIndexRef.current;
          if (idx < 0 || !prev[idx]) return prev;
          const updated = [...prev];
          updated[idx] = { type: "assistant", content: currentContent, streaming: true };
          return updated;
        });
      };

      const onMessage = (chunk: string) => {
        streamBuffer += chunk;
        if (!throttleTimer) {
          throttleTimer = setTimeout(() => {
            throttleTimer = null;
            flushStream();
          }, 120);
        }
      };

      const cleanupStream = () => {
        if (throttleTimer) {
          clearTimeout(throttleTimer);
          throttleTimer = null;
        }
      };

      const abortController = new AbortController();
      abortRef.current = abortController;

      const agent = new Agent(aiClient, allToolEntries, {
        label: "agent",
        onToolCall,
        onApprovalNeeded: handleApprovalNeeded,
        conversationHistory: conversationHistoryRef.current,
        onMessage,
        signal: abortController.signal,
        onStatusChange: (status) => setAgentStatus(status),
        onRetry: (attempt, maxRetries, error) => {
          setAgentStatus({ phase: "retrying", attempt, maxRetries });
          addEntry({ type: "system", content: `Retrying (${attempt}/${maxRetries})... ${error.slice(0, 100)}` });
        },
      });

      try {
        const result = await agent.run(trimmed);
        cleanupStream();

        const runSummary = result.answer.trim().length > 0
          ? `Summary: ${result.answer.trim()}`
          : "Summary: Agent completed without a textual final answer.";
        addEntry({ type: "system", content: runSummary });

        const promptTokens = result.usage?.promptTokens;
        const contextPercent = promptTokens != null
          ? (promptTokens / getContextWindow(selectedModel)) * 100
          : undefined;

        setEntries((prev) => {
          const idx = streamingIndexRef.current;
          if (idx < 0 || !prev[idx]) return prev;
          const updated = [...prev];
          updated[idx] = {
            type: "assistant",
            content: result.answer,
            streaming: false,
            promptTokens,
            contextPercent,
          };
          return updated;
        });
        streamingIndexRef.current = -1;

        addUsage(result.usage);
        conversationHistoryRef.current = [
          ...conversationHistoryRef.current,
          { role: "user", content: trimmed },
          { role: "assistant", content: result.answer },
        ];
      } catch (e) {
        cleanupStream();
        const errorMsg = abortController.signal.aborted
          ? "Request aborted by user"
          : `Error: ${String(e)}`;
        setEntries((prev) => {
          const idx = streamingIndexRef.current;
          if (idx < 0 || !prev[idx]) return prev;
          const updated = [...prev];
          updated[idx] = { type: "assistant", content: errorMsg, streaming: false };
          return updated;
        });
        streamingIndexRef.current = -1;
      }
      abortRef.current = null;
      setAgentStatus({ phase: "idle" });
      setLoading(false);
    },
    [loading, exit, selectedModel, provider, entries.length, runCommand, handleApprovalNeeded, pruneHistory, addUsage, pushHistory],
  );

  // Build model selector items
  const modelItems =
    mode.kind === "model"
      ? [
          ...mode.models.map((m) => ({
            label: `${m.display_name}${m.slug === selectedModel ? " *" : ""}  -  ${m.description}`,
            value: m.slug,
          })),
          { label: "cancel", value: "__cancel__" },
        ]
      : [];

  const tokenDisplay = formatTokenDisplay();
  const contextSummary = tokenDisplay
    ? `Tokens: ${tokenDisplay}`
    : "Tokens: no usage yet";
  const modelSummary = `Model: ${provider}:${selectedModel}`;
  const placeholder = loading
    ? "waiting... (Ctrl+C to abort)"
    : "Ask something... (/ for commands)";

  const currentStatus = statusText(agentStatus);

  // SPLIT: committed entries go to Static (scroll naturally, never re-rendered).
  // Current exchange stays in dynamic area (re-rendered on each cycle).
  // Entries only get committed when the user sends a NEW message.
  const staticItems = entries.slice(0, committedCount);
  const dynamicItems = entries.slice(committedCount);

  return (
    <>
      {/* Static: past exchanges — rendered once, scroll naturally */}
      <Static items={[
        { id: "__header__", _isHeader: true } as any,
        ...staticItems.map((e, i) => ({ ...e, id: `s-${i}`, streaming: false })),
      ]}>
        {(item: any) => {
          if (item._isHeader) {
            return (
              <Box marginBottom={1} key="header">
                <Text bold color="magenta">agent-kit</Text>
                <Text dimColor> — type a message, "/" for commands, "exit" to quit</Text>
              </Box>
            );
          }
          return <Message key={item.id} entry={item} model={selectedModel} />;
        }}
      </Static>

      {/* Dynamic: current exchange — re-rendered each cycle */}
      {dynamicItems.map((entry, i) => (
        <Message key={`d-${i}`} entry={entry} model={selectedModel} />
      ))}

      {loading && currentStatus && (
        <Box>
          <Text>
            <Spinner type="dots" />{" "}
          </Text>
          <Text dimColor>{currentStatus}</Text>
        </Box>
      )}

      {isWarning && (
        <Box>
          <Text color="red" bold>Warning: context window is over 80% full.</Text>
        </Box>
      )}

      {mode.kind === "command" && (
        <CommandPalette
          input={input}
          onInputChange={handleInputChange}
          onSelect={(cmd) => {
            setInput("");
            setMode({ kind: "chat" });
            runCommand(cmd);
          }}
          commands={COMMANDS}
        />
      )}

      {mode.kind === "model" && (
        <Box flexDirection="column">
          <Text bold dimColor>Select a model:</Text>
          <SelectInput items={modelItems} onSelect={handleModelSelect} />
        </Box>
      )}

      {mode.kind === "provider" && (
        <Box flexDirection="column">
          <Text bold dimColor>Select a provider:</Text>
          <SelectInput items={PROVIDER_ITEMS} onSelect={handleProviderSelect} />
        </Box>
      )}

      {mode.kind === "sessions" && (
        <SessionsPicker
          sessions={mode.sessions}
          onSelect={(session) => {
            if (session) {
              setEntries(session.entries as typeof entries);
              resumeSession(session);
              setProvider(session.provider as Provider);
              setSelectedModel(session.model);
              clearApprovalCache();
              setCommittedCount(0);
              addEntry({ type: "system", content: `Resumed session (${session.provider}:${session.model}) — token usage will track from next request` });
            }
            setMode({ kind: "chat" });
          }}
        />
      )}

      {mode.kind === "approval" && (
        <ApprovalPrompt
          request={mode.request}
          onDecide={(decision) => {
            mode.resolve(decision);
            setMode({ kind: "chat" });
          }}
        />
      )}

      {mode.kind === "chat" && (
        <Box flexDirection="column">
          <Box>
            <Text bold color="cyan">
              {"❯ "}
            </Text>
            <TextInput
              value={input}
              onChange={handleInputChange}
              onSubmit={handleSubmit}
              placeholder={placeholder}
            />
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>{contextSummary}</Text>
            <Text dimColor>{"  |  "}</Text>
            <Text dimColor>{modelSummary}</Text>
          </Box>
        </Box>
      )}
    </>
  );
}

const instance = render(<App />);
instance.waitUntilExit();
