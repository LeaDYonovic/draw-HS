import type { CSSProperties } from "react";
import { CardImage } from "./CardImage";

export type CardMaskLayerKey =
  | "artwork"
  | "cost"
  | "attack"
  | "health"
  | "name"
  | "description";

export interface CardMaskLayer {
  key: CardMaskLayerKey;
  className: string;
  label: string;
  revealAt: number;
}

export const CARD_MASK_LAYERS: readonly CardMaskLayer[] = [
  { key: "artwork", className: "artwork art-cover", label: "插画持续封印", revealAt: Number.POSITIVE_INFINITY },
  { key: "cost", className: "cost", label: "费用", revealAt: 1 },
  { key: "attack", className: "attack", label: "攻击", revealAt: 2 },
  { key: "health", className: "health", label: "生命 / 耐久", revealAt: 2 },
  { key: "name", className: "name", label: "卡牌名称", revealAt: Number.POSITIVE_INFINITY },
  { key: "description", className: "description", label: "卡牌描述", revealAt: 2 },
] as const;

export type CardMaskLayerOverrides = Partial<Record<CardMaskLayerKey, boolean>>;

export function isCardMaskLayerOpened(
  layer: CardMaskLayer,
  stage: number,
  overrides: CardMaskLayerOverrides = {},
) {
  return overrides[layer.key] ?? stage >= layer.revealAt;
}

export function CardMaskWidget({
  cardName = "待解密",
  className = "",
  imageUrl,
  layerOverrides,
  stage,
  style,
}: {
  cardName?: string;
  className?: string;
  imageUrl: string;
  layerOverrides?: CardMaskLayerOverrides;
  stage: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`clue-card-stage card-mask-widget stage-${stage} ${className}`.trim()}
      data-mask-stage={stage}
      style={style}
    >
      <CardImage
        card={{ imageUrl, name: cardName }}
        className="drawer-reference-visual clue-card-image"
        loading="eager"
      />
      {CARD_MASK_LAYERS.map((layer) => {
        const opened = isCardMaskLayerOpened(layer, stage, layerOverrides);
        return (
          <span
            aria-hidden="true"
            className={`card-sticker ${layer.className} ${opened ? "opened" : ""}`}
            data-mask-layer={layer.key}
            key={layer.key}
          >
            {layer.label}
          </span>
        );
      })}
    </div>
  );
}
