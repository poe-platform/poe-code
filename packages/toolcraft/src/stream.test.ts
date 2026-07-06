import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import { createSDK } from "./sdk.js";
import {
  defineGroup,
  defineStreamCommand,
  type ToolcraftStream
} from "./index.js";

describe("defineStreamCommand SDK lifecycle", () => {
  it("starts lazily and advances only when the consumer pulls", async () => {
    const produced: number[] = [];
    const watch = defineStreamCommand({
      name: "watch",
      params: S.Object({}),
      event: S.Number(),
      async *handler() {
        produced.push(1);
        yield 1;
        produced.push(2);
        yield 2;
      }
    });
    const sdk = createSDK(defineGroup({ name: "devices", children: [watch] }));
    const stream = sdk.watch({});

    expect(produced).toEqual([]);
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 });
    expect(produced).toEqual([1]);
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 2 });
    expect(produced).toEqual([1, 2]);
  });

  it("returns a typed async iterable and releases generator resources once", async () => {
    const cleanup = vi.fn();
    const watch = defineStreamCommand({
      name: "watch",
      params: S.Object({ deviceId: S.String() }),
      event: S.Object({ state: S.String() }),
      async *handler({ params, signal }) {
        try {
          yield { state: `${params.deviceId}:online` };
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        } finally {
          cleanup();
        }
      }
    });
    const sdk = createSDK(defineGroup({ name: "devices", children: [watch] }));
    const stream = sdk.watch({ deviceId: "lamp" });

    expectTypeOf(stream).toMatchTypeOf<ToolcraftStream<{ state: string }>>();
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { state: "lamp:online" } });

    await iterator.return?.();
    await stream.cancel();

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("keeps status events separate and refreshes secrets on demand", async () => {
    const statuses: unknown[] = [];
    const watch = defineStreamCommand({
      name: "watch",
      params: S.Object({}),
      event: S.Object({ state: S.String() }),
      secrets: { token: { env: "DEVICE_TOKEN" } },
      async *handler({ refreshSecrets, status }) {
        status({ type: "reconnecting", message: "Refreshing credentials" });
        yield { state: (await refreshSecrets()).token };
      }
    });
    const sdk = createSDK(defineGroup({ name: "devices", children: [watch] }), {
      env: { DEVICE_TOKEN: "fresh-token" }
    });

    const stream = sdk.watch({}, { onStatus: (event) => statuses.push(event) });

    await expect(Array.fromAsync(stream)).resolves.toEqual([{ state: "fresh-token" }]);
    expect(statuses).toEqual([
      { type: "reconnecting", message: "Refreshing credentials" }
    ]);
  });

  it("rejects emitted values that do not match the event schema", async () => {
    const watch = defineStreamCommand({
      name: "watch",
      params: S.Object({}),
      event: S.Object({ state: S.String() }),
      async *handler() {
        yield { state: 42 } as never;
      }
    });
    const sdk = createSDK(defineGroup({ name: "devices", children: [watch] }));

    await expect(Array.fromAsync(sdk.watch({}))).rejects.toThrow("state");
  });

  it("propagates terminal errors and releases resources once", async () => {
    const cleanup = vi.fn();
    const watch = defineStreamCommand({
      name: "watch",
      params: S.Object({}),
      event: S.String(),
      async *handler() {
        try {
          yield "online";
          throw new Error("connection lost");
        } finally {
          cleanup();
        }
      }
    });
    const sdk = createSDK(defineGroup({ name: "devices", children: [watch] }));

    await expect(Array.fromAsync(sdk.watch({}))).rejects.toThrow("connection lost");
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
