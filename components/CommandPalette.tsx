import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface Command {
  value: string;
  desc: string;
}

export function CommandPalette({
  input,
  onInputChange,
  onSelect,
  commands,
}: {
  input: string;
  onInputChange: (value: string) => void;
  onSelect: (cmd: string) => void;
  commands: Command[];
}) {
  const filter = input.slice(1).toLowerCase();
  const matches = commands.filter((c) => c.value.slice(1).startsWith(filter));
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
