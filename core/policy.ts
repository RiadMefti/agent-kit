const SAFE_TOOLS = new Set(["read", "glob", "grep", "todo_read"]);

export function requiresApproval(toolName: string): boolean {
  return !SAFE_TOOLS.has(toolName);
}

export function riskLabel(toolName: string): "safe" | "filesystem" | "shell" | "network" {
  if (toolName === "bash") return "shell";
  if (toolName === "web_fetch") return "network";
  if (["write", "edit", "todo_write"].includes(toolName)) return "filesystem";
  return "safe";
}
