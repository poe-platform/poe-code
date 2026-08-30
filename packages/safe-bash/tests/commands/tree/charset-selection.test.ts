import assert from "node:assert/strict";
import { setImmediate as yieldTurn } from "node:timers/promises";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { Shell } from "../../../src/shell/index.js";
import { run, wrapped } from "./helpers.js";

const ascii = ".\n`-- file\n";
const unicode = ".\n└── file\n";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array());
  return fs;
}

const selections: readonly [string, Record<string, string>, string][] = [
  ["absent", {}, ascii],
  ["C", { LC_ALL: "C" }, ascii],
  ["POSIX", { LC_ALL: "POSIX" }, ascii],
  ["UTF-8 LC_ALL", { LC_ALL: "en_US.UTF-8" }, unicode],
  ["UTF-8 LANG", { LANG: "en_US.UTF-8" }, unicode],
  ["LC_CTYPE overrides LANG", { LC_CTYPE: "en_US.UTF-8", LANG: "C" }, unicode],
  ["LC_ALL overrides LC_CTYPE", { LC_ALL: "C", LC_CTYPE: "en_US.UTF-8", LANG: "en_US.UTF-8" }, ascii],
  ["empty LC_ALL falls through", { LC_ALL: "", LANG: "en_US.UTF-8" }, unicode],
  ["empty LC_ALL and LC_CTYPE fall through", { LC_ALL: "", LC_CTYPE: "", LANG: "en_US.UTF-8" }, unicode],
  ["all locale values empty", { LC_ALL: "", LC_CTYPE: "", LANG: "" }, ascii],
  ["unknown LC_ALL stops lookup", { LC_ALL: "unknown", LANG: "en_US.UTF-8" }, ascii],
  ["unknown suffix is not a virtual locale", { LC_ALL: "not-installed.UTF-8" }, ascii],
  ["locale names are case-sensitive", { LC_ALL: "EN_US.UTF-8" }, ascii],
  ["locale values are not trimmed", { LC_ALL: "en_US.UTF-8 " }, ascii],
  ["C.UTF-8", { LC_ALL: "C.UTF-8" }, unicode],
  ["virtual-only C.utf8 alias", { LC_ALL: "C.utf8" }, unicode],
  ["virtual-only en_US.utf8 alias", { LC_ALL: "en_US.utf8" }, unicode],
  ["TREE_CHARSET overrides C", { TREE_CHARSET: "UTF-8", LC_ALL: "C" }, unicode],
  ["TREE_CHARSET ASCII overrides UTF-8", { TREE_CHARSET: "ASCII", LC_ALL: "en_US.UTF-8" }, ascii],
  ["TREE_CHARSET empty overrides UTF-8", { TREE_CHARSET: "", LC_ALL: "en_US.UTF-8" }, ascii],
  ["TREE_CHARSET unknown overrides UTF-8", { TREE_CHARSET: "unknown", LC_ALL: "en_US.UTF-8" }, ascii],
  ["TREE_CHARSET is not trimmed", { TREE_CHARSET: "UTF-8 ", LC_ALL: "en_US.UTF-8" }, ascii],
  ["TREE_CHARSET case-insensitive", { TREE_CHARSET: "uTf-8" }, unicode],
  ["TREE_CHARSET UTF8 alias", { TREE_CHARSET: "utf8" }, unicode],
  ["TREE_CHARSET US-ASCII alias", { TREE_CHARSET: "US-ASCII" }, ascii],
];

for (const [name, env, expected] of selections) test(`tree charset selection: ${name}`, async () => {
  const result = await run(["--noreport"], {}, { fs: await fixture(), env });
  assert.deepEqual(result, { exitCode: 0, stdout: expected, stderr: "" });
});

for (const value of ["UTF-8", "utf-8", "UTF8", "uTf8", "ASCII", "ascii", "US-ASCII", "us-ascii"]) {
  test(`tree explicit charset alias: ${value}`, async () => {
    const expected = value.toUpperCase().startsWith("UTF") ? unicode : ascii;
    const env = { TREE_CHARSET: expected === unicode ? "ASCII" : "UTF-8", LC_ALL: "en_US.UTF-8" };
    for (const args of [[`--charset=${value}`], ["--charset", value]]) {
      assert.equal((await run([...args, "--noreport"], {}, { fs: await fixture(), env })).stdout, expected);
    }
  });
}

test("last explicit charset wins and skips every environment read", async () => {
  const env = new Proxy<Record<string, string>>({}, {
    get() { throw new Error("environment get must not run"); },
    getOwnPropertyDescriptor() { throw new Error("environment lookup must not run"); },
  });
  for (const [args, expected] of [
    [["--charset=UTF-8", "--charset=ASCII"], ascii],
    [["--charset=ASCII", "--charset=UTF8"], unicode],
  ] as const) {
    assert.equal((await run([...args, "--noreport"], {}, { fs: await fixture(), env })).stdout, expected);
  }
});

