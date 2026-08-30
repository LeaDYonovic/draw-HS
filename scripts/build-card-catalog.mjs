import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TYPE_NAMES = new Map([
  [3, "HERO"],
  [4, "MINION"],
  [5, "SPELL"],
  [7, "WEAPON"],
  [39, "LOCATION"],
]);
const ALLOWED_TYPES = new Set(["HERO", "MINION", "SPELL", "WEAPON", "LOCATION"]);
const RARITY_NAMES = new Map([
  ["免费", "FREE"],
  ["普通", "COMMON"],
  ["稀有", "RARE"],
  ["史诗", "EPIC"],
  ["传说", "LEGENDARY"],
]);
const ALLOWED_RARITIES = new Set(["FREE", "COMMON", "RARE", "EPIC", "LEGENDARY"]);
const IMAGE_SOURCE = process.env.HEARTHSTONE_IMAGE_SOURCE ||
  "https://art.hearthstonejson.com/v1/render/latest/zhCN/256x";
const IMAGE_CONCURRENCY = Math.max(
  1,
  Math.min(16, Number(process.env.HEARTHSTONE_IMAGE_CONCURRENCY) || 8),
);
const refreshIdsFile = process.env.HEARTHSTONE_REFRESH_IDS_FILE;
const forcedRefreshIds = refreshIdsFile && fs.existsSync(refreshIdsFile)
  ? new Set(
      fs.readFileSync(refreshIdsFile, "utf8")
        .split(/\r?\n/u)
        .map((id) => id.trim())
        .filter(Boolean),
    )
  : new Set();

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(process.argv[2] || process.env.HEARTHSTONE_CARDS_JSON || "");
const outputPath = path.resolve(
  process.argv[3] || path.join(rootDir, "collectible_cards_zhCN.full.json"),
);
const imageOutputDirs = process.argv.slice(4).map((directory) => path.resolve(directory));
const sourceImageDir = path.join(path.dirname(sourcePath), "normal");

if (!process.argv[2] && !process.env.HEARTHSTONE_CARDS_JSON) {
  console.error(
    "用法: node scripts/build-card-catalog.mjs <卡牌 JSON> [输出 JSON] [图片输出目录...]",
  );
  process.exit(1);
}

const previousCards = fs.existsSync(outputPath)
  ? JSON.parse(fs.readFileSync(outputPath, "utf8"))
  : [];
const previousByName = new Map(previousCards.map((card) => [card.name, card]));
const sourceCards = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
if (!Array.isArray(sourceCards)) throw new Error("源文件不是卡牌数组");
const sourceFormat = Array.isArray(sourceCards[0]?.names)
  ? "bugstone"
  : "hearthstonejson";

function localizedValue(entries, field) {
  return entries?.find((entry) => entry.locale === "zhCN")?.[field]?.trim() ?? "";
}

function tagValue(card, tagName) {
  const value = card.tags?.find((tag) => tag.name === tagName)?.pivot?.game_tag_value;
  return Number.isFinite(value) ? value : null;
}

function validCardIdentity({ collectible, id, name, rarity, type }) {
  return collectible &&
    Boolean(name) &&
    ALLOWED_TYPES.has(type) &&
    ALLOWED_RARITIES.has(rarity) &&
    !(type === "HERO" && rarity === "FREE") &&
    /^[A-Z0-9_-]+$/iu.test(id);
}

function normalizeBugstoneCard(card) {
  const normalized = {
    _hasSourceImage: Number.isFinite(card.dbfid) &&
      fs.existsSync(path.join(sourceImageDir, `${card.dbfid}.png`)),
    artist: String(card.artist_name ?? "").trim(),
    attack: tagValue(card, "ATK"),
    cardClass: card.card_classes?.[0]?.name ?? "",
    collectible: card.collectible === 1 && card.tech_level === 0,
    cost: Number.isFinite(card.cost) ? card.cost : null,
    dbfId: Number.isFinite(card.dbfid) ? card.dbfid : null,
    health: tagValue(card, "HEALTH"),
    id: String(card.card_id ?? "").trim(),
    name: localizedValue(card.names, "name"),
    rarity: RARITY_NAMES.get(card.card_rarities?.[0]?.name ?? "") ?? "",
    set: card.card_sets?.[0]?.name ?? "",
    text: localizedValue(card.texts, "plain_text"),
    type: TYPE_NAMES.get(card.card_type) ?? "",
  };
  return validCardIdentity(normalized) ? normalized : null;
}

function normalizeHearthstoneJsonCard(card) {
  const normalized = {
    _hasSourceImage: false,
    artist: String(card.artist ?? "").trim(),
    attack: Number.isFinite(card.attack) ? card.attack : null,
    cardClass: String(card.cardClass ?? ""),
    collectible: card.collectible === true && card.set !== "HERO_SKINS",
    cost: Number.isFinite(card.cost) ? card.cost : null,
    dbfId: Number.isFinite(card.dbfId) ? card.dbfId : null,
    health: Number.isFinite(card.health) ? card.health : null,
    id: String(card.id ?? "").trim(),
    name: String(card.name ?? "").trim(),
    rarity: String(card.rarity ?? ""),
    set: String(card.set ?? ""),
    text: String(card.text ?? "").trim(),
    type: String(card.type ?? ""),
  };
  return validCardIdentity(normalized) ? normalized : null;
}

function cardPriority(card) {
  if (sourceFormat === "bugstone") {
    return (card._hasSourceImage ? 100 : 0) +
      (!card.set.includes("失效") ? 20 : 0) +
      (card.set !== "UNKNOWN" ? 10 : 0);
  }
  if (card.set === "CORE_HIDDEN") return 50;
  if (card.id.startsWith("CORE_")) return 40;
  if (card.set === "VANILLA" || card.id.startsWith("VAN_")) return 10;
  if (card.set === "LEGACY" || card.id.startsWith("LEG_")) return 20;
  return 30;
}

