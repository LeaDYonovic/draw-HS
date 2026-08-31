export interface ProgressiveDrawingPhase {
  batchSize: number;
  durationMs: number;
  intervalMs: number;
  startDelayMs: number;
}

export interface ProgressiveDrawingPlan {
  outline: ProgressiveDrawingPhase;
  coloring: ProgressiveDrawingPhase;
  finishing: ProgressiveDrawingPhase;
  totalDurationMs: number;
}

export function getProgressiveDrawingPlan(
  durationMs: number,
  segmentCounts?: {
    outline?: number;
    coloring?: number;
    finishing?: number;
  },
): ProgressiveDrawingPlan;
