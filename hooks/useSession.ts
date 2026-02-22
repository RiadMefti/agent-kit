import { useRef, useEffect } from "react";
import type { ChatMessage } from "../client/types";
import type { ChatEntry } from "../components/Message";
import type { Session } from "../sessions";
import { saveSession } from "../sessions";

export function useSession(
  entries: ChatEntry[],
  loading: boolean,
  provider: string,
  selectedModel: string,
) {
  const sessionTimestamp = useRef<string>("");
  const sessionId = useRef<string>("");
  const conversationHistoryRef = useRef<ChatMessage[]>([]);
  const prevLoadingRef = useRef(false);

  // Auto-save session when agent finishes (loading: true -> false)
  useEffect(() => {
    if (prevLoadingRef.current && !loading && entries.length > 0) {
      // Set timestamp on first save (first real interaction)
      if (sessionTimestamp.current === "") {
        const now = new Date().toISOString();
        sessionTimestamp.current = now;
        sessionId.current = now.replace(/[:.]/g, "-");
      }
      saveSession({
        id: sessionId.current,
        timestamp: sessionTimestamp.current,
        provider,
        model: selectedModel,
        entries: entries.filter((e) => e.type !== "system"),
      });
    }
    prevLoadingRef.current = loading;
  }, [loading, entries, provider, selectedModel]);

  const resumeSession = (session: Session) => {
    sessionTimestamp.current = session.timestamp;
    sessionId.current = session.id;
    conversationHistoryRef.current = session.entries
      .filter((e) => e.type === "user" || e.type === "assistant")
      .map((e) => ({
        role: e.type as "user" | "assistant",
        content: e.content,
      }));
  };

  return {
    conversationHistoryRef,
    resumeSession,
  };
}
