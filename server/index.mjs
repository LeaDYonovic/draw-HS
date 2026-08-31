import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import {
  buildBotDrawingFromPng,
  buildBotTypeSketch,
} from "./bot-drawing.mjs";
import {
  SCORE_BANDS,
  buildCardAnswerOptions,
  calculateScore,
  countWordCharacters,
  getChoiceEligibleCards,
  getCardAttributeClue,
  loadCardCatalog,
  maskWord,
  normalizeGuess,
  pickWords,
  searchCards,
} from "./game-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const CHOICE_OPTION_COUNT = 10;
const TEST_BOT_NAME = "旅店老板 AI";
const AI_CHOOSE_DELAY_MS = 700;
const cardCatalogPath = path.join(
  rootDir,
  "collectible_cards_zhCN.full.json",
);
const cardCatalogMetadataPath = path.join(
  rootDir,
  "collectible_cards_zhCN.metadata.json",
);
const cardCatalogMetadata = fs.existsSync(cardCatalogMetadataPath)
  ? JSON.parse(fs.readFileSync(cardCatalogMetadataPath, "utf8"))
  : {};
const cardImageVersion = crypto
  .createHash("sha256")
  .update(String(
    cardCatalogMetadata.etag ??
    cardCatalogMetadata.lastModified ??
    cardCatalogMetadata.downloadedAt ??
    "unversioned",
  ))
  .digest("hex")
  .slice(0, 12);
const cardImageBaseUrl = String(process.env.CARD_IMAGE_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/u, "");
const cardImageExtension = String(process.env.CARD_IMAGE_EXTENSION ?? "png")
  .trim()
  .toLowerCase();
const cardCatalog = loadCardCatalog(cardCatalogPath, {
  imageBaseUrl: cardImageBaseUrl,
  imageExtension: cardImageExtension,
  imageVersion: cardImageVersion,
});
const WORD_BANK_DEFINITIONS = [
  { id: "all", label: "全部卡牌", group: "总览", matches: () => true },
  { id: "legendary", label: "传说卡牌", group: "按稀有度", matches: (card) => card.rarity === "LEGENDARY" },
  { id: "epic", label: "史诗卡牌", group: "按稀有度", matches: (card) => card.rarity === "EPIC" },
  { id: "rare", label: "稀有卡牌", group: "按稀有度", matches: (card) => card.rarity === "RARE" },
  { id: "common", label: "普通卡牌", group: "按稀有度", matches: (card) => card.rarity === "COMMON" },
  { id: "free", label: "基础免费卡", group: "按稀有度", matches: (card) => card.rarity === "FREE" },
  { id: "minion", label: "随从", group: "按类型", matches: (card) => card.type === "MINION" },
  { id: "spell", label: "法术", group: "按类型", matches: (card) => card.type === "SPELL" },
  { id: "weapon", label: "武器", group: "按类型", matches: (card) => card.type === "WEAPON" },
  { id: "hero", label: "英雄牌", group: "按类型", matches: (card) => card.type === "HERO" },
  { id: "location", label: "地标", group: "按类型", matches: (card) => card.type === "LOCATION" },
];
const TYPE_BANK_VALUES = new Map([
  ["minion", "MINION"],
  ["spell", "SPELL"],
  ["weapon", "WEAPON"],
  ["hero", "HERO"],
  ["location", "LOCATION"],
]);
const RARITY_BANK_VALUES = new Map([
  ["legendary", "LEGENDARY"],
  ["epic", "EPIC"],
  ["rare", "RARE"],
  ["common", "COMMON"],
  ["free", "FREE"],
]);
const CARD_TYPE_LABELS = {
  MINION: "随从",
  SPELL: "法术",
  WEAPON: "武器",
  HERO: "英雄牌",
  LOCATION: "地标",
};
const CARD_CLASS_LABELS = {
  DEATHKNIGHT: "死亡骑士",
  DEMONHUNTER: "恶魔猎手",
  DRUID: "德鲁伊",
  HUNTER: "猎人",
  MAGE: "法师",
  NEUTRAL: "中立",
  PALADIN: "圣骑士",
  PRIEST: "牧师",
  ROGUE: "潜行者",
  SHAMAN: "萨满祭司",
  WARLOCK: "术士",
  WARRIOR: "战士",
};
const CARD_RARITY_LABELS = {
  LEGENDARY: "传说",
  EPIC: "史诗",
  RARE: "稀有",
  COMMON: "普通",
  FREE: "基础",
};
const wordBanks = new Map(WORD_BANK_DEFINITIONS.map((definition) => {
  const cards = cardCatalog.filter(definition.matches);
  const words = cards.map((card) => card.name);
  const choiceWords = getChoiceEligibleCards(cards, CHOICE_OPTION_COUNT)
    .map((card) => card.name);
  return [definition.id, {
    id: definition.id,
    label: definition.label,
    group: definition.group,
    cards,
    words,
    choiceWords,
    names: new Set(words),
  }];
}));
const defaultWordBank = wordBanks.get("all");
const wordBankDefinitionById = new Map(
  WORD_BANK_DEFINITIONS
    .filter((definition) => definition.id !== "all")
    .map((definition) => [definition.id, definition]),
);
const compositeWordBanks = new Map();
const publicWordBankOptions = [...wordBanks.values()].map((bank) => ({
  id: bank.id,
  label: bank.label,
  group: bank.group,
  count: bank.words.length,
  choiceCount: bank.choiceWords.length,
}));
const cardIds = new Set(cardCatalog.map((card) => card.id).filter(Boolean));
const cardByName = new Map();
for (const card of cardCatalog) {
  if (!cardByName.has(card.name)) cardByName.set(card.name, card);
}
const rooms = new Map();
const onlinePlayers = new Map();
const lobbyMessages = [];
const PORT = Number(process.env.PORT) || 3000;
const CHOOSE_TIME_MS = 15_000;
const ROUND_BREAK_OVERRIDE_MS = Number(process.env.ROUND_BREAK_OVERRIDE_MS);
const ROUND_BREAK_MS = ROUND_BREAK_OVERRIDE_MS > 0
  ? Math.max(50, ROUND_BREAK_OVERRIDE_MS)
  : 5_000;
const RECONNECT_GRACE_MS = 15_000;
const ROUND_TIME_OVERRIDE_MS = Number(process.env.ROUND_TIME_OVERRIDE_MS);
const FINAL_REVEAL_OVERRIDE_MS = Number(process.env.FINAL_REVEAL_OVERRIDE_MS);
const FINAL_REVEAL_LEAD_MS = FINAL_REVEAL_OVERRIDE_MS > 0
  ? Math.max(100, FINAL_REVEAL_OVERRIDE_MS)
  : 5_000;
const CHAT_COOLDOWN_MS = 450;
const MAX_SPECTATORS = 20;
const MAX_ROOMS = Math.max(10, Number(process.env.MAX_ROOMS) || 100);
const MAX_IMAGE_FETCHES = Math.max(
  1,
  Math.min(12, Number(process.env.MAX_IMAGE_FETCHES) || 4),
);
const MAX_IMAGE_FETCH_QUEUE = Math.max(
  10,
  Math.min(500, Number(process.env.MAX_IMAGE_FETCH_QUEUE) || 100),
);
const TRUST_PROXY_HEADERS = /^(1|true|yes)$/iu.test(
  String(process.env.TRUST_PROXY_HEADERS ?? ""),
);
const TRUSTED_PROXY_ADDRESSES = new Set(
  String(process.env.TRUSTED_PROXY_ADDRESSES || "127.0.0.1,::1")
    .split(",")
    .map((address) => normalizeAddress(address))
    .filter(Boolean),
);
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/u, ""))
    .filter(Boolean),
);
if (process.env.NODE_ENV !== "production") {
  ALLOWED_ORIGINS.add("http://localhost:5173");
  ALLOWED_ORIGINS.add("http://127.0.0.1:5173");
}
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_ROOM_RULES = "轮流从三张卡牌中选题作画，其他玩家通过选择或搜索卡牌作答。";
const CARD_IMAGE_SOURCE =
  "https://art.hearthstonejson.com/v1/render/latest/zhCN/256x";
const cardImageDir = path.resolve(
  process.env.CARD_IMAGE_DIR || path.join(rootDir, "card-images"),
);
const pendingCardImages = new Map();
const botDrawingCache = new Map();
const rateWindows = new Map();
const imageFetchQueue = [];
let activeImageFetches = 0;
let lobbyEmitTimer = null;

const rateWindowCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, window] of rateWindows) {
    if (now >= window.resetAt) rateWindows.delete(key);
  }
}, 5 * 60_000);
rateWindowCleanup.unref();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  allowRequest: (request, callback) => callback(null, socketOriginAllowed(request)),
  maxHttpBufferSize: 100_000,
  pingTimeout: 20_000,
});

