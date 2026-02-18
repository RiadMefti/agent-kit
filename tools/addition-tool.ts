import type OpenAI from "openai";

export function add(a: number, b: number, ...rest: number[]): number {
  return [a, b, ...rest].reduce((x, y) => x + y);
}

export const addTool: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "add",
    description: "Add 2 or more numbers together",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: { type: "number" },
          description: "The numbers to add together (minimum 2)",
        },
      },
      required: ["numbers"],
      additionalProperties: false,
    },
  },
};
