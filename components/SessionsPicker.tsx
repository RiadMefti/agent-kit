import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { formatSessionLabel, type Session } from "../sessions";

export function SessionsPicker({
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