io.use((socket, next) => {
  if (socketAddressRateLimited(socket, "connection", 40, 60_000)) {
    next(new Error("连接过于频繁，请稍后再试"));
    return;
  }
  next();
});

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    rooms: rooms.size,
    online: onlinePlayers.size,
    words: defaultWordBank.words.length,
    cards: cardCatalog.length,
    wordBanks: wordBanks.size,
    cardDataLastModified: cardCatalogMetadata.lastModified ?? null,
    cardImageSource: cardImageBaseUrl || "local",
    cardImageExtension: ["png", "webp"].includes(cardImageExtension)
      ? cardImageExtension
      : "png",
  });
});
app.get("/api/word-bank", (_request, response) => {
  response.json({
    count: defaultWordBank.words.length,
    source: path.basename(cardCatalogPath),
    lastModified: cardCatalogMetadata.lastModified ?? null,
    options: publicWordBankOptions,
  });
});
app.get("/api/cards/search", (request, response) => {
  if (httpRateLimited(request, "card-search", 120, 60_000)) {
    response.status(429).json({ error: "检索过于频繁，请稍后再试" });
    return;
  }
  const filters = {
    name: String(request.query.name ?? "").trim().slice(0, 40),
    wordLength: parseWordLength(request.query.wordLength),
    cost: parseCardStat(request.query.cost),
    attack: parseCardStat(request.query.attack),
    health: parseCardStat(request.query.health),
    armor: parseCardStat(request.query.armor),
  };
  const page = parseSearchPage(request.query.page);
  const requestedWordBankIds = parseRequestedWordBankIds(request.query);
  const bank = requestedWordBankIds === null
    ? null
    : resolveWordBank(requestedWordBankIds);
  if (
    !bank ||
    page === undefined ||
    filters.wordLength === undefined ||
    [filters.cost, filters.attack, filters.health, filters.armor].includes(undefined)
  ) {
    response.status(400).json({ error: "卡牌属性筛选值无效" });
    return;
  }
  if (
    !filters.name &&
    filters.wordLength === null &&
    filters.cost === null &&
    filters.attack === null &&
    filters.health === null &&
    filters.armor === null
  ) {
    response.json({ results: [], total: 0, limit: 40, page: 1, pages: 0 });
    return;
  }

  response.set("Cache-Control", "no-store");
  const limit = 40;
  const result = searchCards(bank.cards, filters, limit, (page - 1) * limit);
  response.json({
    ...result,
    limit,
    page,
    pages: Math.ceil(result.total / limit),
  });
});
app.get("/api/cards/images/:fileName", async (request, response) => {
  const cardId = String(request.params.fileName ?? "").replace(/\.(?:png|webp)$/iu, "");
  if (!/^[-A-Z0-9_]+$/iu.test(cardId) || !cardIds.has(cardId)) {
    response.status(404).end();
    return;
  }

  const pngPath = path.join(cardImageDir, `${cardId}.png`);
  let imagePath = resolveCardImage(cardId) ?? pngPath;
  if (
    !fs.existsSync(imagePath) &&
    httpRateLimited(request, "card-image-fetch", 240, 60_000)
  ) {
    response.status(429).end();
    return;
  }
  try {
    await ensureCardImage(cardId, pngPath);
    imagePath = resolveCardImage(cardId) ?? pngPath;
    response.set("Cache-Control", "public, max-age=604800, immutable");
    response.type(path.extname(imagePath) === ".webp" ? "webp" : "png").sendFile(imagePath);
  } catch (error) {
    console.error(`无法载入卡牌图片 ${cardId}:`, error.message);
    response.set("Cache-Control", "no-store");
    response.status(502).end();
  }
});

const distDir = path.join(rootDir, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(path.join(distDir, "index.html"));
  });
}

function createRoomCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < 4; index += 1) {
      code += ROOM_CODE_CHARACTERS[
        crypto.randomInt(0, ROOM_CODE_CHARACTERS.length)
      ];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("暂时无法生成房间号，请稍后重试");
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 12);
}

function cleanCode(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "")
    .slice(0, 4);
}

function cleanRoomName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 24);
}

function cleanRoomRules(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 180);
}

function cleanChatText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 160);
}

function parseCardStat(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 99
    ? number
    : undefined;
}

function parseWordLength(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 40
    ? number
    : undefined;
}

function parseSearchPage(value) {
  if (value === undefined || value === null || value === "") return 1;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 100
    ? number
    : undefined;
}

