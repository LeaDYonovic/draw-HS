import { useEffect, useRef, useState } from "react";
import { extractCardOutline } from "../outline-assist.mjs";
import { socket } from "../realtime";
import type { CanvasEvent, CanvasSegment } from "../types";

const COLORS = [
  "#17242a",
  "#b52f32",
  "#d9782d",
  "#e5b83c",
  "#4f8f46",
  "#2b7399",
  "#68488c",
  "#8c5a3c",
];

interface CanvasBoardProps {
  canDraw: boolean;
  onAssistError?: (message: string) => void;
  referenceCardType?: string;
  referenceImageUrl?: string;
  roundKey: string;
  overlay?: string;
}

export function CanvasBoard({
  canDraw,
  onAssistError,
  referenceCardType,
  referenceImageUrl,
  roundKey,
  overlay,
}: CanvasBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<CanvasSegment[]>([]);
  const drawingRef = useRef(false);
  const previousPointRef = useRef<{ x: number; y: number } | null>(null);
  const pendingSegmentsRef = useRef<CanvasSegment[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const assistRunRef = useRef(0);
  const canDrawRef = useRef(canDraw);
  const roundKeyRef = useRef(roundKey);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(7);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");
  const [assistDetail, setAssistDetail] = useState<
    "simple" | "standard" | "detailed"
  >("standard");
  const [assistState, setAssistState] = useState<"idle" | "loading" | "done">("idle");
  canDrawRef.current = canDraw;
  roundKeyRef.current = roundKey;

  const paintSegment = (segment: CanvasSegment) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const scale = window.devicePixelRatio || 1;
    context.save();
    context.globalCompositeOperation =
      segment.tool === "eraser" ? "destination-out" : "source-over";
    context.strokeStyle = segment.color;
    context.lineWidth = segment.size * scale;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(segment.x0 * canvas.width, segment.y0 * canvas.height);
    context.lineTo(segment.x1 * canvas.width, segment.y1 * canvas.height);
    context.stroke();
    context.restore();
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    historyRef.current.forEach(paintSegment);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.round(rect.width * scale));
      const nextHeight = Math.max(1, Math.round(rect.height * scale));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
        redraw();
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onCanvasEvent = (event: CanvasEvent) => {
      if (event.type === "clear") {
        historyRef.current = [];
        redraw();
        return;
      }
      const segments = event.type === "segments" ? event.segments : [event.segment];
      historyRef.current.push(...segments);
      segments.forEach(paintSegment);
    };
    const onCanvasHistory = (history: CanvasSegment[]) => {
      historyRef.current = history;
      redraw();
    };

    socket.on("canvas_event", onCanvasEvent);
    socket.on("canvas_history", onCanvasHistory);
    socket.emit("request_canvas_history");
    return () => {
      socket.off("canvas_event", onCanvasEvent);
      socket.off("canvas_history", onCanvasHistory);
    };
  }, [roundKey]);

  useEffect(() => {
    assistRunRef.current += 1;
    setAssistState("idle");
    historyRef.current = [];
    redraw();
    pendingSegmentsRef.current = [];
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, [roundKey]);

  const emitSegments = (segments: CanvasSegment[]) => {
    for (let index = 0; index < segments.length; index += 64) {
      socket.emit("canvas_event", {
        type: "segments",
        segments: segments.slice(index, index + 64),
      });
    }
  };

  const flushSegments = () => {
    animationFrameRef.current = null;
    const segments = pendingSegmentsRef.current.splice(0);
    emitSegments(segments);
  };

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    previousPointRef.current = pointFromEvent(event);
  };

  const continueDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || !drawingRef.current || !previousPointRef.current) return;
    const nextPoint = pointFromEvent(event);
    const segment: CanvasSegment = {
      x0: previousPointRef.current.x,
      y0: previousPointRef.current.y,
      x1: nextPoint.x,
      y1: nextPoint.y,
      color,
      size: tool === "eraser" ? Math.min(36, size * 2.5) : size,
      tool,
    };
    historyRef.current.push(segment);
    paintSegment(segment);
    pendingSegmentsRef.current.push(segment);
    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(flushSegments);
    }
    previousPointRef.current = nextPoint;
  };

  const stopDrawing = () => {
    drawingRef.current = false;
    previousPointRef.current = null;
    if (pendingSegmentsRef.current.length > 0) {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      flushSegments();
    }
  };

  const clearCanvas = () => {
    if (!canDraw) return;
    assistRunRef.current += 1;
    setAssistState("idle");
    pendingSegmentsRef.current = [];
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    historyRef.current = [];
    redraw();
    socket.emit("canvas_event", { type: "clear" });
  };

  const addOutlineAssist = async () => {
    const canvas = canvasRef.current;
    if (
      !canDraw ||
      !canvas ||
      !referenceImageUrl ||
      assistState !== "idle"
    ) {
      return;
    }

    const run = ++assistRunRef.current;
    const activeRoundKey = roundKey;
    setAssistState("loading");
    try {
      const result = await extractCardOutline(referenceImageUrl, {
        cardType: referenceCardType,
        canvasAspect: canvas.clientWidth / Math.max(1, canvas.clientHeight),
        detail: assistDetail,
      });
      if (
        run !== assistRunRef.current ||
        !canDrawRef.current ||
        roundKeyRef.current !== activeRoundKey
      ) {
        return;
      }
      if (result.segments.length < 20) {
        throw new Error("这张卡牌没有提取到足够清晰的轮廓");
      }

      for (let index = 0; index < result.segments.length; index += 64) {
        if (
          run !== assistRunRef.current ||
          !canDrawRef.current ||
          roundKeyRef.current !== activeRoundKey
        ) {
          return;
        }
        const batch = result.segments.slice(index, index + 64);
        historyRef.current.push(...batch);
        batch.forEach(paintSegment);
        emitSegments(batch);
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      setAssistState("done");
    } catch (error) {
      if (run !== assistRunRef.current) return;
      setAssistState("idle");
      onAssistError?.(
        error instanceof Error ? error.message : "暂时无法生成插画轮廓",
      );
    }
  };

  return (
    <section className="canvas-shell">
      {canDraw && (
        <div className="tool-rack" aria-label="绘画工具">
          <div className="color-row">
            {COLORS.map((item) => (
              <button
                aria-label={`选择颜色 ${item}`}
                className={`color-chip ${color === item && tool === "brush" ? "active" : ""}`}
                key={item}
                onClick={() => {
                  setColor(item);
                  setTool("brush");
                }}
                style={{ backgroundColor: item }}
                type="button"
              />
            ))}
          </div>
          <label className="size-control">
            <span>笔触</span>
            <input
              aria-label="笔触大小"
              max="18"
              min="2"
              onChange={(event) => setSize(Number(event.target.value))}
              type="range"
              value={size}
            />
          </label>
          <button
            className={`tool-button ${tool === "eraser" ? "active" : ""}`}
            onClick={() => setTool(tool === "eraser" ? "brush" : "eraser")}
            type="button"
          >
            {tool === "eraser" ? "继续画" : "橡皮"}
          </button>
          {referenceImageUrl && (
            <div className="assist-control">
              <select
                aria-label="轮廓细节"
                disabled={assistState !== "idle"}
                onChange={(event) => setAssistDetail(
                  event.target.value as "simple" | "standard" | "detailed",
                )}
                title="选择自动轮廓保留的细节数量"
                value={assistDetail}
              >
                <option value="simple">简洁</option>
                <option value="standard">标准</option>
                <option value="detailed">细致</option>
              </select>
              <button
                className={`tool-button assist ${assistState === "done" ? "active" : ""}`}
                disabled={assistState !== "idle"}
                onClick={addOutlineAssist}
                title="分析卡牌类型对应的插画区域并生成简化轮廓"
                type="button"
              >
                {assistState === "loading"
                  ? "分析中"
                  : assistState === "done"
                    ? "已添加"
                    : "轮廓辅助"}
              </button>
            </div>
          )}
          <button className="tool-button danger" onClick={clearCanvas} type="button">
            清屏
          </button>
        </div>
      )}
      <div className={`canvas-frame ${canDraw ? "can-draw" : ""}`}>
        <canvas
          aria-label="实时绘画画板"
          onPointerCancel={stopDrawing}
          onPointerDown={startDrawing}
          onPointerLeave={stopDrawing}
          onPointerMove={continueDrawing}
          onPointerUp={stopDrawing}
          ref={canvasRef}
        />
        {overlay && <div className="canvas-overlay">{overlay}</div>}
      </div>
    </section>
  );
}
