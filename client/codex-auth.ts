import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const CODEX_DIR = join(homedir(), ".codex");
const AUTH_FILE = join(CODEX_DIR, "auth.json");
const MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
const CLIENT_VERSION = "0.104.0";

interface CodexModel {
  slug: string;
  display_name: string;
  description: string;
  default_reasoning_level: string;
  supported_reasoning_levels: { effort: string; description: string }[];
  context_window: number;
  visibility: string;
  priority: number;
}

// Read access token from ~/.codex/auth.json
export function getAccessToken(): string {
  if (!existsSync(AUTH_FILE)) {
    throw new Error("Not logged in. Run /login to authenticate.");
  }
  const auth = JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  const token = auth?.tokens?.access_token;
  if (!token) {
    throw new Error("No access token found. Run /login to authenticate.");
  }
  return token;
}

// Extract email/expiry from JWT
export function extractTokenInfo(accessToken: string): {
  email?: string;
  exp?: number;
} {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1]!, "base64url").toString("utf-8")
    );
    return {
      email: payload?.["https://api.openai.com/profile"]?.email,
      exp: payload?.exp,
    };
  } catch {
    return {};
  }
}

export function isTokenExpired(accessToken: string): boolean {
  const info = extractTokenInfo(accessToken);
  if (!info.exp) return true;
  return Date.now() / 1000 > info.exp - 300;
}

// Run `codex login` - it handles the full browser OAuth flow
export function runCodexLogin(): string {
  try {
    execSync("codex login", { stdio: "inherit" });
    const token = getAccessToken();
    const info = extractTokenInfo(token);
    const expDate = info.exp
      ? new Date(info.exp * 1000).toLocaleString()
      : "unknown";
    return `Logged in as ${info.email || "unknown"}\nToken expires: ${expDate}`;
  } catch (e) {
    throw new Error(`codex login failed: ${String(e)}`);
  }
}

// Fetch available models from the Codex API
export async function fetchModels(accessToken: string): Promise<CodexModel[]> {
  const res = await fetch(
    `${MODELS_URL}?client_version=${CLIENT_VERSION}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch models (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { models?: CodexModel[] };
  return (data.models || [])
    .filter((m) => m.visibility === "list")
    .sort((a, b) => a.priority - b.priority);
}
