import assert from "node:assert/strict";
import { test } from "node:test";
import { createOp, createObjectBackend, type EnvironmentCommandContext, type OpBackendRequest, type OpCommandContext, type OpCommandOptions } from "./index.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture(args: string[], source = "") {
  const controller = new AbortController();
  const effects: string[] = [];
  const requests: OpBackendRequest[] = [];
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context: OpCommandContext = {
    args, env: { TOKEN: "op://vault/item/password" }, signal: controller.signal,
    stdin: (async function* () { effects.push("stdin"); if (source) yield new TextEncoder().encode(source); })(),
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { errors.push(bytes.slice()); } },
    async readFile(path) { effects.push(`read:${path}`); return new TextEncoder().encode("TOKEN=op://vault/item/password"); },
    async writeFile(path) { effects.push(`write:${path}`); },
    async invoke(command) { effects.push(`spawn:${command}`); return { exitCode: 0 }; },
  };
  const backend = { async execute(request: OpBackendRequest) {
    effects.push("backend");
    requests.push(structuredClone(request));
    return request.resource === "environment" ? "KEY=environment-secret" : request.resource === "secret" ? "resolved-secret" : { id: "created" };
  } };
  return { context, backend, effects, requests, controller, output, errors };
}

function boundFixture(args: string[], source = "") {
  const run = fixture(args, source);
  const object = createObjectBackend({
    vaults: [{ id: "vault", name: "approved" }],
    items: ["item", "other"].map(id => ({ id, title: id, vault: "vault", fields: [{ id: "password", type: "CONCEALED", value: `${id}-secret` }] })),
  });
  const backend: OpCommandOptions["backend"] = {
    ...object,
    async execute(request, context) {
      assert.ok(context.binding);
      run.requests.push(structuredClone(request));
      return object.execute(request, context);
    },
  };
  return { ...run, backend, object };
}

const commands = [
  { name: "read", args: ["read", "op://vault/item/password", "--out-file", "output", "--force"], resource: "read", action: "" },
  { name: "inject", args: ["inject", "--in-file", "template", "--out-file", "output", "--force"], resource: "inject", action: "" },
  { name: "run", args: ["run", "--env-file", "dotenv", "--environment", "production", "--", "worker", "--flag"], resource: "run", action: "" },
  { name: "admin", args: ["vault", "user", "grant", "--vault", "vault", "--user", "alice", "--permissions", "view_items"], resource: "vault user", action: "grant" },
];

for (const command of commands) {
  for (const policy of ["deny", "ask-denied", "ask-missing"] as const) {
    test(`${command.name}: literal ${policy} prevents backend, file and spawn effects`, async () => {
      const run = fixture(command.args);
      let approvals = 0;
      const op = createOp({ backend: run.backend, approvalMode: "literal", channel: command.name === "run" ? "beta" : "stable", authorize: () => policy === "deny" ? "deny" : "ask", ...(policy === "ask-missing" ? {} : { approve: () => { approvals++; return false; } }) });
      assert.equal((await op.execute(run.context)).exitCode, 1);
      assert.deepEqual(run.effects.filter(effect => effect !== "stdin"), []);
      assert.equal(approvals, policy === "ask-denied" ? 1 : 0);
      assert.deepEqual(run.output, []);
    });
  }

  test(`${command.name}: literal approval sees the actual command and precedes effects`, async () => {
    const run = fixture(command.args);
    const seen: OpBackendRequest[] = [];
    const op = createOp({ backend: run.backend, approvalMode: "literal", channel: command.name === "run" ? "beta" : "stable", authorize: (request, context) => {
      assert.equal(context.signal, run.controller.signal);
      assert.equal(request.resource, command.resource);
      assert.equal(request.action, command.action);
      assert.equal(Object.hasOwn(request, "approved"), false);
      assert.equal(Object.hasOwn(request, "resolvedSecrets"), false);
      seen.push(request);
      return "ask";
    }, approve: request => {
      assert.equal(request, seen[0]);
      assert.deepEqual(run.effects.filter(effect => effect !== "stdin"), []);
      return true;
    } });
    assert.equal((await op.execute(run.context)).exitCode, 0);
    assert.equal(seen.length, 1);
    assert.ok(run.effects.includes("backend"));
    if (command.name === "read" || command.name === "inject") assert.ok(run.effects.includes("write:output"));
    if (command.name === "run") {
      assert.deepEqual(seen[0]!.args, ["worker", "--flag"]);
      assert.deepEqual(seen[0]!.flags["env-file"], ["dotenv"]);
      assert.deepEqual(seen[0]!.flags.environment, ["production"]);
      assert.ok(run.effects.includes("spawn:worker"));
    }
  });
}

