import assert from "node:assert/strict";
import { test } from "node:test";
import { PassThrough, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { isAbsolute, join, resolve, sep, win32, posix } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { runOpCli, normalizePluginScopePath, type NodeHostDependencies } from "./node-host.js";
import { decodeSnapshot, encodeSnapshot } from "./snapshot-codec.js";
import type { OpBackendContext } from "./types.js";
import { createObjectBackend } from "./backend.js";
import { availablePlugins } from "./plugin-catalog.js";

function fixture(files: Record<string, string> = {}, env: Record<string, string | undefined> = {}) {
  const fs = createFsFromVolume(Volume.fromJSON(files, "/work"));
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  const stdin = new PassThrough();
  stdin.end();
  const dependencies: NodeHostDependencies = {
    fs: fs.promises as unknown as NodeHostDependencies["fs"],
    cwd: "/work", env, stdin, version: "0.0.1",
    stdout: new Writable({ write(chunk, _encoding, callback) { output.push(Buffer.from(chunk)); callback(); } }),
    stderr: new Writable({ write(chunk, _encoding, callback) { errors.push(Buffer.from(chunk)); callback(); } }),
    loadModule: async () => { throw new Error("unexpected module load"); },
    spawn: (() => { throw new Error("unexpected spawn"); }) as NodeHostDependencies["spawn"],
  };
  return { fs, dependencies, output, errors };
}

test("help works without configured backend and describes extension environment", async () => {
  const run = fixture();
  assert.equal(await runOpCli(["--help"], run.dependencies), 0);
  const text = Buffer.concat(run.output).toString();
  assert.ok(text.includes("OP_BACKEND_MODULE"));
  assert.ok(text.includes("OP_BACKEND_FILE"));
});

test("node plugin chooser is captured before module loading and forwarded without wrapping", async () => {
  const selectPlugin = () => "offered-id";
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  run.dependencies.selectPlugin = selectPlugin;
  run.dependencies.loadModule = async () => {
    Object.assign(run.dependencies, { selectPlugin: () => { assert.fail("replacement chooser"); } });
    return { default: { async execute(_request: unknown, context: OpBackendContext) {
      assert.equal(Reflect.get(context, "selectPlugin"), selectPlugin);
      assert.ok(Object.isFrozen(context));
      return {};
    } } };
  };
  assert.equal(await runOpCli(["plugin", "inspect"], run.dependencies), 0, Buffer.concat(run.errors).toString());
});

test("node plugin denial performs no module or candidate loading and no selection", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  const effects: string[] = [];
  run.dependencies.selectPlugin = () => { effects.push("chooser"); return undefined; };
  run.dependencies.loadModule = async () => { effects.push("module"); return { default: { async execute() { effects.push("metadata"); return {}; } } }; };
  run.dependencies.authorize = () => "deny";
  assert.equal(await runOpCli(["plugin", "inspect"], run.dependencies), 1);
  assert.deepEqual(effects, []);
  assert.equal(Buffer.concat(run.output).toString(), "");
});

test("node object plugin inspect offers only metadata and accepts an explicit sync or async choice", async () => {
  const builtinCandidates = availablePlugins([]).flatMap(plugin => plugin.executable === undefined ? [] : [{ id: plugin.executable, name: plugin.plugin_name! }]);
  for (const asynchronous of [false, true]) {
    const seed = JSON.stringify({ accounts: [{ id: "selected-account" }, { id: "other-account" }], resources: { plugin: [
      { id: "first", name: "First", account: "selected-account", privateValue: "synthetic-private" },
      { id: "second", name: "Second", account: "selected-account" },
      { id: "foreign", name: "Foreign", account: "other-account" },
    ] } });
    const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
    let selections = 0;
    run.dependencies.selectPlugin = (candidates, context) => {
      selections++;
      assert.deepEqual(candidates, [...builtinCandidates, { id: "first", name: "First" }, { id: "second", name: "Second" }]);
      assert.equal(candidates.some(candidate => candidate.id === "foreign"), false);
      assert.ok(Object.isFrozen(candidates));
      assert.ok(candidates.every(candidate => Object.isFrozen(candidate)));
      assert.ok(Object.isFrozen(context));
      assert.equal(context.accountId, "selected-account");
      assert.equal(context.signal.aborted, false);
      return asynchronous ? Promise.resolve("second") : "second";
    };
    assert.equal(await runOpCli(["plugin", "inspect", "--account=selected-account", "--format=json"], run.dependencies), 0, Buffer.concat(run.errors).toString());
    assert.equal(selections, 1);
    assert.deepEqual(JSON.parse(Buffer.concat(run.output).toString()), { id: "second", name: "Second", account: "selected-account" });
    assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), seed);
  }
});

test("node plugin inspection never defaults a missing, cancelled or unoffered choice", async () => {
  for (const selection of ["missing", "cancel", "unoffered"] as const) {
    const seed = JSON.stringify({ resources: { plugin: [{ id: "only", name: "Only" }] } });
    const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
    let selections = 0;
    if (selection !== "missing") run.dependencies.selectPlugin = () => { selections++; return selection === "cancel" ? undefined : "Only"; };
    assert.equal(await runOpCli(["plugin", "inspect"], run.dependencies), 1);
    assert.equal(selections, selection === "missing" ? 0 : 1);
    assert.equal(Buffer.concat(run.output).toString(), "");
    assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), seed);
  }
});

