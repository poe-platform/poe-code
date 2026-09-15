import assert from "node:assert/strict";
import { test } from "node:test";
import { createFsFromVolume, Volume } from "memfs";
import { createOp, createObjectBackend, type OpBackend, type OpCommandContext, type OpResolvedApproval } from "./index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture(args: string[]) {
  const fs = createFsFromVolume(Volume.fromJSON({
    "/config": "{{ op://Private/Login/password }}",
    "/env": "TOKEN=op://Private/Login/password\n",
    "/template": JSON.stringify({ title: "Created", category: "LOGIN", fields: [{ id: "password", type: "CONCEALED", value: "synthetic-template-secret" }] }),
  }));
  fs.writeFileSync("/binary", new Uint8Array([0, 255, 128, 10]));
  const object = createObjectBackend({
    vaults: [{ id: "vault", name: "Private" }],
    items: [{ id: "item", title: "Login", vault: "vault", category: "LOGIN", sections: [{ id: "section", label: "Section" }], fields: [
      { id: "password", label: "password", type: "CONCEALED", value: "synthetic-secret" },
      { id: "custom", label: "custom", type: "STRING", value: "synthetic-custom", section: { id: "section" } },
    ] }],
    resources: {
      environment: [{ id: "environment", variables: { REMOTE: "synthetic-remote" } }],
      "environment snapshot": [{ id: "snapshot", name: "Saved", snapshot: { version: 1, scope: "selected", variables: { RESTORED: "synthetic-restored", ABSENT: null } } }],
    },
  });
  const effects: string[] = [];
  let output = "";
  let errors = "";
  let invoked: Readonly<Record<string, string>> | undefined;
  const controller = new AbortController();
  const backend: OpBackend = {
    async execute(request, context) { effects.push(`execute:${request.resource}/${request.action}`); return object.execute(request, context); },
    async prepareBinding(requests, context) { effects.push("prepare"); return object.prepareBinding(requests, context); },
    validateBinding(handle, context) { return object.validateBinding(handle, context); },
    cancelBinding(handle) { effects.push("cancel"); object.cancelBinding(handle); },
  };
  const context: OpCommandContext = {
    args, env: { CAPTURED: "synthetic-captured" }, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { effects.push("stdin"); yield new Uint8Array(); } },
    stdout: { async write(bytes) { effects.push("stdout"); output += Buffer.from(bytes); } },
    stderr: { async write(bytes) { errors += Buffer.from(bytes); } },
    async readFile(path) { effects.push(`read:${path}`); return fs.promises.readFile(path) as Promise<Buffer>; },
    async writeFile(path, bytes) { effects.push(`write:${path}`); await fs.promises.writeFile(path, bytes); },
    async invoke(command, _args, options) { effects.push(`invoke:${command}`); invoked = options.env; return { exitCode: 0 }; },
  };
  return { fs, object, backend, context, effects, controller, output: () => output, errors: () => errors, invoked: () => invoked };
}

const operations = [
  { name: "read", args: ["read", "op://Private/Login/password", "--out-file=/output"] },
  { name: "inject", args: ["inject", "--in-file=/config", "--out-file=/output"] },
  { name: "run", args: ["run", "--env-file=/env", "--environment=environment", "--", "child", "synthetic-argument"] },
  { name: "item", args: ["item", "create", "--template=/template", "--vault=Private", "payload[file]=/binary"] },
  { name: "document", args: ["document", "create", "/binary", "--vault=Private"] },
  { name: "snapshot-create", args: ["environment", "snapshot", "create", "New", "--vars=CAPTURED"] },
  { name: "snapshot-restore", args: ["environment", "snapshot", "restore", "Saved", "--", "child"] },
];