for (const [command, pending] of commands.flatMap(command => (["authorize", "approve"] as const).map(pending => [command, pending] as const))) {
  test(`${command.name}: cancellation settles while ${pending} is pending and late permission has no effects`, async () => {
    const run = fixture(command.args);
    const entered = deferred<void>();
    const permission = deferred<boolean>();
    const options: OpCommandOptions = {
      backend: run.backend,
      approvalMode: "literal",
      channel: command.name === "run" ? "beta" : "stable",
      authorize: async () => {
        if (pending === "authorize") { entered.resolve(); await permission.promise; return "allow"; }
        return "ask";
      },
      approve: async () => { entered.resolve(); return permission.promise; },
    };
    const execution = createOp(options).execute(run.context);
    await Promise.race([entered.promise, execution.then(result => { throw new Error(`Command exited with code ${result.exitCode} before entering the permission callback`); })]);
    run.controller.abort(new Error("private-abort-reason"));
    let observed: { exitCode: number } | undefined;
    try {
      observed = await Promise.race([execution, new Promise<undefined>(resolve => setImmediate(() => resolve(undefined)))]);
    } finally {
      permission.resolve(true);
      await execution;
    }
    assert.deepEqual(observed, { exitCode: 130 }, "Cancellation must not wait for a host permission callback to settle");
    assert.deepEqual(run.effects.filter(effect => effect !== "stdin"), []);
    assert.equal(Buffer.concat(run.errors).toString().includes("private-abort-reason"), false);
  });
}

test("literal approval freezes arguments and flags without acquiring input", async () => {
  const run = fixture(["group", "edit", "group", "--name", "Approved"]);
  const op = createOp({ approvalMode: "literal", backend: run.backend, authorize: request => {
    assert.equal(Reflect.set(request, "action", "delete"), false);
    assert.equal(Reflect.set(request.args, "0", "other-group"), false);
    assert.equal(Reflect.set(request.flags, "name", "Changed"), false);
    assert.equal(request.input, undefined);
    assert.deepEqual(run.effects, []);
    return "ask";
  }, approve: () => true });
  assert.equal((await op.execute(run.context)).exitCode, 0);
  assert.equal(run.requests[0]!.action, "edit");
  const repeated = fixture(["run", "--env-file", "first", "--env-file", "second", "--", "worker"]);
  assert.equal((await createOp({ backend: repeated.backend, authorize: request => {
    assert.equal(Reflect.set(request.flags["env-file"] as readonly string[], "0", "different"), false);
    return "deny";
  } }).execute(repeated.context)).exitCode, 1);
});

test("resolved approval keeps nested JSON input private and freezes its prepared mutation", async () => {
  const run = boundFixture(["item", "create", "-", "--vault", "vault"], JSON.stringify({ title: "Created", category: "LOGIN", fields: [{ id: "password", value: "private-input-value" }] }));
  let plannedInput: { fields: { value: string }[] } | undefined;
  let approvals = 0;
  const backend: OpCommandOptions["backend"] = { ...run.backend, async prepareBinding(requests, context) {
    plannedInput = requests[0]!.input as typeof plannedInput;
    assert.ok(Object.isFrozen(plannedInput));
    return run.object.prepareBinding(requests, context);
  } };
  const execution = createOp({ backend, authorize: request => {
    assert.equal(request.input, undefined);
    assert.deepEqual(run.effects, []);
    return "ask";
  }, authorizeResolution: () => true, approveResolved: manifest => {
    approvals++;
    assert.equal(JSON.stringify(manifest).includes("private-input-value"), false);
    assert.equal(Reflect.set(plannedInput!.fields[0]!, "value", "changed"), false);
    return true;
  } });
  assert.equal((await execution.execute(run.context)).exitCode, 0, Buffer.concat(run.errors).toString());
  assert.equal(approvals, 1);
  assert.equal(run.object.snapshot().items!.find(item => item.title === "Created")!.fields!.find(field => field.id === "password")!.value, "private-input-value");
});

