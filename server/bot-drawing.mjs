import pngjs from "pngjs";
import {
  buildAssistedDrawing,
  getCardArtLayout,
} from "../src/outline-assist.mjs";

const { PNG } = pngjs;
const CLASS_COLORS = {
  DEATHKNIGHT: "#5d8c85",
  DEMONHUNTER: "#6f4c87",
  DRUID: "#9b6a34",
  HUNTER: "#4f8748",
  MAGE: "#397ca5",
  NEUTRAL: "#6e7777",
  PALADIN: "#d6a83d",
  PRIEST: "#d7c9a6",
  ROGUE: "#4f535c",
  SHAMAN: "#3975a5",
  WARLOCK: "#76508e",
  WARRIOR: "#a54b3f",
};
const INK = "#26383d";

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function line(x0, y0, x1, y1, color = INK, size = 3.4) {
  return {
    x0: clamp(x0),
    y0: clamp(y0),
    x1: clamp(x1),
    y1: clamp(y1),
    color,
    size,
    tool: "brush",
  };
}

function addPath(segments, points, color = INK, size = 3.4, close = false) {
  for (let index = 1; index < points.length; index += 1) {
    segments.push(line(...points[index - 1], ...points[index], color, size));
  }
  if (close && points.length > 2) {
    segments.push(line(...points.at(-1), ...points[0], color, size));
  }
}

function addEllipse(segments, centerX, centerY, radiusX, radiusY, options = {}) {
  const steps = Math.max(8, options.steps ?? 18);
  const points = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = index / steps * Math.PI * 2;
    points.push([
      centerX + Math.cos(angle) * radiusX,
      centerY + Math.sin(angle) * radiusY,
    ]);
  }
  addPath(
    segments,
    points,
    options.color ?? INK,
    options.size ?? 3.4,
    true,
  );
}

function addStar(segments, centerX, centerY, radius, color) {
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 4;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    segments.push(line(centerX - x, centerY - y, centerX + x, centerY + y, color, 2.6));
  }
}

export function buildBotTypeSketch(card) {
  const segments = [];
  const hash = hashText(`${card?.id}:${card?.name}`);
  const variation = ((hash % 17) - 8) / 400;
  const accent = CLASS_COLORS[card?.cardClass] ?? "#b56b3f";
  const centerX = 0.5 + variation;

  addEllipse(segments, 0.5, 0.5, 0.39, 0.42, {
    steps: 32,
    color: accent,
    size: 3.4,
  });

  if (card?.type === "MINION") {
    addEllipse(segments, centerX, 0.35, 0.12, 0.13, { steps: 16, color: accent, size: 4 });
    addEllipse(segments, centerX, 0.62, 0.19, 0.2, { steps: 20 });
    addPath(segments, [[centerX - 0.08, 0.27], [centerX - 0.14, 0.18], [centerX - 0.02, 0.24]], accent, 3.2);
    addPath(segments, [[centerX + 0.08, 0.27], [centerX + 0.14, 0.18], [centerX + 0.02, 0.24]], accent, 3.2);
    segments.push(line(centerX - 0.055, 0.34, centerX - 0.025, 0.34, INK, 5));
    segments.push(line(centerX + 0.025, 0.34, centerX + 0.055, 0.34, INK, 5));
    addPath(segments, [[centerX - 0.05, 0.41], [centerX, 0.43], [centerX + 0.05, 0.41]], INK, 2.8);
    addPath(segments, [[centerX - 0.15, 0.53], [centerX - 0.31, 0.66], [centerX - 0.36, 0.59]], accent, 4);
    addPath(segments, [[centerX + 0.15, 0.53], [centerX + 0.31, 0.66], [centerX + 0.36, 0.59]], accent, 4);
    addPath(segments, [[centerX - 0.08, 0.78], [centerX - 0.15, 0.9]], INK, 5);
    addPath(segments, [[centerX + 0.08, 0.78], [centerX + 0.15, 0.9]], INK, 5);
  } else if (card?.type === "HERO") {
    addEllipse(segments, centerX, 0.33, 0.115, 0.13, { steps: 16, color: accent, size: 4 });
    addPath(segments, [[centerX - 0.12, 0.48], [centerX - 0.29, 0.57], [centerX - 0.36, 0.75]], INK, 5);
    addPath(segments, [[centerX + 0.12, 0.48], [centerX + 0.29, 0.57], [centerX + 0.36, 0.75]], INK, 5);
    addPath(segments, [[centerX - 0.36, 0.75], [centerX, 0.84], [centerX + 0.36, 0.75]], accent, 5);
    addPath(segments, [[centerX - 0.1, 0.25], [centerX - 0.05, 0.14], [centerX, 0.23], [centerX + 0.06, 0.13], [centerX + 0.11, 0.25]], accent, 3.2);
    segments.push(line(centerX - 0.05, 0.33, centerX - 0.02, 0.33, INK, 5));
    segments.push(line(centerX + 0.02, 0.33, centerX + 0.05, 0.33, INK, 5));
    addEllipse(segments, centerX + 0.27, 0.67, 0.09, 0.12, { steps: 14, color: accent, size: 3 });
  } else if (card?.type === "WEAPON") {
    addPath(segments, [[0.28, 0.79], [0.67, 0.25], [0.76, 0.16], [0.73, 0.3], [0.36, 0.83]], accent, 5, true);
    addPath(segments, [[0.25, 0.72], [0.42, 0.86]], INK, 7);
    addPath(segments, [[0.25, 0.78], [0.16, 0.89], [0.21, 0.93], [0.32, 0.83]], INK, 6);
    segments.push(line(0.4, 0.72, 0.67, 0.34, "#d7cda5", 2.4));
    segments.push(line(0.46, 0.63, 0.52, 0.66, accent, 2.4));
    segments.push(line(0.51, 0.56, 0.57, 0.59, accent, 2.4));
    segments.push(line(0.56, 0.49, 0.62, 0.52, accent, 2.4));
    addStar(segments, 0.72, 0.22, 0.075, accent);
  } else if (card?.type === "LOCATION") {
    addPath(segments, [[0.11, 0.76], [0.28, 0.64], [0.41, 0.72], [0.57, 0.53], [0.77, 0.7], [0.9, 0.61]], accent, 4);
    addPath(segments, [[0.22, 0.77], [0.22, 0.46], [0.38, 0.34], [0.54, 0.47], [0.54, 0.77]], INK, 4, true);
    addPath(segments, [[0.58, 0.77], [0.58, 0.35], [0.72, 0.25], [0.83, 0.37], [0.83, 0.77]], INK, 4, true);
    addPath(segments, [[0.31, 0.77], [0.31, 0.61], [0.42, 0.61], [0.42, 0.77]], accent, 3, true);
    addEllipse(segments, 0.7, 0.5, 0.045, 0.065, { steps: 10, color: accent, size: 2.8 });
    segments.push(line(0.08, 0.78, 0.92, 0.78, INK, 4));
  } else {
    const points = [];
    for (let index = 0; index < 30; index += 1) {
      const angle = index / 29 * Math.PI * 4.5;
      const radius = 0.025 + index / 29 * 0.25;
      points.push([
        centerX + Math.cos(angle) * radius,
        0.5 + Math.sin(angle) * radius,
      ]);
    }
    addPath(segments, points, accent, 4);
    addStar(segments, centerX - 0.27, 0.32, 0.07, INK);
    addStar(segments, centerX + 0.28, 0.66, 0.09, accent);
    addPath(segments, [[0.26, 0.77], [0.39, 0.63], [0.35, 0.6], [0.49, 0.43]], INK, 4);
  }

  return segments;
}

