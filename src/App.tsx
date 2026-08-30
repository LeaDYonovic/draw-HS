import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CanvasBoard } from "./components/CanvasBoard";
import { emitWithAck, socket } from "./realtime";
import { calculateScore } from "./score-rules.mjs";
import type {
  CardPreview,
  CardSearchResponse,
  CardSearchResult,
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
const PAGE_SCALE_STEPS = [80, 90, 100, 110, 120] as const;
const DEFAULT_ROOM_RULES = "轮流从三张卡牌中选题作画，其他玩家通过选择或搜索卡牌作答。";
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

export function App() {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [lobby, setLobby] = useState<LobbyState>({ players: [], rooms: [], messages: [] });
  const [lobbyName, setLobbyName] = useState("");
  const lobbyNameRef = useRef("");
  const [connected, setConnected] = useState(socket.connected);
  const [pageScale, setPageScale] = useState(readPageScale);
  const [toast, setToast] = useState("");

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
      <PageScaleControl onChange={changePageScale} scale={pageScale} />
    </main>
  );
}

function PageScaleControl({ onChange, scale }: { onChange: (scale: number) => void; scale: number }) {
  const index = PAGE_SCALE_STEPS.indexOf(scale as (typeof PAGE_SCALE_STEPS)[number]);

  return (
    <div aria-label="页面缩放" className="page-scale-control" role="group">
      <button
        aria-label="缩小页面"
        disabled={index <= 0}
        onClick={() => onChange(PAGE_SCALE_STEPS[index - 1])}
        title="缩小页面"
        type="button"
      >
        −
      </button>
      <button aria-label={`当前缩放 ${scale}%，点击恢复 100%`} className="page-scale-value" onClick={() => onChange(100)} title="恢复 100%" type="button">
        {scale}%
      </button>
      <button
        aria-label="放大页面"
        disabled={index >= PAGE_SCALE_STEPS.length - 1}
        onClick={() => onChange(PAGE_SCALE_STEPS[index + 1])}
        title="放大页面"
        type="button"
      >
        +
      </button>
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
          创建一桌，把房间号发给朋友。轮流抽取炉石卡牌名作画，通过选择题或卡牌检索锁定答案。
        </p>
        <div className="feature-strip">
          <span>在线玩家大厅</span>
          <span>选择题 + 搜索题</span>
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
                {room.canStart ? "开始对局" : "等待玩家加入"}
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
              <label htmlFor="answer-mode">答题模式</label>
              <select
                disabled={!room.isHost}
                id="answer-mode"
                onChange={(event) => updateSetting({ answerMode: event.target.value as GameSettings["answerMode"] })}
                value={room.settings.answerMode}
              >
                <option disabled={!supportsChoice} value="mixed">混合随机</option>
                <option disabled={!supportsChoice} value="choice">仅选择题</option>
                <option value="search">仅搜索题</option>
              </select>
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
  const drawer = room.players.find((player) => player.id === round?.drawerId);
  const self = room.players.find((player) => player.id === room.selfId);
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
          <span>房间</span><strong>{room.code}</strong>
          <button className="text-button" onClick={onLeave} type="button">退出</button>
        </div>
      </header>

      <PlayerRibbon phase={room.phase} players={room.players} />

      <section className="game-status-bar">
        <div className="drawer-status">
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
                : `${round?.questionType === "search" ? "搜索题" : "选择题"} · 结束前可修改答案`}
            </small>
          )}
        </div>
        <RoundTimer endsAt={round?.endsAt ?? Date.now()} phase={room.phase} />
      </section>

      {room.phase === "drawing" && !room.isDrawer && round?.clues && (
        <RoundCluePanel isSpectator={room.isSpectator} round={round} />
      )}

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

      <div className="game-grid">
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
          {room.phase === "roundEnd" && (
            <div className="answer-reveal">
              <span>
                {room.isDrawer
                  ? "本轮揭晓"
                  : self?.answeredCorrectly
                    ? "你的选择正确"
                    : "本轮正确答案"}
              </span>
              {round?.answerCard && (
                <CardImage card={round.answerCard} className="revealed-card-visual" loading="eager" />
              )}
              <strong>{round?.word}</strong>
            </div>
          )}
          <div className={round?.referenceCard ? "drawer-workspace with-reference" : "drawer-workspace"}>
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
            <CanvasBoard
              canDraw={room.phase === "drawing" && room.isDrawer}
              onAssistError={onError}
              overlay={overlay}
              referenceCardType={round?.referenceCard?.type}
              referenceImageUrl={round?.referenceCard?.imageUrl}
              roundKey={round?.key ?? "none"}
            />
          </div>
        </div>
        <GameSidebar onError={onError} room={room} />
      </div>
    </div>
  );
}

