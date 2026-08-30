import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAnswerOptions,
  calculateScore,
  countWordCharacters,
  getChoiceEligibleWords,
  loadCardCatalog,
  loadWordBank,
  maskWord,
  normalizeGuess,
  pickWords,
  searchCards,
} from "../server/game-utils.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("loads the supplied word bank without empty or duplicate entries", () => {
  const words = loadWordBank(
    path.join(root, "collectible_cards_zhCN.names.txt"),
  );

  assert.equal(words.length, 5993);
  assert.equal(new Set(words).size, words.length);
  assert.ok(words.includes("霜之哀伤"));
  assert.ok(words.includes("炫晶小熊"));
});

test("records the source version for the generated card catalog", () => {
  const metadata = JSON.parse(
    fs.readFileSync(
      path.join(root, "collectible_cards_zhCN.metadata.json"),
      "utf8",
    ),
  );

  assert.equal(
    metadata.sourceUrl,
    "https://api.hearthstonejson.com/v1/latest/zhCN/cards.collectible.json",
  );
  assert.ok(metadata.sourceRecords > metadata.catalogRecords);
  assert.equal(metadata.catalogRecords, 5993);
  assert.ok(Number.isFinite(Date.parse(metadata.lastModified)));
});

test("normalizes spacing and punctuation in guesses", () => {
  assert.equal(normalizeGuess(" 维克多 · 奈法里奥斯！"), "维克多奈法里奥斯");
  assert.equal(normalizeGuess("ＡＢＣ"), "abc");
});

test("masks words and keeps score inside the expected range", () => {
  assert.equal(maskWord("海 拉"), "＿    ＿");
  assert.equal(calculateScore(60_000, 60_000), 200);
  assert.equal(calculateScore(0, 60_000), 100);
});

test("picks distinct words while respecting recent exclusions", () => {
  const picked = pickWords(["甲", "乙", "丙", "丁"], 3, ["甲"]);

  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3);
  assert.ok(!picked.includes("甲"));
});

test("builds 10 shuffled answers with exactly one correct option", () => {
  const words = Array.from(
    { length: 30 },
    (_, index) => `卡牌${String(index).padStart(2, "0")}`,
  );
  const answer = "卡牌07";
  const options = buildAnswerOptions(words, answer, 10);

  assert.equal(options.length, 10);
  assert.equal(new Set(options).size, 10);
  assert.equal(options.filter((word) => word === answer).length, 1);
  assert.ok(
    options.every(
      (word) => countWordCharacters(word) === countWordCharacters(answer),
    ),
  );
});

test("only choice words with enough same-length alternatives are eligible", () => {
  const commonWords = Array.from(
    { length: 10 },
    (_, index) => `常用${String(index).padStart(2, "0")}`,
  );
  const rareWords = ["甲", "乙"];
  const eligible = getChoiceEligibleWords([...commonWords, ...rareWords], 10);

  assert.deepEqual(eligible, commonWords);
});

test("searches card JSON by name and exact combat stats without duplicate names", () => {
  const cards = loadCardCatalog(
    path.join(root, "collectible_cards_zhCN.full.json"),
  );
  const matched = searchCards(cards, {
    name: "炫晶",
    wordLength: 4,
    cost: 1,
    attack: 1,
    health: 1,
  });
  const reprints = searchCards(cards, {
    name: "大法师安东尼达斯",
    wordLength: null,
    cost: null,
    attack: null,
    health: null,
  });
  const firstLongNamePage = searchCards(cards, {
    name: "",
    wordLength: 7,
    cost: null,
    attack: null,
    health: null,
  }, 40, 0);
  const secondLongNamePage = searchCards(cards, {
    name: "",
    wordLength: 7,
    cost: null,
    attack: null,
    health: null,
  }, 40, 40);

  assert.equal(cards.length, 5993);
  assert.equal(new Set(cards.map((card) => card.name)).size, cards.length);
  const crystalspineCub = matched.results.find((card) => card.name === "炫晶小熊");
  assert.ok(crystalspineCub);
  assert.equal(crystalspineCub.id, "CATA_130");
  assert.equal(crystalspineCub.rarity, "COMMON");
  assert.equal(crystalspineCub.health, 1);
  assert.equal(crystalspineCub.wordLength, 4);
  assert.equal(crystalspineCub.imageUrl, "/api/cards/images/CATA_130.png");

  const versionedCards = loadCardCatalog(
    path.join(root, "collectible_cards_zhCN.full.json"),
    { imageVersion: "2026 latest" },
  );
  assert.equal(
    versionedCards.find((card) => card.name === "炫晶小熊").imageUrl,
    "/api/cards/images/CATA_130.png?v=2026%20latest",
  );
  assert.equal(reprints.total, 1);
  assert.equal(reprints.results.length, 1);
  assert.ok(firstLongNamePage.total > 40);
  assert.equal(firstLongNamePage.results.length, 40);
  assert.equal(secondLongNamePage.results.length, 40);
  assert.equal(
    firstLongNamePage.results.some((card) =>
      secondLongNamePage.results.some((other) => other.name === card.name)
    ),
    false,
  );
});
