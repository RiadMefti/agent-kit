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
  `Use the task tool to do these two things as two separate task calls:
1. Task 1: Use only the "glob" tool to find all TypeScript files in this project and count them.
2. Task 2: Use only the "read" tool to read the file "package.json" and summarize what this project is.
After both tasks complete, combine their results into a final summary.`
);

console.log(result.answer);
