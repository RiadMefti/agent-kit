import type { ToolDefinition } from "../client/types";

export async function grep(
  pattern: string,
  path: string,
  maxResults?: number
): Promise<string> {
  try {
    const args = ["--line-number"];
    if (maxResults) args.push("--max-count", String(maxResults));
    args.push("--", pattern, path);

    const proc = Bun.spawn(["rg", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 1) return "No matches found";
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return `Error: ${stderr || `rg exited with code ${exitCode}`}`;
    }
    return output || "No matches found";
  } catch (e) {
    if (String(e).includes("ENOENT")) return "Error: rg (ripgrep) is not installed";
    return `Error: ${String(e)}`;
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
