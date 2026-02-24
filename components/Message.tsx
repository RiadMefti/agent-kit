import { Box, Text } from "ink";
import { MarkdownText } from "./MarkdownText";

export interface ChatEntry {
  type: "user" | "assistant" | "tool" | "system";
  content: string;
  streaming?: boolean;
  promptTokens?: number;
  contextPercent?: number;
  id?: string;
}

function usageMeta(entry: ChatEntry) {
  if (entry.promptTokens == null && entry.contextPercent == null) return null;
  const tokens = entry.promptTokens != null ? `${entry.promptTokens} tok` : null;
  const pct = entry.contextPercent != null ? `${entry.contextPercent.toFixed(1)}% ctx` : null;
  return [tokens, pct].filter(Boolean).join(" • ");
}

function ToolMessage({ content }: { content: string }) {
  // Detect diff output from edit tool
  if (content.includes("\n- ") && content.includes("\n+ ")) {
    const lines = content.split("\n");
    return (
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => {
          if (line.startsWith("+ ")) {
            return <Text key={i} color="green">{line}</Text>;
          }
          if (line.startsWith("- ")) {
            return <Text key={i} color="red">{line}</Text>;
          }
          return <Text key={i} dimColor>{line}</Text>;
        })}
      </Box>
    );
  }

  const isStarted = content.startsWith("▶");
  const isCompleted = content.startsWith("✓");
  const isDenied = content.startsWith("✗");

  if (isStarted) {
    return (
      <Box marginLeft={2}>
        <Text color="blue">{content}</Text>
      </Box>
    );
  }
  if (isCompleted) {
    return (
      <Box marginLeft={2}>
        <Text color="green">{content}</Text>
      </Box>
    );
  }
  if (isDenied) {
    return (
      <Box marginLeft={2}>
        <Text color="red">{content}</Text>
      </Box>
    );
  }

  return (
    <Box marginLeft={2}>
      <Text dimColor>{content}</Text>
    </Box>
  );
}

export function Message({ entry, model }: { entry: ChatEntry; model?: string }) {
  if (entry.type === "user") {
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">
            {"You: "}
          </Text>
          <Text>{entry.content}</Text>
        </Box>
      </Box>
    );
  }
  if (entry.type === "tool") {
    return <ToolMessage content={entry.content} />;
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
  const meta = usageMeta(entry);
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold color="green">
        {`agent(${model ?? "unknown"}):`}
      </Text>
      <Box marginLeft={2}>
        <MarkdownText content={`${entry.content}${entry.streaming ? '▍' : ''}`} />
      </Box>
      {meta && (
        <Box marginLeft={2}>
          <Text dimColor>{meta}</Text>
        </Box>
      )}
    </Box>
  );
}
