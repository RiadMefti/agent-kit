import type { SessionEvent } from "./types";

export class SessionMemory {
  private events: SessionEvent[] = [];

  add(type: SessionEvent["type"], payload: Record<string, unknown>): void {
    this.events.push({ ts: Date.now(), type, payload });
  }

  all(): SessionEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
