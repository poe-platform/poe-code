import assert from "node:assert/strict";
import { after, test } from "node:test";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { ByteSource, FileSystem, ReadStreamOptions, WriteFileOptions } from "../../../src/contracts/index.js";
import type { Shell as ShellInstance } from "../../../src/shell/index.js";

const output = process.env.STREAM_NEXT_REVIEW_OUTPUT;
const frozen = process.env.STREAM_NEXT_REVIEW_FROZEN;
if (!output || !frozen || !import.meta.url.endsWith(".js") || process.execArgv.some(argument => argument.includes("tsx") || argument.includes("loader"))) {
  throw new Error("Use run-source.mjs after root release; emitted JavaScript only, no TSX/source fallback");
}
const { Shell } = await import("../../../src/shell/index.js");
const { agentCommands, createAgentCommands } = await import("../../../src/plugins/index.js");
const { MemoryFileSystem } = await import("../../../src/fs/memory/index.js");
const { RealFileSystem } = await import("../../../src/fs/real/index.js");
const { FsError, readBytes } = await import("../../../src/contracts/index.js");
const { createStreamFormatCommands, streamFormatCommands } = await import("../../../src/commands/stream-format/index.js");
const { createSplitCommands, splitCommands } = await import("../../../src/commands/split/index.js");

interface Entry { path: string; type: string; bytes?: string; target?: string }
interface Fixture { id: string; command: string; args: string[]; stdin: string; files: Entry[]; locale: string | null; diagnostic?: string[] }
interface NativeRecord { id: string; profile: string; fixture: Fixture; status: number; stdout: string; stderr: string; after: Entry[]; error: unknown }
interface Workflow { id: string; fixture: { script: string; stdin: string; locale: string }; stages: { status: number; stdout: string; stderr: string }[]; after: Entry[] }
interface NativeDocument { records: NativeRecord[]; workflows: Workflow[] }
interface Actual { status: number | null; stdout: string; stderr: string; after: Entry[]; thrown?: string }
interface Comparison { id: string; backend: string; profile: string; strict: boolean; semantic: boolean; mismatches: string[]; expected: Actual; actual: Actual }

const native = JSON.parse(await readFile(frozen, "utf8")) as NativeDocument;
const comparisons: Comparison[] = [];
const workflowResults: unknown[] = [];
const contractResults: { name: string; passed: boolean; error?: string }[] = [];
const bytes = (text: string): Uint8Array => Buffer.from(text);
const base64 = (value: Uint8Array): string => Buffer.from(value).toString("base64");
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const pause = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
const environment = (locale: string | null): Record<string, string> => locale === null ? {} : { LC_ALL: locale, LANG: locale };
const commands = ["seq", "nl", "rev", "unexpand", "split"];

async function filesystem(backend: string): Promise<FileSystem> {
  const fs = backend === "memory" ? new MemoryFileSystem() : new RealFileSystem(await mkdtemp(join(output!, "real-")));
  await fs.mkdir("/fixture");
  return fs;
}

async function setup(fs: FileSystem, entries: Entry[]): Promise<void> {
  for (const entry of entries) {
    const path = `/fixture/${entry.path}`;
    if (entry.type === "directory") await fs.mkdir(path, { recursive: true });
    else if (entry.type === "symlink") { assert.ok(fs.symlink); await fs.symlink(entry.target!, path); }
    else if (entry.type === "hardlink") { assert.ok(fs.link); await fs.link(`/fixture/${entry.target}`, path); }
    else await fs.writeFile(path, Buffer.from(entry.bytes!, "base64"));
  }
}

