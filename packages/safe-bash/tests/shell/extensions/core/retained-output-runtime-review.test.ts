import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryFileSystem, FsError, type FileSystem } from "poe-code/safe-fs";
import { agentCommands } from "../../../../src/index.js";
import { openCommandFile } from "../../../../src/contracts/filesystem-descriptor.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";

function intercept<Target extends object>(target: Target, replacements: Partial<Target>): Target {
  return new Proxy(target, { get(object, key) {
    if (Object.hasOwn(replacements, key)) return Reflect.get(replacements, key);
    const member: unknown = Reflect.get(object, key, object);
    return typeof member === "function" ? member.bind(object) : member;
  } });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(fs: FileSystem) {
  const internalErrors: unknown[] = [];
  const shell = new Shell({ fs, env: { LC_ALL: "C" }, limits: { maxWallClockMs: 1500 }, onInternalError: error => { internalErrors.push(error); } }).use(agentCommands());
  return Object.assign(shell, { internalErrors });
}

function registerClosedPipeProducer(shell: Shell, entered: Promise<void>, assertPending: () => void): void {
  shell.register({ name: "producer", async execute(command) {
    assert.ok(command.invoke);
    const peerClosed = command.stdout.ownedOutput?.consumerClosed;
    assert.ok(peerClosed);
    await command.stdout.write(Buffer.from("pipe"));
    const writing = command.invoke("filewriter", []);
    void writing.catch(() => {});
    try {
      await entered;
      if (!peerClosed.aborted) await once(peerClosed, "abort", { signal: command.signal });
      assert.equal(command.signal.aborted, false);
      assertPending();
      await command.stdout.write(Buffer.from("again"));
      assert.fail("A real write to the closed pipeline must fail");
    } finally { await writing; }
  } });
  shell.register({ name: "stop", async execute(command) {
    const received: number[] = [];
    for await (const chunk of command.stdin) {
      received.push(...chunk);
      if (received.length >= 4) break;
    }
    assert.deepEqual(received, [...Buffer.from("pipe")]);
    await entered;
    return { exitCode: 0 };
  } });
}

const referencePath = new URL("./retained-output-runtime-reference.json", import.meta.url);
const referenceStat = lstatSync(referencePath);
assert.ok(referenceStat.isFile() && referenceStat.size <= 30000);
const referenceBytes = readFileSync(referencePath);
assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), "4a1eee99f146aab8020a428bf61f1bca77578ad4137bcaac5e3ef14e9f943044");
const reference = JSON.parse(referenceBytes.toString()) as {
  binaries: { path: string; sha256: string }[];
  cases: { name: string; source: string; sourceSha256: string; executedSource: string; argv: string[]; stdinBase64: string; status: number; signal: null; stdoutBase64: string; stderrBase64: string; files: Record<string, { base64: string; sha256: string }> }[];
};
assert.equal(reference.binaries[0]?.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.deepEqual(reference.binaries.slice(1).map(binary => binary.path), ["/bin/mv", "/bin/rm"]);
assert.equal(reference.cases.length, 7);

for (const fixture of reference.cases) for (const scriptFile of [false, true]) {
  test(`retained output independent native reference: ${fixture.name}, script=${scriptFile}`, async context => {
    assert.equal(createHash("sha256").update(fixture.source).digest("hex"), fixture.sourceSha256);
    assert.equal(fixture.executedSource, 'mv() { /bin/mv "$@"; }; rm() { /bin/rm "$@"; };\n' + fixture.source);
    assert.deepEqual(fixture.argv, ["--noprofile", "--norc", "-c", fixture.executedSource, "shell"]);
    assert.equal(fixture.stdinBase64, "");
    assert.equal(fixture.signal, null);
    const fs = createMemoryFileSystem();
    const shell = setup(fs);
    context.after(() => shell.dispose());
    if (scriptFile) await fs.writeFile("/program.sh", Buffer.from(fixture.source));
    const result = await shell.exec(scriptFile ? "bash /program.sh" : fixture.source);
    assert.equal(result.exitCode, fixture.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(fixture.stdoutBase64, "base64"));
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(fixture.stderrBase64, "base64"));
    assert.deepEqual((await fs.readdir("/")).filter(entry => entry.name !== "program.sh").map(entry => ({ name: entry.name, type: entry.type })).sort((left, right) => left.name.localeCompare(right.name)), Object.keys(fixture.files).map(entry => ({ name: entry.slice(1), type: "file" })).sort((left, right) => left.name.localeCompare(right.name)));
    for (const [path, expected] of Object.entries(fixture.files)) {
      const bytes = await fs.readFile(path);
      assert.deepEqual(Buffer.from(bytes), Buffer.from(expected.base64, "base64"));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256);
    }
  });
}

