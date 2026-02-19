import type { ToolDefinition } from "../client/types";
import { $ } from "bun";

export async function grep(
  pattern: string,
  path: string,
  maxResults?: number
): Promise<string> {
  try {
    const cmd = maxResults
      ? `rg --line-number --max-count ${maxResults} ${pattern} ${path}`
      : `rg --line-number ${pattern} ${path}`;
    const result = await $`${{ raw: cmd }}`.quiet().text();
    return result || "No matches found";
  } catch (e) {
    return "No matches found";
  }
}

export const grepTool: ToolDefinition = {
  type: "function",
  function: {
    name: "grep",
    description:
      "Search file contents using ripgrep. Returns matching lines with line numbers. Respects .gitignore. Use max_results to limit output when searching broad patterns in large codebases.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regex pattern to search for",
        },
        path: {
          type: "string",
          description: "File or directory path to search in",
        },
        max_results: {
          type: ["number", "null"],
          description: "Maximum matches per file. Null for no limit.",
        },
      },
      required: ["pattern", "path", "max_results"],
      additionalProperties: false,
    },
  },
};
