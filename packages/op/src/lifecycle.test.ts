import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createFsFromVolume, Volume } from "memfs";
import { createOp, createObjectBackend, type OpCommandContext } from "./index.js";
import { runOpCli, type NodeHostDependencies } from "./node-host.js";
import { encodeSnapshot, decodeSnapshot } from "./snapshot-codec.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

const storedSnapshot = { id: "saved", snapshot: { version: 1, scope: "selected", variables: { TOKEN: "secret-value" } } };

function fixture() {
  const files = createFsFromVolume(Volume.fromJSON({ "seed.json": "{}" }, "/work"));
  const controller = new AbortController();
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  const spawned = deferred<void>();
  let kills = 0;
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill() { kills++; return true; },
  });
  const stdin = new PassThrough();
  stdin.end();
  const dependencies: NodeHostDependencies = {
    cwd: "/work", version: "0.0.1", signal: controller.signal,
    env: { OP_BACKEND_MODULE: "./backend.js" }, stdin,
    fs: files.promises as unknown as NodeHostDependencies["fs"],
    stdout: new Writable({ write(chunk, _encoding, callback) { output.push(Buffer.from(chunk)); callback(); } }),
    stderr: new Writable({ write(chunk, _encoding, callback) { errors.push(Buffer.from(chunk)); callback(); } }),
    loadModule: async () => ({ default: { async execute() { return structuredClone(storedSnapshot); } } }),
    spawn: ((_command: string, _args: readonly string[], options: SpawnOptions) => {
      options.signal!.addEventListener("abort", () => child.emit("error", Object.assign(new Error("aborted"), { code: "ABORT_ERR" })), { once: true });
      spawned.resolve();
      return child as unknown as ChildProcess;
    }) as NodeHostDependencies["spawn"],
  };
  return { files, dependencies, controller, output, errors, child, spawned, kills: () => kills };
}

const childCommands = [
  { name: "run", args: ["run", "--", "worker"] },
  { name: "unmasked run", args: ["run", "--no-masking", "--", "worker"] },
  { name: "snapshot restore", args: ["environment", "snapshot", "restore", "saved", "--", "worker"] },
];

for (const command of childCommands) {
  for (const failure of ["abort", "error"] as const) {
    test(`${command.name}: ${failure} waits for the owned child close event`, async () => {
      const run = fixture();
      let settled = false;
      const execution = runOpCli(command.args, run.dependencies).then(code => { settled = true; return code; });
      await Promise.race([run.spawned.promise, execution.then(code => { throw new Error(`Exited before spawn: ${code}`); })]);
      if (failure === "abort") run.controller.abort();
      else run.child.emit("error", new Error("child failure"));
      await new Promise<void>(resolve => setImmediate(resolve));
      const settledBeforeClose = settled;
      run.child.stdout.end();
      run.child.stderr.end();
      run.child.emit("close", null, "SIGTERM");
      const code = await execution;
      assert.equal(code, failure === "abort" ? 130 : 1);
      assert.ok(run.kills() > 0);
      assert.equal(settledBeforeClose, false, "The Node host owns this child and must await its close after requesting termination");
    });
  }

  test(`${command.name}: child output cannot be forwarded after the CLI settles on error`, async () => {
    const run = fixture();
    let settled = false;
    const lateWrites: string[] = [];
    run.dependencies.stdout = new Writable({ write(chunk, _encoding, callback) {
      if (settled) lateWrites.push(Buffer.from(chunk).toString());
      callback();
    } });
    const execution = runOpCli(command.args, run.dependencies).then(code => { settled = true; return code; });
    await Promise.race([run.spawned.promise, execution.then(code => { throw new Error(`Exited before spawn: ${code}`); })]);
    run.child.emit("error", new Error("child failure"));
    await new Promise<void>(resolve => setImmediate(resolve));
    run.child.stdout.end("last bytes before close");
    run.child.stderr.end();
    run.child.emit("close", 1, null);
    await execution;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(lateWrites, [], "Bytes emitted before child close must be drained or discarded before the CLI settles");
  });
}

test("Node child output write errors still await child close", async () => {
  const run = fixture();
  const rejectedWrite = deferred<void>();
  run.dependencies.stdout = new Writable({ write(_chunk, _encoding, callback) {
    rejectedWrite.resolve();
    callback(new Error("output failure"));
  } });
  let settled = false;
  const execution = runOpCli(["run", "--", "worker"], run.dependencies).then(code => { settled = true; return code; });
  await Promise.race([run.spawned.promise, execution.then(code => { throw new Error(`Exited before spawn: ${code}`); })]);
  run.child.stdout.write("output");
  await Promise.race([rejectedWrite.promise, execution.then(code => { throw new Error(`Exited before output: ${code}`); })]);
  await new Promise<void>(resolve => setImmediate(resolve));
  const settledBeforeClose = settled;
  run.child.stdout.end();
  run.child.stderr.end();
  run.child.emit("close", 1, null);
  assert.equal(await execution, 1);
  assert.ok(run.kills() > 0);
  assert.equal(settledBeforeClose, false);
});