async function snapshot(fs: FileSystem): Promise<Entry[]> {
  const entries: Entry[] = [];
  const walk = async (relative: string): Promise<void> => {
    const directory = `/fixture${relative ? `/${relative}` : ""}`;
    const children = await fs.readdir(directory);
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      const path = relative ? `${relative}/${child.name}` : child.name;
      if (child.type === "directory") { entries.push({ path, type: "directory" }); await walk(path); }
      else if (child.type === "symlink") { assert.ok(fs.readlink); entries.push({ path, type: "symlink", target: await fs.readlink(`/fixture/${path}`) }); }
      else entries.push({ path, type: "file", bytes: base64(await fs.readFile(`/fixture/${path}`, { maxBytes: 1024 * 1024 })) });
    }
  };
  await walk("");
  return entries;
}

function shell(fs: FileSystem, locale: string | null = "C"): ShellInstance {
  return new Shell({ fs, cwd: "/fixture", env: environment(locale) }).use(agentCommands()).use(streamFormatCommands()).use(splitCommands());
}

async function assertSameEntry(fs: FileSystem, leftPath: string, rightPath: string): Promise<void> {
  if (fs.compareEntry) {
    assert.equal(await fs.compareEntry(leftPath, fs, rightPath), "same");
    return;
  }
  const left = await fs.stat(leftPath);
  const right = await fs.stat(rightPath);
  for (const stat of [left, right]) {
    assert.ok(typeof stat.identityScope === "symbol" || typeof stat.identityScope === "object" && stat.identityScope !== null, "Missing truthful scoped identity capability");
    assert.ok(typeof stat.dev === "number" && Number.isSafeInteger(stat.dev) && stat.dev >= 0);
    assert.ok(typeof stat.ino === "number" && Number.isSafeInteger(stat.ino) && stat.ino >= 0);
  }
  assert.equal(left.identityScope, right.identityScope);
  assert.equal(left.dev, right.dev);
  assert.equal(left.ino, right.ino);
}

async function* fragmented(input: Uint8Array): ByteSource {
  const storage = new Uint8Array(7);
  let offset = 0;
  while (offset < input.length) {
    const count = Math.min(offset % 7 + 1, input.length - offset);
    storage.set(input.subarray(offset, offset + count));
    yield storage.subarray(0, count);
    storage.fill(0xee);
    offset += count;
  }
}

function compare(record: NativeRecord, actual: Actual, backend: string): Comparison {
  const expected: Actual = { status: record.status, stdout: record.stdout, stderr: record.stderr, after: record.after };
  const mismatches = (Object.keys(expected) as (keyof Actual)[]).filter(key => JSON.stringify(expected[key]) !== JSON.stringify(actual[key]));
  const nativeDiagnostic = Buffer.from(expected.stderr, "base64").toString().toLowerCase();
  const actualDiagnostic = Buffer.from(actual.stderr, "base64").toString().toLowerCase();
  const diagnosticMatches = expected.status !== 0 && record.fixture.diagnostic !== undefined && nativeDiagnostic.length > 0 && actualDiagnostic.length > 0
    && record.fixture.diagnostic.some(word => nativeDiagnostic.includes(word.toLowerCase()))
    && record.fixture.diagnostic.some(word => actualDiagnostic.includes(word.toLowerCase()));
  return { id: record.id, backend, profile: record.profile, strict: mismatches.length === 0,
    semantic: mismatches.every(key => key === "stderr") && (expected.stderr === actual.stderr || diagnosticMatches), mismatches, expected, actual };
}

after(async () => {
  const summarize = (rows: Comparison[]) => ({ executions: rows.length, strict: rows.filter(row => row.strict).length, selectedSemantic: rows.filter(row => row.semantic).length });
  const primary = comparisons.filter(row => row.profile === (row.id.startsWith("rev-") ? "apple" : "gnu-darwin"));
  await writeFile(join(output!, "results.json"), JSON.stringify({ comparisons, workflowResults, contractResults,
    summary: { primary: summarize(primary),
      primaryByBackend: Object.fromEntries(["memory", "real"].map(backend => [backend, summarize(primary.filter(row => row.backend === backend))])),
      primaryByCommand: Object.fromEntries(commands.map(command => [command, summarize(primary.filter(row => row.id.startsWith(`${command}-`)))])),
      appleSecondary: summarize(comparisons.filter(row => row.profile === "apple" && !row.id.startsWith("rev-"))),
      distinctPrimaryInputs: new Set(comparisons.filter(row => row.profile === (row.id.startsWith("rev-") ? "apple" : "gnu-darwin")).map(row => row.id)).size } }, null, 2) + "\n");
});

