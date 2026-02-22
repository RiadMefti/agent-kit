import type { IAIClient } from "./types";
import AIClientCodex from "./ai-client-codex";
import AIClientCopilot from "./ai-client-copilot";
import {
  extractTokenInfo,
  isTokenExpired,
  getAccessToken,
  fetchModels,
  runCodexLogin,
} from "./codex-auth";
import {
  COPILOT_MODELS,
  startDeviceFlow,
  pollForToken,
  getCopilotToken,
} from "./copilot-auth";

export interface ModelInfo {
  slug: string;
  display_name: string;
  description: string;
}

export interface ProviderConfig {
  name: string;
  displayName: string;
  defaultModel: string;
  createClient(model: string): IAIClient;
  getModels(): Promise<ModelInfo[]>;
  login(onMessage?: (msg: string) => void): Promise<string>;
  getStatus(model: string): string;
}

const codexProvider: ProviderConfig = {
  name: "codex",
  displayName: "Codex",
  defaultModel: "gpt-5.3-codex",

  createClient(model: string): IAIClient {
    return new AIClientCodex(model);
  },

  async getModels(): Promise<ModelInfo[]> {
    const token = getAccessToken();
    if (isTokenExpired(token)) {
      throw new Error("Token expired. Run /login to re-authenticate.");
    }
    const models = await fetchModels(token);
    return models.map((m) => ({
      slug: m.slug,
      display_name: m.display_name,
      description: m.description,
    }));
  },

  async login(): Promise<string> {
    const result = runCodexLogin();
    return result;
  },

  getStatus(model: string): string {
    try {
      const token = getAccessToken();
      const info = extractTokenInfo(token);
      const expired = isTokenExpired(token);
      const expDate = info.exp ? new Date(info.exp * 1000).toLocaleString() : "unknown";
      return `Provider: Codex\nAccount: ${info.email || "unknown"}\nToken expires: ${expDate}\nStatus: ${expired ? "EXPIRED - run /login" : "valid"}\nModel: ${model}`;
    } catch (e) {
      return String(e);
    }
  },
};

const copilotProvider: ProviderConfig = {
  name: "copilot",
  displayName: "GitHub Copilot",
  defaultModel: "claude-sonnet-4.6",

  createClient(model: string): IAIClient {
    return new AIClientCopilot(model);
  },

  async getModels(): Promise<ModelInfo[]> {
    return COPILOT_MODELS.map((m) => ({
      slug: m.slug,
      display_name: m.display_name,
      description: m.description,
    }));
  },

  async login(onMessage?: (msg: string) => void): Promise<string> {
    const flow = await startDeviceFlow();
    // Kick off polling in the background
    pollForToken(flow.device_code, flow.interval)
      .then(() => {
        onMessage?.("Copilot login successful!");
      })
      .catch((e) => {
        onMessage?.(`Copilot login failed: ${String(e)}`);
      });
    return `Open ${flow.verification_uri} and enter code: ${flow.user_code}`;
  },

  getStatus(model: string): string {
    try {
      getCopilotToken();
      return `Provider: GitHub Copilot\nStatus: logged in\nModel: ${model}`;
    } catch {
      return `Provider: GitHub Copilot\nStatus: not logged in — run /login\nModel: ${model}`;
    }
  },
};

export const PROVIDERS: Record<string, ProviderConfig> = {
  codex: codexProvider,
  copilot: copilotProvider,
};
