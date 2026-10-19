import { createConnection } from "node:net";

export type ControlStatus = "ready" | "stopped" | "invalid";

interface ControlReply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function isControlReply(value: unknown): value is ControlReply {
  if (typeof value !== "object" || value === null) return false;
  const reply = value as Record<string, unknown>;
  const hasResult = Object.hasOwn(reply, "result");
  const hasError = typeof reply.error === "string";
  return (
    reply.id === 1 &&
    typeof reply.ok === "boolean" &&
    hasResult !== hasError &&
    (reply.ok ? hasResult : hasError)
  );
}

export async function inspectControl(port: number, timeoutMs = 1_000, token?: string): Promise<ControlStatus> {
  return new Promise((resolve) => {
    let settled = false;
    let response = "";
    const finish = (status: ControlStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(status);
    };

    const socket = createConnection({ host: "127.0.0.1", port });
    const timer = setTimeout(() => finish("invalid"), timeoutMs);

    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id: 1, method: "ui.inspect", ...(token ? { token } : {}) })}\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8");
      const lineEnd = response.indexOf("\n");
      if (lineEnd === -1) return;

      try {
        const reply: unknown = JSON.parse(response.slice(0, lineEnd));
        finish(isControlReply(reply) ? "ready" : "invalid");
      } catch {
        finish("invalid");
      }
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ECONNREFUSED" ? "stopped" : "invalid");
    });
    socket.once("end", () => finish("invalid"));
  });
}
