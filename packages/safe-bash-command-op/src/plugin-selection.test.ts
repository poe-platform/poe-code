import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import { createOp } from "./index.js";
import type { OpBackendContext, OpBackendRequest } from "./types.js";

const request: OpBackendRequest = { resource: "plugin", action: "inspect", args: [], flags: { account: "a" } };
function fixture() {
  return createObjectBackend({ accounts: [{ id: "a" }, { id: "b" }], resources: { plugin: [
    { id: "aws", name: "AWS", account: "a", defaults: [{ configuration: { value: "synthetic-private" } }] },
    { id: "gh", name: "GitHub", account: "a" }, { id: "foreign", name: "Foreign", account: "b" }
  ] } });
}
const context = (): OpBackendContext => ({ signal: new AbortController().signal });

test("omitted plugin inspection offers only frozen scoped identities and uses the exact selected ID", async () => {
  const backend = fixture();
  const before = backend.snapshot();
  let calls = 0;
  const executionContext: OpBackendContext = { ...context(), selectPlugin(candidates, selection) {
    calls++;
    assert.equal(candidates.length, 89);
    assert.deepEqual(candidates.filter(plugin => ["aws", "gh"].includes(plugin.id)), [{ id: "aws", name: "AWS" }, { id: "gh", name: "GitHub" }]);
    assert.ok(!candidates.some(plugin => plugin.id === "foreign"));
    assert.ok(Object.isFrozen(candidates) && candidates.every(Object.isFrozen));
    assert.ok(Object.isFrozen(selection));
    assert.equal(selection.signal, executionContext.signal);
    assert.equal(selection.accountId, "a");
    return "gh";
  } };
  assert.equal((await backend.execute(request, executionContext) as { id: string }).id, "gh");
  assert.equal(calls, 1);
  assert.deepEqual(backend.snapshot(), before);
});

test("plugin binding preparation neither clones configuration nor reads it and execution does not prompt again", async () => {
  const backend = fixture();
  let calls = 0;
  const executionContext: OpBackendContext = { ...context(), selectPlugin: async () => { calls++; return "aws"; } };
  const clone = globalThis.structuredClone;
  globalThis.structuredClone = (value, options) => {
    assert.ok(!JSON.stringify(value)?.includes("synthetic-private"));
    return clone(value, options);
  };
  let prepared;
  try { prepared = await backend.prepareBinding([request], executionContext); }
  finally { globalThis.structuredClone = clone; }
  assert.deepEqual(prepared.targets.filter(target => target.resource === "plugin").map(target => target.id), ["aws"]);
  assert.deepEqual(prepared.metadata, [{}]);
  const value = await backend.execute(request, { ...executionContext, binding: prepared.handle }) as { id: string };
  assert.equal(value.id, "aws");
  assert.equal(calls, 1);
  backend.cancelBinding(prepared.handle);
});

test("explicit plugin operands bypass selection in direct and bound inspection", async () => {
  const backend = fixture();
  const explicit = { ...request, args: ["AWS"] };
  const executionContext = { ...context(), selectPlugin() { assert.fail("Chooser must not run"); } };
  assert.equal((await backend.execute(explicit, executionContext) as { id: string }).id, "aws");
  const prepared = await backend.prepareBinding([explicit], executionContext);
  assert.equal((await backend.execute(explicit, { ...executionContext, binding: prepared.handle }) as { id: string }).id, "aws");
  backend.cancelBinding(prepared.handle);
});

test("plugin selection never defaults and rejects cancelled, foreign, name-only or nonexact IDs", async () => {
  for (const selected of [undefined, "foreign", "AWS", "GitHub", "missing"]) {
    const backend = fixture();
    const before = backend.snapshot();
    await assert.rejects(backend.execute(request, { ...context(), selectPlugin: () => selected }));
    assert.deepEqual(backend.snapshot(), before);
  }
  const backend = createObjectBackend({ resources: { plugin: [{ id: "only" }] } });
  const unscoped = { ...request, flags: {} };
  await assert.rejects(backend.execute(unscoped, context()), { message: "Plugin selection capability is unavailable" });
  assert.equal((await backend.execute(unscoped, { ...context(), selectPlugin(candidates) {
    assert.equal(candidates.length, 90);
    assert.deepEqual(candidates.find(plugin => plugin.id === "only"), { id: "only", name: "only" });
    return "only";
  } }) as { id: string }).id, "only");
});

test("pending plugin choice rejects cancellation without waiting for the host", async () => {
  const backend = fixture();
  const controller = new AbortController();
  const pending = backend.execute(request, { signal: controller.signal, selectPlugin() {
    controller.abort();
    return new Promise<string>(() => {});
  } });
  await assert.rejects(pending);
});

