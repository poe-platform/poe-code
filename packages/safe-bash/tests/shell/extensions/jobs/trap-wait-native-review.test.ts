import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { lstatSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { PassThrough } from "node:stream";
import test from "node:test";
import ts from "typescript";

interface Capture {
  stdout: Buffer;
  stderr: Buffer;
  protocol: Buffer;
}

function runnerFixture(options: { authenticationFailure?: number; killFailure?: Error } = {}) {
  const location = new URL("./trap-wait-native.test.ts", import.meta.url);
  const stat = lstatSync(location);
  assert.ok(stat.isFile() && stat.size <= 32768);
  const source = ts.createSourceFile("trap-wait-native.test.ts", readFileSync(location, "utf8"), ts.ScriptTarget.ES2022, true);
  const names = new Set(["profile", "supervisorSource", "signalController", "nativeInterruptedWait"]);
  const declarations = source.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return names.has(statement.name?.text ?? "");
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
      ts.isIdentifier(declaration.name) && names.has(declaration.name.text));
  });
  assert.equal(declarations.length, names.size);
  const javascript = ts.transpileModule(declarations.map(statement => statement.getText(source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const streams = Array.from({ length: 6 }, () => new PassThrough());
  const child = Object.assign(new EventEmitter(), {
    pid: 901, stdio: streams, stdin: streams[0]!, stdout: streams[1]!, stderr: streams[2]!,
  });
  const signals: { pid: number; signal: string }[] = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 0;
  let authentications = 0;
  let spawns = 0;
  const denied = new Error("independent authentication refusal");
  const execute = new Function("spawn", "process", "assert", "constants", "authenticateOracle", "Buffer", "setTimeout", "clearTimeout",
    `${javascript}\nreturn nativeInterruptedWait;`)(
    () => { spawns++; return child; },
    {
      env: { SAFE_BASH_TEST_BASH_SHA256: "f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d" },
      kill(pid: number, signal: string) {
        signals.push({ pid, signal });
        if (options.killFailure) throw options.killFailure;
      },
    }, assert, constants,
    () => {
      authentications++;
      if (authentications === options.authenticationFailure) throw denied;
      return "/independent/authenticated/bash";
    }, Buffer,
    (callback: () => void, delay: number) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    (timer: number) => { timers.delete(timer); },
  ) as (source: string, signal: "USR1" | "USR2") => Promise<Capture>;
  return {
    child, streams, signals, timers, denied, execute,
    counts: () => ({ authentications, spawns }),
    expire(delay: number) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `missing ${delay}ms timer`);
      timers.delete(entry[0]);
      entry[1].callback();
    },
    report(value: string) { streams[4]!.emit("data", Buffer.from(value)); },
    eof() { for (const index of [1, 2, 4]) streams[index]!.emit("end"); },
  };
}

test("independent wait runner: fragmented protocol, readiness gates, and close revoke all signals", async () => {
  const fixture = runnerFixture();
  const result = fixture.execute("not executed by the supervision mock", "USR1");
  fixture.report(`SIGNAL:${constants.signals.SIGUSR1}\nWAITER\nPRETRAP\nCHI`);
  assert.deepEqual(fixture.signals, []);
  assert.equal(fixture.streams[5]!.writableEnded, false);
  fixture.report("LD\n");
  assert.deepEqual(fixture.signals, [{ pid: -901, signal: "SIGUSR1" }]);
  const staleCallbacks = [...fixture.timers.values()].map(timer => timer.callback);
  fixture.report("PRETRAP\nPRETRAP\n");
  assert.equal(fixture.streams[5]!.writableEnded, true);
  assert.equal(fixture.child.stdin.writableEnded, false);
  fixture.child.stdout.emit("data", Buffer.from([0, 255, 10]));
  fixture.report("INTERRUPTED\n");
  assert.equal(fixture.child.stdin.writableEnded, true);
  assert.equal(fixture.streams[3]!.writableEnded, false);
  fixture.eof();
  assert.equal(fixture.streams[3]!.writableEnded, true);
  fixture.child.emit("exit", 0, null);
  fixture.child.emit("close", 0, null);
  const capture = await result;
  assert.deepEqual(capture.stdout, Buffer.from([0, 255, 10]));
  for (const callback of staleCallbacks) callback();
  fixture.child.emit("error", new Error("after close"));
  assert.equal(fixture.signals.length, 1);
  assert.equal(fixture.timers.size, 0);
  assert.deepEqual(fixture.counts(), { authentications: 2, spawns: 1 });
});

