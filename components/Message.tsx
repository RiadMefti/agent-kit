import { Box, Text } from "ink";

export interface ChatEntry {
  type: "user" | "assistant" | "tool" | "system";
  content: string;
}

export function Message({ entry, model }: { entry: ChatEntry; model?: string }) {
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