test("frozen native primary inputs on MemoryFS and explicit-root RealFS", { timeout: 120_000 }, async () => {
  const failures: string[] = [];
  const primary = native.records.filter(record => record.profile === (record.fixture.command === "rev" ? "apple" : "gnu-darwin"));
  for (const backend of ["memory", "real"]) for (const record of primary) {
    assert.equal(record.error, null, "native preexecution failure is not a product result");
    const fs = await filesystem(backend);
    await setup(fs, record.fixture.files);
    const instance = shell(fs, record.fixture.locale);
    const observedOutput: Uint8Array[] = [];
    const observedError: Uint8Array[] = [];
    try {
      const result = await instance.exec([record.fixture.command, ...record.fixture.args].map(quote).join(" "), {
        stdin: fragmented(Buffer.from(record.fixture.stdin, "base64")),
        stdout: { async write(chunk) { observedOutput.push(new Uint8Array(chunk)); } },
        stderr: { async write(chunk) { observedError.push(new Uint8Array(chunk)); } },
      });
      assert.equal(base64(result.stdoutBytes), base64(Buffer.concat(observedOutput)));
      assert.equal(base64(result.stderrBytes), base64(Buffer.concat(observedError)));
      const actual = { status: result.exitCode, stdout: base64(result.stdoutBytes), stderr: base64(result.stderrBytes), after: await snapshot(fs) };
      const comparison = compare(record, actual, backend);
      comparisons.push(comparison);
      if (!comparison.semantic) failures.push(`${backend}:${record.id}:${comparison.mismatches.join(",")}`);
      const secondary = native.records.find(candidate => candidate.id === record.id && candidate.profile === "apple" && record.profile !== "apple");
      if (secondary) comparisons.push(compare(secondary, actual, backend));
    } catch (error) {
      const actual = { status: null, stdout: base64(Buffer.concat(observedOutput)), stderr: base64(Buffer.concat(observedError)), after: await snapshot(fs), thrown: error instanceof Error ? error.stack ?? error.message : String(error) };
      comparisons.push(compare(record, actual, backend));
      const secondary = native.records.find(candidate => candidate.id === record.id && candidate.profile === "apple" && record.profile !== "apple");
      if (secondary) comparisons.push(compare(secondary, actual, backend));
      failures.push(`${backend}:${record.id}:thrown (no returned byte result; not fabricated status)`);
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(failures, [], "primary semantic failures; raw strict/secondary outcomes retained separately");
});

test("frozen mixed-native workflows through actual internal pipelines", { timeout: 30_000 }, async () => {
  const failures: string[] = [];
  for (const backend of ["memory", "real"]) for (const workflow of native.workflows) {
    const fs = await filesystem(backend);
    const instance = shell(fs, workflow.fixture.locale);
    try {
      assert.ok(workflow.stages.every(stage => stage.status === 0));
      const result = await instance.exec(workflow.fixture.script, { stdin: fragmented(Buffer.from(workflow.fixture.stdin, "base64")) });
      const final = workflow.stages.at(-1)!;
      const actual = { status: result.exitCode, stdout: base64(result.stdoutBytes), stderr: base64(result.stderrBytes), after: await snapshot(fs) };
      const expected = { status: final.status, stdout: final.stdout, stderr: workflow.stages.map(stage => Buffer.from(stage.stderr, "base64")).reduce((combined, chunk) => Buffer.concat([combined, chunk]), Buffer.alloc(0)).toString("base64"), after: workflow.after };
      const passed = JSON.stringify(actual) === JSON.stringify(expected);
      workflowResults.push({ id: workflow.id, backend, expected, actual, passed });
      if (!passed) failures.push(`${backend}:${workflow.id}`);
    } finally { await instance.dispose(); }
  }
  assert.deepEqual(failures, []);
});

function contract(name: string, execute: () => Promise<void>): void {
  test(name, { timeout: 15_000 }, async () => {
    try { await execute(); contractResults.push({ name, passed: true }); }
    catch (error) { contractResults.push({ name, passed: false, error: error instanceof Error ? error.stack ?? error.message : String(error) }); throw error; }
  });
}

contract("default factory and actual default dispatch remain 60 without opt-in", async () => {
  assert.equal(createAgentCommands().length, 60);
  const fs = await filesystem("memory");
  await fs.writeFile("/fixture/input", bytes("abc\n"));
  const before = await snapshot(fs);
  const instance = new Shell({ fs, cwd: "/fixture" }).use(agentCommands());
  try {
    for (const command of commands) {
      const result = await instance.exec(command === "seq" ? "seq 1 3" : `${command} input`);
      assert.equal(result.exitCode, 127);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `shell: line 1: ${command}: command not found\n`);
      assert.equal(instance.commands.has(command), false);
    }
    assert.equal(instance.commands.list().length, 60);
    assert.deepEqual(await snapshot(fs), before);
  } finally { await instance.dispose(); }
  assert.deepEqual(createStreamFormatCommands().map(command => command.name).sort(), ["nl", "rev", "seq", "unexpand"]);
  assert.deepEqual(createSplitCommands().map(command => command.name), ["split"]);
});

contract("plugin collision preflight and invalid limits", async () => {
  const fs = await filesystem("memory");
  const instance = new Shell({ fs }).register({ name: "rev", execute: () => ({ exitCode: 19 }) });
  instance.use(streamFormatCommands());
  await assert.rejects(instance.exec(":"), /already registered/u);
  assert.deepEqual(instance.commands.list().map(command => command.name), ["rev"]);
  await instance.dispose();
  for (const limit of [0, -1, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(() => createStreamFormatCommands({ limits: { maxOutputBytes: limit } }));
    assert.throws(() => createSplitCommands({ limits: { maxFiles: limit } }));
  }
});

contract("byte producer reuse and delayed sink backpressure preserve publication", async () => {
  const fs = await filesystem("memory");
  const instance = shell(fs);
  const references: { chunk: Uint8Array; copy: Uint8Array }[] = [];
  let active = 0;
  try {
    const result = await instance.exec("seq 1 3000 | rev", { stdout: { async write(chunk) {
      assert.equal(active, 0);
      active += 1;
      const copy = new Uint8Array(chunk);
      references.push({ chunk, copy });
      await pause();
      assert.deepEqual(chunk, copy);
      active -= 1;
    } } });
    assert.equal(result.exitCode, 0);
    const expected = Array.from({ length: 3000 }, (_unused, index) => String(index + 1).split("").reverse().join("")).join("\n") + "\n";
    assert.equal(result.stdout, expected);
    assert.ok(references.length > 0);
    for (const reference of references) assert.deepEqual(reference.chunk, reference.copy);
  } finally { await instance.dispose(); }
});

contract("binary split files rejoin through verified cat byte pipeline", async () => {
  for (const backend of ["memory", "real"]) {
    const fs = await filesystem(backend);
    const instance = shell(fs);
    const input = Buffer.from([0, 255, 10, 128, 65, 66, 13, 0, 10, 90]);
    try {
      const result = await instance.exec("split -b3 - bin.; cat bin.aa bin.ab bin.ac bin.ad", { stdin: fragmented(input) });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(input));
      assert.equal(result.stderr, "");
    } finally { await instance.dispose(); }
  }
});

contract("split same-input aliases retain bytes and VFS identity relation", async () => {
  for (const backend of ["memory", "real"]) for (const alias of ["hardlink", "symlink"]) {
    const fs = await filesystem(backend);
    await fs.writeFile("/fixture/input", bytes("abcdef"));
    if (alias === "hardlink") { assert.ok(fs.link); await fs.link("/fixture/input", "/fixture/alias.aa"); }
    else { assert.ok(fs.symlink); await fs.symlink("input", "/fixture/alias.aa"); }
    await assertSameEntry(fs, "/fixture/input", "/fixture/alias.aa");
    const before = await snapshot(fs);
    const instance = shell(fs);
    try {
      const result = await instance.exec("split -b2 input alias.");
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /input|same|overwrite/iu);
      assert.deepEqual(await snapshot(fs), before);
      await assertSameEntry(fs, "/fixture/input", "/fixture/alias.aa");
    } finally { await instance.dispose(); }
  }
});

