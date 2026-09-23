import { setImmediate } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { makeFsModule } from "./fs.js";

afterEach(() => vi.restoreAllMocks());

it.each([false, true])("confines a guest symlink swap during a read (separate module: %s)", async (separateModule) => {
  const adapter = createMemoryFileSystem();
  await adapter.mkdir("/tenant/a/b", { recursive: true });
  await adapter.writeFile("/secret", Buffer.from("OUTSIDE-ROOT"));
  await adapter.writeFile("/tenant/secret", Buffer.from("IN-ROOT"));
  await adapter.writeFile("/tenant/safe", Buffer.from("SAFE"));
  const fs = makeFsModule({ adapter, root: "/tenant" });
  const mutator = separateModule ? makeFsModule({ adapter, root: "/tenant" }) : fs;
  await fs.symlink("safe", "/tenant/link");
  await fs.symlink("../../secret", "/tenant/a/b/escape");

  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const read = adapter.readFile.bind(adapter);
  vi.spyOn(adapter, "readFile").mockImplementationOnce(async (...args) => {
    entered();
    await gate;
    return read(...args);
  });

  const reading = fs.readFile("/tenant/link", "utf8");
  await started;
  const swapping = mutator.rename("/tenant/a/b/escape", "/tenant/link");
  // Drain admission/backend microtasks while the read remains at the gate.
  await setImmediate();
  release();
  await expect(reading).resolves.toBe("SAFE");
  await swapping;
  await expect(fs.readFile("/tenant/link", "utf8")).rejects.toMatchObject({ code: "EACCES" });
});

it("confines a guest symlink swap during a write", async () => {
  const adapter = createMemoryFileSystem();
  await adapter.mkdir("/tenant/a/b", { recursive: true });
  await adapter.writeFile("/secret", Buffer.from("OUTSIDE-ROOT"));
  await adapter.writeFile("/tenant/secret", Buffer.from("IN-ROOT"));
  await adapter.writeFile("/tenant/safe", Buffer.from("SAFE"));
  const fs = makeFsModule({ adapter, root: "/tenant" });
  await fs.symlink("safe", "/tenant/link");
  await fs.symlink("../../secret", "/tenant/a/b/escape");

  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const write = adapter.writeFile.bind(adapter);
  vi.spyOn(adapter, "writeFile").mockImplementationOnce(async (...args) => {
    entered();
    await gate;
    return write(...args);
  });
  const writing = fs.writeFile("/tenant/link", "UPDATED");
  await started;
  const swapping = fs.rename("/tenant/a/b/escape", "/tenant/link");
  await setImmediate();
  release();
  await writing;
  await swapping;
  expect(Buffer.from(await adapter.readFile("/secret")).toString()).toBe("OUTSIDE-ROOT");
  expect(Buffer.from(await adapter.readFile("/tenant/safe")).toString()).toBe("UPDATED");
  await expect(fs.writeFile("/tenant/link", "ESCAPED")).rejects.toMatchObject({ code: "EACCES" });
});

it("releases rooted operations after admission and backend failures", async () => {
  const adapter = createMemoryFileSystem();
  await adapter.mkdir("/tenant");
  await adapter.writeFile("/tenant/safe", Buffer.from("SAFE"));
  const fs = makeFsModule({ adapter, root: "/tenant" });
  await expect(fs.readFile("/outside", "utf8")).rejects.toMatchObject({ code: "EACCES" });
  vi.spyOn(adapter, "readFile").mockRejectedValueOnce(new Error("backend failed"));
  await expect(fs.readFile("safe", "utf8")).rejects.toThrow("backend failed");
  await expect(fs.readFile("safe", "utf8")).resolves.toBe("SAFE");
});
