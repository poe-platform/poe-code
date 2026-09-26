import assert from "node:assert/strict";
import { test } from "node:test";
import { createOp, createObjectBackend } from "./index.js";
import { createEnvironmentHandlers, type EnvironmentCommandContext } from "./environment-commands.js";
import type { OpBackendRequest } from "./types.js";

function fixture(env: Record<string, string> = {}) {
  const output: Uint8Array[] = [];
  const context: EnvironmentCommandContext = {
    args: [], env, signal: new AbortController().signal,
    stdin: (async function* () { yield new Uint8Array(); })(),
    stdout: { async write(chunk) { output.push(chunk.slice()); } },
    stderr: { async write() {} },
  };
  return { context, output };
}

const request = (action: string, args: readonly string[] = [], flags: OpBackendRequest["flags"] = {}): OpBackendRequest => ({ resource: "environment snapshot", action, args, flags });

test("capture stores values but returns only metadata, and retrieve returns exact snapshot", async () => {
  const backend = createObjectBackend();
  const handlers = createEnvironmentHandlers(backend);
  const capture = fixture({ TOKEN: "synthetic-secret", EMPTY: "" });
  await handlers["environment snapshot create"](request("create", ["dev"]), capture.context);
  assert.ok(!Buffer.concat(capture.output).toString().includes("synthetic-secret"));
  const get = fixture();
  await handlers["environment snapshot get"](request("get", ["dev"]), get.context);
  assert.deepEqual(JSON.parse(Buffer.concat(get.output).toString()).snapshot.variables, { TOKEN: "synthetic-secret", EMPTY: "" });
});

test("restore requires an explicit host capability and never pretends to change a parent shell", async () => {
  const handlers = createEnvironmentHandlers(createObjectBackend());
  await handlers["environment snapshot create"](request("create", ["dev"]), fixture({ TOKEN: "old" }).context);
  const restore = fixture({ TOKEN: "new" });
  await assert.rejects(handlers["environment snapshot restore"](request("restore", ["dev"]), restore.context));
  assert.deepEqual(restore.context.env, { TOKEN: "new" });
  let called = false;
  restore.context.restoreEnvironment = async (snapshot) => { called = true; assert.equal(snapshot.variables.TOKEN, "old"); };
  await handlers["environment snapshot restore"](request("restore", ["dev"]), restore.context);
  assert.equal(called, true);
});

test("restored child gets exact snapshot while caller environment is untouched", async () => {
  const handlers = createEnvironmentHandlers(createObjectBackend());
  await handlers["environment snapshot create"](request("create", ["dev"]), fixture({ VALUE: "before" }).context);
  const run = fixture({ VALUE: "after", EXTRA: "new" });
  run.context.invoke = async (command, args, options) => {
    assert.equal(command, "child");
    assert.deepEqual(args, ["--help"]);
    assert.deepEqual(options.env, { VALUE: "before" });
    return { exitCode: 7 };
  };
  assert.deepEqual(await handlers["environment snapshot restore"](request("restore", ["dev", "child", "--help"]), run.context), { exitCode: 7 });
  assert.deepEqual(run.context.env, { VALUE: "after", EXTRA: "new" });
});

test("restored child output masks captured values across chunks", async () => {
  const handlers = createEnvironmentHandlers(createObjectBackend());
  await handlers["environment snapshot create"](request("create", ["dev"]), fixture({ TOKEN: "synthetic-secret" }).context);
  const run = fixture();
  run.context.invoke = async (_command, _args, options) => {
    await (options.stdout ?? run.context.stdout).write(new TextEncoder().encode("synthetic-"));
    await (options.stdout ?? run.context.stdout).write(new TextEncoder().encode("secret"));
    return { exitCode: 0 };
  };
  await handlers["environment snapshot restore"](request("restore", ["dev", "child"]), run.context);
  const output = Buffer.concat(run.output).toString();
  assert.ok(!output.includes("synthetic-secret"));
  assert.ok(output.includes("concealed"));
});

test("restored child can explicitly disable output masking", async () => {
  const handlers = createEnvironmentHandlers(createObjectBackend());
  await handlers["environment snapshot create"](request("create", ["dev"]), fixture({ TOKEN: "synthetic-secret" }).context);
  const run = fixture();
  run.context.invoke = async (_command, _args, options) => {
    await (options.stdout ?? run.context.stdout).write(new TextEncoder().encode(options.env.TOKEN));
    return { exitCode: 0 };
  };
  await handlers["environment snapshot restore"](request("restore", ["dev", "child"], { "no-masking": true }), run.context);
  assert.equal(Buffer.concat(run.output).toString(), "synthetic-secret");
});

