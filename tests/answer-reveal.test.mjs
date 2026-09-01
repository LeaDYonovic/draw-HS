import assert from "node:assert/strict";
import test from "node:test";

import {
  isAnswerFilterUnlocked,
  normalizeAnswerOptionStage,
  visibleAnswerDetailRows,
} from "../src/answer-reveal.mjs";

test("answer choices reveal details across the three score stages", () => {
  const rows = ["字数 4 · 随从", "费用 3 · 攻击 2", "生命 5"];

  assert.deepEqual(visibleAnswerDetailRows(rows, 0), []);
  assert.deepEqual(visibleAnswerDetailRows(rows, 1), rows.slice(0, 2));
  assert.deepEqual(visibleAnswerDetailRows(rows, 2), rows);
  assert.equal(normalizeAnswerOptionStage(undefined), 2);
});

test("answer search only exposes attributes already visible in the current stage", () => {
  assert.equal(isAnswerFilterUnlocked("name", 0, "MINION"), true);
  assert.equal(isAnswerFilterUnlocked("cost", 0, "MINION"), false);
  assert.equal(isAnswerFilterUnlocked("cost", 1, "MINION"), true);
  assert.equal(isAnswerFilterUnlocked("attack", 1, "MINION"), true);
  assert.equal(isAnswerFilterUnlocked("health", 1, "MINION"), false);
  assert.equal(isAnswerFilterUnlocked("health", 2, "MINION"), true);
  assert.equal(isAnswerFilterUnlocked("health", 1, "WEAPON"), true);
});
