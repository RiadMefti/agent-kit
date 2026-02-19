import { useState, useCallback } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import AIClientCodex from "./client/ai-client-codex";
import Agent from "./agent/agent";
import { baseToolEntries } from "./tools";
import { createTaskToolEntry } from "./tools/task-tool";
import type { ToolEntry, ToolCallEvent } from "./client/types";

interface ChatEntry {
  type: "user" | "assistant" | "tool";
  content: string;
}

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

function Message({ entry }: { entry: ChatEntry }) {
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
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold color="green">
        {"Agent:"}
      </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap">{entry.content}</Text>
      </Box>
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") exit();
  });

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

      setInput("");
      setEntries((prev) => [...prev, { type: "user", content: trimmed }]);
      setLoading(true);

      const aiClient = new AIClientCodex();
      let allToolEntries: ToolEntry[] = [];
      const taskToolEntry = createTaskToolEntry(aiClient, () => allToolEntries);
      allToolEntries = [...baseToolEntries, taskToolEntry];

      const onToolCall = (event: ToolCallEvent) => {
        if (event.status === "started") {
          const argsStr = formatArgs(event.args);
          const detail = argsStr ? `(${argsStr})` : "";
          setEntries((prev) => [
            ...prev,
            { type: "tool", content: `▶ ${event.name} ${detail}` },
          ]);
        } else {
          const time = event.duration
            ? `${(event.duration / 1000).toFixed(1)}s`
            : "";
          setEntries((prev) => [
            ...prev,
            { type: "tool", content: `✓ ${event.name} completed ${time}` },
          ]);
        }
      };

      const agent = new Agent(aiClient, allToolEntries, {
        label: "agent",
        onToolCall,
      });

      try {
        const result = await agent.run(trimmed);
        setEntries((prev) => [
          ...prev,
          { type: "assistant", content: result.answer },
        ]);
      } catch (e) {
        setEntries((prev) => [
          ...prev,
          { type: "assistant", content: `Error: ${String(e)}` },
        ]);
      }
      setLoading(false);
    },
    [loading, exit],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          agent-kit
        </Text>
        <Text dimColor> — type a message, "exit" to quit</Text>
      </Box>

      {entries.map((entry, i) => (
        <Message key={i} entry={entry} />
      ))}

      {loading && (
        <Box marginBottom={1}>
          <Text color="yellow">
            <Spinner type="dots" />{" "}
          </Text>
          <Text dimColor>Thinking...</Text>
        </Box>
      )}

      <Box>
        <Text bold color="cyan">
          {"❯ "}
        </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={loading ? "waiting..." : "Ask something..."}
        />
      </Box>
    </Box>
  );
}

render(<App />);