test("inherited environment keys never select branches or trigger inherited getters", async () => {
  const inherited = Object.create(null) as Record<string, string>;
  for (const key of ["TREE_CHARSET", "LC_ALL", "LC_CTYPE", "LANG"]) {
    Object.defineProperty(inherited, key, { get() { throw new Error(`inherited ${key} read`); } });
  }
  const env = Object.create(inherited) as Record<string, string>;
  assert.equal((await run(["--noreport"], {}, { fs: await fixture(), env })).stdout, ascii);
  Object.defineProperty(env, "LANG", { value: "en_US.UTF-8", enumerable: true });
  assert.equal((await run(["--noreport"], {}, { fs: await fixture(), env })).stdout, unicode);
});

test("null-prototype dictionaries and own special keys preserve data", async () => {
  const env = Object.create(null) as Record<string, string>;
  Object.assign(env, { TREE_CHARSET: "UTF8", constructor: "kept", toString: "kept" });
  env.__proto__ = "kept";
  const before = Object.getOwnPropertyDescriptors(env);
  assert.equal((await run(["--noreport"], {}, { fs: await fixture(), env })).stdout, unicode);
  assert.deepEqual(Object.getOwnPropertyDescriptors(env), before);
  assert.equal(Object.getPrototypeOf(env), null);
});

test("ambient host environment cannot select a virtual charset", async () => {
  const saved = new Map(["TREE_CHARSET", "LC_ALL", "LC_CTYPE", "LANG"].map(key => [key, process.env[key]]));
  try {
    process.env.TREE_CHARSET = "UTF8";
    process.env.LC_ALL = process.env.LC_CTYPE = process.env.LANG = "en_US.UTF-8";
    assert.equal((await run(["--noreport"], {}, { fs: await fixture(), env: {} })).stdout, ascii);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("selected environment values stop lower-priority getters", async () => {
  for (const chosen of ["TREE_CHARSET", "LC_ALL", "LC_CTYPE", "LANG"]) {
    const env = Object.create(null) as Record<string, string>;
    let later = false;
    for (const key of ["TREE_CHARSET", "LC_ALL", "LC_CTYPE", "LANG"]) {
      if (key === chosen) { env[key] = chosen === "TREE_CHARSET" ? "UTF8" : "en_US.UTF-8"; later = true; }
      else if (later) Object.defineProperty(env, key, { get() { throw new Error("unused env read"); } });
    }
    assert.equal((await run(["--noreport"], {}, { fs: await fixture(), env })).stdout, unicode);
  }
});

test("invalid explicit charset remains status 2 before env or filesystem access", async () => {
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw new Error("unexpected FS call"); } });
  const env = new Proxy<Record<string, string>>({}, { getOwnPropertyDescriptor() { throw new Error("unexpected env call"); } });
  for (const args of [["--charset="], ["--charset=bogus"], ["--charset= UTF-8"], ["--charset=ANSI"], ["--charset"], ["--charset=bogus", "--charset=UTF-8"]]) {
    const result = await run(args, {}, { fs, env });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /supported charsets|requires a value/u);
  }
});

test("environment scans are admitted before normalization and byte sizing", async () => {
  const oversized = "x".repeat(128);
  const originalUpper = String.prototype.toUpperCase;
  const originalLength = Buffer.byteLength;
  let scans = 0;
  String.prototype.toUpperCase = function (this: string) {
    if (this === oversized) scans++;
    return originalUpper.call(this);
  };
  Buffer.byteLength = function (...args: Parameters<typeof originalLength>) {
    if (args[0] === oversized) scans++;
    return Reflect.apply(originalLength, Buffer, args) as number;
  };
  try {
    const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw new Error("unexpected FS call"); } });
    for (const key of ["TREE_CHARSET", "LC_ALL", "LC_CTYPE", "LANG"]) {
      await assert.rejects(run([], { limits: { maxPathBytes: 32 } }, { fs, env: { [key]: oversized } }), /path\/name limit/u);
      await assert.rejects(run([], { limits: { maxPathBytes: 256, maxSteps: 16 } }, { fs, env: { [key]: oversized } }), /work limit/u);
    }
    assert.equal(scans, 0);
  } finally { String.prototype.toUpperCase = originalUpper; Buffer.byteLength = originalLength; }
});