test("node explicit plugin inspection bypasses the chooser", async () => {
  const run = fixture({ "seed.json": JSON.stringify({ resources: { plugin: [{ id: "only", name: "Only" }] } }) }, { OP_BACKEND_FILE: "seed.json" });
  run.dependencies.selectPlugin = () => { assert.fail("explicit operand must bypass selection"); };
  assert.equal(await runOpCli(["plugin", "inspect", "only", "--format=json"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  assert.equal(JSON.parse(Buffer.concat(run.output).toString()).id, "only");
});

test("missing or conflicting explicit backend configuration fails", async () => {
  for (const env of [{}, { OP_BACKEND_FILE: "seed.json", OP_BACKEND_MODULE: "./backend.js" }]) {
    const run = fixture({}, env);
    assert.equal(await runOpCli(["vault", "list"], run.dependencies), 1);
    assert.ok(Buffer.concat(run.errors).length > 0);
  }
});

test("hidden completion callbacks retain their final directive when completing help flags", async () => {
  for (const callback of ["__complete", "__completeNoDesc"]) {
    for (const flag of ["--help", "-h"]) {
      const run = fixture();
      assert.equal(await runOpCli([callback, "item", flag, ""], run.dependencies), 0, Buffer.concat(run.errors).toString());
      const output = Buffer.concat(run.output).toString();
      assert.ok(output.endsWith(":4\n"), output);
      assert.equal(output.includes("Node backend configuration:"), false);
    }
  }
});

test("completion callback names elsewhere do not suppress ordinary help", async () => {
  for (const args of [["item", "get", "__complete", "--help"], ["item", "get", "__completeNoDesc", "-h"], ["--help"], ["help", "item"]]) {
    const run = fixture();
    assert.equal(await runOpCli(args, run.dependencies), 0, Buffer.concat(run.errors).toString());
    assert.ok(Buffer.concat(run.output).toString().includes("Node backend configuration:"));
  }
});

test("loads a default backend object using a cwd-relative module URL", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  run.dependencies.loadModule = async (specifier) => {
    assert.equal(specifier, "file:///work/backend.js");
    return { default: { async execute() { return [{ id: "custom" }]; } } };
  };
  assert.equal(await runOpCli(["vault", "list", "--format=json"], run.dependencies), 0);
  assert.deepEqual(JSON.parse(Buffer.concat(run.output).toString()), [{ id: "custom" }]);
});

test("rejects backend factories rather than executing arbitrary export shapes", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  run.dependencies.loadModule = async () => ({ default: () => ({ execute() {} }) });
  assert.equal(await runOpCli(["vault", "list"], run.dependencies), 1);
});

test("module resolved policy exports approve sanitized bindings and refuse changed selections", async () => {
  for (const stale of [false, true]) {
    const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js", OP_BIOMETRIC_UNLOCK_ENABLED: "true" });
    const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Entry", vault: "vault", fields: [{ id: "password", value: "synthetic-sensitive" }] }] });
    const authentication = { terminalId: "trusted", integration: "manual" as const };
    run.dependencies.authentication = authentication;
    let approvals = 0;
    run.dependencies.loadModule = async () => ({
      default: backend,
      authorize: () => "ask" as const,
      authorizeResolution: () => true,
      async approveResolved(manifest: unknown, context: OpBackendContext) {
        approvals++;
        assert.ok(Object.isFrozen(manifest));
        assert.equal(JSON.stringify(manifest).includes("synthetic-sensitive"), false);
        assert.equal(Object.hasOwn(manifest as object, "handle"), false);
        assert.deepEqual(context.authentication, { terminalId: "trusted", integration: "app" });
        authentication.terminalId = "changed";
        if (stale) await backend.execute({ resource: "item", action: "edit", args: ["item"], flags: { title: "Changed" } }, { signal: new AbortController().signal });
        return true;
      },
    });
    assert.equal(await runOpCli(["read", "op://Work/Entry/password"], run.dependencies), stale ? 1 : 0, Buffer.concat(run.errors).toString());
    assert.equal(approvals, 1);
    assert.equal(Buffer.concat(run.output).toString(), stale ? "" : "synthetic-sensitive\n");
    assert.equal(backend.snapshot().items![0]!.title, stale ? "Changed" : "Entry");
  }
});

test("Node literal approval compatibility requires explicit host configuration", async () => {
  for (const literal of [false, true]) {
    const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
    if (literal) Object.assign(run.dependencies, { approvalMode: "literal" });
    let approvals = 0;
    run.dependencies.loadModule = async () => ({ default: { async execute() { return []; } }, authorize: () => "ask", approve() { approvals++; return true; } });
    assert.equal(await runOpCli(["vault", "list"], run.dependencies), literal ? 0 : 1, Buffer.concat(run.errors).toString());
    assert.equal(approvals, literal ? 1 : 0);
  }
});

test("resolved file backend approval fails closed without cross-process revision support", async () => {
  const initial = JSON.stringify({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Entry", vault: "vault" }] });
  const run = fixture({ "seed.json": initial }, { OP_BACKEND_FILE: "seed.json" });
  let approvals = 0;
  Object.assign(run.dependencies, {
    authorize: () => "ask",
    authorizeResolution: () => true,
    approveResolved() {
      approvals++;
      run.fs.writeFileSync("/work/seed.json", JSON.stringify({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Externally changed", vault: "vault" }] }));
      return true;
    },
  });
  assert.equal(await runOpCli(["item", "edit", "item", "title=Requested"], run.dependencies), 1, Buffer.concat(run.errors).toString());
  assert.equal(approvals, 0);
  assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), initial);
  assert.equal(run.output.length, 0);
});

const seed = JSON.stringify({ vaults: [{ id: "vault", name: "Work" }], items: [{ id: "item", title: "Login", vault: { id: "vault" }, fields: [{ id: "password", value: "test-secret" }] }] });

test("reads and injects secrets through the root SDK helpers", async () => {
  const read = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
  assert.equal(await runOpCli(["read", "op://Work/Login/password"], read.dependencies), 0, Buffer.concat(read.errors).toString());
  assert.equal(Buffer.concat(read.output).toString().trimEnd(), "test-secret");
  const inject = fixture({ "seed.json": seed, "template.txt": "token={{ op://Work/Login/password }}" }, { OP_BACKEND_FILE: "seed.json" });
  assert.equal(await runOpCli(["inject", "--in-file", "template.txt", "--out-file", "result.txt"], inject.dependencies), 0);
  assert.equal(inject.fs.readFileSync("/work/result.txt", "utf8"), "token=test-secret");
});

test("run spawns literal argv with resolved environment and awaits output", async () => {
  const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json", TOKEN: "op://Work/Login/password", PATH: "/bin" });
  run.dependencies.spawn = ((command: string, args: readonly string[], options: SpawnOptions) => {
    assert.equal(command, "echo");
    assert.deepEqual(args, ["$(touch nope)", "--help"]);
    assert.equal(options.shell, false);
    assert.equal(options.env!.TOKEN, "test-secret");
    assert.equal(options.env!.PATH, "/bin");
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    queueMicrotask(() => { child.stdout.end("child output"); child.stderr.end(); child.emit("close", 7, null); });
    return child as unknown as ChildProcess;
  }) as NodeHostDependencies["spawn"];
  assert.equal(await runOpCli(["run", "--", "echo", "$(touch nope)", "--help"], run.dependencies), 7, Buffer.concat(run.errors).toString());
  assert.equal(Buffer.concat(run.output).toString(), "child output");
});

test("already cancelled invocations do not load backends", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  assert.notEqual(await runOpCli(["vault", "list"], { ...run.dependencies, signal: AbortSignal.abort() }), 0);
});

test("object mutations persist atomically with private temporary permissions", async () => {
  const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
  const originalRename = run.dependencies.fs!.rename;
  let renamed = false;
  run.dependencies.fs = { ...run.dependencies.fs!, async rename(source, destination) {
    assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), seed);
    assert.equal(run.fs.statSync(String(source)).mode & 0o777, 0o600);
    renamed = true;
    return originalRename(source, destination);
  } };
  assert.equal(await runOpCli(["item", "delete", "item"], run.dependencies), 0);
  assert.ok(renamed);
  assert.equal(decodeSnapshot(run.fs.readFileSync("/work/seed.json", "utf8") as string).items![0]!.state, "DELETED");
  assert.deepEqual(run.fs.readdirSync("/work"), ["seed.json"]);
});

test("read-only commands do not rewrite the seed", async () => {
  const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
  assert.equal(await runOpCli(["vault", "list"], run.dependencies), 0);
  assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), seed);
});