for (const route of ["forward", "command forward", "bash -c forward", "sh -c forward"]) for (const maximum of [2, 3]) {
  test(`retained output independent middleware and named descriptor share budget ${maximum}: ${route}`, async context => {
    const fs = createMemoryFileSystem();
    const shell = setup(fs);
    context.after(() => shell.dispose());
    shell.use(async (command, next) => {
      if (command.command === "forward") await command.stdout.write(Buffer.from("a"));
      return next();
    });
    shell.register({ name: "forward", async execute(command) {
      const descriptor = await openCommandFile(command, "/named", { access: "write", creation: "exclusive" });
      assert.equal(await descriptor.write(Buffer.from("b"), null), 1);
      assert.ok(command.invoke);
      return command.invoke("printf", ["c"], { stdout: command.stdout });
    } });
    const execution = shell.exec(`${route} >out`, { limits: { maxOutputBytes: maximum } });
    if (maximum === 2) await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    else {
      const result = await execution;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    assert.deepEqual(await fs.readFile("/out"), maximum === 2 ? Uint8Array.of(97) : Uint8Array.of(97, 99));
    assert.deepEqual(await fs.readFile("/named"), Uint8Array.of(98));
  });
}

for (const maximum of [2, 3]) test(`retained output independent middleware replacement cannot bypass budget ${maximum}`, async context => {
  const fs = createMemoryFileSystem();
  const shell = setup(fs);
  const received: Uint8Array[] = [];
  context.after(() => shell.dispose());
  shell.use(async (command, next) => {
    if (command.command === "forward") Object.assign(command, { stdout: { async write(bytes: Uint8Array) { received.push(Uint8Array.from(bytes)); } } });
    return next();
  });
  shell.register({ name: "forward", execute: command => {
    assert.ok(command.invoke);
    return command.invoke("printf", ["abc"], { stdout: command.stdout });
  } });
  const result = shell.exec("forward >out", { limits: { maxOutputBytes: maximum } });
  if (maximum === 2) {
    await assert.rejects(result, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(received.length, 0);
  } else {
    assert.equal((await result).exitCode, 0);
    assert.deepEqual(Buffer.concat(received), Buffer.from("abc"));
  }
  assert.deepEqual(await fs.readFile("/out"), new Uint8Array());
});

for (const source of ["{ printf a; exit 7; } >out", "f() { printf a; return 7; }; f >out", "for item in a; do { printf a; break; } >out; done", "for item in a; do { printf a; continue; } >out; done"]) {
  test(`retained output independent control flow drains successful finalizer: ${source}`, async context => {
    const backing = createMemoryFileSystem();
    let closes = 0;
    const shell = setup(intercept(backing, { async open(path, options) {
      const descriptor = await backing.open!(path, options);
      return intercept(descriptor, { async close() { closes++; await descriptor.close(); } });
    } }));
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, source.includes("7") ? 7 : 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
    assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97));
    assert.equal(closes, 1);
  });
}

for (const reason of [undefined, null, false, 0, ""]) test(`retained output independent nonzero status and close failure ${String(reason)}`, async context => {
  const backing = createMemoryFileSystem();
  let closes = 0;
  const shell = setup(intercept(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return intercept(descriptor, { async close() { closes++; await descriptor.close(); throw reason; } });
  } }));
  context.after(() => shell.dispose());
  shell.register({ name: "status7", async execute(command) { await command.stdout.write(Buffer.from("a")); return { exitCode: 7 }; } });
  const result = await shell.exec("status7 >out");
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.deepEqual(shell.internalErrors, [reason]);
  assert.equal(result.stdout, "");
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97));
  assert.equal(closes, 1);
});

