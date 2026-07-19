import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AutoClassifier } from "../src/classifier.ts";
import { confirmationMessage } from "../src/format.ts";
import { applyGuardMode, parseGuardCommand, shouldClassify, type GuardMode } from "../src/mode.ts";
import { projectSession } from "../src/projector.ts";
import type { Decision, ModelJudge, ToolAction } from "../src/types.ts";

interface GuardState {
  mode: GuardMode;
  consecutiveDenials: number;
  totalDenials: number;
}

const state: GuardState = { mode: "standard", consecutiveDenials: 0, totalDenials: 0 };
const MAX_CONSECUTIVE_DENIALS = 3;
const MAX_TOTAL_DENIALS = 20;

function selectedModel(ctx: ExtensionContext): ExtensionContext["model"] {
  const configured = process.env.PI_AUTO_GUARD_MODEL?.trim();
  if (!configured) return ctx.model;
  const slash = configured.indexOf("/");
  if (slash <= 0 || slash === configured.length - 1) return undefined;
  return ctx.modelRegistry.find(configured.slice(0, slash), configured.slice(slash + 1));
}

function makeJudge(ctx: ExtensionContext): ModelJudge {
  return {
    async complete(systemPrompt, userPrompt, signal) {
      const model = selectedModel(ctx);
      if (!model) throw new Error("No classifier model is selected or PI_AUTO_GUARD_MODEL is invalid");
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) throw new Error(auth.error);
      const response = await complete(
        model,
        {
          systemPrompt,
          messages: [{
            role: "user",
            content: [{ type: "text", text: userPrompt }],
            timestamp: Date.now(),
          }],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          signal,
          maxTokens: 300,
        },
      );
      if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error(response.errorMessage ?? `Classifier stopped: ${response.stopReason}`);
      }
      return response.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    },
  };
}

function recordDenial(): void {
  state.consecutiveDenials += 1;
  state.totalDenials += 1;
}

function recordAllowance(): void {
  state.consecutiveDenials = 0;
}

function thresholdReason(): string | undefined {
  if (state.consecutiveDenials >= MAX_CONSECUTIVE_DENIALS) {
    return `Auto Guard stopped after ${MAX_CONSECUTIVE_DENIALS} consecutive denied tool calls. Run /auto-guard reset after reviewing the agent's plan.`;
  }
  if (state.totalDenials >= MAX_TOTAL_DENIALS) {
    return `Auto Guard stopped after ${MAX_TOTAL_DENIALS} denied tool calls in this session. Run /auto-guard reset after reviewing the session.`;
  }
  return undefined;
}

async function decide(event: { toolName: string; input: Record<string, unknown> }, ctx: ExtensionContext): Promise<Decision> {
  const context = projectSession(ctx.sessionManager.getBranch());
  const action: ToolAction = {
    toolName: event.toolName,
    input: event.input,
    cwd: ctx.cwd,
    userMessages: context.userMessages,
    recentTools: context.recentTools,
  };
  try {
    return await new AutoClassifier(makeJudge(ctx)).classify(action, ctx.signal);
  } catch (error) {
    return {
      verdict: "ask",
      reason: `classifier unavailable: ${error instanceof Error ? error.message : String(error)}`,
      category: "classifier-failure",
      source: "fallback",
    };
  }
}

function updateStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("auto-guard", `guard ${state.mode} · ${state.totalDenials} denied`);
}

export default function autoGuard(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    state.consecutiveDenials = 0;
    state.totalDenials = 0;
    updateStatus(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!shouldClassify(state.mode)) return undefined;

    const stopped = thresholdReason();
    if (stopped) return { block: true, reason: stopped };

    const classified = await decide({
      toolName: event.toolName,
      input: event.input as Record<string, unknown>,
    }, ctx);
    const decision = applyGuardMode(classified, state.mode);

    if (decision.verdict === "allow") {
      recordAllowance();
      updateStatus(ctx);
      return undefined;
    }

    if (decision.verdict === "deny") {
      recordDenial();
      updateStatus(ctx);
      return { block: true, reason: `Auto Guard denied ${event.toolName}: ${decision.reason} [${decision.category}]` };
    }

    if (!ctx.hasUI) {
      recordDenial();
      return { block: true, reason: `Auto Guard requires confirmation but no interactive UI is available: ${decision.reason}` };
    }

    const approved = await ctx.ui.confirm(
      "Auto Guard: allow tool call?",
      confirmationMessage(event.toolName, event.input, decision),
    );
    if (!approved) {
      recordDenial();
      updateStatus(ctx);
      return { block: true, reason: `Auto Guard: blocked by user (${decision.reason})` };
    }

    recordAllowance();
    updateStatus(ctx);
    return undefined;
  });

  pi.registerCommand("auto-guard", {
    description: "Show status, select a guard mode, or reset Auto Guard",
    handler: async (args, ctx) => {
      const command = parseGuardCommand(args);
      if (command.kind === "mode") state.mode = command.mode;
      else if (command.kind === "reset") {
        state.mode = "standard";
        state.consecutiveDenials = 0;
        state.totalDenials = 0;
      } else if (command.kind === "invalid") {
        ctx.ui.notify("Usage: /auto-guard [standard|relaxed|yolo|reset]", "warning");
        return;
      }
      updateStatus(ctx);
      if (state.mode === "yolo") {
        ctx.ui.notify(
          "YOLO mode enabled: Auto Guard is bypassed; all tool calls run without classification or confirmation.",
          "warning",
        );
        return;
      }
      if (state.mode === "relaxed") {
        ctx.ui.notify(
          "Relaxed mode enabled: ask verdicts run automatically; deny verdicts require confirmation.",
          "warning",
        );
        return;
      }
      ctx.ui.notify(
        `Auto Guard standard mode; ${state.consecutiveDenials} consecutive / ${state.totalDenials} total denials`,
        "info",
      );
    },
  });
}
