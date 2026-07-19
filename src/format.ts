import type { Decision } from "./types.ts";

export function compactJson(value: unknown, limit = 1_200): string {
  let raw: string;
  try {
    raw = JSON.stringify(value, null, 2);
  } catch {
    raw = String(value);
  }
  return raw.length <= limit ? raw : `${raw.slice(0, limit - 3)}...`;
}

export function confirmationMessage(toolName: string, input: unknown, decision: Decision): string {
  return [
    `${decision.reason} (${decision.category}; ${decision.source})`,
    "",
    `Tool: ${toolName}`,
    compactJson(input),
  ].join("\n");
}