contract("literal invoke middleware preserves nested dispatch and shared budgets", async () => {
  const fs = await filesystem("memory");
  const instance = shell(fs);
  const seen: string[] = [];
  instance.use(async (context, next) => { seen.push(context.command); return next(); });
  instance.register({ name: "literal", execute: async context => {
    assert.ok(context.invoke);
    return context.invoke("seq", ["-s", "; touch unwanted", "1", "2"], { env: { LC_ALL: "C" }, replaceEnv: true });
  } });
  try {
    const result = await instance.exec("literal");
    assert.equal(result.stdout, "1; touch unwanted2\n");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(seen, ["literal", "seq"]);
    assert.deepEqual(await snapshot(fs), []);
    await assert.rejects(instance.exec("literal", { limits: { maxCommands: 1 } }), /maxCommands/u);
    await assert.rejects(instance.exec("seq 1 20 | rev", { limits: { maxOutputBytes: 8 } }), /maxOutputBytes/u);
  } finally { await instance.dispose(); }
});

contract("family output and argument limits fail without excess publication", async () => {
  const fs = await filesystem("memory");
  const instance = new Shell({ fs, cwd: "/fixture", env: { LC_ALL: "C" } }).use(streamFormatCommands({ limits: { maxOutputBytes: 5, maxArgumentBytes: 20 } }));
  try {
    const result = await instance.exec("seq 1 100");
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stdoutBytes.length <= 5);
    assert.match(result.stderr, /output|limit/iu);
    const argumentsResult = await instance.exec(`seq -s '${"x".repeat(24)}' 1 2`);
    assert.notEqual(argumentsResult.exitCode, 0);
    assert.equal(argumentsResult.stdoutBytes.length, 0);
    assert.match(argumentsResult.stderr, /argument|limit/iu);
  } finally { await instance.dispose(); }
});