function RoundCluePanel({
  round,
  isSpectator,
}: {
  round: NonNullable<RoomState["round"]>;
  isSpectator: boolean;
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
  const stageLabels = ["抢答阶段", "第一条线索", "第二条线索"];
  const stageMessages = [
    "剩余 60% 时间时公开第一条线索",
    "线索已增加，当前分数进入 70～50 分档",
    "强线索已公开，当前分数进入 40～20 分档",
  ];

  return (
    <section
      aria-label="本题线索"
      className={`round-clue-panel stage-${clues.stage}`}
    >
      <div className="clue-summary">
        <div className="clue-range" title={clues.range}>
          <span>题库范围</span>
          <strong>{clues.range}</strong>
        </div>
        <div className="clue-stage" aria-live="polite">
          <span>{stageLabels[clues.stage] ?? stageLabels[0]}</span>
          <small>{stageMessages[clues.stage] ?? stageMessages[0]}</small>
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
      <div className="clue-fields">
        {clues.fields.map((field) => (
          <div className={field.source} key={field.key}>
            <span>{field.label}</span>
            <strong>{field.value}</strong>
            {field.source === "scope" && <small>题库范围</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

function ChoiceAnswerPanel({
  round,
  onError,
}: {
  round: NonNullable<RoomState["round"]>;
  onError: (message?: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(
    round.selectedAnswerIndex,
  );

  useEffect(() => {
    setSelectedIndex(round.selectedAnswerIndex);
  }, [round.key, round.selectedAnswerIndex]);

  const selectAnswer = async (index: number) => {
    setSelectedIndex(index);
    const response = await emitWithAck("select_answer", { index });
    if (!response.ok) {
      setSelectedIndex(round.selectedAnswerIndex);
      onError(response.error);
    }
  };

  return (
    <aside className="answer-panel">
      <div className="answer-heading">
        <div><span className="live-dot" />选择答案</div>
        <small>共 10 项，字数相同，只有 1 项正确</small>
      </div>
      <div className="answer-grid">
        {round.answerOptionCards.map((card, index) => (
          <button
            aria-pressed={selectedIndex === index}
            className={selectedIndex === index ? "selected" : ""}
            key={`${index}-${card.id}`}
            onClick={() => selectAnswer(index)}
            type="button"
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <CardImage card={card} className="answer-option-visual" loading="eager" />
            <strong>{card.name}</strong>
          </button>
        ))}
      </div>
      <div className="answer-selection">
        <span>{selectedIndex === null ? "尚未作答" : "当前选择"}</span>
        <strong>
          {selectedIndex === null
            ? "请选择一个编号"
            : `第 ${String(selectedIndex + 1).padStart(2, "0")} 项`}
        </strong>
        <small>倒计时结束前可以随时修改</small>
      </div>
    </aside>
  );
}

interface SearchFilters {
  name: string;
  wordLength: string;
  cost: string;
  attack: string;
  health: string;
}

const EMPTY_SEARCH_FILTERS: SearchFilters = {
  name: "",
  wordLength: "",
  cost: "",
  attack: "",
  health: "",
};

function SearchAnswerPanel({
  round,
  wordBankIds,
  onError,
}: {
  round: NonNullable<RoomState["round"]>;
  wordBankIds: string[];
  onError: (message?: string) => void;
}) {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const [submittedFilters, setSubmittedFilters] = useState<SearchFilters | null>(null);
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedName, setSelectedName] = useState(round.selectedAnswerName);
  const reportSearchError = useEffectEvent((message: string) => onError(message));
  const wordBankKey = wordBankIds.join(",");

  useEffect(() => {
    setSelectedName(round.selectedAnswerName);
  }, [round.key, round.selectedAnswerName]);

  useEffect(() => {
    if (!submittedFilters) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(submittedFilters)) {
      if (value.trim()) params.set(key, value.trim());
    }
    params.set("page", String(page));
    params.set("wordBanks", wordBankKey || "all");

    setLoading(true);
    fetch(`/api/cards/search?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as CardSearchResponse;
        if (!response.ok) throw new Error(data.error || "检索失败");
        return data;
      })
      .then((data) => {
        setResults(data.results);
        setTotal(data.total);
        setPages(data.pages);
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") reportSearchError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, submittedFilters, wordBankKey]);

  const updateFilter = (field: keyof SearchFilters, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    if (!Object.values(filters).some((value) => value.trim())) {
      onError("请至少填写一个检索条件");
      return;
    }
    setPage(1);
    setSubmittedFilters({ ...filters });
  };

  const selectAnswer = async (name: string) => {
    setSelectedName(name);
    const response = await emitWithAck("select_search_answer", { name });
    if (!response.ok) {
      setSelectedName(round.selectedAnswerName);
      onError(response.error);
    }
  };

  return (
    <aside className="answer-panel search-answer-panel">
      <div className="answer-heading">
        <div><span className="live-dot" />检索答案</div>
        <small>组合条件查找卡牌</small>
      </div>
      <form className="card-search-form" onSubmit={search}>
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
            ["health", "生命"],
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
          <button type="submit">检索</button>
        </div>
      </form>
      <div className="search-results">
        {loading ? (
          <div className="search-empty">正在翻阅卡牌档案...</div>
        ) : submittedFilters && results.length === 0 ? (
          <div className="search-empty">没有找到符合条件的卡牌</div>
        ) : !submittedFilters ? (
          <div className="search-empty">输入名称、字数或属性开始检索</div>
        ) : (
          <>
            <div className="search-result-count">
              找到 {total} 张{total > results.length ? `，显示前 ${results.length} 张` : ""}
            </div>
            {results.map((card) => (
              <div className={`search-result ${selectedName === card.name ? "selected" : ""}`} key={card.name}>
                <CardImage card={card} className="search-card-visual" />
                <div>
                  <strong>{card.name}</strong>
                  <span>
                    字数 {card.wordLength} · 费用 {card.cost ?? "-"} · 攻击 {card.attack ?? "-"} · 生命 {card.health ?? "-"}
                  </span>
                </div>
                <button
                  aria-pressed={selectedName === card.name}
                  onClick={() => selectAnswer(card.name)}
                  type="button"
                >
                  {selectedName === card.name ? "已选择" : "选为答案"}
                </button>
              </div>
            ))}
            {pages > 1 && (
              <div className="search-pagination" aria-label="搜索结果分页">
                <button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)} type="button">
                  上一页
                </button>
                <span>第 {page} / {pages} 页</span>
                <button disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)} type="button">
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="answer-selection search-selection">
        <span>{selectedName ? "当前答案" : "尚未作答"}</span>
        <strong>{selectedName || "请从检索结果中选择"}</strong>
        <small>倒计时结束前可以重新检索并修改</small>
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
          {round.questionType === "search" ? "搜索答题" : "选择答题"}
        </button>
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")} role="tab" type="button">房间聊天</button>
      </div>
      {tab === "answer" ? (
        round.questionType === "choice" ? (
          <ChoiceAnswerPanel onError={onError} round={round} />
        ) : (
          <SearchAnswerPanel onError={onError} round={round} wordBankIds={room.settings.wordBankIds} />
        )
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

function CardImage({
  card,
  className = "",
  loading = "lazy",
}: {
  card: Pick<CardPreview, "name" | "imageUrl">;
  className?: string;
  loading?: "eager" | "lazy";
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [card.imageUrl]);

  return (
    <div className={`card-visual ${className}`}>
      {!failed && card.imageUrl ? (
        <img
          alt={`${card.name}卡牌`}
          loading={loading}
          onError={() => setFailed(true)}
          src={card.imageUrl}
        />
      ) : (
        <div aria-label={`${card.name}卡牌图片暂不可用`} className="card-image-fallback" role="img">
          <span>炉石</span>
          <small>卡图暂不可用</small>
        </div>
      )}
    </div>
  );
}

function Avatar({ name, index }: { name: string; index: number }) {
  const styles = ["teal", "ember", "moss", "sapphire", "wine", "sand"];
  return <div className={`avatar ${styles[index % styles.length]}`}>{[...name][0] ?? "?"}</div>;
}
