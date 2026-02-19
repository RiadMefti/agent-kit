import { useState, useCallback, useEffect } from "react";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import AIClientCodex from "./client/ai-client-codex";
import Agent from "./agent/agent";
import { baseToolEntries } from "./tools";
import { createTaskToolEntry } from "./tools/task-tool";
import type { ToolEntry, ToolCallEvent } from "./client/types";
import {
  extractTokenInfo,
  isTokenExpired,
  getAccessToken,
  fetchModels,
  runCodexLogin,
} from "./client/codex-auth";

interface ChatEntry {
  type: "user" | "assistant" | "tool" | "system";
  content: string;
}

type InputMode =
  | { kind: "chat" }
  | { kind: "command" }
  | { kind: "model"; models: { slug: string; display_name: string; description: string }[] };

const COMMAND_ITEMS = [
  { label: "/models   - List and select a model", value: "/models" },
  { label: "/login    - Login to Codex via browser", value: "/login" },
  { label: "/status   - Show auth & model status", value: "/status" },
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
  const [mode, setMode] = useState<InputMode>({ kind: "chat" });

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();
    if (mode.kind === "command" && key.escape) {
      setMode({ kind: "chat" });
    }
    if (mode.kind === "model" && key.escape) {
      setMode({ kind: "chat" });
    }
  });

  const addEntry = (entry: ChatEntry) => {
    setEntries((prev) => [...prev, entry]);
  };

  const handleInputChange = (value: string) => {
    if (value === "/" && mode.kind === "chat") {
      setInput("");
      setMode({ kind: "command" });
      return;
    }
    setInput(value);
  };

  const runCommand = useCallback(
    async (cmd: string) => {
      addEntry({ type: "user", content: cmd });

      if (cmd === "/models") {
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
        try {
          const result = runCodexLogin();
          addEntry({ type: "system", content: result });
        } catch (e) {
          addEntry({ type: "system", content: String(e) });
        }
        return;
      }

      if (cmd === "/status") {
        try {
          const token = getAccessToken();
          const info = extractTokenInfo(token);
          const expired = isTokenExpired(token);
          const expDate = info.exp ? new Date(info.exp * 1000).toLocaleString() : "unknown";
          addEntry({
            type: "system",
            content: `Account: ${info.email || "unknown"}\nToken expires: ${expDate}\nStatus: ${expired ? "EXPIRED - run /login" : "valid"}\nModel: ${selectedModel}`,
          });
        } catch (e) {
          addEntry({ type: "system", content: String(e) });
        }
        return;
      }
    },
    [selectedModel],
  );

  const handleCommandSelect = useCallback(
    (item: { value: string }) => {
      if (item.value === "__cancel__") {
        setMode({ kind: "chat" });
        return;
      }
      setMode({ kind: "chat" });
      runCommand(item.value);
    },
    [runCommand],
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
        await runCommand(trimmed);
        return;
      }

      setInput("");
      addEntry({ type: "user", content: trimmed });
      setLoading(true);

      const aiClient = new AIClientCodex(selectedModel);
      let allToolEntries: ToolEntry[] = [];
      const taskToolEntry = createTaskToolEntry(aiClient, () => allToolEntries);
      allToolEntries = [...baseToolEntries, taskToolEntry];

      const onToolCall = (event: ToolCallEvent) => {
        if (event.status === "started") {
          const argsStr = formatArgs(event.args);
          const detail = argsStr ? `(${argsStr})` : "";
          addEntry({ type: "tool", content: `▶ ${event.name} ${detail}` });
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
      });

      try {
        const result = await agent.run(trimmed);
        addEntry({ type: "assistant", content: result.answer });
      } catch (e) {
        addEntry({ type: "assistant", content: `Error: ${String(e)}` });
      }
      setLoading(false);
    },
    [loading, exit, selectedModel, runCommand],
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

  return (
    <Box flexDirection="column" width={columns} height={rows} padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          agent-kit
        </Text>
        <Text dimColor> — type a message, "/" for commands, "exit" to quit</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {entries.map((entry, i) => (
          <Message key={i} entry={entry} model={selectedModel} />
        ))}

        {loading && (
          <Box marginBottom={1}>
            <Text color="yellow">
              <Spinner type="dots" />{" "}
            </Text>
            <Text dimColor>Thinking...</Text>
          </Box>
        )}
      </Box>

      {mode.kind === "command" && (
        <Box flexDirection="column">
          <Text bold dimColor>Select a command:</Text>
          <SelectInput items={COMMAND_ITEMS} onSelect={handleCommandSelect} />
        </Box>
      )}

      {mode.kind === "model" && (
        <Box flexDirection="column">
          <Text bold dimColor>Select a model:</Text>
          <SelectInput items={modelItems} onSelect={handleModelSelect} />
        </Box>
      )}

      {mode.kind === "chat" && (
        <Box>
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
                : `[${selectedModel}] Ask something... (/ for commands)`
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
