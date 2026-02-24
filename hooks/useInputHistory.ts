import { useRef, useCallback } from "react";

export function useInputHistory() {
  const historyRef = useRef<string[]>([]);
  const indexRef = useRef(-1);
  const draftRef = useRef("");

  const push = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    // Don't save slash commands in history
    if (trimmed.startsWith("/")) return;
    // Avoid consecutive duplicates
    if (historyRef.current[historyRef.current.length - 1] !== trimmed) {
      historyRef.current.push(trimmed);
    }
    indexRef.current = -1;
    draftRef.current = "";
  }, []);

  const navigate = useCallback(
    (direction: "up" | "down", currentInput: string): string | null => {
      const history = historyRef.current;
      if (history.length === 0) return null;

      if (indexRef.current === -1) {
        // Save current input as draft before navigating
        draftRef.current = currentInput;
      }

      if (direction === "up") {
        if (indexRef.current === -1) {
          // Start from the end
          indexRef.current = history.length - 1;
        } else if (indexRef.current > 0) {
          indexRef.current--;
        } else {
          return null; // Already at oldest
        }
        return history[indexRef.current]!;
      } else {
        // down
        if (indexRef.current === -1) return null; // Already at draft
        if (indexRef.current < history.length - 1) {
          indexRef.current++;
          return history[indexRef.current]!;
        } else {
          // Return to draft
          indexRef.current = -1;
          return draftRef.current;
        }
      }
    },
    []
  );

  return { push, navigate };
}
