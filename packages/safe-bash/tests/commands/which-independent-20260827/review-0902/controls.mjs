import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.env.WHICH_CANDIDATE_ROOT;
assert.ok(root);
const load = relative => import(pathToFileURL(path.join(root, "dist", relative)).href);
const { createWhichCommand, whichCommands } = await load("commands/which/index.js");
const { MemoryFileSystem } = await load("fs/memory/index.js");
const { Shell } = await load("shell/shell.js");
const { FsError } = await load("contracts/index.js");
const encoder = new TextEncoder();
const transcript = [];
const capture = async operation => {
  try { return { kind: "return", value: await operation() }; }
  catch (reason) { return { kind: "throw", reason }; }
};
const setupShell = async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/a");
  await filesystem.writeFile("/a/tool", encoder.encode("not executed"), { mode: 0o755 });
  const shell = new Shell({ fs: filesystem, cwd: "/", env: { PATH: "/a" } });
  let dispatches = 0;
  shell.use(async (context, next) => { if (context.command === "which") dispatches++; return next(); });
  shell.use(whichCommands());
  shell.commands.register({ name: "registered-only", execute() { throw new Error("registry command must not execute during discovery"); } });
  return { shell, filesystem, dispatches: () => dispatches };
};

test("P01 original hyphenated declaration rejects before which dispatch", async () => {
  const { shell, dispatches } = await setupShell();
  try {
    for (const script of ["function-only() { true; }; which true registered-only function-only tool", "function-only() { true; }"]) {
      const result = await shell.exec(script);
      transcript.push({ id: "P01", script, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, dispatches: dispatches() });
      assert.equal(result.exitCode, 2);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /Invalid function name/);
      assert.equal(dispatches(), 0);
    }
  } finally { await shell.dispose(); }
});

test("P02 separately declared valid identifier tests intended discovery workflow", async () => {
  const { shell, filesystem, dispatches } = await setupShell();
  try {
    const script = "function_only() { true; }; which true registered-only function_only tool";
    const result = await shell.exec(script);
    transcript.push({ id: "P02", script, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, dispatches: dispatches() });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "/a/tool\n");
    assert.equal(result.stderr, "");
    assert.equal(dispatches(), 1);
    await filesystem.writeFile("/a/registered-only", encoder.encode("not a host executable"), { mode: 0o755 });
    const control = await shell.exec("which registered-only");
    transcript.push({ id: "P02-file", exitCode: control.exitCode, stdout: control.stdout, stderr: control.stderr });
    assert.equal(control.exitCode, 0);
    assert.equal(control.stdout, "/a/registered-only\n");
    assert.equal(control.stderr, "");
  } finally { await shell.dispose(); }
});

const contextFor = (filesystem, signal) => {
  const bytes = { stdout: [], stderr: [] };
  const context = { command: "which", args: ["tool"], cwd: "/", env: { PATH: "/a" }, fs: filesystem, signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error("unexpected stdin acquisition"); } },
    stdout: { async write(value) { bytes.stdout.push(Buffer.from(value)); } },
    stderr: { async write(value) { bytes.stderr.push(Buffer.from(value)); } } };
  return { context, bytes };
};
const stat = { type: "file", mode: 0o755, size: 0, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 };

for (const method of ["stat", "access"]) test(`${method === "stat" ? "P03" : "P04"} abort after successful ${method} suppresses later effects`, async () => {
  for (const reason of [Object.freeze({ after: method }), null, false, 0, -0, "", NaN, new FsError("ENOENT")]) {
    const controller = new AbortController();
    const calls = [];
    const filesystem = {
      async stat(filename, options) { calls.push("stat"); assert.equal(options.signal, controller.signal); if (method === "stat") controller.abort(reason); return stat; },
      async access(filename, mode, options) { calls.push("access"); assert.equal(mode, 1); assert.equal(options.signal, controller.signal); if (method === "access") controller.abort(reason); }
    };
    const { context, bytes } = contextFor(filesystem, controller.signal);
    const result = await capture(() => createWhichCommand().execute(context));
    assert.equal(result.kind, "throw");
    assert.ok(Object.is(result.reason, reason));
    assert.deepEqual(calls, method === "stat" ? ["stat"] : ["stat", "access"]);
    assert.deepEqual(bytes, { stdout: [], stderr: [] });
  }
});

test("P05 no capability or mode authority fallback", async () => {
  let accessCalls = 0;
  const filesystem = {
    get capabilities() { throw new Error("which must not gate on capability metadata"); },
    async stat() { return { ...stat, get mode() { throw new Error("which must not use reported mode as access authority"); } }; },
    async access() { accessCalls++; }
  };
  const { context, bytes } = contextFor(filesystem, new AbortController().signal);
  assert.equal((await createWhichCommand().execute(context)).exitCode, 0);
  assert.equal(accessCalls, 1);
  assert.equal(Buffer.concat(bytes.stdout).toString(), "/a/tool\n");
  assert.equal(bytes.stderr.length, 0);
});

test("P06 PATH/cwd captured once and same literal path passed to both methods", async () => {
  let pathReads = 0;
  let cwdReads = 0;
  const calls = [];
  const filesystem = {
    async stat(filename) { calls.push(["stat", filename]); return stat; },
    async access(filename, mode) { calls.push(["access", filename, mode]); }
  };
  const { context, bytes } = contextFor(filesystem, new AbortController().signal);
  context.args = ["-a", "tool", "tool"];
  context.env = { get PATH() { pathReads++; return ".:/a/"; } };
  Object.defineProperty(context, "cwd", { get() { cwdReads++; return "/virtual"; } });
  assert.equal((await createWhichCommand().execute(context)).exitCode, 0);
  assert.equal(pathReads, 1);
  assert.equal(cwdReads, 1);
  assert.deepEqual(calls, [...Array(2)].flatMap(() => [["stat", "/virtual/./tool"], ["access", "/virtual/./tool", 1], ["stat", "/a//tool"], ["access", "/a//tool", 1]]));
  assert.equal(Buffer.concat(bytes.stdout).toString(), "./tool\n/a//tool\n./tool\n/a//tool\n");
});

test.after(() => { console.log("WHICH_POSTFREEZE_TRANSCRIPT=" + JSON.stringify(transcript)); });
