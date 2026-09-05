import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createMemoryFileSystem, type FileDescriptor, type FileSystem, type FsOptions } from "poe-code/safe-fs";
import type { InvocationCleanup } from "../../src/contracts/command.js";
import { openCommandFile } from "../../src/contracts/filesystem-descriptor.js";
import { bindFileOutputBudget, openFileOutput } from "../../src/contracts/filesystem-output.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function fixture(options: {
  readonly capture?: () => void;
  readonly probe?: (options: FsOptions) => Promise<"ready" | "blocked" | "unknown">;
  readonly close?: () => Promise<void>;
} = {}) {
  const backing = createMemoryFileSystem();
  const controller = new AbortController();
  const cleanups: InvocationCleanup[] = [];
  const counters = { captures: 0, probes: 0, closes: 0, charges: 0 };
  const fs: FileSystem = new Proxy(backing, { get(target, key) {
    if (key === "open") return async (path: string, request: Parameters<typeof openCommandFile>[2]) => {
      const descriptor = await backing.open!(path, request);
      const close = descriptor.close.bind(descriptor);
      Object.defineProperty(descriptor, "capabilities", { value: Object.freeze({ ...descriptor.capabilities, readObservation: true }) });
      Object.defineProperty(descriptor, "probeRead", { configurable: true, get() {
        counters.captures++;
        options.capture?.();
        return async function(this: FileDescriptor, supplied: FsOptions = {}) {
          assert.equal(this, descriptor);
          counters.probes++;
          return options.probe ? options.probe(supplied) : "ready";
        };
      } });
      descriptor.close = async () => {
        counters.closes++;
        await options.close?.();
        await close();
      };
      return descriptor;
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const context = { fs, signal: controller.signal, registerCleanup(cleanup: InvocationCleanup) { cleanups.push(cleanup); } };
  bindFileOutputBudget(context, sink => sink, async (_chunk, write) => { counters.charges++; return write(); });
  return { context, controller, cleanups, counters };
}

for (const helper of ["command", "output"] as const) {
  for (const interruption of ["cleanup", "root false"] as const) {
    test(`observation review: ${helper} method capture ${interruption} must drain acquisition before rejecting`, { timeout: 2000 }, async () => {
      const entered = deferred();
      const release = deferred();
      let cleanup: Promise<unknown> | undefined;
      let settled = false;
      const host = fixture({
        capture() {
          if (interruption === "root false") host.controller.abort(false);
          else {
            cleanup = Promise.resolve(host.cleanups[0]!());
            void cleanup.catch(() => {});
          }
        },
        async close() { entered.resolve(); await release.promise; },
      });
      const opening = helper === "command"
        ? openCommandFile(host.context, "/file", { access: "write", creation: "ifMissing" })
        : openFileOutput(host.context, "/file", { flag: "w", descriptor: true });
      const result = opening.then(value => ({ status: "fulfilled" as const, value }), reason => ({ status: "rejected" as const, reason })).finally(() => { settled = true; });
      try {
        await Promise.race([entered.promise, result.then(() => { throw new Error("Acquisition settled before entering descriptor close"); })]);
        await nextTurn();
        assert.equal(settled, false, "observation method capture must not return an acquired handle while its retirement remains pending");
      } finally {
        release.resolve();
        await result;
        await Promise.allSettled([cleanup, ...host.cleanups.map(close => close())]);
      }
      const outcome = await result;
      assert.equal(outcome.status, "rejected");
      if (outcome.status !== "rejected") assert.fail("Acquisition succeeded after admission was revoked");
      if (interruption === "root false") assert.equal(outcome.reason, false);
      else assert.equal((outcome.reason as { code?: unknown }).code, "EBADF");
      assert.deepEqual(host.counters, { captures: 1, probes: 0, closes: 1, charges: 0 });
    });
  }

  test(`observation review: ${helper} queued options retain their captured signal despite later mutation`, { timeout: 2000 }, async () => {
    const entered = deferred();
    const release = deferred();
    const original = new AbortController();
    const replacement = new AbortController();
    let forwardedSignal = original.signal;
    let calls = 0;
    let gets = 0;
    const host = fixture({ async probe(supplied) {
      calls++;
      if (calls === 1) { entered.resolve(); await release.promise; }
      supplied.signal?.throwIfAborted();
      return "ready";
    } });
    const opened = helper === "command"
      ? await openCommandFile(host.context, "/file", { access: "write", creation: "ifMissing" })
      : await openFileOutput(host.context, "/file", { flag: "w", descriptor: true });
    const descriptor = "descriptor" in opened ? opened.descriptor! : opened as FileDescriptor;
    assert.equal(typeof descriptor.probeRead, "function");
    const first = descriptor.probeRead!();
    const options = { get signal() { gets++; return forwardedSignal; } };
    try {
      await entered.promise;
      const queued = descriptor.probeRead!(options);
      forwardedSignal = replacement.signal;
      replacement.abort(false);
      release.resolve();
      assert.equal(await first, "ready");
      assert.equal(await queued, "ready");
      assert.equal(gets, 1);
      assert.equal(host.controller.signal.aborted, false);
      assert.equal(host.counters.charges, 0);
      await assert.rejects(descriptor.read(new Uint8Array(1), null), { code: "EBADF" });
    } finally {
      release.resolve();
      await first.catch(() => {});
      await descriptor.close();
      await Promise.all(host.cleanups.map(close => close()));
    }
    assert.deepEqual(host.counters, { captures: 1, probes: 2, closes: 1, charges: 0 });
  });
}
