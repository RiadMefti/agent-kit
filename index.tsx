import { useState, useCallback, useEffect, useRef } from "react";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import AIClientCodex from "./client/ai-client-codex";
import AIClientCopilot from "./client/ai-client-copilot";
import Agent from "./agent/agent";
import { baseToolEntries } from "./tools";
import { createTaskToolEntry } from "./tools/task-tool";
import type { ToolEntry, ToolCallEvent, ApprovalDecision, ApprovalRequest, ApprovalHandler, ChatMessage } from "./client/types";
import {
  extractTokenInfo,
  isTokenExpired,
  getAccessToken,
  fetchModels,
  runCodexLogin,
} from "./client/codex-auth";
import {
  COPILOT_MODELS,
  startDeviceFlow,
  pollForToken,
  getCopilotToken,
} from "./client/copilot-auth";
import { saveSession, listSessions, formatSessionLabel, type Session } from "./sessions";

interface ChatEntry {
  type: "user" | "assistant" | "tool" | "system";
  content: string;
}

type Provider = "codex" | "copilot";

type InputMode =
  | { kind: "chat" }
  | { kind: "command" }
  | { kind: "model"; models: { slug: string; display_name: string; description: string }[] }
  | { kind: "provider" }
  | { kind: "approval"; request: ApprovalRequest; resolve: (d: ApprovalDecision) => void }
  | { kind: "sessions"; sessions: Session[] };

const COMMANDS = [
  { value: "/models", desc: "List and select a model" },
  { value: "/provider", desc: "Switch AI provider" },
  { value: "/login", desc: "Login to current provider" },
  { value: "/status", desc: "Show auth & model status" },
  { value: "/sessions", desc: "Browse and resume past sessions" },
];

const PROVIDER_ITEMS = [
  { label: "Codex", value: "codex" },
  { label: "GitHub Copilot", value: "copilot" },
  { label: "cancel", value: "__cancel__" },
];

function formatArgs(args: unknown): string {
  if (typeof args === "string") return args;
  if (typeof args !== "object" || args === null) return String(args);
  const obj = args as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return "";
  if (keys.length === 1) {
    const val = String(obj[keys[0]!]);
    return val.length > 80 ? val.slice(0, 77) + "..." : val;
  }
  const summary = keys
    .map((k) => {
      const v = String(obj[k]);
      return `${k}=${v.length > 40 ? v.slice(0, 37) + "..." : v}`;
    })
    .join(", ");
  return summary.length > 100 ? summary.slice(0, 97) + "..." : summary;
}

function Message({ entry, model }: { entry: ChatEntry; model?: string }) {
  if (entry.type === "user") {
    return (
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {"You: "}
        </Text>
        <Text>{entry.content}</Text>
      </Box>
    );
  }
  if (entry.type === "tool") {
    return (
      <Box marginLeft={2}>
        <Text dimColor>{entry.content}</Text>
      </Box>
    );
  }
  if (entry.type === "system") {
    return (
      <Box marginBottom={1}>
        <Text color="yellow" wrap="wrap">
          {entry.content}
        </Text>
      </Box>
    );
  }
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold color="green">
        {`agent(${model ?? "unknown"}):`}
      </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap">{entry.content}</Text>
      </Box>
    </Box>
  );
}

const APPROVAL_ITEMS = [
  { label: "Allow once", value: "allow_once" },
  { label: "Allow always", value: "allow_always" },
  { label: "Deny once", value: "deny_once" },
  { label: "Deny always", value: "deny_always" },
];

const APPROVAL_HEIGHT = 9; // header(1) + tool name(1) + 4 items + border(2) + padding(1)

function ApprovalPrompt({
  request,
  onDecide,
}: {
  request: ApprovalRequest;
  onDecide: (d: ApprovalDecision) => void;
}) {
  const argsStr = formatArgs(request.args);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="yellow">⚠ Tool Approval Required</Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold>{request.name}</Text>
        {argsStr ? <Text dimColor>{"  "}{argsStr}</Text> : null}
      </Box>
      <SelectInput
        items={APPROVAL_ITEMS}
        onSelect={(item) => onDecide(item.value as ApprovalDecision)}
      />
    </Box>
  );
}

