import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import { executeAdminRequest } from "./admin.js";
import type { OpBackendRequest, OpBindingHandle } from "./types.js";

const request = (action: string, args: string[], input?: unknown): OpBackendRequest => ({ resource: "item", action, args, flags: {}, ...(input === undefined ? {} : { input }) });
const context = () => ({ signal: new AbortController().signal });
const fixture = () => createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "first", title: "Approved", vault: "vault", fields: [{ id: "password", label: "password", type: "CONCEALED", value: "synthetic-first" }] }, { id: "second", title: "Other", vault: "vault", fields: [{ id: "password", value: "synthetic-second" }] }] });

test("binding preparation exposes resolved metadata without executing or changing state", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  backend.execute = async () => assert.fail("prepare must not execute");
  const prepared = await backend.prepareBinding([request("get", ["Approved"])], context());
  assert.ok(prepared.targets.some(target => target.resource === "item" && target.id === "first"));
  assert.ok(prepared.targets.some(target => target.resource === "vault" && target.id === "vault"));
  assert.equal(JSON.stringify(prepared.targets).includes("synthetic"), false);
  assert.deepEqual(backend.snapshot(), before);
  assert.ok(Object.isFrozen(prepared.targets));
  backend.cancelBinding(prepared.handle);
});

test("binding rejects renamed targets, content changes and foreign or forged handles", async () => {
  const backend = fixture();
  const operation = request("get", ["Approved"]);
  const prepared = await backend.prepareBinding([operation], context());
  await backend.execute(request("edit", ["first"], { title: "Renamed" }), context());
  await backend.execute(request("edit", ["second"], { title: "Approved" }), context());
  await assert.rejects(backend.execute(operation, { ...context(), binding: prepared.handle }));
  const fresh = await backend.prepareBinding([request("get", ["first"])], context());
  await assert.rejects(fixture().execute(request("get", ["first"]), { ...context(), binding: fresh.handle }));
  await assert.rejects(backend.execute(operation, { ...context(), binding: {} as OpBindingHandle }));
  await backend.execute(request("edit", ["first", "password=changed"]), context());
  assert.throws(() => backend.validateBinding(fresh.handle, context()));
});

test("nested binding stages mutations until the last planned request and rejects replay", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  const operations = [request("edit", ["first"], { title: "Changed" }), request("get", ["second"])];
  const prepared = await backend.prepareBinding(operations, context());
  const bound = { ...context(), binding: prepared.handle };
  await backend.execute(operations[0]!, bound);
  assert.deepEqual(backend.snapshot(), before);
  await backend.execute(operations[1]!, bound);
  assert.equal(backend.snapshot().items?.[0]?.title, "Changed");
  backend.validateBinding(prepared.handle, bound);
  await assert.rejects(backend.execute(operations[1]!, bound));
});

test("cancellation and external changes discard staged mutations", async () => {
  for (const cancel of [true, false]) {
    const backend = fixture();
    const operations = [request("edit", ["first"], { title: "Must not publish" }), request("get", ["second"])];
    const prepared = await backend.prepareBinding(operations, context());
    const bound = { ...context(), binding: prepared.handle };
    await backend.execute(operations[0]!, bound);
    if (cancel) backend.cancelBinding(prepared.handle);
    else await backend.execute(request("edit", ["second"], { title: "Concurrent" }), context());
    await assert.rejects(backend.execute(operations[1]!, bound));
    assert.equal(backend.snapshot().items?.[0]?.title, "Approved");
  }
});

test("secret bindings resolve field and section IDs without cloning field values or arbitrary section payloads", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "item", title: "Login", vault: "vault", sections: [{ id: "section", label: "Custom", payload: "synthetic-private-section" }], fields: [{ id: "field", label: "Password", value: "synthetic-private-value", section: { id: "section", label: "Custom", payload: "synthetic-private-section" } }] }] });
  const operation: OpBackendRequest = { resource: "secret", action: "read", args: ["op://Private/Login/Custom/Password"], flags: {} };
  const clone = globalThis.structuredClone;
  globalThis.structuredClone = value => {
    assert.notEqual(JSON.stringify(value)?.includes("synthetic-private"), true);
    return clone(value);
  };
  let prepared;
  try { prepared = await backend.prepareBinding([operation], context()); }
  finally { globalThis.structuredClone = clone; }
  assert.ok(prepared.targets.some(target => target.kind === "field" && target.id === "field" && target.parentId === "item"));
  assert.equal(await backend.execute(operation, { ...context(), binding: prepared.handle }), "synthetic-private-value");
});

