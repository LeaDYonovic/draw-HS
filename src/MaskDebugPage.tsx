import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { CardImage } from "./components/CardImage";
import { ClueCardWidget } from "./components/ClueCardWidget";
import type {
  CardPreview,
  CardSearchResponse,
  RoundClueField,
} from "./types";

const CARD_BANKS = [
  { id: "minion", label: "随从" },
  { id: "spell", label: "法术" },
  { id: "weapon", label: "武器" },
  { id: "hero", label: "英雄牌" },
  { id: "location", label: "地标" },
] as const;

const STAGE_PRESETS = [
  { stage: 0, label: "卡身建立", detail: "类型卡框与空白插画" },
  { stage: 1, label: "身份成形", detail: "职业边框、龙纹与宝石" },
  { stage: 2, label: "信息完成", detail: "费用、属性、描述与种族" },
  { stage: 3, label: "完整揭晓", detail: "直接替换为原始卡图" },
] as const;

const ASSEMBLY_PARTS = [
  { label: "类型卡身", stage: 0 },
  { label: "职业色边框", stage: 1 },
  { label: "稀有度龙纹", stage: 1 },
  { label: "中央稀有宝石", stage: 1 },
  { label: "费用与类型属性", stage: 2 },
  { label: "描述与种族铭牌", stage: 2 },
  { label: "完整原始卡图", stage: 3 },
] as const;

const TYPE_LABELS: Record<string, string> = {
  MINION: "随从",
  SPELL: "法术",
  WEAPON: "武器",
  HERO: "英雄牌",
  LOCATION: "地标",
};

