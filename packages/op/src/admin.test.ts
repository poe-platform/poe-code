import assert from "node:assert/strict";
import { test } from "node:test";
import { executeAdminRequest, type OpAdminContext } from "./admin.js";
import type { OpBackendRequest, OpObject } from "./types.js";

const context: OpAdminContext = { signal: new AbortController().signal };
const request = (resource: string, action = "", args: readonly string[] = [], flags: OpBackendRequest["flags"] = {}, input?: unknown): OpBackendRequest => ({ resource, action, args, flags, input });
function fixture() {
  const resources = new Map<string, OpObject[]>([
    ["account", [{ id: "account", name: "Work", email: "owner@example.com", shorthand: "work" }]],
    ["user", [{ id: "alice", name: "Alice", email: "alice@example.com", state: "ACTIVE" }, { id: "bob", name: "Bob", state: "PENDING" }]],
    ["group", [{ id: "engineering", name: "Engineering" }]],
    ["vault", [{ id: "production", name: "Production" }]],
  ]);
  return { resources, execute: async (command: OpBackendRequest, executionContext = context) => (await executeAdminRequest(command, executionContext, resources)).value };
}

test("unrelated requests fall through and unsupported admin actions fail safely", async () => {
  assert.deepEqual(await executeAdminRequest(request("item", "get"), context, new Map()), { handled: false });
  await assert.rejects(executeAdminRequest(request("group", "secret-action"), context, new Map()), { message: "Unsupported admin action" });
});

test("generated admin IDs have native length and avoid case-insensitive cross-resource collisions", async () => {
  const { execute, resources } = fixture();
  resources.set("item", [{ id: "1".padStart(26, "a").toUpperCase(), fields: [{ id: "2".padStart(26, "a").toUpperCase() }] }]);
  const created = await execute(request("group", "create", ["Security"])) as OpObject;
  assert.equal(created.id.length, 26);
  assert.equal(created.id, "3".padStart(26, "a"));
  await execute(request("group user", "grant", [], { group: "Security", user: "alice" }));
  const membership = resources.get("group user")![0]!;
  assert.equal(membership.id, "4".padStart(26, "a"));
});

test("group lifecycle accepts CLI flags, batches stdin, clones metadata and preserves IDs", async () => {
  const { execute, resources } = fixture();
  const created = await execute(request("group", "create", ["Security"], { description: "Team" }, { metadata: { owner: "Alice" } })) as OpObject;
  assert.equal(created.name, "Security");
  assert.equal(created.description, "Team");
  const updated = await execute(request("group", "edit", [created.id], { name: "Sec" }, { metadata: { color: "red" } })) as OpObject;
  assert.deepEqual(updated.metadata, { owner: "Alice", color: "red" });
  updated.name = "Mutated";
  assert.equal((await execute(request("group", "get", [created.id])) as OpObject).name, "Sec");
  await assert.rejects(execute(request("group", "edit", [created.id], {}, { id: "changed" })));
  assert.equal((await execute(request("group", "get", ["-"], {}, [{ id: created.id }, { id: "engineering" }])) as unknown[]).length, 2);
  await execute(request("group", "delete", [created.id]));
  assert.equal(resources.get("group")!.length, 1);
});

test("membership resolves email, updates roles, filters lists and cascades deletion", async () => {
  const { execute, resources } = fixture();
  await execute(request("group user", "grant", [], { group: "Engineering", user: "ALICE@example.com" }));
  await execute(request("group user", "grant", [], { group: "engineering", user: "alice", role: "manager" }));
  assert.equal(resources.get("group user")!.length, 1);
  assert.equal((await execute(request("group user", "list", ["engineering"])) as OpObject[])[0]!.role, "manager");
  assert.equal((await execute(request("group", "list", [], { user: "alice" })) as OpObject[]).length, 1);
  assert.equal((await execute(request("user", "list", [], { group: "engineering" })) as OpObject[])[0]!.role, "manager");
  const before = structuredClone(resources);
  await assert.rejects(execute(request("group user", "grant", [], { group: "engineering", user: "bob", role: "owner" })));
  assert.deepEqual(resources, before);
  await execute(request("user", "delete", ["alice"]));
  assert.deepEqual(resources.get("group user"), []);
});

test("group roles accept case-insensitive values, store lowercase, and leave request flags unchanged", async () => {
  const { execute, resources } = fixture();
  for (const role of ["MEMBER", "MaNaGeR", "member", "manager"]) {
    const flags = Object.freeze({ group: "engineering", user: "alice", role });
    const result = await execute(request("group user", "grant", [], flags)) as OpObject;
    assert.equal(result.role, role.toLowerCase());
    assert.equal(resources.get("group user")?.[0]?.role, role.toLowerCase());
    assert.equal(flags.role, role);
    assert.equal(resources.get("group user")?.length, 1);
  }
  await execute(request("group user", "grant", [], { group: "engineering", user: "alice" }));
  assert.equal(resources.get("group user")?.[0]?.role, "member");
  const before = structuredClone(resources);
  for (const role of [" MEMBER", "manager ", "owner", "", true, ["member"]]) {
    await assert.rejects(execute(request("group user", "grant", [], { group: "engineering", user: "alice", role })), { message: "Invalid group role" });
    assert.deepEqual(resources, before);
  }
});