test("changes during plugin choice or after preparation invalidate the captured generation", async () => {
  const backend = fixture();
  const executionContext = context();
  const mutate = () => backend.execute({ resource: "vault", action: "create", args: ["New"], flags: { account: "a" } }, executionContext);
  await assert.rejects(backend.execute(request, { ...executionContext, async selectPlugin() { await mutate(); return "aws"; } }), { message: "Binding is invalid or no longer current" });
  const prepared = await backend.prepareBinding([request], { ...executionContext, selectPlugin: () => "gh" });
  await mutate();
  await assert.rejects(backend.execute(request, { ...executionContext, binding: prepared.handle }));
});

test("plugin selection sanitizes host errors and never enables other plugin commands or bound hooks", async () => {
  const backend = fixture();
  await assert.rejects(backend.execute(request, { ...context(), selectPlugin() { throw new Error("synthetic-private"); } }), { message: "Plugin selection failed" });
  for (const action of ["list", "init", "clear", "run"]) await assert.rejects(backend.prepareBinding([{ ...request, action }], context()), { message: "Operation does not support bindings" });
  const hooked = createObjectBackend({ resources: { plugin: [{ id: "aws" }] }, adminHooks: { "plugin inspect": () => { assert.fail("Hook must not run"); } } });
  await assert.rejects(hooked.prepareBinding([{ ...request, flags: {}, args: ["aws"] }], context()), { message: "Operation does not support bindings" });
});

test("renaming or replacing a selected plugin cannot retarget a prepared inspection", async () => {
  for (const replacement of [false, true]) {
    const backend = fixture();
    const prepared = await backend.prepareBinding([request], { ...context(), selectPlugin: () => "aws" });
    await backend.execute({ resource: "update", action: "", args: [], flags: { account: "a" } }, {
      ...context(), adminHooks: { update: async (_request, _context, resources) => ({ resources: {
        plugin: resources.get("plugin")!.map(plugin => plugin.id === "aws" ? { ...plugin, id: replacement ? "replacement" : plugin.id, name: "Renamed" } : plugin)
      } }) }
    });
    await assert.rejects(backend.execute(request, { ...context(), binding: prepared.handle }));
    assert.ok(backend.snapshot().resources?.plugin?.some(plugin => plugin.id === "foreign"));
  }
});

test("plugin choice does not refresh managed activity and rejects revocation or expiry while pending", async () => {
  for (const revoke of [false, true]) {
    let now = 1;
    const seed = fixture().snapshot();
    const backend = createObjectBackend({ ...seed, authentication: { mode: "managed" }, clock: { now: () => now }, resources: {
      ...seed.resources, session: [{ id: "session", mode: "manual", token: "synthetic-token", account: "a", issuedAt: 0, lastActivityAt: 0 }]
    } });
    const authenticated = { ...request, flags: { account: "a", session: "synthetic-token" } };
    await assert.rejects(backend.prepareBinding([authenticated], { ...context(), async selectPlugin() {
      assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, 0);
      if (revoke) await backend.execute({ resource: "signout", action: "", args: [], flags: authenticated.flags }, context());
      else now = 1_800_001;
      return "aws";
    } }));
    assert.equal(backend.snapshot().resources?.session?.[0]?.lastActivityAt, revoke ? undefined : 0);
  }
});

test("an unconfigured backend still requires an explicit host selection capability", async () => {
  await assert.rejects(createObjectBackend().execute({ ...request, flags: {} }, context()), { message: "Plugin selection capability is unavailable" });
});

test("public resolved inspection chooses only after resolution permission and reads only after approval", async () => {
  for (const permission of ["deny", "deny-resolution", "approve"] as const) {
    const backend = fixture();
    const events: string[] = [];
    let output = "";
    const command = createOp({
      backend: { ...backend, async execute(request, context) { events.push("execute"); return backend.execute(request, context); } },
      authorize() { events.push("authorize"); return permission === "deny" ? "deny" : "ask"; },
      authorizeResolution() { events.push("resolution"); return permission !== "deny-resolution"; },
      approveResolved(manifest) {
        events.push("approve");
        assert.deepEqual(manifest.targets.filter(target => target.resource === "plugin").map(target => target.id), ["gh"]);
        return true;
      }
    });
    const result = await command.execute({
      args: ["plugin", "inspect", "--account", "a", "--format", "json"], env: {}, ...context(),
      selectPlugin() { events.push("choose"); return "gh"; },
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { events.push("output"); output += new TextDecoder().decode(bytes); } },
      stderr: { async write() {} }
    });
    assert.equal(result.exitCode, permission === "approve" ? 0 : 1);
    assert.deepEqual(events, permission === "deny" ? ["authorize"] : permission === "deny-resolution" ? ["authorize", "resolution"] : ["authorize", "resolution", "choose", "approve", "execute", "output"]);
    if (permission === "approve") assert.equal(JSON.parse(output).id, "gh");
    else assert.equal(output, "");
  }
});
