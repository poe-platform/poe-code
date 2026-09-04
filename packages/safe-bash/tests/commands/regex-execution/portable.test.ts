import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { build, transform, type BuildOptions } from "esbuild";
import * as browser from "../../../src/browser.js";
import * as filesystem from "poe-code/safe-fs/core";

const provider = {
  createWorker() {
    return new Worker(new URL("../../../dist/commands/regex-execution/worker.js", import.meta.url), { execArgv: [] });
  },
};

test("public cooperative ERE primitives enforce shared work budgets and cancellation", async () => {
  const node = await import("../../../src/index.js");
  for (const name of ["EreLedger", "compileEre", "matchEre", "RegexExecutionError"] as const) assert.equal(browser[name], node[name]);
  assert.equal(typeof browser.EreLedger, "function");
  const ledger = new browser.EreLedger({ maxExpansionBytes: 4096, maxExpansionFields: 128 }, { work: 512 });
  const program = await browser.compileEre("^(a+)+$", ledger);
  await assert.rejects(browser.matchEre(program, "a".repeat(32) + "!", ledger), { resource: "work" });
  const cancelled = new AbortController();
  const reason = new Error("cancel ERE");
  const pending = browser.compileEre("a".repeat(4096), new browser.EreLedger({ maxExpansionBytes: 4096, maxExpansionFields: 128 }), cancelled.signal);
  cancelled.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test("portable search pack is public, opt-in, and registers the three commands atomically", async () => {
  assert.equal(typeof browser.portableSearchCommands, "function");
  const shell = new browser.Shell({ fs: new browser.MemoryFileSystem() }).use(browser.browserCommands());
  assert.equal((await shell.exec("grep x")).exitCode, 127);
  shell.use(browser.portableSearchCommands({ provider }));
  for (const source of ["printf 'first\\nsecond\\n' | grep second", "printf 'first\\nsecond\\n' | rg second", "printf 'first\\nsecond\\n' | sed -n '/second/p'"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "second\n");
  }
  await shell.dispose();
});

test("portable registration preflights collisions and requires an explicit provider", async () => {
  const commands = new browser.CommandRegistry();
  commands.register({ name: "rg", execute: () => ({ exitCode: 0 }) });
  const host = { commands, use() {}, registerFileSystem() {} };
  const plugin = browser.portableSearchCommands({ provider });
  assert.throws(() => plugin.setup(host), /already registered: rg/);
  assert.equal(commands.has("grep"), false);
  assert.equal(commands.has("sed"), false);
  await plugin.dispose?.();
  const replacement = browser.portableSearchCommands({ provider, replace: true });
  await replacement.setup(host);
  assert.equal(commands.has("grep"), true);
  assert.equal(commands.has("sed"), true);
  await replacement.dispose?.();
  assert.throws(() => browser.portableSearchCommands({ provider: undefined! }), /bounded regex provider is required/);
});

test("portable commands do not depend on Node globals or Node timer handles", { timeout: 3000 }, async () => {
  const { resolveBrowserShellBuild } = await import(new URL("../../../../../scripts/bundle-safe-bash.mjs", import.meta.url).href) as { resolveBrowserShellBuild(root: string): BuildOptions };
  const bundle = await build(resolveBrowserShellBuild(fileURLToPath(new URL("../../../../../", import.meta.url))));
  const compiled = await transform(bundle.outputFiles!.find(output => output.path.endsWith("browser.js"))!.text, { format: "cjs" });
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let timerId = 0;
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, Float64Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, queueMicrotask, performance, canonical: filesystem,
    setTimeout(callback: () => void, delay: number) {
      const id = ++timerId;
      timers.set(id, setTimeout(() => { timers.delete(id); callback(); }, delay));
      return id;
    },
    clearTimeout(id: number) { clearTimeout(timers.get(id)); timers.delete(id); },
  });
  const portable = runInContext(`(function(){ const module = { exports: {} }; const require = name => { if (name !== "poe-code/safe-fs/core") throw new Error(name); return canonical; }; ${compiled.code}; return module.exports; })()`, sandbox) as typeof browser;
  assert.equal(runInContext("typeof Buffer + ':' + typeof process", sandbox), "undefined:undefined");
  const shell = new portable.Shell({ fs: new portable.MemoryFileSystem() }).use(portable.browserCommands()).use(portable.portableSearchCommands({ provider }));
  try {
    for (const source of ["printf 'café\\n' | grep 'café'", "printf 'café\\n' | rg --json 'café'", "printf 'café\\n' | sed 's/café/tea/'"]) {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(result.stdout.length > 0);
    }
  } finally {
    await shell.dispose();
  }
});