for (const reason of [false, 0, "", null]) test(`retained output independent root cancellation during late acquisition ${String(reason)}`, { timeout: 2500 }, async context => {
  const backing = createMemoryFileSystem();
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  let closes = 0;
  let writes = 0;
  const shell = setup(intercept(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    entered.resolve();
    await release.promise;
    return intercept(descriptor, {
      async write(bytes, position, forwarded) { writes++; return descriptor.write(bytes, position, forwarded); },
      async close() { closes++; await descriptor.close(); throw new FsError("EIO"); },
    });
  } }));
  context.after(() => shell.dispose());
  const rejected = assert.rejects(shell.exec("printf a >out", { signal: controller.signal }), error => Object.is(error, reason));
  await entered.promise;
  try {
    controller.abort(reason);
    assert.equal(closes, 0);
    release.resolve();
    await rejected;
    assert.equal(closes, 1);
    assert.equal(writes, 0);
  } finally { release.resolve(); await rejected; }
});

test("retained output independent successful command cleanup retains live delivery signal", async context => {
  const fs = createMemoryFileSystem();
  const shell = setup(fs);
  context.after(() => shell.dispose());
  let cleanup = 0;
  shell.register({ name: "writer", async execute(command) {
    command.registerCleanup?.(() => { cleanup++; command.signal.throwIfAborted(); });
    await command.stdout.write(Buffer.from("a"));
    return { exitCode: 0 };
  } });
  const result = await shell.exec("{ writer; writer; } >out");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(cleanup, 2);
  assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(97, 97));
});

for (const reason of [undefined, null, false, 0, "", new FsError("EIO", { syscall: "close" }), new FsError("EPIPE", { syscall: "close" })]) {
  test(`retained output independent local pipeline stop cannot hide genuine close failure ${String(reason)}`, { timeout: 2500 }, async context => {
    const backing = createMemoryFileSystem();
    const entered = deferred();
    let closed = 0;
    let cancelled = false;
    const shell = setup(intercept(backing, { async open(path, options) {
      const descriptor = await backing.open!(path, options);
      return intercept(descriptor, {
        async write(_bytes, _position, forwarded) {
          const signal = forwarded!.signal!;
          entered.resolve();
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          cancelled = signal.aborted;
          signal.throwIfAborted();
          return 0;
        },
        async close() { closed++; await descriptor.close(); throw reason; },
      });
    } }));
    context.after(() => shell.dispose());
    registerClosedPipeProducer(shell, entered.promise, () => { assert.equal(cancelled, false); });
    await assert.rejects(shell.exec("filewriter() { printf a >&3; }; producer 3>out | stop"), error => Object.is(error, reason));
    assert.equal(cancelled, true);
    assert.equal(closed, 1);
  });
}

for (const reason of [false, 0, "", null]) test(`retained output independent failed diagnostic cannot acknowledge close error ${String(reason)}`, async context => {
  const backing = createMemoryFileSystem();
  const failure = new Error("unreported close");
  let closes = 0;
  let diagnostics = 0;
  const shell = setup(intercept(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return intercept(descriptor, { async close() { closes++; await descriptor.close(); throw failure; } });
  } }));
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("printf a >out", { stderr: { async write(bytes) {
    diagnostics++;
    assert.deepEqual(Buffer.from(bytes), Buffer.from("shell: line 1: unreported close\n"));
    throw reason;
  } } }), error => error === failure);
  assert.equal(diagnostics, 1);
  assert.equal(closes, 1);
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97));
});

for (const scriptFile of [false, true]) test(`retained output independent mapped close EPIPE permits continuation, script=${scriptFile}`, async context => {
  const backing = createMemoryFileSystem();
  let closes = 0;
  const shell = setup(intercept(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    if (options.access === "read") return descriptor;
    return intercept(descriptor, { async close() { closes++; await descriptor.close(); throw new FsError("EPIPE", { syscall: "close" }); } });
  } }));
  context.after(() => shell.dispose());
  const source = "printf a >out; printf 'status:%s' \"$?\"";
  await backing.writeFile("/program.sh", Buffer.from(source));
  const result = await shell.exec(scriptFile ? "bash /program.sh" : source);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "status:141");
  assert.equal(result.stderr, "");
  assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97));
  assert.equal(closes, 1);
});

