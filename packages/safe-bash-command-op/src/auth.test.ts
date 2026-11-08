import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import { executeAdminRequest } from "./admin.js";
import type { OpBackendRequest, OpObjectBackendOptions } from "./types.js";

const request = (resource = "item", action = "get", args = ["item"], flags: OpBackendRequest["flags"] = ["item", "whoami"].includes(resource) ? { session: "token" } : {}): OpBackendRequest => ({ resource, action, args, flags });
const context = { signal: new AbortController().signal, authentication: { terminalId: "terminal" } };
const appContext = { ...context, authentication: { ...context.authentication, integration: "app" as const } };
function fixture(options: OpObjectBackendOptions = {}) {
  let time = 1000;
  const backend = createObjectBackend({ authentication: { mode: "managed" }, clock: { now: () => time }, accounts: [{ id: "account", shorthand: "work" }], vaults: [{ id: "vault", name: "Private", account: "account" }], items: [{ id: "item", title: "Item", vault: "vault" }], resources: { session: [{ id: "session", account: "account", mode: "manual", token: "token", issuedAt: 0, lastActivityAt: 0, identity: { id: "owner" } }], "session default": [{ id: "default", terminalId: "terminal", account: "account" }] }, ...options });
  return { backend, setTime(value: number) { time = value; } };
}

test("wrong explicit tokens reject generic reads and mutations without changing state", async () => {
  const { backend } = fixture();
  const before = backend.snapshot();
  for (const action of ["get", "delete"]) await assert.rejects(backend.execute(request("item", action, ["item"], { session: "wrong" }), context));
  assert.deepEqual(backend.snapshot(), before);
  await assert.rejects(createObjectBackend().execute(request("item", "list", [], { session: "wrong" }), context));
});

test("manual activity expires exactly at thirty minutes and successful reads persist activity", async () => {
  const { backend, setTime } = fixture();
  setTime(1_799_999);
  await backend.execute(request(), context);
  assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, 1_799_999);
  setTime(3_599_999);
  const before = backend.snapshot();
  await assert.rejects(backend.execute(request(), context));
  assert.deepEqual(backend.snapshot(), before);
  const restored = createObjectBackend({ ...before, clock: { now: () => 3_599_999 } });
  await assert.rejects(restored.execute(request(), context));
  assert.equal(before.clock, undefined);
  assert.deepEqual(before.authentication, { mode: "managed" });
});

test("manual tokens transfer terminals but terminal defaults and account conflicts do not", async () => {
  const { backend } = fixture();
  const other = { ...context, authentication: { terminalId: "other" } };
  await assert.rejects(backend.execute(request("item", "get", ["item"], {}), other));
  await backend.execute(request("item", "get", ["item"], { session: "token" }), other);
  await assert.rejects(backend.execute(request("item", "get", ["item"], { session: "token", account: "wrong" }), other));
  assert.deepEqual(await backend.execute(request("whoami", "", []), context), { id: "owner" });
});

test("legacy and malformed session metadata require explicit migration", () => {
  assert.throws(() => fixture({ resources: { session: [{ id: "legacy", account: "account", token: "token" }] } }));
  assert.throws(() => fixture({ authentication: { mode: "object-store" } }));
});

test("failed operations and aborted calls never refresh sessions", async () => {
  const { backend } = fixture();
  const before = backend.snapshot();
  await assert.rejects(backend.execute(request("item", "delete", ["missing"]), context));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(backend.execute(request(), { ...context, signal: controller.signal }));
  assert.deepEqual(backend.snapshot(), before);
});

test("app authorization is terminal bound, idle limited, hard limited and revocable", async () => {
  for (const [time, revokedAt] of [[600_000, undefined], [43_200_000, undefined], [1000, 500]]) {
    const { backend } = fixture({ clock: { now: () => time! }, resources: { session: [{ id: "app", account: "account", mode: "app", terminalId: "terminal", issuedAt: 0, lastActivityAt: time === 43_200_000 ? 43_199_999 : 0, ...(revokedAt === undefined ? {} : { revokedAt }) }] } });
    await assert.rejects(backend.execute(request("item", "get", ["item"], { account: "account" }), appContext));
  }
  const { backend } = fixture({ resources: { session: [{ id: "app", account: "account", mode: "app", terminalId: "terminal", issuedAt: 0, lastActivityAt: 0 }] } });
  await backend.execute(request("item", "get", ["item"], { account: "account" }), appContext);
  await assert.rejects(backend.execute(request("item", "get", ["item"], { account: "account" }), { ...appContext, authentication: { ...appContext.authentication, terminalId: "other" } }));
});

