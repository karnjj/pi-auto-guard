export type Verdict = "allow" | "ask" | "deny";

export type DecisionSource = "policy" | "classifier" | "fallback";

export interface ToolAction {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  userMessages: string[];
  recentTools: ToolHistoryItem[];
}

export interface ToolHistoryItem {
  toolName: string;
  inputSummary?: string;
  outcome?: "success" | "error" | "unknown";
}

export interface Decision {
  verdict: Verdict;
  reason: string;
  category: string;
  source: DecisionSource;
}

export interface ModelJudge {
  complete(systemPrompt: string, userPrompt: string, signal?: AbortSignal): Promise<string>;
}

export interface Classifier {
  classify(action: ToolAction, signal?: AbortSignal): Promise<Decision>;
}

export type PolicyResult = Decision | { verdict: "classify"; reason: string };
