import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io as createClient } from "socket.io-client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function emitAck(socket, event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(3_000).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close(() => (port ? resolve(port) : reject(new Error("no free port"))));
    });
  });
}

async function waitForServer(url, child, getLogs) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`test server exited early:\n${getLogs()}`);
    }
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // The child server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`test server did not start:\n${getLogs()}`);
}

function trackState(socket, event = "room_state") {
  let current = null;
  const waiting = new Set();
  socket.on(event, (state) => {
    current = state;
    for (const waiter of waiting) waiter(state);
  });

  return {
    get current() {
      return current;
    },
    waitFor(predicate, timeout = 3_000) {
      if (current && predicate(current)) return Promise.resolve(current);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(check);
          reject(new Error("room state condition timed out"));
        }, timeout);
        const check = (state) => {
          if (!predicate(state)) return;
          clearTimeout(timer);
          waiting.delete(check);
          resolve(state);
        };
        waiting.add(check);
      });
    },
  };
}

async function startRound(t, answerMode, settings = {}) {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ROUND_TIME_OVERRIDE_MS: "1000",
      FINAL_REVEAL_OVERRIDE_MS: "200",
    },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const host = createClient(url, { transports: ["websocket"], forceNew: true });
  const guest = createClient(url, { transports: ["websocket"], forceNew: true });
  t.after(() => {
    host.disconnect();
    guest.disconnect();
  });
  const hostState = trackState(host);
  const guestState = trackState(guest);

  const created = await emitAck(host, "create_room", { name: "画师甲" });
  assert.equal(created.ok, true);
  const joined = await emitAck(guest, "join_room", {
    name: "猜客乙",
    roomCode: created.roomCode,
  });
  assert.equal(joined.ok, true);
  await hostState.waitFor((state) => state.players.length === 2);

  const configured = await emitAck(host, "update_settings", { answerMode, ...settings });
  assert.equal(configured.ok, true);

  const started = await emitAck(host, "start_game");
  assert.equal(started.ok, true);
  const choosing = await hostState.waitFor((state) => state.phase === "choosing");
  const guestChoosing = await guestState.waitFor((state) => state.phase === "choosing");
  assert.equal(choosing.isDrawer, true);
  assert.equal(choosing.round.options.length, 3);
  assert.equal(choosing.round.optionCards.length, 3);
  assert.deepEqual(
    choosing.round.optionCards.map((card) => card.name),
    choosing.round.options,
  );
  assert.ok(
    choosing.round.optionCards.every((card) =>
      /^\/api\/cards\/images\/.+\.png\?v=[a-f0-9]{12}$/u.test(card.imageUrl)
    ),
  );
  assert.ok(
    choosing.round.optionCards.every((card) =>
      ["MINION", "SPELL", "WEAPON", "HERO", "LOCATION"].includes(card.type)
    ),
  );
  assert.equal(guestChoosing.round.options.length, 0);
  assert.equal(guestChoosing.round.optionCards.length, 0);

  const answer = choosing.round.options[0];
  const selected = await emitAck(host, "choose_word", { word: answer });
  assert.equal(selected.ok, true);
  const drawing = await guestState.waitFor((state) => state.phase === "drawing");
  const drawerDrawing = await hostState.waitFor((state) => state.phase === "drawing");

  assert.equal(drawerDrawing.round.referenceCard.name, answer);
  assert.match(
    drawerDrawing.round.referenceCard.imageUrl,
    /^\/api\/cards\/images\/.+\.png\?v=[a-f0-9]{12}$/u,
  );
  assert.equal(drawerDrawing.round.clueCard, null);
  assert.equal(drawing.round.referenceCard, null);
  assert.deepEqual(Object.keys(drawing.round.clueCard), ["imageUrl"]);
  assert.match(
    drawing.round.clueCard.imageUrl,
    /^\/api\/cards\/images\/.+\.png\?v=[a-f0-9]{12}$/u,
  );
  assert.equal(drawing.round.finalRevealCard, null);
  assert.equal(drawing.round.durationMs, 1000);
  assert.equal(drawing.round.clues.stage, 0);
  assert.equal(drawing.round.clues.range, drawing.wordBankName);
  assert.equal(drawing.round.clues.scoreBand.maximum, 100);
  assert.equal(drawing.round.clues.scoreBand.minimum, 80);
  assert.equal(
    drawing.round.clues.fields.length,
    choosing.round.optionCards[0].type === "SPELL" ? 6 : 7,
  );
  assert.equal(
    drawing.round.clues.fields.find((field) => field.key === "length").source,
    "base",
  );
  assert.equal(
    drawing.round.clues.fields.find((field) => field.key === "text").source,
    "hidden",
  );
  assert.equal(hostState.current.round.clues, null);

  return { answer, choosing, drawing, guest, guestState, host, hostState, url };
}

