import type OpenAI from "openai";
import { Glob } from "bun";
import { join } from "path";

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".agent",
  "dist",
  "out",
  "coverage",
  ".cache",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "build",
  ".DS_Store",
];

const MAX_RESULTS = 500;

export async function globSearch(
  pattern: string,
  path: string | null
): Promise<string> {
  try {
    const cwd = path ?? process.cwd();
    const glob = new Glob(pattern);
    const matches: string[] = [];

    for await (const entry of glob.scan({ cwd, dot: true })) {
      // Skip ignored directories
      const shouldIgnore = DEFAULT_IGNORE.some(
        (ignored) =>
          entry === ignored ||
          entry.startsWith(ignored + "/") ||
          entry.includes("/" + ignored + "/")
      );
      if (shouldIgnore) continue;

      matches.push(entry);
      if (matches.length >= MAX_RESULTS) break;
    }

    if (matches.length === 0) {
      return `No files matched pattern "${pattern}" in ${cwd}`;
    }

    matches.sort();
    const truncated = matches.length >= MAX_RESULTS;
    const header = `Found ${matches.length}${truncated ? "+" : ""} file(s) matching "${pattern}" in ${cwd}${truncated ? " (results truncated)" : ""}`;
    return header + "\n" + matches.join("\n");
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

export const globTool: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "glob",
    description:
      "Find files by glob pattern. Supports patterns like '**/*.ts', 'src/**/*.test.ts', '*.json', etc. Automatically ignores node_modules, .git, dist, and other common directories. Use this instead of bash find/ls for file discovery.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "Glob pattern to match files (e.g. '**/*.ts', 'src/**/*.tsx', '*.json')",
        },
        path: {
          type: ["string", "null"],
          description:
            "Directory to search in. Defaults to the current working directory if null.",
        },
      },
      required: ["pattern", "path"],
      additionalProperties: false,
    },
  },
};
