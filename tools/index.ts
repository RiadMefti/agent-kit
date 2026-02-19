import type { ToolDefinition } from "../client/types";
import { bashTool } from "./bash-tool";
import { grepTool } from "./ripgrep-tool";
import { editTool, readTool, writeTool } from "./file-tools";
import { todoReadTool, todoWriteTool } from "./todo-tool";
import { globTool } from "./glob-tool";

export const tools: ToolDefinition[] = [bashTool, grepTool, readTool, writeTool, editTool, todoReadTool, todoWriteTool, globTool];
