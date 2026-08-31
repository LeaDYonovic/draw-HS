import { useEffect, useRef, useState } from "react";
import { CanvasBoard } from "./components/CanvasBoard";
import { CardImage } from "./components/CardImage";
import { ClueCardWidget } from "./components/ClueCardWidget";
import { emitWithAck, socket } from "./realtime";
import { calculateScore } from "./score-rules.mjs";
import { watchForAppUpdates } from "./version-watch";
import type {
  CardPreview,
  ChatMessage,
  GameSettings,
  LobbyState,
  PlayerState,
  RoomState,
  ServerResponse,
} from "./types";

const SESSION_KEY = "hearth-draw-session";
const NAME_KEY = "hearth-draw-name";
const PAGE_SCALE_KEY = "hearth-draw-page-scale";
const FONT_SCALE_KEY = "hearth-draw-font-scale";
const PAGE_SCALE_STEPS = [80, 90, 100, 110, 120] as const;
const FONT_SCALE_STEPS = [90, 100, 110, 120, 130] as const;
const DEFAULT_ROOM_RULES = "轮流从三张卡牌中选题作画，其他玩家从十个候选答案中选择并提交。";
const CARD_TYPE_LABELS: Record<string, string> = {
  MINION: "随从",
  SPELL: "法术",
  WEAPON: "武器",
  HERO: "英雄",
  LOCATION: "地标",
};

interface SavedSession {
  roomCode: string;
  playerToken: string;
}

function readSession(): SavedSession | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    return value ? (JSON.parse(value) as SavedSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: SavedSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.history.replaceState({}, "", `?room=${session.roomCode}`);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  window.history.replaceState({}, "", window.location.pathname);
}

function readPageScale() {
  const saved = Number(localStorage.getItem(PAGE_SCALE_KEY));
  if (PAGE_SCALE_STEPS.includes(saved as (typeof PAGE_SCALE_STEPS)[number])) return saved;
  return window.innerWidth > 760 && window.innerHeight < 960 ? 90 : 100;
}

function readFontScale() {
  const saved = Number(localStorage.getItem(FONT_SCALE_KEY));
  if (FONT_SCALE_STEPS.includes(saved as (typeof FONT_SCALE_STEPS)[number])) return saved;
  return 100;
}

