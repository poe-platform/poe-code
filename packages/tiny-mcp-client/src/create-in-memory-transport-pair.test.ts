import { once } from "node:events";
import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryTransportPair, readLines } from "./internal.js";

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length > 0) {
    cleanup.pop()?.();
  }
});

async function readSingleLine(stream: Readable): Promise<string> {
  for await (const line of readLines(stream)) {
    return line;
  }

  throw new Error("Stream ended before a line was read");
}

describe("createInMemoryTransportPair", () => {
  it("writes from client transport to server transport readable", async () => {
    const { clientTransport, serverTransport } = createInMemoryTransportPair();
    cleanup.push(() => clientTransport.dispose());

    clientTransport.writable.write('{"from":"client"}\n');

    await expect(readSingleLine(serverTransport.readable)).resolves.toBe(
      '{"from":"client"}'
    );
  });

  it("writes from server transport to client transport readable", async () => {
    const { clientTransport, serverTransport } = createInMemoryTransportPair();
    cleanup.push(() => clientTransport.dispose());

    serverTransport.writable.write('{"from":"server"}\n');

    await expect(readSingleLine(clientTransport.readable)).resolves.toBe(
      '{"from":"server"}'
    );
  });

  it("dispose on client transport ends both readable streams", async () => {
    const { clientTransport, serverTransport } = createInMemoryTransportPair();
    const clientReadableEnded = once(clientTransport.readable, "end");
    const serverReadableEnded = once(serverTransport.readable, "end");

    clientTransport.readable.resume();
    serverTransport.readable.resume();
    clientTransport.dispose();

    await Promise.all([clientReadableEnded, serverReadableEnded]);
    await expect(clientTransport.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});
