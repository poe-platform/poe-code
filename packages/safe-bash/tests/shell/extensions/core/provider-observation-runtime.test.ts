import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, openFileDescriptor, type DescriptorBackend, type FileSystem, type FsOptions } from "poe-code/safe-fs";
import { openCommandFile } from "../../../../src/contracts/filesystem-descriptor.js";
import { openFileOutput } from "../../../../src/contracts/filesystem-output.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

type Readiness = "ready" | "blocked" | "unknown";
interface Resource {
  bytes: Uint8Array;
  position: number;
  reads: number;
  writes: number;
  probes: number;
  closes: number;
}

async function provider(options: {
  capability?: boolean | "omitted";
  readiness?: Readiness;
  missingProbe?: boolean;
  globalOpen?: boolean | "omitted";
  pathOpen?: boolean;
  missingOpen?: boolean;
  hideProbe?: boolean;
  bytes?: Uint8Array;
  probe?: (resource: Resource, options: FsOptions) => Promise<Readiness>;
} = {}) {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/resource", options.bytes ?? Uint8Array.of(255, 0, 97));
  const resources: Resource[] = [];
  let pathnameStats = 0;
  const capability = options.capability ?? true;
  const globalCapabilities: { open?: boolean; [capability: string]: boolean | undefined } = { ...backing.capabilities };
  if (options.globalOpen === "omitted") delete globalCapabilities.open;
  else if (options.globalOpen !== undefined) globalCapabilities.open = options.globalOpen;
  const replacements: Partial<FileSystem> = {
    capabilities: globalCapabilities,
    ...(options.pathOpen === undefined ? {} : { async capabilitiesFor(path: string, forwarded?: FsOptions) {
      forwarded?.signal?.throwIfAborted();
      assert.equal(path, "/resource");
      return { ...backing.capabilities, open: options.pathOpen! };
    } }),
    async stat(path, forwarded) {
      pathnameStats++;
      const stat = await backing.stat(path, forwarded);
      return path === "/resource" ? { ...stat, type: "character" as const } : stat;
    },
    async open(path, forwarded) {
      assert.equal(path, "/resource", "Observation must not reopen another namespace entry");
      const descriptor = await openFileDescriptor<Resource>(path, forwarded, {
        positionedRead: false, positionedWrite: false, truncate: false,
        openTruncate: true, synchronization: "none",
        ...(capability === "omitted" ? {} : { readObservation: capability }),
      }, async () => {
        const resource: Resource = { bytes: new Uint8Array(options.bytes ?? Uint8Array.of(255, 0, 97)), position: 0, reads: 0, writes: 0, probes: 0, closes: 0 };
        resources.push(resource);
        const backend: DescriptorBackend<Resource> = {
          resource,
          async stat(retained) {
            assert.equal(retained, resource);
            return { type: "character", size: retained.bytes.length, mode: 0o020666, atimeMs: 0, mtimeMs: 0, ctimeMs: 0 };
          },
          async read(retained, buffer, position) {
            assert.equal(retained, resource);
            assert.equal(position, null);
            retained.reads++;
            const bytes = retained.bytes.subarray(retained.position, retained.position + buffer.length);
            buffer.set(bytes);
            retained.position += bytes.length;
            return bytes.length;
          },
          async write(retained, bytes, position) {
            assert.equal(retained, resource);
            assert.equal(position, null);
            retained.writes++;
            return bytes.length;
          },
          async truncate() { assert.fail("Open truncation must not call unsupported truncate"); },
          async sync() { assert.fail("Observation must not synchronize data"); },
          async close(retained) { assert.equal(retained, resource); retained.closes++; },
          ...(options.missingProbe ? {} : { async probeRead(retained: Resource, forwarded: FsOptions): Promise<Readiness> {
            assert.equal(this, backend);
            assert.equal(retained, resource);
            assert.equal(retained.closes, 0, "Probe must retain the admitted open resource");
            retained.probes++;
            return options.probe ? options.probe(retained, forwarded) : options.readiness ?? "ready";
          } }),
        };
        return backend;
      });
      if (!options.hideProbe) return descriptor;
      return new Proxy(descriptor, { get(target, key) {
        if (key === "probeRead") return undefined;
        const member: unknown = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      } });
    },
  };
  const fs = new Proxy(backing, { get(target, key) {
    if (options.missingOpen && key === "open") return undefined;
    if (Object.hasOwn(replacements, key)) return Reflect.get(replacements, key);
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  return { fs, backing, resources, pathnameStats: () => pathnameStats };
}

function setup(fs: FileSystem, execute: (context: ShellExtensionContext) => Promise<number>) {
  return new Shell({ fs, extensions: [{ name: "provider-observation", create: () => ({ builtins: [{ name: "inspect", execute }] }) }] });
}

for (const output of [false, true]) test(`dependency control: public builder probe survives command ${output ? "output" : "input"} helper`, async () => {
  const subject = await provider({ readiness: "blocked" });
  const cleanups: (() => void | Promise<void>)[] = [];
  const context = { fs: subject.fs, signal: new AbortController().signal, registerCleanup: (cleanup: () => void | Promise<void>) => { cleanups.push(cleanup); } };
  try {
    const sink = output ? await openFileOutput(context, "/resource", { descriptor: true, flag: "w" }) : undefined;
    const descriptor = sink?.descriptor ?? await openCommandFile(context, "/resource", { access: "read" });
    assert.equal(descriptor.capabilities.readObservation, true);
    assert.equal(typeof descriptor.probeRead, "function");
    assert.equal(await descriptor.probeRead!(), "blocked");
    assert.equal(subject.resources[0]!.reads, 0);
    assert.equal(subject.resources[0]!.position, 0);
    if (sink) await sink.finish();
    else await descriptor.close();
  } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
  assert.equal(subject.resources.length, 1);
  assert.equal(subject.resources[0]!.closes, 1);
});

for (const readable of [false, true]) for (const readiness of ["ready", "blocked", "unknown"] as const) {
  test(`provider observation reaches ${readable ? "read" : "write"} aliases: ${readiness}`, async context => {
    const subject = await provider({ readiness });
    const shell = setup(subject.fs, async invocation => {
      const primary = invocation.input.observe(readable ? 0 : 1);
      const alias = invocation.input.observe(3);
      const beforeStats = subject.pathnameStats();
      assert.equal(primary.readable, readable);
      assert.equal(alias.readable, readable);
      if (!readable) assert.throws(() => invocation.input.borrow(3), { code: "EBADF" });
      assert.deepEqual(await primary.probeRead(), { readiness, timeout: readable ? "honor" : "unknown" });
      assert.deepEqual(await alias.probeRead(), { readiness, timeout: readable ? "honor" : "unknown" });
      assert.equal(await primary.waitRead({ timeoutMs: 0.25 }), readiness === "ready" ? "ready" : "unknown");
      const retained = subject.resources[0]!;
      assert.equal(retained.probes, 3);
      assert.equal(retained.position, 0);
      assert.equal(retained.reads, 0);
      assert.equal(retained.writes, 0);
      assert.equal(subject.pathnameStats(), beforeStats);
      await primary.release();
      await primary.release();
      await assert.rejects(primary.probeRead(), { code: "EBADF" });
      await alias.release();
      assert.equal(retained.closes, 0);
      return 0;
    });
    context.after(() => shell.dispose());
    const result = await shell.exec(readable ? "inspect 3<resource 0<&3" : "inspect 3>resource 1>&3");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(subject.resources.length, 1);
    assert.equal(subject.resources[0]!.closes, 1);
  });
}

for (const readable of [false, true]) for (const capability of [false, "omitted"] as const) {
  test(`nonaffirmative capability ${capability} does not promote ${readable ? "read" : "write"} observation`, async context => {
    const subject = await provider({ capability });
    const shell = setup(subject.fs, async invocation => {
      const observer = invocation.input.observe(readable ? 0 : 1);
      assert.deepEqual(await observer.probeRead(), { readiness: "unknown", timeout: readable ? "honor" : "unknown" });
      assert.equal(await observer.waitRead({ timeoutMs: 0.25 }), "unknown");
      assert.equal(subject.resources[0]!.probes, 0);
      assert.equal(subject.resources[0]!.reads, 0);
      await observer.release();
      return 0;
    });
    context.after(() => shell.dispose());
    const result = await shell.exec(readable ? "inspect <resource" : "inspect >resource");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(subject.resources[0]!.closes, 1);
  });
}

for (const readable of [false, true]) test(`provider observation retains ${readable ? "read" : "write"} identity after namespace replacement`, async context => {
  const subject = await provider();
  const shell = setup(subject.fs, async invocation => {
    const observer = invocation.input.observe(readable ? 0 : 1);
    await subject.backing.rename("/resource", "/moved");
    await subject.backing.mkdir("/resource");
    const beforeStats = subject.pathnameStats();
    assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: readable ? "honor" : "unknown" });
    assert.equal(subject.resources.length, 1);
    assert.equal(subject.resources[0]!.probes, 1);
    assert.equal(subject.pathnameStats(), beforeStats);
    await observer.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(readable ? "inspect <resource" : "inspect >resource");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(subject.resources[0]!.closes, 1);
  assert.deepEqual(await subject.backing.readFile("/moved"), Uint8Array.of(255, 0, 97));
});

for (const readiness of ["ready", "blocked", "unknown"] as const) test(`nonregular EOF retains input identity and provider readiness: ${readiness}`, async context => {
  const subject = await provider({ bytes: Uint8Array.of(255, 0, 97), readiness });
  const shell = setup(subject.fs, async invocation => {
    const observer = invocation.input.observe(3);
    const borrow = invocation.input.borrow(0);
    const record = await borrow.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 97));
    await record.release();
    await borrow.release();
    const retained = subject.resources[0]!;
    assert.equal(retained.reads, 2);
    assert.equal(retained.closes, 0, "EOF and borrowed-reader release must not close the still-bound resource");
    assert.deepEqual(await observer.probeRead(), { readiness, timeout: "honor" });
    assert.equal(retained.probes, 1);
    assert.equal(retained.position, 3);
    assert.equal(retained.reads, 2);
    await observer.release();
    assert.equal(retained.closes, 0);
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspect 3<resource 0<&3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(subject.resources[0]!.closes, 1);
});

for (const readable of [false, true]) test(`missing affirmative provider probe refuses ${readable ? "input" : "output"} acquisition`, async context => {
  const subject = await provider({ missingProbe: true });
  let entered = false;
  const shell = setup(subject.fs, async () => { entered = true; return 0; });
  context.after(() => shell.dispose());
  const result = await shell.exec(readable ? "inspect <resource" : "inspect >resource");
  assert.equal(result.exitCode, 1);
  assert.equal(entered, false);
  assert.equal(subject.resources.length, 1);
  assert.equal(subject.resources[0]!.closes, 1);
});

for (const readable of [false, true]) test(`invalid provider probe is rejected on ${readable ? "input" : "output"}`, async context => {
  const subject = await provider({ async probe() { return Reflect.get({ readiness: "eof" }, "readiness") as Readiness; } });
  const shell = setup(subject.fs, async invocation => {
    const observer = invocation.input.observe(readable ? 0 : 1);
    await assert.rejects(observer.probeRead(), { code: "EIO", syscall: "probeRead" });
    await observer.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(readable ? "inspect <resource" : "inspect >resource");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(subject.resources[0]!.closes, 1);
});

for (const readable of [false, true]) for (const reason of [false, 0, "", null]) {
  test(`provider probe preserves root cancellation ${String(reason)} on ${readable ? "input" : "output"}`, async context => {
    const controller = new AbortController();
    const subject = await provider({ async probe(_retained, options) {
      controller.abort(reason);
      options.signal!.throwIfAborted();
      assert.fail("Probe cancellation must be forwarded");
    } });
    const shell = setup(subject.fs, async invocation => {
      const observer = invocation.input.observe(readable ? 0 : 1);
      await observer.probeRead();
      assert.fail("Provider cancellation must prevent successful observation");
    });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(readable ? "inspect <resource" : "inspect >resource", { signal: controller.signal }), error => Object.is(error, reason));
    assert.equal(subject.resources[0]!.probes, 1);
    assert.equal(subject.resources[0]!.closes, 1);
  });
}

for (const readable of [false, true]) test(`observer release drains admitted ${readable ? "input" : "output"} provider probe without closing its binding`, async context => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const subject = await provider({ async probe(_retained, options) {
    entered();
    await gate;
    options.signal!.throwIfAborted();
    return "ready";
  } });
  const shell = setup(subject.fs, async invocation => {
    const observer = invocation.input.observe(readable ? 0 : 1);
    const probing = observer.probeRead();
    const settled = probing.then(() => {}, () => {});
    try {
      await Promise.race([started, settled.then(() => { assert.fail("Observation settled without reaching the advertised provider probe"); })]);
      let released = false;
      const releasing = observer.release().then(() => { released = true; });
      await Promise.resolve();
      assert.equal(released, false, "Release must join the admitted provider operation");
      assert.equal(subject.resources[0]!.closes, 0);
      finish();
      await assert.rejects(probing, { code: "EBADF" });
      await releasing;
      assert.equal(subject.resources[0]!.closes, 0, "An observation lease is not the FD owner");
      await assert.rejects(observer.probeRead(), { code: "EBADF" });
      return 0;
    } finally {
      finish();
      await settled;
      await observer.release();
    }
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(readable ? "inspect <resource" : "inspect >resource");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(subject.resources[0]!.closes, 1);
});

for (const source of ["inspect", "bash -c inspect", "sh -c inspect"]) test(`buffered unread bytes outrank blocked provider through ${source}`, async context => {
  const subject = await provider({ readiness: "blocked", bytes: Uint8Array.of(97, 10, 255, 0, 98) });
  const shell = setup(subject.fs, async invocation => {
    const borrow = invocation.input.borrow(0);
    const first = await borrow.record();
    assert.deepEqual(shellValueBytes(first.shellValue), Uint8Array.of(97, 10));
    await first.release();
    await borrow.release();
    const observer = invocation.input.observe(0);
    assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "honor" });
    assert.equal(await observer.waitRead({ timeoutMs: 0.25 }), "ready");
    const retained = subject.resources[0]!;
    assert.equal(retained.probes, 0);
    assert.equal(retained.reads, 1);
    assert.equal(retained.position, 5);
    const alias = invocation.input.borrow(3);
    const remaining = await alias.record();
    assert.deepEqual(shellValueBytes(remaining.shellValue), Uint8Array.of(255, 0, 98));
    await remaining.release();
    await alias.release();
    assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
    assert.equal(retained.probes, 1);
    assert.equal(retained.closes, 0);
    await observer.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec(`${source} 3<resource 0<&3`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(subject.resources.length, 1);
  assert.equal(subject.resources[0]!.closes, 1);
});

for (const pathOpen of [false, true]) test(`input acquisition honors resolved open=${pathOpen} over contradictory global capability`, async context => {
  const subject = await provider({ globalOpen: !pathOpen, pathOpen, missingProbe: true });
  let entered = false;
  const shell = setup(subject.fs, async () => { entered = true; return 0; });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspect <resource");
  assert.equal(result.exitCode, pathOpen ? 1 : 0, result.stderr);
  assert.equal(entered, !pathOpen);
  assert.equal(subject.resources.length, pathOpen ? 1 : 0);
  if (pathOpen) assert.equal(subject.resources[0]!.closes, 1);
});

test("callable open with omitted FS capability must not hide an acquired malformed descriptor through fallback", async context => {
  const subject = await provider({ globalOpen: "omitted", hideProbe: true });
  assert.equal(Object.hasOwn(subject.fs.capabilities, "open"), false);
  let entered = false;
  const shell = setup(subject.fs, async () => { entered = true; return 0; });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspect <resource");
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(entered, false);
  assert.equal(subject.resources.length, 1);
  assert.equal(subject.resources[0]!.closes, 1);
});

test("callable open with omitted FS capability retains valid provider observation", async context => {
  const subject = await provider({ globalOpen: "omitted", readiness: "blocked" });
  const shell = setup(subject.fs, async invocation => {
    const observer = invocation.input.observe(0);
    assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
    await observer.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspect <resource");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(subject.resources.length, 1);
  assert.equal(subject.resources[0]!.closes, 1);
});

for (const globalOpen of [true, "omitted"] as const) test(`missing open method with FS capability ${globalOpen} is selected before acquisition`, async context => {
  const subject = await provider({ globalOpen, missingOpen: true });
  let entered = false;
  const shell = setup(subject.fs, async () => { entered = true; return 0; });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspect <resource");
  assert.equal(result.exitCode, globalOpen === true ? 1 : 0, result.stderr);
  assert.equal(entered, globalOpen !== true);
  assert.equal(subject.resources.length, 0);
});

for (const capability of [false, "omitted"] as const) test(`terminal EOF remains locally ready without advertised observation: ${capability}`, async context => {
  const subject = await provider({ capability, readiness: "blocked" });
  const shell = setup(subject.fs, async invocation => {
    const observer = invocation.input.observe(0);
    assert.deepEqual(await observer.probeRead(), { readiness: "unknown", timeout: "honor" });
    const borrow = invocation.input.borrow(0);
    const record = await borrow.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 97));
    await record.release();
    await borrow.release();
    assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "honor" });
    assert.equal(await observer.waitRead({ timeoutMs: 0.25 }), "ready");
    assert.equal(subject.resources[0]!.probes, 0);
    assert.equal(subject.resources[0]!.closes, 0);
    await observer.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspect <resource");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(subject.resources[0]!.closes, 1);
});
