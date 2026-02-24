import type { ToolCallEvent } from "../client/types";

export type AgentStatus =
  | { phase: "thinking" }
  | { phase: "tool"; name: string }
  | { phase: "approval"; name: string }
  | { phase: "retrying"; attempt: number; maxRetries: number }
  | { phase: "idle" };

export interface SessionEvent {
  ts: number;
  type:
    | "user_message"
    | "assistant_message"
    | "tool_started"
    | "tool_completed"
    | "tool_denied"
    | "status";
  payload: Record<string, unknown>;
}

export interface Telemetry {
  promptChars: number;
  responseChars: number;
  toolCalls: number;
  toolDenied: number;
  retries: number;
}

export function initTelemetry(): Telemetry {
  return { promptChars: 0, responseChars: 0, toolCalls: 0, toolDenied: 0, retries: 0 };
}

export function applyToolEvent(t: Telemetry, event: ToolCallEvent): Telemetry {
  if (event.status === "started") {
    return { ...t, toolCalls: t.toolCalls + 1 };
  }
  if (event.status === "denied") {
    return { ...t, toolDenied: t.toolDenied + 1 };
  }
  return t;
}
