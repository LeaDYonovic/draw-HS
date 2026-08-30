export const SCORE_BANDS = [
  { stage: 0, minimum: 80, maximum: 100 },
  { stage: 1, minimum: 50, maximum: 70 },
  { stage: 2, minimum: 20, maximum: 40 },
];

function remainingRatio(remainingMs, totalMs) {
  const duration = Math.max(1, Number(totalMs) || 1);
  return Math.max(0, Math.min(1, Number(remainingMs) / duration || 0));
}

export function getHintStage(remainingMs, totalMs) {
  const ratio = remainingRatio(remainingMs, totalMs);
  if (ratio > 0.6) return 0;
  if (ratio > 0.3) return 1;
  return 2;
}

export function calculateScore(remainingMs, totalMs) {
  const ratio = remainingRatio(remainingMs, totalMs);
  if (ratio > 0.6) {
    return 80 + Math.round((ratio - 0.6) / 0.4 * 20);
  }
  if (ratio > 0.3) {
    return 50 + Math.round((ratio - 0.3) / 0.3 * 20);
  }
  return 20 + Math.round(ratio / 0.3 * 20);
}
