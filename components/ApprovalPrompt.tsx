import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ApprovalRequest, ApprovalDecision } from "../client/types";

export function formatArgs(args: unknown): string {
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

export const APPROVAL_ITEMS = [
  { label: "Allow once", value: "allow_once" },
  { label: "Allow always", value: "allow_always" },
  { label: "Deny once", value: "deny_once" },
  { label: "Deny always", value: "deny_always" },
];

export const APPROVAL_HEIGHT = 9; // header(1) + tool name(1) + 4 items + border(2) + padding(1)

export function ApprovalPrompt({
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