export function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [lobby, setLobby] = useState<LobbyState>({ players: [], rooms: [], messages: [] });
  const [lobbyName, setLobbyName] = useState("");
  const lobbyNameRef = useRef("");
  const [connected, setConnected] = useState(socket.connected);
  const [pageScale, setPageScale] = useState(readPageScale);
  const [fontScale, setFontScale] = useState(readFontScale);
  const [toast, setToast] = useState("");

  useEffect(() => watchForAppUpdates(), []);

  useEffect(() => {
    const onConnect = async () => {
      setConnected(true);
      const session = readSession();
      if (session) {
        const response = await emitWithAck("resume_session", { ...session });
        if (response.ok) return;
        clearSession();
        setRoom(null);
      }
      if (lobbyNameRef.current) {
        await emitWithAck("join_lobby", { name: lobbyNameRef.current });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onRoomState = (state: RoomState) => {
      setRoom(state);
      if (state.sessionName) {
        lobbyNameRef.current = state.sessionName;
        setLobbyName(state.sessionName);
      }
    };
    const onLobbyState = (state: LobbyState) => setLobby({ ...state, rooms: state.rooms ?? [] });
    const onChatMessage = (message: ChatMessage) => {
      setRoom((current) => {
        if (!current || current.messages.some((item) => item.id === message.id)) {
          return current;
        }
        return {
          ...current,
          messages: [...current.messages, message].slice(-80),
        };
      });
    };
    const onRoomClosed = (payload?: { message?: string }) => {
      clearSession();
      setRoom(null);
      setToast(payload?.message || "牌桌已经关闭");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room_state", onRoomState);
    socket.on("lobby_state", onLobbyState);
    socket.on("chat_message", onChatMessage);
    socket.on("room_closed", onRoomClosed);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room_state", onRoomState);
      socket.off("lobby_state", onLobbyState);
      socket.off("chat_message", onChatMessage);
      socket.off("room_closed", onRoomClosed);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale}%`;
  }, [fontScale]);

  const showError = (message?: string) => setToast(message || "操作失败，请重试");

  const enterLobby = async (name: string) => {
    const response = await emitWithAck("join_lobby", { name });
    if (!response.ok || !response.name) {
      showError(response.error);
      return false;
    }
    localStorage.setItem(NAME_KEY, response.name);
    lobbyNameRef.current = response.name;
    setLobbyName(response.name);
    return true;
  };

  const leaveLobby = async () => {
    const response = await emitWithAck("leave_lobby");
    if (!response.ok) {
      showError(response.error);
      return;
    }
    lobbyNameRef.current = "";
    setLobbyName("");
  };

  const leaveRoom = () => {
    socket.emit("leave_room");
    clearSession();
    setRoom(null);
  };

  const changePageScale = (nextScale: number) => {
    if (!PAGE_SCALE_STEPS.includes(nextScale as (typeof PAGE_SCALE_STEPS)[number])) return;
    localStorage.setItem(PAGE_SCALE_KEY, String(nextScale));
    setPageScale(nextScale);
  };

  const changeFontScale = (nextScale: number) => {
    if (!FONT_SCALE_STEPS.includes(nextScale as (typeof FONT_SCALE_STEPS)[number])) return;
    localStorage.setItem(FONT_SCALE_KEY, String(nextScale));
    setFontScale(nextScale);
  };

  const scale = pageScale / 100;
  const scaledViewportStyle = {
    "--page-scale": scale,
  } as React.CSSProperties;

  return (
    <main className="app-shell">
      <div className="ambient-glow glow-one" />
      <div className="ambient-glow glow-two" />
      <div className="scaled-viewport" style={scaledViewportStyle}>
        {room ? (
          room.phase === "lobby" ? (
            <RoomLobby
              onError={showError}
              onLeave={leaveRoom}
              onToast={setToast}
              room={room}
            />
          ) : room.phase === "gameOver" ? (
            <GameOver onError={showError} onLeave={leaveRoom} room={room} />
          ) : (
            <GameRoom onError={showError} onLeave={leaveRoom} room={room} />
          )
        ) : lobbyName ? (
          <GameLobby
            connected={connected}
            lobby={lobby}
            name={lobbyName}
            onError={showError}
            onLeave={leaveLobby}
          />
        ) : (
          <Home connected={connected} onEnter={enterLobby} />
        )}
        {!connected && <div className="connection-banner">正在重新连接酒馆...</div>}
        {toast && <div className="toast">{toast}</div>}
      </div>
      <DisplaySettings
        fontScale={fontScale}
        onFontScaleChange={changeFontScale}
        onPageScaleChange={changePageScale}
        pageScale={pageScale}
      />
    </main>
  );
}

function DisplaySettings({
  fontScale,
  onFontScaleChange,
  onPageScaleChange,
  pageScale,
}: {
  fontScale: number;
  onFontScaleChange: (scale: number) => void;
  onPageScaleChange: (scale: number) => void;
  pageScale: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <div className={`display-settings ${open ? "open" : ""}`}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="display-settings-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true" className="settings-glyph" />
        显示设置
      </button>
      {open && (
        <section aria-label="显示设置" aria-modal="false" className="display-settings-panel" role="dialog">
          <header>
            <div>
              <strong>显示设置</strong>
              <small>按你的屏幕调整阅读大小</small>
            </div>
            <button aria-label="关闭显示设置" onClick={() => setOpen(false)} type="button">×</button>
          </header>
          <SettingsStepper
            label="字体大小"
            onChange={onFontScaleChange}
            steps={FONT_SCALE_STEPS}
            value={fontScale}
          />
          <SettingsStepper
            label="页面缩放"
            onChange={onPageScaleChange}
            steps={PAGE_SCALE_STEPS}
            value={pageScale}
          />
          <button
            className="display-settings-reset"
            disabled={fontScale === 100 && pageScale === 100}
            onClick={() => {
              onFontScaleChange(100);
              onPageScaleChange(100);
            }}
            type="button"
          >
            恢复默认大小
          </button>
        </section>
      )}
    </div>
  );
}

function SettingsStepper({
  label,
  onChange,
  steps,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  steps: readonly number[];
  value: number;
}) {
  const index = steps.indexOf(value);

  return (
    <div className="settings-stepper">
      <span>{label}</span>
      <div aria-label={label} role="group">
        <button aria-label={`减小${label}`} disabled={index <= 0} onClick={() => onChange(steps[index - 1])} type="button">−</button>
        <output aria-live="polite">{value}%</output>
        <button aria-label={`增大${label}`} disabled={index >= steps.length - 1} onClick={() => onChange(steps[index + 1])} type="button">+</button>
      </div>
    </div>
  );
}

function Home({
  connected,
  onEnter,
}: {
  connected: boolean;
  onEnter: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(localStorage.getItem(NAME_KEY) ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !connected) return;
    setBusy(true);
    await onEnter(name);
    setBusy(false);
  };

  return (
    <div className="home-layout page-enter">
      <section className="hero-copy">
        <div className="eyebrow">5,993 张炉石卡牌 · 一块实时画板</div>
        <div className="brand-lockup">
          <div className="brand-gem"><span /></div>
          <div>
            <h1>炉边画谜</h1>
            <p className="brand-subtitle">用画笔召唤你的卡牌记忆</p>
          </div>
        </div>
        <p className="hero-description">
          创建一桌，把房间号发给朋友。轮流抽取炉石卡牌名作画，从十张候选卡牌中提交答案。
        </p>
        <div className="feature-strip">
          <span>在线玩家大厅</span>
          <span>十选一 + 搜索辅助</span>
          <span>大厅与房间聊天</span>
        </div>
      </section>

      <section className="tavern-card entry-card">
        <div className="card-rivet top-left" />
        <div className="card-rivet top-right" />
        <div className="entry-welcome">
          <span className="section-kicker">公共大厅</span>
          <h2>先在酒馆里亮个相</h2>
          <p>进入后可以看到全部在线玩家、聊天，并创建或加入牌桌。</p>
        </div>
        <form className="entry-form" onSubmit={submit}>
          <label>
            <span>你的昵称</span>
            <input
              autoComplete="nickname"
              autoFocus
              maxLength={12}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：鱼人画师"
              value={name}
            />
          </label>
          <button
            className="primary-button large"
            disabled={busy || !connected || !name.trim()}
            type="submit"
          >
            {busy ? "正在推开酒馆门..." : "进入游戏大厅"}
          </button>
        </form>
        <p className="fan-note">非商业同人游戏，题目来源于本地中文卡牌词库。</p>
      </section>
    </div>
  );
}

function GameLobby({
  connected,
  lobby,
  name,
  onError,
  onLeave,
}: {
  connected: boolean;
  lobby: LobbyState;
  name: string;
  onError: (message?: string) => void;
  onLeave: () => void;
}) {
  const queryCode = new URLSearchParams(window.location.search).get("room") ?? "";
  const [mode, setMode] = useState<"create" | "join">(queryCode ? "join" : "create");
  const [roomCode, setRoomCode] = useState(queryCode.toUpperCase());
  const [roomName, setRoomName] = useState(`${name}的牌桌`);
  const [roomRules, setRoomRules] = useState(DEFAULT_ROOM_RULES);
  const [joinMode, setJoinMode] = useState<"play" | "spectate">("play");
  const [busy, setBusy] = useState(false);
  const [joiningCode, setJoiningCode] = useState("");

  const completeRoomEntry = (response: ServerResponse) => {
    if (!response.ok || !response.roomCode || !response.playerToken) {
      onError(response.error);
      return;
    }
    saveSession({ roomCode: response.roomCode, playerToken: response.playerToken });
  };

  const enterRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !connected) return;
    setBusy(true);
    const response = await emitWithAck(
      mode === "create" ? "create_room" : "join_room",
      mode === "create"
        ? { name, roomName, roomRules }
        : { name, roomCode, joinMode },
    );
    setBusy(false);
    completeRoomEntry(response);
  };

  const joinListedRoom = async (code: string, requestedMode: "play" | "spectate") => {
    if (busy || !connected) return;
    setBusy(true);
    setJoiningCode(`${code}:${requestedMode}`);
    const response = await emitWithAck("join_room", {
      name,
      roomCode: code,
      joinMode: requestedMode,
    });
    setBusy(false);
    setJoiningCode("");
    completeRoomEntry(response);
  };

  const statusLabel = {
    lobby: "大厅中",
    room: "组队中",
    game: "游戏中",
    spectating: "围观中",
  } as const;

  return (
    <div className="public-lobby-page page-enter">
      <header className="compact-header">
        <MiniBrand />
        <div className="lobby-self">
          <span>当前昵称</span><strong>{name}</strong>
          <button className="text-button" onClick={onLeave} type="button">离开大厅</button>
        </div>
      </header>

      <div className="public-lobby-heading">
        <div>
          <span className="section-kicker">ONLINE TAVERN</span>
          <h1>炉边玩家大厅</h1>
        </div>
        <div className="online-total"><span className="live-dot" /><strong>{lobby.players.length}</strong> 人在线</div>
      </div>

      <div className="public-lobby-grid">
        <section className="online-roster">
          <div className="panel-title"><strong>在线玩家</strong><span>所有昵称</span></div>
          <div className="online-player-list">
            {lobby.players.map((player, index) => (
              <div className="online-player" key={player.id}>
                <Avatar index={index} name={player.name} />
                <div><strong>{player.name}</strong><span>{statusLabel[player.status]}</span></div>
                <i className={`presence-dot ${player.status}`} />
              </div>
            ))}
          </div>
        </section>

        <LobbyChatPanel lobby={lobby} onError={onError} />

        <div className="lobby-room-column">
          <section className="room-directory">
            <div className="panel-title"><strong>可加入房间</strong><span>{lobby.rooms.length} 个房间</span></div>
            <div className="room-directory-list">
              {lobby.rooms.length === 0 ? (
                <div className="room-directory-empty"><strong>还没有牌桌</strong><span>创建一桌，等朋友加入吧</span></div>
              ) : lobby.rooms.map((listedRoom) => (
                <article className={`listed-room ${listedRoom.joinable || listedRoom.spectatable ? "joinable" : ""}`} key={listedRoom.code}>
                  <div className="listed-room-heading">
                    <div><strong>{listedRoom.name}</strong><span>#{listedRoom.code}</span></div>
                    <i className={listedRoom.status}>
                      {listedRoom.status === "waiting" ? "等待中" : listedRoom.status === "playing" ? "游戏中" : "已结束"}
                    </i>
                  </div>
                  <p>{listedRoom.rules}</p>
                  <div className="listed-room-meta">
                    <span>房主 {listedRoom.hostName}</span>
                    <span>
                      {listedRoom.playerCount} / {listedRoom.maxPlayers} 人
                      {listedRoom.spectatorCount > 0 ? ` · ${listedRoom.spectatorCount} 人围观` : ""}
                    </span>
                  </div>
                  <div className="listed-room-actions">
                    {listedRoom.status === "waiting" ? (
                      <button
                        disabled={!listedRoom.joinable || busy || !connected}
                        onClick={() => joinListedRoom(listedRoom.code, "play")}
                        type="button"
                      >
                        {joiningCode === `${listedRoom.code}:play` ? "正在入座..." : listedRoom.joinable ? "加入牌桌" : "房间已满"}
                      </button>
                    ) : listedRoom.status === "playing" ? (
                      <button
                        disabled={!listedRoom.spectatable || busy || !connected}
                        onClick={() => joinListedRoom(listedRoom.code, "spectate")}
                        type="button"
                      >
                        {joiningCode === `${listedRoom.code}:spectate` ? "正在进入围观..." : listedRoom.spectatable ? "进入围观" : "围观席已满"}
                      </button>
                    ) : (
                      <button disabled type="button">本局已结束</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="tavern-card lobby-room-actions">
            <div className="mode-tabs" role="tablist">
              <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")} role="tab" type="button">创建牌桌</button>
              <button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")} role="tab" type="button">房间号加入</button>
            </div>
            <form className="entry-form" onSubmit={enterRoom}>
              {mode === "create" ? (
                <>
                  <label>
                    <span>房间名称</span>
                    <input maxLength={24} onChange={(event) => setRoomName(event.target.value)} value={roomName} />
                  </label>
                  <label>
                    <span>房间说明（规则）</span>
                    <textarea maxLength={180} onChange={(event) => setRoomRules(event.target.value)} rows={3} value={roomRules} />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>四位房间号</span>
                    <input
                      autoComplete="off"
                      className="room-code-input"
                      maxLength={4}
                      onChange={(event) => setRoomCode(event.target.value.replace(/[^a-z0-9]/giu, "").toUpperCase())}
                      placeholder="AB12"
                      value={roomCode}
                    />
                  </label>
                  <div className="join-mode-picker" role="group" aria-label="加入方式">
                    <button className={joinMode === "play" ? "active" : ""} onClick={() => setJoinMode("play")} type="button">加入比赛</button>
                    <button className={joinMode === "spectate" ? "active" : ""} onClick={() => setJoinMode("spectate")} type="button">只围观</button>
                  </div>
                  <small className="join-mode-note">
                    {joinMode === "spectate" ? "进入正在进行的对局观看，并可申请下一轮参战。" : "游戏已开始时，请先选择围观。"}
                  </small>
                </>
              )}
              <button
                className="primary-button large"
                disabled={busy || !connected || (mode === "create" ? !roomName.trim() || !roomRules.trim() : roomCode.length !== 4)}
                type="submit"
              >
                {busy ? "正在准备牌桌..." : mode === "create" ? "创建新牌桌" : joinMode === "spectate" ? "进入围观" : "加入这一桌"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function LobbyChatPanel({ lobby, onError }: { lobby: LobbyState; onError: (message?: string) => void }) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lobby.messages.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    const response = await emitWithAck("send_lobby_chat", { text });
    if (!response.ok) {
      onError(response.error);
      return;
    }
    setText("");
  };

  return (
    <section className="lobby-chat-panel">
      <div className="panel-title"><strong>大厅聊天</strong><span>所有大厅玩家可见</span></div>
      <MessageList listRef={listRef} messages={lobby.messages} />
      <ChatComposer onChange={setText} onSubmit={send} placeholder="和大厅里的玩家打个招呼..." value={text} />
    </section>
  );
}

function RoomLobby({
  room,
  onLeave,
  onError,
  onToast,
}: {
  room: RoomState;
  onLeave: () => void;
  onError: (message?: string) => void;
  onToast: (message: string) => void;
}) {
  const [roomName, setRoomName] = useState(room.name);
  const [roomRules, setRoomRules] = useState(room.rules);
  const [updatingWordBank, setUpdatingWordBank] = useState(false);
  const seatedPlayers = room.players.filter((player) => !player.isSpectator);
  const humanPlayers = seatedPlayers.filter((player) => !player.isBot);
  const selectedWordBankIds = room.settings.wordBankIds;
  const wordBankGroups = ["按稀有度", "按类型"];
  const supportsChoice = room.wordBankChoiceCount >= 3;

  useEffect(() => {
    setRoomName(room.name);
    setRoomRules(room.rules);
  }, [room.code, room.name, room.rules]);

  const updateSetting = async (patch: Partial<GameSettings>) => {
    const response = await emitWithAck("update_settings", {
      ...room.settings,
      ...patch,
    });
    if (!response.ok) onError(response.error);
  };

  const updateWordBanks = async (wordBankIds: string[]) => {
    setUpdatingWordBank(true);
    try {
      await updateSetting({ wordBankIds });
    } finally {
      setUpdatingWordBank(false);
    }
  };

  const toggleWordBank = (id: string) => {
    const nextIds = selectedWordBankIds.includes(id)
      ? selectedWordBankIds.filter((selectedId) => selectedId !== id)
      : [...selectedWordBankIds, id];
    void updateWordBanks(nextIds);
  };

  const updateRoomDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await emitWithAck("update_room_details", { roomName, roomRules });
    if (!response.ok) {
      onError(response.error);
      return;
    }
    onToast("房间名称和规则已更新");
  };

  const startGame = async () => {
    const response = await emitWithAck("start_game");
    if (!response.ok) onError(response.error);
  };

  const shareRoom = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: room.name, text: `${room.rules}\n房间号 ${room.code}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        onToast("邀请链接已复制");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") onError("无法分享链接");
    }
  };

  return (
    <div className="lobby-page page-enter">
      <header className="compact-header">
        <MiniBrand />
        <button className="text-button" onClick={onLeave} type="button">离开牌桌</button>
      </header>

      <div className="lobby-grid">
        <aside className="room-lobby-left">
          <section className="tavern-card invite-panel">
            <div className="eyebrow dark">你的房间号</div>
            <div className="room-code-display">{room.code}</div>
            <p>把房间号或邀请链接发给朋友；单人也可加入 AI 开始测试。</p>
            <button className="secondary-button" onClick={shareRoom} type="button">分享邀请链接</button>
            <div className="word-bank-seal">
              <strong>{room.wordBankCount}</strong>
              <span>个炉石题目已入库</span>
            </div>
          </section>

          <div className="room-word-bank-slot">
            <section className="word-bank-picker">
              <div className="word-bank-picker-heading">
                <div>
                  <span className="section-kicker">题目范围</span>
                  <h3>选择词库</h3>
                </div>
                <span>{room.wordBankCount} 张</span>
              </div>
              <button
                aria-pressed={selectedWordBankIds.length === 0}
                className={`word-bank-all ${selectedWordBankIds.length === 0 ? "active" : ""}`}
                disabled={!room.isHost || updatingWordBank}
                onClick={() => updateWordBanks([])}
                type="button"
              >
                <span>全部卡牌</span>
                <small>{room.wordBankOptions[0]?.count ?? room.wordBankCount}</small>
              </button>
              <div className="word-bank-filter-groups">
                {wordBankGroups.map((group) => (
                  <fieldset disabled={!room.isHost || updatingWordBank} key={group}>
                    <legend>{group}</legend>
                    <div className="word-bank-filter-grid">
                      {room.wordBankOptions
                        .filter((option) => option.group === group)
                        .map((option) => {
                          const selected = selectedWordBankIds.includes(option.id);
                          return (
                            <label className={selected ? "active" : ""} key={option.id}>
                              <input
                                checked={selected}
                                onChange={() => toggleWordBank(option.id)}
                                type="checkbox"
                              />
                              <span>{option.label}</span>
                              <small>{option.count}</small>
                            </label>
                          );
                        })}
                    </div>
                  </fieldset>
                ))}
              </div>
              <div className="word-bank-picker-summary">
                <strong>{room.wordBankName}</strong>
                <span>{room.wordBankChoiceCount} 张支持十选一</span>
              </div>
              <small>
                {room.isHost
                  ? "同组条件取并集，不同组取交集；选题和答题都会使用组合后的范围。"
                  : `房主已选择${room.wordBankName}。`}
              </small>
            </section>
          </div>

          {room.isHost ? (
            <div className="start-game-area room-lobby-start">
              <button className="primary-button large start-button" disabled={!room.canStart} onClick={startGame} type="button">
                {room.canStart
                  ? "开始对局"
                  : supportsChoice
                    ? "等待玩家加入"
                    : "当前词库题目不足"}
              </button>
              {humanPlayers.length === 1 && (
                <small>单人测试模式：开局后自动添加“旅店老板 AI”</small>
              )}
            </div>
          ) : (
            <div className="waiting-host room-lobby-start"><span className="waiting-dot" />等待房主开局</div>
          )}
        </aside>

        <section className="lobby-main">
          <div className="section-heading">
            <div>
              <span className="section-kicker">等待区</span>
              <h2>{room.name}</h2>
            </div>
            <span className="player-count">{seatedPlayers.length} / {room.settings.maxPlayers} 人</span>
          </div>
          <form className="room-details-form" onSubmit={updateRoomDetails}>
            <label>
              <span>房间名称</span>
              <input
                disabled={!room.isHost}
                maxLength={24}
                onChange={(event) => setRoomName(event.target.value)}
                value={roomName}
              />
            </label>
            <label className="room-rules-field">
              <span>房间说明（规则）</span>
              <textarea
                disabled={!room.isHost}
                maxLength={180}
                onChange={(event) => setRoomRules(event.target.value)}
                rows={2}
                value={roomRules}
              />
            </label>
            {room.isHost ? (
              <button disabled={!roomName.trim() || !roomRules.trim()} type="submit">保存房间信息</button>
            ) : (
              <small>房间信息由房主设置</small>
            )}
          </form>
          <div className="lobby-player-grid">
            {room.players.map((player, index) => (
              <div className={`lobby-player ${player.isSpectator ? "spectator" : ""} ${!player.connected ? "offline" : ""}`} key={player.id}>
                <Avatar name={player.name} index={index} />
                <div>
                  <strong>{player.name}</strong>
                  <span>{player.isSpectator ? "围观席" : player.isHost ? "房主" : player.connected ? "已就座" : "重连中"}</span>
                </div>
              </div>
            ))}
            {Array.from({ length: Math.max(0, Math.min(4, room.settings.maxPlayers - seatedPlayers.length)) }).map((_, index) => (
              <div className="lobby-player empty" key={`empty-${index}`}>
                <div className="empty-seat">+</div>
                <div><strong>空座位</strong><span>等待玩家</span></div>
              </div>
            ))}
          </div>

          <section className="settings-panel">
            <div className="setting-item">
              <label>答题方式</label>
              <div className="fixed-setting">
                <strong>十选一</strong>
                <small>可用搜索工具筛选</small>
              </div>
            </div>
            <div className="setting-item">
              <label htmlFor="rounds">每人作画</label>
              <select
                disabled={!room.isHost}
                id="rounds"
                onChange={(event) => updateSetting({ roundsPerPlayer: Number(event.target.value) })}
                value={room.settings.roundsPerPlayer}
              >
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} 轮</option>)}
              </select>
            </div>
            <div className="setting-item">
              <label htmlFor="time">每题时间</label>
              <select
                disabled={!room.isHost}
                id="time"
                onChange={(event) => updateSetting({ roundTime: Number(event.target.value) })}
                value={room.settings.roundTime}
              >
                {[30, 45, 60, 90, 120].map((value) => <option key={value} value={value}>{value} 秒</option>)}
              </select>
            </div>
            <div className="setting-item">
              <label htmlFor="players">房间人数</label>
              <select
                disabled={!room.isHost}
                id="players"
                onChange={(event) => updateSetting({ maxPlayers: Number(event.target.value) })}
                value={room.settings.maxPlayers}
              >
                {[4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>最多 {value} 人</option>)}
              </select>
            </div>
          </section>

        </section>

        <RoomChatPanel className="room-lobby-chat" onError={onError} room={room} />
      </div>
    </div>
  );
}

