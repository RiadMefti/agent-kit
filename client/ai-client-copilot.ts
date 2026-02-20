import { getCopilotToken } from "./copilot-auth";
import type {
  IAIClient,
  ToolDefinition,
  ChatMessage,
  ChatResponse,
} from "./types";

const COPILOT_ENDPOINT = "https://api.githubcopilot.com/chat/completions";

class AIClientCopilot implements IAIClient {
  private model: string;
  private accessToken: string;

  constructor(model?: string) {
    this.model = model || "claude-sonnet-4.6";
    this.accessToken = getCopilotToken();
  }

  async chatCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): Promise<ChatResponse> {
    const maxRetries = 3;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      tool_choice: "auto",
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(COPILOT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.accessToken}`,
            "User-Agent": "agent-kit/0.1.0",
            "Openai-Intent": "conversation-edits",
            "x-initiator": "user",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Copilot API error ${res.status}: ${err}`);
        }

        const data = await res.json();
        return data as ChatResponse;
      } catch (e) {
        if (attempt === maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }

    throw new Error("Failed to get chat completion after max retries");
  }
}

export default AIClientCopilot;