test("an answerer can change a numbered choice before timeout", async (t) => {
  const { answer, drawing, guest, guestState, host, hostState } = await startRound(
    t,
    "choice",
  );
  assert.equal(drawing.round.questionType, "choice");
  assert.equal(drawing.round.answerOptions.length, 10);
  assert.equal(new Set(drawing.round.answerOptions).size, 10);
  assert.equal(drawing.round.answerOptionCards.length, 10);
  assert.deepEqual(
    drawing.round.answerOptionCards.map((card) => card.name),
    drawing.round.answerOptions,
  );
  assert.ok(
    drawing.round.answerOptionCards.every((card) =>
      /^\/api\/cards\/images\/.+\.png\?v=[a-f0-9]{12}$/u.test(card.imageUrl)
    ),
  );
  assert.equal(
    drawing.round.answerOptions.filter((word) => word === answer).length,
    1,
  );
  const correctCard = drawing.round.answerOptionCards.find(
    (card) => card.name === answer,
  );
  assert.ok(correctCard);
  assert.ok(
    drawing.round.answerOptionCards.every(
      (card) => card.type === correctCard.type,
    ),
  );
  assert.ok(
    drawing.round.answerOptions.every(
      (word) => [...word].length === drawing.round.wordLength,
    ),
  );
  assert.equal(hostState.current.round.answerOptions.length, 0);
  assert.equal(hostState.current.round.answerOptionCards.length, 0);

  const canvasEvent = new Promise((resolve) => guest.once("canvas_event", resolve));
  host.emit("canvas_event", {
    type: "segment",
    segment: {
      x0: 0.1,
      y0: 0.2,
      x1: 0.4,
      y1: 0.5,
      size: 7,
      color: "#17242a",
      tool: "brush",
    },
  });
  const receivedSegment = await canvasEvent;
  assert.equal(receivedSegment.type, "segment");
  assert.equal(receivedSegment.segment.x1, 0.4);

  const canvasBatch = new Promise((resolve) => guest.once("canvas_event", resolve));
  host.emit("canvas_event", {
    type: "segments",
    segments: [
      {
        x0: 0.4,
        y0: 0.5,
        x1: 0.5,
        y1: 0.6,
        size: 7,
        color: "#17242a",
        tool: "brush",
      },
      {
        x0: 0.5,
        y0: 0.6,
        x1: 0.6,
        y1: 0.7,
        size: 7,
        color: "#17242a",
        tool: "brush",
      },
    ],
  });
  const receivedBatch = await canvasBatch;
  assert.equal(receivedBatch.type, "segments");
  assert.equal(receivedBatch.segments.length, 2);

  const correctIndex = drawing.round.answerOptions.indexOf(answer);
  const wrongIndex = (correctIndex + 1) % drawing.round.answerOptions.length;
  const firstChoice = await emitAck(guest, "select_answer", { index: wrongIndex });
  assert.equal(firstChoice.ok, true);
  await guestState.waitFor(
    (state) => state.round.selectedAnswerIndex === wrongIndex,
  );

  const changedChoice = await emitAck(guest, "select_answer", {
    index: correctIndex,
  });
  assert.equal(changedChoice.ok, true);
  assert.equal(changedChoice.selectedAnswerIndex, correctIndex);
  await guestState.waitFor(
    (state) => state.round.selectedAnswerIndex === correctIndex,
  );

  const finalReveal = await guestState.waitFor(
    (state) => state.phase === "drawing" && state.round.finalRevealCard,
  );
  assert.equal(finalReveal.round.finalRevealCard.name, answer);
  assert.match(
    finalReveal.round.finalRevealCard.imageUrl,
    /^\/api\/cards\/images\/.+\.png\?v=[a-f0-9]{12}$/u,
  );

  const ended = await guestState.waitFor((state) => state.phase === "roundEnd");
  assert.equal(ended.round.word, answer);
  assert.equal(ended.round.answerCard.name, answer);
  assert.match(
    ended.round.answerCard.imageUrl,
    /^\/api\/cards\/images\/.+\.png\?v=[a-f0-9]{12}$/u,
  );
  const answerer = ended.players.find((player) => player.name === "猜客乙");
  assert.equal(answerer.answeredCorrectly, true);
  assert.ok(answerer.score >= 20 && answerer.score <= 100);
});

