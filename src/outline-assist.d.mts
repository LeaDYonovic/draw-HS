import type { CanvasSegment } from "./types";

export interface OutlinePixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface OutlineOptions {
  canvasAspect?: number;
  cardType?: string;
  coloringRowStep?: number;
  colorMode?: "sampled";
  detail?: "simple" | "standard" | "detailed";
  includeFrame?: boolean;
  mask?: "ellipse" | "rounded";
  maxColoringSegments?: number;
  maxOutlineSegments?: number;
  maxSegments?: number;
}

export interface OutlineSegmentsResult {
  segments: CanvasSegment[];
  contrast: number;
  paths: number;
  threshold: number;
}

export interface OutlineResult extends OutlineSegmentsResult {
  outline: CanvasSegment[];
  coloring: CanvasSegment[];
  shading: CanvasSegment[];
}

export interface CardArtLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  mask: "ellipse" | "rounded";
}

export function getCardArtLayout(cardType?: string): CardArtLayout;

export function getOutlineImageUrl(imageUrl: string): string;

export function buildOutlineSegments(
  pixelBuffer: OutlinePixelBuffer,
  options?: OutlineOptions,
): OutlineSegmentsResult;

export function buildAssistedDrawing(
  pixelBuffer: OutlinePixelBuffer,
  options?: OutlineOptions,
): OutlineResult;

export function extractCardOutline(
  imageUrl: string,
  options?: OutlineOptions,
): Promise<OutlineResult>;
