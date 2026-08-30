export interface ScoreBand {
  stage: number;
  minimum: number;
  maximum: number;
}

export const SCORE_BANDS: ScoreBand[];

export function getHintStage(remainingMs: number, totalMs: number): number;

export function calculateScore(remainingMs: number, totalMs: number): number;
