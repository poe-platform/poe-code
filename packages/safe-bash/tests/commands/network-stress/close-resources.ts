import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { Socket } from "node:net";

export async function closeResources(servers: readonly Server[], sockets: Set<Socket>, milliseconds = 2000): Promise<void> {
  const pending: Promise<void>[] = [];
  const listeners = new Map<Socket, () => void>();
  const destroy = (socket: Socket): void => {
    if (listeners.has(socket)) return;
    pending.push(new Promise<void>((resolve) => {
      listeners.set(socket, resolve);
      socket.once("close", resolve);
    }));
    socket.destroy();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (const server of servers) server.on("connection", destroy);
    const closed = servers.map((server) => new Promise<void>((resolve, reject) => {
      server.close((error: NodeJS.ErrnoException | undefined) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
    }));
    for (const socket of sockets) destroy(socket);
    await Promise.race([
      (async () => { await Promise.all(closed); await Promise.all(pending); })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Fixture close events exceeded cleanup deadline")), milliseconds); }),
    ]);
    assert.equal(sockets.size, 0, "Fixture socket cleanup incomplete");
    for (const server of servers) assert.equal(server.listening, false, "Fixture server still listening");
  } finally {
    clearTimeout(timer);
    for (const server of servers) server.off("connection", destroy);
    for (const [socket, listener] of listeners) socket.off("close", listener);
  }
}