test("vault grants union permissions, partially revoke, filter and remove empty access", async () => {
  const { execute } = fixture();
  for (const principal of ["user", "group"]) {
    const selector = principal === "user" ? "alice" : "engineering";
    const flags = { vault: "production", [principal]: selector };
    await execute(request(`vault ${principal}`, "grant", [], { ...flags, permissions: ["view_items", "view_and_copy_passwords", "edit_items"] }));
    await execute(request(`vault ${principal}`, "grant", [], { ...flags, permissions: ["view_items"] }));
    await execute(request(`vault ${principal}`, "revoke", [], { ...flags, permissions: ["edit_items", "view_and_copy_passwords"] }));
    assert.deepEqual((await execute(request(`vault ${principal}`, "list", ["production"])) as OpObject[])[0]!.permissions, ["view_items"]);
    assert.equal((await execute(request(principal, "list", [], { vault: "production" })) as OpObject[]).length, 1);
    await execute(request(`vault ${principal}`, "revoke", [], flags));
    assert.deepEqual(await execute(request(`vault ${principal}`, "list", ["production"])), []);
  }
});

test("user lifecycle validates transitions and atomically resolves batches", async () => {
  const { execute, resources } = fixture();
  await execute(request("user", "confirm", [], { all: true }));
  assert.equal(resources.get("user")![1]!.state, "ACTIVE");
  await execute(request("user", "suspend", ["alice"]));
  assert.equal(resources.get("user")![0]!.state, "SUSPENDED");
  await execute(request("user", "reactivate", ["alice"]));
  await assert.rejects(execute(request("user", "reactivate", ["alice"])));
  const before = structuredClone(resources);
  await assert.rejects(execute(request("user", "delete", ["-"], {}, "alice\nsecret-missing")), { message: "Object not found" });
  assert.deepEqual(resources, before);
  await assert.rejects(execute(request("user", "edit", ["alice"], { "travel-mode": "invalid" })));
});

test("accounts select shorthand, require real authentication, sign out and forget locally", async () => {
  const { execute, resources } = fixture();
  assert.equal((await execute(request("account", "get", [], { account: "work" })) as OpObject).id, "account");
  await assert.rejects(execute(request("whoami")), { message: "No authenticated session" });
  await assert.rejects(execute(request("signin")), { message: "Admin command requires an injected hook" });
  const authenticated: OpAdminContext = { ...context, authenticationPolicy: { mode: "managed" }, authentication: { terminalId: "terminal" }, clock: { now: () => 1000 }, adminHooks: { signin: async () => ({ value: "provider-token", authentication: { sessions: [{ id: "session", account: "account", user: "alice", mode: "manual", token: "provider-token", issuedAt: 1000, lastActivityAt: 1000 }] } }) } };
  assert.equal(await execute(request("signin", "", [], { raw: true }), authenticated), "provider-token");
  assert.equal((await execute(request("whoami", "", [], { session: "provider-token" }), authenticated) as OpObject).id, "alice");
  await execute(request("signout", "", [], { forget: true }), authenticated);
  assert.deepEqual(resources.get("session"), []);
  assert.deepEqual(resources.get("account"), []);
});

test("external effects require hooks, sanitize errors and commit only after success", async () => {
  const { execute, resources } = fixture();
  for (const command of [request("account", "add"), request("service-account", "create", ["Bot"]), request("service-account", "ratelimit"), request("connect server", "create", ["Server"]), request("connect token", "create", ["Token"]), request("events-api", "create", ["Audit"]), request("user", "provision"), request("user recovery", "begin", ["alice"]), request("plugin", "init", ["aws"]), request("plugin", "run", ["aws", "s3", "ls"])]) {
    await assert.rejects(execute(command), { message: "Admin command requires an injected hook" });
  }
  const before = structuredClone(resources);
  await assert.rejects(execute(request("events-api", "create", ["Audit"]), { ...context, adminHooks: { "events-api create": async () => { throw new Error("plaintext-secret"); } } }), { message: "Admin hook failed" });
  assert.deepEqual(resources, before);
  const controller = new AbortController();
  await assert.rejects(execute(request("events-api", "create", ["Audit"]), { signal: controller.signal, adminHooks: { "events-api create": async () => { controller.abort(); return { resources: { "events-api": [{ id: "audit", token: "provider-token" }] } }; } } }));
  assert.deepEqual(resources, before);
});