function normalizeAddress(value) {
  const address = String(value ?? "").trim();
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function clientAddress(headers, fallback = "unknown") {
  const remoteAddress = normalizeAddress(fallback) || "unknown";
  if (!TRUST_PROXY_HEADERS || !TRUSTED_PROXY_ADDRESSES.has(remoteAddress)) {
    return remoteAddress;
  }

  const cloudflareAddress = headers?.["cf-connecting-ip"];
  if (typeof cloudflareAddress === "string" && cloudflareAddress.trim()) {
    return normalizeAddress(cloudflareAddress);
  }
  const forwardedAddress = headers?.["x-forwarded-for"];
  if (typeof forwardedAddress === "string" && forwardedAddress.trim()) {
    return normalizeAddress(forwardedAddress.split(",")[0]);
  }
  return remoteAddress;
}

function socketOriginAllowed(request) {
  const origin = String(request.headers.origin ?? "").trim().replace(/\/$/u, "");
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;

  try {
    const originHost = new URL(origin).host.toLowerCase();
    const requestHost = String(request.headers.host ?? "").trim().toLowerCase();
    return Boolean(requestHost) && originHost === requestHost;
  } catch {
    return false;
  }
}

function fixedWindowLimited(key, limit, windowMs) {
  const now = Date.now();
  const current = rateWindows.get(key);
  if (!current || now >= current.resetAt) {
    rateWindows.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function httpRateLimited(request, action, limit, windowMs) {
  const address = clientAddress(request.headers, request.socket.remoteAddress);
  return fixedWindowLimited(`http:${action}:${address}`, limit, windowMs);
}

function socketRateLimited(socket, action, limit, windowMs) {
  const address = clientAddress(socket.handshake.headers, socket.handshake.address);
  return fixedWindowLimited(`socket:${action}:${address}:${socket.id}`, limit, windowMs);
}

function socketAddressRateLimited(socket, action, limit, windowMs) {
  const address = clientAddress(socket.handshake.headers, socket.handshake.address);
  return fixedWindowLimited(`socket-ip:${action}:${address}`, limit, windowMs);
}

function createPlayer(
  name,
  socketId,
  { isSpectator = false, isBot = false } = {},
) {
  return {
    id: crypto.randomUUID().slice(0, 8),
    token: crypto.randomUUID(),
    name,
    socketId,
    score: 0,
    connected: true,
    left: false,
    isBot,
    isSpectator,
    joinNextRound: false,
    joinQueuedAt: null,
    disconnectTimer: null,
  };
}

function reconnectingPlayerUsesName(name, allowedPlayerId = null) {
  const normalizedName = normalizeGuess(name);
  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (
        player.id !== allowedPlayerId &&
        !player.left &&
        !player.connected &&
        !player.isBot &&
        normalizeGuess(player.name) === normalizedName
      ) {
        return true;
      }
    }
  }
  return false;
}

function registerOnlinePlayer(
  socket,
  value,
  { allowedSocketId = null, allowedPlayerId = null } = {},
) {
  const name = cleanName(value);
  if (!name) return { ok: false, error: "请先取一个昵称" };

  const duplicate = [...onlinePlayers.entries()].some(
    ([socketId, player]) =>
      socketId !== socket.id &&
      socketId !== allowedSocketId &&
      normalizeGuess(player.name) === normalizeGuess(name),
  );
  if (
    duplicate ||
    reconnectingPlayerUsesName(name, allowedPlayerId)
  ) {
    return { ok: false, error: "这个昵称已有在线玩家使用" };
  }

  const existing = onlinePlayers.get(socket.id);
  onlinePlayers.set(socket.id, {
    id: socket.id,
    name,
    joinedAt: existing?.joinedAt ?? Date.now(),
  });
  socket.data.lobbyName = name;
  return {
    ok: true,
    name,
    changed: !existing || normalizeGuess(existing.name) !== normalizeGuess(name),
  };
}

function resolveOnlineName(socket, value) {
  const existing = onlinePlayers.get(socket.id);
  return existing
    ? { ok: true, name: existing.name }
    : registerOnlinePlayer(socket, value);
}

function lobbyStatus(socketId) {
  const client = io.sockets.sockets.get(socketId);
  const room = rooms.get(client?.data.roomCode);
  if (!room) return "lobby";
  const participant = room.players.get(client?.data.playerId);
  if (participant?.isSpectator) return "spectating";
  return room.phase === "lobby" ? "room" : "game";
}

function lobbyState() {
  return {
    players: [...onlinePlayers.values()]
      .sort((first, second) => first.joinedAt - second.joinedAt)
      .map((player) => ({
        id: player.id,
        name: player.name,
        status: lobbyStatus(player.id),
      })),
    rooms: [...rooms.values()]
      .map((room) => {
        const players = seatedPlayers(room);
        const spectators = seatedSpectators(room);
        const host = room.players.get(room.hostId);
        const status = room.phase === "lobby"
          ? "waiting"
          : room.phase === "gameOver"
            ? "finished"
            : "playing";
        return {
          code: room.code,
          name: room.name,
          rules: room.rules,
          hostName: host?.name ?? "未知房主",
          playerCount: players.length,
          spectatorCount: spectators.length,
          maxPlayers: room.settings.maxPlayers,
          status,
          joinable:
            room.phase === "lobby" && players.length < room.settings.maxPlayers,
          spectatable:
            status === "playing" && spectators.length < MAX_SPECTATORS,
        };
      })
      .sort((first, second) => {
        if (first.joinable !== second.joinable) return first.joinable ? -1 : 1;
        return first.name.localeCompare(second.name, "zh-CN");
      }),
    messages: lobbyMessages,
  };
}

function emitLobbyState() {
  if (lobbyEmitTimer) return;
  lobbyEmitTimer = setTimeout(() => {
    lobbyEmitTimer = null;
    io.emit("lobby_state", lobbyState());
  }, 25);
  lobbyEmitTimer.unref();
}

function pushLobbyMessage(player, text) {
  lobbyMessages.push({
    id: crypto.randomUUID(),
    at: Date.now(),
    kind: "chat",
    playerId: player.id,
    name: player.name,
    text,
  });
  if (lobbyMessages.length > 100) lobbyMessages.shift();
  emitLobbyState();
}

function chatRateLimited(socket, channel) {
  const key = channel === "lobby" ? "lastLobbyChatAt" : "lastRoomChatAt";
  const now = Date.now();
  if (now - (socket.data[key] ?? 0) < CHAT_COOLDOWN_MS) return true;
  socket.data[key] = now;
  return false;
}

function getRoomWordBank(room) {
  return resolveWordBank(room?.settings?.wordBankIds);
}

function normalizeWordBankIds(value) {
  const requested = Array.isArray(value)
    ? value
    : typeof value === "string" ? value.split(",") : [];
  const requestedIds = new Set(
    requested.map((id) => String(id).trim()).filter((id) => id && id !== "all"),
  );
  return WORD_BANK_DEFINITIONS
    .map((definition) => definition.id)
    .filter((id) => id !== "all" && requestedIds.has(id));
}

function validWordBankIds(value) {
  const requested = Array.isArray(value)
    ? value
    : typeof value === "string" ? value.split(",") : [];
  return requested.every((id) => {
    const normalizedId = String(id).trim();
    return !normalizedId || normalizedId === "all" || wordBankDefinitionById.has(normalizedId);
  });
}

function parseRequestedWordBankIds(query) {
  const raw = query.wordBanks ?? query.wordBank ?? "all";
  const requested = Array.isArray(raw) ? raw : String(raw).split(",");
  const invalid = requested
    .map((id) => String(id).trim())
    .filter((id) => id && id !== "all" && !wordBankDefinitionById.has(id));
  return invalid.length > 0 ? null : normalizeWordBankIds(requested);
}

function resolveWordBank(value) {
  const ids = normalizeWordBankIds(value);
  if (ids.length === 0) return defaultWordBank;
  if (ids.length === 1) return wordBanks.get(ids[0]) ?? defaultWordBank;

  const key = ids.join(",");
  const cached = compositeWordBanks.get(key);
  if (cached) return cached;

  const definitionsByGroup = new Map();
  for (const id of ids) {
    const definition = wordBankDefinitionById.get(id);
    if (!definition) continue;
    const definitions = definitionsByGroup.get(definition.group) ?? [];
    definitions.push(definition);
    definitionsByGroup.set(definition.group, definitions);
  }
  const cards = cardCatalog.filter((card) =>
    [...definitionsByGroup.values()].every((definitions) =>
      definitions.some((definition) => definition.matches(card))
    )
  );
  const words = cards.map((card) => card.name);
  const bank = {
    id: key,
    label: [...definitionsByGroup.values()]
      .map((definitions) => definitions.map((definition) => definition.label).join("、"))
      .join(" · "),
    group: "组合筛选",
    cards,
    words,
    choiceWords: getChoiceEligibleCards(cards, CHOICE_OPTION_COUNT)
      .map((card) => card.name),
    names: new Set(words),
  };
  compositeWordBanks.set(key, bank);
  return bank;
}

function createRoom(host, details = {}) {
  const requestedName = cleanRoomName(details.name);
  const requestedRules = cleanRoomRules(details.rules);
  const room = {
    code: createRoomCode(),
    name: requestedName || `${host.name}的牌桌`.slice(0, 24),
    rules: requestedRules || DEFAULT_ROOM_RULES,
    hostId: host.id,
    players: new Map([[host.id, host]]),
    phase: "lobby",
    hintTimers: [],
    botDrawTimers: [],
    settings: {
      roundsPerPlayer: 2,
      roundTime: 60,
      maxPlayers: 8,
      answerMode: "mixed",
      wordBankIds: [],
    },
    messages: [],
    startOrder: [],
    turnOrder: [],
    turnIndex: 0,
    totalTurns: 0,
    current: null,
    recentWords: [],
    timer: null,
  };
  rooms.set(room.code, room);
  return room;
}

function seatedPlayers(room) {
  return [...room.players.values()].filter(
    (player) => !player.left && !player.isSpectator,
  );
}

function seatedSpectators(room) {
  return [...room.players.values()].filter(
    (player) => !player.left && player.isSpectator,
  );
}

function activePlayers(room) {
  return [...room.players.values()].filter(
    (player) => player.connected && !player.left && !player.isSpectator,
  );
}

function activeHumanPlayers(room) {
  return activePlayers(room).filter((player) => !player.isBot);
}

function addTestBot(room) {
  const occupiedNames = new Set(
    [...room.players.values()]
      .filter((player) => !player.left)
      .map((player) => normalizeGuess(player.name)),
  );
  let name = TEST_BOT_NAME;
  let suffix = 2;
  while (occupiedNames.has(normalizeGuess(name))) {
    name = `${TEST_BOT_NAME} ${suffix}`;
    suffix += 1;
  }

  const bot = createPlayer(name, null, { isBot: true });
  room.players.set(bot.id, bot);
  addSystemMessage(room, `${bot.name} 已加入，协助进行单人测试。`);
  return bot;
}

function getPlayerRoom(socket) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.get(socket.data.playerId);
  if (!room || !player || player.left) return null;
  return { room, player };
}

function setSocketPlayer(socket, room, player) {
  const previousSocketId = player.socketId;
  if (previousSocketId && previousSocketId !== socket.id) {
    io.sockets.sockets.get(previousSocketId)?.disconnect(true);
  }
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
}

function pushMessage(room, message) {
  const entry = {
    id: crypto.randomUUID(),
    at: Date.now(),
    ...message,
  };
  room.messages.push(entry);
  if (room.messages.length > 80) room.messages.shift();
  io.to(room.code).emit("chat_message", entry);
}

function addSystemMessage(room, text) {
  pushMessage(room, { kind: "system", text });
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  for (const timer of room.hintTimers ?? []) clearTimeout(timer);
  room.hintTimers = [];
  for (const timer of room.botDrawTimers ?? []) clearTimeout(timer);
  room.botDrawTimers = [];
}

function roundDurationMs(room) {
  return Number.isFinite(ROUND_TIME_OVERRIDE_MS) && ROUND_TIME_OVERRIDE_MS >= 100
    ? ROUND_TIME_OVERRIDE_MS
    : room.settings.roundTime * 1000;
}

function singleSelectedValue(ids, values) {
  const selected = ids.filter((id) => values.has(id));
  return selected.length === 1 ? values.get(selected[0]) : null;
}

function formatCostBand(cost) {
  if (!Number.isFinite(cost)) return "无费用";
  if (cost <= 3) return "0～3 费";
  if (cost <= 6) return "4～6 费";
  return "7 费以上";
}

function clueField(key, label, value, source = "hidden") {
  return { key, label, value: value || "待揭示", source };
}

