import type { ToolHistoryItem } from "./types.ts";

interface ProjectedContext {
  userMessages: string[];
  recentTools: ToolHistoryItem[];
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } => Boolean(block && typeof block === "object" && (block as { type?: string }).type === "text" && typeof (block as { text?: unknown }).text === "string"))
    .map((block) => block.text)
    .join("\n");
}

function compactInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = JSON.stringify(input);
  return raw.length <= 300 ? raw : `${raw.slice(0, 297)}...`;
}

export function projectSession(entries: readonly unknown[], maxUsers = 8, maxTools = 8): ProjectedContext {
  const userMessages: string[] = [];
  const recentTools: ToolHistoryItem[] = [];
  const pendingById = new Map<string, ToolHistoryItem>();

  for (const entryValue of entries) {
    if (!entryValue || typeof entryValue !== "object") continue;
    const entry = entryValue as { type?: string; message?: Record<string, unknown> };
    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;

    if (message.role === "user") {
      const text = textContent(message.content).trim();
      if (text) userMessages.push(text.slice(0, 2_000));
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const blockValue of message.content) {
        if (!blockValue || typeof blockValue !== "object") continue;
        const block = blockValue as Record<string, unknown>;
        if (block.type !== "toolCall" || typeof block.name !== "string") continue;
        const item: ToolHistoryItem = {
          toolName: block.name,
          inputSummary: compactInput(block.arguments),
          outcome: "unknown",
        };
        recentTools.push(item);
        if (typeof block.id === "string") pendingById.set(block.id, item);
      }
      continue;
    }

    if (message.role === "toolResult") {
      const id = typeof message.toolCallId === "string" ? message.toolCallId : "";
      const item = pendingById.get(id);
      if (item) item.outcome = message.isError === true ? "error" : "success";
    }
  }

  return {
    userMessages: userMessages.slice(-maxUsers),
    recentTools: recentTools.slice(-maxTools),
  };
}