test("field projection manifests disclose only selected field identities", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [{ id: "item", title: "Login", vault: "vault", fields: [{ id: "password", label: "Password", type: "CONCEALED", value: "synthetic" }, { id: "other", label: "Other", value: "unselected" }] }] });
  const operation: OpBackendRequest = { ...request("get", ["item"]), flags: { fields: "Password" } };
  const prepared = await backend.prepareBinding([operation], context());
  assert.deepEqual(prepared.targets.filter(target => target.kind === "field").map(target => target.id), ["password"]);
});

test("bound nested reads tolerate their own staged auth refresh and reject revocation and expiry", async () => {
  let now = 1;
  const backend = createObjectBackend({ ...fixture().snapshot(), accounts: [{ id: "account" }], authentication: { mode: "managed" }, clock: { now: () => now }, resources: { session: [{ id: "session", mode: "manual", token: "synthetic-token", account: "account", issuedAt: 0, lastActivityAt: 0 }] } });
  const operations = ["first", "second"].map(id => ({ ...request("get", [id]), flags: { session: "synthetic-token" } }));
  const prepared = await backend.prepareBinding(operations, { ...context(), expiresAt: 2_000_000 });
  assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, 0);
  const bound = { ...context(), binding: prepared.handle };
  await backend.execute(operations[0]!, bound);
  assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, 0);
  now = 2;
  await backend.execute(operations[1]!, bound);
  backend.validateBinding(prepared.handle, bound);
  assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, 2);
  const expired = await backend.prepareBinding([operations[0]!], { ...context(), expiresAt: 2_000_000 });
  now = 1_800_002;
  await assert.rejects(backend.execute(operations[0]!, { ...context(), binding: expired.handle }));
  now = 3;
  const revoked = await backend.prepareBinding([operations[0]!], context());
  await backend.execute({ resource: "signout", action: "", args: [], flags: { session: "synthetic-token" } }, context());
  await assert.rejects(backend.execute(operations[0]!, { ...context(), binding: revoked.handle }));
});

test("binding timeout, abort, changed context and ordinary external hooks fail closed", async () => {
  let now = 0;
  const backend = createObjectBackend({ ...fixture().snapshot(), clock: { now: () => now }, adminHooks: { "item share": async () => assert.fail("unbound hook") } });
  const operation = request("get", ["first"]);
  const controller = new AbortController();
  const prepared = await backend.prepareBinding([operation], { signal: controller.signal, expiresAt: 5 });
  controller.abort();
  assert.throws(() => backend.validateBinding(prepared.handle, context()));
  const deadline = await backend.prepareBinding([operation], { ...context(), expiresAt: 5 });
  now = 5;
  assert.throws(() => backend.validateBinding(deadline.handle, context()));
  const changed = await backend.prepareBinding([operation], context());
  assert.throws(() => backend.validateBinding(changed.handle, { ...context(), authentication: { integration: "app" } }));
  await assert.rejects(backend.prepareBinding([request("share", ["first"])], context()));
  const hooked = await backend.prepareBinding([operation], context());
  await assert.rejects(backend.execute(operation, { ...context(), binding: hooked.handle, adminHooks: { "item get": async () => assert.fail("late hook") } }));
});

test("same-ID deletion and recreation invalidate bindings even with identical data", async () => {
  const backend = createObjectBackend({ resources: { custom: [{ id: "same", name: "Original" }] } });
  const operation: OpBackendRequest = { resource: "custom", action: "get", args: ["same"], flags: {} };
  const prepared = await backend.prepareBinding([operation], context());
  await backend.execute({ ...operation, action: "delete" }, context());
  await backend.execute({ ...operation, action: "create", args: [], input: { id: "same", name: "Original" } }, context());
  await assert.rejects(backend.execute(operation, { ...context(), binding: prepared.handle }));
});

