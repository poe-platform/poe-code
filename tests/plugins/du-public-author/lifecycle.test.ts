import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as turn } from "node:timers/promises";
import test from "node:test";
import { agentCommands, createAgentCommands, createDuCommand, createDuCommands, createMemoryFileSystem, duCommands, FsError, Shell, type ByteSink, type CommandContext, type FileSystem, type InvocationCleanup } from "../../../src/index.js";
import { wrapped } from "../../commands/du/helpers.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}
async function deadline<Value>(pending: Promise<Value>): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([pending, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("DU author observation deadline exceeded")), 3000); })]); }
  finally { clearTimeout(timer); }
}
function context(overrides: Partial<CommandContext> = {}) {
  const cleanup: InvocationCleanup[] = [], stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const value: CommandContext = { command: "du", args: ["-b", "/payload"], cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error("DU must not acquire stdin"); } },
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    registerCleanup: callback => { cleanup.push(callback); }, ...overrides };
  return { value, stdout, stderr, cleanup, async close() { for (const callback of cleanup) await callback(); } };
}
function owned(closed: AbortSignal, write: ByteSink["write"] = async () => { throw new Error("unexpected owned write"); }): ByteSink {
  return { async write() { throw new Error("unaccounted output path"); }, ownedOutput: { consumerClosed: closed, write } };
}

test("DU default allocation stays unknown, apparent bytes and known zero remain distinct", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/payload", Buffer.from("1234567"));
  for (const args of [["-B1", "/payload"], ["-b", "/payload"]]) {
    const fixture = context({ fs, args });
    try {
      const result = await createDuCommand().execute(fixture.value);
      if (args[0] === "-B1") {
        assert.equal(result.exitCode, 1); assert.equal(Buffer.concat(fixture.stdout).toString(), "");
        assert.equal(Buffer.concat(fixture.stderr).toString(), 'du: "/payload": allocated bytes unknown; total suppressed\n');
      } else { assert.equal(result.exitCode, 0); assert.equal(Buffer.concat(fixture.stdout).toString(), "7\t/payload\n"); assert.equal(fixture.stderr.length, 0); }
    } finally { await fixture.close(); }
  }
  const zero = context({ args: ["-B1", "/payload"], fs: wrapped(fs, { async lstat(path, options) { return { ...await fs.lstat(path, options), allocatedBytes: 0 }; } }) });
  try { assert.equal((await createDuCommand().execute(zero.value)).exitCode, 0); assert.equal(Buffer.concat(zero.stdout).toString(), "0\t/payload\n"); }
  finally { await zero.close(); }
});

test("DU owned output is accounted once and metadata uses the operation signal", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/payload", Buffer.from("1234567"));
  const caller = new AbortController(), closed = new AbortController(); let writes = 0, signal: AbortSignal | undefined;
  const output: Uint8Array[] = [], fixture = context({ signal: caller.signal, stdout: owned(closed.signal, async bytes => { writes++; output.push(new Uint8Array(bytes)); }),
    fs: wrapped(fs, { async lstat(path, options) { assert.ok(fixture.cleanup.length >= 2); signal = options?.signal; return fs.lstat(path, options); } }) });
  try {
    assert.equal((await createDuCommand().execute(fixture.value)).exitCode, 0);
    assert.equal(writes, 1); assert.equal(Buffer.concat(output).toString(), "7\t/payload\n");
    assert.ok(signal instanceof AbortSignal); assert.notEqual(signal, caller.signal); assert.equal(caller.signal.aborted, false);
  } finally { await fixture.close(); }
  assert.equal(getEventListeners(caller.signal, "abort").length, 0); assert.equal(getEventListeners(closed.signal, "abort").length, 0);
});

test("preclosed DU output rejects exact reason without metadata or diagnostic", async () => {
  const caller = new AbortController(), closed = new AbortController(), reason = new FsError("EPIPE"); closed.abort(reason);
  let calls = 0;
  const fixture = context({ signal: caller.signal, stdout: owned(closed.signal), fs: wrapped(createMemoryFileSystem(), { async lstat() { calls++; throw new Error("unexpected metadata"); } }) });
  try {
    await assert.rejects(Promise.resolve(createDuCommand().execute(fixture.value)), error => error === reason);
    assert.equal(calls, 0); assert.equal(fixture.stderr.length, 0); assert.equal(caller.signal.aborted, false);
  } finally { await fixture.close(); }
});

