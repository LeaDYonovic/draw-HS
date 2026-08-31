const ART_LAYOUTS = {
  MINION: { x: 0.17, y: 0.08, width: 0.66, height: 0.43, mask: "ellipse" },
  HERO: { x: 0.20, y: 0.09, width: 0.60, height: 0.43, mask: "ellipse" },
  SPELL: { x: 0.17, y: 0.10, width: 0.66, height: 0.41, mask: "ellipse" },
  WEAPON: { x: 0.18, y: 0.09, width: 0.64, height: 0.42, mask: "ellipse" },
  LOCATION: { x: 0.14, y: 0.10, width: 0.72, height: 0.45, mask: "ellipse" },
};
const DEFAULT_ART_LAYOUT = {
  x: 0.17,
  y: 0.10,
  width: 0.66,
  height: 0.42,
  mask: "rounded",
};
const DETAIL_PRESETS = {
  simple: {
    gridWidth: 84,
    highQuantile: 0.84,
    minimumHighThreshold: 58,
    lowThresholdRatio: 0.48,
    minComponentSize: 7,
    maxSegments: 360,
    minPathPoints: 5,
    simplifyTolerance: 1.6,
    brushSize: 2.8,
  },
  standard: {
    gridWidth: 112,
    highQuantile: 0.76,
    minimumHighThreshold: 46,
    lowThresholdRatio: 0.42,
    minComponentSize: 4,
    maxSegments: 600,
    minPathPoints: 3,
    simplifyTolerance: 0.78,
    brushSize: 2.35,
  },
  detailed: {
    gridWidth: 144,
    highQuantile: 0.68,
    minimumHighThreshold: 36,
    lowThresholdRatio: 0.36,
    minComponentSize: 2,
    maxSegments: 1_000,
    minPathPoints: 2,
    simplifyTolerance: 0.45,
    brushSize: 2,
  },
};
const OUTLINE_IMAGE_VERSION = "canvas-v4";
const DRAWING_PALETTE = [
  [38, 56, 61, "#26383d"],
  [181, 47, 50, "#b52f32"],
  [217, 120, 45, "#d9782d"],
  [229, 184, 60, "#e5b83c"],
  [79, 143, 70, "#4f8f46"],
  [43, 115, 153, "#2b7399"],
  [104, 72, 140, "#68488c"],
  [140, 90, 60, "#8c5a3c"],
];

export function getCardArtLayout(cardType) {
  return {
    ...(ART_LAYOUTS[String(cardType ?? "").toUpperCase()] ?? DEFAULT_ART_LAYOUT),
  };
}

