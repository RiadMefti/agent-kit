import { useState, useCallback } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import Agent from "./agent/agent";
import { baseToolEntries } from "./tools";
import { createTaskToolEntry } from "./tools/task-tool";
import type { ToolEntry, ToolCallEvent, ApprovalDecision, ApprovalRequest, ChatMessage } from "./client/types";
import { PROVIDERS } from "./client/providers";
import { listSessions, type Session } from "./sessions";
import { Message, type ChatEntry } from "./components/Message";
import { ApprovalPrompt, APPROVAL_HEIGHT, formatArgs } from "./components/ApprovalPrompt";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { SessionsPicker } from "./components/SessionsPicker";
import { useTerminalSize } from "./hooks/useTerminalSize";
import { useApproval } from "./hooks/useApproval";
import { useSession } from "./hooks/useSession";

type Provider = "codex" | "copilot";

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
  { value: "/sessions", desc: "Browse and resume past sessions" },
];

const PROVIDER_ITEMS = Object.values(PROVIDERS).map((p) => ({
  label: p.displayName,
  value: p.name,
})).concat({ label: "cancel", value: "__cancel__" });

function App() {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(PROVIDERS.codex!.defaultModel);
  const [provider, setProvider] = useState<Provider>("codex");
  const [mode, setMode] = useState<InputMode>({ kind: "chat" });

  const { handleApprovalNeeded, clearApprovalCache } = useApproval(setMode);
  const { conversationHistoryRef, resumeSession } = useSession(entries, loading, provider, selectedModel);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();
    if (mode.kind === "command" && key.escape) {
      setMode({ kind: "chat" });
    }
    if (mode.kind === "model" && key.escape) {
      setMode({ kind: "chat" });
    }
    if (mode.kind === "provider" && key.escape) {
      setMode({ kind: "chat" });
    }
    if (mode.kind === "approval" && key.escape) {
      mode.resolve("deny_once");
      setMode({ kind: "chat" });
    }
    if (mode.kind === "sessions" && key.escape) {
      setMode({ kind: "chat" });
    }
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

      addEntry({ type: "system", content: `Unknown command: ${cmd}` });
    },
    [selectedModel, provider],
  );

  const handleModelSelect = useCallback(
    (item: { value: string }) => {
      if (item.value === "__cancel__") {
        setMode({ kind: "chat" });
        return;
      }
      setSelectedModel(item.value);
      setMode({ kind: "chat" });
      addEntry({ type: "system", content: `Model set to ${item.value}` });
    },
    [],
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
      setMode({ kind: "chat" });
      addEntry({ type: "system", content: `Switched to ${newProvider} (model: ${defaultModel})` });
    },
    [],
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
      addEntry({ type: "user", content: trimmed });
      setLoading(true);

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
          addEntry({ type: "tool", content: `✓ ${event.name} completed ${time}` });
        }
      };

      const agent = new Agent(aiClient, allToolEntries, {
        label: "agent",
        onToolCall,
        onApprovalNeeded: handleApprovalNeeded,
        conversationHistory: conversationHistoryRef.current,
      });

      try {
        const result = await agent.run(trimmed);
        addEntry({ type: "assistant", content: result.answer });
        conversationHistoryRef.current = [
          ...conversationHistoryRef.current,
          { role: "user", content: trimmed },
          { role: "assistant", content: result.answer },
        ];
      } catch (e) {
        addEntry({ type: "assistant", content: `Error: ${String(e)}` });
      }
      setLoading(false);
    },
    [loading, exit, selectedModel, provider, runCommand, handleApprovalNeeded],
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

  // Calculate exact heights to avoid Ink overflow bugs
  const bottomPanelHeight =
    mode.kind === "approval" ? APPROVAL_HEIGHT
    : mode.kind === "command" ? COMMANDS.length + 1
    : mode.kind === "sessions" ? Math.min((mode.sessions?.length ?? 0) + 2, 12)
    : mode.kind === "model" ? Math.min(modelItems.length + 1, 12)
    : mode.kind === "provider" ? PROVIDER_ITEMS.length + 1
    : 1;
  const messagesHeight = Math.max(4, rows - 4 - bottomPanelHeight);
  const maxEntries = Math.max(3, Math.floor(messagesHeight / 3));

  return (
    <Box flexDirection="column" width={columns} height={rows} padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          agent-kit
        </Text>
        <Text dimColor> — type a message, "/" for commands, "exit" to quit</Text>
      </Box>

      <Box flexDirection="column" height={messagesHeight} overflow="hidden">
        {entries.slice(-maxEntries).map((entry, i) => (
          <Message key={i} entry={entry} model={selectedModel} />
        ))}

        {loading && (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />{" "}
            </Text>
            <Text dimColor>Thinking...</Text>
          </Box>
        )}
      </Box>

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
        <Box flexDirection="column" flexShrink={0}>
          <Text bold dimColor>Select a model:</Text>
          <SelectInput items={modelItems} onSelect={handleModelSelect} />
        </Box>
      )}

      {mode.kind === "provider" && (
        <Box flexDirection="column" flexShrink={0}>
          <Text bold dimColor>Select a provider:</Text>
          <SelectInput items={PROVIDER_ITEMS} onSelect={handleProviderSelect} />
        </Box>
      )}

      {mode.kind === "sessions" && (
        <Box flexShrink={0}>
          <SessionsPicker
            sessions={mode.sessions}
            onSelect={(session) => {
              if (session) {
                setEntries(session.entries as typeof entries);
                resumeSession(session);
                setProvider(session.provider as Provider);
                setSelectedModel(session.model);
                clearApprovalCache();
                addEntry({ type: "system", content: `Resumed session (${session.provider}:${session.model})` });
              }
              setMode({ kind: "chat" });
            }}
          />
        </Box>
      )}

      {mode.kind === "approval" && (
        <Box flexShrink={0}>
          <ApprovalPrompt
            request={mode.request}
            onDecide={(decision) => {
              mode.resolve(decision);
              setMode({ kind: "chat" });
            }}
          />
        </Box>
      )}

      {mode.kind === "chat" && (
        <Box flexShrink={0}>
          <Text bold color="cyan">
            {"❯ "}
          </Text>
          <TextInput
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            placeholder={
              loading
                ? "waiting..."
                : `[${provider}:${selectedModel}] Ask something... (/ for commands)`
            }
          />
        </Box>
      )}
    </Box>
  );
}

const ALT_SCREEN_ON = "\x1B[?1049h";
const ALT_SCREEN_OFF = "\x1B[?1049l";

function exitAltScreen() {
  try { process.stdout.write(ALT_SCREEN_OFF); } catch {}
}

process.stdout.write(ALT_SCREEN_ON);
process.on("exit", exitAltScreen);

const instance = render(<App />);
instance.waitUntilExit().then(exitAltScreen);
