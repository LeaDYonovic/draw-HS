import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssistedDrawing,
  buildOutlineSegments,
  getCardArtLayout,
  getOutlineImageUrl,
} from "../src/outline-assist.mjs";

function syntheticArtwork(width = 96, height = 108) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      const offsetX = x - width / 2;
      const offsetY = y - height / 2;
      const insideFigure =
        offsetX * offsetX / (width * 0.3) ** 2 +
        offsetY * offsetY / (height * 0.32) ** 2 < 1;
      const stripe = (x + y) % 17 < 8;
      const luminance = insideFigure ? (stripe ? 35 : 215) : 245;
      data[pixel] = luminance;
      data[pixel + 1] = luminance;
      data[pixel + 2] = luminance;
      data[pixel + 3] = 255;
    }
  }
  return { data, width, height };
}

function chromaticArtwork(width = 96, height = 108) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      const insideFigure =
        ((x - width / 2) / (width * 0.28)) ** 2 +
        ((y - height / 2) / (height * 0.3)) ** 2 < 1;
      const color = insideFigure ? [255, 0, 0] : [0, 52, 255];
      data[pixel] = color[0];
      data[pixel + 1] = color[1];
      data[pixel + 2] = color[2];
      data[pixel + 3] = 255;
    }
  }
  return { data, width, height };
}

test("extracts a bounded normalized outline from contrast data", () => {
  const result = buildOutlineSegments(syntheticArtwork(), {
    canvasAspect: 4 / 3,
    detail: "detailed",
    mask: "ellipse",
    maxSegments: 320,
  });

  assert.ok(result.segments.length >= 50);
  assert.ok(result.segments.length <= 320);
  assert.ok(result.paths >= 10);
  assert.ok(result.contrast >= 150);
  assert.ok(result.threshold > 0);
  for (const segment of result.segments) {
    assert.equal(segment.tool, "brush");
    assert.ok(segment.size === 1.45 || segment.size === 2.4);
    assert.match(segment.color, /^#[0-9a-f]{6}$/u);
    assert.ok(
      [segment.x0, segment.y0, segment.x1, segment.y1].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ),
    );
  }
  const joinedSegments = result.segments.slice(1).filter((segment, index) => {
    const previous = result.segments[index];
    return Math.hypot(previous.x1 - segment.x0, previous.y1 - segment.y0) < 1e-9;
  });
  assert.ok(joinedSegments.length > result.segments.length * 0.5);
  assert.ok(Math.abs(result.segments[0].x0 - result.segments[47].x1) < 1e-12);
  assert.ok(Math.abs(result.segments[0].y0 - result.segments[47].y1) < 1e-12);
});

test("supports detail presets, rounded masks, and malformed buffer rejection", () => {
  const simple = buildOutlineSegments(syntheticArtwork(), {
    detail: "simple",
    mask: "rounded",
  });
  const standard = buildOutlineSegments(syntheticArtwork(), {
    detail: "standard",
    mask: "rounded",
  });
  const detailed = buildOutlineSegments(syntheticArtwork(), {
    detail: "detailed",
    mask: "rounded",
  });
  assert.ok(simple.segments.length >= 20);
  assert.ok(simple.segments.length < standard.segments.length);
  assert.ok(standard.segments.length < detailed.segments.length);
  assert.equal(simple.segments[0].size, 2.5);
  assert.equal(standard.segments[0].size, 2.4);
  assert.equal(detailed.segments[0].size, 2.4);
  assert.equal(standard.segments[48].size, 1.9);
  assert.equal(detailed.segments[48].size, 1.45);
  assert.throws(
    () => buildOutlineSegments({ data: new Uint8ClampedArray(), width: 2, height: 2 }),
    /像素数据/u,
  );
});

test("keeps boundaries that differ mainly by color", () => {
  const result = buildAssistedDrawing(chromaticArtwork(), {
    colorMode: "sampled",
    detail: "standard",
    mask: "ellipse",
  });
  assert.ok(result.contrast < 8);
  assert.ok(result.segments.length >= 20);
  assert.ok(result.paths >= 1);
  assert.ok(result.outline.length >= 48);
  assert.ok(result.coloring.length > 0);
  assert.ok(result.finishing.length > 0);
  assert.deepEqual(
    result.segments,
    [...result.outline, ...result.coloring, ...result.finishing],
  );
  assert.ok(result.segments.some((segment) => segment.color !== "#26383d"));
});

test("uses a calibrated artwork crop for every supported card type", () => {
  const layouts = Object.fromEntries(
    ["MINION", "SPELL", "WEAPON", "HERO", "LOCATION"].map(
      (type) => [type, getCardArtLayout(type)],
    ),
  );

  assert.equal(layouts.MINION.mask, "ellipse");
  assert.equal(layouts.HERO.mask, "ellipse");
  assert.equal(layouts.WEAPON.mask, "ellipse");
  assert.equal(layouts.SPELL.mask, "ellipse");
  assert.equal(layouts.LOCATION.mask, "ellipse");
  assert.ok(layouts.SPELL.height < layouts.MINION.height);
  assert.ok(layouts.LOCATION.width > layouts.SPELL.width);
  for (const layout of Object.values(layouts)) {
    assert.ok(layout.x >= 0 && layout.y >= 0);
    assert.ok(layout.x + layout.width <= 1);
    assert.ok(layout.y + layout.height <= 1);
    assert.ok(layout.y + layout.height <= 0.56);
  }
});

test("uses a dedicated CORS cache key for canvas image analysis", () => {
  assert.equal(
    getOutlineImageUrl("https://assets.example.com/card.webp?v=latest"),
    "https://assets.example.com/card.webp?v=latest&outline=canvas-v5",
  );
  assert.equal(
    getOutlineImageUrl("/api/cards/images/card.png#preview"),
    "/api/cards/images/card.png?outline=canvas-v5#preview",
  );
});
