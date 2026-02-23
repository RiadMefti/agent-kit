import { Box, Text } from "ink";
import { MarkdownText } from "./MarkdownText";

export interface ChatEntry {
  type: "user" | "assistant" | "tool" | "system";
  content: string;
  streaming?: boolean;
  promptTokens?: number;
  contextPercent?: number;
}

function usageMeta(entry: ChatEntry) {
  if (entry.promptTokens == null && entry.contextPercent == null) return null;
  const tokens = entry.promptTokens != null ? `${entry.promptTokens} tok` : null;
  const pct = entry.contextPercent != null ? `${entry.contextPercent.toFixed(1)}% ctx` : null;
  return [tokens, pct].filter(Boolean).join(" • ");
}

export function Message({ entry, model }: { entry: ChatEntry; model?: string }) {
  if (entry.type === "user") {
    const meta = usageMeta(entry);
    return (
      <Box marginBottom={1} flexDirection="column">
        <Box>
          <Text bold color="cyan">
            {"You: "}
          </Text>
          <Text>{entry.content}</Text>
        </Box>
        {meta && (
          <Box marginLeft={2}>
            <Text dimColor>{meta}</Text>
          </Box>
        )}
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
  const meta = usageMeta(entry);
  return (
    <Box marginBottom={1} flexDirection="column">
      <Text bold color="green">
        {`agent(${model ?? "unknown"}):`}
      </Text>
      <Box marginLeft={2}>
        {entry.streaming ? (
          <Text wrap="wrap">{entry.content}{'▍'}</Text>
        ) : (
          <MarkdownText content={entry.content} />
        )}
      </Box>
      {meta && (
        <Box marginLeft={2}>
          <Text dimColor>{meta}</Text>
        </Box>
      )}
    </Box>
  );
}
