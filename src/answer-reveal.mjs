export const ANSWER_OPTION_STAGE_LABELS = [
  "卡名已显示",
  "插画与基础属性已显示",
  "完整卡牌信息已显示",
];

export function normalizeAnswerOptionStage(stage) {
  const numericStage = Number(stage);
  if (!Number.isFinite(numericStage)) return 2;
  return Math.max(0, Math.min(2, Math.trunc(numericStage)));
}

export function visibleAnswerDetailRows(rows, stage) {
  const normalizedStage = normalizeAnswerOptionStage(stage);
  if (normalizedStage === 0) return [];
  if (normalizedStage === 1) return rows.slice(0, 2);
  return rows;
}

export function isAnswerFilterUnlocked(field, stage, cardType) {
  const normalizedStage = normalizeAnswerOptionStage(stage);
  if (field === "name" || field === "wordLength") return true;
  if (normalizedStage === 0) return false;
  if (field === "health" && cardType === "MINION") return normalizedStage >= 2;
  return true;
}
