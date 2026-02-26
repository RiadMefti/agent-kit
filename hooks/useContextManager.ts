import { useState, useCallback, useRef } from "react";
import type { ChatMessage, TokenUsage } from "../client/types";
import { getContextWindow } from "../client/providers";

function summarizeMessage(message: ChatMessage): string {
  if (message.role === "tool") {
    const content = message.content.length > 200
      ? `${message.content.slice(0, 200)}...`
      : message.content;
    return `- tool(${message.tool_call_id}): ${content}`;
  }

  const content = (message.content ?? "").replace(/\s+/g, " ").trim();
  // Keep more content for user/assistant messages to preserve decisions and context
  const maxLen = message.role === "user" ? 300 : 400;
  const clipped = content.length > maxLen ? `${content.slice(0, maxLen)}...` : content;
  return `- ${message.role}: ${clipped || "(empty)"}`;
}

function buildCompactionSummary(messages: ChatMessage[]): ChatMessage | null {
  if (messages.length === 0) return null;

  const lines = messages.map(summarizeMessage);
  return {
    role: "system",
    content: [
      "Context compaction summary of earlier conversation (preserve these facts and decisions):",
      ...lines,
    ].join("\n"),
  };
}

export function useContextManager(model: string) {
  const [totalUsage, setTotalUsage] = useState<TokenUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
  const prevModelRef = useRef(model);

  // Reset when model changes
  if (model !== prevModelRef.current) {
    prevModelRef.current = model;
    setTotalUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }

  const contextWindow = getContextWindow(model);
  // Use latestPromptTokens for utilization — this reflects actual context window fill
  const latestPrompt = totalUsage.latestPromptTokens ?? 0;
  const utilization = latestPrompt / contextWindow;
  const isWarning = utilization > 0.8;

  const addUsage = useCallback((usage?: TokenUsage) => {
    if (!usage) return;
    setTotalUsage((prev) => ({
      promptTokens: prev.promptTokens + usage.promptTokens,
      completionTokens: prev.completionTokens + usage.completionTokens,
      totalTokens: prev.totalTokens + usage.totalTokens,
      latestPromptTokens: usage.latestPromptTokens ?? usage.promptTokens,
    }));
  }, []);

  const pruneHistory = useCallback(
    (history: ChatMessage[]): ChatMessage[] => {
      if (latestPrompt < contextWindow * 0.8) return history;

      const systemMessages = history.filter((m) => m.role === "system");
      const nonSystem = history.filter((m) => m.role !== "system");

      // Keep more recent messages for better context continuity
      // At 80% context, keep last 20 messages; at 90%+, keep last 12
      const keepCount = latestPrompt > contextWindow * 0.9 ? 12 : 20;
      const kept = nonSystem.slice(-keepCount);
      const removed = nonSystem.slice(0, Math.max(0, nonSystem.length - kept.length));

      if (removed.length === 0) return history;

      const summary = buildCompactionSummary(removed);

      return summary
        ? [...systemMessages, summary, ...kept]
        : [...systemMessages, ...kept];
    },
    [latestPrompt, contextWindow]
  );

  const formatTokenDisplay = useCallback((): string => {
    if (totalUsage.totalTokens === 0) return "";
    const tokens = totalUsage.totalTokens;
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k tokens`;
    }
    return `${tokens} tokens`;
  }, [totalUsage.totalTokens]);

  const resetTokens = useCallback(() => {
    setTotalUsage({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  }, []);

  return {
    totalUsage,
    utilization,
    isWarning,
    addUsage,
    pruneHistory,
    formatTokenDisplay,
    resetTokens,
  };
}
