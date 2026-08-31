import { useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { CardImage } from "./components/CardImage";
import {
  CARD_MASK_LAYERS,
  CardMaskWidget,
  isCardMaskLayerOpened,
} from "./components/CardMaskWidget";
import type {
  CardMaskLayerKey,
  CardMaskLayerOverrides,
} from "./components/CardMaskWidget";
import type { CardPreview, CardSearchResponse } from "./types";

const CARD_BANKS = [
  { id: "minion", label: "随从" },
  { id: "spell", label: "法术" },
  { id: "weapon", label: "武器" },
  { id: "hero", label: "英雄牌" },
  { id: "location", label: "地标" },
] as const;

const STAGE_PRESETS = [
  { stage: 0, label: "完整封印", detail: "所有贴纸保留" },
  { stage: 1, label: "费用揭示", detail: "移除费用贴纸" },
  { stage: 2, label: "属性揭示", detail: "移除属性与描述" },
] as const;

const TYPE_LABELS: Record<string, string> = {
  MINION: "随从",
  SPELL: "法术",
  WEAPON: "武器",
  HERO: "英雄牌",
  LOCATION: "地标",
};

function cardFacts(card: CardPreview) {
  const facts = [`${TYPE_LABELS[card.type] ?? "卡牌"} · ${card.wordLength} 字`, `费用 ${card.cost ?? "-"}`];
  if (card.type === "MINION") facts.push(`攻击 ${card.attack ?? "-"}`, `生命 ${card.health ?? "-"}`);
  if (card.type === "WEAPON" || card.type === "LOCATION") facts.push(`耐久 ${card.health ?? "-"}`);
  if (card.type === "HERO") facts.push(`护甲 ${card.armor ?? "-"}`);
  return facts;
}

export function MaskDebugPage() {
  const [bank, setBank] = useState("minion");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<CardPreview[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardPreview | null>(null);
  const [stage, setStage] = useState(0);
  const [layerOverrides, setLayerOverrides] = useState<CardMaskLayerOverrides>({});
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
    void loadCards(nextBank, query);
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    void loadCards(bank, query);
  };

  const applyStage = (nextStage: number) => {
    setStage(nextStage);
    setLayerOverrides({});
  };

  const toggleLayer = (key: CardMaskLayerKey) => {
    const layer = CARD_MASK_LAYERS.find((item) => item.key === key);
    if (!layer) return;
    const opened = isCardMaskLayerOpened(layer, stage, layerOverrides);
    setLayerOverrides((current) => ({ ...current, [key]: !opened }));
  };

  const showFullCard = () => {
    setLayerOverrides(Object.fromEntries(
      CARD_MASK_LAYERS.map((layer) => [layer.key, true]),
    ) as CardMaskLayerOverrides);
  };

  const maskStyle = {
    "--mask-preview-width": `${previewWidth}px`,
  } as CSSProperties;

  return (
    <main className="mask-debug-page">
      <header className="mask-debug-header">
        <div>
          <span>MASK LAB · TEMPORARY TOOL</span>
          <h1>卡牌遮挡实验台</h1>
          <p>这里与正式答题页共用同一个 CardMaskWidget，调试结果不会影响房间和计分。</p>
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
              <button
                className={bank === option.id ? "active" : ""}
                key={option.id}
                onClick={() => chooseBank(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <form className="mask-card-search" onSubmit={search}>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="按卡牌名称检索"
              value={query}
            />
            <button disabled={loading} type="submit">{loading ? "载入中" : "检索"}</button>
          </form>
          {error && <div className="mask-debug-error">{error}</div>}
          <div className="mask-card-results">
            {cards.map((card) => (
              <button
                className={selectedCard?.id === card.id ? "active" : ""}
                key={card.id}
                onClick={() => setSelectedCard(card)}
                type="button"
              >
                <CardImage card={card} />
                <span><strong>{card.name}</strong><small>{TYPE_LABELS[card.type] ?? "卡牌"}</small></span>
              </button>
            ))}
            {!loading && cards.length === 0 && !error && <p>没有找到卡牌，请更换名称。</p>}
          </div>
        </aside>

        <section className="mask-debug-stage">
          <div className="mask-debug-panel-heading">
            <div><span>02</span><strong>实时遮挡预览</strong></div>
            <small>{selectedCard?.name ?? "等待选择"}</small>
          </div>
          <div className="mask-preview-surface">
            {selectedCard ? (
              <CardMaskWidget
                cardName={selectedCard.name}
                className="mask-debug-card-widget"
                imageUrl={selectedCard.imageUrl}
                layerOverrides={layerOverrides}
                stage={stage}
                style={maskStyle}
              />
            ) : (
              <div className="mask-preview-empty">选择一张卡牌开始测试</div>
            )}
          </div>
          <div className="mask-preview-caption">
            <strong>{selectedCard?.name ?? "未选择卡牌"}</strong>
            <div>{selectedCard?.type && cardFacts(selectedCard).map((fact) => <span key={fact}>{fact}</span>)}</div>
          </div>
        </section>

        <aside className="mask-debug-controls">
          <div className="mask-debug-panel-heading">
            <div><span>03</span><strong>遮挡控制</strong></div>
            <small>即时生效</small>
          </div>

          <section className="mask-control-group">
            <header><strong>阶段预设</strong><small>模拟正式倒计时</small></header>
            <div className="mask-stage-presets">
              {STAGE_PRESETS.map((preset) => (
                <button
                  className={stage === preset.stage && Object.keys(layerOverrides).length === 0 ? "active" : ""}
                  key={preset.stage}
                  onClick={() => applyStage(preset.stage)}
                  type="button"
                >
                  <span>{preset.stage}</span><strong>{preset.label}</strong><small>{preset.detail}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="mask-control-group">
            <header><strong>独立图层</strong><small>打开表示移除贴纸</small></header>
            <div className="mask-layer-list">
              {CARD_MASK_LAYERS.map((layer) => {
                const opened = isCardMaskLayerOpened(layer, stage, layerOverrides);
                return (
                  <button className={opened ? "opened" : ""} key={layer.key} onClick={() => toggleLayer(layer.key)} type="button">
                    <i /><span><strong>{layer.label}</strong><small>{opened ? "已揭示" : "遮挡中"}</small></span>
                  </button>
                );
              })}
            </div>
            <div className="mask-bulk-actions">
              <button onClick={() => applyStage(0)} type="button">恢复全部遮挡</button>
              <button onClick={showFullCard} type="button">移除全部遮挡</button>
            </div>
          </section>

          <section className="mask-control-group mask-size-control">
            <header><strong>预览尺寸</strong><small>{previewWidth}px</small></header>
            <input
              max="500"
              min="260"
              onChange={(event) => setPreviewWidth(Number(event.target.value))}
              step="10"
              type="range"
              value={previewWidth}
            />
          </section>

          {selectedCard && (
            <section className="mask-original-reference">
              <header><strong>完整卡面参考</strong><small>仅用于对位</small></header>
              <CardImage card={selectedCard} loading="eager" />
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
