import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import { executeAdminRequest, type OpAdminHookResult } from "./admin.js";
import { createOp } from "./index.js";
import type { OpBackendRequest, OpObject, OpObjectBackendOptions } from "./types.js";

const context = { signal: new AbortController().signal };
const request = (resource: string, action: string, args: readonly string[] = [], flags: OpBackendRequest["flags"] = { account: "a" }, input?: unknown): OpBackendRequest => ({ resource, action, args, flags, input });

function fixture(adminHooks?: OpObjectBackendOptions["adminHooks"]) {
  return createObjectBackend({
    adminHooks,
    accounts: [{ id: "a", shorthand: "alpha", address: "alpha.1password.com", user_uuid: "alice" }, { id: "b", shorthand: "beta", address: "beta.1password.com" }],
    vaults: [{ id: "va", name: "Private", account: "a" }, { id: "vb", name: "Private", account: { id: "b" } }],
    items: [{ id: "ia", title: "Login", vault: "va", fields: [{ id: "password", value: "secret-a" }] }, { id: "ib", title: "Login", vault: "vb", fields: [{ id: "password", value: "secret-b" }] }],
    documents: [{ id: "da", name: "Data", vault: "va", content: "data-a" }, { id: "db", name: "Data", vault: "vb", content: "data-b" }],
    resources: { group: [{ id: "ga", name: "Team", account: "a" }, { id: "gb", name: "Team", account: "b" }], user: [{ id: "ua", account: "a", state: "ACTIVE" }, { id: "ub", account: "b", state: "ACTIVE" }], custom: [{ id: "ca", account: "a" }, { id: "cb", account: "b" }], unknown: [{ id: "unbound", payload: "preserve" }] }
  });
}

async function run(backend: ReturnType<typeof fixture>, args: readonly string[]) {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createOp({ backend }).execute({ ...context, args, env: {}, stdin: (async function* () {})(), stdout: { async write(bytes) { output.push(bytes.slice()); } }, stderr: { async write(bytes) { errors.push(bytes.slice()); } } });
  return { ...result, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() };
}

test("audit group lists and deletes honor account targeting and preserve other resources", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  assert.deepEqual((await backend.execute(request("group", "list"), context) as OpObject[]).map(object => object.id), ["ga"]);
  await assert.rejects(backend.execute(request("group", "delete", ["gb"]), context));
  assert.deepEqual(backend.snapshot(), before);
  await backend.execute(request("group", "delete", ["ga"]), context);
  assert.deepEqual(backend.snapshot().resources?.group?.map(object => object.id), ["gb"]);
  assert.deepEqual(backend.snapshot().resources?.unknown, before.resources?.unknown);
});

test("public read and delete reject foreign IDs and resolve duplicate vault names locally", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  assert.equal((await run(backend, ["read", "op://Private/Login/password", "--account", "a"])).stdout.trim(), "secret-a");
  const foreign = await run(backend, ["read", "op://vb/ib/password", "--account", "a"]);
  assert.equal(foreign.exitCode, 1);
  assert.equal(foreign.stdout.includes("secret-b"), false);
  assert.equal((await run(backend, ["item", "delete", "ib", "--account", "a"])).exitCode, 1);
  assert.equal((await run(backend, ["group", "delete", "gb", "--account", "a"])).exitCode, 1);
  assert.deepEqual(backend.snapshot(), before);
});

test("account aliases scope direct and indirect objects and default vault creation", async () => {
  const backend = fixture();
  for (const account of ["a", "ALPHA", "alpha.1password.com", "alice"]) {
    for (const [resource, id] of [["vault", "va"], ["item", "ia"], ["document", "da"], ["custom", "ca"]]) {
      assert.deepEqual((await backend.execute(request(resource!, "list", [], { account }), context) as OpObject[]).map(object => object.id), [id]);
    }
  }
  const item = await backend.execute(request("item", "create", [], { account: "alpha", title: "Created", category: "Login" }), context) as OpObject;
  assert.deepEqual(item.vault, { id: "va", name: "Private" });
  const group = await backend.execute(request("group", "create", ["New"], { account: "a" }), context) as OpObject;
  assert.equal(group.account, "a");
  assert.equal((await backend.execute(request("group", "list", [], { account: "b" }), context) as OpObject[]).length, 1);
});