test("preclosed stdout never hides invalid-argument required stderr", async () => {
  const caller = new AbortController(), closed = new AbortController(); closed.abort(new FsError("EPIPE"));
  let calls = 0;
  const fixture = context({ args: ["--not-a-du-option"], signal: caller.signal, stdout: owned(closed.signal), fs: wrapped(createMemoryFileSystem(), { async lstat() { calls++; throw new Error("unexpected metadata"); } }) });
  try {
    assert.equal((await createDuCommand().execute(fixture.value)).exitCode, 1);
    assert.equal(Buffer.concat(fixture.stderr).toString(), "du: unrecognized option '--not-a-du-option'\n");
    assert.equal(calls, 0); assert.equal(caller.signal.aborted, false);
  } finally { await fixture.close(); }
});

test("pending required diagnostic survives output closure and awaits release", async () => {
  const caller = new AbortController(), closed = new AbortController(), started = deferred<void>(), release = deferred<void>();
  const errors: Uint8Array[] = []; let settled = false;
  const fixture = context({ signal: caller.signal, stdout: owned(closed.signal), stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); started.resolve(); await release.promise; } } });
  const execution = Promise.resolve(createDuCommand().execute(fixture.value)).then(result => { settled = true; return result; });
  try {
    await started.promise; closed.abort(new FsError("EPIPE")); await turn(); assert.equal(settled, false);
    assert.equal(caller.signal.aborted, false); release.resolve();
    assert.equal((await deadline(execution)).exitCode, 1); assert.match(Buffer.concat(errors).toString(), /^du: "\/payload": .*no such file/iu);
  } finally { release.resolve(); await fixture.close(); }
});

test("one combined output budget remains shared with diagnostics after enrollment", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/payload", Buffer.from("1234567"));
  const closed = new AbortController(), output: Uint8Array[] = [];
  const fixture = context({ fs, args: ["-b", "/payload", "/missing"], stdout: owned(closed.signal, async bytes => { output.push(new Uint8Array(bytes)); }) });
  try {
    assert.equal((await createDuCommand({ limits: { maxOutputBytes: 11 } }).execute(fixture.value)).exitCode, 1);
    assert.equal(Buffer.concat(output).toString(), "7\t/payload\n"); assert.equal(fixture.stderr.length, 0);
    assert.ok(Buffer.concat(output).length <= 11);
  } finally { await fixture.close(); }
});

for (const callerAbort of [false, true]) test(`cooperative DU metadata cancellation preserves exact reason; caller=${callerAbort}`, async () => {
  const caller = new AbortController(), closed = new AbortController(), started = deferred<void>(), reason = new FsError(callerAbort ? "ENOENT" : "EPIPE");
  let active = 0, calls = 0, finalized = 0; const fs = createMemoryFileSystem();
  const fixture = context({ signal: caller.signal, stdout: owned(closed.signal), fs: wrapped(fs, { async lstat(_path, options) {
    assert.ok(fixture.cleanup.length >= 2); const signal = options!.signal!; calls++; active++; started.resolve();
    return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => { active--; finalized++; reject(signal.reason); }, { once: true }); });
  } }) });
  const execution = Promise.resolve(createDuCommand().execute(fixture.value)); void execution.catch(() => {});
  try {
    await started.promise; (callerAbort ? caller : closed).abort(reason);
    await assert.rejects(deadline(execution), error => error === reason);
    assert.deepEqual({ active, calls, finalized }, { active: 0, calls: 1, finalized: 1 });
    assert.equal(caller.signal.aborted, callerAbort); assert.equal(fixture.stderr.length, 0);
  } finally { await fixture.close(); }
});

test("DU does not claim to preempt an opaque provider and observes its late rejection", async () => {
  const caller = new AbortController(), closed = new AbortController(), started = deferred<void>();
  let rejectHost!: (error: unknown) => void, hostSettled = false;
  const fixture = context({ signal: caller.signal, stdout: owned(closed.signal), fs: wrapped(createMemoryFileSystem(), { async lstat() {
    started.resolve(); return new Promise((_resolve, reject) => { rejectHost = error => { hostSettled = true; reject(error); }; });
  } }) });
  const execution = Promise.resolve(createDuCommand().execute(fixture.value)); void execution.catch(() => {});
  const reason = new FsError("EPIPE");
  try {
    await started.promise; closed.abort(reason); await assert.rejects(deadline(execution), error => error === reason);
    assert.equal(hostSettled, false); assert.equal(caller.signal.aborted, false);
    rejectHost(new Error("late opaque provider failure")); await turn(); assert.equal(hostSettled, true);
  } finally { await fixture.close(); }
});

