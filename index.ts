import AIClientCodex from "./client/ai-client-codex";
import Agent from "./agent/agent";
import { tools } from "./tools";

const aiClient = new AIClientCodex(tools);
const agent = new Agent(aiClient);

const answer = await agent.run(
  "what tools are exported for agent use?"
);

console.log(answer);