test("signin hooks populate canonical managed sessions and terminal defaults, signout retains policy", async () => {
  const { backend } = fixture({ resources: {}, adminHooks: { signin: async (_request, hookContext) => {
    assert.deepEqual(hookContext.authentication, context.authentication);
    return { value: "new-token", authentication: { sessions: [{ id: "signed-in", account: "account", mode: "manual", token: "new-token", issuedAt: 1000, lastActivityAt: 1000, identity: { id: "owner" } }] } };
  } } });
  assert.equal(await backend.execute(request("signin", "", [], { account: "work" }), context), "new-token");
  assert.equal(backend.snapshot().resources?.["session default"]?.[0]?.account, "account");
  assert.deepEqual(await backend.execute(request("whoami", "", [], { session: "new-token" }), context), { id: "owner" });
  await backend.execute(request("signout", "", []), context);
  assert.deepEqual(backend.snapshot().resources?.session, []);
  assert.deepEqual(backend.snapshot().authentication, { mode: "managed" });
  await assert.rejects(backend.execute(request(), context));
  await backend.execute(request("signin", "", [], { account: "work" }), context);
  await backend.execute(request("account", "forget", ["work"]), context);
  assert.deepEqual(backend.snapshot().resources?.session, []);
  assert.deepEqual(backend.snapshot().resources?.["session default"], []);
  assert.deepEqual(backend.snapshot().accounts, []);
});

test("invalid authentication hook updates never partially publish resources", async () => {
  for (const authentication of [{ mode: "managed" as const }, { mode: "object-store" as const }]) {
    const { backend } = fixture({ authentication, resources: {}, adminHooks: { signin: async () => ({ resources: { group: [{ id: "changed", account: "account" }] }, authentication: { sessions: [{ id: "bad", account: "account", mode: "manual", token: "bad", issuedAt: 2000, lastActivityAt: 1000 }] } }) } });
    const before = backend.snapshot();
    await assert.rejects(backend.execute(request("signin", "", [], { account: "work" }), context));
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("direct admin admission enforces expiry and retains user identity lookup", async () => {
  const { backend } = fixture({ resources: { user: [{ id: "owner", account: "account", email: "owner@example.test" }], session: [{ id: "session", account: "account", user: "owner", mode: "manual", token: "token", issuedAt: 0, lastActivityAt: 0 }] } });
  const resources = new Map(Object.entries(backend.snapshot().resources ?? {}).map(([key, entries]) => [key, [...entries]]));
  resources.set("account", [...backend.snapshot().accounts!]);
  const execution = { ...context, authenticationPolicy: { mode: "managed" as const }, clock: { now: () => 1000 } };
  assert.equal(((await executeAdminRequest(request("whoami", "", [], { session: "token" }), execution, resources)).value as { email: string }).email, "owner@example.test");
  await assert.rejects(executeAdminRequest(request("user", "get", ["owner"], { session: "token" }), { ...execution, clock: { now: () => 1_801_000 } }, resources));
});

test("successful concurrent refresh merges and signout cannot resurrect sessions", async () => {
  for (const signout of [false, true]) {
    const { backend, setTime } = fixture();
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = backend.execute(request("item", "share", ["item"]), { ...context, adminHooks: { "item share": async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { value: "shared" }; } } });
    await ready;
    setTime(2000);
    if (signout) await backend.execute(request("signout", "", []), context);
    else await backend.execute(request(), context);
    release();
    if (signout) await assert.rejects(pending);
    else assert.equal(await pending, "shared");
    if (signout) assert.deepEqual(backend.snapshot().resources?.session, []);
    else assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, 2000);
  }
});

test("multi-account terminal defaults choose account before scope and signout is isolated", async () => {
  const { backend } = fixture({ accounts: [{ id: "account" }, { id: "other" }], resources: { session: [{ id: "first", account: "account", mode: "manual", token: "first", issuedAt: 0, lastActivityAt: 0 }, { id: "second", account: "other", mode: "manual", token: "second", issuedAt: 0, lastActivityAt: 0 }], "session default": [{ id: "default", terminalId: "terminal", account: "account" }, { id: "other-default", terminalId: "elsewhere", account: "other" }] } });
  await backend.execute(request("item", "get", ["item"], { session: "first" }), context);
  await backend.execute(request("signout", "", []), context);
  assert.deepEqual(backend.snapshot().resources?.session?.map(session => session.id), ["second"]);
  assert.deepEqual(backend.snapshot().resources?.["session default"]?.map(entry => entry.account), ["other"]);
});

test("signin reuses valid authorization, renews expired authorization through hooks, and changes only terminal default", async () => {
  let calls = 0;
  const { backend, setTime } = fixture({ adminHooks: { signin: async () => {
    calls++;
    return { value: "renewed", authentication: { sessions: [{ id: "renewed", account: "account", mode: "manual", token: "renewed", issuedAt: 2_000_000, lastActivityAt: 2_000_000 }] } };
  } } });
  assert.equal(await backend.execute(request("signin", "", [], { session: "token" }), context), "token");
  assert.equal(calls, 0);
  assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, 1000);
  setTime(2_000_000);
  assert.equal(await backend.execute(request("signin", "", []), context), "renewed");
  assert.equal(calls, 1);
  await backend.execute(request("item", "get", ["item"], { session: "renewed" }), context);
});