const CLASS_LABELS: Record<string, string> = {
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

const RARITY_LABELS: Record<string, string> = {
  LEGENDARY: "传说",
  EPIC: "史诗",
  RARE: "稀有",
  COMMON: "普通",
  FREE: "基础",
};

function clueField(
  key: RoundClueField["key"],
  label: string,
  value: string,
  visible: boolean,
): RoundClueField {
  return {
    key,
    label,
    value: visible && value ? value : "待揭示",
    source: visible ? "hint" : "hidden",
  };
}

function cardStats(card: CardPreview) {
  if (card.type === "MINION") return `${card.attack ?? "-"} 攻 / ${card.health ?? "-"} 血`;
  if (card.type === "WEAPON" || card.type === "LOCATION") return `${card.health ?? "-"} 点耐久`;
  if (card.type === "HERO") return `${card.armor ?? "-"} 点护甲`;
  return "";
}

function buildDebugFields(card: CardPreview, stage: number): RoundClueField[] {
  const fields: RoundClueField[] = [
    { key: "length", label: "字数", value: `${card.wordLength} 个字`, source: "base" },
    { key: "type", label: "类型", value: TYPE_LABELS[card.type] ?? card.type, source: "base" },
    clueField("class", "职业", CLASS_LABELS[card.cardClass] ?? card.cardClass, stage >= 1),
    clueField("rarity", "稀有度", RARITY_LABELS[card.rarity] ?? card.rarity, stage >= 1),
    clueField("cost", "费用", Number.isFinite(card.cost) ? `${card.cost} 费` : "无费用", stage >= 2),
  ];
  const stats = cardStats(card);
  if (stats) fields.push(clueField("stats", card.type === "HERO" ? "护甲" : "属性", stats, stage >= 2));
  if (card.type === "MINION") fields.push(clueField("race", "种族", card.race || "无种族", stage >= 2));
  fields.push(clueField("text", "卡牌描述", card.text || "无卡牌描述", stage >= 2));
  return fields;
}

function cardFacts(card: CardPreview) {
  const facts = [`${TYPE_LABELS[card.type] ?? "卡牌"} · ${card.wordLength} 字`, `费用 ${card.cost ?? "-"}`];
  const stats = cardStats(card);
  if (stats) facts.push(stats);
  if (card.type === "MINION") facts.push(card.race || "无种族");
  return facts;
}

export function MaskDebugPage() {
  const [bank, setBank] = useState("minion");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardPreview[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardPreview | null>(null);
  const [stage, setStage] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(390);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadCards = async (nextBank: string, nextQuery: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ wordBanks: nextBank });
      if (nextQuery.trim()) params.set("name", nextQuery.trim());
      const response = await fetch(`/api/cards/search?${params.toString()}`);
      const payload = await response.json() as CardSearchResponse;
      if (!response.ok) throw new Error(payload.error || "卡牌载入失败");
      setCards(payload.results);
      setSelectedCard((current) =>
        payload.results.find((card) => card.id === current?.id) ?? payload.results[0] ?? null
      );
    } catch (loadError) {
      setCards([]);
      setSelectedCard(null);
      setError(loadError instanceof Error ? loadError.message : "卡牌载入失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCards("minion", "");
  }, []);

  const chooseBank = (nextBank: string) => {
    setBank(nextBank);
    setStage(0);
    void loadCards(nextBank, query);
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    void loadCards(bank, query);
  };

  const previewStyle = {
    "--mask-preview-width": `${previewWidth}px`,
  } as CSSProperties;
  const fields = selectedCard ? buildDebugFields(selectedCard, stage) : [];

  return (
    <main className="mask-debug-page">
      <header className="mask-debug-header">
        <div>
          <span>CARD ASSEMBLY · TEMPORARY TOOL</span>
          <h1>线索卡牌拼装实验台</h1>
          <p>正式答题页共用同一个 ClueCardWidget；插画始终留白，结算时直接替换完整卡图。</p>
        </div>
        <a href="/">返回游戏大厅</a>
      </header>

      <div className="mask-debug-layout">
        <aside className="mask-debug-browser">
          <div className="mask-debug-panel-heading">
            <div><span>01</span><strong>选择测试卡牌</strong></div>
            <small>{cards.length} 张结果</small>
          </div>
          <div className="mask-bank-tabs">
            {CARD_BANKS.map((option) => (
              <button className={bank === option.id ? "active" : ""} key={option.id} onClick={() => chooseBank(option.id)} type="button">
                {option.label}
              </button>
            ))}
          </div>
          <form className="mask-card-search" onSubmit={search}>
            <input onChange={(event) => setQuery(event.target.value)} placeholder="按卡牌名称检索" value={query} />
            <button disabled={loading} type="submit">{loading ? "载入中" : "检索"}</button>
          </form>
          {error && <div className="mask-debug-error">{error}</div>}
          <div className="mask-card-results">
            {cards.map((card) => (
              <button className={selectedCard?.id === card.id ? "active" : ""} key={card.id} onClick={() => { setSelectedCard(card); setStage(0); }} type="button">
                <CardImage card={card} />
                <span><strong>{card.name}</strong><small>{TYPE_LABELS[card.type] ?? "卡牌"}</small></span>
              </button>
            ))}
            {!loading && cards.length === 0 && !error && <p>没有找到卡牌，请更换名称。</p>}
          </div>
        </aside>

        <section className="mask-debug-stage">
          <div className="mask-debug-panel-heading">
            <div><span>02</span><strong>实时拼装预览</strong></div>
            <small>{selectedCard?.name ?? "等待选择"}</small>
          </div>
          <div className="mask-preview-surface">
            {selectedCard ? (
              <ClueCardWidget
                card={{ type: selectedCard.type }}
                className="mask-debug-card-widget"
                fields={fields}
                fullCard={selectedCard}
                revealed={stage >= 3}
                stage={stage}
                style={previewStyle}
              />
            ) : <div className="mask-preview-empty">选择一张卡牌开始测试</div>}
          </div>
          <div className="mask-preview-caption">
            <strong>{stage >= 3 ? selectedCard?.name : "卡名待揭晓"}</strong>
            <div>{selectedCard?.type && cardFacts(selectedCard).map((fact) => <span key={fact}>{fact}</span>)}</div>
          </div>
        </section>

        <aside className="mask-debug-controls">
          <div className="mask-debug-panel-heading">
            <div><span>03</span><strong>拼装控制</strong></div>
            <small>即时生效</small>
          </div>
          <section className="mask-control-group">
            <header><strong>阶段预设</strong><small>模拟正式倒计时与结算</small></header>
            <div className="mask-stage-presets">
              {STAGE_PRESETS.map((preset) => (
                <button className={stage === preset.stage ? "active" : ""} key={preset.stage} onClick={() => setStage(preset.stage)} type="button">
                  <span>{preset.stage}</span><strong>{preset.label}</strong><small>{preset.detail}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="mask-control-group">
            <header><strong>卡面部件</strong><small>随阶段逐步装配</small></header>
            <div className="mask-layer-list assembly-part-list">
              {ASSEMBLY_PARTS.map((part) => {
                const assembled = stage >= part.stage;
                return <div className={assembled ? "assembled" : ""} key={part.label}><i /><span><strong>{part.label}</strong><small>{assembled ? "已装配" : "等待中"}</small></span></div>;
              })}
            </div>
          </section>
          <section className="mask-control-group mask-size-control">
            <header><strong>预览尺寸</strong><small>{previewWidth}px</small></header>
            <input max="500" min="260" onChange={(event) => setPreviewWidth(Number(event.target.value))} step="10" type="range" value={previewWidth} />
          </section>
          {selectedCard && (
            <section className="mask-original-reference">
              <header><strong>结算卡面参考</strong><small>仅在阶段 3 替换显示</small></header>
              <CardImage card={selectedCard} loading="eager" />
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
