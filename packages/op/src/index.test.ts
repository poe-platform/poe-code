import assert from "node:assert/strict";
import { test } from "node:test";
import { createOp, createObjectBackend, type OpCommandContext, type OpConfirmOverwrite, type OpSelectPlugin } from "./index.js";
import type { OpConfirmOverwrite as NodeConfirmOverwrite } from "./node-host.js";

test("root entry point exposes the plugin selection capability contract", async () => {
  const callback: OpSelectPlugin = (candidates, context) => {
    assert.equal(context.accountId, null);
    assert.equal(context.signal.aborted, false);
    return candidates[0]?.id;
  };
  const context: OpCommandContext = { ...fixture(["plugin", "inspect"]).context, selectPlugin: callback };
  assert.equal(await context.selectPlugin!([{ id: "aws", name: "AWS" }], { signal: context.signal, accountId: null }), "aws");
});

test("root and Node entry points expose the same overwrite confirmation contract", async () => {
  const rootCallback: OpConfirmOverwrite = (intent, context) => intent.path === "/synthetic/output" && !context.signal.aborted;
  const nodeCallback: NodeConfirmOverwrite = rootCallback;
  const roundtrip: OpConfirmOverwrite = nodeCallback;
  assert.equal(await roundtrip({ path: "/synthetic/output" }, { signal: new AbortController().signal }), true);
});

function fixture(args: readonly string[]) {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context: OpCommandContext = {
    args,
    env: {},
    stdin: (async function* () { yield new Uint8Array(); })(),
    stdout: { async write(chunk) { output.push(chunk.slice()); } },
    stderr: { async write(chunk) { errors.push(chunk.slice()); } },
    signal: new AbortController().signal,
  };
  return { context, output, errors };
}

test("public plugin inspection selects scoped metadata before approving the bound target", async () => {
  const backend = createObjectBackend({ accounts: [{ id: "work" }, { id: "personal" }], resources: { plugin: [
    { id: "first", name: "Shared label", account: "work", configuration: { token: "unselected-private" } },
    { id: "chosen", name: "Shared label", account: "work", configuration: { token: "selected-private" } },
    { id: "foreign", name: "Foreign", account: "personal" },
  ] } });
  const run = fixture(["plugin", "info", "--account", "work", "--format", "json"]);
  const stages: string[] = [];
  run.context.selectPlugin = (candidates, context) => {
    stages.push("select");
    assert.equal(candidates.length, 91);
    assert.deepEqual(candidates.slice(-2), [{ id: "first", name: "Shared label" }, { id: "chosen", name: "Shared label" }]);
    assert.deepEqual(candidates.find(candidate => candidate.id === "aws"), { id: "aws", name: "AWS" });
    assert.equal(candidates.some(candidate => candidate.id === "foreign"), false);
    assert.ok(candidates.every(candidate => Object.keys(candidate).sort().join(",") === "id,name"));
    assert.ok(Object.isFrozen(candidates) && candidates.every(Object.isFrozen));
    assert.ok(Object.isFrozen(context));
    assert.equal(context.accountId, "work");
    assert.equal(context.signal, run.context.signal);
    assert.equal(run.output.length, 0);
    return "chosen";
  };
  const result = await createOp({ backend, authorize(request) {
    stages.push("authorize");
    assert.equal(request.action, "inspect");
    assert.deepEqual(request.args, []);
    return "ask";
  }, authorizeResolution() { stages.push("resolution"); return true; }, approveResolved(manifest) {
    stages.push("approve");
    assert.equal(manifest.accountId, "work");
    assert.deepEqual(manifest.targets.filter(target => target.resource === "plugin").map(target => target.id), ["chosen"]);
    assert.equal(JSON.stringify(manifest).includes("selected-private"), false);
    assert.equal(run.output.length, 0);
    return true;
  } }).execute(run.context);
  assert.deepEqual(stages, ["authorize", "resolution", "select", "approve"]);
  assert.equal(result.exitCode, 0, Buffer.concat(run.errors).toString());
  assert.equal(JSON.parse(Buffer.concat(run.output).toString()).id, "chosen");
});

