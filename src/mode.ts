import type { Decision } from "./types.ts";

export type GuardMode = "standard" | "relaxed" | "yolo";

export type GuardCommand =
  | { kind: "status" }
  | { kind: "mode"; mode: GuardMode }
  | { kind: "reset" }
  | { kind: "invalid" };

export function isGuardMode(value: string | undefined): value is GuardMode {
  return value === "standard" || value === "relaxed" || value === "yolo";
}

export function shouldClassify(mode: GuardMode): boolean {
  return mode !== "yolo";
}

export function parseGuardCommand(args: string): GuardCommand {
  const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "status")) return { kind: "status" };
  if (parts.length !== 1) return { kind: "invalid" };
  if (parts[0] === "reset") return { kind: "reset" };
  if (isGuardMode(parts[0])) return { kind: "mode", mode: parts[0] };
  return { kind: "invalid" };
}

export function applyGuardMode(decision: Decision, mode: GuardMode): Decision {
  if (mode === "standard") return decision;
  if (mode === "yolo") return decision.verdict === "allow" ? decision : { ...decision, verdict: "allow" };
  if (decision.source === "fallback") return decision;

  if (decision.verdict === "ask") return { ...decision, verdict: "allow" };
  if (decision.verdict === "deny") return { ...decision, verdict: "ask" };
  return decision;
}
