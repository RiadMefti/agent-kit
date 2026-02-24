import type { Telemetry } from "./types";
import { initTelemetry } from "./types";

export class TelemetryStore {
  private telemetry: Telemetry = initTelemetry();

  setPromptChars(chars: number): void {
    this.telemetry.promptChars = chars;
  }

  setResponseChars(chars: number): void {
    this.telemetry.responseChars = chars;
  }

  incRetries(): void {
    this.telemetry.retries += 1;
  }

  incToolCalls(): void {
    this.telemetry.toolCalls += 1;
  }

  incToolDenied(): void {
    this.telemetry.toolDenied += 1;
  }

  get(): Telemetry {
    return { ...this.telemetry };
  }
}
