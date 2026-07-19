import assert from "node:assert/strict";
import test from "node:test";
import { applyGuardMode, isGuardMode, parseGuardCommand, shouldClassify } from "../src/mode.ts";
import type { Decision } from "../src/types.ts";

function decision(verdict: Decision["verdict"], source: Decision["source"] = "policy"): Decision {
  return { verdict, source, reason: "test decision", category: "test" };
}

test("standard mode preserves all verdicts", () => {
  for (const verdict of ["allow", "ask", "deny"] as const) {
    assert.equal(applyGuardMode(decision(verdict), "standard").verdict, verdict);
  }
});

test("relaxed mode shifts ordinary safety verdicts down one level", () => {
  assert.equal(applyGuardMode(decision("allow"), "relaxed").verdict, "allow");
  assert.equal(applyGuardMode(decision("ask"), "relaxed").verdict, "allow");
  assert.equal(applyGuardMode(decision("deny"), "relaxed").verdict, "ask");
});

test("relaxed mode never relaxes classifier failures", () => {
  assert.equal(applyGuardMode(decision("ask", "fallback"), "relaxed").verdict, "ask");
  assert.equal(applyGuardMode(decision("deny", "fallback"), "relaxed").verdict, "deny");
});

test("yolo mode allows every verdict and bypasses classification", () => {
  for (const verdict of ["allow", "ask", "deny"] as const) {
    assert.equal(applyGuardMode(decision(verdict), "yolo").verdict, "allow");
  }
  assert.equal(applyGuardMode(decision("deny", "fallback"), "yolo").verdict, "allow");
  assert.equal(shouldClassify("standard"), true);
  assert.equal(shouldClassify("relaxed"), true);
  assert.equal(shouldClassify("yolo"), false);
});

test("recognizes only supported mode names", () => {
  assert.equal(isGuardMode("standard"), true);
  assert.equal(isGuardMode("relaxed"), true);
  assert.equal(isGuardMode("yolo"), true);
  assert.equal(isGuardMode("off"), false);
});

test("parses the compact auto-guard command syntax", () => {
  assert.deepEqual(parseGuardCommand(""), { kind: "status" });
  assert.deepEqual(parseGuardCommand("status"), { kind: "status" });
  assert.deepEqual(parseGuardCommand("STANDARD"), { kind: "mode", mode: "standard" });
  assert.deepEqual(parseGuardCommand(" relaxed "), { kind: "mode", mode: "relaxed" });
  assert.deepEqual(parseGuardCommand("yolo"), { kind: "mode", mode: "yolo" });
  assert.deepEqual(parseGuardCommand("reset"), { kind: "reset" });
});

test("rejects legacy, unknown, and multi-argument commands", () => {
  assert.deepEqual(parseGuardCommand("on"), { kind: "invalid" });
  assert.deepEqual(parseGuardCommand("off"), { kind: "invalid" });
  assert.deepEqual(parseGuardCommand("mode relaxed"), { kind: "invalid" });
  assert.deepEqual(parseGuardCommand("unknown"), { kind: "invalid" });
});