for (const operation of operations) {
  test(`independent resolved ${operation.name}: preparation has no execution effects; approved execution uses captured sources`, async () => {
    const run = fixture(operation.args);
    const entered = deferred<OpResolvedApproval>();
    const permission = deferred<boolean>();
    const before = run.object.snapshot();
    const command = createOp({ backend: run.backend, channel: "beta", authorize: () => "ask", authorizeResolution: () => true, approveResolved(manifest) { entered.resolve(manifest); return permission.promise; } });
    const pending = command.execute(run.context);
    try {
      const manifest = await Promise.race([entered.promise, pending.then(result => { throw new Error(`Ended before approval: ${result.exitCode}; ${run.errors()}`); })]);
      assert.equal(run.effects.filter(effect => effect === "prepare").length, 1);
      assert.ok(run.effects.every(effect => effect === "prepare" || effect === "stdin" || effect.startsWith("read:")));
      assert.deepEqual(run.object.snapshot(), before);
      assert.equal(run.output(), "");
      assert.equal(run.fs.existsSync("/output"), false);
      assert.equal(run.invoked(), undefined);
      const serialized = JSON.stringify(manifest);
      for (const marker of ["synthetic-secret", "synthetic-template-secret", "synthetic-remote", "synthetic-restored", "synthetic-captured", "synthetic-argument"]) assert.equal(serialized.includes(marker), false, marker);
      assert.ok(Object.isFrozen(manifest));
      run.context.env.CAPTURED = "replacement";
      run.fs.writeFileSync("/config", "unapproved-template");
      run.fs.writeFileSync("/env", "TOKEN=unapproved-env");
      run.fs.writeFileSync("/template", "invalid JSON");
      run.fs.writeFileSync("/binary", new Uint8Array([8]));
    } finally { permission.resolve(true); await pending; }
    assert.equal((await pending).exitCode, 0, run.errors());
    assert.ok(run.effects.includes("cancel"));
    if (operation.name === "read" || operation.name === "inject") assert.equal(run.fs.readFileSync("/output", "utf8"), "synthetic-secret");
    if (operation.name === "run") assert.deepEqual(run.invoked(), { CAPTURED: "synthetic-captured", TOKEN: "synthetic-secret", REMOTE: "synthetic-remote" });
    if (operation.name === "snapshot-restore") assert.deepEqual(run.invoked(), { CAPTURED: "synthetic-captured", RESTORED: "synthetic-restored" });
    if (operation.name === "document") assert.deepEqual(run.object.snapshot().documents?.[0]?.content, new Uint8Array([0, 255, 128, 10]));
    if (operation.name === "item") {
      const created = run.object.snapshot().items!.find(item => item.title === "Created")!;
      assert.equal(created.fields?.find(field => field.id === "password")?.value, "synthetic-template-secret");
      assert.deepEqual(created.files?.[0]?.content, new Uint8Array([0, 255, 128, 10]));
    }
  });
}

for (const stage of ["initial", "resolution", "final"] as const) {
  test(`independent resolved ${stage} denial never fetches secrets or writes output`, async () => {
    const run = fixture(["inject", "--in-file=/config", "--out-file=/output"]);
    const before = run.object.snapshot();
    const callbacks: string[] = [];
    const command = createOp({ backend: run.backend,
      authorize() { callbacks.push("authorize"); return stage === "initial" ? "deny" : "ask"; },
      authorizeResolution() { callbacks.push("resolution"); return stage !== "resolution"; },
      approveResolved() { callbacks.push("resolved"); return false; },
    });
    assert.equal((await command.execute(run.context)).exitCode, 1);
    assert.deepEqual(callbacks, stage === "initial" ? ["authorize"] : stage === "resolution" ? ["authorize", "resolution"] : ["authorize", "resolution", "resolved"]);
    if (stage !== "final") assert.deepEqual(run.effects, []);
    else assert.deepEqual(run.effects, ["read:/config", "prepare", "cancel"]);
    assert.deepEqual(run.object.snapshot(), before);
    assert.equal(run.output(), "");
    assert.equal(run.fs.existsSync("/output"), false);
    assert.equal(run.errors().includes("synthetic-secret"), false);
  });
}

test("independent resolved execution rejects a changed field after approval metadata preparation", async () => {
  const run = fixture(["read", "op://Private/Login/Section/custom", "--out-file=/output"]);
  const entered = deferred<void>();
  const permission = deferred<boolean>();
  const pending = createOp({ backend: run.backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved() { entered.resolve(); return permission.promise; } }).execute(run.context);
  try {
    await Promise.race([entered.promise, pending.then(() => assert.fail(`Ended before approval: ${run.errors()}`))]);
    await run.object.execute({ resource: "item", action: "edit", args: ["item", "Section.custom=replacement"], flags: {} }, { signal: run.context.signal });
  } finally { permission.resolve(true); await pending; }
  assert.equal((await pending).exitCode, 1);
  assert.ok(!run.effects.some(effect => effect.startsWith("execute:")));
  assert.equal(run.fs.existsSync("/output"), false);
  assert.equal(run.output(), "");
});

