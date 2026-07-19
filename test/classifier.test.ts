import assert from "node:assert/strict";
import test from "node:test";
import { AutoClassifier } from "../src/classifier.ts";
import type { ModelJudge, ToolAction } from "../src/types.ts";

const base: ToolAction = {
  toolName: "browser_action",
  input: { action: "click", target: "Deploy" },
  cwd: "/work/repo",
  userMessages: ["Inspect the deployment settings"],
  recentTools: [],
};

function judge(responses: string[]): ModelJudge & { calls: number; prompts: string[] } {
  return {
    calls: 0,
    prompts: [],
    async complete(_systemPrompt, userPrompt) {
      this.prompts.push(userPrompt);
      const response = responses[this.calls];
      this.calls += 1;
      return response;
    },
  };
}

test("stage one can allow an ambiguous tool", async () => {
  const model = judge(['{"screen":"safe","reason":"read-only navigation","category":"navigation"}']);
  const result = await new AutoClassifier(model).classify(base);
  assert.equal(result.verdict, "allow");
  assert.equal(model.calls, 1);
});

test("risky screen advances to stage two", async () => {
  const model = judge([
    '{"screen":"risky","reason":"deploy-like control","category":"remote"}',
    '{"verdict":"ask","reason":"could start a deployment","category":"remote-mutation"}',
  ]);
  const result = await new AutoClassifier(model).classify(base);
  assert.equal(result.verdict, "ask");
  assert.equal(model.calls, 2);
});

test("invalid model output fails closed to ask", async () => {
  const model = judge(["not json"]);
  const result = await new AutoClassifier(model).classify(base);
  assert.equal(result.verdict, "ask");
  assert.equal(result.source, "fallback");
});

test("deterministic decisions do not invoke the model", async () => {
  const model = judge([]);
  const result = await new AutoClassifier(model).classify({ ...base, toolName: "read", input: { path: "src/a.ts" } });
  assert.equal(result.verdict, "allow");
  assert.equal(model.calls, 0);
});

test("classifier projection redacts secret values", async () => {
  const model = judge(['{"screen":"safe","reason":"ok","category":"test"}']);
  await new AutoClassifier(model).classify({
    ...base,
    input: {
      action: "click",
      apiKey: "sk-super-secret-value-1234567890",
      header: "Bearer abcdefghijklmnopqrstuvwxyz",
    },
  });
  assert.equal(model.prompts[0].includes("super-secret"), false);
  assert.equal(model.prompts[0].includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(model.prompts[0].includes("<redacted>"), true);
});