test("public plugin selection cannot run before either permission gate", async () => {
  for (const denyAt of ["authorize", "resolution"] as const) {
    const stages: string[] = [];
    const run = fixture(["plugin", "inspect"]);
    run.context.selectPlugin = () => { assert.fail("Selection must not run after denial"); };
    const result = await createOp({ backend: createObjectBackend({ resources: { plugin: [{ id: "only" }] } }),
      authorize() { stages.push("authorize"); return denyAt === "authorize" ? "deny" : "ask"; },
      authorizeResolution() { stages.push("resolution"); return false; },
      approveResolved() { assert.fail("Final approval must not run after denial"); },
    }).execute(run.context);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(stages, denyAt === "authorize" ? ["authorize"] : ["authorize", "resolution"]);
    assert.equal(run.output.length, 0);
  }
});

test("public plugin selection rejects display labels and foreign IDs before final approval", async () => {
  for (const choice of ["Visible name", "foreign", undefined]) {
    const run = fixture(["plugin", "inspect", "--account", "work"]);
    let selections = 0;
    let offered: readonly Readonly<{ id: string; name: string }>[] = [];
    let returned = false;
    run.context.selectPlugin = candidates => {
      selections++;
      offered = candidates;
      returned = true;
      return choice;
    };
    const backend = createObjectBackend({ accounts: [{ id: "work" }, { id: "personal" }], resources: { plugin: [
      { id: "local", name: "Visible name", account: "work" },
      { id: "foreign", account: "personal" },
    ] } });
    const before = backend.snapshot();
    const result = await createOp({ backend, authorize: () => "ask", authorizeResolution: () => true,
      approveResolved() { assert.fail("Invalid or cancelled selection cannot reach final approval"); },
    }).execute(run.context);
    assert.equal(selections, 1);
    assert.equal(returned, true);
    assert.equal(offered.length, 90);
    assert.deepEqual(offered.at(-1), { id: "local", name: "Visible name" });
    assert.equal(offered.some(candidate => candidate.id === "foreign"), false);
    assert.ok(offered.every(candidate => Object.keys(candidate).sort().join(",") === "id,name"));
    assert.equal(result.exitCode, 1);
    assert.equal(run.output.length, 0);
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("object backend routes external capabilities only after host approval", async () => {
  for (const [name, args] of [
    ["item share", ["item", "share", "example", "--expires-in", "1h"]],
    ["update", ["update", "--directory", "/virtual/bin"]],
    ["plugin credential import", ["plugin", "credential", "import", "aws"]],
  ] as const) {
    const unavailable = fixture(args);
    assert.equal((await createOp({ backend: createObjectBackend({}) }).execute(unavailable.context)).exitCode, 1);
    assert.ok(Buffer.concat(unavailable.errors).toString().includes("requires an injected hook"));
    let calls = 0;
    const backend = createObjectBackend({ adminHooks: { [name]: async () => {
      calls++;
      return { value: "host-result" };
    } } });
    const denied = fixture(args);
    assert.equal((await createOp({ backend, authorize: () => "deny" }).execute(denied.context)).exitCode, 1);
    assert.equal(calls, 0);
    const allowed = fixture(args);
    assert.equal((await createOp({ backend, authorize: () => "allow" }).execute(allowed.context)).exitCode, 0, name);
    assert.equal(calls, 1);
    assert.ok(Buffer.concat(allowed.output).toString().includes("host-result"));

    const cancelled = fixture(args);
    const controller = new AbortController();
    const cancelledBackend = createObjectBackend({ adminHooks: { [name]: async () => {
      controller.abort();
      return { value: "private-result", resources: { receipts: [{ id: "receipt" }] } };
    } } });
    const before = cancelledBackend.snapshot();
    assert.notEqual((await createOp({ backend: cancelledBackend }).execute({ ...cancelled.context, signal: controller.signal })).exitCode, 0);
    assert.equal(cancelled.output.length, 0);
    assert.deepEqual(cancelledBackend.snapshot(), before);
  }
});

test("public factory resolves object-backed references through approval", async () => {
  const backend = createObjectBackend({
    vaults: [{ id: "vault", name: "Development" }],
    items: [{ id: "item", title: "Service", vault: "vault", fields: [{ id: "password", value: "test-secret" }] }],
  });
  const callbacks: string[] = [];
  const run = fixture(["read", "op://Development/Service/password"]);
  const command = createOp({ backend, authorize: request => {
    callbacks.push("authorize");
    assert.deepEqual(request.args, ["op://Development/Service/password"]);
    return "ask";
  }, authorizeResolution: request => {
    callbacks.push("resolution");
    assert.equal(request.resource, "read");
    return true;
  }, approve: () => {
    assert.fail("resolved approval must not use the legacy callback");
  }, approveResolved: manifest => {
    callbacks.push("resolved");
    assert.equal(run.output.length, 0);
    assert.deepEqual(manifest.operation, { resource: "read", action: "" });
    assert.equal(typeof manifest.backendId, "string");
    assert.ok(manifest.backendId.length > 0);
    assert.equal(manifest.accountId, null);
    assert.deepEqual(manifest.targets.map(({ revision, ...identity }) => {
      assert.equal(typeof revision, "string");
      assert.ok(revision.length > 0);
      return identity;
    }), [
      { requestIndex: 0, resource: "vault", kind: "object", id: "vault" },
      { requestIndex: 0, resource: "item", kind: "object", id: "item" },
      { requestIndex: 0, resource: "item", kind: "field", id: "password", parentId: "item" },
    ]);
    assert.deepEqual(manifest.output, { kind: "stdout" });
    assert.deepEqual(manifest.mutation, { requested: false, propertyNames: [], assignmentNames: [] });
    assert.equal(Object.isFrozen(manifest), true);
    assert.equal(JSON.stringify(manifest).includes("test-secret"), false);
    assert.equal("handle" in manifest, false);
    assert.equal("args" in manifest, false);
    return true;
  } });
  assert.deepEqual(await command.execute(run.context), { exitCode: 0 });
  assert.deepEqual(callbacks, ["authorize", "resolution", "resolved"]);
  assert.equal(Buffer.concat(run.output).toString(), "test-secret\n");
  assert.equal(run.errors.length, 0);
});

test("public factory denies secret resolution without calling a custom backend", async () => {
  let resolutions = 0;
  const command = createOp({ backend: { async execute() { resolutions++; return "test-secret"; } }, authorize: () => "deny" });
  const run = fixture(["read", "op://Development/Service/password"]);
  assert.equal((await command.execute(run.context)).exitCode, 1);
  assert.equal(resolutions, 0);
  assert.equal(run.output.length, 0);
});

test("public factory routes ordinary commands to an arbitrary backend", async () => {
  const command = createOp({ backend: { async execute(request) { return [{ id: "group", name: request.args[0] ?? "Engineering" }]; } } });
  const run = fixture(["group", "list", "--format=json"]);
  assert.deepEqual(await command.execute(run.context), { exitCode: 0 });
  assert.deepEqual(JSON.parse(Buffer.concat(run.output).toString()), [{ id: "group", name: "Engineering" }]);
});

test("item metadata commands do not reveal attachment bodies", async () => {
  const backend = createObjectBackend({
    vaults: [{ id: "vault", name: "Private" }],
    items: [{ id: "item", title: "Example", vault: "vault", files: [{ id: "file", name: "attachment", content: "attachment-private-body", size: 23 }] }],
  });
  const command = createOp({ backend });
  for (const action of ["get", "list"]) {
    for (const format of ["json", "human-readable"]) {
      const run = fixture(["item", action, ...(action === "get" ? ["item"] : []), "--format", format]);
      assert.equal((await command.execute(run.context)).exitCode, 0);
      assert.ok(!Buffer.concat(run.output).toString().includes("attachment-private-body"));
    }
  }
  const read = fixture(["read", "op://Private/Example/attachment"]);
  assert.equal((await command.execute(read.context)).exitCode, 0);
  assert.equal(Buffer.concat(read.output).toString(), "attachment-private-body\n");
});
