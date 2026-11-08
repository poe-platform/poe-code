import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import type { OpBackendRequest, OpSession } from "./types.js";

const operation = (resource: string, action: string, flags: OpBackendRequest["flags"] = {}, args: string[] = []): OpBackendRequest => ({ resource, action, args, flags });
const appContext = (terminalId = "one") => ({ signal: new AbortController().signal, authentication: { integration: "app" as const, terminalId } });
function fixture() {
  let now = 1000;
  const backend = createObjectBackend({ authentication: { mode: "managed" }, clock: { now: () => now }, accounts: [{ id: "a", shorthand: "first" }, { id: "b", shorthand: "second" }], resources: {
    session: ["a", "b"].flatMap<OpSession>(account => [
      ...["one", "two"].map<OpSession>(terminalId => ({ id: `${account}-${terminalId}`, mode: "app", terminalId, account, issuedAt: 0, lastActivityAt: 0, identity: { account } })),
      { id: `${account}-manual`, mode: "manual", token: `${account}-token`, account, issuedAt: 0, lastActivityAt: 0, identity: { account } },
    ]),
  } });
  return { backend, setTime(value: number) { now = value; } };
}

test("app preference follows successful signin across terminals, including reuse, but not reads", async () => {
  const { backend } = fixture();
  await backend.execute(operation("signin", "", { account: "first" }), appContext());
  await backend.execute(operation("signin", "", { account: "second" }), appContext("two"));
  assert.deepEqual(await backend.execute(operation("whoami", ""), appContext()), { account: "b" });
  assert.deepEqual(await backend.execute(operation("whoami", "", { account: "first" }), appContext()), { account: "a" });
  assert.deepEqual(await backend.execute(operation("whoami", ""), appContext()), { account: "b" });
  await backend.execute(operation("signin", "", { account: "first" }), appContext());
  assert.deepEqual(await backend.execute(operation("whoami", ""), appContext("two")), { account: "a" });
  assert.equal(backend.snapshot().resources?.["app default"]?.length, 1);
  assert.ok(backend.snapshot().resources?.session?.every(session => session.issuedAt === 0));
  const restored = createObjectBackend({ ...backend.snapshot(), clock: { now: () => 1000 } });
  assert.deepEqual(await restored.execute(operation("whoami", ""), appContext("two")), { account: "a" });
});

test("stored app authorization never enables integration implicitly and invalid modes fail closed", async () => {
  const { backend } = fixture();
  for (const authentication of [{ terminalId: "one" }, { terminalId: "one", integration: "manual" as const }]) {
    await assert.rejects(backend.execute(operation("whoami", "", { account: "a" }), { signal: new AbortController().signal, authentication }));
  }
  const invalidModes: unknown[] = [null, false, "invalid"];
  for (const integration of invalidModes) await assert.rejects(backend.execute(operation("whoami", "", { session: "a-token" }), { ...appContext(), authentication: { terminalId: "one", integration: integration as "app" } }));
  await assert.rejects(backend.execute(operation("whoami", "", { account: "a", session: "wrong" }), appContext()));
  await assert.rejects(backend.execute(operation("whoami", "", { account: "b", session: "a-token" }), appContext()));
});

test("global account preference does not grant authorization in another terminal or guess an initial account", async () => {
  const { backend } = fixture();
  await assert.rejects(backend.execute(operation("signin", ""), appContext()));
  await assert.rejects(backend.execute(operation("whoami", ""), appContext()));
  await backend.execute(operation("signin", "", { account: "a" }), appContext());
  await assert.rejects(backend.execute(operation("whoami", ""), appContext("unauthorized")));
});

test("app signin without a preference requires explicit selection even for one account", async () => {
  let calls = 0;
  const backend = createObjectBackend({ authentication: { mode: "managed" }, clock: { now: () => 1000 }, accounts: [{ id: "sole" }], resources: { session: [{ id: "app", account: "sole", mode: "app", terminalId: "one", issuedAt: 0, lastActivityAt: 0 }] }, adminHooks: { signin: async () => {
    calls++;
    return { authentication: { sessions: [{ id: "manual", account: "sole", mode: "manual", token: "manual-token", issuedAt: 1000, lastActivityAt: 1000 }] } };
  } } });
  const before = backend.snapshot();
  await assert.rejects(backend.execute(operation("signin", ""), appContext()), { message: "Account selection is required" });
  await assert.rejects(backend.execute(operation("whoami", ""), appContext()), { message: "Account selection is required" });
  assert.equal(calls, 0);
  assert.deepEqual(backend.snapshot(), before);
  await backend.execute(operation("signin", "", { account: "sole" }), appContext());
  assert.equal(backend.snapshot().resources?.["app default"]?.[0]?.account, "sole");
  await backend.execute(operation("signin", ""), { ...appContext(), authentication: { integration: "manual", terminalId: "one" } });
  assert.equal(calls, 1);
  assert.equal(backend.snapshot().resources?.["session default"]?.[0]?.account, "sole");
});

