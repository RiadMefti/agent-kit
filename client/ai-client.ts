import OpenAI from "openai";

class AIClient {
  private token = process.env.GITHUB_API_KEY;
  private endpoint = "https://models.github.ai/inference";
  private model = "openai/gpt-4.1";
  private client = new OpenAI({ baseURL: this.endpoint, apiKey: this.token });
  private tools: OpenAI.ChatCompletionTool[] = [];
  private systemInstruction = `You are a coding agent working inside a local project.

Use tools proactively before asking clarifying questions.
- First inspect the project structure and identify the correct files and paths.
- If a path is ambiguous, discover it with available tools (read/grep/bash) instead of guessing.
- Read relevant files before editing and apply minimal targeted changes.
- Only ask the user a question after tool-based investigation if a real blocker remains.

Always verify assumptions about the project using tools.`;

  constructor(tools: OpenAI.ChatCompletionTool[]) {
    this.tools = tools;
  }

  async chatCompletion(
    messages: OpenAI.ChatCompletionMessageParam[]
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const maxRetries = 3;
    const fullMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: this.systemInstruction },
      ...messages,
    ];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.client.chat.completions.create({
          model: this.model,
          tools: this.tools,
          messages: fullMessages,
        });
      } catch (e) {
        if (attempt === maxRetries - 1) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }

    throw new Error("Failed to get chat completion after max retries");
  }
}

export default AIClient;
