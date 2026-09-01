export const ANSWER_OPTION_STAGE_LABELS: readonly string[];

export function normalizeAnswerOptionStage(stage: unknown): number;

export function visibleAnswerDetailRows(rows: string[], stage: unknown): string[];

export function isAnswerFilterUnlocked(
  field: string,
  stage: unknown,
  cardType: string,
): boolean;