test("account forgetting without arguments uses current terminal selection rather than last global session", async () => {
  const { backend } = fixture({ accounts: [{ id: "account" }, { id: "other" }], resources: { session: [{ id: "first", account: "account", mode: "manual", token: "first", issuedAt: 0, lastActivityAt: 0 }, { id: "second", account: "other", mode: "manual", token: "second", issuedAt: 0, lastActivityAt: 0 }], "session default": [{ id: "default", terminalId: "terminal", account: "account" }] } });
  await backend.execute(request("account", "forget", []), context);
  assert.deepEqual(backend.snapshot().accounts?.map(account => account.id), ["other"]);
});

test("managed credential-free reads stay protected and service-account bearers are not manual tokens", async () => {
  const { backend } = fixture({ resources: {} });
  await assert.rejects(backend.execute(request("item", "get", ["item"], { account: "work" }), context));
  await assert.rejects(backend.execute(request("secret", "read", ["op://Private/Item/password"], { account: "work" }), context));
  assert.throws(() => fixture({ resources: { session: [{ id: "bearer", account: "account", mode: "service-account", token: "bearer", issuedAt: 0, lastActivityAt: 0 }] } }));
  const anonymous = createObjectBackend({ items: [], vaults: [] });
  assert.deepEqual(await anonymous.execute(request("item", "list", [], {}), context), []);
});

test("expired batch admissions and hook aborts cannot mutate or refresh", async () => {
  const { backend, setTime } = fixture();
  const before = backend.snapshot();
  setTime(1_800_000);
  await assert.rejects(backend.execute({ ...request("item", "delete", ["-"]), input: "item" }, context));
  assert.deepEqual(backend.snapshot(), before);
  setTime(1000);
  const controller = new AbortController();
  await assert.rejects(backend.execute(request("item", "share", ["item"]), { ...context, signal: controller.signal, adminHooks: { "item share": async () => { controller.abort(); return { resources: { item: [] } }; } } }));
  assert.deepEqual(backend.snapshot(), before);
});

