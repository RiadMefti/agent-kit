import AIClient from "./client/ai-client";
import Agent from "./agent/agent";
import { tools } from "./tools";

const aiClient = new AIClient(tools);
const agent = new Agent(aiClient);

const answer = await agent.run(
  "Add 13 + 29 + 7. Then multiply that result by 6. Then add 100 to that result. Then multiply everything by 3. Use your tools for every single step."
);

console.log(answer);
