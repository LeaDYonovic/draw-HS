import fs from "node:fs";

const PUNCTUATION = /[\s\p{P}\p{S}]/gu;

export function loadWordBank(filePath) {
  const words = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .map((word) => word.trim())
    .filter(Boolean);

  return [...new Set(words)];
}

export function loadCardCatalog(filePath) {
  const cards = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(cards)) return [];

  const normalizedCards = cards
    .filter((card) => card && typeof card.name === "string" && card.name.trim())
    .map((card) => {
      const id = String(card.id ?? "");
      return {
        id,
        name: card.name.trim(),
        set: typeof card.set === "string" ? card.set : "",
        rarity: typeof card.rarity === "string" ? card.rarity : "",
        cardClass: typeof card.cardClass === "string" ? card.cardClass : "",
        wordLength: countWordCharacters(card.name.trim()),
        cost: Number.isFinite(card.cost) ? card.cost : null,
        attack: Number.isFinite(card.attack) ? card.attack : null,
        health: Number.isFinite(card.health) ? card.health : null,
        type: typeof card.type === "string" ? card.type : "",
        imageUrl: id ? `/api/cards/images/${encodeURIComponent(id)}.png` : "",
      };
    });

  const canonicalCards = new Map();
  for (const card of normalizedCards) {
    const current = canonicalCards.get(card.name);
    if (!current || cardPriority(card) > cardPriority(current)) {
      canonicalCards.set(card.name, card);
    }
  }
  return [...canonicalCards.values()];
}

function cardPriority(card) {
  if (card.set === "CORE_HIDDEN") return 4;
  if (card.id.startsWith("CORE_")) return 3;
  if (card.set === "VANILLA" || card.id.startsWith("VAN_")) return 0;
  if (card.set === "LEGACY" || card.id.startsWith("LEG_")) return 1;
  return 2;
}

export function normalizeGuess(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(PUNCTUATION, "");
}

export function maskWord(word) {
  return [...word]
    .map((character) => (/\s/u.test(character) ? "  " : "＿"))
    .join(" ");
}

export function calculateScore(remainingMs, totalMs) {
  const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
  return 100 + Math.round(ratio * 100);
}

export function countWordCharacters(value) {
  return [...String(value ?? "")].length;
}

export function getChoiceEligibleWords(words, count = 20) {
  const targetCount = Math.max(1, Math.round(count));
  const groupSizes = new Map();

  for (const word of words) {
    const length = countWordCharacters(word);
    groupSizes.set(length, (groupSizes.get(length) ?? 0) + 1);
  }

  return words.filter(
    (word) => (groupSizes.get(countWordCharacters(word)) ?? 0) >= targetCount,
  );
}

export function pickWords(words, count, excluded = []) {
  const excludedSet = new Set(excluded);
  const pool = words.filter((word) => !excludedSet.has(word));
  const source = pool.length >= count ? pool : words;
  const picked = [];
  const indexes = new Set();

  while (picked.length < Math.min(count, source.length)) {
    const index = Math.floor(Math.random() * source.length);
    if (!indexes.has(index)) {
      indexes.add(index);
      picked.push(source[index]);
    }
  }

  return picked;
}

export function buildAnswerOptions(words, answer, count = 20) {
  const targetCount = Math.max(1, Math.round(count));
  const normalizedAnswer = normalizeGuess(answer);
  const answerLength = countWordCharacters(answer);
  const distractorPool = words.filter(
    (word) =>
      countWordCharacters(word) === answerLength &&
      normalizeGuess(word) !== normalizedAnswer,
  );
  const options = [
    answer,
    ...pickWords(distractorPool, targetCount - 1),
  ];

  for (let index = options.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
  }

  return options;
}

export function searchCards(cards, filters, limit = 40, offset = 0) {
  const normalizedName = normalizeGuess(filters?.name ?? "");
  const statFilters = ["cost", "attack", "health"];
  const results = [];
  const seenNames = new Set();
  let total = 0;

  for (const card of cards) {
    if (normalizedName && !normalizeGuess(card.name).includes(normalizedName)) {
      continue;
    }
    if (
      filters?.wordLength !== null &&
      filters?.wordLength !== undefined &&
      card.wordLength !== filters.wordLength
    ) {
      continue;
    }
    if (
      statFilters.some(
        (field) => filters?.[field] !== null && filters?.[field] !== undefined &&
          card[field] !== filters[field],
      )
    ) {
      continue;
    }
    if (seenNames.has(card.name)) continue;

    seenNames.add(card.name);
    total += 1;
    if (total > offset && results.length < limit) results.push(card);
  }

  return { results, total };
}