for (const protocol of ["INTERRUPTED\n", "WAITER\nCHILD\nINTERRUPTED\n", "UNKNOWN\n", "x".repeat(257)]) {
  test(`independent wait runner: invalid protocol ${JSON.stringify(protocol.slice(0, 40))} rejects after close`, async () => {
    const fixture = runnerFixture();
    const result = fixture.execute("", "USR2");
    const rejected = assert.rejects(result, /protocol|handshake/u);
    fixture.report(protocol);
    assert.equal(fixture.signals.at(-1)?.signal, "SIGKILL");
    fixture.child.emit("close", null, "SIGKILL");
    await rejected;
    assert.equal(fixture.timers.size, 0);
    assert.equal(fixture.counts().authentications, 2);
  });
}

test("independent wait runner: stdout stderr and protocol share one output limit and await close", async () => {
  const fixture = runnerFixture();
  let settled = false;
  const rejected = assert.rejects(fixture.execute("", "USR1"), /output limit/u).then(() => { settled = true; });
  fixture.child.stdout.emit("data", Buffer.alloc(32768));
  fixture.child.stderr.emit("data", Buffer.alloc(32760));
  fixture.report("WAITER\n");
  assert.deepEqual(fixture.signals, []);
  fixture.child.stderr.emit("data", Buffer.from([0, 255]));
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(fixture.signals, [{ pid: -901, signal: "SIGKILL" }]);
  fixture.child.emit("close", null, "SIGKILL");
  await rejected;
  assert.equal(fixture.timers.size, 0);
});

test("independent wait runner: missing handshake at EOF fails without releasing anchor", async () => {
  const fixture = runnerFixture();
  const rejected = assert.rejects(fixture.execute("", "USR1"), /incomplete native wait handshake/u);
  fixture.eof();
  assert.equal(fixture.streams[3]!.writableEnded, false);
  fixture.child.emit("close", null, "SIGKILL");
  await rejected;
});

test("independent wait runner: owner exit forbids group signalling despite late errors and deadline", async () => {
  const fixture = runnerFixture();
  const rejected = assert.rejects(fixture.execute("", "USR1"), /anchor exited before release/u);
  const deadline = [...fixture.timers.values()][0]!.callback;
  fixture.child.emit("exit", 91, null);
  deadline();
  fixture.child.stderr.emit("error", new Error("late"));
  assert.deepEqual(fixture.signals, []);
  fixture.child.emit("close", 91, null);
  await rejected;
});

test("independent wait runner: execution and cleanup deadlines are bounded failures", async () => {
  const fixture = runnerFixture();
  const rejected = assert.rejects(fixture.execute("", "USR1"), (reason: unknown) => {
    assert.ok(reason instanceof AggregateError);
    assert.match(reason.message, /cleanup did not reach close/u);
    assert.match(String(reason.errors[0]), /handshake deadline/u);
    return true;
  });
  fixture.expire(2000);
  assert.deepEqual(fixture.signals, [{ pid: -901, signal: "SIGKILL" }]);
  fixture.expire(1000);
  await rejected;
  assert.ok(fixture.streams.every(stream => stream.destroyed));
  fixture.child.emit("close", null, "SIGKILL");
  assert.equal(fixture.timers.size, 0);
});

test("independent wait runner: permission failure retains signalling and cleanup errors", async () => {
  const denied = Object.assign(new Error("signal denied"), { code: "EPERM" });
  const fixture = runnerFixture({ killFailure: denied });
  const rejected = assert.rejects(fixture.execute("", "USR1"), (reason: unknown) => {
    assert.ok(reason instanceof AggregateError);
    assert.deepEqual(reason.errors, [denied, denied]);
    return true;
  });
  fixture.report("WAITER\nCHILD\n");
  fixture.child.emit("close", null, "SIGKILL");
  await rejected;
  assert.deepEqual(fixture.signals.map(entry => entry.signal), ["SIGUSR1", "SIGKILL"]);
});

for (const authenticationFailure of [1, 2]) {
  test(`independent wait runner: authentication ${authenticationFailure} failure cannot qualify`, async () => {
    const fixture = runnerFixture({ authenticationFailure });
    const rejected = assert.rejects(fixture.execute("", "USR1"), reason => reason === fixture.denied);
    if (authenticationFailure === 2) {
      fixture.report(`SIGNAL:${constants.signals.SIGUSR1}\nWAITER\nCHILD\nPRETRAP\nINTERRUPTED\n`);
      fixture.eof();
      fixture.child.emit("exit", 0, null);
      fixture.child.emit("close", 0, null);
    }
    await rejected;
    assert.deepEqual(fixture.counts(), { authentications: authenticationFailure, spawns: authenticationFailure - 1 });
  });
}
