const ART_LAYOUTS = {
  MINION: { x: 0.23, y: 0.15, width: 0.54, height: 0.42, mask: "ellipse" },
  HERO: { x: 0.235, y: 0.17, width: 0.53, height: 0.39, mask: "ellipse" },
  SPELL: { x: 0.17, y: 0.17, width: 0.66, height: 0.35, mask: "rounded" },
  WEAPON: { x: 0.245, y: 0.17, width: 0.51, height: 0.36, mask: "ellipse" },
  LOCATION: { x: 0.15, y: 0.14, width: 0.70, height: 0.40, mask: "rounded" },
};
const DEFAULT_ART_LAYOUT = {
  x: 0.20,
  y: 0.16,
  width: 0.60,
  height: 0.39,
  mask: "rounded",
};
const GRID_WIDTH = 96;
const MAX_SEGMENTS = 900;
const OUTLINE_IMAGE_VERSION = "canvas-v1";

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

export function buildOutlineSegments(pixelBuffer, options = {}) {
  const { data, width, height } = pixelBuffer;
  if (!data || width < 8 || height < 8 || data.length < width * height * 4) {
    throw new Error("插画像素数据无效");
  }

  const luminance = new Float32Array(width * height);
  const visibleLuminance = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const pixelIndex = index * 4;
      const value =
        data[pixelIndex] * 0.2126 +
        data[pixelIndex + 1] * 0.7152 +
        data[pixelIndex + 2] * 0.0722;
      luminance[index] = value;
      if (
        data[pixelIndex + 3] > 32 &&
        insideArtMask(x, y, width, height, options.mask)
      ) {
        visibleLuminance.push(value);
      }
    }
  }

  const darkPoint = percentile(visibleLuminance, 0.08);
  const lightPoint = percentile(visibleLuminance, 0.92);
  const contrastRange = Math.max(24, lightPoint - darkPoint);
  for (let index = 0; index < luminance.length; index += 1) {
    luminance[index] = clamp((luminance[index] - darkPoint) * 255 / contrastRange, 0, 255);
  }

  const smoothed = blur(luminance, width, height);
  const { gradientsX, gradientsY, magnitudes } = sobel(smoothed, width, height);
  const suppressed = suppressNonMaximum(
    magnitudes,
    gradientsX,
    gradientsY,
    width,
    height,
    options.mask,
  );
  const edgeStrengths = [...suppressed].filter((value) => value > 0);
  const highThreshold = Math.max(70, percentile(edgeStrengths, 0.82));
  const accepted = connectWeakEdges(
    suppressed,
    width,
    height,
    highThreshold,
    highThreshold * 0.46,
  );
  const candidates = [];
  for (let index = 0; index < accepted.length; index += 1) {
    if (accepted[index]) candidates.push(index);
  }
  candidates.sort((first, second) => suppressed[second] - suppressed[first]);
  const selected = candidates.slice(0, options.maxSegments || MAX_SEGMENTS);
  selected.sort((first, second) => first - second);

  const canvasAspect = Math.max(0.5, Number(options.canvasAspect) || 4 / 3);
  const artAspect = width / height;
  const targetHeight = 0.78;
  const targetWidth = Math.min(0.78, targetHeight * artAspect / canvasAspect);
  const targetLeft = (1 - targetWidth) / 2;
  const targetTop = (1 - targetHeight) / 2;
  const segments = [];
  for (const index of selected) {
    const x = index % width;
    const y = Math.floor(index / width);
    const gradientX = gradientsX[index];
    const gradientY = gradientsY[index];
    const magnitude = Math.max(1, Math.hypot(gradientX, gradientY));
    const tangentX = -gradientY / magnitude * 0.8;
    const tangentY = gradientX / magnitude * 0.8;
    segments.push({
      x0: clamp(targetLeft + (x - tangentX) / width * targetWidth, 0, 1),
      y0: clamp(targetTop + (y - tangentY) / height * targetHeight, 0, 1),
      x1: clamp(targetLeft + (x + tangentX) / width * targetWidth, 0, 1),
      y1: clamp(targetTop + (y + tangentY) / height * targetHeight, 0, 1),
      color: "#26383d",
      size: 2,
      tool: "brush",
    });
  }

  return {
    segments,
    contrast: Math.round(lightPoint - darkPoint),
    threshold: Math.round(highThreshold),
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
  const cropWidth = Math.max(1, Math.round(image.naturalWidth * layout.width));
  const cropHeight = Math.max(1, Math.round(image.naturalHeight * layout.height));
  const gridHeight = Math.max(72, Math.round(GRID_WIDTH * cropHeight / cropWidth));
  const canvas = document.createElement("canvas");
  canvas.width = GRID_WIDTH;
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
  return buildOutlineSegments(
    context.getImageData(0, 0, canvas.width, canvas.height),
    { ...options, mask: layout.mask },
  );
}