function buildRoundClues(room, current, viewerId) {
  const card = cardByName.get(current?.word);
  if (!card) return null;

  const stage = Math.max(0, Math.min(2, current.hintStage ?? 0));
  const selectedIds = normalizeWordBankIds(room.settings.wordBankIds);
  const scopedType = singleSelectedValue(selectedIds, TYPE_BANK_VALUES);
  const scopedRarity = singleSelectedValue(selectedIds, RARITY_BANK_VALUES);
  const typeVisible = Boolean(scopedType) || stage >= 1;
  const rarityHintStage = scopedType ? 1 : 2;
  const rarityVisible = Boolean(scopedRarity) || stage >= rarityHintStage;
  const showCostBand = stage === 1 && Boolean(scopedType) && Boolean(scopedRarity);
  const selection = current.answers?.get(viewerId);
  const durationMs = roundDurationMs(room);
  const attributeClue = getCardAttributeClue(card);
  const selectedScore = selection
    ? calculateScore(
      Math.max(0, current.startedAt + durationMs - selection.selectedAt),
      durationMs,
    )
    : null;

  return {
    stage,
    range: getRoomWordBank(room).label,
    scoreBand: SCORE_BANDS[stage],
    selectedScore,
    fields: [
      clueField(
        "length",
        "字数",
        `${countWordCharacters(card.name)} 个字`,
        "base",
      ),
      clueField(
        "type",
        "类型",
        typeVisible ? (CARD_TYPE_LABELS[card.type] ?? card.type) : "",
        scopedType ? "scope" : typeVisible ? "hint" : "hidden",
      ),
      clueField(
        "class",
        "职业",
        stage >= 1 ? (CARD_CLASS_LABELS[card.cardClass] ?? card.cardClass) : "",
        stage >= 1 ? "hint" : "hidden",
      ),
      clueField(
        "rarity",
        "稀有度",
        rarityVisible ? (CARD_RARITY_LABELS[card.rarity] ?? card.rarity) : "",
        scopedRarity ? "scope" : rarityVisible ? "hint" : "hidden",
      ),
      clueField(
        "cost",
        "费用",
        stage >= 2
          ? (Number.isFinite(card.cost) ? `${card.cost} 费` : "无费用")
          : showCostBand ? formatCostBand(card.cost) : "",
        stage >= 2 || showCostBand ? "hint" : "hidden",
      ),
      ...(attributeClue
        ? [clueField(
            "stats",
            attributeClue.label,
            stage >= 2 ? attributeClue.value : "",
            stage >= 2 ? "hint" : "hidden",
          )]
        : []),
    ],
  };
}

function resolveCardImage(cardId) {
  const candidates = ["webp", "png"]
    .map((extension) => path.join(cardImageDir, `${cardId}.${extension}`))
    .filter((candidate) => fs.existsSync(candidate));
  if (candidates.length < 2) return candidates[0] ?? null;
  return candidates.toSorted(
    (first, second) => fs.statSync(second).mtimeMs - fs.statSync(first).mtimeMs,
  )[0];
}

async function withImageFetchSlot(task) {
  if (activeImageFetches >= MAX_IMAGE_FETCHES) {
    if (imageFetchQueue.length >= MAX_IMAGE_FETCH_QUEUE) {
      throw new Error("卡牌图片回源队列已满");
    }
    await new Promise((resolve) => imageFetchQueue.push(resolve));
  }
  activeImageFetches += 1;
  try {
    return await task();
  } finally {
    activeImageFetches -= 1;
    imageFetchQueue.shift()?.();
  }
}

