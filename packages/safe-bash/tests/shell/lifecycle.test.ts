import { compileShellProbe } from "../shell-stress/helpers.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FsError, writeText } from "../../src/contracts/index.js";
import type { ByteSource } from "../../src/contracts/index.js";
import { Shell, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { ShellInput } from "../../src/shell/input.js";
import { Budget, defaultLimits, Runtime } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { parseShellUnit } from "../../src/shell/parser.js";
import { stateMonitor } from "../../src/shell/arrays/state.js";

test("cached echo redirects checkpoint CPU and retain completed command state on interruption", async t => {
  let now = 0;
  t.mock.method(globalThis.performance, "now", () => now);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/d");
  const shell = new Shell({ fs, limits: { maxCpuMs: 40 } }).use(agentCommands());
  const source = "echo alpha > /d/a\necho beta > /d/b\necho gamma > /d/c\necho delta > /d/d";
  try {
    await shell.exec(source);
    await shell.exec("");
    const runUnit = Runtime.prototype.runUnit;
    let completedState: Parameters<typeof runUnit>[1] | undefined;
    let completedPipeStatus: readonly number[] | undefined;
    t.mock.method(Runtime.prototype, "runUnit", function (this: Runtime, ...args: Parameters<typeof runUnit>) {
      const result = runUnit.apply(this, args);
      const capture = () => {
        if (args[1].lastArgument === "beta") {
          completedState = args[1];
          completedPipeStatus = stateMonitor(args[1])?.lazyPipeStatus;
          now = 60;
        }
      };
      if (result instanceof Promise) return result.then(value => { capture(); return value; });
      capture();
      return result;
    });
    await assert.rejects(shell.exec(source), { limit: "maxCpuMs" });
    assert.ok(completedState);
    assert.equal(completedState.lastArgument, "beta");
    assert.equal(completedState.status, 0);
    assert.deepEqual(completedPipeStatus, [0]);
  } finally { await shell.dispose(); }
});

for (const limit of ["maxCpuMs", "maxWallClockMs"] as const) {
  test(`empty execution does not spend the next invocation's ${limit} while idle`, async t => {
    let now = 0;
    t.mock.method(globalThis.performance, "now", () => now);
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
    const shell = new Shell({ fs: createMemoryFileSystem(), limits: { [limit]: 40 } }).use(agentCommands());
    try {
      await shell.exec("");
      now = 60;
      t.mock.timers.tick(60);
      const result = await shell.exec("echo hi");
      assert.equal(result.stdout, "hi\n");
      assert.equal(result.exitCode, 0);
    } finally { await shell.dispose(); }
  });
}

test("empty execution leaves the full parse budget for cached redirects and write fallback", async () => {
  const source = "echo alpha > /d/f1\necho beta > /d/f2\necho gamma > /d/f3";
  const parsing = new ParseBudget();
  let offset = 0;
  do { offset = parseShellUnit(source, offset, false, parsing).next; } while (offset < source.length);
  const seedFs = createMemoryFileSystem();
  await seedFs.mkdir("/d");
  const seed = new Shell({ fs: seedFs }).use(agentCommands());
  try { await seed.exec(source); } finally { await seed.dispose(); }
  for (const directoryTarget of [false, true]) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/d");
    if (directoryTarget) await fs.mkdir("/d/f2");
    const shell = new Shell({ fs, limits: { maxParseUnits: parsing.admittedUnits } }).use(agentCommands());
    try {
      await shell.exec("");
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, directoryTarget ? "shell: line 2: /d/f2: Is a directory\n" : "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/d/f1")), "alpha\n");
      assert.equal(new TextDecoder().decode(await fs.readFile("/d/f3")), "gamma\n");
    } finally { await shell.dispose(); }
  }
});