for (const operation of ["run", "inject"] as const) {
  test(`${operation}: caller environment mutation during approval cannot change the approved execution`, async () => {
    const run = boundFixture(operation === "run" ? ["run", "--", "worker"] : ["inject"], "{{ op://$VAULT/item/password }}");
    run.context.env = { VAULT: "approved", TOKEN: "op://approved/item/password" };
    const entered = deferred<void>();
    const permission = deferred<boolean>();
    const execution = createOp({ backend: run.backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: manifest => {
      assert.ok(manifest.targets.some(target => target.id === "item"));
      entered.resolve(); return permission.promise;
    } }).execute(run.context);
    await Promise.race([entered.promise, execution.then(result => { throw new Error(`Command exited with code ${result.exitCode} before entering the permission callback`); })]);
    run.context.env.VAULT = "unapproved";
    run.context.env.TOKEN = "op://unapproved/item/password";
    permission.resolve(true);
    assert.equal((await execution).exitCode, 0);
    assert.deepEqual(run.requests.map(request => request.args[0]), ["op://approved/item/password"]);
  });
}

test("denied public object-backed admin operation leaves the complete snapshot unchanged", async () => {
  const backend = createObjectBackend({ resources: { group: [{ id: "group", name: "Engineering" }] } });
  const before = backend.snapshot();
  const run = fixture(["group", "delete", "group"]);
  let approvals = 0;
  assert.equal((await createOp({ backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: () => { approvals++; return false; } }).execute(run.context)).exitCode, 1);
  assert.equal(approvals, 1);
  assert.deepEqual(backend.snapshot(), before);
});

test("one approved execution does not silently approve the next execution", async () => {
  let approvals = 0;
  const first = boundFixture(["read", "op://vault/item/password"]);
  const second = fixture(["read", "op://vault/other/password"]);
  const op = createOp({ backend: first.backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: manifest => {
    assert.ok(manifest.targets.some(target => target.id === (approvals === 0 ? "item" : "other")));
    return ++approvals === 1;
  } });
  assert.equal((await op.execute(first.context)).exitCode, 0);
  assert.equal((await op.execute(second.context)).exitCode, 1);
  assert.equal(approvals, 2);
  assert.equal(first.requests.length, 1);
});

for (const callback of ["authorize", "approve"] as const) {
  test(`${callback} callback failures do not expose private error text`, async () => {
    const run = fixture(["read", "op://vault/item/password"]);
    const options: OpCommandOptions = { backend: run.backend, approvalMode: "literal", authorize: () => "ask", approve: () => true, [callback]: () => { throw new Error("private-policy-token"); } };
    assert.equal((await createOp(options).execute(run.context)).exitCode, 1);
    assert.deepEqual(run.effects, []);
    assert.equal(Buffer.concat(run.errors).toString().includes("private-policy-token"), false);
  });
}

for (const args of [
  ["environment", "snapshot", "create", "dev", "--vars", "TOKEN"],
  ["environment", "snapshot", "get", "dev"],
  ["environment", "snapshot", "list"],
  ["environment", "snapshot", "delete", "dev"],
  ["environment", "snapshot", "restore", "dev"],
  ["environment", "snapshot", "restore", "dev", "--shell", "bash"],
  ["environment", "snapshot", "restore", "dev", "--", "worker"],
]) {
  test(`${args.join(" ")}: denied approval blocks storage, retrieval and restoration`, async () => {
    const run = fixture(args);
    const context: EnvironmentCommandContext = { ...run.context, async restoreEnvironment() { run.effects.push("restore"); } };
    let approvals = 0;
    const result = await createOp({ backend: run.backend, approvalMode: "literal", authorize: () => "ask", approve: request => {
      approvals++;
      assert.equal(request.resource, "environment snapshot");
      assert.equal(request.action, args[2]);
      return false;
    } }).execute(context);
    assert.equal(result.exitCode, 1);
    assert.equal(approvals, 1);
    assert.deepEqual(run.effects, []);
    assert.deepEqual(run.output, []);
  });
}

