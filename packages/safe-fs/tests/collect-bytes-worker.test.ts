import { expect, it, vi } from "vitest";

vi.mock("#safe-fs-platform", async importOriginal => {
  const original = await importOriginal<typeof import("../src/platform/node.js")>();
  return { ...original, platform: { ...original.platform, maxCollectionBytes: 32 } };
});

import { collectBytes } from "../src/contracts/io.js";
import { platform as browserPlatform } from "../src/platform/browser.js";

it("uses a fixed 32 MiB budget in browser and Worker bundles", () => {
  expect(browserPlatform.maxCollectionBytes).toBe(32 * 1024 * 1024);
});

it("accepts just-under-limit input and rejects a larger single allocation", async () => {
  expect((await collectBytes((async function* () { yield new Uint8Array(15); })(), {
    maxBytes: 16
  })).length).toBe(15);
  await expect(collectBytes((async function* () { yield new Uint8Array(17); })(), {
    maxBytes: 64
  })).rejects.toMatchObject({ code: "EFBIG" });
});

it("refunds reservations on abort and on allocation failure", async () => {
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

it("shares the Worker ceiling across concurrent collectors and refunds on failure", async () => {
  let resume!: () => void;
  let ready!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { ready = resolve; });
  const first = collectBytes((async function* () {
    yield new Uint8Array(12);
    ready();
    await waiting;
  })(), {});
  await started;
  await expect(collectBytes((async function* () { yield new Uint8Array(12); })(), {
    maxMemoryBytes: 1000
  })).rejects.toMatchObject({ code: "EFBIG" });
  resume();
  expect((await first).length).toBe(12);
  expect((await collectBytes((async function* () { yield new Uint8Array(16); })(), {})).length).toBe(16);
});
