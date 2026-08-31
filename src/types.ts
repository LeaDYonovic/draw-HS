export type GamePhase =
  | "lobby"
  | "choosing"
  | "drawing"
  | "roundEnd"
  | "gameOver";

export type AnswerMode = "choice";
export type QuestionType = "choice";

export interface GameSettings {
  roundsPerPlayer: number;
  roundTime: number;
  maxPlayers: number;
  answerMode: AnswerMode;
  wordBankIds: string[];
}

export interface WordBankOption {
  id: string;
  label: string;
  group: string;
  count: number;
  choiceCount: number;
}

export interface PlayerState {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  isBot: boolean;
  isSpectator: boolean;
  joinQueued: boolean;
  isHost: boolean;
  isDrawer: boolean;
  hasAnswered: boolean;
  answeredCorrectly: boolean;
}

export interface ChatMessage {
  id: string;
  at: number;
  kind: "system" | "chat";
  text: string;
  playerId?: string;
  name?: string;
}

export interface LobbyPlayerState {
  id: string;
  name: string;
  status: "lobby" | "room" | "game" | "spectating";
}

export interface LobbyRoomState {
  code: string;
  name: string;
  rules: string;
  hostName: string;
  playerCount: number;
  spectatorCount: number;
  maxPlayers: number;
  status: "waiting" | "playing" | "finished";
  joinable: boolean;
  spectatable: boolean;
}

export interface LobbyState {
  players: LobbyPlayerState[];
  rooms: LobbyRoomState[];
  messages: ChatMessage[];
}

export interface CardPreview {
  id: string;
  name: string;
  wordLength: number;
  cost: number | null;
  attack: number | null;
  health: number | null;
  armor: number | null;
  type: string;
  imageUrl: string;
}

export interface ClueCardPreview {
  imageUrl: string;
}

export interface RoundClueField {
  key: "length" | "type" | "class" | "rarity" | "cost" | "stats" | "text";
  label: string;
  value: string;
  source: "base" | "scope" | "hint" | "hidden";
}

export interface RoundClueState {
  stage: number;
  range: string;
  scoreBand: {
    stage: number;
    minimum: number;
    maximum: number;
  };
  selectedScore: number | null;
  fields: RoundClueField[];
}

export interface RoundState {
  key: string;
  turn: number;
  totalTurns: number;
  cycle: number;
  drawerId: string;
  endsAt: number;
  durationMs: number;
  word: string;
  wordLength: number;
  questionType: QuestionType | null;
  options: string[];
  optionCards: CardPreview[];
  referenceCard: CardPreview | null;
  clueCard: ClueCardPreview | null;
  answerCard: CardPreview | null;
  answerOptions: string[];
  answerOptionCards: CardPreview[];
  selectedAnswerIndex: number | null;
  incorrectAnswerIndexes: number[];
  answerSubmittedCorrectly: boolean;
  answerCooldownEndsAt: number;
  clues: RoundClueState | null;
  resultReason: "timeout" | "drawerLeft" | "manual" | "correct" | null;
}

export interface RoomState {
  code: string;
  name: string;
  rules: string;
  phase: GamePhase;
  hostId: string;
  selfId: string;
  settings: GameSettings;
  wordBankCount: number;
  wordBankChoiceCount: number;
  wordBankName: string;
  wordBankOptions: WordBankOption[];
  players: PlayerState[];
  round: RoundState | null;
  messages: ChatMessage[];
  canStart: boolean;
  canEndRound: boolean;
  canJoinNextRound: boolean;
  isHost: boolean;
  isDrawer: boolean;
  isSpectator: boolean;
  joinQueued: boolean;
  sessionName: string;
}

export interface CanvasSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size: number;
  color: string;
  tool: "brush" | "eraser";
}

export interface CardSearchResult {
  id: string;
  name: string;
  wordLength: number;
  cost: number | null;
  attack: number | null;
  health: number | null;
  armor: number | null;
  type: string;
  imageUrl: string;
}

export interface CardSearchResponse {
  results: CardSearchResult[];
  total: number;
  limit: number;
  page: number;
  pages: number;
  error?: string;
}

export type CanvasEvent =
  | { type: "clear" }
  | { type: "segment"; segment: CanvasSegment }
  | { type: "segments"; segments: CanvasSegment[] };

export interface ServerResponse {
  ok: boolean;
  error?: string;
  name?: string;
  roomCode?: string;
  playerToken?: string;
  correct?: boolean;
  score?: number;
  retryAfterMs?: number;
  selectedAnswerIndex?: number;
  isSpectator?: boolean;
  joinQueued?: boolean;
}