for (const count of [0, 1]) test(`actual DU pipeline closes metadata after head ${count} without caller abort`, async () => {
  const base = createMemoryFileSystem(); await base.mkdir("/usage"); await base.writeFile("/usage/a", Buffer.from("123")); await base.writeFile("/usage/b", Buffer.from("4567"));
  const started = deferred<void>(), caller = new AbortController(); let blocked = 0, finalized = 0, active = 0;
  const fs: FileSystem = wrapped(base, { async lstat(path, options) {
    if (path !== (count === 0 ? "/usage" : "/usage/b")) return base.lstat(path, options);
    blocked++; active++; started.resolve(); const signal = options!.signal!;
    return new Promise((_resolve, reject) => { signal.addEventListener("abort", () => { finalized++; active--; reject(signal.reason); }, { once: true }); });
  } });
  const shell = new Shell({ fs }).use(agentCommands()); await shell.exec(":");
  const head = createAgentCommands().find(command => command.name === "head")!;
  shell.register({ name: "head", async execute(context) { await started.promise; return head.execute(context); } }, { replace: true });
  try {
    const result = await deadline(shell.exec(`du -ab /usage | head -n${count}`, { signal: caller.signal }));
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, count ? "3\t/usage/a\n" : "");
    assert.deepEqual({ blocked, finalized, active }, { blocked: 1, finalized: 1, active: 0 }); assert.equal(caller.signal.aborted, false);
  } finally { caller.abort(new Error("author cleanup")); await shell.dispose(); }
});

test("DU redirected output survives unrelated downstream head-zero", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/payload", Buffer.from("1234567"));
  const caller = new AbortController(), shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await deadline(shell.exec("du -b /payload > /usage.txt | head -n0", { signal: caller.signal }));
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, "");
    assert.equal(Buffer.from(await fs.readFile("/usage.txt")).toString(), "7\t/payload\n"); assert.equal(caller.signal.aborted, false);
  } finally { await shell.dispose(); }
});

test("DU standalone and aggregate replacement remain explicit with limit forwarding", async () => {
  assert.deepEqual(createDuCommands().map(command => command.name), ["du"]);
  const fs = createMemoryFileSystem(); await fs.mkdir("/usage"); await fs.writeFile("/usage/a", Buffer.from("a"));
  const collision = new Shell({ fs }).use(duCommands()).use(agentCommands());
  try { await assert.rejects(collision.exec(":"), /already registered/u); assert.equal(collision.commands.has("echo"), false); }
  finally { await collision.dispose(); }
  const shell = new Shell({ fs }).use(duCommands()).use(agentCommands({ replace: true, du: { limits: { maxEntries: 1 } } }));
  try {
    const result = await shell.exec("du -b /usage"); assert.equal(result.exitCode, 1); assert.match(result.stderr, /entry limit exceeded/u);
    const expected = [
      "true", "false", "echo", "pwd", "basename", "dirname", "printf", "mkdir", "touch",
      "cp", "mv", "rm", "rmdir", "ln", "readlink", "realpath", "ls", "cat", "head", "tail",
      "wc", "tee", "tr", "sort", "uniq", "cut", "grep", "test", "[", "env", "xargs", "find",
      "sed", "awk", "jq", "rg", "base64", "base32", "xxd", "od", "sha256sum", "sha1sum",
      "md5sum", "cksum", "gzip", "gunzip", "zcat", "diff", "patch", "chmod", "stat", "mktemp", "tar",
      "paste", "comm", "join", "tac", "expand", "fold", "strings", "seq", "nl", "rev", "unexpand", "split",
      "date", "sleep", "printenv", "tree", "file", "egrep", "fgrep", "column", "html-to-markdown", "du", "expr",
      "which", "timeout", "apply_patch", "git",
    ];
    assert.equal(expected.length, 80); assert.equal(new Set(expected).size, 80);
    assert.deepEqual(shell.commands.list().map(command => command.name).sort(), expected.sort());
    assert.equal(shell.commands.has("html-to-markdown"), true); assert.equal(shell.commands.has("expr"), true);
    for (const name of ["curl", "safejs"]) assert.equal(shell.commands.has(name), false);
  } finally { await shell.dispose(); }
});
