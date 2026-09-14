import assert from "node:assert/strict";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { createOp, createObjectBackend, type OpBackend, type OpBackendRequest, type OpCommandContext } from "./index.js";

const encoder = new TextEncoder();

function fixture(args: readonly string[], env: Record<string, string> = {}, files: Record<string, string> = {}) {
  const fs = createFsFromVolume(Volume.fromJSON(files, "/work"));
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const reads: string[] = [];
  const invocations: { command: string; args: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
  const context: OpCommandContext = {
    args, env, signal: new AbortController().signal,
    stdin: (async function* () { yield new Uint8Array(); })(),
    stdout: { async write(data) { output.push(Uint8Array.from(data)); } },
    stderr: { async write(data) { errors.push(Uint8Array.from(data)); } },
    async readFile(path) { reads.push(path); return Uint8Array.from(await fs.promises.readFile(path) as Uint8Array); },
    async invoke(command, childArgs, options) { invocations.push({ command, args: childArgs, env: options.env }); return { exitCode: 17 }; }
  };
  return { context, reads, invocations, output: () => Buffer.concat(output).toString(), errors: () => Buffer.concat(errors).toString() };
}

test("public beta run composes with object environment read and preserves exact string values", async () => {
  const variables = Object.fromEntries([
    ["QUOTED", " 'single' and \"double\" "],
    ["MULTILINE", "first\nsecond\r\nthird\n"],
    ["EMPTY", ""],
    ["LITERAL", "${VAULT:-fallback} $VAULT $(not-executed) \\ # comment"],
    ["REFERENCE", "op://this/is/a-literal-value"],
    ["__proto__", "prototype-value"],
    ["constructor", "constructor-value"],
    ["toString", "string-value"]
  ]);
  const backend = createObjectBackend({ resources: { environment: [{ id: "prod", variables }] } });
  const run = fixture(["run", "--environment", "prod", "--", "worker", "--literal", "$LITERAL"], { VAULT: "inherited", KEEP: "keep" });
  assert.deepEqual(await backend.execute({ resource: "environment", action: "read", args: ["prod"], flags: {} }, { signal: run.context.signal }), variables);
  const result = await createOp({ channel: "beta", backend }).execute(run.context);
  assert.deepEqual(result, { exitCode: 17 }, run.errors());
  assert.deepEqual(run.invocations, [{ command: "worker", args: ["--literal", "$LITERAL"], env: { VAULT: "inherited", KEEP: "keep", ...variables } }]);
  assert.equal(Object.hasOwn(run.invocations[0]!.env, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(run.invocations[0]!.env), Object.prototype);
  assert.deepEqual(run.context.env, { VAULT: "inherited", KEEP: "keep" });
  assert.equal(run.output(), "");
});

test("public beta run applies later environments over later dotenv files and shell values", async () => {
  const backend = createObjectBackend({ resources: { environment: [
    { id: "first", variables: { TOKEN: "environment-first", ENV_ONLY: "retained" } },
    { id: "last", variables: { TOKEN: "environment-last", EMPTY: "" } }
  ] } });
  const requests: OpBackendRequest[] = [];
  const recording: OpBackend = { async execute(request, context) { requests.push(request); return backend.execute(request, context); } };
  const run = fixture(["run", "--env-file", "/work/first.env", "--env-file", "/work/last.env", "--environment", "first", "--environment", "last", "--", "worker"],
    { TOKEN: "op://missing/item/password", SHELL_ONLY: "shell", FILE_ONLY: "shell", EMPTY: "shell" },
    { "first.env": "TOKEN=op://also-missing/item/password\nFILE_ONLY=first\n", "last.env": "FILE_ONLY=last\nEMPTY=file\n" });
  const result = await createOp({ channel: "beta", backend: recording }).execute(run.context);
  assert.deepEqual(result, { exitCode: 17 }, run.errors());
  assert.deepEqual(run.invocations[0]?.env, { TOKEN: "environment-last", SHELL_ONLY: "shell", FILE_ONLY: "last", ENV_ONLY: "retained", EMPTY: "" });
  assert.deepEqual(run.reads, ["/work/first.env", "/work/last.env"]);
  assert.deepEqual(requests.map(request => [request.resource, request.action, request.args]), [["environment", "read", ["first"]], ["environment", "read", ["last"]]]);
});

test("public beta run masks object environment values across byte chunks on both streams", async () => {
  const secret = "sëcret\nwith-quotes'\"";
  const backend = createObjectBackend({ resources: { environment: [{ id: "prod", variables: { TOKEN: secret, EMPTY: "" } }] } });
  const run = fixture(["run", "--environment", "prod", "--", "worker"]);
  run.context.invoke = async (_command, _args, options) => {
    assert.equal(options.env.TOKEN, secret);
    for (const byte of encoder.encode("before " + secret + " after")) await options.stdout!.write(new Uint8Array([byte]));
    await options.stderr!.write(encoder.encode(secret.slice(0, 3)));
    await options.stderr!.write(encoder.encode(secret.slice(3)));
    return { exitCode: 9 };
  };
  assert.deepEqual(await createOp({ channel: "beta", backend }).execute(run.context), { exitCode: 9 }, run.errors());
  assert.equal(run.output(), "before <concealed by 1Password> after");
  assert.equal(run.errors(), "<concealed by 1Password>");
});

test("public beta run honors explicit no-masking for object environment values", async () => {
  const backend = createObjectBackend({ resources: { environment: [{ id: "prod", variables: { TOKEN: "plain-secret" } }] } });
  const run = fixture(["run", "--environment", "prod", "--no-masking", "--", "worker"]);
  run.context.invoke = async (_command, _args, options) => { await options.stdout!.write(encoder.encode(options.env.TOKEN!)); return { exitCode: 0 }; };
  assert.deepEqual(await createOp({ channel: "beta", backend }).execute(run.context), { exitCode: 0 }, run.errors());
  assert.equal(run.output(), "plain-secret");
});

test("public beta run validates every record value before invoking a child", async () => {
  for (const invalid of [undefined, null, false, 0, ["text"], { value: "text" }, new Uint8Array([1])]) {
    const run = fixture(["run", "--environment", "prod", "--", "worker"]);
    const backend: OpBackend = { async execute() { return { VALID: "must-not-be-output", INVALID: invalid }; } };
    assert.equal((await createOp({ channel: "beta", backend }).execute(run.context)).exitCode, 1);
    assert.deepEqual(run.invocations, []);
    assert.equal(run.output(), "");
    assert.equal(run.errors().includes("must-not-be-output"), false);
  }
});

test("public beta run rejects non-record non-dotenv backend results", async () => {
  for (const invalid of [undefined, null, false, 0, ["text"], new Uint8Array([1])]) {
    const run = fixture(["run", "--environment", "prod", "--", "worker"]);
    const backend: OpBackend = { async execute() { return invalid; } };
    assert.equal((await createOp({ channel: "beta", backend }).execute(run.context)).exitCode, 1);
    assert.deepEqual(run.invocations, []);
    assert.equal(run.output(), "");
  }
});

test("public beta run accepts empty and null-prototype string records", async () => {
  for (const variables of [{}, Object.assign(Object.create(null) as Record<string, string>, { TOKEN: "literal-value", EMPTY: "" })]) {
    const run = fixture(["run", "--environment", "prod", "--", "worker"], { KEEP: "shell" });
    const backend: OpBackend = { async execute() { return variables; } };
    assert.deepEqual(await createOp({ channel: "beta", backend }).execute(run.context), { exitCode: 17 }, run.errors());
    assert.deepEqual(run.invocations[0]?.env, { KEEP: "shell", ...variables });
  }
});

test("public beta run preserves custom backend dotenv text compatibility and masking", async () => {
  const run = fixture(["run", "--environment", "legacy", "--", "worker"], { TOKEN: "shell" });
  const backend: OpBackend = { async execute(request) {
    assert.deepEqual([request.resource, request.action, request.args], ["environment", "read", ["legacy"]]);
    return 'TOKEN="legacy-secret"\nQUOTED=\'a "quote"\'\nMULTI="first\nsecond"\nEMPTY=\n';
  } };
  run.context.invoke = async (_command, _args, options) => {
    assert.deepEqual(options.env, { TOKEN: "legacy-secret", QUOTED: 'a "quote"', MULTI: "first\nsecond", EMPTY: "" });
    await options.stdout!.write(encoder.encode("legacy-"));
    await options.stdout!.write(encoder.encode("secret"));
    return { exitCode: 0 };
  };
  assert.deepEqual(await createOp({ channel: "beta", backend }).execute(run.context), { exitCode: 0 }, run.errors());
  assert.equal(run.output(), "<concealed by 1Password>");
});

test("public beta run literal approval denial prevents environment reads, dotenv IO, and child invocation", async () => {
  for (const decision of ["deny", "ask"] as const) {
    const run = fixture(["run", "--env-file", "/work/input.env", "--environment", "prod", "--", "worker"], {}, { "input.env": "TOKEN=file\n" });
    let calls = 0;
    const backend: OpBackend = { async execute() { calls++; return { TOKEN: "secret" }; } };
    let approved = false;
    const command = createOp({ channel: "beta", backend, approvalMode: "literal", authorize: () => decision, approve: () => { approved = true; return false; } });
    assert.equal((await command.execute(run.context)).exitCode, 1);
    assert.equal(approved, decision === "ask");
    assert.equal(calls, 0);
    assert.deepEqual(run.reads, []);
    assert.deepEqual(run.invocations, []);
    assert.equal(run.output(), "");
  }
});
