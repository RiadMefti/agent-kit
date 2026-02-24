import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CREDENTIALS_FILE = join(homedir(), ".claude", ".credentials.json");
const TOKEN_ENDPOINT = "https://console.anthropic.com/v1/oauth/token";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export const CLAUDE_MODELS = [
  { slug: "claude-opus-4-6", display_name: "Opus 4.6", description: "Most capable model" },
  { slug: "claude-sonnet-4-6", display_name: "Sonnet 4.6", description: "Best balance of speed and intelligence" },
  { slug: "claude-opus-4-5", display_name: "Opus 4.5", description: "Prior stable Opus release" },
  { slug: "claude-sonnet-4-5", display_name: "Sonnet 4.5", description: "Prior stable Sonnet release" },
];

interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function readFromKeychain(): OAuthCredentials | null {
  if (process.platform !== "darwin") return null;
  try {
    const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
      stdio: ["pipe", "pipe", "pipe"],
    }).toString().trim();
    const data = JSON.parse(raw);
    const oauth = data.claudeAiOauth || data.oauthAccount;
    if (oauth?.accessToken && oauth?.refreshToken) {
      return {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt ?? 0,
      };
    }
  } catch {}
  return null;
}

function readFromFile(): OAuthCredentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
    const oauth = data.claudeAiOauth || data.oauthAccount;
    if (oauth?.accessToken && oauth?.refreshToken) {
      return {
        accessToken: oauth.accessToken,
        refreshToken: oauth.refreshToken,
        expiresAt: oauth.expiresAt ?? 0,
      };
    }
  } catch {}
  return null;
}

function getCredentials(): OAuthCredentials {
  // 1. Env var override
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return {
      accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      refreshToken: "",
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    };
  }

  // 2. macOS Keychain
  const keychain = readFromKeychain();
  if (keychain) return keychain;

  // 3. Credentials file
  const file = readFromFile();
  if (file) return file;

  throw new Error("No Claude Code credentials found. Make sure Claude Code CLI is installed and logged in (`claude login`).");
}

function isExpired(creds: OAuthCredentials): boolean {
  return Date.now() > creds.expiresAt - 5 * 60 * 1000; // 5 min buffer
}

async function refreshToken(creds: OAuthCredentials): Promise<OAuthCredentials> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json() as any;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 28800) * 1000,
  };
}

let cachedCreds: OAuthCredentials | null = null;

export async function getClaudeToken(): Promise<string> {
  if (!cachedCreds) {
    cachedCreds = getCredentials();
  }

  if (isExpired(cachedCreds) && cachedCreds.refreshToken) {
    cachedCreds = await refreshToken(cachedCreds);
  }

  return cachedCreds.accessToken;
}

export function hasClaudeCredentials(): boolean {
  try {
    getCredentials();
    return true;
  } catch {
    return false;
  }
}
