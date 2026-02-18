import type OpenAI from "openai";

export function multiply(a: number, b: number, ...rest: number[]): number {
  return [a, b, ...rest].reduce((x, y) => x * y);
}

export const multiplyTool: OpenAI.ChatCompletionTool = {
  type: "function",
  function: {
    name: "multiply",
    description: "Multiply 2 or more numbers together",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: { type: "number" },
          description: "The numbers to  multiply together (minimum 2)",
        },
      },
      required: ["numbers"],
      additionalProperties: false,
    },
  },
};

