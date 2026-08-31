import { useEffect, useState } from "react";
import type { CardPreview } from "../types";

export function CardImage({
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
