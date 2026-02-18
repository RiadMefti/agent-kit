import AIClient from "./client/ai-client";
import Agent from "./agent/agent";
import { tools } from "./tools";

const aiClient = new AIClient(tools);
const agent = new Agent(aiClient);

const answer = await agent.run(
  "what files and folders are in this directory"
);

console.log(answer);
