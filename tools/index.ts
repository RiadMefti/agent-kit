import type { ToolEntry } from "../client/types";
import { bashTool, command } from "./bash-tool";
import { grepTool, grep } from "./ripgrep-tool";
import { readTool, writeTool, editTool, readFile, writeFile, editFile } from "./file-tools";
import { todoReadTool, todoWriteTool, todoRead, todoWrite } from "./todo-tool";
import { globTool, globSearch } from "./glob-tool";

/**
 * Base tool entries — all tools except `task` (which requires the AI client).
 * Each entry pairs a ToolDefinition with its handler implementation.
 */
export const baseToolEntries: ToolEntry[] = [
  {
    definition: bashTool,
    handler: async (args) => {
      const { command: cmd } = args as { command: string };
      return await command(cmd);
    },
  },
  {
    definition: readTool,
    handler: async (args) => {
      const { file_path, start_line, end_line } = args as {
        file_path: string;
        start_line: number | null;
        end_line: number | null;
      };
      return await readFile(
        file_path,
        start_line ?? undefined,
        end_line ?? undefined
      );
    },
  },
  {
    definition: writeTool,
    handler: async (args) => {
      const { file_path, content } = args as {
        file_path: string;
        content: string;
      };
      return await writeFile(file_path, content);
    },
  },
  {
    definition: editTool,
    handler: async (args) => {
      const { file_path, old_text, new_text } = args as {
        file_path: string;
        old_text: string;
        new_text: string;
      };
      return await editFile(file_path, old_text, new_text);
    },
  },
  {
    definition: grepTool,
    handler: async (args) => {
      const { pattern, path, max_results } = args as {
        pattern: string;
        path: string;
        max_results: number | null;
      };
      return await grep(pattern, path, max_results ?? undefined);
    },
  },
  {
    definition: todoReadTool,
    handler: async () => {
      return await todoRead();
    },
  },
  {
    definition: todoWriteTool,
    handler: async (args) => {
      const { todos } = args as {
        todos: Array<{ content: string; status: string; priority: string }>;
      };
      return await todoWrite(todos);
    },
  },
  {
    definition: globTool,
    handler: async (args) => {
      const { pattern, path } = args as {
        pattern: string;
        path: string | null;
      };
      return await globSearch(pattern, path);
    },
  },
];
