import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CLIENT_ID = "Ov23li8tweQw6odWQebz";
const AUTH_DIR = join(homedir(), ".agent-kit");
const AUTH_FILE = join(AUTH_DIR, "copilot-auth.json");
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const POLL_SAFETY_MARGIN_MS = 3000;

export interface CopilotModel {
  slug: string;
  display_name: string;
  description: string;
}

export const COPILOT_MODELS: CopilotModel[] = [
  { slug: "claude-sonnet-4.6", display_name: "Claude Sonnet 4.6", description: "Anthropic, balanced" },
  { slug: "claude-sonnet-4.5", display_name: "Claude Sonnet 4.5", description: "Anthropic, balanced" },
  { slug: "claude-sonnet-4", display_name: "Claude Sonnet 4", description: "Anthropic, balanced" },
  { slug: "claude-opus-4.6", display_name: "Claude Opus 4.6", description: "Anthropic, most capable" },
  { slug: "claude-opus-4.5", display_name: "Claude Opus 4.5", description: "Anthropic, most capable" },
  { slug: "claude-haiku-4.5", display_name: "Claude Haiku 4.5", description: "Anthropic, fast" },
  { slug: "gpt-5.2", display_name: "GPT-5.2", description: "OpenAI" },
  { slug: "gpt-5.2-codex", display_name: "GPT-5.2-Codex", description: "OpenAI, coding" },
  { slug: "gpt-5.1", display_name: "GPT-5.1", description: "OpenAI" },
  { slug: "gpt-5.1-codex", display_name: "GPT-5.1-Codex", description: "OpenAI, coding" },
  { slug: "gpt-4.1", display_name: "GPT-4.1", description: "OpenAI" },
  { slug: "gpt-5-mini", display_name: "GPT-5 Mini", description: "OpenAI, fast" },
  { slug: "gemini-2.5-pro", display_name: "Gemini 2.5 Pro", description: "Google" },
  { slug: "gemini-3-flash-preview", display_name: "Gemini 3 Flash", description: "Google, fast" },
  { slug: "grok-code-fast-1", display_name: "Grok Code Fast 1", description: "xAI, fast" },
];

export function getCopilotToken(): string {
  if (!existsSync(AUTH_FILE)) {
    throw new Error("Not logged in to Copilot. Run /login to authenticate.");
  }
  let auth: any;
  try {
    auth = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    throw new Error("Auth file is corrupt. Run /login to re-authenticate.");
  }
  const token = auth?.access_token;
  if (!token) {
    throw new Error("No Copilot token found. Run /login to authenticate.");
  }
  return token;
}

function saveCopilotToken(token: string): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
  writeFileSync(AUTH_FILE, JSON.stringify({ access_token: token }, null, 2));
}

export async function startDeviceFlow(): Promise<{
  verification_uri: string;
  user_code: string;
  device_code: string;
  interval: number;
}> {
  const res = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: "read:user" }),
  });

  if (!res.ok) {
    throw new Error(`Device flow failed (${res.status}): ${await res.text()}`);
  }

  return res.json() as any;
}

export async function pollForToken(
  deviceCode: string,
  interval: number
): Promise<string> {
  const deadline = Date.now() + 10 * 60 * 1000; // 10 minute timeout
  while (Date.now() < deadline) {
    const res = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!res.ok) throw new Error("Token polling failed");

    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
      interval?: number;
    };

    if (data.access_token) {
      saveCopilotToken(data.access_token);
      return data.access_token;
    }

    if (data.error === "authorization_pending") {
      await new Promise((r) => setTimeout(r, interval * 1000 + POLL_SAFETY_MARGIN_MS));
      continue;
    }

    if (data.error === "slow_down") {
      const newInterval = data.interval ?? interval + 5;
      await new Promise((r) => setTimeout(r, newInterval * 1000 + POLL_SAFETY_MARGIN_MS));
      interval = newInterval;
      continue;
    }

    if (data.error) {
      throw new Error(`Auth failed: ${data.error}`);
    }

    await new Promise((r) => setTimeout(r, interval * 1000 + POLL_SAFETY_MARGIN_MS));
  }
  throw new Error("Login timed out after 10 minutes. Run /login to try again.");
}