test("a search answer can be filtered, selected, and changed before timeout", async (t) => {
  const { answer, drawing, guest, guestState, hostState, url } = await startRound(
    t,
    "search",
  );
  assert.equal(drawing.round.questionType, "search");
  assert.equal(drawing.round.answerOptions.length, 0);
  assert.equal(drawing.round.answerOptionCards.length, 0);
  assert.equal(hostState.current.round.selectedAnswerName, "");

  const searchResponse = await fetch(
    `${url}/api/cards/search?name=${encodeURIComponent(answer)}`,
  );
  const searchData = await searchResponse.json();
  assert.equal(searchResponse.ok, true);
  assert.ok(searchData.results.some((card) => card.name === answer));
  assert.ok(searchData.results.every((card) => !("correct" in card)));

  const lengthResponse = await fetch(
    `${url}/api/cards/search?wordLength=${[...answer].length}`,
  );
  const lengthData = await lengthResponse.json();
  assert.equal(lengthResponse.ok, true);
  assert.ok(lengthData.results.length > 0);
  assert.equal(lengthData.page, 1);
  assert.ok(lengthData.pages >= 1);
  assert.ok(
    lengthData.results.every(
      (card) => card.wordLength === [...answer].length,
    ),
  );
  if (lengthData.pages > 1) {
    const nextPageResponse = await fetch(
      `${url}/api/cards/search?wordLength=${[...answer].length}&page=2`,
    );
    const nextPageData = await nextPageResponse.json();
    assert.equal(nextPageResponse.ok, true);
    assert.equal(nextPageData.page, 2);
    assert.equal(
      nextPageData.results.some((card) =>
        lengthData.results.some((firstPageCard) => firstPageCard.name === card.name)
      ),
      false,
    );
  }

  const armorResponse = await fetch(`${url}/api/cards/search?armor=7&wordBanks=hero`);
  const armorData = await armorResponse.json();
  assert.equal(armorResponse.ok, true);
  assert.ok(armorData.results.length > 0);
  assert.ok(armorData.results.every((card) => card.armor === 7));

  const wrongAnswer = answer === "霜之哀伤" ? "海拉" : "霜之哀伤";
  const firstChoice = await emitAck(guest, "select_search_answer", {
    name: wrongAnswer,
  });
  assert.equal(firstChoice.ok, true);
  await guestState.waitFor(
    (state) => state.round.selectedAnswerName === wrongAnswer,
  );

  const changedChoice = await emitAck(guest, "select_search_answer", {
    name: answer,
  });
  assert.equal(changedChoice.ok, true);
  assert.equal(changedChoice.selectedAnswerName, answer);
  await guestState.waitFor(
    (state) => state.round.selectedAnswerName === answer,
  );

  const ended = await guestState.waitFor((state) => state.phase === "roundEnd");
  assert.equal(ended.round.word, answer);
  const answerer = ended.players.find((player) => player.name === "猜客乙");
  assert.equal(answerer.answeredCorrectly, true);
  assert.ok(answerer.score >= 20 && answerer.score <= 100);
});

test("scope-aware staged hints preserve an early answer score", async (t) => {
  const { answer, drawing, guest, guestState } = await startRound(
    t,
    "search",
    { wordBankIds: ["legendary", "minion"] },
  );
  const initialFields = Object.fromEntries(
    drawing.round.clues.fields.map((field) => [field.key, field]),
  );
  assert.equal(drawing.wordBankName, "传说卡牌 · 随从");
  assert.equal(initialFields.type.value, "随从");
  assert.equal(initialFields.type.source, "scope");
  assert.equal(initialFields.rarity.value, "传说");
  assert.equal(initialFields.rarity.source, "scope");
  assert.equal(initialFields.class.value, "待揭示");
  assert.equal(initialFields.cost.value, "待揭示");
  assert.equal(initialFields.text.value, "待揭示");

  const selected = await emitAck(guest, "select_search_answer", { name: answer });
  assert.equal(selected.ok, true);
  const earlyState = await guestState.waitFor(
    (state) => state.round.clues.selectedScore !== null,
  );
  const earlyScore = earlyState.round.clues.selectedScore;
  assert.ok(earlyScore >= 80 && earlyScore <= 100);

  const firstHint = await guestState.waitFor(
    (state) => state.round.clues.stage === 1,
  );
  const firstFields = Object.fromEntries(
    firstHint.round.clues.fields.map((field) => [field.key, field]),
  );
  assert.equal(firstHint.round.clues.selectedScore, earlyScore);
  assert.equal(firstHint.round.clues.scoreBand.maximum, 70);
  assert.equal(firstFields.class.source, "hint");
  assert.match(firstFields.cost.value, /费/u);
  assert.equal(firstFields.stats.value, "待揭示");

  const secondHint = await guestState.waitFor(
    (state) => state.round.clues.stage === 2,
  );
  const secondFields = Object.fromEntries(
    secondHint.round.clues.fields.map((field) => [field.key, field]),
  );
  assert.equal(secondHint.round.clues.selectedScore, earlyScore);
  assert.equal(secondHint.round.clues.scoreBand.maximum, 40);
  assert.match(secondFields.cost.value, /^\d+ 费$/u);
  assert.notEqual(secondFields.stats.value, "待揭示");
  assert.equal(secondFields.text.source, "hint");
  assert.notEqual(secondFields.text.value, "待揭示");
  assert.doesNotMatch(secondFields.text.value, /<[^>]+>/u);
});