test("retained output independent multiple mapped close failures acknowledge each resource once", async context => {
  const backing = createMemoryFileSystem();
  const failure = new FsError("EIO");
  const closed: string[] = [];
  const shell = setup(intercept(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return intercept(descriptor, { async close() {
      closed.push(path);
      await descriptor.close();
      if (path === "/first") throw false;
      throw failure;
    } });
  } }));
  context.after(() => shell.dispose());
  const result = await shell.exec("printf a 3>first 4>second 5>&4 >&3; printf 'status:%s' \"$?\"");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "status:1");
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.equal(shell.internalErrors.length, 1);
  const aggregate = shell.internalErrors[0];
  assert.ok(aggregate instanceof AggregateError);
  assert.equal(aggregate.errors.length, 2);
  assert.ok(aggregate.errors.includes(false));
  assert.ok(aggregate.errors.includes(failure));
  assert.deepEqual(closed.sort(), ["/first", "/second"]);
});

for (const source of ["{ printf a; exit 7; } >out", "f() { printf a; return 7; }; f >out", "for item in a; do { printf a; break; } >out; done"]) {
  test(`retained output independent mapped close failure preserves control flow: ${source}`, async context => {
    const backing = createMemoryFileSystem();
    const failure = new Error("close failed");
    let closes = 0;
    const shell = setup(intercept(backing, { async open(path, options) {
      const descriptor = await backing.open!(path, options);
      return intercept(descriptor, { async close() { closes++; await descriptor.close(); throw failure; } });
    } }));
    context.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.exitCode, source.includes("7") ? 7 : 0);
    assert.equal(result.stderr, "shell: line 1: internal error\n");
    assert.equal(shell.internalErrors.length, 1);
    assert.equal(shell.internalErrors[0], failure);
    assert.equal(result.stdout, "");
    assert.deepEqual(await backing.readFile("/out"), Uint8Array.of(97));
    assert.equal(closes, 1);
  });
}