test("manual defaults remain terminal local and require bearer possession", async () => {
  const { backend } = fixture();
  for (const [terminalId, account] of [["one", "a"], ["two", "b"]] as const) await backend.execute(operation("signin", "", { session: `${account}-token` }), { ...appContext(terminalId), authentication: { terminalId, integration: "manual" } });
  assert.deepEqual(backend.snapshot().resources?.["session default"]?.map(entry => [entry.terminalId, entry.account]), [["one", "a"], ["two", "b"]]);
  assert.equal(backend.snapshot().resources?.["app default"], undefined);
  await assert.rejects(backend.execute(operation("whoami", ""), { ...appContext(), authentication: { integration: "manual", terminalId: "one" } }));
  assert.deepEqual(await backend.execute(operation("whoami", "", { session: "a-token" }), { ...appContext("two"), authentication: { integration: "manual", terminalId: "two" } }), { account: "a" });
});

test("expiry and signout retain app preference while account forgetting removes it", async () => {
  const { backend, setTime } = fixture();
  await backend.execute(operation("signin", "", { account: "a" }), appContext());
  const preference = backend.snapshot().resources?.["app default"];
  setTime(601_000);
  await assert.rejects(backend.execute(operation("whoami", ""), appContext()));
  assert.deepEqual(backend.snapshot().resources?.["app default"], preference);
  await backend.execute(operation("signout", ""), appContext());
  assert.deepEqual(backend.snapshot().resources?.["app default"], preference);
  assert.ok(backend.snapshot().resources?.session?.some(session => session.account === "b"));
  await backend.execute(operation("account", "forget", {}, ["a"]), appContext());
  assert.deepEqual(backend.snapshot().resources?.["app default"], []);
});

test("conflicting concurrent app signins fail atomically without overwriting the winner", async () => {
  const { backend } = fixture();
  await backend.execute(operation("signin", "", { account: "a" }), appContext());
  let release!: () => void;
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const pending = backend.execute(operation("signin", "", { account: "a" }), { ...appContext("new-terminal"), adminHooks: { signin: async (_request, _context, resources) => {
    entered();
    await new Promise<void>(resolve => { release = resolve; });
    const granted: OpSession = { id: "new-authorization", account: "a", mode: "app", terminalId: "new-terminal", issuedAt: 1000, lastActivityAt: 1000 };
    return { authentication: { sessions: [...resources.get("session") as OpSession[], granted], signedInSession: granted.id } };
  } } });
  await ready;
  await backend.execute(operation("signin", "", { account: "b" }), appContext("two"));
  const winner = backend.snapshot();
  release();
  await assert.rejects(pending);
  assert.deepEqual(backend.snapshot(), winner);
});

test("signin hooks may issue authorization after admission but cannot publish an expired grant", async () => {
  const { backend, setTime } = fixture();
  const hook = async () => {
    setTime(2000);
    return { authentication: { sessions: [{ id: "fresh", account: "a", mode: "app" as const, terminalId: "fresh-terminal", issuedAt: 2000, lastActivityAt: 2000 }] } };
  };
  await backend.execute(operation("signin", "", { account: "a" }), { ...appContext("fresh-terminal"), adminHooks: { signin: hook } });
  assert.equal(backend.snapshot().resources?.["app default"]?.[0]?.account, "a");
  const before = backend.snapshot();
  setTime(1_000_000);
  await assert.rejects(backend.execute(operation("signin", "", { account: "a" }), { ...appContext("fresh-terminal"), adminHooks: { signin: async () => ({ authentication: { sessions: [{ id: "expired", account: "a", mode: "app", terminalId: "fresh-terminal", issuedAt: 0, lastActivityAt: 0 }] } }) } }));
  assert.deepEqual(backend.snapshot(), before);
});
