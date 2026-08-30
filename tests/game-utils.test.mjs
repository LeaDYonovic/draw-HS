import test from "node:test";
import assert from "node:assert/strict";
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
    path.join(root, "legendary_collectible_cards_zhCN.names.txt"),
  );

  assert.equal(words.length, 997);
  assert.equal(new Set(words).size, words.length);
  assert.ok(words.includes("霜之哀伤"));
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
    path.join(root, "legendary_collectible_cards_zhCN.full.json"),
  );
  const matched = searchCards(cards, {
    name: "凋零",
    wordLength: 4,
    cost: 3,
    attack: 3,
    health: 3,
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

  assert.equal(cards.length, 997);
  assert.equal(new Set(cards.map((card) => card.name)).size, cards.length);
  const blightfang = matched.results.find((card) => card.name === "凋零毒牙");
  assert.ok(blightfang);
  assert.equal(blightfang.id, "RLK_225");
  assert.equal(blightfang.wordLength, 4);
  assert.equal(blightfang.imageUrl, "/api/cards/images/RLK_225.png");
  assert.equal(reprints.total, 1);
  assert.equal(reprints.results.length, 1);
  assert.equal(firstLongNamePage.total, 203);
  assert.equal(firstLongNamePage.results.length, 40);
  assert.equal(secondLongNamePage.results.length, 40);
  assert.equal(
    firstLongNamePage.results.some((card) =>
      secondLongNamePage.results.some((other) => other.name === card.name)
    ),
    false,
  );
});