test("empty execution does not run hidden scripts or reinstall host plugins", async t => {
  let setups = 0;
  const shell = new Shell({ fs: createMemoryFileSystem() })
    .use(agentCommands())
    .use({ name: "setup-counter", setup() { setups++; } });
  try {
    await shell.exec(":");
    const calls = t.mock.method(Shell.prototype, "exec");
    const result = await shell.exec("");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(setups, 1);
    assert.equal(calls.mock.callCount(), 1);
    for (const options of [
      { limits: { maxCpuMs: 50 } },
      { limits: { maxWallClockMs: 1000 } },
      { signal: new AbortController().signal },
    ]) {
      calls.mock.resetCalls();
      const bounded = await shell.exec("", options);
      assert.equal(bounded.exitCode, 0, bounded.stderr);
      assert.equal(bounded.stdout, "");
      assert.equal(calls.mock.callCount(), 1);
      assert.equal(setups, 1);
    }
    const reason = new Error("cancel empty execution");
    calls.mock.resetCalls();
    await assert.rejects(shell.exec("", { signal: AbortSignal.abort(reason) }), error => error === reason);
    assert.equal(calls.mock.callCount(), 1);
    assert.equal(setups, 1);
  } finally { await shell.dispose(); }
});

test("prewarmed mkdir preserves existing descendants and directory identity", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/existing/nested", { recursive: true });
  const contents = new TextEncoder().encode("keep this file\n");
  await fs.writeFile("/existing/nested/input", contents);
  await fs.chmod("/existing", 0o750);
  const before = await fs.stat("/existing");
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await shell.exec(":");
    await shell.exec("");
    const result = await shell.exec("mkdir -p /existing");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/existing/nested/input"), contents);
    const after = await fs.stat("/existing");
    assert.equal(after.ino, before.ino);
    assert.equal(after.mode, before.mode);
  } finally { await shell.dispose(); }
});

for (const [title, source] of [
  ["prewarmed shell executes an asynchronous search once", "rg --json warm-once /warm-json"],
  ["prewarmed shell executes an asynchronous final unit once", ":\nrg --json warm-once /warm-json"],
] as const) {
  test(title, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/warm-json");
    await fs.writeFile("/warm-json/input", new TextEncoder().encode("warm-once\n"));
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      await shell.exec(":");
      await shell.exec("");
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      const records = result.stdout.trim().split("\n").map(line => JSON.parse(line));
      assert.deepEqual(records.map(record => record.type), ["begin", "match", "end", "summary"]);
      assert.equal(records[1].data.path.text, "/warm-json/input");
      assert.equal(records[1].data.lines.text, "warm-once\n");
    } finally { await shell.dispose(); }
  });
}

test("prewarmed shell preserves earlier output and executes a final search once", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/warm-list");
  await fs.writeFile("/warm-list/input", new TextEncoder().encode("match\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await shell.exec(":");
    await shell.exec("");
    const result = await shell.exec("printf 'before\\n'\nrg -l match /warm-list");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "before\n/warm-list/input\n");
  } finally { await shell.dispose(); }
});