test("failed atomic persistence preserves the seed and removes its temporary file", async () => {
  const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
  run.dependencies.fs = { ...run.dependencies.fs!, async rename() { throw new Error("rename failed"); } };
  assert.equal(await runOpCli(["item", "delete", "item"], run.dependencies), 1);
  assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), seed);
  assert.deepEqual(run.fs.readdirSync("/work"), ["seed.json"]);
});

test("partial temporary writes are removed after failure", async () => {
  const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
  run.dependencies.fs = { ...run.dependencies.fs!, async writeFile(path) {
    run.fs.writeFileSync(String(path), "partial secret");
    throw new Error("write failed");
  } };
  assert.equal(await runOpCli(["item", "delete", "item"], run.dependencies), 1);
  assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), seed);
  assert.deepEqual(run.fs.readdirSync("/work"), ["seed.json"]);
});

test("host awaits asynchronous stream write callbacks", async () => {
  const run = fixture();
  let release: (() => void) | undefined;
  let started!: () => void;
  let nextWrite = new Promise<void>(resolve => { started = resolve; });
  run.dependencies.stdout = new Writable({ write(_chunk, _encoding, callback) { release = callback; started(); } });
  let finished = false;
  const pending = runOpCli(["--help"], run.dependencies).then(code => { finished = true; return code; });
  await nextWrite;
  assert.equal(finished, false);
  assert.ok(release);
  nextWrite = new Promise<void>(resolve => { started = resolve; });
  release();
  await nextWrite;
  assert.equal(finished, false);
  release();
  assert.equal(await pending, 0);
});

test("spawn cancellation forwards the signal and terminates child work", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  run.dependencies.loadModule = async () => ({ default: { async execute() {} } });
  const controller = new AbortController();
  run.dependencies.signal = controller.signal;
  let killed = false;
  run.dependencies.spawn = ((_command: string, _args: readonly string[], options: SpawnOptions) => {
    assert.equal(options.signal, controller.signal);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { killed = true; return true; } });
    options.signal!.addEventListener("abort", () => { child.stdout.end(); child.stderr.end(); child.emit("error", new Error("aborted")); child.emit("close", null, "SIGTERM"); });
    queueMicrotask(() => controller.abort());
    return child as unknown as ChildProcess;
  }) as NodeHostDependencies["spawn"];
  assert.equal(await runOpCli(["run", "--", "app"], run.dependencies), 130);
  assert.ok(killed);
});