test("concurrent planned reads serialize safely and list bindings detect phantoms", async () => {
  const backend = fixture();
  const operations = [request("get", ["first"]), request("get", ["second"])];
  const prepared = await backend.prepareBinding(operations, context());
  const values = await Promise.all(operations.map(operation => backend.execute(operation, { ...context(), binding: prepared.handle })));
  assert.deepEqual(values.map(value => (value as { id: string }).id), ["first", "second"]);
  const listing = request("list", []);
  const listBinding = await backend.prepareBinding([listing], context());
  await backend.execute(request("create", [], { title: "New" }), context());
  await assert.rejects(backend.execute(listing, { ...context(), binding: listBinding.handle }));
});

test("ordered environment and snapshot metadata comes from indexed keys without preparation value reads", async () => {
  const backend = createObjectBackend({ resources: {
    environment: [{ id: "env", variables: { TOKEN: "synthetic-private-value" } }, { id: "dependent", variables: { INDIRECT: "op://vault/item/field" } }],
    "environment snapshot": [{ id: "snapshot", name: "Snapshot", snapshot: { version: 1, scope: "selected", variables: { KEEP: "synthetic-private-value", DROP: null } } }]
  } });
  const operations: OpBackendRequest[] = [{ resource: "environment", action: "read", args: ["env"], flags: {} }, { resource: "environment snapshot", action: "get", args: ["Snapshot"], flags: {} }, { resource: "environment", action: "read", args: ["dependent"], flags: {} }];
  const clone = globalThis.structuredClone;
  globalThis.structuredClone = value => {
    assert.notEqual(JSON.stringify(value)?.includes("synthetic-private-value"), true);
    return clone(value);
  };
  let prepared;
  try { prepared = await backend.prepareBinding(operations, context()); }
  finally { globalThis.structuredClone = clone; }
  assert.deepEqual(prepared.metadata, [
    { environment: { names: ["TOKEN"], dependenciesComplete: true } },
    { environment: { names: ["KEEP", "DROP"], unsetNames: ["DROP"], scope: "selected", dependenciesComplete: true } },
    { environment: { names: ["INDIRECT"], dependenciesComplete: false } }
  ]);
  assert.ok(Object.isFrozen(prepared.metadata[1]?.environment?.names));
  backend.cancelBinding(prepared.handle);
  await backend.execute({ resource: "environment snapshot", action: "edit", args: ["snapshot"], flags: {}, input: { snapshot: { variables: { NEW: "synthetic-new-value" } } } }, context());
  const updated = await backend.prepareBinding([operations[1]!], context());
  assert.deepEqual(updated.metadata[0]?.environment?.names, ["KEEP", "DROP", "NEW"]);
});

test("a staged mutation cannot add unapproved members to a later bound collection read", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  const operations = [request("create", [], { title: "Unapproved member" }), request("list", [])];
  const prepared = await backend.prepareBinding(operations, context());
  const bound = { ...context(), binding: prepared.handle };
  await backend.execute(operations[0]!, bound);
  await assert.rejects(backend.execute(operations[1]!, bound));
  assert.deepEqual(backend.snapshot(), before);
});

test("list manifests exclude archived and filtered-out item identities", async () => {
  const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }], items: [
    { id: "selected", title: "Selected", vault: "vault", category: "LOGIN", tags: ["team/sub"] },
    { id: "archived", title: "Archived", vault: "vault", category: "LOGIN", tags: ["team/sub"], state: "ARCHIVED" },
    { id: "filtered", title: "Filtered", vault: "vault", category: "LOGIN", tags: ["other"] }
  ] });
  const prepared = await backend.prepareBinding([{ ...request("list", []), flags: { tags: "team", categories: "Login" } }], context());
  assert.deepEqual(prepared.targets.filter(target => target.resource === "item" && target.kind === "object").map(target => target.id), ["selected"]);
});