async function ensureCardImage(cardId, imagePath) {
  if (fs.existsSync(imagePath)) return;
  if (pendingCardImages.has(cardId)) {
    await pendingCardImages.get(cardId);
    return;
  }

  const pending = withImageFetchSlot(async () => {
    const upstream = await fetch(
      `${CARD_IMAGE_SOURCE}/${encodeURIComponent(cardId)}.png`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!upstream.ok) throw new Error(`图片源返回 ${upstream.status}`);
    if (!String(upstream.headers.get("content-type") ?? "").startsWith("image/")) {
      throw new Error("图片源返回了无效内容");
    }

    const image = Buffer.from(await upstream.arrayBuffer());
    if (image.length < 1_000 || image.length > 2_000_000) {
      throw new Error("图片文件大小异常");
    }

    await fs.promises.mkdir(cardImageDir, { recursive: true });
    const temporaryPath = `${imagePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporaryPath, image);
    await fs.promises.rename(temporaryPath, imagePath);
  });

  pendingCardImages.set(cardId, pending);
  try {
    await pending;
  } finally {
    pendingCardImages.delete(cardId);
  }
}

function cardPreview(name) {
  const card = cardByName.get(name);
  if (!card) return null;
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    imageUrl: card.imageUrl,
  };
}

function publicState(room, viewerId) {
  const viewer = room.players.get(viewerId);
  const current = room.current;
  const isDrawer = current?.drawerId === viewerId;
  const isSpectator = viewer?.isSpectator ?? false;
  const selectedWord = current?.word ?? "";
  const selectedWordBank = getRoomWordBank(room);
  let visibleWord = "";

  if (room.phase === "drawing") {
    visibleWord = isDrawer ? selectedWord : maskWord(selectedWord);
  } else if (room.phase === "roundEnd" || room.phase === "gameOver") {
    visibleWord = selectedWord;
  }

  return {
    code: room.code,
    name: room.name,
    rules: room.rules,
    phase: room.phase,
    hostId: room.hostId,
    selfId: viewerId,
    settings: room.settings,
    wordBankCount: selectedWordBank.words.length,
    wordBankChoiceCount: selectedWordBank.choiceWords.length,
    wordBankName: selectedWordBank.label,
    wordBankOptions: publicWordBankOptions,
    players: [...room.players.values()]
      .filter((player) => !player.left)
      .map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score,
        connected: player.connected,
        isBot: player.isBot,
        isSpectator: player.isSpectator,
        joinQueued: player.isSpectator && player.joinNextRound,
        isHost: player.id === room.hostId,
        isDrawer: player.id === current?.drawerId,
        hasAnswered: current?.answers?.has(player.id) ?? false,
        answeredCorrectly:
          (room.phase === "roundEnd" || room.phase === "gameOver") &&
          (current?.correctPlayers?.has(player.id) ?? false),
      })),
    round: current
      ? {
          key: `${room.turnIndex}-${current.startedAt}`,
          turn: room.turnIndex + 1,
          totalTurns: room.totalTurns,
          cycle:
            room.startOrder.length > 0
              ? Math.floor(room.turnIndex / room.startOrder.length) + 1
              : 0,
          drawerId: current.drawerId,
          endsAt: current.endsAt,
          durationMs: room.phase === "drawing" ? roundDurationMs(room) : 0,
          word: visibleWord,
          wordLength: selectedWord ? countWordCharacters(selectedWord) : 0,
          questionType: current.questionType,
          options: room.phase === "choosing" && isDrawer ? current.options : [],
          optionCards:
            room.phase === "choosing" && isDrawer
              ? current.options.map(cardPreview).filter(Boolean)
              : [],
          referenceCard:
            room.phase === "drawing" && isDrawer
              ? cardPreview(selectedWord)
              : null,
          finalRevealCard:
            room.phase === "drawing" && current.finalCardVisible
              ? cardPreview(selectedWord)
              : null,
          answerCard:
            room.phase === "roundEnd" || room.phase === "gameOver"
              ? cardPreview(selectedWord)
              : null,
          answerOptions:
            room.phase === "drawing" && !isDrawer && !isSpectator && current.questionType === "choice"
              ? current.answerOptions
              : [],
          answerOptionCards:
            room.phase === "drawing" && !isDrawer && !isSpectator && current.questionType === "choice"
              ? current.answerOptions.map(cardPreview)
              : [],
          selectedAnswerIndex:
            !isDrawer && !isSpectator && current.questionType === "choice" && current.answers?.has(viewerId)
              ? current.answers.get(viewerId).index
              : null,
          selectedAnswerName:
            !isDrawer && !isSpectator && current.questionType === "search" && current.answers?.has(viewerId)
              ? current.answers.get(viewerId).name
              : "",
          clues:
            room.phase === "drawing" && !isDrawer
              ? buildRoundClues(room, current, viewerId)
              : null,
          resultReason: current.resultReason ?? null,
        }
      : null,
    messages: room.messages,
    canStart: room.phase === "lobby" && activeHumanPlayers(room).length >= 1,
    canJoinNextRound:
      isSpectator &&
      !viewer?.joinNextRound &&
      hasFutureTurn(room) &&
      seatedPlayers(room).length + seatedSpectators(room).filter(
        (spectator) => spectator.joinNextRound,
      ).length < room.settings.maxPlayers,
    isHost: room.hostId === viewerId,
    isDrawer,
    isSpectator,
    joinQueued: isSpectator && Boolean(viewer?.joinNextRound),
    sessionName: viewer?.name ?? "",
  };
}

function emitState(room) {
  for (const player of room.players.values()) {
    if (!player.connected || player.left || !player.socketId) continue;
    io.to(player.socketId).emit("room_state", publicState(room, player.id));
  }
  emitLobbyState();
}

function emitCanvasHistory(room, socketId) {
  io.to(socketId).emit("canvas_history", room.current?.history ?? []);
}

function chooseNextHost(room) {
  const currentHost = room.players.get(room.hostId);
  if (currentHost?.connected && !currentHost.isBot) return;
  const nextHost = activeHumanPlayers(room)[0];
  if (nextHost) room.hostId = nextHost.id;
}

function finishGame(room, message = "本局结束，看看谁是酒馆里的画谜大师！") {
  clearRoomTimer(room);
  room.phase = "gameOver";
  if (room.current) room.current.endsAt = Date.now();
  addSystemMessage(room, message);
  emitState(room);
}

function hasFutureTurn(room) {
  return (
    ["choosing", "drawing", "roundEnd"].includes(room.phase) &&
    room.turnIndex + 1 < room.totalTurns
  );
}

function promoteQueuedSpectators(room) {
  const availableSeats = Math.max(
    0,
    room.settings.maxPlayers - seatedPlayers(room).length,
  );
  const queued = seatedSpectators(room)
    .filter((spectator) => spectator.connected && spectator.joinNextRound)
    .sort((first, second) => first.joinQueuedAt - second.joinQueuedAt)
    .slice(0, availableSeats);

  for (const spectator of queued) {
    const previousRoundSize = room.startOrder.length;
    const joinedCycle = Math.min(
      room.settings.roundsPerPlayer - 1,
      Math.floor(room.turnIndex / Math.max(1, previousRoundSize)),
    );
    spectator.isSpectator = false;
    spectator.joinNextRound = false;
    spectator.joinQueuedAt = null;
    spectator.score = 0;
    room.startOrder.push(spectator.id);
    let insertedTurns = 0;
    for (
      let cycle = joinedCycle;
      cycle < room.settings.roundsPerPlayer;
      cycle += 1
    ) {
      const cycleEnd = Math.min(
        room.turnOrder.length,
        (cycle + 1) * previousRoundSize + insertedTurns,
      );
      room.turnOrder.splice(cycleEnd, 0, spectator.id);
      insertedTurns += 1;
    }
    addSystemMessage(room, `${spectator.name} 从本轮起加入游戏，积分从 0 开始。`);
  }

  room.totalTurns = room.turnOrder.length;
}

function beginTurn(room) {
  clearRoomTimer(room);
  promoteQueuedSpectators(room);

  if (activePlayers(room).length < 2) {
    finishGame(room, "人数不足，本局提前结束。");
    return;
  }

  while (room.turnIndex < room.totalTurns) {
    const drawerId = room.turnOrder[room.turnIndex];
    const drawer = room.players.get(drawerId);
    if (drawer?.connected && !drawer.left) break;
    room.turnIndex += 1;
  }

  if (room.turnIndex >= room.totalTurns) {
    finishGame(room);
    return;
  }

  const drawerId = room.turnOrder[room.turnIndex];
  const drawer = room.players.get(drawerId);
  const chooseDurationMs = drawer.isBot ? AI_CHOOSE_DELAY_MS : CHOOSE_TIME_MS;
  const selectedWordBank = getRoomWordBank(room);
  const roundWordBank = room.settings.answerMode === "search"
    ? selectedWordBank.words
    : selectedWordBank.choiceWords;
  const options = pickWords(roundWordBank, 3, room.recentWords.slice(-30));
  const now = Date.now();
  room.phase = "choosing";
  room.current = {
    drawerId,
    options,
    questionType: null,
    answerOptions: [],
    word: "",
    answers: new Map(),
    correctPlayers: new Set(),
    history: [],
    startedAt: now,
    endsAt: now + chooseDurationMs,
    resultReason: null,
    hintStage: 0,
    finalCardVisible: false,
  };
  io.to(room.code).emit("canvas_event", { type: "clear" });
  addSystemMessage(
    room,
    drawer.isBot ? `${drawer.name} 正在自动选题。` : `轮到 ${drawer.name} 选题。`,
  );
  emitState(room);
  room.timer = setTimeout(
    () => startDrawing(room, options[0]),
    chooseDurationMs,
  );
}

function scheduleBotAnswers(room) {
  if (!room.current) return;
  const roundStartedAt = room.current.startedAt;
  const delayMs = Math.max(
    100,
    Math.min(1_800, Math.round(roundDurationMs(room) * 0.35)),
  );

  for (const bot of activePlayers(room)) {
    if (!bot.isBot || bot.id === room.current.drawerId) continue;
    setTimeout(() => {
      const current = room.current;
      if (
        room.phase !== "drawing" ||
        !current ||
        current.startedAt !== roundStartedAt ||
        bot.left
      ) {
        return;
      }

      const shouldAnswerCorrectly = crypto.randomInt(0, 100) < 65;
      if (current.questionType === "choice") {
        const correctIndex = current.answerOptions.indexOf(current.word);
        const wrongIndexes = current.answerOptions
          .map((_, index) => index)
          .filter((index) => index !== correctIndex);
        const index = shouldAnswerCorrectly
          ? correctIndex
          : wrongIndexes[crypto.randomInt(0, wrongIndexes.length)];
        current.answers.set(bot.id, { index, selectedAt: Date.now() });
      } else {
        const wrongAnswers = getRoomWordBank(room).words.filter(
          (word) => normalizeGuess(word) !== normalizeGuess(current.word),
        );
        const name = shouldAnswerCorrectly
          ? current.word
          : wrongAnswers[crypto.randomInt(0, wrongAnswers.length)];
        current.answers.set(bot.id, { name, selectedAt: Date.now() });
      }
      emitState(room);
    }, delayMs);
  }
}

function activeBotDrawingRound(room, roundStartedAt) {
  const current = room.current;
  return room.phase === "drawing" &&
    current?.startedAt === roundStartedAt &&
    room.players.get(current.drawerId)?.isBot;
}

function appendBotSegments(room, roundStartedAt, inputSegments) {
  if (!activeBotDrawingRound(room, roundStartedAt)) return;
  const segments = inputSegments.map(validSegment).filter(Boolean);
  if (segments.length === 0) return;
  room.current.history.push(...segments);
  if (room.current.history.length > 15_000) {
    room.current.history.splice(0, 2_000);
  }
  io.to(room.code).emit(
    "canvas_event",
    segments.length === 1
      ? { type: "segment", segment: segments[0] }
      : { type: "segments", segments },
  );
}

function queueBotSegments(room, roundStartedAt, segments, options = {}) {
  if (segments.length === 0) return;
  const batchSize = Math.max(1, Math.min(64, options.batchSize ?? 18));
  const intervalMs = Math.max(25, options.intervalMs ?? 120);
  const startDelayMs = Math.max(0, options.startDelayMs ?? 80);
  for (let index = 0; index < segments.length; index += batchSize) {
    const timer = setTimeout(
      () => appendBotSegments(
        room,
        roundStartedAt,
        segments.slice(index, index + batchSize),
      ),
      startDelayMs + Math.floor(index / batchSize) * intervalMs,
    );
    room.botDrawTimers.push(timer);
  }
}

async function loadBotDrawing(card) {
  if (!card?.id) return [];
  if (botDrawingCache.has(card.id)) return botDrawingCache.get(card.id);

  const pending = withImageFetchSlot(async () => {
    const response = await fetch(
      `${CARD_IMAGE_SOURCE}/${encodeURIComponent(card.id)}.png`,
      { signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) throw new Error(`AI 卡图返回 ${response.status}`);
    if (!String(response.headers.get("content-type") ?? "").startsWith("image/png")) {
      throw new Error("AI 卡图不是 PNG");
    }
    const image = Buffer.from(await response.arrayBuffer());
    if (image.length < 1_000 || image.length > 4_000_000) {
      throw new Error("AI 卡图文件大小异常");
    }
    return buildBotDrawingFromPng(image, card, {
      maxOutlineSegments: 600,
      maxColoringSegments: 170,
    });
  });

  botDrawingCache.set(card.id, pending);
  if (botDrawingCache.size > 64) {
    botDrawingCache.delete(botDrawingCache.keys().next().value);
  }
  try {
    return await pending;
  } catch (error) {
    botDrawingCache.delete(card.id);
    throw error;
  }
}

function scheduleBotDrawing(room) {
  const current = room.current;
  const drawer = room.players.get(current?.drawerId);
  const card = cardByName.get(current?.word);
  if (!current || !drawer?.isBot || !card) return;

  const roundStartedAt = current.startedAt;
  const durationMs = roundDurationMs(room);
  let drawingStarted = false;
  let fallbackQueued = false;
  const queueFallback = () => {
    if (drawingStarted || fallbackQueued || !activeBotDrawingRound(room, roundStartedAt)) {
      return;
    }
    fallbackQueued = true;
    queueBotSegments(room, roundStartedAt, buildBotTypeSketch(card), {
      batchSize: 10,
      startDelayMs: 0,
      intervalMs: Math.max(45, Math.min(180, durationMs * 0.003)),
    });
  };
  const fallbackTimer = setTimeout(
    queueFallback,
    Math.max(30, Math.min(1_200, durationMs * 0.025)),
  );
  room.botDrawTimers.push(fallbackTimer);

  void loadBotDrawing(card)
    .then(({ outline, shading }) => {
      if (!activeBotDrawingRound(room, roundStartedAt)) return;
      drawingStarted = true;
      clearTimeout(fallbackTimer);
      const outlineBatchSize = 8;
      const outlineIntervalMs = Math.max(55, Math.min(160, durationMs * 0.0025));
      queueBotSegments(room, roundStartedAt, outline, {
        batchSize: outlineBatchSize,
        startDelayMs: 40,
        intervalMs: outlineIntervalMs,
      });
      const outlineDurationMs =
        Math.ceil(outline.length / outlineBatchSize) * outlineIntervalMs;
      queueBotSegments(room, roundStartedAt, shading, {
        batchSize: 5,
        startDelayMs: outlineDurationMs + Math.min(700, durationMs * 0.025),
        intervalMs: Math.max(65, Math.min(190, durationMs * 0.003)),
      });
    })
    .catch((error) => {
      console.warn(`AI 轮廓生成失败 ${card.id}: ${error.message}`);
      queueFallback();
    });
}

function revealHintStage(room, roundStartedAt, stage) {
  const current = room.current;
  if (
    room.phase !== "drawing" ||
    !current ||
    current.startedAt !== roundStartedAt ||
    current.hintStage >= stage
  ) {
    return;
  }
  current.hintStage = stage;
  addSystemMessage(
    room,
    stage === 1
      ? "第一条线索已公开，本题分数进入 70～50 分档。"
      : "第二条线索已公开，本题分数进入 40～20 分档。",
  );
  emitState(room);
}

function revealFinalCard(room, roundStartedAt) {
  const current = room.current;
  if (
    room.phase !== "drawing" ||
    !current ||
    current.startedAt !== roundStartedAt ||
    current.finalCardVisible
  ) {
    return;
  }
  current.finalCardVisible = true;
  addSystemMessage(room, "最后 5 秒：原卡图正在画板上渐显，本阶段仍可修改答案。");
  emitState(room);
}

function startDrawing(room, word) {
  if (room.phase !== "choosing" || !room.current) return;
  if (!room.current.options.includes(word)) word = room.current.options[0];

  clearRoomTimer(room);
  const now = Date.now();
  room.phase = "drawing";
  room.current.word = word;
  room.current.questionType = room.settings.answerMode === "mixed"
    ? (crypto.randomInt(0, 2) === 0 ? "choice" : "search")
    : room.settings.answerMode;
  room.current.answerOptions = room.current.questionType === "choice"
    ? buildCardAnswerOptions(
      getRoomWordBank(room).cards,
      cardByName.get(word) ?? word,
      CHOICE_OPTION_COUNT,
    )
    : [];
  room.current.answers.clear();
  room.current.correctPlayers.clear();
  room.current.hintStage = 0;
  room.current.finalCardVisible = false;
  room.current.startedAt = now;
  const durationMs = roundDurationMs(room);
  room.current.endsAt = now + durationMs;
  room.recentWords.push(word);
  if (room.recentWords.length > 100) room.recentWords.shift();
  addSystemMessage(
    room,
    `${room.players.get(room.current.drawerId)?.name} 开始作画！本轮为${room.current.questionType === "choice" ? "选择题" : "搜索题"}。`,
  );
  if (room.players.get(room.current.drawerId)?.isBot) {
    addSystemMessage(room, "AI 正在先画卡面椭圆和主体彩色轮廓，再逐步铺色与补充暗部。");
  }
  emitState(room);
  scheduleBotAnswers(room);
  scheduleBotDrawing(room);
  room.hintTimers = [
    setTimeout(
      () => revealHintStage(room, now, 1),
      Math.round(durationMs * 0.4),
    ),
    setTimeout(
      () => revealHintStage(room, now, 2),
      Math.round(durationMs * 0.7),
    ),
  ];
  if (durationMs > FINAL_REVEAL_LEAD_MS) {
    room.hintTimers.push(setTimeout(
      () => revealFinalCard(room, now),
      durationMs - FINAL_REVEAL_LEAD_MS,
    ));
  }
  room.timer = setTimeout(
    () => finishTurn(room, "timeout"),
    durationMs,
  );
}

function settleAnswers(room) {
  const current = room.current;
  if (!current) return;

  const correctPlayers = [];
  const drawer = room.players.get(current.drawerId);
  const durationMs = roundDurationMs(room);

  for (const [playerId, selection] of current.answers) {
    const player = room.players.get(playerId);
    if (!player || player.left || player.isSpectator) continue;
    const selectedWord = current.questionType === "choice"
      ? current.answerOptions[selection.index]
      : selection.name;
    if (selectedWord !== current.word) continue;

    const remaining = Math.max(0, current.endsAt - selection.selectedAt);
    const score = calculateScore(remaining, durationMs);
    if (!player.isBot) player.score += score;
    current.correctPlayers.add(player.id);
    correctPlayers.push(player.name);
    if (drawer && !drawer.isBot) {
      drawer.score += Math.max(5, Math.round(score * 0.25));
    }
  }

  addSystemMessage(
    room,
    correctPlayers.length > 0
      ? `${correctPlayers.join("、")} 选择正确！`
      : "本轮无人选中正确答案。",
  );
}

function finishTurn(room, reason) {
  if (room.phase !== "drawing" || !room.current) return;
  clearRoomTimer(room);
  if (reason === "timeout") settleAnswers(room);
  room.phase = "roundEnd";
  room.current.resultReason = reason;
  room.current.endsAt = Date.now() + ROUND_BREAK_MS;
  addSystemMessage(room, `本轮答案是「${room.current.word}」。`);
  emitState(room);
  room.timer = setTimeout(() => {
    room.turnIndex += 1;
    beginTurn(room);
  }, ROUND_BREAK_MS);
}

function closeRoom(room, message) {
  clearRoomTimer(room);
  rooms.delete(room.code);
  for (const participant of room.players.values()) {
    if (!participant.connected || !participant.socketId) continue;
    const client = io.sockets.sockets.get(participant.socketId);
    if (!client) continue;
    client.leave(room.code);
    client.data.roomCode = null;
    client.data.playerId = null;
    client.emit("room_closed", { message });
  }
  emitLobbyState();
}

function removeOrDeactivatePlayer(room, player, reason = "离开了房间") {
  player.connected = false;
  player.socketId = null;
  player.left = true;
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  addSystemMessage(room, `${player.name} ${reason}。`);

  if (room.phase === "lobby") room.players.delete(player.id);
  chooseNextHost(room);

  if (activeHumanPlayers(room).length === 0) {
    closeRoom(room, "牌桌里的玩家都已离开，围观已结束。");
    return;
  }

  if (room.current?.drawerId === player.id) {
    if (room.phase === "choosing") {
      room.turnIndex += 1;
      beginTurn(room);
      return;
    }
    if (room.phase === "drawing") {
      finishTurn(room, "drawerLeft");
      return;
    }
  }

  emitState(room);
}

function validateSettings(input, current) {
  const hasRequestedWordBanks = Array.isArray(input?.wordBankIds) ||
    typeof input?.wordBankId === "string";
  const requestedWordBankIds = Array.isArray(input?.wordBankIds)
    ? input.wordBankIds
    : input?.wordBankId;
  if (hasRequestedWordBanks && !validWordBankIds(requestedWordBankIds)) return null;
  const wordBankIds = hasRequestedWordBanks
    ? normalizeWordBankIds(requestedWordBankIds)
    : normalizeWordBankIds(current?.wordBankIds);
  const selectedWordBank = resolveWordBank(wordBankIds);
  if (selectedWordBank.words.length === 0) return null;
  let answerMode = ["mixed", "choice", "search"].includes(input?.answerMode)
    ? input.answerMode
    : current.answerMode;
  if (selectedWordBank.choiceWords.length < 3) answerMode = "search";

  return {
    roundsPerPlayer: Math.round(Math.max(
      1,
      Math.min(5, Number(input?.roundsPerPlayer) || current.roundsPerPlayer),
    )),
    roundTime: [30, 45, 60, 90, 120].includes(Number(input?.roundTime))
      ? Number(input.roundTime)
      : current.roundTime,
    maxPlayers: Math.round(Math.max(
      2,
      Math.min(12, Number(input?.maxPlayers) || current.maxPlayers),
    )),
    answerMode,
    wordBankIds,
  };
}

function validSegment(input) {
  if (!input || !["brush", "eraser"].includes(input.tool)) return null;
  const numbers = [input.x0, input.y0, input.x1, input.y1, input.size];
  if (!numbers.every(Number.isFinite)) return null;
  if ([input.x0, input.y0, input.x1, input.y1].some((value) => value < 0 || value > 1)) {
    return null;
  }
  const color = /^#[0-9a-f]{6}$/iu.test(input.color) ? input.color : "#17242a";
  return {
    x0: input.x0,
    y0: input.y0,
    x1: input.x1,
    y1: input.y1,
    size: Math.max(1, Math.min(36, input.size)),
    color,
    tool: input.tool,
  };
}

function respond(callback, payload) {
  if (typeof callback === "function") callback(payload);
}

function rejectRoomSwitch(socket, callback) {
  if (!socket.data.roomCode) return false;
  respond(callback, { ok: false, error: "请先离开当前房间" });
  return true;
}

io.on("connection", (socket) => {
  socket.emit("lobby_state", lobbyState());

  socket.on("join_lobby", (payload, callback) => {
    if (socketRateLimited(socket, "lobby-membership", 8, 10_000)) {
      respond(callback, { ok: false, error: "大厅操作过于频繁，请稍后再试" });
      return;
    }
    if (socket.data.roomCode) {
      respond(callback, { ok: false, error: "请先离开当前房间" });
      return;
    }
    const registered = registerOnlinePlayer(socket, payload?.name);
    respond(callback, registered);
    if (registered.ok && registered.changed) emitLobbyState();
  });

  socket.on("leave_lobby", (_payload, callback) => {
    if (socketRateLimited(socket, "lobby-membership", 8, 10_000)) {
      respond(callback, { ok: false, error: "大厅操作过于频繁，请稍后再试" });
      return;
    }
    if (socket.data.roomCode) {
      respond(callback, { ok: false, error: "请先离开当前房间" });
      return;
    }
    const removed = onlinePlayers.delete(socket.id);
    socket.data.lobbyName = null;
    respond(callback, { ok: true });
    if (removed) emitLobbyState();
  });

  socket.on("send_lobby_chat", (payload, callback) => {
    const player = onlinePlayers.get(socket.id);
    const text = cleanChatText(payload?.text);
    if (!player || socket.data.roomCode) {
      respond(callback, { ok: false, error: "只有大厅中的玩家可以发送大厅消息" });
      return;
    }
    if (!text) {
      respond(callback, { ok: false, error: "消息不能为空" });
      return;
    }
    if (chatRateLimited(socket, "lobby")) {
      respond(callback, { ok: false, error: "发送得太快了，请稍后再试" });
      return;
    }
    pushLobbyMessage(player, text);
    respond(callback, { ok: true });
  });

  socket.on("create_room", (payload, callback) => {
    if (rejectRoomSwitch(socket, callback)) return;
    if (socketAddressRateLimited(socket, "room-entry", 30, 60_000)) {
      respond(callback, { ok: false, error: "创建或加入房间过于频繁，请稍后再试" });
      return;
    }
    if (rooms.size >= MAX_ROOMS) {
      respond(callback, { ok: false, error: "当前牌桌数量已满，请稍后再试" });
      return;
    }
    const resolved = resolveOnlineName(socket, payload?.name);
    if (!resolved.ok) {
      respond(callback, resolved);
      return;
    }
    const { name } = resolved;

    const host = createPlayer(name, socket.id);
    const room = createRoom(host, {
      name: payload?.roomName,
      rules: payload?.roomRules,
    });
    setSocketPlayer(socket, room, host);
    addSystemMessage(room, `${name} 创建了房间。`);
    respond(callback, {
      ok: true,
      roomCode: room.code,
      playerToken: host.token,
    });
    emitState(room);
  });

  socket.on("join_room", (payload, callback) => {
    if (rejectRoomSwitch(socket, callback)) return;
    if (socketAddressRateLimited(socket, "room-entry", 30, 60_000)) {
      respond(callback, { ok: false, error: "创建或加入房间过于频繁，请稍后再试" });
      return;
    }
    const resolved = resolveOnlineName(socket, payload?.name);
    const name = resolved.name;
    const code = cleanCode(payload?.roomCode);
    const room = rooms.get(code);
    const wantsToSpectate = payload?.joinMode === "spectate";
    if (!resolved.ok) {
      respond(callback, resolved);
      return;
    }
    if (!room) {
      respond(callback, { ok: false, error: "没有找到这个房间" });
      return;
    }
    if (
      [...room.players.values()].some(
        (player) =>
          !player.left &&
          normalizeGuess(player.name) === normalizeGuess(name),
      )
    ) {
      respond(callback, { ok: false, error: "这个昵称在房间里已经有人使用" });
      return;
    }

    if (wantsToSpectate) {
      if (room.phase === "lobby") {
        respond(callback, { ok: false, error: "游戏还没开始，请直接加入牌桌" });
        return;
      }
      if (room.phase === "gameOver") {
        respond(callback, { ok: false, error: "本局已经结束，请等待下一局" });
        return;
      }
      if (seatedSpectators(room).length >= MAX_SPECTATORS) {
        respond(callback, { ok: false, error: "围观席已经满了" });
        return;
      }
    } else {
      if (room.phase !== "lobby") {
        respond(callback, { ok: false, error: "游戏已经开始，请先进入围观席" });
        return;
      }
      if (seatedPlayers(room).length >= room.settings.maxPlayers) {
        respond(callback, { ok: false, error: "房间已经满员" });
        return;
      }
    }

    const player = createPlayer(name, socket.id, {
      isSpectator: wantsToSpectate,
    });
    room.players.set(player.id, player);
    setSocketPlayer(socket, room, player);
    addSystemMessage(
      room,
      wantsToSpectate ? `${name} 进入了围观席。` : `${name} 加入了房间。`,
    );
    respond(callback, {
      ok: true,
      roomCode: code,
      playerToken: player.token,
      isSpectator: wantsToSpectate,
    });
    emitState(room);
  });

  socket.on("join_next_round", (_payload, callback) => {
    const context = getPlayerRoom(socket);
    if (!context || !context.player.isSpectator) {
      respond(callback, { ok: false, error: "只有围观者可以申请中途加入" });
      return;
    }
    if (!hasFutureTurn(context.room)) {
      respond(callback, { ok: false, error: "当前没有可加入的下一轮" });
      return;
    }
    if (context.player.joinNextRound) {
      respond(callback, { ok: true, joinQueued: true });
      return;
    }

    const reservedSeats = seatedSpectators(context.room).filter(
      (spectator) => spectator.joinNextRound,
    ).length;
    if (
      seatedPlayers(context.room).length + reservedSeats >=
      context.room.settings.maxPlayers
    ) {
      respond(callback, { ok: false, error: "参战席位已经满了" });
      return;
    }

    context.player.joinNextRound = true;
    context.player.joinQueuedAt = Date.now();
    addSystemMessage(
      context.room,
      `${context.player.name} 将在下一轮以 0 分加入游戏。`,
    );
    emitState(context.room);
    respond(callback, { ok: true, joinQueued: true });
  });

  socket.on("resume_session", (payload, callback) => {
    if (rejectRoomSwitch(socket, callback)) return;
    if (socketRateLimited(socket, "resume", 8, 10_000)) {
      respond(callback, { ok: false, error: "恢复会话过于频繁，请稍后再试" });
      return;
    }
    const code = cleanCode(payload?.roomCode);
    const room = rooms.get(code);
    const player = room
      ? [...room.players.values()].find(
          (candidate) => candidate.token === payload?.playerToken && !candidate.left,
        )
      : null;

    if (!room || !player) {
      respond(callback, { ok: false, error: "原房间已失效" });
      return;
    }

    const registered = registerOnlinePlayer(socket, player.name, {
      allowedSocketId: player.socketId,
      allowedPlayerId: player.id,
    });
    if (!registered.ok) {
      respond(callback, registered);
      return;
    }
    setSocketPlayer(socket, room, player);
    respond(callback, { ok: true, roomCode: code, playerToken: player.token });
    emitState(room);
    emitCanvasHistory(room, socket.id);
  });

  socket.on("update_settings", (payload, callback) => {
    const context = getPlayerRoom(socket);
    if (!context || context.room.hostId !== context.player.id) {
      respond(callback, { ok: false, error: "只有房主可以修改设置" });
      return;
    }
    if (context.room.phase !== "lobby") {
      respond(callback, { ok: false, error: "游戏中不能修改设置" });
      return;
    }
    const settings = validateSettings(payload, context.room.settings);
    if (!settings) {
      respond(callback, { ok: false, error: "该筛选组合没有可用卡牌，请调整条件" });
      return;
    }
    context.room.settings = settings;
    emitState(context.room);
    respond(callback, { ok: true });
  });

  socket.on("update_room_details", (payload, callback) => {
    const context = getPlayerRoom(socket);
    if (!context || context.room.hostId !== context.player.id) {
      respond(callback, { ok: false, error: "只有房主可以修改房间信息" });
      return;
    }
    if (context.room.phase !== "lobby") {
      respond(callback, { ok: false, error: "游戏中不能修改房间信息" });
      return;
    }

    const name = cleanRoomName(payload?.roomName);
    const rules = cleanRoomRules(payload?.roomRules);
    if (!name) {
      respond(callback, { ok: false, error: "房间名称不能为空" });
      return;
    }
    if (!rules) {
      respond(callback, { ok: false, error: "请填写房间规则" });
      return;
    }

    context.room.name = name;
    context.room.rules = rules;
    addSystemMessage(context.room, "房主更新了房间名称和规则。");
    emitState(context.room);
    respond(callback, { ok: true });
  });

  socket.on("start_game", (_payload, callback) => {
    const context = getPlayerRoom(socket);
    if (!context || context.room.hostId !== context.player.id) {
      respond(callback, { ok: false, error: "只有房主可以开始游戏" });
      return;
    }
    if (context.room.phase !== "lobby") {
      respond(callback, { ok: false, error: "游戏已经开始" });
      return;
    }
    if (activeHumanPlayers(context.room).length < 1) {
      respond(callback, { ok: false, error: "至少需要一名真人玩家" });
      return;
    }
    let players = activePlayers(context.room);
    if (players.length === 1) {
      addTestBot(context.room);
      players = activePlayers(context.room);
    }

    for (const player of players) player.score = 0;
    context.room.startOrder = players.map((player) => player.id);
    context.room.turnOrder = Array.from(
      { length: context.room.settings.roundsPerPlayer },
      () => [...context.room.startOrder],
    ).flat();
    context.room.turnIndex = 0;
    context.room.totalTurns = context.room.turnOrder.length;
    context.room.recentWords = [];
    respond(callback, { ok: true });
    beginTurn(context.room);
  });

  socket.on("choose_word", (payload, callback) => {
    const context = getPlayerRoom(socket);
    if (
      !context ||
      context.room.phase !== "choosing" ||
      context.room.current?.drawerId !== context.player.id
    ) {
      respond(callback, { ok: false, error: "现在不能选题" });
      return;
    }
    if (!context.room.current.options.includes(payload?.word)) {
      respond(callback, { ok: false, error: "题目不在候选列表中" });
      return;
    }
    respond(callback, { ok: true });
    startDrawing(context.room, payload.word);
  });

  socket.on("canvas_event", (payload) => {
    const context = getPlayerRoom(socket);
    if (
      !context ||
      context.room.phase !== "drawing" ||
      context.room.current?.drawerId !== context.player.id
    ) {
      return;
    }

    if (socketRateLimited(socket, "canvas", 90, 1_000)) return;

    if (payload?.type === "clear") {
      context.room.current.history = [];
      socket.to(context.room.code).emit("canvas_event", { type: "clear" });
      return;
    }

    let segments = [];
    if (payload?.type === "segment") {
      const segment = validSegment(payload.segment);
      if (segment) segments = [segment];
    } else if (
      payload?.type === "segments" &&
      Array.isArray(payload.segments) &&
      payload.segments.length <= 64
    ) {
      segments = payload.segments.map(validSegment).filter(Boolean);
    }
    if (segments.length === 0) return;

    context.room.current.history.push(...segments);
    if (context.room.current.history.length > 15_000) {
      context.room.current.history.splice(0, 2_000);
    }
    socket.to(context.room.code).emit(
      "canvas_event",
      segments.length === 1
        ? { type: "segment", segment: segments[0] }
        : { type: "segments", segments },
    );
  });

  socket.on("request_canvas_history", () => {
    if (socketRateLimited(socket, "canvas-history", 4, 5_000)) return;
    const context = getPlayerRoom(socket);
    if (context) emitCanvasHistory(context.room, socket.id);
  });

  socket.on("send_room_chat", (payload, callback) => {
    const context = getPlayerRoom(socket);
    const text = cleanChatText(payload?.text);
    if (!context) {
      respond(callback, { ok: false, error: "你当前不在房间中" });
      return;
    }
    if (!text) {
      respond(callback, { ok: false, error: "消息不能为空" });
      return;
    }
    if (chatRateLimited(socket, "room")) {
      respond(callback, { ok: false, error: "发送得太快了，请稍后再试" });
      return;
    }
    pushMessage(context.room, {
      kind: "chat",
      playerId: context.player.id,
      name: context.player.name,
      text,
    });
    respond(callback, { ok: true });
  });

  socket.on("select_answer", (payload, callback) => {
    const context = getPlayerRoom(socket);
    if (!context || context.room.phase !== "drawing" || !context.room.current) {
      respond(callback, { ok: false, error: "现在不能选择答案" });
      return;
    }

    const { room, player } = context;
    if (socketRateLimited(socket, "answer", 12, 1_000)) {
      respond(callback, { ok: false, error: "修改答案过于频繁，请稍后再试" });
      return;
    }
    if (player.isSpectator) {
      respond(callback, { ok: false, error: "围观者不能参与答题" });
      return;
    }
    if (room.current.drawerId === player.id) {
      respond(callback, { ok: false, error: "作画者不能参与答题" });
      return;
    }
    if (room.current.questionType !== "choice") {
      respond(callback, { ok: false, error: "本轮不是选择题" });
      return;
    }

    const index = Number(payload?.index);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= room.current.answerOptions.length
    ) {
      respond(callback, { ok: false, error: "答案编号无效" });
      return;
    }

    room.current.answers.set(player.id, {
      index,
      selectedAt: Date.now(),
    });
    respond(callback, { ok: true, selectedAnswerIndex: index });
    emitState(room);
  });

  socket.on("select_search_answer", (payload, callback) => {
    const context = getPlayerRoom(socket);
    if (!context || context.room.phase !== "drawing" || !context.room.current) {
      respond(callback, { ok: false, error: "现在不能选择答案" });
      return;
    }

    const { room, player } = context;
    if (socketRateLimited(socket, "answer", 12, 1_000)) {
      respond(callback, { ok: false, error: "修改答案过于频繁，请稍后再试" });
      return;
    }
    if (player.isSpectator) {
      respond(callback, { ok: false, error: "围观者不能参与答题" });
      return;
    }
    if (room.current.drawerId === player.id) {
      respond(callback, { ok: false, error: "作画者不能参与答题" });
      return;
    }
    if (room.current.questionType !== "search") {
      respond(callback, { ok: false, error: "本轮不是搜索题" });
      return;
    }

    const name = String(payload?.name ?? "").trim().slice(0, 80);
    if (!getRoomWordBank(room).names.has(name)) {
      respond(callback, { ok: false, error: "请选择检索结果中的卡牌" });
      return;
    }

    room.current.answers.set(player.id, {
      name,
      selectedAt: Date.now(),
    });
    respond(callback, { ok: true, selectedAnswerName: name });
    emitState(room);
  });

  socket.on("restart_game", (_payload, callback) => {
    const context = getPlayerRoom(socket);
    if (!context || context.room.hostId !== context.player.id) {
      respond(callback, { ok: false, error: "只有房主可以再开一局" });
      return;
    }
    if (context.room.phase !== "gameOver") {
      respond(callback, { ok: false, error: "本局还没有结束" });
      return;
    }
    clearRoomTimer(context.room);
    context.room.phase = "lobby";
    context.room.current = null;
    context.room.startOrder = [];
    context.room.turnOrder = [];
    context.room.turnIndex = 0;
    context.room.totalTurns = 0;
    for (const [playerId, player] of context.room.players) {
      if (player.isBot) context.room.players.delete(playerId);
      else player.score = 0;
    }
    addSystemMessage(context.room, "房主准备开启新的一局。");
    emitState(context.room);
    respond(callback, { ok: true });
  });

  socket.on("leave_room", () => {
    const context = getPlayerRoom(socket);
    if (!context) return;
    socket.leave(context.room.code);
    removeOrDeactivatePlayer(context.room, context.player);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    emitLobbyState();
  });

  socket.on("disconnect", () => {
    onlinePlayers.delete(socket.id);
    emitLobbyState();
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.data.playerId);
    if (!room || !player || player.socketId !== socket.id || player.left) return;

    player.connected = false;
    player.socketId = null;
    emitState(room);
    player.disconnectTimer = setTimeout(() => {
      if (!player.connected && !player.left) {
        removeOrDeactivatePlayer(room, player, "掉线后未能重连");
      }
    }, RECONNECT_GRACE_MS);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`炉边画谜服务已启动：http://localhost:${PORT}`);
  console.log(`已载入 ${defaultWordBank.words.length} 个题目及 ${wordBanks.size} 个词库`);
  console.log(`已载入 ${cardCatalog.length} 条卡牌检索数据`);
});
