import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, openFileDescriptor, type DescriptorBackend, type FileSystem, type FsOptions } from "poe-code/safe-fs";
import { prepareFileInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function provider(options: {
  readonly probe?: (options: FsOptions) => Promise<"ready" | "blocked" | "unknown">;
  readonly omitOpen?: boolean;
  readonly malformed?: "missing" | "throw undefined";
} = {}) {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/device", Uint8Array.of(255, 0, 97, 10));
  const counters = { opens: 0, reads: 0, writes: 0, probes: 0, closes: 0, legacy: 0 };
  const metadata = { type: "character" as const, size: 4, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
  const capabilities: { open?: boolean; [capability: string]: boolean | undefined } = { ...backing.capabilities };
  if (options.omitOpen) delete capabilities.open;
  const fs: FileSystem = new Proxy(backing, { get(target, key) {
    if (key === "capabilities") return capabilities;
    if (key === "capabilitiesFor") return undefined;
    if (key === "readFile" || key === "readStream") return () => {
      counters.legacy++;
      throw new Error("Attempted canonical acquisition must not fall back to legacy input");
    };
    if (key === "stat") return async (path: string, forwarded?: FsOptions) => {
      forwarded?.signal?.throwIfAborted();
      return path === "/device" ? metadata : backing.stat(path, forwarded);
    };
    if (key === "open") return async (path: string, request: Parameters<NonNullable<FileSystem["open"]>>[1]) => {
      assert.equal(path, "/device");
      counters.opens++;
      const resource = { position: 0 };
      const backend: DescriptorBackend<typeof resource> = {
        resource,
        async stat(retained) { assert.equal(retained, resource); return metadata; },
        async read() { counters.reads++; throw new Error("Observation must not consume descriptor bytes"); },
        async write() { counters.writes++; throw new Error("Observation must not write descriptor bytes"); },
        async truncate() { throw new Error("Observation must not truncate a retained descriptor"); },
        async sync() { throw new Error("Observation must not synchronize a retained descriptor"); },
        async close(retained) { assert.equal(retained, resource); counters.closes++; },
        async probeRead(retained, forwarded) {
          assert.equal(this, backend);
          assert.equal(retained, resource);
          counters.probes++;
          return options.probe ? options.probe(forwarded) : "ready";
        },
      };
      const descriptor = await openFileDescriptor(path, request, {
        positionedRead: false, positionedWrite: false, truncate: false,
        openTruncate: true, synchronization: "none", readObservation: true,
      }, async () => backend);
      if (options.malformed) Object.defineProperty(descriptor, "probeRead", { get() {
        if (options.malformed === "throw undefined") throw undefined;
        return undefined;
      } });
      return descriptor;
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { fs, counters };
}

function shellFor(fs: FileSystem, execute: (context: ShellExtensionContext) => Promise<number>) {
  return new Shell({ fs, limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "independent-provider-observation",
    create: () => ({ builtins: [{ name: "inspectfd", execute }] }),
  }] });
}

for (const access of ["read", "write"] as const) {
  for (const reason of [undefined, null, false, 0, ""]) {
    test(`provider bridge review: ${access} preserves genuine ${String(reason)} without poisoning alias observation`, { timeout: 2500 }, async context => {
      let reject = true;
      const subject = await provider({ async probe() {
        if (reject) { reject = false; throw reason; }
        return "ready";
      } });
      const shell = shellFor(subject.fs, async invocation => {
        assert.throws(() => invocation.input.observe(3), { code: "EBADF" });
        const observer = invocation.input.observe(4);
        try {
          assert.equal(observer.readable, access === "read");
          await assert.rejects(observer.probeRead(), error => Object.is(error, reason));
          assert.equal(invocation.signal.aborted, false);
          assert.equal(subject.counters.closes, 0);
          assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: access === "read" ? "honor" : "unknown" });
        } finally { await observer.release(); }
        assert.equal(subject.counters.closes, 0);
        const next = invocation.input.observe(4);
        try { assert.deepEqual(await next.probeRead(), { readiness: "ready", timeout: access === "read" ? "honor" : "unknown" }); }
        finally { await next.release(); }
        return 0;
      });
      context.after(() => shell.dispose());
      const result = await shell.exec(access === "read" ? "inspectfd 3<device 4<&3 3<&-" : "inspectfd 3>device 4>&3 3>&-");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(subject.counters, { opens: 1, reads: 0, writes: 0, probes: 3, closes: 1, legacy: 0 });
    });
  }

  test(`provider bridge review: ${access} wait captures a local signal and joins the provider without retiring the FD`, { timeout: 2500 }, async context => {
    const entered = deferred();
    const release = deferred();
    const original = new AbortController();
    const replacement = new AbortController();
    let selectedSignal = original.signal;
    let gets = 0;
    let calls = 0;
    const subject = await provider({ async probe(supplied) {
      if (++calls === 1) {
        entered.resolve();
        await release.promise;
        supplied.signal?.throwIfAborted();
      }
      return "ready";
    } });
    const shell = shellFor(subject.fs, async invocation => {
      const observer = invocation.input.observe(4);
      const waiting = observer.waitRead({ timeoutMs: 1000, get signal() { gets++; return selectedSignal; } });
      const settled = waiting.then(() => {}, () => {});
      try {
        await Promise.race([entered.promise, settled.then(() => { throw new Error("Provider probe was not entered"); })]);
        selectedSignal = replacement.signal;
        original.abort(false);
        assert.equal(subject.counters.closes, 0);
        release.resolve();
        await assert.rejects(waiting, reason => Object.is(reason, false));
        assert.equal(gets, 1);
        assert.equal(invocation.signal.aborted, false);
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: access === "read" ? "honor" : "unknown" });
      } finally {
        release.resolve();
        await settled;
        await observer.release();
      }
      assert.equal(subject.counters.closes, 0);
      return 0;
    });
    context.after(async () => { release.resolve(); await shell.dispose(); });
    const result = await shell.exec(access === "read" ? "inspectfd 3<device 4<&3 3<&-" : "inspectfd 3>device 4>&3 3>&-");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(subject.counters, { opens: 1, reads: 0, writes: 0, probes: 2, closes: 1, legacy: 0 });
  });
}

for (const omitOpen of [false, true]) for (const malformed of ["missing", "throw undefined"] as const) {
  test(`provider bridge review: open capability ${omitOpen ? "omitted" : "true"} cannot hide canonical ${malformed} behind fallback`, { timeout: 2500 }, async () => {
    const subject = await provider({ omitOpen, malformed });
    const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 });
    const cleanups: (() => void | Promise<void>)[] = [];
    try {
      const opening = prepareFileInput({ fs: subject.fs, signal: budget.signal, registerCleanup(cleanup) { cleanups.push(cleanup); } }, "/device", budget);
      if (malformed === "throw undefined") await assert.rejects(opening, reason => Object.is(reason, undefined));
      else await assert.rejects(opening, { code: "ENOTSUP", syscall: "probeRead" });
      assert.deepEqual(subject.counters, { opens: 1, reads: 0, writes: 0, probes: 0, closes: 1, legacy: 0 });
    } finally {
      try { await Promise.all(cleanups.map(close => close())); }
      finally { budget.close(); budget.values.close(); }
    }
  });
}