test("module authorization denies helper execution before spawning", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  let authorized = false;
  run.dependencies.loadModule = async () => ({
    default: { async execute() { throw new Error("must not execute"); } },
    authorize: (request) => { assert.equal(request.resource, "run"); authorized = true; return "deny"; },
  });
  assert.equal(await runOpCli(["run", "--", "app"], run.dependencies), 1);
  assert.ok(authorized);
});

test("module approval callback receives authorized request and controls execution", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  run.dependencies.approvalMode = "literal";
  let authorized: unknown;
  let approved = false;
  run.dependencies.loadModule = async () => ({
    default: { async execute() { assert.ok(approved); return []; } },
    authorize: (request) => { authorized = request; return "ask"; },
    approve: (request, context) => { assert.equal(request, authorized); assert.ok(context.signal); approved = true; return true; },
  });
  assert.equal(await runOpCli(["vault", "list"], run.dependencies), 0);
  assert.ok(approved);
});

test("completion works without backend configuration", async () => {
  const run = fixture();
  assert.equal(await runOpCli(["completion", "bash"], run.dependencies), 0);
  assert.ok(Buffer.concat(run.output).toString().includes("complete"));
});

test("version reads the runtime package version without loading a backend", async () => {
  const run = fixture();
  run.dependencies.version = undefined;
  run.dependencies.fs = { ...run.dependencies.fs!, readFile: (async (path: unknown) => {
    assert.ok(path instanceof URL);
    assert.ok(path.pathname.endsWith("/op/package.json"));
    return JSON.stringify({ version: "9.8.7" });
  }) as NonNullable<NodeHostDependencies["fs"]>["readFile"] };
  assert.equal(await runOpCli(["--version"], run.dependencies), 0);
  assert.ok(Buffer.concat(run.output).toString().includes("9.8.7"));
});

test("short version flag uses the injected package version", async () => {
  const run = fixture();
  run.dependencies.version = "7.6.5";
  assert.equal(await runOpCli(["-v"], run.dependencies), 0);
  assert.ok(Buffer.concat(run.output).toString().includes("7.6.5"));
});

test("output files use private permissions by default", async () => {
  const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
  assert.equal(await runOpCli(["read", "op://Work/Login/password", "--out-file", "secret.txt"], run.dependencies), 0);
  assert.equal(run.fs.statSync("/work/secret.txt").mode & 0o777, 0o600);
});

test("output cancellation after opening preserves content and permissions and closes the handle", async () => {
  for (const force of [false, true]) {
    const run = fixture({ "seed.json": seed, "secret.txt": force ? "keep" : "" }, { OP_BACKEND_FILE: "seed.json" });
    run.fs.chmodSync("/work/secret.txt", 0o640);
    const controller = new AbortController();
    run.dependencies.signal = controller.signal;
    const files = run.dependencies.fs!;
    let closed = false;
    run.dependencies.fs = { ...files, async open(...args) {
      const handle = await files.open(...args);
      const close = handle.close.bind(handle);
      handle.close = async () => { closed = true; await close(); };
      controller.abort(new Error("cancel output"));
      return handle;
    } };
    assert.equal(await runOpCli(["read", "op://Work/Login/password", "--out-file", "secret.txt", ...(force ? ["--force"] : [])], run.dependencies), 130);
    assert.equal(run.fs.readFileSync("/work/secret.txt", "utf8"), force ? "keep" : "");
    assert.equal(run.fs.statSync("/work/secret.txt").mode & 0o777, 0o640);
    assert.equal(closed, true);
  }
});

test("empty output symlinks are refused without force", async () => {
  const run = fixture({ "seed.json": seed, "target.txt": "" }, { OP_BACKEND_FILE: "seed.json" });
  run.fs.chmodSync("/work/target.txt", 0o640);
  run.fs.symlinkSync("/work/target.txt", "/work/secret.txt");
  const files = run.dependencies.fs!;
  let refusedSymlink = false;
  run.dependencies.fs = { ...files, async open(path, flags, mode) {
    assert.equal(typeof flags, "number");
    assert.notEqual((flags as number) & run.fs.constants.O_NOFOLLOW, 0);
    if (run.fs.lstatSync(path).isSymbolicLink()) {
      refusedSymlink = true;
      throw Object.assign(new Error("Symlink refused"), { code: "ELOOP" });
    }
    return files.open(path, flags, mode);
  } };
  assert.equal(await runOpCli(["read", "op://Work/Login/password", "--out-file", "secret.txt"], run.dependencies), 1);
  assert.equal(refusedSymlink, true);
  assert.equal(run.fs.readFileSync("/work/target.txt", "utf8"), "");
  assert.equal(run.fs.statSync("/work/target.txt").mode & 0o777, 0o640);
});

