import type { CanvasSegment } from "./types";

export interface OutlinePixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface OutlineOptions {
  canvasAspect?: number;
  cardType?: string;
  mask?: "ellipse" | "rounded";
  maxSegments?: number;
}

export interface OutlineResult {
  segments: CanvasSegment[];
  contrast: number;
  threshold: number;
}

export interface CardArtLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  mask: "ellipse" | "rounded";
}

export function getCardArtLayout(cardType?: string): CardArtLayout;

export function buildOutlineSegments(
  pixelBuffer: OutlinePixelBuffer,
  options?: OutlineOptions,
): OutlineResult;

export function extractCardOutline(
  imageUrl: string,
  options?: OutlineOptions,
): Promise<OutlineResult>;
