import test from "node:test";
import assert from "node:assert/strict";
import { getProgressiveDrawingPlan } from "../src/progressive-drawing.mjs";

test("uses the same paced outline, coloring, and finishing schedule", () => {
  const plan = getProgressiveDrawingPlan(60_000, {
    outline: 1_600,
    coloring: 2_600,
    finishing: 520,
  });

  assert.deepEqual(
    [plan.outline.batchSize, plan.coloring.batchSize, plan.finishing.batchSize],
    [12, 16, 10],
  );
  assert.equal(plan.outline.intervalMs, 150);
  assert.equal(plan.coloring.intervalMs, 90);
  assert.ok(plan.coloring.startDelayMs > plan.outline.durationMs);
  assert.ok(plan.finishing.startDelayMs > plan.coloring.startDelayMs);
  assert.ok(plan.totalDurationMs > 35_000 && plan.totalDurationMs < 45_000);
});

test("accelerates a late assist without collapsing into an instant draw", () => {
  const late = getProgressiveDrawingPlan(8_000, {
    outline: 300,
    coloring: 400,
    finishing: 100,
  });
  const fullRound = getProgressiveDrawingPlan(60_000, {
    outline: 300,
    coloring: 400,
    finishing: 100,
  });

  assert.equal(late.outline.intervalMs, 55);
  assert.equal(late.coloring.intervalMs, 45);
  assert.ok(late.totalDurationMs < fullRound.totalDurationMs);
  assert.ok(late.totalDurationMs > 1_000);
});