test("signin switches a terminal default across accounts without replacing other terminal selections", async () => {
  const { backend } = fixture({ accounts: [{ id: "account" }, { id: "other" }], resources: { session: [{ id: "first", account: "account", mode: "manual", token: "first", issuedAt: 0, lastActivityAt: 0 }, { id: "second", account: "other", mode: "manual", token: "second", issuedAt: 0, lastActivityAt: 0 }], "session default": [{ id: "default", terminalId: "terminal", account: "account" }, { id: "untouched", terminalId: "elsewhere", account: "account" }] } });
  await backend.execute(request("signin", "", [], { account: "other", session: "second" }), context);
  const defaults = backend.snapshot().resources?.["session default"];
  assert.equal(defaults?.filter(entry => entry.terminalId === "terminal").length, 1);
  assert.equal(defaults?.find(entry => entry.terminalId === "terminal")?.account, "other");
  assert.equal(defaults?.find(entry => entry.terminalId === "elsewhere")?.account, "account");
});

test("app revocation during an admitted operation preserves revocation without refreshing", async () => {
  const app = { id: "app", account: "account", mode: "app" as const, terminalId: "terminal", issuedAt: 0, lastActivityAt: 0 };
  const { backend } = fixture({ resources: { session: [app] } });
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const operation = request("item", "share", ["item"], { account: "account" });
  const pending = backend.execute(operation, { ...appContext, adminHooks: { "item share": async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { value: "finished" }; } } });
  await ready;
  await backend.execute(operation, { ...appContext, adminHooks: { "item share": async () => ({ authentication: { sessions: [{ ...app, revokedAt: 1000 }] } }) } });
  release();
  await assert.rejects(pending);
  assert.equal(backend.snapshot().resources?.session?.[0]?.revokedAt, 1000);
  assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, 0);
  await assert.rejects(backend.execute(request("item", "get", ["item"], { account: "account" }), appContext));
});

test("managed local account-scoped commands never use a different terminal's last session", async () => {
  const { backend } = fixture({ accounts: [{ id: "account" }, { id: "other" }], resources: { session: [{ id: "last", account: "other", mode: "manual", token: "token", issuedAt: 0, lastActivityAt: 0 }], plugin: [{ id: "plugin", account: "other" }] } });
  await assert.rejects(backend.execute(request("plugin", "list", []), context));
});

test("manual defaults never substitute for bearer possession or reveal stored tokens through signin", async () => {
  let calls = 0;
  const { backend } = fixture({ adminHooks: { signin: async () => { calls++; throw new Error("Authentication required"); } } });
  const before = backend.snapshot();
  const selections: OpBackendRequest["flags"][] = [{}, { account: "work" }];
  for (const flags of selections) {
    for (const action of ["get", "delete"]) await assert.rejects(backend.execute(request("item", action, ["item"], flags), context));
    await assert.rejects(backend.execute(request("signin", "", [], flags), context));
  }
  assert.equal(calls, 2);
  assert.deepEqual(backend.snapshot(), before);
});

test("manual credential reissue during a pending operation rejects its result and writes", async () => {
  const { backend } = fixture();
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = backend.execute(request("item", "share", ["item"]), { ...context, adminHooks: { "item share": async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { value: "secret-result", resources: { item: [] } }; } } });
  await ready;
  await backend.execute(request("signin", "", [], { account: "work" }), { ...context, adminHooks: { signin: async () => ({ authentication: { sessions: [{ id: "session", account: "account", mode: "manual", token: "replacement", issuedAt: 1000, lastActivityAt: 1000 }] } }) } });
  const changed = backend.snapshot();
  release();
  await assert.rejects(pending);
  assert.deepEqual(backend.snapshot(), changed);
});

function suspensionFixture() {
  return fixture({ accounts: [{ id: "account" }, { id: "other" }], items: [{ id: "item", title: "Item", vault: "vault", fields: [{ id: "password", type: "CONCEALED", value: "secret" }] }], resources: {
    user: [{ id: "admin", account: "account", state: "ACTIVE" }, { id: "member", account: "account", state: "ACTIVE" }, { id: "peer", account: "account", state: "ACTIVE" }, { id: "foreign", account: "other", state: "ACTIVE" }],
    session: [...["admin", "member", "peer", "foreign"].map(user => ({ id: `${user}-session`, account: user === "foreign" ? "other" : "account", user, mode: "manual", token: user, issuedAt: 0, lastActivityAt: 0 })), { id: "member-app", account: "account", user: "member", mode: "app", issuedAt: 0, lastActivityAt: 0, terminalId: "terminal" }],
  } }).backend;
}

