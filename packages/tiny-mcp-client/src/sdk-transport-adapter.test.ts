import { once } from "node:events";
import type { Readable } from "node:stream";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "bun:test";
import { SdkTransportAdapter, readLines } from "./internal.js";

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

describe("SdkTransportAdapter", () => {
  it("passes messages bidirectionally between sdk transport and line streams", async () => {
    const [adapterSide, peerSide] = InMemoryTransport.createLinkedPair();
    const adapter = new SdkTransportAdapter(adapterSide);
    cleanup.push(() => adapter.dispose());

    const messageForPeer: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    };

    const onPeerMessage = new Promise<JSONRPCMessage>((resolve) => {
      peerSide.onmessage = (message) => {
        resolve(message);
      };
    });

    adapter.writable.write(`${JSON.stringify(messageForPeer)}\n`);

    await expect(onPeerMessage).resolves.toEqual(messageForPeer);

    const messageForAdapter: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    };

    await peerSide.send(messageForAdapter);

    await expect(readSingleLine(adapter.readable)).resolves.toBe(
      JSON.stringify(messageForAdapter)
    );
  });

  it("resolves closed when disposed", async () => {
    const [adapterSide] = InMemoryTransport.createLinkedPair();
    const adapter = new SdkTransportAdapter(adapterSide);

    const readableEnded = once(adapter.readable, "end");
    adapter.readable.resume();

    adapter.dispose();

    await readableEnded;
    await expect(adapter.closed).resolves.toMatchObject({
      reason: expect.any(Error),
    });
  });
});