function GameRoom({
  room,
  onLeave,
  onError,
}: {
  room: RoomState;
  onLeave: () => void;
  onError: (message?: string) => void;
}) {
  const round = room.round;
  const [endingRound, setEndingRound] = useState(false);
  const drawer = room.players.find((player) => player.id === round?.drawerId);
  const self = room.players.find((player) => player.id === room.selfId);
  const isAnswering =
    room.phase === "drawing" &&
    !room.isDrawer &&
    !room.isSpectator &&
    Boolean(round?.questionType);
  const overlay =
    room.phase === "choosing"
      ? room.isDrawer
        ? undefined
        : `${drawer?.name ?? "作画者"} 正在挑选题目`
      : undefined;

  const chooseWord = async (word: string) => {
    const response = await emitWithAck("choose_word", { word });
    if (!response.ok) onError(response.error);
  };

  const joinNextRound = async () => {
    const response = await emitWithAck("join_next_round");
    if (!response.ok) onError(response.error);
  };

  useEffect(() => {
    setEndingRound(false);
  }, [round?.key]);

  const endSoloRound = async () => {
    if (endingRound) return;
    setEndingRound(true);
    const response = await emitWithAck("end_solo_round");
    if (!response.ok) {
      setEndingRound(false);
      onError(response.error);
    }
  };

  const clueRevealActive =
    room.phase === "drawing" &&
    !room.isDrawer &&
    Boolean(round?.clues && round.clueCard);
  const roundPrompt = (
    <>
      <div className="round-drawer-name">
        <span className="status-label">本轮画师</span>
        <strong>{drawer?.name ?? "-"}</strong>
      </div>
      <div className="word-status">
        <span className="status-label">{room.isSpectator ? "围观题目" : room.isDrawer && room.phase === "drawing" ? "你的题目" : "猜猜这是"}</span>
        <strong className={room.phase === "drawing" && !room.isDrawer ? "masked-word" : ""}>
          {round?.word || (room.phase === "choosing" ? "等待选题" : "-")}
        </strong>
        {room.phase === "drawing" && !room.isDrawer && (
          <small>
            {room.isSpectator
              ? "围观中 · 当前不能答题"
              : "选择题 · 选中后提交，答错可继续"}
          </small>
        )}
      </div>
    </>
  );

  return (
    <div className="game-page page-enter">
      <header className="game-header">
        <MiniBrand />
        <div className="round-meta">
          <span>第 {round?.turn ?? 0} / {round?.totalTurns ?? 0} 回合</span>
          <div className="round-progress">
            <i style={{ width: `${((round?.turn ?? 0) / Math.max(1, round?.totalTurns ?? 1)) * 100}%` }} />
          </div>
        </div>
        <div className="header-room">
          <button className="text-button" onClick={onLeave} type="button">退出房间</button>
        </div>
      </header>

      <PlayerRibbon phase={room.phase} players={room.players} />

      <section className="round-overview">
        <aside className="round-room-column">
          <span className="overview-eyebrow">房间信息</span>
          <strong className="round-room-name" title={room.name}>{room.name}</strong>
          <div className="round-room-facts">
            <span>房间号<strong>{room.code}</strong></span>
            <span>当前回合<strong>{round?.turn ?? 0} / {round?.totalTurns ?? 0}</strong></span>
          </div>
          <div className="round-bank-name">
            <span>题库范围</span>
            <strong title={round?.clues?.range ?? room.wordBankName}>
              {round?.clues?.range ?? room.wordBankName}
            </strong>
          </div>
        </aside>

        <div className={`round-prompt-column ${clueRevealActive ? "card-centered" : ""}`}>
          {room.phase === "drawing" && !room.isDrawer && round?.clues && round.clueCard
            ? <ClueCardReveal card={round.clueCard} fields={round.clues.fields} stage={round.clues.stage} />
            : roundPrompt}
        </div>

        <aside className="round-reveal-column">
          {room.phase === "drawing" && !room.isDrawer && round?.clues && round.clueCard ? (
            <>
              <div className="answer-prompt">{roundPrompt}</div>
              <RoundCluePanel
                canEndRound={room.canEndRound}
                endingRound={endingRound}
                isSpectator={room.isSpectator}
                onEndRound={endSoloRound}
                round={round}
              />
            </>
          ) : (
            <div className="round-timer-actions plain-round-actions">
              <RoundTimer endsAt={round?.endsAt ?? Date.now()} phase={room.phase} />
              {room.canEndRound && (
                <button disabled={endingRound} onClick={endSoloRound} type="button">
                  {endingRound ? "正在结束" : "立即结束本题"}
                </button>
              )}
            </div>
          )}
        </aside>
      </section>

      {room.isSpectator && (
        <section className={`spectator-join-bar ${room.joinQueued ? "queued" : ""}`}>
          <div>
            <span>围观席</span>
            <strong>{room.joinQueued ? "已申请下一轮参战" : "想加入这场对局？"}</strong>
            <small>{room.joinQueued ? "回合切换时自动入座，积分从 0 开始。" : "不会插入当前题目；加入后从 0 分开始，可能不公平。"}</small>
          </div>
          <button
            disabled={room.joinQueued || !room.canJoinNextRound}
            onClick={joinNextRound}
            type="button"
          >
            {room.joinQueued ? "等待下一轮" : room.canJoinNextRound ? "下一轮加入游戏" : "参战席位已满"}
          </button>
        </section>
      )}

      <div className={`game-grid ${isAnswering ? "answering-layout" : ""}`}>
        <div className="board-column">
          {room.phase === "choosing" && room.isDrawer && (
            <div className="word-picker">
              <span>从三张卡牌中选择你的题目</span>
              <div>
                {round?.optionCards.map((card) => (
                  <button key={card.id} onClick={() => chooseWord(card.name)} type="button">
                    <CardImage card={card} className="picker-card-visual" loading="eager" />
                    <strong>{card.name}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div
            className={`drawer-workspace ${
              round?.referenceCard || round?.answerCard ? "with-reference" : ""
            } ${room.phase === "roundEnd" ? "settlement-workspace" : ""}`.trim()}
          >
            {room.phase === "drawing" && room.isDrawer && round?.referenceCard && (
              <aside className="drawer-reference" aria-label="作画参考卡牌">
                <div className="drawer-reference-heading">
                  <span>作画参考</span>
                  <small>
                    {CARD_TYPE_LABELS[round.referenceCard.type] ?? "卡牌"} · 仅你可见
                  </small>
                </div>
                <CardImage
                  card={round.referenceCard}
                  className="drawer-reference-visual"
                  loading="eager"
                />
                <strong>{round.referenceCard.name}</strong>
                <p>可观察卡面手绘，也可选择轮廓辅助；参考图仅你可见。</p>
              </aside>
            )}
            {room.phase === "roundEnd" && round?.answerCard && (
              <aside className="drawer-reference settlement-card-reference" aria-label="本轮正确答案">
                <div className="drawer-reference-heading">
                  <span>本轮揭晓</span>
                  <small>
                    {room.isDrawer
                      ? "完整卡面"
                      : self?.answeredCorrectly
                        ? "选择正确"
                        : "正确答案"}
                  </small>
                </div>
                <CardImage
                  card={round.answerCard}
                  className="drawer-reference-visual settlement-card-visual"
                  loading="eager"
                />
                <strong>{round.answerCard.name}</strong>
                <p>完整卡面已经揭晓，可对照本轮画作查看答案。</p>
              </aside>
            )}
            <CanvasBoard
              canDraw={room.phase === "drawing" && room.isDrawer}
              onAssistError={onError}
              overlay={overlay}
              referenceCardType={round?.referenceCard?.type}
              referenceImageUrl={round?.referenceCard?.imageUrl}
              roundDurationMs={round?.durationMs}
              roundEndsAt={round?.endsAt}
              roundKey={round?.key ?? "none"}
            />
          </div>
        </div>
        <GameSidebar onError={onError} room={room} />
      </div>
    </div>
  );
}

function ClueCardReveal({
  card,
  fields,
  stage,
}: {
  card: NonNullable<NonNullable<RoomState["round"]>["clueCard"]>;
  fields: NonNullable<NonNullable<RoomState["round"]>["clues"]>["fields"];
  stage: number;
}) {
  return (
    <aside className={`drawer-reference clue-card-reference stage-${stage}`} aria-label="逐步解密的提示卡牌">
      <ClueCardWidget card={card} fields={fields} stage={stage} />
    </aside>
  );
}

function RoundCluePanel({
  canEndRound,
  endingRound,
  round,
  isSpectator,
  onEndRound,
}: {
  canEndRound: boolean;
  endingRound: boolean;
  round: NonNullable<RoomState["round"]>;
  isSpectator: boolean;
  onEndRound: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [round.key, round.endsAt]);

  const clues = round.clues;
  if (!clues) return null;
  const currentScore = calculateScore(
    Math.max(0, round.endsAt - now),
    Math.max(1, round.durationMs),
  );
  const stageLabels = ["卡身建立中", "身份部件已装配", "卡牌信息已装配"];
  const stageMessages = [
    "剩余 60% 时间时装配职业与稀有度部件",
    "剩余 30% 时间时装配费用、属性与描述",
    "插画与卡名将在本轮结算时揭开",
  ];

  return (
    <section
      aria-label="本题线索"
      className={`round-card-reveal stage-${clues.stage}`}
    >
      <div className="reveal-timing-rail">
        <div className="clue-stage" aria-live="polite">
          <span>揭示阶段</span>
          <strong>{stageLabels[clues.stage] ?? stageLabels[0]}</strong>
          <small>{stageMessages[clues.stage] ?? stageMessages[0]}</small>
        </div>
        <div className="round-timer-actions reveal-round-actions">
          <RoundTimer endsAt={round.endsAt} phase="drawing" />
          {canEndRound && (
            <button disabled={endingRound} onClick={onEndRound} type="button">
              {endingRound ? "正在结束" : "立即结束本题"}
            </button>
          )}
        </div>
        <div className="clue-score">
          <span>{isSpectator ? "本题分档" : clues.selectedScore === null ? "当前答对" : "当前选择答对"}</span>
          <strong>
            {isSpectator
              ? `${clues.scoreBand.maximum}～${clues.scoreBand.minimum}`
              : `${clues.selectedScore ?? currentScore} 分`}
          </strong>
          {!isSpectator && clues.selectedScore !== null && <small>修改后重新计分</small>}
        </div>
      </div>
    </section>
  );
}

interface SearchFilters {
  name: string;
  wordLength: string;
  cost: string;
  attack: string;
  health: string;
  armor: string;
}

const EMPTY_SEARCH_FILTERS: SearchFilters = {
  name: "",
  wordLength: "",
  cost: "",
  attack: "",
  health: "",
  armor: "",
};

function formatCardSearchRows(card: CardPreview) {
  const rows = [`字数 ${card.wordLength} · ${CARD_TYPE_LABELS[card.type] ?? "卡牌"}`];
  if (card.type === "MINION") {
    rows.push(`费用 ${card.cost ?? "-"} · 攻击 ${card.attack ?? "-"}`);
    rows.push(`生命 ${card.health ?? "-"}`);
  } else if (card.type === "HERO") {
    rows.push(`费用 ${card.cost ?? "-"} · 护甲 ${card.armor ?? "-"}`);
  } else if (card.type === "WEAPON" || card.type === "LOCATION") {
    rows.push(`费用 ${card.cost ?? "-"} · 耐久 ${card.health ?? "-"}`);
  } else {
    rows.push(`费用 ${card.cost ?? "-"}`);
  }
  return rows;
}

function matchesChoiceSearch(card: CardPreview, filters: SearchFilters) {
  const exactNumber = (filter: string, value: number | null) =>
    !filter.trim() || value === Number(filter);
  return (
    (!filters.name.trim() || card.name.toLocaleLowerCase().includes(
      filters.name.trim().toLocaleLowerCase(),
    )) &&
    exactNumber(filters.wordLength, card.wordLength) &&
    exactNumber(filters.cost, card.cost) &&
    exactNumber(filters.attack, card.attack) &&
    exactNumber(filters.health, card.health) &&
    exactNumber(filters.armor, card.armor)
  );
}

function ChoiceAnswerPanel({
  round,
  onError,
}: {
  round: NonNullable<RoomState["round"]>;
  onError: (message?: string) => void;
}) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    round.answerSubmittedCorrectly ? round.selectedAnswerIndex : null,
  );
  const [incorrectIndexes, setIncorrectIndexes] = useState(
    () => new Set(round.incorrectAnswerIndexes),
  );
  const [submittedCorrectly, setSubmittedCorrectly] = useState(
    round.answerSubmittedCorrectly,
  );
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [cooldownEndsAt, setCooldownEndsAt] = useState(round.answerCooldownEndsAt);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    setFilters(EMPTY_SEARCH_FILTERS);
    setSelectedIndex(round.answerSubmittedCorrectly ? round.selectedAnswerIndex : null);
    setIncorrectIndexes(new Set(round.incorrectAnswerIndexes));
    setSubmittedCorrectly(round.answerSubmittedCorrectly);
    setSubmitting(false);
    setFeedback(round.answerSubmittedCorrectly ? "已经答对，本轮得分已锁定" : "");
    setCooldownEndsAt(round.answerCooldownEndsAt);
    setClock(Date.now());
  }, [round.key]);

  useEffect(() => {
    setIncorrectIndexes(new Set(round.incorrectAnswerIndexes));
    setSubmittedCorrectly(round.answerSubmittedCorrectly);
    setCooldownEndsAt((current) => Math.max(current, round.answerCooldownEndsAt));
    if (round.answerSubmittedCorrectly) {
      setSelectedIndex(round.selectedAnswerIndex);
      setFeedback("已经答对，本轮得分已锁定");
    }
  }, [
    round.answerCooldownEndsAt,
    round.answerSubmittedCorrectly,
    round.incorrectAnswerIndexes,
    round.selectedAnswerIndex,
  ]);

  const cooldownRemaining = Math.max(0, cooldownEndsAt - clock);
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = window.setInterval(() => setClock(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [cooldownRemaining > 0]);

  const updateFilter = (field: keyof SearchFilters, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const submitAnswer = async () => {
    if (selectedIndex === null || submittedCorrectly || cooldownRemaining > 0) return;
    setSubmitting(true);
    setFeedback("");
    setCooldownEndsAt(Date.now() + 1_000);
    setClock(Date.now());
    const response = await emitWithAck("submit_answer", { index: selectedIndex });
    setSubmitting(false);
    if (!response.ok) {
      if (response.retryAfterMs) {
        setCooldownEndsAt(Date.now() + response.retryAfterMs);
        setClock(Date.now());
        setFeedback(`提交冷却中，还需 ${(response.retryAfterMs / 1_000).toFixed(1)} 秒`);
      } else {
        onError(response.error);
      }
      return;
    }

    setCooldownEndsAt(Date.now() + (response.retryAfterMs ?? 1_000));
    setClock(Date.now());
    if (response.correct) {
      setSubmittedCorrectly(true);
      setFeedback(`回答正确，获得 ${response.score ?? 0} 分`);
      return;
    }
    setIncorrectIndexes((current) => new Set([...current, selectedIndex]));
    setFeedback("回答错误，请选择其他答案后再次提交");
    setSelectedIndex(null);
  };

  const activeFilterCount = Object.values(filters).filter((value) => value.trim()).length;
  const visibleOptions = round.answerOptionCards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => matchesChoiceSearch(card, filters));

  return (
    <aside className="answer-panel choice-answer-panel">
      <div className="answer-heading">
        <div><span className="live-dot" />选择并提交答案</div>
        <small>答错可继续，每次提交冷却 1 秒</small>
      </div>
      <details className="choice-search-tool">
        <summary>
          <span>搜索工具</span>
          <small>
            {activeFilterCount > 0
              ? `${activeFilterCount} 个条件 · 找到 ${visibleOptions.length} 项`
              : "按名称与属性筛选十个选项"}
          </small>
        </summary>
        <div className="choice-search-fields">
          <label className="card-name-filter">
            <span>卡牌名称</span>
            <input
              autoComplete="off"
              onChange={(event) => updateFilter("name", event.target.value)}
              placeholder="输入部分名称"
              value={filters.name}
            />
          </label>
          <div className="stat-filter-row">
            {([
              ["wordLength", "字数"],
              ["cost", "费用"],
              ["attack", "攻击"],
              ["health", "生命/耐久"],
              ["armor", "护甲"],
            ] as const).map(([field, label]) => (
              <label key={field}>
                <span>{label}</span>
                <input
                  inputMode="numeric"
                  max={field === "wordLength" ? "40" : "99"}
                  min={field === "wordLength" ? "1" : "0"}
                  onChange={(event) => updateFilter(field, event.target.value)}
                  placeholder="不限"
                  type="number"
                  value={filters[field]}
                />
              </label>
            ))}
            <button onClick={() => setFilters(EMPTY_SEARCH_FILTERS)} type="button">
              重置
            </button>
          </div>
        </div>
      </details>
      <div className="answer-grid">
        {visibleOptions.length === 0 ? (
          <div className="answer-filter-empty">
            <strong>没有符合条件的选项</strong>
            <button onClick={() => setFilters(EMPTY_SEARCH_FILTERS)} type="button">清除筛选</button>
          </div>
        ) : visibleOptions.map(({ card, index }) => {
          const incorrect = incorrectIndexes.has(index);
          return (
            <button
              aria-pressed={selectedIndex === index}
              className={`${selectedIndex === index ? "selected" : ""} ${incorrect ? "incorrect" : ""}`}
              disabled={incorrect || submittedCorrectly}
              key={`${index}-${card.id}`}
              onClick={() => {
                setSelectedIndex(index);
                setFeedback("");
              }}
              type="button"
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <CardImage card={card} className="answer-option-visual" loading="eager" />
              <div className="answer-option-copy">
                <strong>{card.name}</strong>
                <div className="answer-option-details">
                  {formatCardSearchRows(card).map((row) => <small key={row}>{row}</small>)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className={`answer-selection ${submittedCorrectly ? "correct" : feedback ? "has-feedback" : ""}`} aria-live="polite">
        <span>{submittedCorrectly ? "回答正确" : selectedIndex === null ? "尚未选择" : "准备提交"}</span>
        <strong>
          {selectedIndex === null
            ? "请选择一个编号"
            : `第 ${String(selectedIndex + 1).padStart(2, "0")} 项 · ${round.answerOptionCards[selectedIndex]?.name}`}
        </strong>
        <small>{feedback || "点选不会直接作答，需要点击提交答案"}</small>
        <button
          className="submit-answer-button"
          disabled={
            selectedIndex === null ||
            submitting ||
            submittedCorrectly ||
            cooldownRemaining > 0
          }
          onClick={submitAnswer}
          type="button"
        >
          {submittedCorrectly
            ? "已答对"
            : submitting
              ? "提交中"
              : cooldownRemaining > 0
                ? `冷却 ${(cooldownRemaining / 1_000).toFixed(1)}s`
                : "提交答案"}
        </button>
      </div>
    </aside>
  );
}

function GameSidebar({ room, onError }: { room: RoomState; onError: (message?: string) => void }) {
  const round = room.round;
  const canAnswer = room.phase === "drawing" && !room.isDrawer && !room.isSpectator && Boolean(round?.questionType);
  const [tab, setTab] = useState<"answer" | "chat">(canAnswer ? "answer" : "chat");

  useEffect(() => {
    setTab(canAnswer ? "answer" : "chat");
  }, [canAnswer, round?.key]);

  if (!canAnswer || !round) {
    return <RoomChatPanel onError={onError} room={room} />;
  }

  return (
    <div className="game-sidebar">
      <div className="side-tabs" role="tablist">
        <button className={tab === "answer" ? "active" : ""} onClick={() => setTab("answer")} role="tab" type="button">
          选择答题
        </button>
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")} role="tab" type="button">房间聊天</button>
      </div>
      {tab === "answer" ? (
        <ChoiceAnswerPanel onError={onError} round={round} />
      ) : (
        <RoomChatPanel onError={onError} room={room} />
      )}
    </div>
  );
}

function RoomChatPanel({
  room,
  onError,
  className = "",
}: {
  room: RoomState;
  onError: (message?: string) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [room.messages.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    const response = await emitWithAck("send_room_chat", { text });
    if (!response.ok) {
      onError(response.error);
      return;
    }
    setText("");
  };

  return (
    <aside className={`chat-panel room-chat-panel ${className}`.trim()}>
      <div className="chat-heading">
        <div><span className="live-dot" />房间聊天</div>
        <small>仅牌桌玩家和观众可见</small>
      </div>
      <MessageList listRef={listRef} messages={room.messages} />
      <ChatComposer onChange={setText} onSubmit={send} placeholder="发送房间消息..." value={text} />
    </aside>
  );
}

function MessageList({
  messages,
  listRef,
}: {
  messages: ChatMessage[];
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="message-list" ref={listRef}>
      {messages.length === 0 ? (
        <div className="chat-empty">还没有消息，来打个招呼吧</div>
      ) : messages.map((message) => (
        <div className={`message ${message.kind}`} key={message.id}>
          {message.kind === "chat" && <strong>{message.name}</strong>}
          <span>{message.text}</span>
        </div>
      ))}
    </div>
  );
}

function ChatComposer({
  value,
  placeholder,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="chat-composer" onSubmit={onSubmit}>
      <input
        autoComplete="off"
        maxLength={160}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      <button disabled={!value.trim()} type="submit">发送</button>
    </form>
  );
}

function PlayerRibbon({
  phase,
  players,
}: {
  phase: RoomState["phase"];
  players: PlayerState[];
}) {
  return (
    <div className="player-ribbon">
      {[...players]
        .sort((a, b) => Number(a.isSpectator) - Number(b.isSpectator) || b.score - a.score)
        .map((player, index) => (
          <div
            className={`ribbon-player ${player.isBot ? "bot" : ""} ${player.isSpectator ? "spectator" : ""} ${player.joinQueued ? "queued" : ""} ${player.isDrawer ? "drawing" : ""} ${player.hasAnswered ? "answered" : ""} ${player.answeredCorrectly ? "correct" : ""} ${phase === "roundEnd" && player.hasAnswered && !player.answeredCorrectly ? "incorrect" : ""} ${!player.connected ? "offline" : ""}`}
            key={player.id}
          >
            <Avatar index={index} name={player.name} />
            <div><strong>{player.name}</strong><span>{player.isSpectator ? player.joinQueued ? "下轮加入" : "围观中" : player.isBot ? `AI · ${player.score} 分` : `${player.score} 分`}</span></div>
            {player.isSpectator ? <i>{player.joinQueued ? "入" : "观"}</i> : player.isDrawer ? <i>画</i> : player.isBot ? <i>AI</i> : null}
            {!player.isSpectator && !player.isDrawer && player.hasAnswered && (
              <i>{phase === "roundEnd" ? (player.answeredCorrectly ? "中" : "错") : "答"}</i>
            )}
          </div>
        ))}
    </div>
  );
}

function GameOver({
  room,
  onLeave,
  onError,
}: {
  room: RoomState;
  onLeave: () => void;
  onError: (message?: string) => void;
}) {
  const ranking = room.players
    .filter((player) => !player.isSpectator && !player.isBot)
    .sort((a, b) => b.score - a.score);

  const restart = async () => {
    const response = await emitWithAck("restart_game");
    if (!response.ok) onError(response.error);
  };

  return (
    <div className="result-page page-enter">
      <MiniBrand />
      <section className="result-card tavern-card">
        <div className="result-crown">终局</div>
        <span className="section-kicker">牌桌结算</span>
        <h2>{ranking[0]?.name} 赢得了今晚的画谜王冠</h2>
        <div className="podium-list">
          {ranking.map((player, index) => (
            <div className={`podium-row rank-${index + 1}`} key={player.id}>
              <span className="rank-number">{index + 1}</span>
              <Avatar index={index} name={player.name} />
              <strong>{player.name}</strong>
              <span>{player.score} 分</span>
            </div>
          ))}
        </div>
        <div className="result-actions">
          {room.isHost ? (
            <button className="primary-button" onClick={restart} type="button">再开一局</button>
          ) : (
            <div className="waiting-host"><span className="waiting-dot" />等待房主再开一局</div>
          )}
          <button className="secondary-button" onClick={onLeave} type="button">离开牌桌</button>
        </div>
      </section>
    </div>
  );
}

function RoundTimer({ endsAt, phase }: { endsAt: number; phase: RoomState["phase"] }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, endsAt - Date.now()));

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, endsAt - Date.now()));
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className={`round-timer ${seconds <= 10 ? "urgent" : ""}`}>
      <span>{phase === "roundEnd" ? "下一轮" : phase === "choosing" ? "选题" : "剩余"}</span>
      <strong>{seconds}</strong>
      <small>秒</small>
    </div>
  );
}

function MiniBrand() {
  return (
    <div className="mini-brand">
      <div className="mini-gem" />
      <div><strong>炉边画谜</strong><span>HEARTH DRAW</span></div>
    </div>
  );
}

function Avatar({ name, index }: { name: string; index: number }) {
  const styles = ["teal", "ember", "moss", "sapphire", "wine", "sand"];
  return <div className={`avatar ${styles[index % styles.length]}`}>{[...name][0] ?? "?"}</div>;
}
