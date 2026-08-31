import test from "node:test";
import assert from "node:assert/strict";
import pngjs from "pngjs";
import {
  buildBotDrawingFromPng,
  buildBotOutlineFromPng,
  buildBotTypeSketch,
} from "../server/bot-drawing.mjs";

const { PNG } = pngjs;

function assertSegments(segments, minimum) {
  assert.ok(segments.length >= minimum);
  for (const segment of segments) {
    assert.equal(segment.tool, "brush");
    assert.ok(segment.size > 0 && segment.size <= 40);
    assert.match(segment.color, /^#[0-9a-f]{6}$/iu);
    assert.ok(
      [segment.x0, segment.y0, segment.x1, segment.y1].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ),
    );
  }
}

test("builds a non-empty immediate sketch for every card type", () => {
  for (const type of ["MINION", "SPELL", "WEAPON", "HERO", "LOCATION"]) {
    const segments = buildBotTypeSketch({
      id: `TEST_${type}`,
      name: `测试${type}`,
      type,
      cardClass: "MAGE",
    });
    assertSegments(segments, 16);
  }
});

test("extracts smooth outlines and rich color painting from a rendered PNG card", () => {
  const image = new PNG({ width: 256, height: 384 });
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const stripe = (x + y) % 29 < 14;
      const insideArt = x > 50 && x < 206 && y > 38 && y < 180;
      const value = insideArt ? (stripe ? 30 : 220) : 245;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }

  const drawing = buildBotDrawingFromPng(
    PNG.sync.write(image),
    { type: "MINION" },
    { maxOutlineSegments: 180, maxShadingSegments: 70, maxFinishingSegments: 40 },
  );
  assertSegments(drawing.outline, 40);
  assertSegments(drawing.shading, 30);
  assert.ok(drawing.outline.length <= 180);
  assert.ok(drawing.shading.length <= 70);
  assertSegments(drawing.finishing, 40);
  assert.deepEqual(
    drawing.segments,
    [...drawing.outline, ...drawing.shading, ...drawing.finishing],
  );
  const joinedSegments = drawing.outline.slice(1).filter((segment, index) => {
    const previous = drawing.outline[index];
    return Math.hypot(previous.x1 - segment.x0, previous.y1 - segment.y0) < 1e-9;
  });
  assert.ok(joinedSegments.length > drawing.outline.length * 0.45);

  const legacyOutline = buildBotOutlineFromPng(
    PNG.sync.write(image),
    { type: "MINION" },
    { maxSegments: 180 },
  );
  assert.deepEqual(legacyOutline, drawing.outline);
});

test("uses a higher-resolution color grid for AI drawing by default", () => {
  const image = new PNG({ width: 256, height: 384 });
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      image.data[index] = x;
      image.data[index + 1] = y % 256;
      image.data[index + 2] = (x + y) % 256;
      image.data[index + 3] = 255;
    }
  }

  const drawing = buildBotDrawingFromPng(
    PNG.sync.write(image),
    { type: "MINION" },
  );
  assert.equal(drawing.coloring.length, 5_200);
  assert.ok(drawing.coloring.every(
    (segment) =>
      segment.shape === "dot" &&
      segment.x0 === segment.x1 &&
      segment.y0 === segment.y1,
  ));
  assert.ok(drawing.outline.length >= 40 && drawing.outline.length <= 2_300);
  assert.equal(drawing.finishing.length, Math.min(700, drawing.outline.length));
  assert.ok(drawing.segments.length < 15_000);
  assert.ok(new Set(drawing.coloring.map((segment) => segment.color)).size > 400);
});
