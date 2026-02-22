import { join } from "path";
import { mkdir, readdir, rm } from "fs/promises";
import type { ChatEntry } from "./components/Message";

const SESSIONS_DIR = join(process.cwd(), ".agent-kit", "sessions");
const MAX_SESSIONS = 20;

export type SessionEntry = ChatEntry;

export interface Session {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  entries: ChatEntry[];
}

async function ensureDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id: string) {
  return join(SESSIONS_DIR, `${id}.json`);
}

export async function saveSession(session: Session): Promise<void> {
  try {
    await ensureDir();
    await Bun.write(sessionPath(session.id), JSON.stringify(session, null, 2));
    await pruneOldSessions();
  } catch {
    // best effort — don't crash the app if save fails
  }
}

export async function listSessions(): Promise<Session[]> {
  await ensureDir();
  try {
    const files = await readdir(SESSIONS_DIR);
    const jsonFiles = files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, MAX_SESSIONS);

    const sessions: Session[] = [];
    for (const file of jsonFiles) {
      try {
        const text = await Bun.file(join(SESSIONS_DIR, file)).text();
        const parsed = JSON.parse(text);
        if (parsed && parsed.id && parsed.entries) {
          sessions.push(parsed);
        }
      } catch {
        // skip corrupt files
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

async function pruneOldSessions(): Promise<void> {
  try {
    const files = await readdir(SESSIONS_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
    if (jsonFiles.length > MAX_SESSIONS) {
      const toDelete = jsonFiles.slice(0, jsonFiles.length - MAX_SESSIONS);
      for (const f of toDelete) {
        await rm(join(SESSIONS_DIR, f));
      }
    }
  } catch {
    // best effort
  }
}

export function formatSessionLabel(session: Session): string {
  const date = new Date(session.timestamp);
  const isValid = !isNaN(date.getTime());
  const dateStr = isValid
    ? date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "Unknown date";
  const firstUserMsg = session.entries.find((e) => e.type === "user")?.content ?? "(empty)";
  const preview = firstUserMsg.length > 50 ? firstUserMsg.slice(0, 47) + "..." : firstUserMsg;
  return `${dateStr}  —  ${preview}`;
}