test("foreign vault flags, account patches, moves and relation principals cannot cross accounts", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  for (const operation of [
    request("item", "get", ["ia"], { account: "a", vault: "vb" }),
    request("item", "create", [], { account: "a", vault: "vb", title: "Wrong" }),
    request("item", "move", ["ia"], { account: "a", "destination-vault": "vb" }),
    request("item", "edit", ["ia"], { account: "a" }, { vault: "vb" }),
    request("group", "edit", ["ga"], { account: "a" }, { account: "b" }),
    request("group user", "grant", [], { account: "a", group: "ga", user: "ub" }),
    request("vault user", "grant", [], { account: "a", vault: "vb", user: "ua", permissions: ["view_items"] })
  ]) await assert.rejects(backend.execute(operation, context));
  assert.deepEqual(backend.snapshot(), before);
  await backend.execute(request("group user", "grant", [], { account: "a", group: "ga", user: "ua" }), context);
  assert.equal((await backend.execute(request("group user", "list", ["ga"]), context) as OpObject[])[0]?.id, "ua");
});

test("direct admin dispatcher uses the same account boundary", async () => {
  const resources = new Map<string, OpObject[]>([["account", [{ id: "a" }, { id: "b" }]], ["group", [{ id: "ga", account: "a" }, { id: "gb", account: "b" }]]]);
  assert.deepEqual((await executeAdminRequest(request("group", "list"), context, resources)).value, [{ id: "ga", account: "a" }]);
  await assert.rejects(executeAdminRequest(request("group", "delete", ["gb"]), context, resources));
  assert.equal(resources.get("group")?.length, 2);
});