test("room word banks combine same-group unions with cross-group intersections", async (t) => {
  const { answer, choosing, drawing, guest, hostState, url } = await startRound(
    t,
    "search",
    { wordBankIds: ["common", "rare", "minion"] },
  );
  const cards = JSON.parse(
    await fs.readFile(path.join(root, "collectible_cards_zhCN.full.json"), "utf8"),
  );
  const filteredNames = new Set(
    cards
      .filter((card) =>
        ["COMMON", "RARE"].includes(card.rarity) && card.type === "MINION"
      )
      .map((card) => card.name),
  );

  assert.deepEqual(choosing.settings.wordBankIds, ["rare", "common", "minion"]);
  assert.equal(choosing.wordBankName, "稀有卡牌、普通卡牌 · 随从");
  assert.equal(choosing.wordBankCount, filteredNames.size);
  assert.ok(choosing.round.options.every((name) => filteredNames.has(name)));
  assert.ok(filteredNames.has(answer));
  assert.equal(drawing.round.questionType, "search");

  const filteredResponse = await fetch(
    `${url}/api/cards/search?wordBanks=common,rare,minion&name=${encodeURIComponent(answer)}`,
  );
  const filteredData = await filteredResponse.json();
  assert.ok(filteredData.results.some((card) => card.name === answer));

  const legendaryResponse = await fetch(
    `${url}/api/cards/search?wordBanks=common,rare,minion&name=${encodeURIComponent("霜之哀伤")}`,
  );
  const legendaryData = await legendaryResponse.json();
  assert.equal(legendaryData.total, 0);

  const rejected = await emitAck(guest, "select_search_answer", { name: "霜之哀伤" });
  assert.equal(rejected.ok, false);
  assert.deepEqual(hostState.current.settings.wordBankIds, ["rare", "common", "minion"]);
});

test("a solo host can start with an AI player that chooses and answers automatically", async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ROUND_TIME_OVERRIDE_MS: "300",
      ROUND_BREAK_OVERRIDE_MS: "100",
    },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const host = createClient(url, { transports: ["websocket"], forceNew: true });
  const hostState = trackState(host);
  const hostCanvasEvent = trackState(host, "canvas_event");
  const hostCanvas = trackState(host, "canvas_history");
  t.after(() => host.disconnect());

  const created = await emitAck(host, "create_room", { name: "单人测试房主" });
  assert.equal(created.ok, true);
  const soloLobby = await hostState.waitFor((state) => state.phase === "lobby");
  assert.equal(soloLobby.players.length, 1);
  assert.equal(soloLobby.canStart, true);

  await emitAck(host, "update_settings", {
    answerMode: "choice",
    roundsPerPlayer: 1,
  });
  const started = await emitAck(host, "start_game");
  assert.equal(started.ok, true);
  const choosing = await hostState.waitFor((state) => state.phase === "choosing");
  const bot = choosing.players.find((player) => player.isBot);
  assert.ok(bot);
  assert.equal(bot.name, "旅店老板 AI");
  assert.equal(bot.score, 0);
  assert.equal(choosing.players.length, 2);
  assert.equal(choosing.round.totalTurns, 2);
  assert.equal(choosing.isDrawer, true);

  await emitAck(host, "choose_word", { word: choosing.round.options[0] });
  const botAnswered = await hostState.waitFor(
    (state) =>
      state.phase === "drawing" &&
      state.players.some((player) => player.isBot && player.hasAnswered),
  );
  assert.equal(botAnswered.players.find((player) => player.isBot).hasAnswered, true);

  const aiDrawing = await hostState.waitFor(
    (state) =>
      state.phase === "drawing" &&
      state.players.find((player) => player.id === state.round.drawerId)?.isBot,
    3_000,
  );
  assert.equal(aiDrawing.isDrawer, false);
  assert.equal(aiDrawing.round.questionType, "choice");
  assert.equal(aiDrawing.round.answerOptionCards.length, 10);
  assert.ok(
    aiDrawing.messages.some((message) =>
      message.text.includes("AI 正在先画卡面椭圆"),
    ),
  );
  const aiStroke = await hostCanvasEvent.waitFor(
    (event) => event?.type === "segments" && event.segments.length > 0,
    1_000,
  );
  assert.ok(aiStroke.segments.length > 0);
  host.emit("request_canvas_history");
  const aiCanvas = await hostCanvas.waitFor(
    (history) => Array.isArray(history) && history.length > 0,
    1_000,
  );
  assert.ok(aiCanvas.length >= 10);
  const gameOver = await hostState.waitFor((state) => state.phase === "gameOver", 3_000);
  assert.equal(gameOver.players.find((player) => player.isBot).score, 0);
});

