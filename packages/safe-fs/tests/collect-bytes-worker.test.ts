import { expect, it, vi } from "vitest";

vi.mock("#safe-fs-platform", async importOriginal => {
  const original = await importOriginal<typeof import("../src/platform/node.js")>();
  return { ...original, platform: { ...original.platform, maxCollectionBytes: 32 } };
});

import { collectBytes } from "../src/contracts/io.js";
import { platform as browserPlatform } from "../src/platform/browser.js";

it("disables the collection budget by default in browser and Worker bundles", () => {
  expect(browserPlatform.maxCollectionBytes).toBe(Infinity);
});

it("accepts just-under-limit input and rejects a larger single allocation", async () => {
  expect((await collectBytes((async function* () { yield new Uint8Array(15); })(), {
    maxBytes: 16, maxMemoryBytes: 32
  })).length).toBe(15);
  await expect(collectBytes((async function* () { yield new Uint8Array(17); })(), {
    maxBytes: 64, maxMemoryBytes: 32
  })).rejects.toMatchObject({ code: "EFBIG" });
});

it("keeps later collectors independent of abort and allocation failure", async () => {
  const controller = new AbortController();
  await expect(collectBytes((async function* () {
    yield new Uint8Array(12);
    controller.abort(new Error("cancelled"));
  })(), { signal: controller.signal })).rejects.toThrow("cancelled");
  const Native = Uint8Array;
  const chunk = new Native(12);
  vi.stubGlobal("Uint8Array", new Proxy(Native, {
    construct(target, args) {
      if (args[0] === 12) throw new RangeError("allocation failed");
      return Reflect.construct(target, args);
    }
  }));
  try {
    await expect(collectBytes((async function* () { yield chunk; })(), {}))
      .rejects.toThrow("allocation failed");
  } finally { vi.unstubAllGlobals(); }
  expect((await collectBytes((async function* () { yield new Uint8Array(16); })(), {})).length).toBe(16);
});

it("keeps concurrent collectors within their own explicit memory budgets", async () => {
  let resume!: () => void;
  let suspended!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const ready = new Promise<void>(resolve => { suspended = resolve; });
  const first = collectBytes((async function* () {
    yield new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    suspended();
    await gate;
  })(), { maxMemoryBytes: 32 });
  await ready;
  try {
    const second = await collectBytes((async function* () {
      yield Uint8Array.of(9, 10, 11, 12, 13, 14, 15, 16, 17);
    })(), { maxMemoryBytes: 32 });
    expect([...second]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  } finally {
    resume();
    expect([...(await first)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  }
});