export function getOutlineImageUrl(imageUrl) {
  const value = String(imageUrl ?? "");
  const hashIndex = value.indexOf("#");
  const source = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
  const queryIndex = source.indexOf("?");
  const pathname = queryIndex >= 0 ? source.slice(0, queryIndex) : source;
  const parameters = new URLSearchParams(
    queryIndex >= 0 ? source.slice(queryIndex + 1) : "",
  );
  parameters.set("outline", OUTLINE_IMAGE_VERSION);
  return `${pathname}?${parameters.toString()}${hash}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function insideArtMask(x, y, width, height, mask = "ellipse") {
  if (mask === "rounded") {
    const insetX = width * 0.025;
    const insetY = height * 0.035;
    const radius = Math.min(width, height) * 0.12;
    const left = insetX;
    const right = width - insetX;
    const top = insetY;
    const bottom = height - insetY;
    const pointX = x + 0.5;
    const pointY = y + 0.5;
    if (pointX < left || pointX > right || pointY < top || pointY > bottom) return false;
    const nearestX = clamp(pointX, left + radius, right - radius);
    const nearestY = clamp(pointY, top + radius, bottom - radius);
    return Math.hypot(pointX - nearestX, pointY - nearestY) <= radius;
  }
  const normalizedX = (x + 0.5 - width / 2) / (width * 0.48);
  const normalizedY = (y + 0.5 - height / 2) / (height * 0.48);
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function blur(values, width, height) {
  const horizontal = new Float32Array(values.length);
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = values[y * width + Math.max(0, x - 1)];
      const center = values[y * width + x];
      const right = values[y * width + Math.min(width - 1, x + 1)];
      horizontal[y * width + x] = (left + center * 2 + right) / 4;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const top = horizontal[Math.max(0, y - 1) * width + x];
      const center = horizontal[y * width + x];
      const bottom = horizontal[Math.min(height - 1, y + 1) * width + x];
      output[y * width + x] = (top + center * 2 + bottom) / 4;
    }
  }
  return output;
}

function normalizeChannel(values, samples, minimumRange, minimumSignal = 0) {
  const output = new Float32Array(values.length);
  const darkPoint = percentile(samples, 0.08);
  const lightPoint = percentile(samples, 0.92);
  const observedRange = lightPoint - darkPoint;
  if (observedRange < minimumSignal) {
    return { values: output, darkPoint, lightPoint, observedRange };
  }
  const range = Math.max(minimumRange, observedRange);
  for (let index = 0; index < values.length; index += 1) {
    output[index] = clamp((values[index] - darkPoint) * 255 / range, 0, 255);
  }
  return { values: output, darkPoint, lightPoint, observedRange };
}

function sobel(values, width, height) {
  const gradientsX = new Float32Array(values.length);
  const gradientsY = new Float32Array(values.length);
  const magnitudes = new Float32Array(values.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const topLeft = values[(y - 1) * width + x - 1];
      const top = values[(y - 1) * width + x];
      const topRight = values[(y - 1) * width + x + 1];
      const left = values[y * width + x - 1];
      const right = values[y * width + x + 1];
      const bottomLeft = values[(y + 1) * width + x - 1];
      const bottom = values[(y + 1) * width + x];
      const bottomRight = values[(y + 1) * width + x + 1];
      const index = y * width + x;
      const gradientX =
        -topLeft + topRight - left * 2 + right * 2 - bottomLeft + bottomRight;
      const gradientY =
        -topLeft - top * 2 - topRight + bottomLeft + bottom * 2 + bottomRight;
      gradientsX[index] = gradientX;
      gradientsY[index] = gradientY;
      magnitudes[index] = Math.hypot(gradientX, gradientY);
    }
  }
  return { gradientsX, gradientsY, magnitudes };
}

function mergeGradientFields(fields) {
  const length = fields[0].magnitudes.length;
  const gradientsX = new Float32Array(length);
  const gradientsY = new Float32Array(length);
  const magnitudes = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    for (const field of fields) {
      const magnitude = field.magnitudes[index] * field.weight;
      if (magnitude <= magnitudes[index]) continue;
      magnitudes[index] = magnitude;
      gradientsX[index] = field.gradientsX[index] * field.weight;
      gradientsY[index] = field.gradientsY[index] * field.weight;
    }
  }
  return { gradientsX, gradientsY, magnitudes };
}

function suppressNonMaximum(
  magnitudes,
  gradientsX,
  gradientsY,
  width,
  height,
  mask,
) {
  const output = new Float32Array(magnitudes.length);
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      if (!insideArtMask(x, y, width, height, mask)) continue;
      const index = y * width + x;
      const magnitude = magnitudes[index];
      if (magnitude <= 0) continue;
      let angle = Math.atan2(gradientsY[index], gradientsX[index]) * 180 / Math.PI;
      if (angle < 0) angle += 180;
      let first;
      let second;
      if (angle < 22.5 || angle >= 157.5) {
        first = magnitudes[index - 1];
        second = magnitudes[index + 1];
      } else if (angle < 67.5) {
        first = magnitudes[index - width - 1];
        second = magnitudes[index + width + 1];
      } else if (angle < 112.5) {
        first = magnitudes[index - width];
        second = magnitudes[index + width];
      } else {
        first = magnitudes[index - width + 1];
        second = magnitudes[index + width - 1];
      }
      if (magnitude >= first && magnitude >= second) output[index] = magnitude;
    }
  }
  return output;
}

function connectWeakEdges(values, width, height, highThreshold, lowThreshold) {
  const accepted = new Uint8Array(values.length);
  const queue = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= highThreshold) {
      accepted[index] = 1;
      queue.push(index);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor];
    const x = index % width;
    const y = Math.floor(index / width);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 1 || nextX >= width - 1 || nextY < 1 || nextY >= height - 1) {
          continue;
        }
        const nextIndex = nextY * width + nextX;
        if (!accepted[nextIndex] && values[nextIndex] >= lowThreshold) {
          accepted[nextIndex] = 1;
          queue.push(nextIndex);
        }
      }
    }
  }
  return accepted;
}

function bridgeEdgeGaps(accepted, strengths, width, height, minimumStrength) {
  const bridged = accepted.slice();
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const index = y * width + x;
      if (!accepted[index]) continue;
      for (const [directionX, directionY] of directions) {
        const middle = (y + directionY) * width + x + directionX;
        const end = (y + directionY * 2) * width + x + directionX * 2;
        if (
          !accepted[middle] &&
          accepted[end] &&
          strengths[middle] >= minimumStrength
        ) {
          bridged[middle] = 1;
        }
      }
    }
  }
  return bridged;
}

function removeSmallComponents(accepted, width, height, minimumSize) {
  if (minimumSize <= 1) return accepted;
  const filtered = new Uint8Array(accepted.length);
  const visited = new Uint8Array(accepted.length);
  const queue = [];
  for (let start = 0; start < accepted.length; start += 1) {
    if (!accepted[start] || visited[start]) continue;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      const x = index % width;
      const y = Math.floor(index / width);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            continue;
          }
          const nextIndex = nextY * width + nextX;
          if (accepted[nextIndex] && !visited[nextIndex]) {
            visited[nextIndex] = 1;
            queue.push(nextIndex);
          }
        }
      }
    }
    if (queue.length >= minimumSize) {
      for (const index of queue) filtered[index] = 1;
    }
  }
  return filtered;
}

const NEIGHBOR_OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

function edgeNeighbors(index, accepted, width, height, visited) {
  const x = index % width;
  const y = Math.floor(index / width);
  const neighbors = [];
  for (const [offsetX, offsetY] of NEIGHBOR_OFFSETS) {
    const nextX = x + offsetX;
    const nextY = y + offsetY;
    if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
    const nextIndex = nextY * width + nextX;
    if (accepted[nextIndex] && (!visited || !visited[nextIndex])) {
      neighbors.push(nextIndex);
    }
  }
  return neighbors;
}

function pointLineDistance(index, start, end, width) {
  const x = index % width;
  const y = Math.floor(index / width);
  const startX = start % width;
  const startY = Math.floor(start / width);
  const endX = end % width;
  const endY = Math.floor(end / width);
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return Math.hypot(x - startX, y - startY);
  const ratio = clamp(
    ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(x - (startX + deltaX * ratio), y - (startY + deltaY * ratio));
}

function simplifyPath(points, tolerance, width) {
  if (points.length <= 2 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const ranges = [[0, points.length - 1]];
  while (ranges.length > 0) {
    const [start, end] = ranges.pop();
    let furthest = -1;
    let furthestDistance = tolerance;
    for (let index = start + 1; index < end; index += 1) {
      const distance = pointLineDistance(
        points[index],
        points[start],
        points[end],
        width,
      );
      if (distance > furthestDistance) {
        furthest = index;
        furthestDistance = distance;
      }
    }
    if (furthest >= 0) {
      keep[furthest] = 1;
      ranges.push([start, furthest], [furthest, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function resamplePath(points, maximumSegments) {
  if (points.length - 1 <= maximumSegments) return points;
  const output = [];
  for (let index = 0; index <= maximumSegments; index += 1) {
    output.push(points[Math.round(index / maximumSegments * (points.length - 1))]);
  }
  return output.filter((point, index) => index === 0 || point !== output[index - 1]);
}

function traceEdgePaths(accepted, strengths, width, height, preset) {
  const candidates = [];
  let maximumStrength = 1;
  for (let index = 0; index < accepted.length; index += 1) {
    if (!accepted[index]) continue;
    const degree = edgeNeighbors(index, accepted, width, height).length;
    candidates.push({ index, endpoint: degree <= 1 });
    maximumStrength = Math.max(maximumStrength, strengths[index]);
  }
  candidates.sort((first, second) =>
    Number(second.endpoint) - Number(first.endpoint) ||
    strengths[second.index] - strengths[first.index]
  );

  const visited = new Uint8Array(accepted.length);
  const paths = [];
  for (const candidate of candidates) {
    if (visited[candidate.index]) continue;
    const points = [];
    let previous = -1;
    let current = candidate.index;
    while (current >= 0 && !visited[current]) {
      visited[current] = 1;
      points.push(current);
      const neighbors = edgeNeighbors(current, accepted, width, height, visited);
      if (neighbors.length === 0) break;
      const currentX = current % width;
      const currentY = Math.floor(current / width);
      const previousX = previous >= 0 ? previous % width : currentX;
      const previousY = previous >= 0 ? Math.floor(previous / width) : currentY;
      const directionX = currentX - previousX;
      const directionY = currentY - previousY;
      neighbors.sort((first, second) => {
        const score = (next) => {
          const nextX = next % width;
          const nextY = Math.floor(next / width);
          const length = Math.max(1, Math.hypot(nextX - currentX, nextY - currentY));
          const continuity = previous < 0
            ? 0
            : ((nextX - currentX) * directionX + (nextY - currentY) * directionY) /
              Math.max(1, Math.hypot(directionX, directionY) * length);
          return continuity * 2 + strengths[next] / maximumStrength;
        };
        return score(second) - score(first);
      });
      previous = current;
      current = neighbors[0];
    }

    if (points.length >= 4) {
      const firstX = points[0] % width;
      const firstY = Math.floor(points[0] / width);
      const lastX = points.at(-1) % width;
      const lastY = Math.floor(points.at(-1) / width);
      if (Math.max(Math.abs(firstX - lastX), Math.abs(firstY - lastY)) <= 1) {
        points.push(points[0]);
      }
    }
    if (points.length < preset.minPathPoints) continue;

    const simplified = simplifyPath(points, preset.simplifyTolerance, width);
    if (simplified.length < 2) continue;
    let length = 0;
    let totalStrength = 0;
    let centerDistance = 0;
    let minimumX = width;
    let maximumX = 0;
    let minimumY = height;
    let maximumY = 0;
    for (let index = 0; index < simplified.length; index += 1) {
      const point = simplified[index];
      const x = point % width;
      const y = Math.floor(point / width);
      totalStrength += strengths[point];
      centerDistance += Math.hypot(x / width - 0.5, y / height - 0.5);
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y);
      maximumY = Math.max(maximumY, y);
      if (index > 0) {
        const previousPoint = simplified[index - 1];
        length += Math.hypot(
          x - previousPoint % width,
          y - Math.floor(previousPoint / width),
        );
      }
    }
    const averageStrength = totalStrength / simplified.length / maximumStrength;
    const averageCenterDistance = centerDistance / simplified.length;
    const centrality = 1.45 - Math.min(0.7, averageCenterDistance * 1.25);
    const spansCenter =
      minimumX < width * 0.52 && maximumX > width * 0.48 &&
      minimumY < height * 0.55 && maximumY > height * 0.45;
    const subjectBonus = spansCenter &&
      maximumX - minimumX >= width * 0.12 &&
      maximumY - minimumY >= height * 0.12
      ? 1.22
      : 1;
    const horizontalBackgroundPenalty =
      maximumX - minimumX > width * 0.42 &&
      maximumY - minimumY < height * 0.08
      ? 0.52
      : 1;
    paths.push({
      points: simplified,
      score:
        length * centrality * subjectBonus * horizontalBackgroundPenalty *
        (0.6 + averageStrength * 0.4),
    });
  }
  paths.sort((first, second) => second.score - first.score);

  let previousEnd = null;
  for (const path of paths) {
    if (previousEnd !== null) {
      const distance = (point) => Math.hypot(
        point % width - previousEnd % width,
        Math.floor(point / width) - Math.floor(previousEnd / width),
      );
      if (distance(path.points.at(-1)) < distance(path.points[0])) {
        path.points.reverse();
      }
    }
    previousEnd = path.points.at(-1);
  }
  return paths;
}

function drawingBounds(width, height, canvasAspect) {
  const targetHeight = 0.78;
  const targetWidth = Math.min(0.78, targetHeight * (width / height) / canvasAspect);
  return {
    height: targetHeight,
    left: (1 - targetWidth) / 2,
    top: (1 - targetHeight) / 2,
    width: targetWidth,
  };
}

function mapDrawingPoint(index, width, height, bounds) {
  return {
    x: clamp(bounds.left + (index % width) / width * bounds.width, 0, 1),
    y: clamp(
      bounds.top + Math.floor(index / width) / height * bounds.height,
      0,
      1,
    ),
  };
}

function quantizeDrawingColor(red, green, blue, colorMode) {
  if (colorMode !== "sampled") return "#26383d";
  const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  if (saturation < 28 || (luminance < 38 && saturation < 72)) return "#26383d";
  let nearest = DRAWING_PALETTE[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const color of DRAWING_PALETTE.slice(1)) {
    const distance =
      (red - color[0]) ** 2 +
      (green - color[1]) ** 2 +
      (blue - color[2]) ** 2;
    if (distance < nearestDistance) {
      nearest = color;
      nearestDistance = distance;
    }
  }
  return nearest[3];
}

function drawingColor(data, points, colorMode) {
  if (colorMode !== "sampled") return "#26383d";
  let red = 0;
  let green = 0;
  let blue = 0;
  let samples = 0;
  const step = Math.max(1, Math.floor(points.length / 12));
  for (let index = 0; index < points.length; index += step) {
    const pixel = points[index] * 4;
    red += data[pixel];
    green += data[pixel + 1];
    blue += data[pixel + 2];
    samples += 1;
  }
  return quantizeDrawingColor(
    red / samples,
    green / samples,
    blue / samples,
    colorMode,
  );
}

function ellipseFrameSegments(data, width, height, bounds, colorMode, size) {
  const sourcePoints = [];
  const output = [];
  const steps = 48;
  for (let index = 0; index < steps; index += 1) {
    const angle = index / steps * Math.PI * 2;
    const sourceX = clamp(Math.round(width / 2 + Math.cos(angle) * width * 0.43), 0, width - 1);
    const sourceY = clamp(Math.round(height / 2 + Math.sin(angle) * height * 0.43), 0, height - 1);
    sourcePoints.push(sourceY * width + sourceX);
  }
  const color = drawingColor(data, sourcePoints, colorMode);
  for (let index = 0; index < steps; index += 1) {
    const startAngle = index / steps * Math.PI * 2;
    const endAngle = (index + 1) / steps * Math.PI * 2;
    output.push({
      x0: bounds.left + (0.5 + Math.cos(startAngle) * 0.49) * bounds.width,
      y0: bounds.top + (0.5 + Math.sin(startAngle) * 0.49) * bounds.height,
      x1: bounds.left + (0.5 + Math.cos(endAngle) * 0.49) * bounds.width,
      y1: bounds.top + (0.5 + Math.sin(endAngle) * 0.49) * bounds.height,
      color,
      size: Math.max(2.4, size),
      tool: "brush",
    });
  }
  return output;
}

function getDetailPreset(detail) {
  return DETAIL_PRESETS[detail] ?? DETAIL_PRESETS.standard;
}

export function buildOutlineSegments(pixelBuffer, options = {}) {
  const { data, width, height } = pixelBuffer;
  if (!data || width < 8 || height < 8 || data.length < width * height * 4) {
    throw new Error("插画像素数据无效");
  }

  const preset = getDetailPreset(options.detail);
  const luminance = new Float32Array(width * height);
  const redOpponent = new Float32Array(width * height);
  const blueOpponent = new Float32Array(width * height);
  const visibleLuminance = [];
  const visibleRedOpponent = [];
  const visibleBlueOpponent = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const pixelIndex = index * 4;
      const red = data[pixelIndex];
      const green = data[pixelIndex + 1];
      const blue = data[pixelIndex + 2];
      const value = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      luminance[index] = value;
      redOpponent[index] = red - (green + blue) / 2;
      blueOpponent[index] = blue - (red + green) / 2;
      if (
        data[pixelIndex + 3] > 32 &&
        insideArtMask(x, y, width, height, options.mask)
      ) {
        visibleLuminance.push(value);
        visibleRedOpponent.push(redOpponent[index]);
        visibleBlueOpponent.push(blueOpponent[index]);
      }
    }
  }

  const normalizedLuminance = normalizeChannel(
    luminance,
    visibleLuminance,
    24,
  );
  const normalizedRed = normalizeChannel(
    redOpponent,
    visibleRedOpponent,
    52,
    10,
  );
  const normalizedBlue = normalizeChannel(
    blueOpponent,
    visibleBlueOpponent,
    52,
    10,
  );
  const fineLuminance = blur(normalizedLuminance.values, width, height);
  const coarseLuminance = blur(blur(fineLuminance, width, height), width, height);
  const gradientField = mergeGradientFields([
    { ...sobel(fineLuminance, width, height), weight: 1 },
    { ...sobel(coarseLuminance, width, height), weight: 1.35 },
    {
      ...sobel(blur(normalizedRed.values, width, height), width, height),
      weight: 0.72,
    },
    {
      ...sobel(blur(normalizedBlue.values, width, height), width, height),
      weight: 0.72,
    },
  ]);
  const suppressed = suppressNonMaximum(
    gradientField.magnitudes,
    gradientField.gradientsX,
    gradientField.gradientsY,
    width,
    height,
    options.mask,
  );
  const edgeStrengths = [...suppressed].filter((value) => value > 0);
  const highThreshold = Math.max(
    preset.minimumHighThreshold,
    percentile(edgeStrengths, preset.highQuantile),
  );
  const connected = connectWeakEdges(
    suppressed,
    width,
    height,
    highThreshold,
    highThreshold * preset.lowThresholdRatio,
  );
  const bridged = bridgeEdgeGaps(
    connected,
    gradientField.magnitudes,
    width,
    height,
    highThreshold * preset.lowThresholdRatio * 0.42,
  );
  const accepted = removeSmallComponents(
    bridged,
    width,
    height,
    preset.minComponentSize,
  );
  const canvasAspect = Math.max(0.5, Number(options.canvasAspect) || 4 / 3);
  const maximum = Math.max(1, Number(options.maxSegments) || preset.maxSegments);
  const paths = traceEdgePaths(
    accepted,
    gradientField.magnitudes,
    width,
    height,
    preset,
  );
  const bounds = drawingBounds(width, height, canvasAspect);
  const segments = options.includeFrame === false
    ? []
    : ellipseFrameSegments(
      data,
      width,
      height,
      bounds,
      options.colorMode,
      preset.brushSize,
    ).slice(0, maximum);
  const maximumPerPath = Math.max(12, Math.floor(maximum * 0.24));
  for (const path of paths) {
    if (segments.length >= maximum) break;
    const remaining = maximum - segments.length;
    const points = resamplePath(
      path.points,
      Math.min(maximumPerPath, remaining),
    );
    const color = drawingColor(data, points, options.colorMode);
    for (let index = 1; index < points.length && segments.length < maximum; index += 1) {
      const start = mapDrawingPoint(points[index - 1], width, height, bounds);
      const end = mapDrawingPoint(points[index], width, height, bounds);
      segments.push({
        x0: start.x,
        y0: start.y,
        x1: end.x,
        y1: end.y,
        color,
        size: preset.brushSize,
        tool: "brush",
      });
    }
  }

  return {
    segments,
    contrast: Math.round(normalizedLuminance.observedRange),
    paths: paths.length,
    threshold: Math.round(highThreshold),
  };
}

export function buildSandShadingSegments(pixelBuffer, options = {}) {
  const { data, width, height } = pixelBuffer;
  if (!data || width < 8 || height < 8 || data.length < width * height * 4) {
    throw new Error("插画像素数据无效");
  }
  const luminance = new Float32Array(width * height);
  const saturation = new Float32Array(width * height);
  const visible = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const pixel = index * 4;
      luminance[index] =
        data[pixel] * 0.2126 +
        data[pixel + 1] * 0.7152 +
        data[pixel + 2] * 0.0722;
      saturation[index] =
        Math.max(data[pixel], data[pixel + 1], data[pixel + 2]) -
        Math.min(data[pixel], data[pixel + 1], data[pixel + 2]);
      if (data[pixel + 3] > 32 && insideArtMask(x, y, width, height, options.mask)) {
        visible.push(luminance[index]);
      }
    }
  }
  const darkPoint = percentile(visible, 0.08);
  const lightPoint = percentile(visible, 0.92);
  const range = Math.max(24, lightPoint - darkPoint);
  const rowStep = Math.max(4, Number(options.rowStep) || 5);
  const runs = [];
  for (let y = Math.floor(rowStep / 2); y < height; y += rowStep) {
    let start = -1;
    let darkness = 0;
    let runColor = null;
    const closeRun = (end) => {
      if (start < 0 || end - start < 4) {
        start = -1;
        darkness = 0;
        runColor = null;
        return;
      }
      const averageDarkness = darkness / (end - start);
      const centerX = (start + end) / 2 / width;
      const centerY = y / height;
      const centrality = 1.15 - Math.min(0.35, Math.hypot(centerX - 0.5, centerY - 0.5) * 0.5);
      runs.push({
        color: runColor,
        darkness: averageDarkness,
        end,
        score: (end - start) * averageDarkness * centrality,
        start,
        y,
      });
      start = -1;
      darkness = 0;
      runColor = null;
    };
    for (let x = 0; x <= width; x += 1) {
      const index = y * width + Math.min(x, width - 1);
      const normalized = x < width
        ? clamp((luminance[index] - darkPoint) / range, 0, 1)
        : 1;
      const paintable =
        x < width &&
        (normalized < 0.6 || saturation[index] > 46) &&
        insideArtMask(x, y, width, height, options.mask);
      if (paintable) {
        const pixel = index * 4;
        const color = quantizeDrawingColor(
          data[pixel],
          data[pixel + 1],
          data[pixel + 2],
          options.colorMode,
        );
        const colorChanged = runColor !== null && color !== runColor;
        const runTooLong = start >= 0 && x - start >= width * 0.24;
        if ((colorChanged || runTooLong) && x - start >= 4) closeRun(x);
        if (start < 0) {
          start = x;
          runColor = color;
        }
        darkness += 1 - normalized;
      } else {
        closeRun(x);
      }
    }
  }
  runs.sort((first, second) => second.score - first.score);

  const maximum = Math.max(1, Number(options.maxSegments) || 90);
  const bounds = drawingBounds(
    width,
    height,
    Math.max(0.5, Number(options.canvasAspect) || 4 / 3),
  );
  const segments = [];
  for (const run of runs) {
    if (segments.length >= maximum) break;
    const step = Math.max(3, Math.ceil((run.end - run.start) / 12));
    const points = [];
    for (let x = run.start; x <= run.end; x += step) {
      const wave = Math.sin((x + run.y * 1.7) * 0.55) * (0.45 + run.darkness);
      const pointY = clamp(Math.round(run.y + wave), 0, height - 1);
      points.push(pointY * width + Math.min(run.end - 1, x));
    }
    if (points.at(-1) % width !== run.end - 1) {
      points.push(run.y * width + run.end - 1);
    }
    const color = run.color ?? drawingColor(data, points, options.colorMode);
    for (let index = 1; index < points.length && segments.length < maximum; index += 1) {
      const start = mapDrawingPoint(points[index - 1], width, height, bounds);
      const end = mapDrawingPoint(points[index], width, height, bounds);
      segments.push({
        x0: start.x,
        y0: start.y,
        x1: end.x,
        y1: end.y,
        color,
        size: 2.8,
        tool: "brush",
      });
    }
  }
  return segments;
}

export function buildAssistedDrawing(pixelBuffer, options = {}) {
  const outlineResult = buildOutlineSegments(pixelBuffer, {
    ...options,
    maxSegments: options.maxOutlineSegments ?? options.maxSegments,
  });
  const coloring = buildSandShadingSegments(pixelBuffer, {
    ...options,
    maxSegments: options.maxColoringSegments ?? options.maxShadingSegments ?? 170,
    rowStep: options.coloringRowStep ?? options.shadingRowStep ?? 5,
  });
  return {
    ...outlineResult,
    outline: outlineResult.segments,
    coloring,
    shading: coloring,
    segments: [...outlineResult.segments, ...coloring],
  };
}

export async function extractCardOutline(imageUrl, options = {}) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  await new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("无法读取卡牌插画")), {
      once: true,
    });
    image.src = getOutlineImageUrl(imageUrl);
  });

  const layout = getCardArtLayout(options.cardType);
  const preset = getDetailPreset(options.detail);
  const cropWidth = Math.max(1, Math.round(image.naturalWidth * layout.width));
  const cropHeight = Math.max(1, Math.round(image.naturalHeight * layout.height));
  const gridHeight = Math.max(
    64,
    Math.round(preset.gridWidth * cropHeight / cropWidth),
  );
  const canvas = document.createElement("canvas");
  canvas.width = preset.gridWidth;
  canvas.height = gridHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法分析插画");
  context.drawImage(
    image,
    Math.round(image.naturalWidth * layout.x),
    Math.round(image.naturalHeight * layout.y),
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return buildAssistedDrawing(
    context.getImageData(0, 0, canvas.width, canvas.height),
    { colorMode: "sampled", ...options, mask: layout.mask },
  );
}
