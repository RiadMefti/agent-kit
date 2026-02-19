import type { ToolDefinition } from "../client/types";
import { $ } from "bun"
export async function command(command: string): Promise<string> {
  try {


    const output = await $`${{ raw: command }}`.quiet().text();

    return output;
  } catch (e) {
    return `Error: ${String(e)}`;


  }
}

export const bashTool: ToolDefinition = {
  type: "function",
  function: {
    name: "bash",
    description: "Execute a shell command and return the output",
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
