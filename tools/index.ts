import { addTool } from "./addition-tool";
import type OpenAI from "openai";
import { multiplyTool } from "./multiplication-tool";

export const tools: OpenAI.ChatCompletionTool[] = [addTool, multiplyTool];