test("the public lobby lists players and keeps lobby chat separate from room chat", async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const host = createClient(url, { transports: ["websocket"], forceNew: true });
  const guest = createClient(url, { transports: ["websocket"], forceNew: true });
  const duplicate = createClient(url, { transports: ["websocket"], forceNew: true });
  t.after(() => {
    host.disconnect();
    guest.disconnect();
    duplicate.disconnect();
  });
  const hostLobby = trackState(host, "lobby_state");
  const guestLobby = trackState(guest, "lobby_state");
  const hostRoom = trackState(host);

  const hostEntered = await emitAck(host, "join_lobby", { name: "大厅玩家甲" });
  const guestEntered = await emitAck(guest, "join_lobby", { name: "大厅玩家乙" });
  assert.equal(hostEntered.ok, true);
  assert.equal(guestEntered.ok, true);
  const listed = await hostLobby.waitFor((state) => state.players.length === 2);
  assert.deepEqual(
    listed.players.map((player) => player.name).sort(),
    ["大厅玩家甲", "大厅玩家乙"].sort(),
  );
  assert.ok(listed.players.every((player) => player.status === "lobby"));

  const duplicateName = await emitAck(duplicate, "join_lobby", { name: "大厅玩家甲" });
  assert.equal(duplicateName.ok, false);

  const lobbyChat = await emitAck(host, "send_lobby_chat", { text: "大厅里好！" });
  assert.equal(lobbyChat.ok, true);
  const lobbyMessageState = await guestLobby.waitFor(
    (state) => state.messages.some((message) => message.text === "大厅里好！"),
  );
  assert.equal(lobbyMessageState.messages.at(-1).name, "大厅玩家甲");

  const created = await emitAck(host, "create_room", {
    name: "会被大厅昵称覆盖",
    roomName: "  传说   卡牌桌  ",
    roomRules: "每题 60 秒，禁止在聊天中直接写答案。",
  });
  assert.equal(created.ok, true);
  const advertisedRoom = await guestLobby.waitFor(
    (state) => state.rooms.some((room) => room.code === created.roomCode),
  );
  const listedRoom = advertisedRoom.rooms.find((room) => room.code === created.roomCode);
  assert.equal(listedRoom.name, "传说 卡牌桌");
  assert.equal(listedRoom.rules, "每题 60 秒，禁止在聊天中直接写答案。");
  assert.equal(listedRoom.hostName, "大厅玩家甲");
  assert.equal(listedRoom.playerCount, 1);
  assert.equal(listedRoom.maxPlayers, 8);
  assert.equal(listedRoom.status, "waiting");
  assert.equal(listedRoom.joinable, true);

  const detailsUpdated = await emitAck(host, "update_room_details", {
    roomName: "周末联机桌",
    roomRules: "轮流作画；倒计时结束前可以修改答案。",
  });
  assert.equal(detailsUpdated.ok, true);
  const renamedRoomState = await guestLobby.waitFor(
    (state) => state.rooms.some(
      (room) => room.code === created.roomCode && room.name === "周末联机桌",
    ),
  );
  const renamedRoom = renamedRoomState.rooms.find((room) => room.code === created.roomCode);
  assert.equal(renamedRoom.rules, "轮流作画；倒计时结束前可以修改答案。");

  const joined = await emitAck(guest, "join_room", {
    name: "同样不会改名",
    roomCode: created.roomCode,
  });
  assert.equal(joined.ok, true);
  const roomReady = await hostRoom.waitFor((state) => state.players.length === 2);
  assert.deepEqual(
    roomReady.players.map((player) => player.name).sort(),
    ["大厅玩家甲", "大厅玩家乙"].sort(),
  );
  assert.equal(roomReady.name, "周末联机桌");
  assert.equal(roomReady.rules, "轮流作画；倒计时结束前可以修改答案。");
  const populatedRoomState = await guestLobby.waitFor(
    (state) => state.rooms.some(
      (room) => room.code === created.roomCode && room.playerCount === 2,
    ),
  );
  assert.equal(
    populatedRoomState.rooms.find((room) => room.code === created.roomCode).playerCount,
    2,
  );

  const guestEdit = await emitAck(guest, "update_room_details", {
    roomName: "越权修改",
    roomRules: "不应该成功",
  });
  assert.equal(guestEdit.ok, false);

  const roomStatuses = await hostLobby.waitFor(
    (state) => state.players.length === 2 && state.players.every((player) => player.status === "room"),
  );
  assert.ok(roomStatuses.players.every((player) => player.status === "room"));

  const receivedRoomChat = new Promise((resolve) => guest.once("chat_message", resolve));
  const roomChat = await emitAck(host, "send_room_chat", { text: "房间里好！" });
  assert.equal(roomChat.ok, true);
  const roomMessage = await receivedRoomChat;
  assert.equal(roomMessage.text, "房间里好！");
  assert.equal(roomMessage.name, "大厅玩家甲");
  assert.ok(!guestLobby.current.messages.some((message) => message.text === "房间里好！"));

  const blockedLobbyChat = await emitAck(host, "send_lobby_chat", { text: "不应发送" });
  assert.equal(blockedLobbyChat.ok, false);
});