function cropArtwork(image, layout, gridWidth = 104) {
  const cropX = Math.max(0, Math.round(image.width * layout.x));
  const cropY = Math.max(0, Math.round(image.height * layout.y));
  const cropWidth = Math.max(8, Math.min(
    image.width - cropX,
    Math.round(image.width * layout.width),
  ));
  const cropHeight = Math.max(8, Math.min(
    image.height - cropY,
    Math.round(image.height * layout.height),
  ));
  const gridHeight = Math.max(64, Math.round(gridWidth * cropHeight / cropWidth));
  const data = new Uint8ClampedArray(gridWidth * gridHeight * 4);

  for (let y = 0; y < gridHeight; y += 1) {
    const sourceY = Math.min(
      image.height - 1,
      cropY + Math.floor((y + 0.5) / gridHeight * cropHeight),
    );
    for (let x = 0; x < gridWidth; x += 1) {
      const sourceX = Math.min(
        image.width - 1,
        cropX + Math.floor((x + 0.5) / gridWidth * cropWidth),
      );
      const sourceIndex = (sourceY * image.width + sourceX) * 4;
      const targetIndex = (y * gridWidth + x) * 4;
      data[targetIndex] = image.data[sourceIndex];
      data[targetIndex + 1] = image.data[sourceIndex + 1];
      data[targetIndex + 2] = image.data[sourceIndex + 2];
      data[targetIndex + 3] = image.data[sourceIndex + 3];
    }
  }

  return { data, width: gridWidth, height: gridHeight };
}

export function buildBotDrawingFromPng(pngBuffer, card, options = {}) {
  const image = PNG.sync.read(Buffer.from(pngBuffer));
  if (
    image.width < 32 ||
    image.height < 32 ||
    image.width > 1_024 ||
    image.height > 2_048
  ) {
    throw new Error("AI 卡图尺寸异常");
  }
  const layout = getCardArtLayout(card?.type);
  const artwork = cropArtwork(image, layout, options.gridWidth ?? 112);
  return buildAssistedDrawing(artwork, {
    canvasAspect: options.canvasAspect ?? 4 / 3,
    colorMode: "sampled",
    detail: options.detail ?? "standard",
    mask: layout.mask,
    maxColoringSegments: options.maxColoringSegments ?? options.maxShadingSegments,
    maxOutlineSegments: options.maxOutlineSegments ?? options.maxSegments,
    coloringRowStep: options.coloringRowStep ?? options.shadingRowStep,
  });
}

export function buildBotOutlineFromPng(pngBuffer, card, options = {}) {
  return buildBotDrawingFromPng(pngBuffer, card, options).outline;
}
