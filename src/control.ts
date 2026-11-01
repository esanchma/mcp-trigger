import { createConnection, type Socket } from "node:net";

export type ControlStatus = "ready" | "stopped" | "invalid";
type ProbeStatus = ControlStatus | "authentication-required";

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

type OnConnect = (socket: Socket, finish: (status: ProbeStatus) => void) => void;

function monitorConnection(port: number, timeoutMs: number, onConnect: OnConnect): Promise<ProbeStatus> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (status: ProbeStatus): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(status);
    };
    const timer = setTimeout(() => finish("invalid"), timeoutMs);
    socket.once("connect", () => onConnect(socket, finish));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ECONNREFUSED" ? "stopped" : "invalid"));
    socket.once("end", () => finish("invalid"));
  });
}

export async function isTcpPortOpen(port: number, timeoutMs = 1_000): Promise<ControlStatus> {
  const status = await monitorConnection(port, timeoutMs, (_socket, finish) => finish("ready"));
  return status === "authentication-required" ? "invalid" : status;
}

function probeControl(port: number, timeoutMs: number, token?: string, authToken?: string): Promise<ProbeStatus> {
  return monitorConnection(port, timeoutMs, (socket, finish) => {
    let response = "";
    let authenticating = authToken !== undefined;
    const inspect = (): void => {
      socket.write(`${JSON.stringify({ id: 1, method: "ui.inspect", ...(token ? { token } : {}) })}\n`);
    };
    if (authenticating) {
      socket.write(`${JSON.stringify({ id: 0, method: "auth", params: { token: authToken } })}\n`);
    } else {
      inspect();
    }
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8");
      if (response.length > 1024 * 1024) return finish("invalid");
      let lineEnd: number;
      while ((lineEnd = response.indexOf("\n")) !== -1) {
        const line = response.slice(0, lineEnd);
        response = response.slice(lineEnd + 1);
        try {
          const reply: unknown = JSON.parse(line);
          if (authenticating) {
            const auth = reply as { id?: unknown; ok?: unknown; result?: { authenticated?: unknown } } | null;
            if (auth?.id !== 0 || auth.ok !== true || auth.result?.authenticated !== true) return finish("invalid");
            authenticating = false;
            inspect();
          } else if (isControlReply(reply)) {
            return finish("ready");
          } else if (typeof reply === "object" && reply !== null &&
            (reply as { ok?: unknown }).ok === false &&
            (reply as { error?: unknown }).error === "authentication required") {
            return finish("authentication-required");
          } else {
            return finish("invalid");
          }
        } catch {
          return finish("invalid");
        }
      }
    });
  });
}

export async function inspectControl(port: number, timeoutMs = 1_000, token?: string): Promise<ControlStatus> {
  const status = await probeControl(port, timeoutMs, token);
  return status === "authentication-required" ? "invalid" : status;
}

export async function inspectGridcraftControl(port: number, getToken: () => Promise<string | undefined>, timeoutMs = 1_000): Promise<ControlStatus> {
  const status = await probeControl(port, timeoutMs);
  if (status !== "authentication-required") return status;
  const token = await getToken();
  if (!token) return "invalid";
  const authenticated = await probeControl(port, timeoutMs, undefined, token);
  return authenticated === "authentication-required" ? "invalid" : authenticated;
}
