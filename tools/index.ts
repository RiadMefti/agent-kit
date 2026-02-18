import type OpenAI from "openai";
import { bashTool } from "./bash-tool";

export const tools: OpenAI.ChatCompletionTool[] = [bashTool];