test("connect relationships cover managers, all future servers, vaults and token scoping", async () => {
  const { execute, resources } = fixture();
  resources.set("connect server", [{ id: "server", name: "Server" }, { id: "other", name: "Other" }]);
  resources.set("connect token", [{ id: "token", name: "Token", server: "server" }]);
  await execute(request("connect group", "grant", [], { group: "engineering", "all-servers": true }));
  assert.equal(resources.get("connect group")![0]!.server, "*");
  await execute(request("connect vault", "grant", [], { server: "server", vault: "production" }));
  assert.equal(resources.get("connect vault")![0]!.vault, "production");
  assert.deepEqual(await execute(request("connect token", "list", [], { server: "other" })), []);
  await assert.rejects(execute(request("connect token", "delete", ["token"], { server: "other" })));
  await execute(request("connect server", "delete", ["server"]));
  assert.deepEqual(resources.get("connect token"), []);
  assert.deepEqual(resources.get("connect vault"), []);
});

test("environment reads stored secrets and plugin clearing preserves catalog metadata", async () => {
  const { execute, resources } = fixture();
  resources.set("environment", [{ id: "env", name: "Production", variables: { KEY: "secret" } }]);
  assert.deepEqual(await execute(request("environment", "read", ["env"])), { KEY: "secret" });
  resources.set("plugin", [{ id: "aws", name: "AWS", defaults: [{ id: "default", scope: { kind: "global" }, configuration: { credential: "reference" } }] }]);
  await execute(request("plugin", "clear", ["aws"], { force: true }), { ...context, pluginScope: { cwd: "/work", home: "/work" } });
  assert.deepEqual((await execute(request("plugin", "inspect", ["aws"])) as OpObject).defaults, []);
  assert.equal((await execute(request("plugin", "list")) as OpObject[]).length, 1);
});

test("Connect token lists do not require a server and retain revoked token metadata", async () => {
  const { execute, resources } = fixture();
  resources.set("connect server", [{ id: "server" }]);
  resources.set("connect token", [{ id: "token", integrationId: "server", name: "Token", state: "ACTIVE" }]);
  assert.equal((await execute(request("connect token", "list")) as OpObject[]).length, 1);
  await execute(request("connect token", "delete", ["token"], { server: "server" }));
  assert.equal((await execute(request("connect token", "list")) as OpObject[])[0]!.state, "REVOKED");
});

test("plugin clear --all clears the selected plugin only", async () => {
  const { execute, resources } = fixture();
  resources.set("plugin", [{ id: "aws", defaults: [{ id: "default", scope: { kind: "global" }, configuration: { credential: "aws" } }] }, { id: "gh", configuration: { credential: "gh" } }]);
  await execute(request("plugin", "clear", ["aws"], { all: true, force: true }), { ...context, pluginScope: { cwd: "/work", home: "/work" } });
  assert.deepEqual(resources.get("plugin")![0]!.defaults, []);
  assert.deepEqual(resources.get("plugin")![1]!.configuration, { credential: "gh" });
});

test("vault permission filters exclude grants without every requested permission", async () => {
  const { execute } = fixture();
  await execute(request("vault user", "grant", [], { vault: "production", user: "alice", permissions: ["view_items"] }));
  assert.deepEqual(await execute(request("vault", "list", [], { user: "alice", permission: ["manage_vault"] })), []);
  assert.equal((await execute(request("vault", "list", [], { user: "alice", permission: ["view_items"] })) as OpObject[]).length, 1);
});

test("provider results persist metadata and tokens without sharing mutable references", async () => {
  const { execute, resources } = fixture();
  for (const command of ["account add", "service-account create", "connect server create", "connect token create", "events-api create", "user provision", "user recovery begin", "plugin init", "plugin run", "service-account ratelimit"]) {
    const parts = command.split(" ");
    const action = parts.pop()!;
    const resource = parts.join(" ");
    const provided = { id: "provider-id", token: "real-provider-token", metadata: { source: "provider" } };
    let invoked = false;
    const result = await execute(request(resource, action, ["Name"], { "expires-in": "1h" }), { ...context, adminHooks: { [command]: async (commandRequest, hookContext, snapshot) => {
      invoked = true;
      assert.equal(commandRequest.flags["expires-in"], "1h");
      assert.equal(hookContext.signal, context.signal);
      assert.notEqual(snapshot, resources);
      return { value: provided, resources: { [resource]: [provided] } };
    } } }) as OpObject;
    assert.equal(invoked, true);
    provided.token = "mutated";
    result.token = "also-mutated";
    assert.equal(resources.get(resource)![0]!.token, "real-provider-token");
  }
});

test("invalid provider snapshots and ambiguous selectors fail without exposing secrets", async () => {
  const { execute, resources } = fixture();
  resources.set("group", [{ id: "first", name: "secret" }, { id: "second", name: "secret" }]);
  await assert.rejects(execute(request("group", "get", ["secret"])), { message: "Ambiguous object selector" });
  const before = structuredClone(resources);
  await assert.rejects(execute(request("events-api", "create"), { ...context, adminHooks: { "events-api create": async () => ({ resources: { "events-api": [{ id: "duplicate" }, { id: "DUPLICATE" }] } }) } }), { message: "Admin hook failed" });
  assert.deepEqual(resources, before);
});
