import type { ToolEntry, ToolDefinition } from "../client/types";
import { bashTool, command } from "./bash-tool";
import { grepTool, grep } from "./ripgrep-tool";
import { readTool, writeTool, editTool, readFile, writeFile, editFile } from "./file-tools";
import { todoReadTool, todoWriteTool, todoRead, todoWrite } from "./todo-tool";
import { globTool, globSearch } from "./glob-tool";
import { webFetchTool, webFetch } from "./web-fetch-tool";

export const attemptCompletionTool: ToolDefinition = {
  type: "function",
  function: {
    name: "attempt_completion",
    description:
      "Call this tool when you have completed the task. Provide a brief summary of what you did as the result. This is the ONLY way to finish — you must call this tool when done.",
    parameters: {
      type: "object",
      properties: {
        result: {
          type: "string",
          description: "A brief summary of what was accomplished.",
        },
      },
      required: ["result"],
    },
  },
};

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
      const { file_path, old_text, new_text, replace_all } = args as {
        file_path: string;
        old_text: string;
        new_text: string;
        replace_all: boolean | null;
      };
      return await editFile(file_path, old_text, new_text, replace_all ?? false);
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
  {
    definition: webFetchTool,
    handler: async (args) => {
      const { url, max_length } = args as {
        url: string;
        max_length: number | null;
      };
      return await webFetch(url, max_length ?? undefined);
    },
  },
  {
    definition: attemptCompletionTool,
    // Handler is a no-op — the agent loop intercepts this tool call directly
    handler: async (args) => {
      return (args as { result: string }).result ?? "Done.";
    },
  },
];
