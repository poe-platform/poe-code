import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { createFsFromVolume, Volume } from "memfs";
import { runOpCli, type NodeHostDependencies } from "./node-host.js";

const payload = new Uint8Array([0, 255, 13, 10, 128]);

function fixture(existing: string | undefined) {
  const files: Record<string, string> = existing === undefined ? {} : { "output.bin": existing };
  const fs = createFsFromVolume(Volume.fromJSON(files, "/work"));
  if (!fs.existsSync("/work")) fs.mkdirSync("/work");
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const stdin = new PassThrough();
  stdin.end();
  const dependencies: NodeHostDependencies = {
    cwd: "/work", version: "0.0.1", env: { OP_BACKEND_MODULE: "./backend.js" },
    fs: fs.promises as unknown as NodeHostDependencies["fs"],
    stdin,
    stdout: new Writable({ write(data, _encoding, callback) { output.push(Uint8Array.from(data)); callback(); } }),
    stderr: new Writable({ write(data, _encoding, callback) { errors.push(Uint8Array.from(data)); callback(); } }),
    async loadModule() { return { default: { async execute() { return Uint8Array.from(payload); } } }; }
  };
  return { fs, dependencies, output, errors: () => Buffer.concat(errors).toString() };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

for (const command of [
  ["document", "get", "document-id"],
  ["read", "op://Private/Service/file.bin"],
  ["inject", "--in-file", "input.tpl"],
  ["item", "template", "get", "Login", "--format=json"],
]) {
  test(`${command.join(" ")} confirms nonempty output before changing bytes or mode`, async () => {
    const run = fixture("existing-content-longer-than-replacement");
    run.fs.chmodSync("/work/output.bin", 0o640);
    run.fs.writeFileSync("/work/input.tpl", "{{ op://Private/Service/password }}");
    const template = { category: "LOGIN", fields: [] };
    run.dependencies.loadModule = async () => ({ default: { async execute() {
      return command[0] === "item" ? template : command[0] === "inject" ? "new" : payload;
    } } });
    let confirmations = 0;
    Object.assign(run.dependencies, { confirmOverwrite(intent: Readonly<{ path: string }>, context: { signal: AbortSignal }) {
      confirmations++;
      assert.deepEqual(intent, { path: "/work/output.bin" });
      assert.equal(Object.isFrozen(intent), true);
      assert.deepEqual(Object.keys(context), ["signal"]);
      assert.equal(context.signal.aborted, false);
      assert.equal(run.fs.readFileSync("/work/output.bin", "utf8"), "existing-content-longer-than-replacement");
      assert.equal(run.fs.statSync("/work/output.bin").mode & 0o777, 0o640);
      assert.equal(run.output.length, 0);
      return true;
    } });
    assert.equal(await runOpCli([...command, "--out-file", "output.bin"], run.dependencies), 0, run.errors());
    assert.equal(confirmations, 1);
    assert.equal(run.fs.statSync("/work/output.bin").mode & 0o777, 0o600);
    const result = run.fs.readFileSync("/work/output.bin");
    if (command[0] === "item") assert.deepEqual(JSON.parse(result.toString()), template);
    else assert.deepEqual(Uint8Array.from(result as Uint8Array), command[0] === "inject" ? new TextEncoder().encode("new") : payload);
    assert.equal(run.output.length, 0);
  });
}

for (const decision of ["false", "EOF", "truthy", "throw", "reject"] as const) {
  test(`overwrite confirmation ${decision} preserves existing bytes and mode`, async () => {
    const run = fixture("keep-existing");
    run.fs.chmodSync("/work/output.bin", 0o640);
    let confirmations = 0;
    Object.assign(run.dependencies, { confirmOverwrite() {
      confirmations++;
      if (decision === "throw") throw new Error("synthetic-private-confirmation-error");
      if (decision === "reject") return Promise.reject(new Error("synthetic-private-confirmation-error"));
      return decision === "EOF" ? undefined : decision === "truthy" ? "true" : false;
    } });
    assert.equal(await runOpCli(["read", "op://Private/Service/file.bin", "--out-file=output.bin"], run.dependencies), 1);
    assert.equal(confirmations, 1);
    assert.equal(run.fs.readFileSync("/work/output.bin", "utf8"), "keep-existing");
    assert.equal(run.fs.statSync("/work/output.bin").mode & 0o777, 0o640);
    assert.equal(run.errors().includes("synthetic-private-confirmation-error"), false);
    assert.equal(run.output.length, 0);
  });
}

test("force and empty or absent outputs bypass confirmation but force never bypasses operation policy", async () => {
  for (const scenario of ["force", "empty", "absent", "denied"] as const) {
    const run = fixture(scenario === "absent" ? undefined : scenario === "empty" ? "" : "keep-existing");
    let confirmations = 0;
    let authorizations = 0;
    Object.assign(run.dependencies, { confirmOverwrite() { confirmations++; return false; } });
    run.dependencies.authorize = () => { authorizations++; return scenario === "denied" ? "deny" : "allow"; };
    const result = await runOpCli(["read", "op://Private/Service/file.bin", "--out-file=output.bin", ...(scenario === "force" || scenario === "denied" ? ["--force"] : [])], run.dependencies);
    assert.equal(result, scenario === "denied" ? 1 : 0, run.errors());
    assert.equal(confirmations, 0);
    assert.equal(authorizations, 1);
    if (scenario === "denied") assert.equal(run.fs.readFileSync("/work/output.bin", "utf8"), "keep-existing");
    else assert.deepEqual(Uint8Array.from(run.fs.readFileSync("/work/output.bin") as Uint8Array), payload);
  }
});

test("aborting pending overwrite confirmation settles and late consent has no effects", async () => {
  const run = fixture("keep-existing");
  run.fs.chmodSync("/work/output.bin", 0o640);
  const controller = new AbortController();
  run.dependencies.signal = controller.signal;
  let closedHandles = 0;
  const files = run.dependencies.fs!;
  run.dependencies.fs = { ...files, async open(...args: Parameters<typeof files.open>) {
    const handle = await files.open(...args);
    const close = handle.close.bind(handle);
    handle.close = async () => { await close(); closedHandles++; };
    return handle;
  } };
  const entered = deferred<void>();
  const permission = deferred<boolean>();
  Object.assign(run.dependencies, { confirmOverwrite(_intent: unknown, context: { signal: AbortSignal }) {
    assert.equal(context.signal, controller.signal);
    entered.resolve();
    return permission.promise;
  } });
  const pending = runOpCli(["read", "op://Private/Service/file.bin", "--out-file=output.bin"], run.dependencies);
  await Promise.race([entered.promise, pending.then(() => assert.fail("exited before confirmation"))]);
  controller.abort();
  assert.equal(await Promise.race([pending, new Promise<undefined>(resolve => setImmediate(() => resolve(undefined)))]), 130);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closedHandles, 1);
  permission.resolve(true);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(run.fs.readFileSync("/work/output.bin", "utf8"), "keep-existing");
  assert.equal(run.fs.statSync("/work/output.bin").mode & 0o777, 0o640);
  assert.equal(run.output.length, 0);
});