function CommandPalette({
  input,
  onInputChange,
  onSelect,
}: {
  input: string;
  onInputChange: (value: string) => void;
  onSelect: (cmd: string) => void;
}) {
  const filter = input.slice(1).toLowerCase();
  const matches = COMMANDS.filter((c) => c.value.slice(1).startsWith(filter));
  const [idx, setIdx] = useState(0);

  useEffect(() => { setIdx(0); }, [filter]);

  const clamped = Math.min(idx, Math.max(0, matches.length - 1));

  useInput((_ch, key) => {
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setIdx((i) => Math.min(matches.length - 1, i + 1));
  });

  const handleSubmit = () => {
    if (matches.length > 0) {
      onSelect(matches[clamped]!.value);
    }
  };

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Text bold color="cyan">{"❯ "}</Text>
        <TextInput value={input} onChange={onInputChange} onSubmit={handleSubmit} />
      </Box>
      {matches.map((cmd, i) => (
        <Box key={cmd.value} marginLeft={2}>
          <Text color={i === clamped ? "cyan" : undefined} bold={i === clamped}>
            {i === clamped ? "❯ " : "  "}{cmd.value}
          </Text>
          <Text dimColor>{"  "}{cmd.desc}</Text>
        </Box>
      ))}
      {matches.length === 0 && (
        <Box marginLeft={2}><Text dimColor>No matching commands</Text></Box>
      )}
    </Box>
  );
}

function SessionsPicker({
  sessions,
  onSelect,
}: {
  sessions: Session[];
  onSelect: (s: Session | null) => void;
}) {
  const items = [
    ...sessions.map((s) => ({ label: formatSessionLabel(s), value: s.id })),
    { label: "cancel", value: "__cancel__" },
  ];
  return (
    <Box flexDirection="column">
      <Text bold dimColor>Resume a session:</Text>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === "__cancel__") { onSelect(null); return; }
          const session = sessions.find((s) => s.id === item.value) ?? null;
          onSelect(session);
        }}
      />
    </Box>
  );
}

function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    };
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  return size;
}

