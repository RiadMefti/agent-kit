import { useState, useCallback, useRef } from "react";
import type { ChatMessage, TokenUsage } from "../client/types";
import { getContextWindow } from "../client/providers";

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

      // Keep system prompt (first element if present) + last 4 exchanges (8 messages)
      const systemMessages = history.filter((m) => m.role === "system");
      const nonSystem = history.filter((m) => m.role !== "system");
      const kept = nonSystem.slice(-8);
      return [...systemMessages, ...kept];
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