test("confirmation retains the opened file handle across path replacement and truncates shorter output", async () => {
  const run = fixture("existing-content-longer-than-replacement");
  const entered = deferred<void>();
  const permission = deferred<boolean>();
  Object.assign(run.dependencies, { confirmOverwrite() { entered.resolve(); return permission.promise; } });
  const pending = runOpCli(["read", "op://Private/Service/file.bin", "--out-file=output.bin"], run.dependencies);
  await Promise.race([entered.promise, pending.then(() => assert.fail("exited before confirmation"))]);
  run.fs.renameSync("/work/output.bin", "/work/original.bin");
  run.fs.writeFileSync("/work/output.bin", "replacement-must-survive", { mode: 0o640 });
  permission.resolve(true);
  assert.equal(await pending, 0, run.errors());
  assert.deepEqual(Uint8Array.from(run.fs.readFileSync("/work/original.bin") as Uint8Array), payload);
  assert.equal(run.fs.statSync("/work/original.bin").mode & 0o777, 0o600);
  assert.equal(run.fs.readFileSync("/work/output.bin", "utf8"), "replacement-must-survive");
  assert.equal(run.fs.statSync("/work/output.bin").mode & 0o777, 0o640);
});

for (const command of [["document", "get", "document-id"], ["read", "op://Private/Service/file.bin"]]) {
  test(`${command[0]} file host fills an existing empty output without force`, async () => {
    const run = fixture("");
    run.fs.chmodSync("/work/output.bin", 0o666);
    assert.equal(await runOpCli([...command, "--out-file", "output.bin"], run.dependencies), 0, run.errors());
    assert.deepEqual(Uint8Array.from(run.fs.readFileSync("/work/output.bin") as Uint8Array), payload);
    assert.equal(run.fs.statSync("/work/output.bin").mode & 0o777, 0o600);
    assert.equal(run.output.length, 0);
  });

  test(`${command[0]} file host retains nonempty content and mode without force`, async () => {
    const run = fixture("keep-existing");
    run.fs.chmodSync("/work/output.bin", 0o640);
    assert.equal(await runOpCli([...command, "--out-file", "output.bin"], run.dependencies), 1);
    assert.equal(run.fs.readFileSync("/work/output.bin", "utf8"), "keep-existing");
    assert.equal(run.fs.statSync("/work/output.bin").mode & 0o777, 0o640);
    assert.equal(run.output.length, 0);
  });

  test(`${command[0]} file host still creates missing outputs and honors force`, async () => {
    for (const existing of [undefined, "replace-existing"]) {
      const run = fixture(existing);
      assert.equal(await runOpCli([...command, "--out-file", "output.bin", "--file-mode", "0640", ...(existing === undefined ? [] : ["--force"])], run.dependencies), 0, run.errors());
      assert.deepEqual(Uint8Array.from(run.fs.readFileSync("/work/output.bin") as Uint8Array), payload);
      assert.equal(run.fs.statSync("/work/output.bin").mode & 0o777, 0o640);
      assert.equal(run.output.length, 0);
    }
  });
}
