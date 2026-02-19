export interface ToolParameter {
  type: string | string[];
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    strict?: boolean;
    parameters: {
      type: "object";
      properties: Record<string, ToolParameter>;
      required: string[];
      additionalProperties?: boolean;
    };
  };
}
export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ToolResultMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON-encoded
  };
}


export interface ChatResponse {
  id: string;
  model: string;
  choices: ChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatChoice {
  index: number;
  message: AssistantMessage;
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter";
}


export interface IAIClient {
  chatCompletion(
    messages: ChatMessage[],
    tools: ToolDefinition[]
  ): Promise<ChatResponse>;
}

export type ToolHandler = (args: unknown) => Promise<unknown>;

export interface ToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}