test("environment metadata and work share existing cumulative limits", async () => {
  const fs = wrapped(createMemoryFileSystem(), { async lstat() { throw new Error("unexpected FS call"); } });
  await assert.rejects(run([], { limits: { maxMetadataBytes: 4 } }, { fs, env: { TREE_CHARSET: "UTF-8" } }), /metadata limit/u);
  await assert.rejects(run([], { limits: { maxSteps: 1 } }, { fs, env: { LC_ALL: "", LC_CTYPE: "", LANG: "C" } }), /work limit/u);
  await assert.rejects(run([], { limits: { maxPathBytes: 3 } }, { fs, env: { TREE_CHARSET: "éé" } }), /path\/name limit/u);
});

test("UTF-8 connectors charge encoded bytes and preserve a partial prefix on limit", async () => {
  const fs = await fixture();
  for (const [env, expected] of [[{ TREE_CHARSET: "ASCII" }, ascii], [{ TREE_CHARSET: "UTF-8" }, unicode]] as const) {
    const bytes = Buffer.byteLength(expected);
    assert.equal((await run(["--noreport"], { limits: { maxOutputBytes: bytes } }, { fs, env })).stdout, expected);
    const chunks: Uint8Array[] = [];
    await assert.rejects(run(["--noreport"], { limits: { maxOutputBytes: bytes - 1 } }, { fs, env,
      stdout: { async write(chunk) { chunks.push(chunk.slice()); } } }), /output limit/u);
    assert.equal(Buffer.concat(chunks).toString(), ".\n");
  }
  await assert.rejects(run(["--noreport"], { limits: { maxOutputBytes: unicode.length } }, { fs, env: { TREE_CHARSET: "UTF-8" } }), /output limit/u);
});

test("UTF-8 branches do not unescape filenames, reorder bytes or change JSON", async () => {
  const fs = createMemoryFileSystem();
  for (const name of ["雪", "é", "line\nfeed", "escape\u001b[31m"]) await fs.writeFile(`/${name}`, new Uint8Array());
  const plain = await run(["--noreport"], {}, { fs, env: {} });
  const utf8 = await run(["--noreport"], {}, { fs, env: { LC_ALL: "en_US.UTF-8" } });
  assert.equal(utf8.stdout, plain.stdout.replaceAll("|-- ", "├── ").replaceAll("`-- ", "└── "));
  assert.match(utf8.stdout, /\\033\[31m/u);
  assert.match(utf8.stdout, /\\351\\233\\252/u);
  for (const args of [["-Ji"], ["-i", "--noreport"]]) {
    assert.equal((await run(args, {}, { fs, env: { TREE_CHARSET: "UTF8" } })).stdout, (await run(args, {}, { fs, env: {} })).stdout);
  }
});

test("UTF-8 output still awaits backpressure", { timeout: 2000 }, async () => {
  const entered = deferred();
  const release = deferred();
  let writes = 0, settled = false;
  const pending = run(["--noreport"], {}, { fs: await fixture(), env: { TREE_CHARSET: "UTF-8" },
    stdout: { async write() { if (++writes === 1) { entered.resolve(); await release.promise; } } } });
  void pending.then(() => { settled = true; });
  try {
    await entered.promise; await yieldTurn();
    assert.equal(settled, false); assert.equal(writes, 1);
    release.resolve();
    assert.equal((await pending).exitCode, 0);
    assert.equal(writes, 2);
  } finally { release.resolve(); await pending; }
});

test("caller abort preserves reason before lookup and during an awaited write", { timeout: 2000 }, async () => {
  const early = new AbortController(), reason = new FsError("EACCES");
  early.abort(reason);
  const env = new Proxy<Record<string, string>>({}, { getOwnPropertyDescriptor() { throw new Error("lookup after abort"); } });
  await assert.rejects(run([], {}, { signal: early.signal, env }), error => error === reason);
  const controller = new AbortController();
  const entered = deferred(), release = deferred();
  let writes = 0;
  const pending = run(["--noreport"], {}, { fs: await fixture(), env: { TREE_CHARSET: "UTF8" }, signal: controller.signal,
    stdout: { async write() { writes++; entered.resolve(); await release.promise; } } });
  const observed = assert.rejects(pending, error => error === reason);
  try {
    await entered.promise; controller.abort(reason); await observed;
    release.resolve(); await yieldTurn(); assert.equal(writes, 1);
  } finally { release.resolve(); controller.abort(reason); await observed; }
});

test("default registry forwards charset through a real pipeline without leaking env", async () => {
  const fs = await fixture();
  const shell = new Shell({ fs, env: { LANG: "C", LC_ALL: "C" } }).use(agentCommands());
  try {
    const result = await shell.exec("TREE_CHARSET=UTF8 tree --noreport -I listing | cat > /listing; cat /listing; tree --noreport -I listing");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, unicode + ascii);
    assert.equal(new TextDecoder().decode(await fs.readFile("/listing")), unicode);
    assert.equal((await shell.exec("printenv TREE_CHARSET")).exitCode, 1);
  } finally { await shell.dispose(); }
});