test("restoration observes cancellation even when an unmasked child returns success", async () => {
  const handlers = createEnvironmentHandlers(createObjectBackend());
  await handlers["environment snapshot create"](request("create", ["dev"]), fixture().context);
  const run = fixture();
  const controller = new AbortController();
  run.context.signal = controller.signal;
  run.context.invoke = async () => { controller.abort(new Error("cancelled")); return { exitCode: 0 }; };
  await assert.rejects(handlers["environment snapshot restore"](request("restore", ["dev", "child"], { "no-masking": true }), run.context));
});

test("shell restoration quotes literal values and removes newly introduced variables", async () => {
  const handlers = createEnvironmentHandlers(createObjectBackend());
  await handlers["environment snapshot create"](request("create", ["dev"]), fixture({ VALUE: "'$(nope)\n" }).context);
  const run = fixture({ EXTRA: "remove" });
  await handlers["environment snapshot restore"](request("restore", ["dev"], { shell: "bash" }), run.context);
  const script = Buffer.concat(run.output).toString();
  assert.ok(script.includes("unset EXTRA"));
  assert.ok(script.includes("export VALUE='"));
  assert.ok(script.includes("'\\''"));
});

for (const shell of ["bash", "zsh", "sh", "fish", "powershell"]) {
  test(`${shell} selected restoration emits only snapshot variables`, async () => {
    const handlers = createEnvironmentHandlers(createObjectBackend());
    await handlers["environment snapshot create"](request("create", ["dev"], { vars: ["VALUE"] }), fixture({ VALUE: "saved" }).context);
    const run = fixture({ VALUE: "changed", UNRELATED: "private-current-secret" });
    await handlers["environment snapshot restore"](request("restore", ["dev"], { shell }), run.context);
    const expected = shell === "fish" ? "set -gx VALUE 'saved'\n" : shell === "powershell" ? "$env:VALUE = 'saved'\n" : "export VALUE='saved'\n";
    assert.equal(Buffer.concat(run.output).toString(), expected);
    assert.deepEqual(run.context.env, { VALUE: "changed", UNRELATED: "private-current-secret" });
  });

  test(`${shell} selected restoration explicitly unsets absent snapshot keys`, async () => {
    const handlers = createEnvironmentHandlers(createObjectBackend());
    await handlers["environment snapshot create"](request("create", ["dev"], { vars: ["ABSENT"] }), fixture().context);
    const run = fixture();
    await handlers["environment snapshot restore"](request("restore", ["dev"], { shell }), run.context);
    const expected = shell === "fish" ? "set -e ABSENT\n" : shell === "powershell" ? "Remove-Item Env:ABSENT -ErrorAction SilentlyContinue\n" : "unset ABSENT\n";
    assert.equal(Buffer.concat(run.output).toString(), expected);
  });
}

test("empty selected shell restoration ignores unrelated non-shell variable names", async () => {
  const handlers = createEnvironmentHandlers(createObjectBackend());
  await handlers["environment snapshot create"](request("create", ["dev"], { vars: [] }), fixture().context);
  const run = fixture({ "NOT-A-SHELL-NAME": "private-current-secret" });
  await handlers["environment snapshot restore"](request("restore", ["dev"], { shell: "bash" }), run.context);
  assert.equal(Buffer.concat(run.output).toString().trim(), "");
});

test("approval denial prevents environment capture and restoration", async () => {
  let calls = 0;
  const command = createOp({ backend: { async execute() { calls++; } }, authorize: () => "deny" });
  for (const args of [["environment", "snapshot", "create", "dev"], ["environment", "snapshot", "restore", "dev"]]) {
    const run = fixture({ TOKEN: "synthetic-secret" });
    run.context.args = args;
    assert.equal((await command.execute(run.context)).exitCode, 1);
    assert.equal(run.output.length, 0);
  }
  assert.equal(calls, 0);
});

test("public CLI and SDK route capture, retrieval, listing and restoration", async () => {
  const command = createOp({ backend: createObjectBackend() });
  const capture = fixture({ VALUE: "saved", UNRELATED: "skip" });
  capture.context.args = ["environment", "snapshot", "create", "dev", "--vars=VALUE,ABSENT"];
  assert.equal((await command.execute(capture.context)).exitCode, 0);
  for (const action of ["get", "list"]) {
    const run = fixture();
    run.context.args = ["environment", "snapshot", action, ...(action === "get" ? ["dev"] : [])];
    assert.equal((await command.execute(run.context)).exitCode, 0);
    assert.ok(Buffer.concat(run.output).toString().includes("dev"));
  }
  const restore = fixture({ VALUE: "changed", ABSENT: "remove", OTHER: "keep" });
  restore.context.args = ["environment", "snapshot", "restore", "dev"];
  let restored = false;
  restore.context.restoreEnvironment = async (snapshot) => {
    restored = true;
    assert.deepEqual(snapshot.variables, { VALUE: "saved", ABSENT: null });
  };
  assert.equal((await command.execute(restore.context)).exitCode, 0);
  assert.equal(restored, true);
});
