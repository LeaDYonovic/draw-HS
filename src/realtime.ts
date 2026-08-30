import { io } from "socket.io-client";
import type { ServerResponse } from "./types";

export const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4_000,
});

export function emitWithAck(
  event: string,
  payload: Record<string, unknown> = {},
): Promise<ServerResponse> {
  return new Promise((resolve) => {
    socket.timeout(6_000).emit(
      event,
      payload,
      (timeoutError: Error | null, response?: ServerResponse) => {
        if (timeoutError) {
          resolve({ ok: false, error: "连接超时，请检查网络后重试" });
          return;
        }
        resolve(response ?? { ok: false, error: "服务器没有返回结果" });
      },
    );
  });
}