test("hooks receive only selected state and cannot publish foreign resources or values", async () => {
  let calls = 0;
  const backend = fixture({ "item share": async (_request, _context, resources) => {
    calls++;
    assert.deepEqual(resources.get("item")?.map(object => object.id), ["ia"]);
    assert.deepEqual(resources.get("account")?.map(object => object.id), ["a"]);
    return { value: "shared-a" };
  } });
  assert.equal(await backend.execute(request("item", "share", ["ia"]), context), "shared-a");
  await assert.rejects(backend.execute(request("item", "share", ["ib"]), context));
  assert.equal(calls, 1);
  const before = backend.snapshot();
  const results: OpAdminHookResult[] = [
    { resources: { group: [{ id: "gb", account: "b" }] } },
    { resources: { item: [{ id: "new", account: "a", vault: "vb" }] } },
    { value: { id: "gb", account: "b", secret: "foreign" } }
  ];
  for (const result of results) {
    await assert.rejects(backend.execute(request("group", "get", ["ga"]), { ...context, adminHooks: { "group get": async () => result } }));
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("account-scoped admin IDs remain globally unique", async () => {
  const occupied = "1".padStart(26, "A");
  const backend = createObjectBackend({ accounts: [{ id: "a" }, { id: "b" }], resources: { group: [{ id: occupied, name: "Other", account: "b" }] } });
  const created = await backend.execute(request("group", "create", ["New"]), context) as OpObject;
  assert.notEqual(created.id.toLowerCase(), occupied.toLowerCase());
  assert.equal(backend.snapshot().resources?.group?.length, 2);
});

test("concurrent scoped hooks preserve other-account and untouched same-account updates", async () => {
  let finish!: () => void;
  let announce!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const started = new Promise<void>(resolve => { announce = resolve; });
  const backend = fixture();
  const second = await backend.execute(request("group", "create", ["Second"]), context) as OpObject;
  const delayed = backend.execute(request("group", "edit", ["ga"]), { ...context, adminHooks: { "group edit": async (_request, _context, resources) => {
    announce(); await pending;
    return { resources: { group: resources.get("group")!.map(object => object.id === "ga" ? { ...object, name: "Delayed" } : object) } };
  } } });
  await started;
  await backend.execute(request("group", "edit", [second.id], { account: "a", name: "Concurrent A" }), context);
  await backend.execute(request("group", "edit", ["gb"], { account: "b", name: "Concurrent B" }), context);
  finish();
  await delayed;
  const groups = backend.snapshot().resources?.group ?? [];
  assert.equal(groups.find(object => object.id === "ga")?.name, "Delayed");
  assert.equal(groups.find(object => object.id === second.id)?.name, "Concurrent A");
  assert.equal(groups.find(object => object.id === "gb")?.name, "Concurrent B");
});

test("unknown ownership is explicit and invalid account aliases cannot access data", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  await assert.rejects(backend.execute(request("unknown", "list"), context), { message: "Account ownership is unavailable for this resource" });
  await assert.rejects(backend.execute(request("group", "list", [], { account: "missing" }), context));
  await assert.rejects(backend.execute(request("group", "list", [], {}), context), { message: "Account selection is required" });
  assert.deepEqual(backend.snapshot(), before);
});

test("arbitrary nested account and ID data is not interpreted as domain ownership", async () => {
  const backend = fixture();
  const metadata = { account: "unrelated text", nested: { id: "gb", account: "b" } };
  const edited = await backend.execute(request("group", "edit", ["ga"], { account: "a" }, { metadata }), context) as OpObject;
  assert.deepEqual(edited.metadata, metadata);
  assert.deepEqual((await backend.execute(request("group", "get", ["ga"]), context) as OpObject).metadata, metadata);
  const output = { id: "literal ID variable", account: "literal variable", data: [{ id: "gb", account: "b" }] };
  assert.deepEqual(await backend.execute(request("environment", "read", ["external"]), { ...context, adminHooks: { "environment read": async () => ({ value: output }) } }), output);
});

test("repeatable vault permission flags preserve metadata and reject foreign vaults before hooks", async () => {
  let calls = 0;
  const observed: OpBackendRequest[] = [];
  const backend = createObjectBackend({ accounts: [{ id: "a" }, { id: "b" }], vaults: [{ id: "va", name: "Dev", account: "a" }, { id: "vb", name: "Prod", account: "b" }], resources: { "connect server": [{ id: "sa", name: "Server", account: "a" }] }, adminHooks: Object.fromEntries(["service-account create", "connect token create", "connect server create"].map(command => [command, async (operation: OpBackendRequest) => { calls++; observed.push(operation); return { value: "synthetic-result" }; }])) });
  for (const [resource, extra] of [["service-account", []], ["connect token", ["--server", "sa"]]] as const) {
    const permissions = resource === "service-account" ? ["va:read_items", "Dev:read_items,write_items"] : ["va,r", "Dev,w"];
    const foreign = resource === "service-account" ? "vb:read_items" : "vb,r";
    const args = [...resource.split(" "), "create", "Bot", "--account", "a", ...extra, "--vault", permissions[0]!, "--vault", permissions[1]!];
    const result = await run(backend, args);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(observed.at(-1)?.flags.vault, permissions);
    const before = calls;
    assert.equal((await run(backend, [...args, "--vault", foreign])).exitCode, 1);
    assert.equal(calls, before);
  }
  assert.equal((await run(backend, ["connect", "server", "create", "Server", "--account", "a", "--vaults", "va,Dev"])).exitCode, 0);
  const before = calls;
  assert.equal((await run(backend, ["connect", "server", "create", "Server", "--account", "a", "--vaults", "va,vb"])).exitCode, 1);
  assert.equal(calls, before);
});
