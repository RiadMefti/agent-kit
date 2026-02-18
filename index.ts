import OpenAI from "openai";
import { tools } from "./tools";
import { add } from "./tools/addition-tool";
import { multiply } from "./tools/multiplication-tool";

const token = process.env.GITHUB_API_KEY;
const endpoint = "https://models.github.ai/inference";
const model = "openai/gpt-4.1";

const client = new OpenAI({ baseURL: endpoint, apiKey: token });

const messages: OpenAI.ChatCompletionMessageParam[] = [
  {
    role: "user",
    content:
      "Add 13 + 29 + 7. Then multiply that result by 6. Then add 100 to that result. Then multiply everything by 3. Use your tools for every single step, do not do any math yourself.",
  },
];

const response = await client.chat.completions.create({
  model,
  tools,
  messages,
});


let choice = response.choices[0]!;
let maxIteration = 10;
let i = 0;
while (choice.finish_reason != "stop" || i > maxIteration) {
  if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
    // Add the assistant's message (with tool calls) to the conversation
    messages.push(choice.message);

    for (const toolCall of choice.message.tool_calls) {
      if (toolCall.type === "function" && toolCall.function.name === "add") {
        const { numbers } = JSON.parse(toolCall.function.arguments) as {
          numbers: number[];
        };
        const [a, b, ...rest] = numbers;
        const result = add(a!, b!, ...rest);

        // Add the tool result to the conversation
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ result }),
        });
      }

      if (toolCall.type === "function" && toolCall.function.name === "multiply") {
        const { numbers } = JSON.parse(toolCall.function.arguments) as {
          numbers: number[];
        };
        const [a, b, ...rest] = numbers;
        const result = multiply(a!, b!, ...rest);

        // Add the tool result to the conversation
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ result }),
        });
      }

    }

    // Send tool results back to the model for a final answer
    let agentResponse = await client.chat.completions.create({
      model,
      tools,
      messages,
    });

    choice = agentResponse.choices[0]!;

  }

  if (choice.finish_reason == "stop") {
    console.log(choice.message.content);
  }
}

