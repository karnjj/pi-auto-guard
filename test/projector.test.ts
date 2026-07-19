import assert from "node:assert/strict";
import test from "node:test";
import { projectSession } from "../src/projector.ts";

test("projects user intent and coarse tool outcomes without result bodies", () => {
  const context = projectSession([
    { type: "message", message: { role: "user", content: "Check the repository" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Sure" }, { type: "toolCall", id: "t1", name: "bash", arguments: { command: "git status" } }] } },
    { type: "message", message: { role: "toolResult", toolCallId: "t1", isError: false, content: [{ type: "text", text: "SECRET RESULT BODY" }] } },
  ]);

  assert.deepEqual(context.userMessages, ["Check the repository"]);
  assert.deepEqual(context.recentTools, [{ toolName: "bash", inputSummary: '{"command":"git status"}', outcome: "success" }]);
  assert.equal(JSON.stringify(context).includes("SECRET RESULT BODY"), false);
});