test("portable pack preserves adversarial regex deadlines and sed step budgets", async () => {
  assert.equal(typeof browser.portableSearchCommands, "function");
  const fs = new browser.MemoryFileSystem();
  await fs.writeFile("/input", new TextEncoder().encode("a".repeat(40) + "!\n"));
  const shell = new browser.Shell({ fs }).use(browser.portableSearchCommands({ provider, regex: { requestTimeoutMs: 20 }, sed: { maxSteps: 20 } }));
  for (const source of ["grep -E '(a+)+$' /input", "rg '(a+)+$' /input"]) {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /REQUEST_TIMEOUT/);
  }
  const result = await shell.exec("sed -n '/z/p' /input");
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /step limit/);
  await shell.dispose();
});

async function capabilityShell(capabilities: browser.FileSystemCapabilities, paths: Readonly<Record<string, browser.FileSystemCapabilities>> = {}) {
  const backing = new browser.MemoryFileSystem();
  for (const [path, text] of Object.entries({ "/input": "first\nsecond\n", "/patterns": "second\n", "/script": "s/second/changed/", "/output": "keep", "/denied": "keep denied", "/extra": "extra\n" })) {
    await backing.writeFile(path, new TextEncoder().encode(text));
  }
  const calls: string[] = [];
  const fs = new Proxy(backing, {
    get(target, property) {
      if (property === "capabilities") return { ...target.capabilities, ...capabilities };
      if (property === "capabilitiesFor") return async (path: string) => ({ ...target.capabilities, ...capabilities, ...paths[path] });
      const member = Reflect.get(target, property);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        calls.push(`${String(property)}:${String(args[0])}`);
        return Reflect.apply(member, target, args);
      };
    },
  });
  const shell = new browser.Shell({ fs }).use(browser.portableSearchCommands({ provider }));
  return { shell, backing, calls };
}

test("portable search help declares separate supported, unsupported, and unknown modes", async () => {
  const commands = new browser.CommandRegistry();
  const plugin = browser.portableSearchCommands({ provider });
  await plugin.setup({ commands, use() {}, registerFileSystem() {} });
  try {
    for (const name of ["grep", "rg", "sed"]) {
      const command = commands.get(name)!;
      const help = browser.evaluateCommandSupport(command, { read: false, streamingRead: false, write: false, append: false, readOnly: true });
      assert.equal(help.declared, true, name);
      assert.equal(help.modes.find(mode => mode.id === "stdin")?.status, "supported", name);
      assert.equal(help.modes.find(mode => mode.id === "file")?.status, "unsupported", name);
      assert.equal(browser.evaluateCommandSupport(command, {}).modes.find(mode => mode.id === "file")?.status, "unknown", name);
    }
    const help = browser.evaluateCommandSupport(commands.get("sed")!, { readOnly: true, write: true, append: true, copy: true, stat: true });
    for (const id of ["in-place", "backup", "script-output"]) assert.equal(help.modes.find(mode => mode.id === id)?.status, "unsupported", id);
  } finally { await plugin.dispose?.(); }
});

test("portable search rejects denied file operands and pattern/script files before reads", async () => {
  const { shell, calls } = await capabilityShell({ read: false, streamingRead: false });
  try {
    for (const source of ["grep second /input", "grep -f /patterns -", "rg second /input", "rg -f /patterns -", "sed p /input", "sed -f /script"]) {
      const result = await shell.exec(source, { stdin: "second\n" });
      assert.notEqual(result.exitCode, 0, source);
      assert.match(result.stderr, /ENOTSUP/, source);
    }
    assert.equal(calls.some(call => call.startsWith("readFile:") || call.startsWith("readStream:")), false);
    for (const source of ["grep second", "rg second -", "sed -n '/second/p'"]) {
      const result = await shell.exec(source, { stdin: "second\n" });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "second\n");
    }
  } finally { await shell.dispose(); }
});