test("force overwrites output and enforces the requested mode on existing files", async () => {
  const run = fixture({ "seed.json": seed, "secret.txt": "old" }, { OP_BACKEND_FILE: "seed.json" });
  run.fs.chmodSync("/work/secret.txt", 0o666);
  assert.equal(await runOpCli(["read", "op://Work/Login/password", "--out-file", "secret.txt", "--force", "--file-mode", "0640"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  assert.equal(run.fs.readFileSync("/work/secret.txt", "utf8"), "test-secret");
  assert.equal(run.fs.statSync("/work/secret.txt").mode & 0o777, 0o640);
});

test("exclusive output creation preserves an existing file without force", async () => {
  const run = fixture({ "seed.json": seed, "secret.txt": "keep" }, { OP_BACKEND_FILE: "seed.json" });
  assert.equal(await runOpCli(["read", "op://Work/Login/password", "--out-file", "secret.txt"], run.dependencies), 1);
  assert.equal(run.fs.readFileSync("/work/secret.txt", "utf8"), "keep");
});

test("interactive commands do not wait for terminal stdin", async () => {
  const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
  const input = Object.assign(new PassThrough(), { isTTY: true });
  input[Symbol.asyncIterator] = () => { throw new Error("terminal input must not be consumed as JSON"); };
  run.dependencies.stdin = input;
  assert.equal(await runOpCli(["vault", "list"], run.dependencies), 0);
});

test("backend module file paths without dot prefix resolve from cwd", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "backend.js" });
  run.dependencies.loadModule = async (specifier) => {
    assert.equal(specifier, "file:///work/backend.js");
    return { default: { async execute() { return []; } } };
  };
  assert.equal(await runOpCli(["vault", "list"], run.dependencies), 0);
});

test("cancellation interrupts pending piped stdin", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  run.dependencies.loadModule = async () => ({ default: { async execute() { throw new Error("must not execute"); } } });
  const controller = new AbortController();
  let reading!: () => void;
  const started = new Promise<void>(resolve => { reading = resolve; });
  run.dependencies.stdin = new PassThrough({ read() { reading(); } });
  run.dependencies.signal = controller.signal;
  const pending = runOpCli(["vault", "list"], run.dependencies);
  await started;
  controller.abort();
  assert.equal(await pending, 130);
  assert.equal(run.dependencies.stdin.destroyed, false);
  run.dependencies.stdin.destroy();
});

test("borrowed input errors and premature closure settle the command", async () => {
  for (const error of [new Error("input failed"), undefined]) {
    const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
    run.dependencies.loadModule = async () => ({ default: { async execute() { assert.fail("input failure must prevent backend execution"); } } });
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const input = new PassThrough({ read() { reading(); } });
    run.dependencies.stdin = input;
    const pending = runOpCli(["vault", "list"], run.dependencies);
    await started;
    input.destroy(error);
    assert.equal(await pending, 1);
    assert.ok(Buffer.concat(run.errors).toString().includes(error ? "input failed" : "Input closed"));
  }
});