contract("format input and record limits fail boundedly", async () => {
  const fs = await filesystem("memory");
  const instance = new Shell({ fs, cwd: "/fixture", env: { LC_ALL: "C" } }).use(streamFormatCommands({ limits: { maxInputBytes: 8, maxRecordBytes: 4 } }));
  try {
    const record = await instance.exec("rev", { stdin: fragmented(bytes("12345\n")) });
    assert.notEqual(record.exitCode, 0);
    assert.match(record.stderr, /record|limit/iu);
    const total = await instance.exec("unexpand", { stdin: fragmented(bytes("a\nb\nc\nd\ne\n")) });
    assert.notEqual(total.exitCode, 0);
    assert.match(total.stderr, /input|limit/iu);
  } finally { await instance.dispose(); }
});

contract("split file and output limits retain completed prefix only", async () => {
  const fs = await filesystem("memory");
  const instance = new Shell({ fs, cwd: "/fixture" }).use(splitCommands({ limits: { maxFiles: 2, maxOutputBytes: 4 } }));
  try {
    const result = await instance.exec("split -b2 - cap.", { stdin: fragmented(bytes("abcdef")) });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /limit|files|output/iu);
    const entries = await snapshot(fs);
    assert.equal(entries.find(entry => entry.path === "cap.aa")?.bytes, base64(bytes("ab")));
    assert.equal(entries.find(entry => entry.path === "cap.ab")?.bytes, base64(bytes("cd")));
    assert.ok(entries.filter(entry => entry.type === "file").reduce((total, entry) => total + Buffer.from(entry.bytes!, "base64").length, 0) <= 4);
  } finally { await instance.dispose(); }
});