test("prewarmed shell executes a mutating find once", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/warm-delete");
  await fs.writeFile("/warm-delete/input", new TextEncoder().encode("remove once\n"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    await shell.exec(":");
    await shell.exec("");
    const result = await shell.exec("find /warm-delete -type f -print -delete");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "/warm-delete/input\n");
    await assert.rejects(fs.stat("/warm-delete/input"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});

test("nested while and until effects execute once and preserve loop control", async () => {
  for (const loop of ["while ((i < 3))", "until ((i >= 3))"]) {
    const { shell } = setup();
    shell.use(agentCommands());
    try {
      const body = `count=$((count + 1)); ${loop}; do ((i++)); printf '%s' "$i"; done`;
      for (const compound of [`{ ${body}; }`, `f() { ${body}; }; f`, `if true; then ${body}; fi`, `case x in x) ${body};; esac`]) {
        const result = await shell.exec(`i=0; count=0; ${compound}; printf ':%s:%s' "$count" "$i"`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, "123:1:3", compound);
      }
      const control = await shell.exec(`f() { ${loop}; do return 7; done; }; i=0; f`);
      assert.equal(control.exitCode, 7, control.stderr);
    } finally { await shell.dispose(); }
  }
});

const probeProgram = await compileShellProbe(fileURLToPath(new URL("./lifecycle-probe.ts", import.meta.url)));

for (const scenario of ["cleanup-abort", "cleanup-late-rejection", "shared-delayed-generator", "shared-serialized", "shared-repeated-cancellation", "shared-abandoned-rejection", "shared-retained-rejection", "owned-cleanup-abort", "busy-loop-abort", "busy-until-abort", "busy-group-loop-abort", "busy-function-loop-abort", "busy-if-loop-abort", "busy-substitution-loop-abort"]) {
  test(`hard-timeout lifecycle regression: ${scenario}`, () => {
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-", scenario], {
      input: probeProgram, timeout: 3000, encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined, `${scenario}: ${result.error?.message}`);
    assert.equal(result.signal, null, `${scenario}: child terminated by ${result.signal}`);
    assert.equal(result.status, 0, `${scenario}: ${result.stderr}`);
    assert.match(result.stdout, /: passed/u);
  });
}

test("write-only redirects never read and retain independent/duplicated offsets", async () => {
  for (const [script, expected] of [
    ["say replacement >file", "replacement\n"],
    ["both >file 2>file", "err\n"],
    ["both >file 2>&1", "out\nerr\n"],
    ["both >file 2>>file", "out\nerr\n"],
    ["say appended >>file", "oldappended\n"],
  ]) {
    const { shell, fs } = setup();
    await fs.writeFile("/file", new TextEncoder().encode("old"));
    await fs.chmod("/file", 0o200);
    let reads = 0;
    const readFile = fs.readFile.bind(fs);
    fs.readFile = async (...args) => { reads++; return readFile(...args); };
    const result = await shell.exec(script!);
    assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    assert.equal(reads, 0, script);
    await fs.chmod("/file", 0o600);
    assert.equal(new TextDecoder().decode(await readFile("/file")), expected, script);
  }
});

test("offset and append descriptors interleave correctly without reading files", async () => {
  const { shell, fs, commands } = setup();
  commands.register({ name: "interleave", async execute({ stdout, stderr }) {
    await writeText(stdout, "abcdef");
    await writeText(stderr, "XY");
    await writeText(stdout, "!");
    await writeText(stderr, "Z");
    return { exitCode: 0 };
  } });
  await fs.writeFile("/file", new Uint8Array());
  await fs.chmod("/file", 0o200);
  for (const [script, expected] of [
    ["interleave >file 2>file", "XYZdef!"],
    ["interleave >file 2>>file", "abcdef!YZ"],
    ["interleave >>file 2>file", "XYZdef!"],
    ["interleave >file 2>&1", "abcdefXY!Z"],
    ["{ say first; say new >file; say last; } >file", "new\n\0\0last\n"],
  ]) {
    const result = await shell.exec(script!);
    assert.equal(result.exitCode, 0, `${script}: ${result.stderr}`);
    await fs.chmod("/file", 0o600);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), expected, script);
    await fs.chmod("/file", 0o200);
  }
});

test("EOF redirects append only new bytes and expose each completed write", async () => {
  const { shell, fs, commands } = setup();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false, descriptorWriteStream: false } });
  const writes: number[] = [], appends: number[] = [];
  const write = fs.writeFile.bind(fs), append = fs.appendFile.bind(fs);
  fs.writeFile = async (path, bytes, options) => { writes.push(bytes.length); await write(path, bytes, options); };
  fs.appendFile = async (path, bytes, options) => { appends.push(bytes.length); await append(path, bytes, options); };
  commands.register({ name: "chunks", async execute({ stdout }) {
    for (let index = 0; index < 8; index++) {
      await writeText(stdout, "abc");
      assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "abc".repeat(index + 1));
    }
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec("chunks >file", { limits: { maxOutputBytes: 24 } })).exitCode, 0);
    assert.deepEqual(writes, [0]);
    assert.deepEqual(appends, Array(8).fill(3));
  } finally { await shell.dispose(); }
});

for (const mixed of [false, true]) test(`redirect retained storage grows geometrically: mixed append=${mixed}, legacy fallback`, async context => {
  const { shell, fs, commands } = setup();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false, descriptorWriteStream: false } });
  const buffers = new Set<ArrayBufferLike>();
  const fileOperation = Runtime.prototype.fileOperation;
  context.mock.method(Runtime.prototype, "fileOperation", async function (this: Runtime, ...args: Parameters<Runtime["fileOperation"]>) {
    await fileOperation.apply(this, args);
    const data = this.outputFiles.get(args[0])?.data;
    if (data?.length) buffers.add(data.buffer);
  });
  commands.register({ name: "chunks", async execute({ stdout, stderr }) {
    for (let index = 0; index < 64; index++) await writeText(mixed ? stderr : stdout, "abc");
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec(mixed ? "chunks >file 2>>file" : "chunks >file")).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "abc".repeat(64));
    assert.ok(buffers.size > 0);
    assert.ok([...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0) <= 4 * 192);
  } finally { await shell.dispose(); }
});

