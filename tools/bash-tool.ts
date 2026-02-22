import type { ToolDefinition } from "../client/types";

const TIMEOUT_MS = 30_000; // 30 second timeout

export async function command(cmd: string): Promise<string> {
  try {
    const proc = Bun.spawn(["sh", "-c", cmd], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => proc.kill(), TIMEOUT_MS);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timeout);

    const output = stdout + (stderr ? `\n${stderr}` : "");
    if (exitCode !== 0) {
      return `Exit code ${exitCode}\n${output}`.trim();
    }
    return output || "(no output)";
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

export const bashTool: ToolDefinition = {
  type: "function",
  function: {
    name: "bash",
    description: "Execute a shell command and return the output. Commands have a 30 second timeout.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};