contract("split argument and input limits preserve bounds and unaffected files", async () => {
  const fs = await filesystem("memory");
  await fs.writeFile("/fixture/sentinel", bytes("preserve"));
  const instance = new Shell({ fs, cwd: "/fixture" }).use(splitCommands({ limits: { maxInputBytes: 5, maxArgumentBytes: 20 } }));
  try {
    const argument = await instance.exec(`split -b2 - '${"x".repeat(24)}'`, { stdin: bytes("abcdef") });
    assert.notEqual(argument.exitCode, 0);
    assert.match(argument.stderr, /argument|limit/iu);
    assert.deepEqual(await snapshot(fs), [{ path: "sentinel", type: "file", bytes: base64(bytes("preserve")) }]);
    const input = await instance.exec("split -b2 - in.", { stdin: fragmented(bytes("abcdef")) });
    assert.notEqual(input.exitCode, 0);
    assert.match(input.stderr, /input|limit/iu);
    assert.equal(base64(await fs.readFile("/fixture/sentinel")), base64(bytes("preserve")));
    const entries = (await snapshot(fs)).filter(entry => entry.path !== "sentinel");
    const published = Buffer.concat(entries.map(entry => Buffer.from(entry.bytes ?? "", "base64")));
    assert.ok(published.length <= 5);
    assert.deepEqual(published, Buffer.from("abcdef").subarray(0, published.length));
  } finally { await instance.dispose(); }
});

function intercept(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    const replacement = Reflect.get(overrides, property);
    if (replacement !== undefined) return replacement;
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

contract("split large reusable producer chunks use owned bounded VFS writes", async () => {
  const fs = await filesystem("memory");
  const references: { chunk: Uint8Array; copy: Uint8Array }[] = [];
  const input = Uint8Array.from({ length: 65_541 }, (_unused, index) => index % 251);
  let active = 0;
  let peak = 0;
  const wrapped = intercept(fs, { writeStream: async (path: string, source: ByteSource, options: WriteFileOptions = {}) => {
    assert.ok(options.signal);
    active += 1;
    peak = Math.max(peak, active);
    try {
      await fs.writeStream!(path, (async function* () {
        for await (const chunk of readBytes(source, options.signal)) {
          assert.ok(chunk.length <= 1024);
          const copy = new Uint8Array(chunk);
          references.push({ chunk, copy });
          await pause();
          assert.deepEqual(chunk, copy);
          yield chunk;
        }
      })(), options);
    } finally { active -= 1; }
  } });
  const instance = new Shell({ fs: wrapped, cwd: "/fixture" }).use(agentCommands()).use(splitCommands({ limits: { maxChunkBytes: 1024 } }));
  try {
    const mutable = new Uint8Array(input);
    const stdin = (async function* () { yield mutable; mutable.fill(0xee); })();
    const result = await instance.exec("split -b40000 - own.; cat own.aa own.ab", { stdin });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdoutBytes, input);
    assert.equal(peak, 1);
    assert.ok(references.length > 2);
    for (const reference of references) assert.deepEqual(reference.chunk, reference.copy);
  } finally { await instance.dispose(); }
});

