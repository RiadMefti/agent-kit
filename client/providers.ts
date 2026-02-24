import type { IAIClient } from "./types";
import AIClientCodex from "./ai-client-codex";
import AIClientCopilot from "./ai-client-copilot";
import AIClientClaude from "./ai-client-claude";
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
import {
  CLAUDE_MODELS,
  hasClaudeCredentials,
} from "./claude-auth";

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

const claudeProvider: ProviderConfig = {
  name: "claude",
  displayName: "Claude (Subscription)",
  defaultModel: "claude-sonnet-4-6",

  createClient(model: string): IAIClient {
    return new AIClientClaude(model);
  },

  async getModels(): Promise<ModelInfo[]> {
    return CLAUDE_MODELS.map((m) => ({
      slug: m.slug,
      display_name: m.display_name,
      description: m.description,
    }));
  },

  async login(): Promise<string> {
    try {
      const { execSync } = await import("child_process");
      execSync("claude login", { stdio: "inherit" });
      return "Claude Code login complete.";
    } catch {
      return "Login failed. Make sure Claude Code CLI is installed (`npm install -g @anthropic-ai/claude-code`).";
    }
  },

  getStatus(model: string): string {
    const loggedIn = hasClaudeCredentials();
    return `Provider: Claude (Subscription)\nStatus: ${loggedIn ? "authenticated via Claude Code" : "not logged in — run /login or `claude login`"}\nModel: ${model}`;
  },
};

export const PROVIDERS: Record<string, ProviderConfig> = {
  codex: codexProvider,
  copilot: copilotProvider,
  claude: claudeProvider,
};

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Codex models
  "gpt-5.3-codex": 200_000,
  "gpt-5.2-codex": 200_000,
  "gpt-5.1-codex": 200_000,
  // Copilot models — Claude
  "claude-sonnet-4.6": 200_000,
  "claude-sonnet-4.5": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-opus-4.6": 200_000,
  "claude-opus-4.5": 200_000,
  "claude-haiku-4.5": 200_000,
  // Copilot models — GPT
  "gpt-5.2": 128_000,
  "gpt-5.1": 128_000,
  "gpt-4.1": 128_000,
  "gpt-5-mini": 128_000,
  // Copilot models — Gemini
  "gemini-2.5-pro": 1_000_000,
  "gemini-3-flash-preview": 1_000_000,
  // Copilot models — Grok
  "grok-code-fast-1": 128_000,
  // Claude (subscription) models
  "claude-opus-4-6": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-opus-4-5": 200_000,
  "claude-sonnet-4-5": 200_000,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

export function getContextWindow(model: string): number {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}
