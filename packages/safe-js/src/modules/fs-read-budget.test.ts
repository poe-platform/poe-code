import { expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Budget } from "../interp/budget.js";
import { run } from "../run.js";
import { makeFsModule } from "./fs.js";

it("bounds adapter reads before the backend materializes an oversized file", async () => {
  const adapter = createMemoryFileSystem();
  await adapter.writeFile("/large", new Uint8Array(4096));
  const read = vi.spyOn(adapter, "readFile");
  await expect(run('import {readFile} from "fs"; return await readFile("/large", "utf8");', {
    modules: { fs: makeFsModule({ adapter }) }, budget: new Budget({ stringLength: 128, dataSize: 65536 })
  })).rejects.toBeDefined();
  expect(read.mock.calls[0]?.[1]?.maxBytes).toBe(64);
  await expect(read.mock.results[0]!.value).rejects.toMatchObject({ code: "EFBIG" });
});

it("reserves host memory across parallel reads and releases it after failure", async () => {
  const adapter = createMemoryFileSystem();
  const releases: Array<() => void> = [];
  const read = vi.spyOn(adapter, "readFile").mockImplementation(async () => {
    await new Promise<void>(resolve => { releases.push(resolve); });
    throw new Error("read failed");
  });
  const fs = makeFsModule({ adapter });
  const reads = Array.from({ length: 4 }, () => fs.readFile("/a", "utf8"));
  const settled = Promise.allSettled(reads);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  await expect(makeFsModule({ adapter }).readFile("/b", "utf8")).rejects.toThrow("memory");
  releases.forEach(release => release());
  expect(await settled).toEqual(Array.from({ length: 4 }, () => ({ status: "rejected", reason: expect.any(Error) })));
  read.mockResolvedValue(new Uint8Array([65]));
  expect(await fs.readFile("/c", "utf8")).toBe("A");
});

it("caps rooted hex reads using the remaining guest data allowance", async () => {
  const adapter = createMemoryFileSystem();
  await adapter.mkdir("/root");
  await adapter.writeFile("/root/large", new Uint8Array(65536));
  const read = vi.spyOn(adapter, "readFile");
  await expect(run('import {readFile} from "fs"; return await readFile("/root/large", "hex");', {
    modules: { fs: makeFsModule({ adapter, root: "/root" }) },
    budget: new Budget({ stringLength: 100000, dataSize: 32768 })
  })).rejects.toBeDefined();
  expect(read.mock.calls[0]?.[1]?.maxBytes).toBeGreaterThan(0);
  expect(read.mock.calls[0]?.[1]?.maxBytes).toBeLessThan(32768 / 4);
  await expect(read.mock.results[0]!.value).rejects.toMatchObject({ code: "EFBIG" });
});

it("admits small encoded reads", async () => {
  const adapter = createMemoryFileSystem();
  await adapter.writeFile("/a", new Uint8Array([65, 66]));
  expect(await run('import {readFile} from "fs"; return await readFile("/a", "hex");', {
    modules: { fs: makeFsModule({ adapter }) }, budget: new Budget({ stringLength: 128, dataSize: 65536 })
  })).toMatchObject({ ok: true, returnValue: "4142" });
});

it("holds reservations until cancelled backend reads actually settle", async () => {
  const adapter = createMemoryFileSystem();
  const controller = new AbortController();
  const releases: Array<() => void> = [];
  const read = vi.spyOn(adapter, "readFile").mockImplementation(async () => {
    await new Promise<void>(resolve => { releases.push(resolve); });
    return new Uint8Array();
  });
  const fs = makeFsModule({ adapter, signal: controller.signal });
  const cancelled = Promise.allSettled(Array.from({ length: 4 }, () => fs.readFile("/a", "utf8")));
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    controller.abort();
    expect((await cancelled).every(result => result.status === "rejected")).toBe(true);
    read.mockResolvedValue(new Uint8Array([65]));
    await expect(makeFsModule({ adapter }).readFile("/b", "utf8")).rejects.toThrow("memory");
  } finally {
    releases.forEach(release => release());
  }
  await vi.waitFor(async () => expect(await makeFsModule({ adapter }).readFile("/c", "utf8")).toBe("A"));
});
