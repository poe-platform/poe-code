import assert from "node:assert/strict";
import { test } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts/command";
import { publish } from "./retained.js";

for (const atomicStagingAncestry of [false, true])
  test(`image output supports atomic receipt publication without synchronous guards (ancestry=${atomicStagingAncestry})`, async () => {
    const backing = createMemoryFileSystem();
    await backing.mkdir("/out");
    const fs = new Proxy(backing, { get(target, key) {
      if (key === "capabilities") return { ...target.capabilities, atomicStagingAncestry, guardedStagingPublication: false, synchronousStagingResolution: false };
      if (key === "prepareStagingResolution") return async () => { throw Error("synchronous staging resolution unavailable"); };
      if (key === "publishStagedFile") return (...args: Parameters<NonNullable<typeof target.publishStagedFile>>) => {
        assert.equal(args[2].commitGuard, undefined);
        return target.publishStagedFile!(...args);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const signal = new AbortController().signal;
    const context: CommandContext = { fs, signal, command: "pdf", args: [], cwd: "/", env: {},
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } };
    async function* chunks() { yield Uint8Array.of(0, 255); yield Uint8Array.of(3, 4); }
    await publish(context, "/out/result", chunks(), signal);
    assert.deepEqual(await fs.readFile("/out/result"), Uint8Array.of(0, 255, 3, 4));
    assert.deepEqual((await fs.readdir("/out")).map(e => e.name), ["result"]);

    async function* competing() { yield Uint8Array.of(1); await fs.writeFile("/out/result", Uint8Array.of(7)); yield Uint8Array.of(2); }
    await assert.rejects(publish(context, "/out/result", competing(), signal));
    assert.deepEqual(await fs.readFile("/out/result"), Uint8Array.of(7));
    assert.deepEqual((await fs.readdir("/out")).map(e => e.name), ["result"]);

    async function* broken() { yield Uint8Array.of(1); throw Error("producer failed"); }
    await assert.rejects(publish(context, "/out/result", broken(), signal), /producer failed/);
    assert.deepEqual(await fs.readFile("/out/result"), Uint8Array.of(7));
    assert.deepEqual((await fs.readdir("/out")).map(e => e.name), ["result"]);
    const cancelled = new AbortController();
    async function* cancelling() { yield Uint8Array.of(1); cancelled.abort(Error("cancelled")); yield Uint8Array.of(2); }
    await assert.rejects(publish({ ...context, signal: cancelled.signal }, "/out/result", cancelling(), cancelled.signal), /cancelled/);
    assert.deepEqual(await fs.readFile("/out/result"), Uint8Array.of(7));
    assert.deepEqual((await fs.readdir("/out")).map(e => e.name), ["result"]);
    await fs.symlink!("/out", "/alias");
    await publish(context, "/alias/result", chunks(), signal);
    assert.deepEqual(await fs.readFile("/out/result"), Uint8Array.of(0, 255, 3, 4));
    await fs.writeFile("/out/result", Uint8Array.of(7));
    await fs.symlink!("/out/result", "/out/link");
    await assert.rejects(publish(context, "/out/link", chunks(), signal));
    assert.deepEqual(await fs.readFile("/out/result"), Uint8Array.of(7));
    async function* moved() {
      yield Uint8Array.of(1);
      await fs.rename("/out", "/moved");
      await fs.mkdir("/out");
      await fs.writeFile("/out/result", Uint8Array.of(9));
      yield Uint8Array.of(2);
    }
    await assert.rejects(publish(context, "/out/result", moved(), signal));
    assert.deepEqual(await fs.readFile("/out/result"), Uint8Array.of(9));
    assert.deepEqual(await fs.readFile("/moved/result"), Uint8Array.of(7));
    assert.deepEqual((await fs.readdir("/moved")).map(e => e.name).sort(), ["link", "result"]);
  });