test("revocation during asynchronous bound work prevents staged mutation and result publication", async () => {
  const backend = createObjectBackend({ ...fixture().snapshot(), accounts: [{ id: "account" }], authentication: { mode: "managed" }, clock: { now: () => 1 }, resources: { session: [{ id: "session", mode: "manual", token: "synthetic-token", account: "account", issuedAt: 0, lastActivityAt: 0 }] } });
  await backend.execute({ ...request("edit", ["second"], { fields: [{ id: "otp", type: "OTP", value: "JBSWY3DPEHPK3PXP" }] }), flags: { session: "synthetic-token" } }, context());
  const operations: OpBackendRequest[] = [{ ...request("edit", ["first"], { title: "Must not commit" }), flags: { session: "synthetic-token" } }, { ...request("get", ["second"]), flags: { session: "synthetic-token", otp: true } }];
  const prepared = await backend.prepareBinding(operations, context());
  const bound = { ...context(), binding: prepared.handle };
  await backend.execute(operations[0]!, bound);
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  crypto.subtle.sign = async (...args) => { entered(); await pending; return sign(...args); };
  const operation = backend.execute(operations[1]!, bound);
  try {
    await Promise.race([started, operation.then(() => assert.fail("OTP must wait"))]);
    await backend.execute({ resource: "signout", action: "", args: [], flags: { session: "synthetic-token" } }, context());
    release();
    await assert.rejects(operation);
    assert.equal(backend.snapshot().items?.[0]?.title, "Approved");
    assert.deepEqual(backend.snapshot().resources?.session, []);
  } finally { release(); crypto.subtle.sign = sign; }
});

test("direct admin execution cannot accept a binding it cannot validate", async () => {
  const resources = new Map([["group", [{ id: "group", name: "Group" }]]]);
  await assert.rejects(executeAdminRequest({ resource: "group", action: "delete", args: ["group"], flags: {} }, { ...context(), binding: {} as OpBindingHandle }, resources));
  assert.equal(resources.get("group")?.length, 1);
});

test("empty SSH generation options cannot invoke unbound generation hooks", async () => {
  const backend = createObjectBackend({ ...fixture().snapshot(), ssh: { generate: async () => assert.fail("unbound SSH hook"), transform: () => assert.fail("unbound SSH hook") } });
  await assert.rejects(backend.prepareBinding([{ ...request("create", [], { title: "Key" }), flags: { "ssh-generate-key": "" } }], context()));
});

test("completing a read-only binding does not invalidate another unchanged binding", async () => {
  const backend = fixture();
  const first = request("get", ["first"]);
  const second = request("get", ["second"]);
  const preparedFirst = await backend.prepareBinding([first], context());
  const preparedSecond = await backend.prepareBinding([second], context());
  await backend.execute(first, { ...context(), binding: preparedFirst.handle });
  backend.validateBinding(preparedSecond.handle, context());
  await backend.execute(second, { ...context(), binding: preparedSecond.handle });
});

test("backend-free handler plans receive an empty binding and cannot execute an unplanned request", async () => {
  const backend = fixture();
  const prepared = await backend.prepareBinding([], context());
  assert.deepEqual(prepared.targets, []);
  assert.deepEqual(prepared.metadata, []);
  assert.equal(prepared.accountId, null);
  backend.validateBinding(prepared.handle, context());
  await assert.rejects(backend.execute(request("get", ["first"]), { ...context(), binding: prepared.handle }));
});

test("binding request normalization does not turn non-object templates into valid item inputs", async () => {
  const backend = createObjectBackend({ accounts: [{ id: "account" }], vaults: [{ id: "vault", name: "Private", account: "account" }] });
  const before = backend.snapshot();
  const operation = { ...request("create", [], new Uint8Array([1, 2])), flags: { account: "account", vault: "vault" } };
  await assert.rejects(backend.execute(operation, context()));
  await assert.rejects(backend.prepareBinding([operation], context()));
  assert.deepEqual(backend.snapshot(), before);
});