for (const descriptorWriteStream of [false, true]) for (const [replacement, legacyExpected, positionalExpected] of [["Q", "abcXYZ", "Q\0\0XYZ"], ["123456789", "abcXYZ", "123XYZ789"], ["def", "defXYZ", "defXYZ"]] as const) {
  test(`EOF redirect after direct VFS replacement preserves the declared mutation boundary: ${replacement}, descriptorWriteStream=${descriptorWriteStream}`, async () => {
    const { shell, fs, commands } = setup();
    Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false, descriptorWriteStream } });
    assert.equal(fs.capabilities.descriptorWriteStream, descriptorWriteStream);
    commands.register({ name: "mutate", async execute({ stdout }) {
      await writeText(stdout, "abc");
      await fs.writeFile("/file", new TextEncoder().encode(replacement));
      await writeText(stdout, "XYZ");
      return { exitCode: 0 };
    } });
    try {
      assert.equal((await shell.exec("mutate >file")).exitCode, 0);
      assert.equal(new TextDecoder().decode(await fs.readFile("/file")), descriptorWriteStream ? positionalExpected : legacyExpected);
    } finally { await shell.dispose(); }
  });
}

test("EOF metadata failure falls back without reading a write-only file", async () => {
  const { shell, fs } = setup();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false } });
  await fs.writeFile("/file", new Uint8Array());
  await fs.chmod("/file", 0o200);
  const read = fs.readFile.bind(fs);
  fs.readFile = async () => { assert.fail("redirect must not read file contents"); };
  fs.stat = async () => { throw new FsError("EACCES"); };
  try {
    assert.equal((await shell.exec("{ say one; say two; } >file")).exitCode, 0);
    await fs.chmod("/file", 0o600);
    assert.equal(new TextDecoder().decode(await read("/file")), "one\ntwo\n");
  } finally { await shell.dispose(); }
});

for (const selected of [false, true]) for (const append of [false, undefined]) test(`EOF optimization requires declared append support: ${append}, path capabilities=${selected}`, async () => {
  const { shell, fs } = setup();
  const capabilities = { ...fs.capabilities, open: false, append };
  if (append === undefined) Reflect.deleteProperty(capabilities, "append");
  if (selected) Object.defineProperty(fs, "capabilitiesFor", { value: async () => capabilities });
  else Object.defineProperty(fs, "capabilities", { value: capabilities });
  let probes = 0;
  fs.appendFile = async () => { assert.fail("append is unsupported"); };
  fs.stat = async () => { probes++; throw new FsError("ENOTSUP"); };
  try {
    assert.equal((await shell.exec("{ say one; say two; } >file")).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "one\ntwo\n");
    assert.equal(probes, 0);
  } finally { await shell.dispose(); }
});

test("EOF optimization skips explicitly unavailable metadata", async () => {
  const { shell, fs } = setup();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false, stat: false } });
  let probes = 0;
  fs.stat = async () => { probes++; throw new FsError("ENOTSUP"); };
  try {
    assert.equal((await shell.exec("{ say one; say two; } >file")).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "one\ntwo\n");
    assert.equal(probes, 0);
  } finally { await shell.dispose(); }
});

test("EOF metadata cancellation preserves the falsey caller reason before data writes", async () => {
  const { shell, fs } = setup();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false, descriptorWriteStream: false } });
  const controller = new AbortController();
  fs.stat = async () => { controller.abort(0); throw false; };
  try {
    await assert.rejects(shell.exec("say never >file", { signal: controller.signal }), error => Object.is(error, 0));
    assert.equal((await fs.readFile("/file")).length, 0);
  } finally { await shell.dispose(); }
});