test("normal child close waits for outstanding output callbacks before returning", async () => {
  const run = fixture();
  const writing = deferred<void>();
  let release!: () => void;
  run.dependencies.stdout = new Writable({ write(_chunk, _encoding, callback) { release = callback; writing.resolve(); } });
  let settled = false;
  const execution = runOpCli(["run", "--", "worker"], run.dependencies).then(code => { settled = true; return code; });
  await Promise.race([run.spawned.promise, execution.then(code => { throw new Error(`Exited before spawn: ${code}`); })]);
  run.child.stdout.end("final output");
  run.child.stderr.end();
  run.child.emit("close", 0, null);
  await Promise.race([writing.promise, execution.then(code => { throw new Error(`Exited before output: ${code}`); })]);
  await new Promise<void>(resolve => setImmediate(resolve));
  const settledBeforeWrite = settled;
  release();
  assert.equal(await execution, 0);
  assert.equal(settledBeforeWrite, false);
});

for (const representation of ["Uint8Array", "Buffer"] as const) {
  test(`snapshot masking takes ownership of ${representation} writes before asynchronous processing`, async () => {
    const backend = createObjectBackend({ resources: { "environment snapshot": [storedSnapshot] } });
    const output: Uint8Array[] = [];
    const context: OpCommandContext = {
      args: ["environment", "snapshot", "restore", "saved", "--", "worker"], env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { output.push(bytes.slice()); } },
      stderr: { async write() {} },
      async invoke(_command, _args, options) {
        const bytes = representation === "Buffer" ? Buffer.from("token=secret-value") : new TextEncoder().encode("token=secret-value");
        const writing = options.stdout!.write(bytes);
        bytes.fill(88);
        await writing;
        return { exitCode: 0 };
      },
    };
    assert.equal((await createOp({ backend }).execute(context)).exitCode, 0);
    assert.equal(Buffer.concat(output).toString(), "token=<concealed by 1Password>");
  });
}

test("snapshot masking handles split UTF-8, overlapping secrets and independent output streams", async () => {
  const backend = createObjectBackend({ resources: { "environment snapshot": [{ id: "saved", snapshot: { version: 1, scope: "selected", variables: { SHORT: "abc", LONG: "abcdef", UNICODE: "🔐secret" } } }] } });
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context: OpCommandContext = {
    args: ["environment", "snapshot", "restore", "saved", "--", "worker"], env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
    async invoke(_command, _args, options) {
      for (const byte of new TextEncoder().encode("abcdef 🔐secret!")) await options.stdout!.write(new Uint8Array([byte]));
      await options.stderr!.write(new TextEncoder().encode("abc?"));
      return { exitCode: 7 };
    },
  };
  assert.equal((await createOp({ backend }).execute(context)).exitCode, 7);
  assert.equal(Buffer.concat(output).toString(), "<concealed by 1Password> <concealed by 1Password>!");
  assert.equal(Buffer.concat(errors).toString(), "<concealed by 1Password>?");
});

test("aborted persistence waits for temporary cleanup and never renames staged state", async () => {
  const run = fixture();
  run.dependencies.env = { OP_BACKEND_FILE: "seed.json" };
  const files = run.dependencies.fs!;
  const cleanupEntered = deferred<void>();
  const cleanupPermission = deferred<void>();
  let renames = 0;
  run.dependencies.fs = { ...files,
    async writeFile(path, data, options) {
      await files.writeFile(path, data, options);
      run.controller.abort();
    },
    async rename(source, destination) { renames++; return files.rename(source, destination); },
    async unlink(path) { cleanupEntered.resolve(); await cleanupPermission.promise; return files.unlink(path); },
  };
  let settled = false;
  const execution = runOpCli(["group", "create", "Engineering"], run.dependencies).then(code => { settled = true; return code; });
  await Promise.race([cleanupEntered.promise, execution.then(code => { throw new Error(`Exited before cleanup: ${code}`); })]);
  const settledBeforeCleanup = settled;
  cleanupPermission.resolve();
  assert.equal(await execution, 130);
  assert.equal(settledBeforeCleanup, false);
  assert.equal(renames, 0);
  assert.equal(run.files.readFileSync("/work/seed.json", "utf8"), "{}");
  assert.deepEqual(run.files.readdirSync("/work"), ["seed.json"]);
});

test("persisted snapshots preserve binary views and environment metadata across independent CLI runs", async () => {
  const run = fixture();
  const bytes = new Uint8Array([99, 0, 255, 128, 99]);
  run.files.writeFileSync("/work/seed.json", encodeSnapshot({ documents: [{ id: "binary", content: bytes.subarray(1, 4) }], resources: { "environment snapshot": [storedSnapshot] } }));
  run.dependencies.env = { OP_BACKEND_FILE: "seed.json" };
  assert.equal(await runOpCli(["group", "create", "Engineering"], run.dependencies), 0);
  const saved = decodeSnapshot(run.files.readFileSync("/work/seed.json", "utf8") as string);
  assert.deepEqual(saved.documents![0]!.content, new Uint8Array([0, 255, 128]));
  assert.deepEqual(saved.resources!["environment snapshot"], [storedSnapshot]);
  run.output.length = 0;
  assert.equal(await runOpCli(["document", "get", "binary"], run.dependencies), 0);
  assert.deepEqual(Buffer.concat(run.output), Buffer.from([0, 255, 128]));
  assert.deepEqual(run.files.readdirSync("/work"), ["seed.json"]);
});