test("suspension removes all member sessions, denies secret reads, and reactivation cannot restore old tokens", async () => {
  const backend = suspensionFixture();
  const read = request("secret", "read", ["op://Private/Item/password"], { session: "member" });
  assert.equal(await backend.execute(read, context), "secret");
  const before = backend.snapshot();
  await backend.execute(request("user", "suspend", ["member"], { session: "admin" }), context);
  await assert.rejects(backend.execute(read, context));
  const suspended = backend.snapshot();
  assert.deepEqual(suspended.resources?.session?.filter(session => session.user === "member"), []);
  for (const user of ["peer", "foreign"]) {
    assert.deepEqual(suspended.resources?.session?.find(session => session.user === user), before.resources?.session?.find(session => session.user === user));
    assert.deepEqual(suspended.resources?.user?.find(entry => entry.id === user), before.resources?.user?.find(entry => entry.id === user));
  }
  await backend.execute(request("user", "reactivate", ["member"], { session: "admin" }), context);
  await assert.rejects(backend.execute(read, context));
  assert.deepEqual(backend.snapshot().resources?.session?.filter(session => session.user === "member"), []);
});

test("suspension rejects a member's pending operation without publishing its result or writes", async () => {
  const backend = suspensionFixture();
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = backend.execute(request("item", "share", ["item"], { session: "member" }), { ...context, adminHooks: { "item share": async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { value: "secret-result", resources: { item: [] } }; } } });
  await ready;
  await backend.execute(request("user", "suspend", ["member"], { session: "admin" }), context);
  const suspended = backend.snapshot();
  release();
  await assert.rejects(pending);
  assert.deepEqual(backend.snapshot(), suspended);
});

test("invalid suspension batches leave users and their sessions unchanged", async () => {
  const backend = suspensionFixture();
  const before = backend.snapshot();
  for (const input of ["member\nmissing", "member\nforeign"]) {
    await assert.rejects(backend.execute({ ...request("user", "suspend", ["-"], { session: "admin" }), input }, context));
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("persisted suspended users cannot authenticate and reactivation discards stale seed sessions", async () => {
  const seed = suspensionFixture().snapshot();
  const users = seed.resources!.user!.map(user => user.id === "member" ? { ...user, state: "SUSPENDED" } : user);
  const backend = createObjectBackend({ ...seed, resources: { ...seed.resources, user: users }, clock: { now: () => 1000 } });
  const read = request("secret", "read", ["op://Private/Item/password"], { session: "member" });
  await assert.rejects(backend.execute(read, context));
  await assert.rejects(backend.execute(request("item", "get", ["item"], { account: "account" }), context));
  await backend.execute(request("user", "reactivate", ["member"], { session: "admin" }), context);
  await assert.rejects(backend.execute(read, context));
  assert.deepEqual(backend.snapshot().resources?.session?.filter(session => session.user === "member"), []);
});

test("hook-updated suspension invalidates sessions and cannot issue new credentials to a suspended user", async () => {
  const backend = suspensionFixture();
  await backend.execute(request("user", "suspend", ["member"], { session: "admin" }), { ...context, adminHooks: { "user suspend": async (_request, _context, resources) => ({ resources: { user: resources.get("user")!.map(user => user.id === "member" ? { ...user, state: "SUSPENDED" } : user) } }) } });
  assert.deepEqual(backend.snapshot().resources?.session?.filter(session => session.user === "member"), []);
  const before = backend.snapshot();
  await assert.rejects(backend.execute(request("signin", "", [], { account: "account" }), { ...context, adminHooks: { signin: async () => ({ value: "new-member-token", authentication: { sessions: [{ id: "new", account: "account", user: "member", mode: "manual", token: "new-member-token", issuedAt: 1000, lastActivityAt: 1000 }] } }) } }));
  assert.deepEqual(backend.snapshot(), before);
});