test("independent execute-only backends fail resolved ask before input or fallback execution", async () => {
  const run = fixture(["inject", "--in-file=/config"]);
  const command = createOp({ backend: { async execute() { assert.fail("unexpected backend execution"); } }, authorize: () => "ask", authorizeResolution: () => true, approveResolved: () => true, approve: () => { assert.fail("implicit literal fallback"); } });
  assert.equal((await command.execute(run.context)).exitCode, 1);
  assert.deepEqual(run.effects, []);
});

test("independent nested inject reads never release mixed-version output", async () => {
  const run = fixture(["inject", "--in-file=/config", "--out-file=/output"]);
  run.fs.writeFileSync("/config", "{{ op://Private/Login/password }} {{ op://Private/Login/Section/custom }}");
  const entered = deferred<void>();
  const resume = deferred<void>();
  const execute = run.backend.execute;
  let reads = 0;
  run.backend.execute = async (request, context) => {
    const value = await execute(request, context);
    if (request.resource === "secret" && ++reads === 1) { entered.resolve(); await resume.promise; }
    return value;
  };
  const pending = createOp({ backend: run.backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: () => true }).execute(run.context);
  try {
    await Promise.race([entered.promise, pending.then(() => assert.fail(`Ended before first read: ${run.errors()}`))]);
    assert.equal(run.output(), "");
    assert.equal(run.fs.existsSync("/output"), false);
    await run.object.execute({ resource: "item", action: "edit", args: ["item", "Section.custom=changed"], flags: {} }, { signal: run.context.signal });
  } finally { resume.resolve(); await pending; }
  assert.equal((await pending).exitCode, 1);
  assert.equal(run.output(), "");
  assert.equal(run.fs.existsSync("/output"), false);
  assert.equal(run.errors().includes("synthetic-secret"), false);
});

test("independent managed session revocation during approval blocks secret execution", async () => {
  const now = Date.now();
  const backend = createObjectBackend({
    authentication: { mode: "managed" }, accounts: [{ id: "account" }],
    vaults: [{ id: "vault", name: "Private", account: "account" }],
    items: [{ id: "item", title: "Login", vault: "vault", account: "account", fields: [{ id: "password", value: "synthetic-secret" }] }],
    resources: { session: [{ id: "session", account: "account", mode: "manual", token: "synthetic-session-token", issuedAt: now, lastActivityAt: now }] },
  });
  const run = fixture(["read", "op://Private/Login/password", "--out-file=/output"]);
  run.context.env.OP_SESSION = "synthetic-session-token";
  const entered = deferred<OpResolvedApproval>();
  const permission = deferred<boolean>();
  let executions = 0;
  const watched: OpBackend = {
    prepareBinding: backend.prepareBinding.bind(backend), validateBinding: backend.validateBinding.bind(backend), cancelBinding: backend.cancelBinding.bind(backend),
    async execute(request, context) { executions++; return backend.execute(request, context); },
  };
  const pending = createOp({ backend: watched, authorize: () => "ask", authorizeResolution: () => true, approveResolved(manifest) { entered.resolve(manifest); return permission.promise; } }).execute(run.context);
  try {
    const manifest = await Promise.race([entered.promise, pending.then(() => { throw new Error(`Ended before approval: ${run.errors()}`); })]);
    assert.equal(JSON.stringify(manifest).includes("synthetic-session-token"), false);
    assert.equal(executions, 0);
    await backend.execute({ resource: "signout", action: "", args: [], flags: { session: "synthetic-session-token" } }, { signal: run.context.signal });
  } finally { permission.resolve(true); await pending; }
  assert.equal((await pending).exitCode, 1);
  assert.equal(executions, 0);
  assert.equal(run.fs.existsSync("/output"), false);
});

test("independent initial denial precedes implicit and explicit stdin acquisition", async () => {
  for (const args of [["item", "get"], ["item", "create", "-"]]) {
    const run = fixture(args);
    let authorizations = 0;
    const result = await createOp({ backend: run.backend, authorize() { authorizations++; return "deny"; } }).execute(run.context);
    assert.equal(result.exitCode, 1);
    assert.equal(authorizations, 1);
    assert.deepEqual(run.effects, []);
  }
});