test("empty redirect writes do not probe or mutate the backend", async () => {
  const { shell, fs, commands } = setup();
  let calls = 0;
  const stat = fs.stat.bind(fs), write = fs.writeFile.bind(fs), append = fs.appendFile.bind(fs);
  fs.stat = async (...args) => { calls++; return stat(...args); };
  fs.writeFile = async (...args) => { calls++; return write(...args); };
  fs.appendFile = async (...args) => { calls++; return append(...args); };
  commands.register({ name: "empty", async execute({ stdout }) {
    const before = calls;
    await stdout.write(new Uint8Array());
    assert.equal(calls, before);
    await writeText(stdout, "abc");
    await fs.writeFile("/file", new TextEncoder().encode("Q"));
    const replaced = calls;
    await stdout.write(new Uint8Array());
    assert.equal(calls, replaced);
    return { exitCode: 0 };
  } });
  try {
    assert.equal((await shell.exec("empty >file")).exitCode, 0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "Q");
  } finally { await shell.dispose(); }
});

test("failed EOF appends do not publish pending bytes into another descriptor's mirror", async () => {
  const { shell, fs, commands } = setup();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false, descriptorWriteStream: false } });
  const append = fs.appendFile.bind(fs);
  let failures = 0;
  fs.appendFile = async (path, bytes, options) => {
    if (new TextDecoder().decode(bytes) === "cd") { failures++; throw false; }
    await append(path, bytes, options);
  };
  commands.register({ name: "failure", async execute({ stdout, stderr }) {
    await writeText(stdout, "ab");
    await assert.rejects(writeText(stdout, "cd"), error => Object.is(error, false));
    await writeText(stderr, "Z");
    return { exitCode: 1 };
  } });
  try {
    assert.equal((await shell.exec("failure >file 2>file")).exitCode, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "Zb");
    assert.equal(failures, 1);
  } finally { await shell.dispose(); }
});

test("failed overlapping redirects preserve the retained bytes for a later EOF append", async () => {
  const { shell, fs, commands } = setup();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, open: false, descriptorWriteStream: false } });
  const write = fs.writeFile.bind(fs);
  fs.writeFile = async (path, bytes, options) => {
    if (new TextDecoder().decode(bytes) === "cd") throw null;
    await write(path, bytes, options);
  };
  commands.register({ name: "failure", async execute({ stdout, stderr }) {
    await writeText(stdout, "ab");
    await assert.rejects(writeText(stderr, "cd"), error => Object.is(error, null));
    await writeText(stdout, "E");
    return { exitCode: 1 };
  } });
  try {
    assert.equal((await shell.exec("failure >file 2>file")).exitCode, 1);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")), "abE");
  } finally { await shell.dispose(); }
});

test("cancelled queued readers cannot bypass an active shared read", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let maximum = 0;
  let position = 0;
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() {
      active++;
      maximum = Math.max(maximum, active);
      const index = position++;
      try { if (index === 0) await gate; return { value: new Uint8Array([65 + index]), done: false }; }
      finally { active--; }
    },
    async return() { returned++; return { value: undefined, done: true }; },
  }; } };
  const budget = new Budget(defaultLimits);
  const owner = new ShellInput(source, budget);
  const controller = new AbortController();
  const first = new ShellInput(owner, budget);
  const cancelled = new ShellInput(owner, budget, controller.signal);
  const third = new ShellInput(owner, budget);
  const firstRead = first.next();
  const secondRead = cancelled.next();
  const thirdRead = third.next();
  controller.abort(new Error("cancel queued read"));
  await assert.rejects(secondRead, /cancel queued read/u);
  await cancelled.close();
  assert.equal(returned, 0);
  release();
  assert.deepEqual([...(await firstRead).value!], [65]);
  assert.deepEqual([...(await thirdRead).value!], [66]);
  assert.equal(maximum, 1);
  await first.close();
  await third.close();
  assert.equal(returned, 0);
  await owner.close();
  assert.equal(returned, 1);
});

test("input errors still close their owned iterator exactly once", async () => {
  const { shell } = setup();
  const failure = new Error("read failed");
  const observed: unknown[] = [];
  let returned = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw failure; },
    async return() { returned++; return { value: undefined, done: true }; },
  }; } };
  const result = await shell.exec("pass", { stdin, onInternalError(error) { observed.push(error); } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.equal(observed.length, 1);
  assert.equal(observed[0], failure);
  assert.equal(returned, 1);
});
