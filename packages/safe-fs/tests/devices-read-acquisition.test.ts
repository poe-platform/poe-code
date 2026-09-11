import { expect, it } from "vitest";
import { createDeviceFileSystem } from "../src/fs/devices/index.js";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

for (const phase of ["readStream", "iterator", "next-getter"] as const) {
  for (const reason of [false, 0, "", null]) {
    it(`owns DeviceFS ${phase} acquisition aborted with ${JSON.stringify(reason)} without pulling`, async () => {
      const backing = new MemoryFileSystem();
      await backing.writeFile("/input", Uint8Array.of(65, 10));
      const controller = new AbortController();
      const returning = deferred();
      const cleanup = deferred();
      let opens = 0;
      let acquired = 0;
      let pulls = 0;
      let returns = 0;
      let settled = false;
      backing.readStream = (_path, options) => {
        expect(options?.signal).toBe(controller.signal);
        opens++;
        if (phase === "readStream") controller.abort(reason);
        return { [Symbol.asyncIterator]() {
          acquired++;
          if (phase === "iterator") controller.abort(reason);
          return {
            get next() {
              if (phase === "next-getter") controller.abort(reason);
              return async (): Promise<IteratorResult<Uint8Array>> => {
                pulls++;
                throw new Error("canceled acquisition admitted a pull");
              };
            },
            async return(): Promise<IteratorResult<Uint8Array>> {
              returns++;
              returning.resolve();
              await cleanup.promise;
              throw new Error("secondary cleanup failure");
            },
          };
        } };
      };
      const iterator = createDeviceFileSystem(backing).readStream("/input", { signal: controller.signal })[Symbol.asyncIterator]();
      const operation = iterator.next().then(
        value => { settled = true; return { value }; },
        error => { settled = true; return { error }; },
      );
      try {
        await returning.promise;
        expect(opens).toBe(1);
        expect(acquired).toBe(1);
        expect(pulls).toBe(0);
        expect(returns).toBe(1);
        expect(settled).toBe(false);
        const firstClose = iterator.return!();
        expect(iterator.return!()).toBe(firstClose);
        const closed = firstClose.catch(error => error);
        cleanup.resolve();
        expect(await operation).toEqual({ error: reason });
        expect(await closed).toMatchObject({ message: "secondary cleanup failure" });
        expect(returns).toBe(1);
      } finally {
        cleanup.resolve();
        await operation;
      }
    });
  }
}

for (const phase of ["readStream", "iterator", "next-getter"] as const) {
  it(`does not admit a pull after DeviceFS close during ${phase} acquisition`, async () => {
    const backing = new MemoryFileSystem();
    await backing.writeFile("/input", Uint8Array.of(65, 10));
    const returning = deferred();
    const cleanup = deferred();
    let close: Promise<IteratorResult<Uint8Array>> | undefined;
    let pulls = 0;
    let returns = 0;
    let settled = false;
    backing.readStream = () => {
      if (phase === "readStream") close = iterator.return!();
      return { [Symbol.asyncIterator]() {
        if (phase === "iterator") close = iterator.return!();
        return {
          get next() {
            if (phase === "next-getter") close = iterator.return!();
            return async (): Promise<IteratorResult<Uint8Array>> => {
              pulls++;
              return { done: false, value: Uint8Array.of(66) };
            };
          },
          async return(): Promise<IteratorResult<Uint8Array>> {
            returns++;
            returning.resolve();
            await cleanup.promise;
            return { done: true, value: undefined };
          },
        };
      } };
    };
    const iterator = createDeviceFileSystem(backing).readStream("/input")[Symbol.asyncIterator]();
    const operation = iterator.next().then(value => { settled = true; return value; });
    try {
      await returning.promise;
      expect(pulls).toBe(0);
      expect(settled).toBe(false);
      expect(iterator.return!()).toBe(close);
      cleanup.resolve();
      expect(await operation).toEqual({ done: true, value: undefined });
      await close;
      expect(returns).toBe(1);
    } finally {
      cleanup.resolve();
      await operation;
      await close;
    }
  });
}

it("reads the DeviceFS next getter once and preserves its method receiver", async () => {
  const backing = new MemoryFileSystem();
  await backing.writeFile("/input", Uint8Array.of(65, 10));
  let gets = 0;
  let pulls = 0;
  let returns = 0;
  const producer: AsyncIterator<Uint8Array> = {
    get next() {
      gets++;
      return async function(this: AsyncIterator<Uint8Array>, ...args: []): Promise<IteratorResult<Uint8Array>> {
        expect(this).toBe(producer);
        expect(args).toEqual([]);
        pulls++;
        return { done: false, value: Uint8Array.of(65) };
      };
    },
    async return() {
      expect(this).toBe(producer);
      returns++;
      return { done: true, value: undefined };
    },
  };
  backing.readStream = () => ({ [Symbol.asyncIterator]: () => producer });
  const iterator = createDeviceFileSystem(backing).readStream("/input")[Symbol.asyncIterator]();
  try {
    expect(await iterator.next()).toEqual({ done: false, value: Uint8Array.of(65) });
    expect(gets).toBe(1);
    expect(pulls).toBe(1);
  } finally { await iterator.return!(); }
  expect(returns).toBe(1);
});

for (const reason of [false, 0, "", null]) {
  it(`does not read an already-acquired DeviceFS iterator after abort ${JSON.stringify(reason)}`, async () => {
    const backing = new MemoryFileSystem();
    await backing.writeFile("/input", Uint8Array.of(65, 10));
    const controller = new AbortController();
    let pulls = 0;
    let returns = 0;
    backing.readStream = () => ({ [Symbol.asyncIterator]: () => ({
      async next(): Promise<IteratorResult<Uint8Array>> {
        pulls++;
        return { done: false, value: Uint8Array.of(65) };
      },
      async return(): Promise<IteratorResult<Uint8Array>> {
        returns++;
        return { done: true, value: undefined };
      },
    }) });
    const iterator = createDeviceFileSystem(backing).readStream("/input", { signal: controller.signal })[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: Uint8Array.of(65) });
    controller.abort(reason);
    try {
      await expect(iterator.next()).rejects.toBe(reason);
      expect(pulls).toBe(1);
      expect(returns).toBe(1);
    } finally { await iterator.return!(); }
    expect(returns).toBe(1);
  });
}