test("a connected player cannot create, join, or resume into another room", async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const firstHost = createClient(url, { transports: ["websocket"], forceNew: true });
  const secondHost = createClient(url, { transports: ["websocket"], forceNew: true });
  t.after(() => firstHost.disconnect());
  t.after(() => secondHost.disconnect());

  const firstRoom = await emitAck(firstHost, "create_room", { name: "单房间玩家" });
  const secondRoom = await emitAck(secondHost, "create_room", { name: "另一桌房主" });
  assert.equal(firstRoom.ok, true);
  assert.equal(secondRoom.ok, true);

  const repeatedCreate = await emitAck(firstHost, "create_room", { name: "单房间玩家" });
  assert.equal(repeatedCreate.ok, false);
  assert.match(repeatedCreate.error, /先离开当前房间/u);

  const crossRoomJoin = await emitAck(firstHost, "join_room", {
    name: "单房间玩家",
    roomCode: secondRoom.roomCode,
  });
  assert.equal(crossRoomJoin.ok, false);

  const crossRoomResume = await emitAck(firstHost, "resume_session", {
    roomCode: secondRoom.roomCode,
    playerToken: secondRoom.playerToken,
  });
  assert.equal(crossRoomResume.ok, false);

  const health = await fetch(`${url}/api/health`).then((response) => response.json());
  assert.equal(health.rooms, 2);
});

test("the server enforces the configured global room limit", async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MAX_ROOMS: "10" },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const clients = [];
  t.after(() => clients.forEach((client) => client.disconnect()));
  for (let index = 0; index < 11; index += 1) {
    clients.push(createClient(url, { transports: ["websocket"], forceNew: true }));
  }

  for (let index = 0; index < 10; index += 1) {
    const response = await emitAck(clients[index], "create_room", {
      name: `限额玩家${index}`,
    });
    assert.equal(response.ok, true);
  }
  const rejected = await emitAck(clients[10], "create_room", { name: "超额玩家" });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /牌桌数量已满/u);
});

test("the game immediately advances when the drawer leaves while choosing", async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const host = createClient(url, { transports: ["websocket"], forceNew: true });
  const firstGuest = createClient(url, { transports: ["websocket"], forceNew: true });
  const secondGuest = createClient(url, { transports: ["websocket"], forceNew: true });
  const firstGuestState = trackState(firstGuest);
  t.after(() => host.disconnect());
  t.after(() => firstGuest.disconnect());
  t.after(() => secondGuest.disconnect());

  const created = await emitAck(host, "create_room", { name: "离场画师" });
  await emitAck(firstGuest, "join_room", {
    name: "接棒画师",
    roomCode: created.roomCode,
  });
  await emitAck(secondGuest, "join_room", {
    name: "继续答题者",
    roomCode: created.roomCode,
  });
  await firstGuestState.waitFor((state) => state.players.length === 3);
  await emitAck(host, "start_game");
  const firstTurn = await firstGuestState.waitFor((state) => state.phase === "choosing");
  const departedDrawerId = firstTurn.round.drawerId;

  host.emit("leave_room");
  const nextTurn = await firstGuestState.waitFor(
    (state) => state.phase === "choosing" && state.round.drawerId !== departedDrawerId,
  );
  assert.equal(nextTurn.round.turn, 2);
  assert.ok(nextTurn.players.some((player) => player.id === nextTurn.round.drawerId));
});