const normalizeCard = sourceFormat === "bugstone"
  ? normalizeBugstoneCard
  : normalizeHearthstoneJsonCard;
const cardsByName = new Map();
for (const sourceCard of sourceCards) {
  const card = normalizeCard(sourceCard);
  if (!card) continue;
  const current = cardsByName.get(card.name);
  const currentIsPrevious = previousByName.get(card.name)?.id === current?.id;
  const candidateIsPrevious = previousByName.get(card.name)?.id === card.id;
  if (
    !current ||
    cardPriority(card) > cardPriority(current) ||
    (cardPriority(card) === cardPriority(current) && candidateIsPrevious && !currentIsPrevious)
  ) {
    cardsByName.set(card.name, card);
  }
}

const cards = [...cardsByName.values()]
  .map(({ _hasSourceImage, ...card }) => card)
  .sort((first, second) => first.name.localeCompare(second.name, "zh-CN"));

function comparableText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, "")
    .replace(/[$#]/gu, "")
    .replace(/\s+/gu, "")
    .replace(/[（）()]/gu, "");
}

function renderChanged(previous, current) {
  if (!previous || previous.id !== current.id) return true;
  return previous.cost !== current.cost ||
    previous.attack !== current.attack ||
    previous.health !== current.health ||
    comparableText(previous.text) !== comparableText(current.text);
}

const refreshCardIds = new Set(forcedRefreshIds);
if (sourceFormat === "hearthstonejson") {
  for (const card of cards) {
    if (renderChanged(previousByName.get(card.name), card)) refreshCardIds.add(card.id);
  }
}
fs.writeFileSync(outputPath, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
fs.writeFileSync(
  path.join(path.dirname(outputPath), "collectible_cards_zhCN.names.txt"),
  `${cards.map((card) => card.name).join("\n")}\n`,
  "utf8",
);

function findImageInDirectory(directory, cardId) {
  for (const extension of [".webp", ".png"]) {
    const candidate = path.join(directory, `${cardId}${extension}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findCachedImage(cardId) {
  for (const directory of imageOutputDirs) {
    const candidate = findImageInDirectory(directory, cardId);
    if (candidate) return candidate;
  }
  return null;
}

function copyImageToOutputs(sourceImage, cardId) {
  const extension = path.extname(sourceImage).toLowerCase();
  for (const directory of imageOutputDirs) {
    if (findImageInDirectory(directory, cardId)) continue;
    fs.copyFileSync(sourceImage, path.join(directory, `${cardId}${extension}`));
  }
}

async function downloadImage(card, overwrite = false) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        `${IMAGE_SOURCE}/${encodeURIComponent(card.id)}.png`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!String(response.headers.get("content-type") ?? "").startsWith("image/")) {
        throw new Error("响应不是图片");
      }
      const image = Buffer.from(await response.arrayBuffer());
      if (image.length < 1_000 || image.length > 4_000_000) {
        throw new Error(`图片大小异常: ${image.length}`);
      }
      for (const directory of imageOutputDirs) {
        if (overwrite || !findImageInDirectory(directory, card.id)) {
          fs.writeFileSync(path.join(directory, `${card.id}.png`), image);
          const staleWebp = path.join(directory, `${card.id}.webp`);
          if (overwrite && fs.existsSync(staleWebp)) fs.unlinkSync(staleWebp);
        }
      }
      return { downloaded: true, fallback: false };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }

  const previousCard = previousByName.get(card.name);
  const fallbackImage = previousCard ? findCachedImage(previousCard.id) : null;
  if (fallbackImage) {
    copyImageToOutputs(fallbackImage, card.id);
    return { downloaded: false, fallback: true };
  }
  throw new Error(`${card.id} ${card.name}: ${lastError?.message ?? "未知错误"}`);
}

let copiedImages = 0;
let downloadedImages = 0;
let fallbackImages = 0;
const missingImages = [];
if (imageOutputDirs.length > 0) {
  for (const directory of imageOutputDirs) fs.mkdirSync(directory, { recursive: true });
  const pendingDownloads = [];
  for (const card of cards) {
    const cachedImage = findCachedImage(card.id);
    if (cachedImage && !refreshCardIds.has(card.id)) {
      copyImageToOutputs(cachedImage, card.id);
      copiedImages += 1;
      continue;
    }
    if (sourceFormat === "bugstone") {
      const sourceImage = path.join(sourceImageDir, `${card.dbfId}.png`);
      if (fs.existsSync(sourceImage)) {
        for (const directory of imageOutputDirs) {
          fs.copyFileSync(sourceImage, path.join(directory, `${card.id}.webp`));
        }
        copiedImages += 1;
        continue;
      }
    }
    pendingDownloads.push(card);
  }

  let cursor = 0;
  async function downloadWorker() {
    while (cursor < pendingDownloads.length) {
      const card = pendingDownloads[cursor];
      cursor += 1;
      try {
        const result = await downloadImage(card, refreshCardIds.has(card.id));
        if (result.downloaded) downloadedImages += 1;
        if (result.fallback) fallbackImages += 1;
      } catch (error) {
        missingImages.push(error.message);
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(IMAGE_CONCURRENCY, pendingDownloads.length) },
    () => downloadWorker(),
  ));
}

const counts = {};
for (const card of cards) counts[card.rarity] = (counts[card.rarity] ?? 0) + 1;
console.log(JSON.stringify({
  sourceFormat,
  cards: cards.length,
  counts,
  copiedImages,
  downloadedImages,
  fallbackImages,
  refreshedImages: refreshCardIds.size,
  missingImages,
}, null, 2));
