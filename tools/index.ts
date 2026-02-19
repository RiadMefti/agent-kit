import type OpenAI from "openai";
import { bashTool } from "./bash-tool";
import { grepTool } from "./ripgrep-tool";
import { editTool, readTool, writeTool } from "./file-tools";
import { todoReadTool, todoWriteTool } from "./todo-tool";

export const tools: OpenAI.ChatCompletionTool[] = [bashTool, grepTool, readTool, writeTool, editTool, todoReadTool, todoWriteTool];