test("a spectator can watch a running room and join from the next round at zero points", async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ROUND_TIME_OVERRIDE_MS: "250",
      ROUND_BREAK_OVERRIDE_MS: "120",
    },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const host = createClient(url, { transports: ["websocket"], forceNew: true });
  const guest = createClient(url, { transports: ["websocket"], forceNew: true });
  const spectator = createClient(url, { transports: ["websocket"], forceNew: true });
  t.after(() => {
    host.disconnect();
    guest.disconnect();
    spectator.disconnect();
  });

  const hostState = trackState(host);
  const guestState = trackState(guest);
  const spectatorState = trackState(spectator);
  const spectatorLobby = trackState(spectator, "lobby_state");

  const created = await emitAck(host, "create_room", {
    name: "围观测试房主",
    roomName: "正在进行的围观牌桌",
  });
  await emitAck(guest, "join_room", {
    name: "围观测试玩家",
    roomCode: created.roomCode,
  });
  await emitAck(spectator, "join_lobby", { name: "围观测试观众" });
  await hostState.waitFor((state) => state.players.length === 2);

  const started = await emitAck(host, "start_game");
  assert.equal(started.ok, true);
  const [hostChoosing, guestChoosing] = await Promise.all([
    hostState.waitFor((state) => state.phase === "choosing"),
    guestState.waitFor((state) => state.phase === "choosing"),
  ]);
  const drawer = hostChoosing.isDrawer ? host : guest;
  const drawerState = hostChoosing.isDrawer ? hostState : guestState;

  const advertised = await spectatorLobby.waitFor((state) =>
    state.rooms.some(
      (room) => room.code === created.roomCode && room.status === "playing",
    ),
  );
  const advertisedRoom = advertised.rooms.find(
    (room) => room.code === created.roomCode,
  );
  assert.equal(advertisedRoom.spectatable, true);
  assert.equal(advertisedRoom.spectatorCount, 0);

  const blockedDirectJoin = await emitAck(spectator, "join_room", {
    roomCode: created.roomCode,
  });
  assert.equal(blockedDirectJoin.ok, false);
  assert.equal(blockedDirectJoin.error, "游戏已经开始，请先进入围观席");

  const watched = await emitAck(spectator, "join_room", {
    roomCode: created.roomCode,
    joinMode: "spectate",
  });
  assert.equal(watched.ok, true);
  assert.equal(watched.isSpectator, true);
  const watching = await spectatorState.waitFor((state) => state.isSpectator);
  assert.equal(watching.round.options.length, 0);
  assert.equal(watching.players.find((player) => player.name === "围观测试观众").isSpectator, true);
  const spectatorListed = await spectatorLobby.waitFor((state) =>
    state.rooms.some(
      (room) => room.code === created.roomCode && room.spectatorCount === 1,
    ),
  );
  assert.equal(
    spectatorListed.players.find((player) => player.name === "围观测试观众").status,
    "spectating",
  );

  const answer = drawerState.current.round.options[0];
  await emitAck(drawer, "choose_word", { word: answer });
  const spectatorDrawing = await spectatorState.waitFor(
    (state) => state.phase === "drawing",
  );
  assert.equal(spectatorDrawing.round.referenceCard, null);
  assert.equal(spectatorDrawing.round.answerOptions.length, 0);
  assert.equal(spectatorDrawing.round.answerOptionCards.length, 0);

  const blockedAnswer = await emitAck(spectator, "select_answer", { index: 0 });
  assert.equal(blockedAnswer.ok, false);
  assert.equal(blockedAnswer.error, "围观者不能参与答题");

  const queued = await emitAck(spectator, "join_next_round");
  assert.equal(queued.ok, true);
  assert.equal(queued.joinQueued, true);
  await spectatorState.waitFor((state) => state.joinQueued);

  const promoted = await spectatorState.waitFor(
    (state) => state.phase === "choosing" && !state.isSpectator,
  );
  const promotedPlayer = promoted.players.find(
    (player) => player.name === "围观测试观众",
  );
  assert.equal(promotedPlayer.isSpectator, false);
  assert.equal(promotedPlayer.score, 0);
  assert.equal(promoted.round.totalTurns, 6);

  const updatedListing = await spectatorLobby.waitFor((state) =>
    state.rooms.some(
      (room) =>
        room.code === created.roomCode &&
        room.playerCount === 3 &&
        room.spectatorCount === 0,
    ),
  );
  assert.equal(
    updatedListing.rooms.find((room) => room.code === created.roomCode).status,
    "playing",
  );

  const controllers = new Map([
    [hostChoosing.selfId, { socket: host, state: hostState }],
    [guestChoosing.selfId, { socket: guest, state: guestState }],
    [promoted.selfId, { socket: spectator, state: spectatorState }],
  ]);
  const drawerOrder = [hostChoosing.round.drawerId];
  let turnState = promoted;
  while (turnState.phase === "choosing") {
    const turn = turnState.round.turn;
    const controller = controllers.get(turnState.round.drawerId);
    assert.ok(controller);
    drawerOrder.push(turnState.round.drawerId);
    const drawerView = await controller.state.waitFor(
      (state) => state.phase === "choosing" && state.round.key === turnState.round.key,
    );
    const chosen = await emitAck(controller.socket, "choose_word", {
      word: drawerView.round.options[0],
    });
    assert.equal(chosen.ok, true);
    turnState = await spectatorState.waitFor(
      (state) =>
        state.phase === "gameOver" ||
        (state.phase === "choosing" && state.round.turn > turn),
      5_000,
    );
  }
  assert.deepEqual(drawerOrder, [
    hostChoosing.selfId,
    guestChoosing.selfId,
    promoted.selfId,
    hostChoosing.selfId,
    guestChoosing.selfId,
    promoted.selfId,
  ]);
});