for (const pipefail of [false, true]) test(`retained output independent delivery signal preserves pipeline vector, pipefail=${pipefail}`, { timeout: 2500 }, async context => {
  const backing = createMemoryFileSystem();
  const entered = deferred();
  let closes = 0;
  let cancelled = false;
  const shell = setup(intercept(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return intercept(descriptor, {
      async write(_bytes, _position, forwarded) {
        const signal = forwarded!.signal!;
        entered.resolve();
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        signal.throwIfAborted();
        return 0;
      },
      async close() { closes++; await descriptor.close(); },
    });
  } }));
  context.after(() => shell.dispose());
  shell.register({ name: "blocked", async execute(command) {
    try { await command.stdout.write(Buffer.from("a")); }
    finally { cancelled = command.signal.aborted; }
    return { exitCode: 0 };
  } });
  registerClosedPipeProducer(shell, entered.promise, () => { assert.equal(cancelled, false); });
  const result = await shell.exec(`filewriter() { blocked >&3; }; ${pipefail ? "set -o pipefail; " : ""}producer 3>out | stop; printf '%s:%s,%s' "$?" "\${PIPESTATUS[0]}" "\${PIPESTATUS[1]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, `${pipefail ? 141 : 0}:141,0`);
  assert.equal(result.stderr, "");
  assert.equal(cancelled, true);
  assert.equal(closes, 1);
});

const peerRetirementEvidence = {
  directory: "/tmp/bash53-peer-retirement-root-72JW4p",
  binarySha256: "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40",
  recordsSha256: "18668d0dccd781d3f68a9be598630dab1c63c86a525a3208e7b720b1257f9ad7",
  adaptation: "Replace native fd8/fd9 controller IPC and read -t0 polling with the active producer's ownedOutput.consumerClosed signal; replace read -N4 with a four-byte VFS consumer. Preserve named writes, optional later pipe write, pipefail, and status/vector output.",
};

const peerReferencePath = new URL("./pipe-peer-retirement-reference.json", import.meta.url);
const peerReferenceStat = lstatSync(peerReferencePath);
assert.ok(peerReferenceStat.isFile() && peerReferenceStat.size <= 6000);
const peerReferenceBytes = readFileSync(peerReferencePath);
assert.equal(createHash("sha256").update(peerReferenceBytes).digest("hex"), "e747636eb50edb60179bdd6965f7cbd0f9d65a8c448c492a42d3f0baa394574a");
const peerReference = JSON.parse(peerReferenceBytes.toString()) as {
  oracle: { binarySha256: string };
  capture: { recordsSha256: string };
  records: { name: string; source: string; args: string[]; status: number; signal: null; timedOut: boolean; released: boolean; stdoutHex: string; stderrHex: string; eventsHex: string; fileHex: string }[];
};
assert.equal(peerReference.oracle.binarySha256, peerRetirementEvidence.binarySha256);
assert.equal(peerReference.capture.recordsSha256, peerRetirementEvidence.recordsSha256);
assert.equal(peerReference.records.length, 4);

const peerRetirementCases = [
  { pipefail: false, laterPipeWrite: false },
  { pipefail: false, laterPipeWrite: true },
  { pipefail: true, laterPipeWrite: false },
  { pipefail: true, laterPipeWrite: true },
];

for (const fixture of peerRetirementCases) test(`native peer-retirement reference: pipefail=${fixture.pipefail}, later pipe write=${fixture.laterPipeWrite}`, { timeout: 2500 }, async context => {
  context.diagnostic(JSON.stringify(peerRetirementEvidence));
  const nativeSource = `set ${fixture.pipefail ? "-o" : "+o"} pipefail\n{ printf pipe; printf 'START\\n' >&8; IFS= read -r permit <&9; ready=1; for ((attempt=0;attempt<100000;attempt++)); do read -t0 -u1 value; ready=$?; ((ready==0)) && break; done; printf 'READY:%s\\n' "$ready" >&8; printf a >&3; ${fixture.laterPipeWrite ? "printf again;" : ""} } 3>out | { IFS= read -r -N4 payload; printf 'STOP\\n' >&8; }\nprintf 'STATUS:%s VECTOR:%s\\n' "$?" "\${PIPESTATUS[*]}"\n`;
  const record = peerReference.records.find(entry => entry.name === `pipefail-${fixture.pipefail}-later-pipe-write-${fixture.laterPipeWrite}`);
  assert.ok(record);
  assert.equal(record.source, nativeSource);
  assert.deepEqual(record.args, ["--noprofile", "--norc", "-c", nativeSource, "shell"]);
  assert.equal(record.signal, null);
  assert.equal(record.timedOut, false);
  assert.equal(record.released, true);
  assert.equal(Buffer.from(record.eventsHex, "hex").toString(), "START\nSTOP\nREADY:0\n");
  const fs = createMemoryFileSystem();
  const shell = setup(fs);
  let observedClosed = false;
  shell.register({ name: "waitpeer", async execute(command) {
    const peerClosed = command.stdout.ownedOutput?.consumerClosed;
    assert.ok(peerClosed);
    if (!peerClosed.aborted) await once(peerClosed, "abort", { signal: command.signal });
    assert.equal(command.signal.aborted, false);
    observedClosed = true;
    return { exitCode: 0 };
  } });
  shell.register({ name: "stop", async execute(command) {
    const received: number[] = [];
    for await (const chunk of command.stdin) {
      received.push(...chunk);
      if (received.length >= 4) break;
    }
    assert.deepEqual(received, [...Buffer.from("pipe")]);
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const source = `set ${fixture.pipefail ? "-o" : "+o"} pipefail\n{ printf pipe; waitpeer; printf a >&3; ${fixture.laterPipeWrite ? "printf again;" : ""} } 3>out | stop\nprintf 'STATUS:%s VECTOR:%s\\n' "$?" "\${PIPESTATUS[*]}"\n`;
  const result = await shell.exec(source);
  assert.equal(observedClosed, true);
  assert.equal(result.exitCode, record.status);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(record.stdoutHex, "hex"));
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(record.stderrHex, "hex"));
  assert.deepEqual(Buffer.from(await fs.readFile("/out")), Buffer.from(record.fileHex, "hex"));
});
