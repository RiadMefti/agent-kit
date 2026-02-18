import OpenAI from "openai";




class AIClient {

  private token = process.env.GITHUB_API_KEY;
  private endpoint = "https://models.github.ai/inference";
  private model = "openai/gpt-4.1";
  private client = new OpenAI({ baseURL: this.endpoint, apiKey: this.token });
  private tools: OpenAI.ChatCompletionTool[] = []
  constructor(tools: OpenAI.ChatCompletionTool[]) {
    this.tools = tools
  }

  async chatCompletion(messages: OpenAI.ChatCompletionMessageParam[]): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.client.chat.completions.create({
          model: this.model,
          tools: this.tools,
          messages,
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