test("a reconnecting player keeps their nickname and resumes atomically", async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const original = createClient(url, { transports: ["websocket"], forceNew: true });
  const squatter = createClient(url, { transports: ["websocket"], forceNew: true });
  const resumed = createClient(url, { transports: ["websocket"], forceNew: true });
  t.after(() => {
    original.disconnect();
    squatter.disconnect();
    resumed.disconnect();
  });

  const created = await emitAck(original, "create_room", {
    name: "重连保留昵称",
    roomName: "重连原子性测试",
  });
  assert.equal(created.ok, true);
  original.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 100));

  const occupied = await emitAck(squatter, "join_lobby", { name: "重连保留昵称" });
  assert.equal(occupied.ok, false);
  assert.match(occupied.error, /昵称/u);

  const restored = await emitAck(resumed, "resume_session", {
    roomCode: created.roomCode,
    playerToken: created.playerToken,
  });
  assert.equal(restored.ok, true);
  const hostMutation = await emitAck(resumed, "update_settings", { roundTime: 90 });
  assert.equal(hostMutation.ok, true);
});

test("socket origins, lobby membership, and direct-client IP limits are enforced", async (t) => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), TRUST_PROXY_HEADERS: "false" },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  const rejected = createClient(url, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
    extraHeaders: { Origin: "https://untrusted.example" },
  });
  t.after(() => rejected.disconnect());
  const originError = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("untrusted origin was not rejected")), 2_000);
    rejected.once("connect", () => {
      clearTimeout(timer);
      reject(new Error("untrusted origin connected"));
    });
    rejected.once("connect_error", (error) => {
      clearTimeout(timer);
      resolve(error);
    });
  });
  assert.ok(originError instanceof Error);

  const trusted = createClient(url, {
    transports: ["websocket"],
    forceNew: true,
    extraHeaders: { Origin: url },
  });
  t.after(() => trusted.disconnect());
  let lastMembershipResponse = null;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    lastMembershipResponse = await emitAck(trusted, "join_lobby", {
      name: "大厅限频测试",
    });
  }
  assert.equal(lastMembershipResponse.ok, false);
  assert.match(lastMembershipResponse.error, /频繁/u);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(`${url}/api/cards/search`, {
      headers: { "x-forwarded-for": "198.51.100.10" },
    });
    assert.equal(response.status, 200);
  }
  const spoofedAddress = await fetch(`${url}/api/cards/search`, {
    headers: { "x-forwarded-for": "198.51.100.11" },
  });
  assert.equal(spoofedAddress.status, 429);
});

test("the newest cached card image wins without consuming the upstream allowance", async (t) => {
  const imageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "hearth-draw-images-"));
  const webpPath = path.join(imageDirectory, "AV_204.webp");
  await fs.writeFile(webpPath, Buffer.alloc(1_024, 1));
  await fs.utimes(webpPath, new Date(0), new Date(0));
  await fs.writeFile(path.join(imageDirectory, "AV_204.png"), Buffer.alloc(1_024, 2));
  t.after(() => fs.rm(imageDirectory, { force: true, recursive: true }));

  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  let childLogs = "";
  const child = spawn(process.execPath, [path.join(root, "server", "index.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), CARD_IMAGE_DIR: imageDirectory },
    stdio: "pipe",
  });
  child.stdout.on("data", (chunk) => { childLogs += chunk; });
  child.stderr.on("data", (chunk) => { childLogs += chunk; });
  t.after(() => child.kill());
  await waitForServer(url, child, () => childLogs);

  for (let attempt = 0; attempt < 250; attempt += 1) {
    const response = await fetch(`${url}/api/cards/images/AV_204.png`);
    assert.equal(response.status, 200);
    const image = new Uint8Array(await response.arrayBuffer());
    assert.equal(image[0], 2);
    assert.equal(response.headers.get("content-type"), "image/png");
  }
});
