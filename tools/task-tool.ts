import type { ToolDefinition, ToolEntry, IAIClient } from "../client/types";
import Agent from "../agent/agent";

const DEFAULT_SUBAGENT_SYSTEM_PROMPT = `You are a focused sub-agent. Complete the task you are given thoroughly using your tools. When you are done, call the attempt_completion tool with your result.`;


export function createTaskToolEntry(
  aiClient: IAIClient,
  getAllToolEntries: () => ToolEntry[]
): ToolEntry {
  const definition: ToolDefinition = {
    type: "function",
    function: {
      name: "task",
      description:
        "Spawn a sub-agent to handle a task autonomously. The sub-agent runs its own tool-use loop and returns the result. Use this to delegate independent subtasks that can run in parallel or to isolate complex work. You can specify which tools the sub-agent has access to, and optionally provide a custom system prompt.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "The task instruction for the sub-agent. Be specific about what it should do and what information it should return.",
          },
          description: {
            type: ["string", "null"],
            description:
              "A short label describing the task (for logging/tracking purposes). Null if not needed.",
          },
          tools: {
            type: ["array", "null"],
            description:
              'List of tool names the sub-agent should have access to (e.g. ["read", "grep", "glob"]). Null to give the sub-agent access to all available tools including the task tool itself.',
            items: {
              type: "string",
            },
          },
          system_prompt: {
            type: ["string", "null"],
            description:
              "Custom system prompt for the sub-agent. Null to use the default sub-agent prompt.",
          },
        },
        required: ["prompt", "description", "tools", "system_prompt"],
        additionalProperties: false,
      },
    },
  };

  let subagentCounter = 0;

  const handler = async (args: unknown): Promise<unknown> => {
    const { prompt, description, tools, system_prompt } = args as {
      prompt: string;
      description: string | null;
      tools: string[] | null;
      system_prompt: string | null;
    };

    const id = ++subagentCounter;
    const label = description ?? `subagent-${id}`;

    const allEntries = getAllToolEntries();

    let subagentEntries: ToolEntry[];
    if (tools !== null && tools.length > 0) {
      const requestedNames = new Set(tools);
      subagentEntries = allEntries.filter((entry) =>
        requestedNames.has(entry.definition.function.name)
      );

      const foundNames = new Set(
        subagentEntries.map((e) => e.definition.function.name)
      );
      const missing = tools.filter((t) => !foundNames.has(t));
      if (missing.length > 0) {
        console.warn(
          `    Warning: requested tools not found: ${missing.join(", ")}`
        );
      }
      console.log(
        `    Tools: [${[...foundNames].join(", ")}]`
      );
    } else {
      subagentEntries = allEntries;
      console.log(`    Tools: ALL (${allEntries.length} tools)`);
    }

    const startTime = Date.now();

    const agent = new Agent(aiClient, subagentEntries, {
      systemPrompt: system_prompt ?? DEFAULT_SUBAGENT_SYSTEM_PROMPT,
    });

    const result = await agent.run(prompt);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return {
      result: result.answer,
      metadata: {
        description: description ?? undefined,
        iterations: result.iterations,
        elapsed_seconds: parseFloat(elapsed),
      },
    };
  };

  return { definition, handler };
}
