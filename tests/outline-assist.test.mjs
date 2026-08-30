import test from "node:test";
import assert from "node:assert/strict";
import {
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

test("extracts a bounded normalized outline from contrast data", () => {
  const result = buildOutlineSegments(syntheticArtwork(), {
    canvasAspect: 4 / 3,
    detail: "detailed",
    mask: "ellipse",
    maxSegments: 320,
  });

  assert.equal(result.segments.length, 320);
  assert.ok(result.contrast >= 150);
  assert.ok(result.threshold > 0);
  for (const segment of result.segments) {
    assert.equal(segment.tool, "brush");
    assert.equal(segment.size, 1.7);
    assert.match(segment.color, /^#[0-9a-f]{6}$/u);
    assert.ok(
      [segment.x0, segment.y0, segment.x1, segment.y1].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ),
    );
  }
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
  assert.equal(simple.segments[0].size, 2.4);
  assert.equal(standard.segments[0].size, 2);
  assert.equal(detailed.segments[0].size, 1.7);
  assert.throws(
    () => buildOutlineSegments({ data: new Uint8ClampedArray(), width: 2, height: 2 }),
    /像素数据/u,
  );
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
  assert.equal(layouts.SPELL.mask, "rounded");
  assert.equal(layouts.LOCATION.mask, "rounded");
  assert.ok(layouts.SPELL.width > layouts.MINION.width);
  assert.ok(layouts.LOCATION.width > layouts.SPELL.width);
  for (const layout of Object.values(layouts)) {
    assert.ok(layout.x >= 0 && layout.y >= 0);
    assert.ok(layout.x + layout.width <= 1);
    assert.ok(layout.y + layout.height <= 1);
    assert.ok(layout.y + layout.height <= 0.55);
  }
});

test("uses a dedicated CORS cache key for canvas image analysis", () => {
  assert.equal(
    getOutlineImageUrl("https://assets.example.com/card.webp?v=latest"),
    "https://assets.example.com/card.webp?v=latest&outline=canvas-v2",
  );
  assert.equal(
    getOutlineImageUrl("/api/cards/images/card.png#preview"),
    "/api/cards/images/card.png?outline=canvas-v2#preview",
  );
});