test("snapshot capture binds variable values at execution start while approval contains only selection metadata", async () => {
  const backend = createObjectBackend();
  const run = fixture(["environment", "snapshot", "create", "dev", "--vars", "TOKEN,ABSENT"]);
  run.context.env = { TOKEN: "approved-value", EXCLUDED: "excluded-secret" };
  const entered = deferred<void>();
  const permission = deferred<boolean>();
  const execution = createOp({ backend, authorize: request => {
    assert.equal(request.resource, "environment snapshot");
    assert.equal(request.action, "create");
    assert.deepEqual(request.args, ["dev"]);
    assert.deepEqual(request.flags.vars, ["TOKEN", "ABSENT"]);
    assert.equal(Object.isFrozen(request.flags.vars), true);
    assert.equal(request.input, undefined);
    assert.equal(JSON.stringify(request).includes("approved-value"), false);
    return "ask";
  }, authorizeResolution: () => true, approveResolved: manifest => {
    assert.deepEqual(manifest.operation, { resource: "environment snapshot", action: "create" });
    assert.equal(JSON.stringify(manifest).includes("approved-value"), false);
    assert.ok(Object.isFrozen(manifest));
    entered.resolve();
    return permission.promise;
  } }).execute(run.context);
  await Promise.race([entered.promise, execution.then(result => { throw new Error(`Command exited with code ${result.exitCode} before entering the permission callback`); })]);
  run.context.env.TOKEN = "unapproved-value";
  run.context.env.ABSENT = "new-value";
  permission.resolve(true);
  assert.equal((await execution).exitCode, 0);
  const stored = await backend.execute({ resource: "environment snapshot", action: "get", args: ["dev"], flags: {} }, { signal: run.controller.signal }) as { snapshot: { variables: unknown } };
  assert.deepEqual(stored.snapshot.variables, { TOKEN: "approved-value", ABSENT: null });
  assert.equal(Buffer.concat(run.output).toString().includes("approved-value"), false);
  assert.deepEqual(run.context.env, { TOKEN: "unapproved-value", ABSENT: "new-value", EXCLUDED: "excluded-secret" });
});

for (const mode of ["child", "shell"] as const) {
  test(`selected snapshot ${mode} restoration preserves unrelated variables appropriately across approval`, async () => {
    const backend = createObjectBackend({ resources: { "environment snapshot": [{ id: "snapshot", name: "dev", snapshot: { version: 1, scope: "selected", variables: { TOKEN: "restored" } } }] } });
    const run = fixture(["environment", "snapshot", "restore", "dev", ...(mode === "child" ? ["--", "worker"] : ["--shell", "bash"])]);
    run.context.env = { TOKEN: "before", PRESERVED: "approved" };
    let invokedEnvironment: Readonly<Record<string, string>> | undefined;
    run.context.invoke = async (_command, _args, options) => { invokedEnvironment = options.env; return { exitCode: 0 }; };
    const entered = deferred<void>();
    const permission = deferred<boolean>();
    const execution = createOp({ backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: manifest => {
      assert.ok(manifest.targets.some(target => target.id === "snapshot"));
      entered.resolve(); return permission.promise;
    } }).execute(run.context);
    await Promise.race([entered.promise, execution.then(result => { throw new Error(`Command exited with code ${result.exitCode} before entering the permission callback`); })]);
    run.context.env.PRESERVED = "unapproved";
    permission.resolve(true);
    assert.equal((await execution).exitCode, 0);
    if (mode === "child") assert.deepEqual(invokedEnvironment, { TOKEN: "restored", PRESERVED: "approved" });
    else {
      const script = Buffer.concat(run.output).toString();
      assert.equal(script, "export TOKEN='restored'\n");
      assert.equal(script.includes("unapproved"), false);
    }
    assert.deepEqual(run.context.env, { TOKEN: "before", PRESERVED: "unapproved" });
  });
}

test("approved snapshot restoration retains host capabilities without requiring context object identity", async () => {
  const stored = { version: 1 as const, scope: "selected" as const, variables: { TOKEN: "restored" } };
  const backend = createObjectBackend({ resources: { "environment snapshot": [{ id: "snapshot", name: "dev", snapshot: stored }] } });
  const run = fixture(["environment", "snapshot", "restore", "dev"]);
  let restores = 0;
  const context: EnvironmentCommandContext = { ...run.context, async restoreEnvironment(snapshot, operation) {
    restores++;
    assert.deepEqual(snapshot, stored);
    assert.equal(operation.signal, run.controller.signal);
  } };
  assert.equal((await createOp({ backend, authorize: () => "ask", authorizeResolution: () => true, approveResolved: manifest => {
    assert.ok(manifest.targets.some(target => target.id === "snapshot"));
    return true;
  } }).execute(context)).exitCode, 0);
  assert.equal(restores, 1);
  assert.deepEqual(run.context.env, { TOKEN: "op://vault/item/password" });
});
