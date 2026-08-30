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
const RARITY_NAMES = new Map([
  ["免费", "FREE"],
  ["普通", "COMMON"],
  ["稀有", "RARE"],
  ["史诗", "EPIC"],
  ["传说", "LEGENDARY"],
]);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.resolve(process.argv[2] || process.env.HEARTHSTONE_CARDS_JSON || "");
const outputPath = path.resolve(
  process.argv[3] || path.join(rootDir, "collectible_cards_zhCN.full.json"),
);
const imageOutputDir = process.argv[4] ? path.resolve(process.argv[4]) : null;
const sourceImageDir = path.join(path.dirname(sourcePath), "normal");

if (!process.argv[2] && !process.env.HEARTHSTONE_CARDS_JSON) {
  console.error(
    "用法: node scripts/build-card-catalog.mjs <cards_data.json> [输出 JSON] [图片输出目录]",
  );
  process.exit(1);
}

const sourceCards = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
if (!Array.isArray(sourceCards)) throw new Error("源文件不是卡牌数组");

function localizedValue(entries, field) {
  return entries?.find((entry) => entry.locale === "zhCN")?.[field]?.trim() ?? "";
}

function tagValue(card, tagName) {
  const value = card.tags?.find((tag) => tag.name === tagName)?.pivot?.game_tag_value;
  return Number.isFinite(value) ? value : null;
}

function normalizeCard(card) {
  const name = localizedValue(card.names, "name");
  const rarityName = card.card_rarities?.[0]?.name ?? "";
  const type = TYPE_NAMES.get(card.card_type);
  const rarity = RARITY_NAMES.get(rarityName);
  const id = String(card.card_id ?? "").trim();

  if (
    card.collectible !== 1 ||
    card.tech_level !== 0 ||
    !name ||
    !type ||
    !rarity ||
    !/^[A-Z0-9_-]+$/iu.test(id)
  ) {
    return null;
  }

  // The source marks cosmetic hero skins as collectible free HERO cards.
  if (type === "HERO" && rarity === "FREE") return null;

  return {
    _hasLocalImage: Number.isFinite(card.dbfid) &&
      fs.existsSync(path.join(sourceImageDir, `${card.dbfid}.png`)),
    artist: String(card.artist_name ?? "").trim(),
    attack: tagValue(card, "ATK"),
    cardClass: card.card_classes?.[0]?.name ?? "",
    collectible: true,
    cost: Number.isFinite(card.cost) ? card.cost : null,
    dbfId: Number.isFinite(card.dbfid) ? card.dbfid : null,
    health: tagValue(card, "HEALTH"),
    id,
    name,
    rarity,
    set: card.card_sets?.[0]?.name ?? "",
    text: localizedValue(card.texts, "plain_text"),
    type,
  };
}

function cardPriority(card) {
  return (card._hasLocalImage ? 100 : 0) +
    (!card.set.includes("失效") ? 20 : 0) +
    (card.set !== "UNKNOWN" ? 10 : 0);
}

const cardsByName = new Map();
for (const sourceCard of sourceCards) {
  const card = normalizeCard(sourceCard);
  if (!card) continue;
  const current = cardsByName.get(card.name);
  if (!current || cardPriority(card) > cardPriority(current)) {
    cardsByName.set(card.name, card);
  }
}

const cards = [...cardsByName.values()]
  .map(({ _hasLocalImage, ...card }) => card)
  .sort((first, second) => first.name.localeCompare(second.name, "zh-CN"));
fs.writeFileSync(outputPath, `${JSON.stringify(cards, null, 2)}\n`, "utf8");
fs.writeFileSync(
  path.join(path.dirname(outputPath), "collectible_cards_zhCN.names.txt"),
  `${cards.map((card) => card.name).join("\n")}\n`,
  "utf8",
);

let copiedImages = 0;
let missingImages = 0;
if (imageOutputDir) {
  fs.mkdirSync(imageOutputDir, { recursive: true });
  for (const card of cards) {
    const sourceImage = path.join(sourceImageDir, `${card.dbfId}.png`);
    if (!fs.existsSync(sourceImage)) {
      missingImages += 1;
      continue;
    }
    fs.copyFileSync(sourceImage, path.join(imageOutputDir, `${card.id}.webp`));
    copiedImages += 1;
  }
}

const counts = {};
for (const card of cards) counts[card.rarity] = (counts[card.rarity] ?? 0) + 1;
console.log(JSON.stringify({ cards: cards.length, counts, copiedImages, missingImages }, null, 2));