contract("split ENOSPC preserves completed and adapter-partial files without rollback", async () => {
  const fs = await filesystem("memory");
  assert.ok(fs.writeStream);
  const partial = intercept(fs, { writeStream: async (path: string, source: ByteSource, options: WriteFileOptions = {}) => {
    if (!path.endsWith("fault.ab")) return fs.writeStream!(path, source, options);
    await fs.writeFile(path, new Uint8Array(), options);
    for await (const chunk of readBytes(source, options.signal)) {
      await fs.appendFile(path, chunk.subarray(0, 1), options);
      throw new FsError("ENOSPC", { path, syscall: "write" });
    }
  } });
  await fs.writeFile("/fixture/sentinel", bytes("preserve"));
  const instance = shell(partial);
  try {
    const result = await instance.exec("split -b2 - fault.", { stdin: bytes("abcdef") });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /space|ENOSPC/iu);
    assert.deepEqual(await snapshot(fs), [{ path: "fault.aa", type: "file", bytes: base64(bytes("ab")) }, { path: "fault.ab", type: "file", bytes: base64(bytes("c")) }, { path: "sentinel", type: "file", bytes: base64(bytes("preserve")) }]);
  } finally { await instance.dispose(); }
});

contract("split mid-write cancellation retains partial bytes and exact errno-shaped reason", async () => {
  const fs = await filesystem("memory");
  const controller = new AbortController();
  const reason = new FsError("ENOENT", { path: "/caller-cancel" });
  const partial = intercept(fs, { writeStream: async (path: string, source: ByteSource, options: WriteFileOptions = {}) => {
    assert.ok(options.signal);
    if (!path.endsWith("cancel.ab")) return fs.writeStream!(path, source, options);
    await fs.writeFile(path, new Uint8Array(), options);
    for await (const chunk of readBytes(source, options.signal)) {
      await fs.appendFile(path, chunk.subarray(0, 1), options);
      controller.abort(reason);
      options.signal.throwIfAborted();
    }
  } });
  const instance = shell(partial);
  try {
    await assert.rejects(instance.exec("split -b2 - cancel.", { stdin: bytes("abcdef"), signal: controller.signal }), error => error === reason);
    assert.deepEqual(await snapshot(fs), [{ path: "cancel.aa", type: "file", bytes: base64(bytes("ab")) }, { path: "cancel.ab", type: "file", bytes: base64(bytes("c")) }]);
  } finally { await instance.dispose(); }
});

contract("format blocked input cancels and observes late rejection", async () => {
  for (const command of ["nl", "rev", "unexpand"]) {
    const fs = await filesystem("memory");
    await fs.writeFile("/fixture/input", bytes("abc"));
    const controller = new AbortController();
    const reason = new FsError("ENOENT", { path: "/caller-input-cancel" });
    let rejectPending: ((reason: unknown) => void) | undefined;
    let entered: (() => void) | undefined;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const wrapped = intercept(fs, { readStream: (_path: string, options: ReadStreamOptions = {}): ByteSource => ({
      [Symbol.asyncIterator]() { return { next: async () => {
        assert.ok(options.signal);
        entered!();
        return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => { rejectPending = reject; });
      } }; },
    }) });
    const instance = shell(wrapped);
    try {
      const pending = instance.exec(`${command} input`, { signal: controller.signal });
      await ready;
      controller.abort(reason);
      await assert.rejects(pending, error => error === reason);
      rejectPending!(new Error("late host read failure"));
      await pause();
    } finally { await instance.dispose(); }
  }
});

contract("format blocked output cancels and observes late sink rejection", async () => {
  const fs = await filesystem("memory");
  const instance = shell(fs);
  const controller = new AbortController();
  const reason = new FsError("EACCES", { path: "/caller-sink-cancel" });
  let rejectPending: ((reason: unknown) => void) | undefined;
  let entered: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  try {
    const pending = instance.exec("seq 1 100", { signal: controller.signal, stdout: { write: () => {
      entered!();
      return new Promise<void>((_resolve, reject) => { rejectPending = reject; });
    } } });
    await ready;
    controller.abort(reason);
    await assert.rejects(pending, error => error === reason);
    rejectPending!(new Error("late sink failure"));
    await pause();
  } finally { await instance.dispose(); }
});

contract("default definitions still 60 at end of independent review", async () => {
  assert.equal(createAgentCommands().length, 60);
  assert.ok(commands.every(name => !createAgentCommands().some(command => command.name === name)));
});
