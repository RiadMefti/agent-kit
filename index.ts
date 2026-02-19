import AIClientCodex from "./client/ai-client-codex";
import Agent from "./agent/agent";
import { baseToolEntries } from "./tools";
import { createTaskToolEntry } from "./tools/task-tool";
import type { ToolEntry } from "./client/types";

const aiClient = new AIClientCodex();


let allToolEntries: ToolEntry[] = [];

const taskToolEntry = createTaskToolEntry(aiClient, () => allToolEntries);
allToolEntries = [...baseToolEntries, taskToolEntry];

const agent = new Agent(aiClient, allToolEntries, { label: "parent" });


const result = await agent.run(
  `Use the task tool to spawn two subagents in parallel:
1. Subagent 1: Give it only the "web_fetch" tool. It should fetch https://news.ycombinator.com and return the top 5 story titles.
2. Subagent 2: Give it only the "web_fetch" tool. It should fetch https://api.github.com/repos/oven-sh/bun and return the star count, description, and latest release info.
After both subagents finish, combine their findings into a brief report.`
);

console.log(result.answer);
