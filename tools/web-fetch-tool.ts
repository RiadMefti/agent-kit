import type { ToolDefinition } from "../client/types";

const MAX_CONTENT_LENGTH = 50_000;

export async function webFetch(
  url: string,
  max_length?: number
): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AgentKit/1.0; +https://github.com/agent-kit)",
        Accept: "text/html, application/json, text/plain, */*",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return `Error: HTTP ${res.status} ${res.statusText}`;
    }

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();

    let content: string;

    if (contentType.includes("text/html")) {
      content = raw
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();
    } else {
      content = raw.trim();
    }

    const limit = max_length ?? MAX_CONTENT_LENGTH;
    if (content.length > limit) {
      content = content.slice(0, limit) + `\n\n--- TRUNCATED (${content.length} chars total, showing first ${limit}) ---`;
    }

    return content;
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

export const webFetchTool: ToolDefinition = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch the contents of a URL and return it as text. HTML pages are automatically converted to plain text. Use this to read web pages, API responses, documentation, etc.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch (must be a fully-formed URL including https://)",
        },
        max_length: {
          type: ["number", "null"],
          description:
            "Maximum number of characters to return. Null for the default limit (50000). Use a smaller value for large pages when you only need the beginning.",
        },
      },
      required: ["url", "max_length"],
      additionalProperties: false,
    },
  },
};
