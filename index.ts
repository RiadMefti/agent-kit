import AIClient from "./client/ai-client";
import Agent from "./agent/agent";
import { tools } from "./tools";
import AIClientCodex from "./client/ai-client-codex";

const aiClient = new AIClient(tools);

const codexAiClient = new AIClientCodex(tools);
const agent = new Agent(codexAiClient);

const answer = await agent.run(
  "what tools are exported for agent use?"
);

console.log(answer);