function App() {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gpt-5.3-codex");
  const [provider, setProvider] = useState<Provider>("codex");
  const [mode, setMode] = useState<InputMode>({ kind: "chat" });

  const sessionAllowed = useRef(new Set<string>());
  const sessionDenied = useRef(new Set<string>());
  const approvalQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionTimestamp = useRef<string>("");
  const sessionId = useRef<string>("");
  const conversationHistoryRef = useRef<ChatMessage[]>([]);
  const prevLoadingRef = useRef(false);

  // Auto-save session when agent finishes (loading: true -> false)
  useEffect(() => {
    if (prevLoadingRef.current && !loading && entries.length > 0) {
      // Set timestamp on first save (first real interaction)
      if (sessionTimestamp.current === "") {
        const now = new Date().toISOString();
        sessionTimestamp.current = now;
        sessionId.current = now.replace(/[:.]/g, "-");
      }
      saveSession({
        id: sessionId.current,
        timestamp: sessionTimestamp.current,
        provider,
        model: selectedModel,
        entries: entries.filter((e) => e.type !== "system"),
      });
    }
    prevLoadingRef.current = loading;
  }, [loading, entries, provider, selectedModel]);

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
      addEntry({ type: "user", content: cmd });

      if (cmd === "/models") {
        if (provider === "copilot") {
          setMode({
            kind: "model",
            models: COPILOT_MODELS.map((m) => ({
              slug: m.slug,
              display_name: m.display_name,
              description: m.description,
            })),
          });
          return;
        }
        // codex: fetch from API
        setLoading(true);
        try {
          const token = getAccessToken();
          if (isTokenExpired(token)) {
            addEntry({ type: "system", content: "Token expired. Run /login to re-authenticate." });
            setLoading(false);
            return;
          }
          const models = await fetchModels(token);
          if (models.length === 0) {
            addEntry({ type: "system", content: "No models available." });
            setLoading(false);
            return;
          }
          setMode({
            kind: "model",
            models: models.map((m) => ({
              slug: m.slug,
              display_name: m.display_name,
              description: m.description,
            })),
          });
        } catch (e) {
          addEntry({ type: "system", content: String(e) });
        }
        setLoading(false);
        return;
      }

      if (cmd === "/login") {
        if (provider === "copilot") {
          try {
            addEntry({ type: "system", content: "Starting GitHub device flow..." });
            const flow = await startDeviceFlow();
            addEntry({
              type: "system",
              content: `Open ${flow.verification_uri} and enter code: ${flow.user_code}`,
            });
            pollForToken(flow.device_code, flow.interval).then(() => {
              addEntry({ type: "system", content: "Copilot login successful!" });
            }).catch((e) => {
              addEntry({ type: "system", content: `Copilot login failed: ${String(e)}` });
            });
          } catch (e) {
            addEntry({ type: "system", content: String(e) });
          }
          return;
        }
        // codex
        try {
          const result = runCodexLogin();
          addEntry({ type: "system", content: result });
        } catch (e) {
          addEntry({ type: "system", content: String(e) });
        }
        return;
      }

      if (cmd === "/status") {
        if (provider === "copilot") {
          try {
            getCopilotToken();
            addEntry({
              type: "system",
              content: `Provider: GitHub Copilot\nStatus: logged in\nModel: ${selectedModel}`,
            });
          } catch {
            addEntry({
              type: "system",
              content: `Provider: GitHub Copilot\nStatus: not logged in — run /login\nModel: ${selectedModel}`,
            });
          }
          return;
        }
        // codex
        try {
          const token = getAccessToken();
          const info = extractTokenInfo(token);
          const expired = isTokenExpired(token);
          const expDate = info.exp ? new Date(info.exp * 1000).toLocaleString() : "unknown";
          addEntry({
            type: "system",
            content: `Provider: Codex\nAccount: ${info.email || "unknown"}\nToken expires: ${expDate}\nStatus: ${expired ? "EXPIRED - run /login" : "valid"}\nModel: ${selectedModel}`,
          });
        } catch (e) {
          addEntry({ type: "system", content: String(e) });
        }
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
      const defaultModel = newProvider === "copilot" ? "claude-sonnet-4.6" : "gpt-5.3-codex";
      setSelectedModel(defaultModel);
      setMode({ kind: "chat" });
      addEntry({ type: "system", content: `Switched to ${newProvider} (model: ${defaultModel})` });
    },
    [],
  );

  const handleApprovalNeeded: ApprovalHandler = useCallback((request) => {
    if (sessionAllowed.current.has(request.name))
      return Promise.resolve("allow_always" as ApprovalDecision);
    if (sessionDenied.current.has(request.name))
      return Promise.resolve("deny_always" as ApprovalDecision);

    let outerResolve!: (d: ApprovalDecision) => void;
    const resultPromise = new Promise<ApprovalDecision>((res) => { outerResolve = res; });

    approvalQueueRef.current = approvalQueueRef.current.then(
      () => new Promise<void>((done) => {
        setMode({
          kind: "approval",
          request,
          resolve: (decision) => {
            if (decision === "allow_always") sessionAllowed.current.add(request.name);
            if (decision === "deny_always") sessionDenied.current.add(request.name);
            outerResolve(decision);
            done();
          },
        });
      })
    );

    return resultPromise;
  }, []);

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

      const aiClient = provider === "copilot"
        ? new AIClientCopilot(selectedModel)
        : new AIClientCodex(selectedModel);
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
    [loading, exit, selectedModel, provider, runCommand],
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
                sessionTimestamp.current = session.timestamp;
                sessionId.current = session.id;
                setProvider(session.provider as Provider);
                setSelectedModel(session.model);
                sessionAllowed.current.clear();
                sessionDenied.current.clear();
                conversationHistoryRef.current = session.entries
                  .filter((e) => e.type === "user" || e.type === "assistant")
                  .map((e) => ({
                    role: e.type as "user" | "assistant",
                    content: e.content,
                  }));
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
