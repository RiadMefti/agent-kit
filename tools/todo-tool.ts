import type { ToolDefinition } from "../client/types";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const TODO_FILE = join(process.cwd(), ".agent", "todos.json");

interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
  created_at: string;
  updated_at: string;
}

function ensureTodoFile(): void {
  if (!existsSync(TODO_FILE)) {
    mkdirSync(dirname(TODO_FILE), { recursive: true });
    writeFileSync(TODO_FILE, JSON.stringify([], null, 2));
  }
}

function loadTodos(): Todo[] {
  ensureTodoFile();
  try {
    const raw = readFileSync(TODO_FILE, "utf-8");
    return JSON.parse(raw) as Todo[];
  } catch {
    return [];
  }
}

function saveTodos(todos: Todo[]): void {
  ensureTodoFile();
  writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export async function todoRead(): Promise<string> {
  const todos = loadTodos();
  if (todos.length === 0) {
    return "No todos found.";
  }
  return JSON.stringify(todos, null, 2);
}

export async function todoWrite(
  todos: Array<{ content: string; status: string; priority: string }>
): Promise<string> {
  const now = new Date().toISOString();
  const newTodos: Todo[] = todos.map((t) => ({
    id: generateId(),
    content: t.content,
    status: t.status as Todo["status"],
    priority: t.priority as Todo["priority"],
    created_at: now,
    updated_at: now,
  }));
  saveTodos(newTodos);
  return `Todo list updated with ${newTodos.length} item(s).\n${JSON.stringify(newTodos, null, 2)}`;
}


export const todoReadTool: ToolDefinition = {
  type: "function",
  function: {
    name: "todo_read",
    description:
      "Read the persistent todo list from disk. Only use this for long multi-session projects that need persistent task tracking. Do NOT use for normal requests.",
    strict: true,
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};

export const todoWriteTool: ToolDefinition = {
  type: "function",
  function: {
    name: "todo_write",
    description:
      "Write/replace the persistent todo list on disk. Only use for long multi-session projects needing persistent tracking. Do NOT use for normal requests — just do the work directly instead of planning it.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The complete todo list to persist.",
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "Brief description of the task.",
              },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
                description: "Current status of the task.",
              },
              priority: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: "Priority level of the task.",
              },
            },
            required: ["content", "status", "priority"],
            additionalProperties: false,
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
  },
};