test("buffered script/pattern modes do not claim streaming-only read support", async () => {
  const { shell, calls } = await capabilityShell({ read: false, streamingRead: true });
  try {
    for (const source of ["rg -f /patterns -", "sed -f /script"]) {
      const result = await shell.exec(source, { stdin: "second\n" });
      assert.match(result.stderr, /ENOTSUP/, source);
    }
    assert.equal(calls.some(call => call.startsWith("readFile:")), false);
    assert.equal((await shell.exec("grep -f /patterns /input")).stdout, "second\n");
  } finally { await shell.dispose(); }
});

test("rg traversal admission is conditional and precedes unsupported directory methods", async () => {
  const { shell, calls } = await capabilityShell({ readdir: false });
  try {
    assert.equal((await shell.exec("rg second /input")).stdout, "second\n");
    calls.length = 0;
    const result = await shell.exec("rg --no-ignore second /");
    assert.match(result.stderr, /ENOTSUP/);
    assert.equal(calls.some(call => call.startsWith("readdir:")), false);
  } finally { await shell.dispose(); }
  const listing = await capabilityShell({ read: false, streamingRead: false });
  try {
    assert.equal((await listing.shell.exec("rg --files --no-ignore /")).exitCode, 0);
    const result = await listing.shell.exec("rg --files /");
    assert.match(result.stderr, /ENOTSUP/);
    assert.equal(listing.calls.some(call => call.startsWith("readFile:")), false);
  } finally { await listing.shell.dispose(); }
});

test("sed required writes and backups are rejected before any truncation or stdin read", async () => {
  for (const [capabilities, source] of [
    [{ append: false }, "sed 'w /output'"],
    [{ write: false, streamingWrite: true }, "sed 'w /output'"],
    [{ copy: false }, "sed -i.bak -e 'w /output' /input"],
    [{ readOnly: true }, "sed -i -e 'w /output' /input"],
  ] as const) {
    const { shell, backing, calls } = await capabilityShell(capabilities);
    let pulls = 0;
    const stdin = { async *[Symbol.asyncIterator]() { pulls++; yield new TextEncoder().encode("second\n"); } };
    try {
      const result = await shell.exec(source, { stdin });
      assert.notEqual(result.exitCode, 0, source);
      assert.match(result.stderr, /ENOTSUP|EROFS/, source);
      assert.equal(pulls, 0, source);
      assert.equal(calls.some(call => call.startsWith("writeFile:") || call.startsWith("appendFile:") || call.startsWith("copyFile:")), false, source);
      assert.equal(new TextDecoder().decode(await backing.readFile("/output")), "keep");
    } finally { await shell.dispose(); }
  }
});

test("sed preflights all path-specific script reads, outputs, and backup destinations", async () => {
  for (const [paths, source] of [
    [{ "/denied": { readOnly: true } }, "sed -e 'w /output' -e 'w /denied' /input"],
    [{ "/extra": { read: false, streamingRead: false } }, "sed -e 'w /output' -e 'r /extra' /input"],
    [{ "/input.bak": { copy: false } }, "sed -i.bak -e 'w /output' /input"],
  ] as const) {
    const { shell, backing, calls } = await capabilityShell({}, paths);
    try {
      const result = await shell.exec(source);
      assert.notEqual(result.exitCode, 0, source);
      assert.match(result.stderr, /ENOTSUP|EROFS/, source);
      assert.equal(calls.some(call => call.startsWith("writeFile:") || call.startsWith("appendFile:") || call.startsWith("copyFile:")), false, source);
      assert.equal(new TextDecoder().decode(await backing.readFile("/output")), "keep");
    } finally { await shell.dispose(); }
  }
});
