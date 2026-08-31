import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { CardImage } from "./CardImage";
import type { CardPreview, ClueCardPreview, RoundClueField } from "../types";

const CANVAS_WIDTH = 825;
const CANVAS_HEIGHT = 1130;
const ASSET_ROOT = "/hearthcards/assets";

const TYPE_TEMPLATES: Record<string, string> = {
  HERO: "herocard",
  LOCATION: "location",
  MINION: "minion",
  SPELL: "spell",
  WEAPON: "weapon",
};

const CLASS_NAMES: Record<string, string> = {
  中立: "Neutral",
  亡灵骑士: "DeathKnight",
  死亡骑士: "DeathKnight",
  恶魔猎手: "DemonHunter",
  德鲁伊: "Druid",
  猎人: "Hunter",
  法师: "Mage",
  圣骑士: "Paladin",
  牧师: "Priest",
  潜行者: "Rogue",
  萨满祭司: "Shaman",
  术士: "Warlock",
  战士: "Warrior",
};

const RARITY_NAMES: Record<string, string> = {
  传说: "Legendary",
  史诗: "Epic",
  稀有: "Rare",
  普通: "Common",
  基础: "Free",
};

const BASE_LAYER_IDS = new Set([
  "dropShadow",
  "holeFix",
  "class",
  "classFrame",
  "stitch",
  "textBanner",
  "textParchment",
]);
const IDENTITY_LAYER_IDS = new Set(["legendaryDragon", "rarity", "rarityGem"]);
const DETAIL_LAYER_IDS = new Set([
  "attack",
  "attackIcon",
  "health",
  "healthIcon",
  "manaGem",
  "tribePlaque",
  "tribePlaqueDual",
]);

interface CardTemplate {
  artMasks?: ArtMask | ArtMask[];
  descriptionBoxNew?: { color?: [number, number, number]; dropX?: number; dropY?: number };
  layers?: TemplateLayer[];
  texts?: TemplateText[];
}

