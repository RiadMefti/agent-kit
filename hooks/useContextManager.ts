import { useState, useCallback, useRef } from "react";
import type { ChatMessage, TokenUsage } from "../client/types";
import { getContextWindow } from "../client/providers";

function summarizeMessage(message: ChatMessage): string {
  if (message.role === "tool") {
    const content = message.content.length > 120
      ? `${message.content.slice(0, 120)}...`
      : message.content;
    return `- tool(${message.tool_call_id}): ${content}`;
  }

  const content = (message.content ?? "").replace(/\s+/g, " ").trim();
  const clipped = content.length > 180 ? `${content.slice(0, 180)}...` : content;
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
  const utilization = totalUsage.promptTokens / contextWindow;
  const isWarning = utilization > 0.8;

  const addUsage = useCallback((usage?: TokenUsage) => {
    if (!usage) return;
    setTotalUsage((prev) => ({
      promptTokens: usage.promptTokens, // latest prompt tokens = actual context size
      completionTokens: prev.completionTokens + usage.completionTokens,
      totalTokens: prev.totalTokens + usage.totalTokens,
    }));
  }, []);

  const pruneHistory = useCallback(
    (history: ChatMessage[]): ChatMessage[] => {
      if (totalUsage.promptTokens < contextWindow * 0.8) return history;

      const systemMessages = history.filter((m) => m.role === "system");
      const nonSystem = history.filter((m) => m.role !== "system");
      const kept = nonSystem.slice(-8);
      const removed = nonSystem.slice(0, Math.max(0, nonSystem.length - kept.length));
      const summary = buildCompactionSummary(removed);

      return summary
        ? [...systemMessages, summary, ...kept]
        : [...systemMessages, ...kept];
    },
    [totalUsage.promptTokens, contextWindow]
  );

  const formatTokenDisplay = useCallback((): string => {
    if (totalUsage.promptTokens === 0) return "";
    const tokens = totalUsage.promptTokens;
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k tokens`;
    }
    return `${tokens} tokens`;
  }, [totalUsage.promptTokens]);

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