test("binary documents survive persistence and a separate CLI invocation", async () => {
  const run = fixture({ "seed.json": seed }, { OP_BACKEND_FILE: "seed.json" });
  const bytes = Buffer.from([0, 128, 255, 10]);
  run.fs.writeFileSync("/work/input.bin", bytes);
  assert.equal(await runOpCli(["document", "create", "input.bin", "--title", "Binary", "--vault", "Work"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  run.output.length = 0;
  assert.equal(await runOpCli(["document", "get", "Binary"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  assert.deepEqual(Buffer.concat(run.output), bytes);
});

test("compatibility channel defaults to stable and enables beta command help explicitly", async () => {
  for (const channel of [undefined, "stable", "beta"]) {
    const run = fixture({}, { OP_COMPATIBILITY_CHANNEL: channel });
    assert.equal(await runOpCli(["run", "--help"], run.dependencies), 0);
    assert.equal(Buffer.concat(run.output).toString().includes("--environment"), channel === "beta");
  }
});

test("invalid compatibility channels fail without loading a backend", async () => {
  for (const channel of ["", "Beta", "preview"]) {
    const run = fixture({}, { OP_COMPATIBILITY_CHANNEL: channel });
    assert.equal(await runOpCli(["--help"], run.dependencies), 1);
    assert.ok(Buffer.concat(run.errors).toString().includes("OP_COMPATIBILITY_CHANNEL"));
  }
});

test("binary document output respects the terminal capability", async () => {
  const run = fixture({ "seed.json": encodeSnapshot({ documents: [{ id: "binary", content: new Uint8Array([0, 255]) }] }) }, { OP_BACKEND_FILE: "seed.json" });
  Object.assign(run.dependencies.stdout!, { isTTY: true });
  assert.equal(await runOpCli(["document", "get", "binary"], run.dependencies), 1);
  assert.equal(run.output.length, 0);
  assert.equal(await runOpCli(["document", "get", "binary", "--force"], run.dependencies), 0);
  assert.deepEqual(Buffer.concat(run.output), Buffer.from([0, 255]));
});

test("environment restore emits shell output or invokes a child without changing the parent environment", async () => {
  const run = fixture({ "seed.json": "{}" }, { OP_BACKEND_FILE: "seed.json", TOKEN: "before" });
  assert.equal(await runOpCli(["environment", "snapshot", "create", "saved", "--vars=TOKEN"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  run.dependencies.env!.TOKEN = "after";
  run.output.length = 0;
  assert.equal(await runOpCli(["environment", "snapshot", "restore", "saved", "--shell=bash"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  assert.ok(Buffer.concat(run.output).toString().includes("before"));
  assert.equal(run.dependencies.env!.TOKEN, "after");
  assert.equal(await runOpCli(["environment", "snapshot", "restore", "saved"], run.dependencies), 1);
  run.dependencies.spawn = ((_command: string, args: readonly string[], options: SpawnOptions) => {
    assert.deepEqual(args, ["literal;arg"]);
    assert.equal(options.env!.TOKEN, "before");
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit("close", 0, null); });
    return child as unknown as ChildProcess;
  }) as NodeHostDependencies["spawn"];
  assert.equal(await runOpCli(["environment", "snapshot", "restore", "saved", "--", "app", "literal;arg"], run.dependencies), 0);
  assert.equal(run.dependencies.env!.TOKEN, "after");
});

test("object backend generates and transforms an Ed25519 key across CLI invocations", async () => {
  const untrustedSeed = JSON.stringify({ vaults: [{ id: "vault", name: "Work" }], ssh: { generate: "untrusted", transform: "untrusted" } });
  const run = fixture({ "seed.json": untrustedSeed }, { OP_BACKEND_FILE: "seed.json" });
  assert.equal(await runOpCli(["item", "create", "--vault", "Work", "--title", "Generated", "--ssh-generate-key", "ed25519"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  run.output.length = 0;
  assert.equal(await runOpCli(["read", "op://Work/Generated/private_key?ssh-format=pkcs8"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  assert.ok(Buffer.concat(run.output).toString().startsWith("-----BEGIN PRIVATE KEY-----"));
  assert.equal(Object.hasOwn(decodeSnapshot(run.fs.readFileSync("/work/seed.json", "utf8") as string), "ssh"), false);
});

test("plugin scope supplies normalized absolute paths without deriving terminal identity", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js", OP_SESSION: "synthetic-auth-session" });
  run.dependencies.cwd = "/work/project/..";
  run.dependencies.pluginScope = { home: "/users/test/./home/.." };
  let received: unknown;
  run.dependencies.loadModule = async () => ({ default: { async execute(_request: unknown, context: OpBackendContext) { received = context.pluginScope; return []; } } });
  assert.equal(await runOpCli(["plugin", "list"], run.dependencies), 0);
  assert.deepEqual(received, { cwd: "/work", home: "/users/test" });
});

test("plugin scope defaults are absolute and explicit terminal identity has injected precedence", async () => {
  for (const terminalSession of [undefined, "injected-session"]) {
    const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js", OP_PLUGIN_SESSION_ID: "explicit-session" });
    if (terminalSession) run.dependencies.pluginScope = { terminalSession };
    run.dependencies.loadModule = async () => ({ default: { async execute(_request: unknown, context: OpBackendContext) {
      assert.ok(isAbsolute(context.pluginScope!.cwd));
      assert.ok(isAbsolute(context.pluginScope!.home));
      assert.equal(context.pluginScope!.terminalSession, terminalSession ?? "explicit-session");
      return [];
    } } });
    assert.equal(await runOpCli(["plugin", "list"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  }
});

test("native scope separators become portable without changing the spawned cwd", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  const nativeCwd = resolve("/work");
  const suppliedCwd = `${nativeCwd}${sep}project${sep}..`;
  run.dependencies.cwd = suppliedCwd;
  run.dependencies.pluginScope = { cwd: join(nativeCwd, "project", ".."), home: join(nativeCwd, "home") };
  run.dependencies.loadModule = async () => ({ default: { async execute() {} }, authorize(_request, context) {
    assert.deepEqual(context.pluginScope, { cwd: nativeCwd.split(sep).join("/"), home: join(nativeCwd, "home").split(sep).join("/") });
    assert.equal(context.pluginScope!.cwd.includes("\\"), false);
    assert.equal(context.pluginScope!.home.includes("\\"), false);
    return "allow";
  } });
  run.dependencies.spawn = ((_command: string, _args: readonly string[], options: SpawnOptions) => {
    assert.equal(options.cwd, suppliedCwd);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit("close", 0, null); });
    return child as unknown as ChildProcess;
  }) as NodeHostDependencies["spawn"];
  assert.equal(await runOpCli(["run", "--", "app"], run.dependencies), 0, Buffer.concat(run.errors).toString());
});

test("win32 UNC share roots normalize canonically while drive and POSIX roots retain their slash", () => {
  const uncRoot = win32.resolve("//server/share");
  assert.equal(uncRoot, "\\\\server\\share\\");
  assert.equal(normalizePluginScopePath(uncRoot, win32.sep), "//server/share");
  assert.equal(normalizePluginScopePath(win32.resolve("//server/share/folder/.."), win32.sep), "//server/share");
  assert.equal(normalizePluginScopePath(win32.resolve("//server/share/folder/"), win32.sep), "//server/share/folder");
  assert.equal(normalizePluginScopePath(win32.resolve("X:/"), win32.sep), "X:/");
  assert.equal(normalizePluginScopePath(posix.resolve("/"), posix.sep), "/");
});

test("plugin clear confirmation is an optional host capability and central authorization still applies", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js" });
  const confirm = async () => true;
  run.dependencies.confirmPluginClear = confirm;
  let executed = false;
  run.dependencies.loadModule = async () => ({ default: { async execute(_request: unknown, context: OpBackendContext) {
    executed = true;
    assert.equal(context.confirmPluginClear, confirm);
  } } });
  assert.equal(await runOpCli(["plugin", "clear", "demo"], run.dependencies), 0);
  assert.ok(executed);
  executed = false;
  run.dependencies.loadModule = async () => ({ default: { async execute() { executed = true; } }, authorize: () => "deny" });
  assert.equal(await runOpCli(["plugin", "clear", "demo"], run.dependencies), 1);
  assert.equal(executed, false);
});

test("object plugin clearing requires confirmation unless force is explicit", async () => {
  const pluginSeed = JSON.stringify({ resources: { plugin: [{ id: "aws", name: "AWS", defaults: [{ id: "global", scope: { kind: "global" }, configuration: { credential: "synthetic-reference" } }] }] } });
  for (const approval of [undefined, false, true]) {
    const run = fixture({ "seed.json": pluginSeed }, { OP_BACKEND_FILE: "seed.json" });
    let confirmed = false;
    if (approval !== undefined) run.dependencies.confirmPluginClear = async (metadata: unknown) => {
      confirmed = true;
      assert.equal(JSON.stringify(metadata).includes("synthetic-reference"), false);
      assert.deepEqual(metadata, { pluginId: "aws", defaults: [{ id: "global", scope: { kind: "global" } }] });
      return approval;
    };
    const result = await runOpCli(["plugin", "clear", "aws"], run.dependencies);
    assert.equal(result, approval === true ? 0 : 1, Buffer.concat(run.errors).toString());
    assert.equal(confirmed, approval !== undefined);
    if (approval === undefined) assert.ok(Buffer.concat(run.errors).toString().toLowerCase().includes("confirm"));
    if (approval !== true) assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), pluginSeed);
    else {
      run.output.length = 0;
      assert.equal(await runOpCli(["plugin", "inspect", "aws", "--format=json"], run.dependencies), 0, Buffer.concat(run.errors).toString());
      assert.deepEqual(JSON.parse(Buffer.concat(run.output).toString()).defaults, []);
    }
  }
  const forced = fixture({ "seed.json": pluginSeed }, { OP_BACKEND_FILE: "seed.json" });
  forced.dependencies.confirmPluginClear = async () => { assert.fail("force must not ask for confirmation"); };
  assert.equal(await runOpCli(["plugin", "clear", "aws", "--force"], forced.dependencies), 0, Buffer.concat(forced.errors).toString());
  assert.deepEqual(decodeSnapshot(forced.fs.readFileSync("/work/seed.json", "utf8") as string).resources!.plugin[0]!.defaults, []);
});

test("authentication context is explicitly injected and bound before authorization", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js", OP_PLUGIN_SESSION_ID: "plugin-session" });
  const authentication = { terminalId: "trusted-terminal" };
  run.dependencies.authentication = authentication;
  run.dependencies.pluginScope = { terminalSession: "independent-plugin-session" };
  let authorized = false;
  run.dependencies.loadModule = async () => ({
    default: { async execute(_request: unknown, context: OpBackendContext) {
      assert.ok(authorized);
      assert.deepEqual(context.authentication, { terminalId: "trusted-terminal", integration: "manual" });
      assert.equal(context.pluginScope!.terminalSession, "independent-plugin-session");
      return [];
    } },
    authorize(_request, context) {
      assert.deepEqual(context.authentication, { terminalId: "trusted-terminal", integration: "manual" });
      authentication.terminalId = "changed-after-authorization";
      authorized = true;
      return "allow";
    },
  });
  assert.equal(await runOpCli(["vault", "list"], run.dependencies), 0, Buffer.concat(run.errors).toString());
});

test("authentication identity is never inferred from plugin or session environment metadata", async () => {
  const run = fixture({}, { OP_BACKEND_MODULE: "./backend.js", OP_PLUGIN_SESSION_ID: "plugin-env-session", OP_SESSION: "synthetic-manual-token" });
  run.dependencies.pluginScope = { terminalSession: "plugin-injected-session" };
  run.dependencies.loadModule = async () => ({ default: { async execute(_request: unknown, context: OpBackendContext) {
    assert.deepEqual(context.authentication, { integration: "manual" });
    assert.equal(context.pluginScope!.terminalSession, "plugin-injected-session");
    return [];
  } } });
  assert.equal(await runOpCli(["vault", "list"], run.dependencies), 0, Buffer.concat(run.errors).toString());
});

test("managed app authentication survives restart but requires explicit trusted terminal context", async () => {
  const now = Date.now();
  const managedSeed = JSON.stringify({ authentication: { mode: "managed" }, accounts: [{ id: "account" }], vaults: [{ id: "vault", name: "Work", account: "account" }], resources: { session: [{ id: "app", account: "account", mode: "app", terminalId: "trusted-terminal", issuedAt: now, lastActivityAt: now }] } });
  const run = fixture({ "seed.json": managedSeed }, { OP_BACKEND_FILE: "seed.json", OP_PLUGIN_SESSION_ID: "trusted-terminal" });
  run.dependencies.pluginScope = { terminalSession: "trusted-terminal" };
  assert.equal(await runOpCli(["vault", "list", "--account=account"], run.dependencies), 1);
  assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), managedSeed);
  run.dependencies.authentication = { terminalId: "trusted-terminal", integration: "app" };
  assert.equal(await runOpCli(["vault", "list", "--account=account", "--format=json"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  assert.equal(JSON.parse(Buffer.concat(run.output).toString())[0].id, "vault");
  run.dependencies.authentication = { terminalId: "different-terminal", integration: "app" };
  assert.equal(await runOpCli(["vault", "list", "--account=account"], run.dependencies), 1);
  run.dependencies.authentication = { terminalId: "trusted-terminal", integration: "app" };
  assert.equal(await runOpCli(["vault", "list", "--account=account"], run.dependencies), 0, Buffer.concat(run.errors).toString());
});

test("managed snapshot integration overrides are temporary and never inferred from app sessions", async () => {
  const now = Date.now();
  const managedSeed = JSON.stringify({ authentication: { mode: "managed" }, accounts: [{ id: "account" }], vaults: [{ id: "vault", name: "Work", account: "account" }], resources: { session: [{ id: "app", account: "account", mode: "app", terminalId: "trusted-terminal", issuedAt: now, lastActivityAt: now }] } });
  const run = fixture({ "seed.json": managedSeed }, { OP_BACKEND_FILE: "seed.json" });
  const args = ["vault", "list", "--account=account", "--format=json"];
  run.dependencies.authentication = { terminalId: "trusted-terminal" };
  assert.equal(await runOpCli(args, run.dependencies), 1);
  assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), managedSeed);
  run.dependencies.env!.OP_BIOMETRIC_UNLOCK_ENABLED = "true";
  assert.equal(await runOpCli(args, run.dependencies), 0, Buffer.concat(run.errors).toString());
  const persisted = run.fs.readFileSync("/work/seed.json", "utf8") as string;
  assert.deepEqual(decodeSnapshot(persisted).authentication, { mode: "managed" });
  delete run.dependencies.env!.OP_BIOMETRIC_UNLOCK_ENABLED;
  assert.equal(await runOpCli(args, run.dependencies), 1);
  assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), persisted);
  run.dependencies.authentication = { terminalId: "trusted-terminal", integration: "app" };
  run.dependencies.env!.OP_BIOMETRIC_UNLOCK_ENABLED = "false";
  assert.equal(await runOpCli(args, run.dependencies), 1);
  assert.equal(run.fs.readFileSync("/work/seed.json", "utf8"), persisted);
  delete run.dependencies.env!.OP_BIOMETRIC_UNLOCK_ENABLED;
  assert.equal(await runOpCli(args, run.dependencies), 0, Buffer.concat(run.errors).toString());
});

test("persisted app defaults remain below OP_ACCOUNT and explicit account flags across invocations", async () => {
  const now = Date.now();
  const accounts = ["primary", "secondary"];
  const managedSeed = JSON.stringify({
    authentication: { mode: "managed" },
    accounts: accounts.map(id => ({ id })),
    vaults: accounts.map(account => ({ id: `${account}-vault`, name: account, account })),
    resources: {
      session: accounts.map(account => ({ id: `${account}-app`, account, mode: "app", terminalId: "trusted-terminal", issuedAt: now, lastActivityAt: now })),
      "app default": [{ id: "app-selection", account: "primary" }],
      "session default": [{ id: "terminal-selection", account: "secondary", terminalId: "trusted-terminal" }],
    },
  });
  const run = fixture({ "seed.json": managedSeed }, { OP_BACKEND_FILE: "seed.json" });
  run.dependencies.authentication = { terminalId: "trusted-terminal", integration: "app" };
  for (const selection of [
    { env: undefined, flags: [], account: "primary" },
    { env: "secondary", flags: [], account: "secondary" },
    { env: "secondary", flags: ["--account=primary"], account: "primary" },
    { env: undefined, flags: [], account: "primary" },
  ]) {
    run.dependencies.env!.OP_ACCOUNT = selection.env;
    run.output.length = 0;
    assert.equal(await runOpCli(["vault", "list", "--format=json", ...selection.flags], run.dependencies), 0, Buffer.concat(run.errors).toString());
    assert.equal(JSON.parse(Buffer.concat(run.output).toString())[0].id, `${selection.account}-vault`);
    const snapshot = decodeSnapshot(run.fs.readFileSync("/work/seed.json", "utf8") as string);
    assert.deepEqual(snapshot.resources!["app default"], [{ id: "app-selection", account: "primary" }]);
    assert.deepEqual(snapshot.resources!["session default"], [{ id: "terminal-selection", account: "secondary", terminalId: "trusted-terminal" }]);
  }
  run.dependencies.authentication = { integration: "app" };
  assert.equal(await runOpCli(["vault", "list"], run.dependencies), 1);
});

test("explicit manual tokens work without terminal context across CLI invocations", async () => {
  const now = Date.now();
  const managedSeed = JSON.stringify({ authentication: { mode: "managed" }, accounts: [{ id: "account" }], vaults: [{ id: "vault", name: "Work", account: "account" }], resources: { session: [{ id: "manual", account: "account", mode: "manual", token: "synthetic-token", issuedAt: now, lastActivityAt: now }] } });
  const run = fixture({ "seed.json": managedSeed }, { OP_BACKEND_FILE: "seed.json" });
  for (const authentication of [undefined, { terminalId: "other-terminal" }]) {
    run.dependencies.authentication = authentication;
    assert.equal(await runOpCli(["vault", "list", "--account=account", "--session=synthetic-token"], run.dependencies), 0, Buffer.concat(run.errors).toString());
  }
});
