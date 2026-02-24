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
  const score = (value: string, f: string): number => {
    if (!f) return 100;
    const v = value.slice(1).toLowerCase();
    if (v.startsWith(f)) return 80 + f.length;
    if (v.includes(f)) return 50 + f.length;
    let i = 0;
    for (const ch of v) {
      if (ch === f[i]) i++;
      if (i === f.length) return 20 + f.length;
    }
    return -1;
  };
  const matches = commands
    .map((c) => ({ cmd: c, s: score(c.value, filter) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.cmd);
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
      <Box marginLeft={2}><Text dimColor>↑/↓ navigate • Enter run • Esc close</Text></Box>
      {matches.length === 0 && (
        <Box marginLeft={2}><Text dimColor>No matching commands</Text></Box>
      )}
    </Box>
  );
}
