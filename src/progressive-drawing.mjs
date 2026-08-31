function segmentDuration(segmentCount, batchSize, intervalMs) {
  return Math.ceil(Math.max(0, Number(segmentCount) || 0) / batchSize) * intervalMs;
}

export function getProgressiveDrawingPlan(durationMs, segmentCounts = {}) {
  const duration = Math.max(1_000, Number(durationMs) || 60_000);
  const outlineIntervalMs = Math.max(55, Math.min(160, duration * 0.0025));
  const coloringIntervalMs = Math.max(45, Math.min(100, duration * 0.0015));
  const finishingIntervalMs = coloringIntervalMs;
  const outlineBatchSize = Number(segmentCounts.outline) > 1_600 ? 18 : 12;
  const coloringBatchSize = Number(segmentCounts.coloring) > 2_600 ? 28 : 16;
  const finishingBatchSize = Number(segmentCounts.finishing) > 520 ? 14 : 10;
  const outlineDurationMs = segmentDuration(
    segmentCounts.outline,
    outlineBatchSize,
    outlineIntervalMs,
  );
  const coloringDurationMs = segmentDuration(
    segmentCounts.coloring,
    coloringBatchSize,
    coloringIntervalMs,
  );
  const finishingDurationMs = segmentDuration(
    segmentCounts.finishing,
    finishingBatchSize,
    finishingIntervalMs,
  );

  const outline = {
    batchSize: outlineBatchSize,
    durationMs: outlineDurationMs,
    intervalMs: outlineIntervalMs,
    startDelayMs: 40,
  };
  const coloring = {
    batchSize: coloringBatchSize,
    durationMs: coloringDurationMs,
    intervalMs: coloringIntervalMs,
    startDelayMs: outlineDurationMs + Math.min(700, duration * 0.025),
  };
  const finishing = {
    batchSize: finishingBatchSize,
    durationMs: finishingDurationMs,
    intervalMs: finishingIntervalMs,
    startDelayMs:
      outlineDurationMs + coloringDurationMs + Math.min(900, duration * 0.02),
  };

  return {
    outline,
    coloring,
    finishing,
    totalDurationMs: finishing.startDelayMs + finishing.durationMs,
  };
}