interface ArtMask {
  type: "ellipse" | "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TemplateLayer {
  id: string;
  type: "static" | "mapped" | "classMapping" | "dynamic";
  src?: string;
  assets?: Record<string, string>;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TemplateText {
  bindTo: string;
  renderType: "path" | "rect";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
}

interface DrawValues {
  cardClass: string;
  rarity: string;
  length: string;
  cost: string;
  attack: string;
  health: string;
  race: string;
  text: string;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
const templateCache = new Map<string, Promise<CardTemplate>>();

function visibleField(fields: RoundClueField[], key: RoundClueField["key"]) {
  const field = fields.find((candidate) => candidate.key === key);
  return field && field.source !== "hidden" && field.value !== "待揭示" ? field.value : "";
}

function firstNumber(value: string) {
  return value.match(/-?\d+/u)?.[0] ?? "";
}

function statNumber(value: string, label: "攻" | "血") {
  return value.match(new RegExp(`(-?\\d+)\\s*${label}`, "u"))?.[1] ?? "";
}

function assetUrl(source: string) {
  return `${ASSET_ROOT}/${source.split("?")[0]}`;
}

function loadImage(source: string) {
  const url = assetUrl(source);
  let pending = imageCache.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load ${url}`));
      image.src = url;
    });
    imageCache.set(url, pending);
  }
  return pending;
}

function loadTemplate(name: string) {
  let pending = templateCache.get(name);
  if (!pending) {
    pending = fetch(`/hearthcards/templates/${name}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load ${name} template`);
        return response.json() as Promise<CardTemplate>;
      });
    templateCache.set(name, pending);
  }
  return pending;
}

function layerSource(layer: TemplateLayer, values: DrawValues, stage: number) {
  if (layer.type === "static") return layer.src ?? "";
  if (layer.type === "classMapping") {
    const cardClass = stage >= 1 ? values.cardClass : "Neutral";
    return layer.assets?.[cardClass] ?? layer.assets?.Neutral ?? "";
  }
  if (layer.type === "mapped" && IDENTITY_LAYER_IDS.has(layer.id)) {
    return layer.assets?.[values.rarity] ?? "";
  }
  return "";
}

function shouldDrawLayer(layer: TemplateLayer, values: DrawValues, stage: number) {
  if (BASE_LAYER_IDS.has(layer.id)) return true;
  if (IDENTITY_LAYER_IDS.has(layer.id)) {
    if (stage < 1 || values.rarity === "Free") return false;
    return layer.id !== "legendaryDragon" || values.rarity === "Legendary";
  }
  if (stage < 2 || !DETAIL_LAYER_IDS.has(layer.id)) return false;
  if (layer.id === "attack" || layer.id === "attackIcon") return Boolean(values.attack);
  if (layer.id === "health" || layer.id === "healthIcon") return Boolean(values.health);
  if (layer.id === "tribePlaqueDual") return /[\s/]/u.test(values.race);
  if (layer.id === "tribePlaque") return Boolean(values.race) && !/[\s/]/u.test(values.race);
  return true;
}

function drawBlankArt(context: CanvasRenderingContext2D, template: CardTemplate) {
  const masks = template.artMasks
    ? Array.isArray(template.artMasks) ? template.artMasks : [template.artMasks]
    : [];
  if (masks.length === 0) return;

  context.save();
  context.beginPath();
  for (const mask of masks) {
    if (mask.type === "ellipse") {
      context.ellipse(
        mask.x + mask.width / 2,
        mask.y + mask.height / 2,
        mask.width / 2,
        mask.height / 2,
        0,
        0,
        Math.PI * 2,
      );
    } else {
      context.rect(mask.x, mask.y, mask.width, mask.height);
    }
  }
  context.clip();
  const gradient = context.createRadialGradient(390, 330, 30, 410, 360, 390);
  gradient.addColorStop(0, "#275f67");
  gradient.addColorStop(0.5, "#133e49");
  gradient.addColorStop(1, "#071f2a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.globalAlpha = 0.18;
  context.strokeStyle = "#8ac7c3";
  context.lineWidth = 5;
  for (let x = -500; x < 1000; x += 36) {
    context.beginPath();
    context.moveTo(x, 80);
    context.lineTo(x + 620, 720);
    context.stroke();
  }
  context.restore();
}

function fitFontSize(context: CanvasRenderingContext2D, text: string, maxWidth: number, preferred: number) {
  let size = preferred;
  context.font = `900 ${size}px "Microsoft YaHei", sans-serif`;
  while (size > 22 && context.measureText(text).width > maxWidth) {
    size -= 2;
    context.font = `900 ${size}px "Microsoft YaHei", sans-serif`;
  }
  return size;
}

function drawOutlinedText(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  maxWidth: number,
  preferredSize: number,
  fill = "#fff",
) {
  context.save();
  context.textAlign = "center";
  context.textBaseline = "middle";
  const size = fitFontSize(context, text, maxWidth, preferredSize);
  context.font = `900 ${size}px "Microsoft YaHei", sans-serif`;
  context.lineJoin = "round";
  context.strokeStyle = "#16110c";
  context.lineWidth = Math.max(5, size * 0.12);
  context.strokeText(text, centerX, centerY, maxWidth);
  context.fillStyle = fill;
  context.fillText(text, centerX, centerY, maxWidth);
  context.restore();
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const characters = [...text];
  const lines: string[] = [];
  let current = "";
  let consumed = 0;
  for (const character of characters) {
    const next = current + character;
    if (current && context.measureText(next).width > maxWidth) {
      lines.push(current);
      consumed += current.length;
      current = character;
      if (lines.length === maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current) {
    consumed += current.length;
    lines.push(consumed < characters.length ? `${current.slice(0, -1)}…` : current);
  }
  return lines;
}

function drawDescription(context: CanvasRenderingContext2D, template: CardTemplate, text: string) {
  if (!text) return;
  const x = template.descriptionBoxNew?.dropX ?? 168;
  const y = template.descriptionBoxNew?.dropY ?? 781;
  const width = 490;
  let fontSize = 35;
  let lines: string[] = [];
  do {
    context.font = `700 ${fontSize}px "Microsoft YaHei", sans-serif`;
    lines = wrapLines(context, text, width, 5);
    if (lines.join("").replace("…", "").length >= text.length || fontSize <= 24) break;
    fontSize -= 2;
  } while (fontSize >= 24);

  context.save();
  context.font = `700 ${fontSize}px "Microsoft YaHei", sans-serif`;
  const [red, green, blue] = template.descriptionBoxNew?.color ?? [30, 23, 16];
  context.fillStyle = `rgb(${red} ${green} ${blue})`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lineHeight = fontSize * 1.28;
  const firstY = y + 96 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, x + width / 2, firstY + index * lineHeight, width));
  context.restore();
}

function drawBoundText(
  context: CanvasRenderingContext2D,
  template: CardTemplate,
  bindTo: string,
  value: string,
) {
  if (!value) return;
  const spec = template.texts?.find((item) => item.bindTo === bindTo && item.renderType === "rect");
  if (!spec || spec.x == null || spec.y == null || spec.width == null || spec.height == null) return;
  drawOutlinedText(
    context,
    value,
    spec.x + spec.width / 2,
    spec.y + spec.height / 2,
    spec.width * 0.7,
    Math.min(spec.fontSize ?? 100, 150),
  );
}

function drawCardText(context: CanvasRenderingContext2D, template: CardTemplate, values: DrawValues, stage: number) {
  const titleBanner = template.layers?.find((layer) => layer.id === "textBanner");
  if (titleBanner) {
    drawOutlinedText(
      context,
      values.length || "卡名待揭晓",
      titleBanner.x + titleBanner.width / 2,
      titleBanner.y + titleBanner.height * 0.54,
      titleBanner.width * 0.62,
      48,
    );
  }
  if (stage < 2) return;
  drawBoundText(context, template, "Cost.Value", values.cost);
  drawBoundText(context, template, "Attack", values.attack);
  drawBoundText(context, template, "Health", values.health);
  drawDescription(context, template, values.text);
  if (values.race) drawBoundText(context, template, "Tribe", values.race.replaceAll(" / ", " "));
}

async function renderCard(
  canvas: HTMLCanvasElement,
  templateName: string,
  values: DrawValues,
  stage: number,
  shouldCommit: () => boolean,
) {
  const template = await loadTemplate(templateName);
  const buffer = document.createElement("canvas");
  buffer.width = CANVAS_WIDTH;
  buffer.height = CANVAS_HEIGHT;
  const context = buffer.getContext("2d");
  if (!context) return;
  drawBlankArt(context, template);

  const layers = (template.layers ?? [])
    .filter((layer) => shouldDrawLayer(layer, values, stage))
    .map((layer) => ({ layer, source: layerSource(layer, values, stage) }))
    .filter((item) => item.source);
  const images = await Promise.all(layers.map(async ({ source }) => {
    try {
      return await loadImage(source);
    } catch (error) {
      console.warn(error);
      return null;
    }
  }));
  layers.forEach(({ layer }, index) => {
    const image = images[index];
    if (image) context.drawImage(image, layer.x, layer.y, layer.width, layer.height);
  });
  drawCardText(context, template, values, stage);

  if (shouldCommit()) {
    const target = canvas.getContext("2d");
    target?.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    target?.drawImage(buffer, 0, 0);
  }
}

export function ClueCardWidget({
  card,
  className = "",
  fields,
  fullCard,
  revealed = false,
  stage,
  style,
}: {
  card: ClueCardPreview;
  className?: string;
  fields: RoundClueField[];
  fullCard?: Pick<CardPreview, "imageUrl" | "name">;
  revealed?: boolean;
  stage: number;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const templateName = TYPE_TEMPLATES[card.type] ?? "minion";
  const classValue = visibleField(fields, "class");
  const rarityValue = visibleField(fields, "rarity");
  const stats = visibleField(fields, "stats");
  const values: DrawValues = {
    cardClass: CLASS_NAMES[classValue] ?? "Neutral",
    rarity: RARITY_NAMES[rarityValue] ?? "Free",
    length: visibleField(fields, "length"),
    cost: firstNumber(visibleField(fields, "cost")),
    attack: card.type === "MINION" ? statNumber(stats, "攻") : "",
    health: card.type === "MINION" ? statNumber(stats, "血") : firstNumber(stats),
    race: visibleField(fields, "race").replace("无种族", ""),
    text: visibleField(fields, "text").replace("无卡牌描述", ""),
  };

  useEffect(() => {
    if (revealed || !canvasRef.current) return;
    let active = true;
    void renderCard(canvasRef.current, templateName, values, stage, () => active);
    return () => {
      active = false;
    };
  }, [revealed, stage, templateName, values.attack, values.cardClass, values.cost, values.health, values.length, values.race, values.rarity, values.text]);

  if (revealed && fullCard) {
    return (
      <div className={`clue-card-assembly is-revealed ${className}`.trim()} style={style}>
        <CardImage card={fullCard} className="clue-card-full-image" loading="eager" />
      </div>
    );
  }

  return (
    <div
      className={`clue-card-assembly stage-${stage} ${className}`.trim()}
      data-card-type={templateName}
      data-clue-stage={stage}
      style={style}
    >
      <canvas
        aria-label={`正在拼装的${visibleField(fields, "type") || "炉石卡牌"}线索`}
        height={CANVAS_HEIGHT}
        ref={canvasRef}
        role="img"
        width={CANVAS_WIDTH}
      />
      <div className="clue-card-build-state" aria-live="polite">
        <i /><span>{stage === 0 ? "卡框建立" : stage === 1 ? "身份揭示" : "信息完成"}</span>
      </div>
    </div>
  );
}
