import type { ToolDefinition } from "../client/types";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function readFile(
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<string> {
  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const lines = text.split("\n");

    if (startLine !== undefined) {
      const start = Math.max(0, startLine - 1);
      const end = endLine ?? lines.length;
      return lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}: ${line}`)
        .join("\n");
    }

    return lines.map((line, i) => `${i + 1}: ${line}`).join("\n");
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

export async function writeFile(
  filePath: string,
  content: string
): Promise<string> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await Bun.write(filePath, content);
    return `Successfully wrote to ${filePath}`;
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

export async function editFile(
  filePath: string,
  oldText: string,
  newText: string
): Promise<string> {
  try {
    const file = Bun.file(filePath);
    const content = await file.text();

    const count = content.split(oldText).length - 1;
    if (count === 0) return `Error: old_text not found in ${filePath}`;
    if (count > 1) return `Error: old_text found ${count} times in ${filePath}. Must be unique.`;

    const updated = content.replace(oldText, newText);
    await Bun.write(filePath, updated);
    return `Successfully edited ${filePath}`;
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

export const readTool: ToolDefinition = {
  type: "function",
  function: {
    name: "read",
    description:
      "Read a file's contents with line numbers. Optionally specify start_line and end_line to read a specific range. Always returns line numbers for reference.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to read",
        },
        start_line: {
          type: ["number", "null"],
          description: "Starting line number (1-based). Null to read from beginning.",
        },
        end_line: {
          type: ["number", "null"],
          description: "Ending line number (inclusive). Null to read to end.",
        },
      },
      required: ["file_path", "start_line", "end_line"],
      additionalProperties: false,
    },
  },
};

export const writeTool: ToolDefinition = {
  type: "function",
  function: {
    name: "write",
    description: "Create a new file or overwrite an existing file with the given content.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to write",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["file_path", "content"],
      additionalProperties: false,
    },
  },
};

export const editTool: ToolDefinition = {
  type: "function",
  function: {
    name: "edit",
    description:
      "Edit a file by replacing old_text with new_text. The old_text must appear exactly once in the file to avoid ambiguity. Use the read tool first to see the current content.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to the file to edit",
        },
        old_text: {
          type: "string",
          description: "Exact text to find and replace. Must be unique in the file.",
        },
        new_text: {
          type: "string",
          description: "Text to replace old_text with. Use empty string to delete.",
        },
      },
      required: ["file_path", "old_text", "new_text"],
      additionalProperties: false,
    },
  },
};
