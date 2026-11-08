import assert from "node:assert/strict";
import { test } from "node:test";
import { executeAdminRequest, type OpAdminContext } from "./admin.js";
import { createOp, type OpCommandContext } from "./index.js";
import type { OpBackendContext, OpBackendRequest, OpObject, PluginClearConfirmation, PluginDefault, PluginScope } from "./types.js";

const scope = { cwd: "/home/user/projects/app", home: "/home/user", terminalSession: "terminal" };
const setting = (id: string, defaultScope: PluginScope): PluginDefault => ({ id, scope: defaultScope, configuration: { credential: `secret-${id}` } });
const defaults = () => [
  setting("global", { kind: "global" }),
  setting("home", { kind: "directory", path: scope.home }),
  setting("project", { kind: "directory", path: "/home/user/projects" }),
  setting("cwd", { kind: "directory", path: scope.cwd }),
  setting("terminal", { kind: "terminal", terminalSession: "terminal" }),
  setting("other-terminal", { kind: "terminal", terminalSession: "other" }),
  setting("sibling", { kind: "directory", path: "/home/user/projects/application" }),
  setting("above-home", { kind: "directory", path: "/home" }),
];
function fixture(pluginDefaults = defaults()) {
  const resources = new Map<string, OpObject[]>([["plugin", [
    { id: "aws", name: "AWS", defaults: pluginDefaults, alias: "op plugin run -- aws" },
    { id: "gh", defaults: defaults() },
  ]]]);
  const context: OpBackendContext = { signal: new AbortController().signal, pluginScope: scope };
  const clear = (flags: OpBackendRequest["flags"] = { force: true }, executionContext = context) => executeAdminRequest({ resource: "plugin", action: "clear", args: ["aws"], flags }, executionContext, resources);
  const ids = () => (resources.get("plugin")![0]!.defaults as PluginDefault[]).map(entry => entry.id);
  return { resources, context, clear, ids };
}

test("clear removes terminal then cwd then ancestors through HOME then global", async () => {
  const { clear, ids } = fixture();
  for (const removed of ["terminal", "cwd", "project", "home", "global"]) {
    const before = ids();
    await clear();
    assert.deepEqual(ids(), before.filter(id => id !== removed));
  }
  await clear();
  assert.deepEqual(ids(), ["other-terminal", "sibling", "above-home"]);
});

test("--all preserves unrelated scopes, other plugins and catalog metadata", async () => {
  const { clear, ids, resources } = fixture();
  const other = structuredClone(resources.get("plugin")![1]);
  await clear({ all: true, force: true });
  assert.deepEqual(ids(), ["other-terminal", "sibling", "above-home"]);
  assert.deepEqual(resources.get("plugin")![1], other);
  assert.equal(resources.get("plugin")![0]!.alias, "op plugin run -- aws");
});

test("missing terminal identity never matches terminal defaults", async () => {
  const { clear, context, ids } = fixture();
  await clear({ force: true }, { ...context, pluginScope: { cwd: scope.cwd, home: scope.home } });
  assert.ok(ids().includes("terminal"));
  assert.ok(!ids().includes("cwd"));
});

for (const paths of [
  { cwd: "C:/Users/User/app", home: "C:/Users/User", parent: "C:/Users" },
  { cwd: "//server/share/user/app", home: "//server/share/user", parent: "//server/share" },
  { cwd: "/work/app", home: "/home/user", parent: "/" },
]) test(`normalized portable scope ancestry: ${paths.cwd}`, async () => {
  const { clear, context, ids } = fixture([
    setting("global", { kind: "global" }), setting("cwd", { kind: "directory", path: paths.cwd }),
    setting("parent", { kind: "directory", path: paths.parent }),
  ]);
  await clear({ all: true, force: true }, { ...context, pluginScope: paths });
  assert.deepEqual(ids(), paths.cwd === "/work/app" ? [] : ["parent"]);
});

for (const invalid of ["relative", "C:relative", "C:\\Users\\User", "/home/../user", "/home//user", "/home/user/", "//server", "/home/./user", "/home/\u0000user"]) {
  test(`rejects noncanonical scope path ${JSON.stringify(invalid)} atomically`, async () => {
    const { clear, context, resources } = fixture();
    const before = structuredClone(resources);
    await assert.rejects(clear({ force: true }, { ...context, pluginScope: { cwd: invalid, home: scope.home } }), { message: "Plugin scope requires normalized absolute paths" });
    assert.deepEqual(resources, before);
  });
}

test("legacy configuration remains readable but clear requires explicit migration", async () => {
  const { resources, context, clear } = fixture();
  resources.get("plugin")![0] = { id: "aws", configuration: { credential: "legacy-secret" } };
  const before = structuredClone(resources);
  for (const action of ["inspect", "list"]) {
    const result = await executeAdminRequest({ resource: "plugin", action, args: action === "inspect" ? ["aws"] : [], flags: {} }, context, resources);
    assert.ok(JSON.stringify(result.value).includes("legacy-secret"));
  }
  await assert.rejects(clear(), { message: "Plugin configuration requires explicit scope migration" });
  assert.deepEqual(resources, before);
});

test("clear requires trusted scope even when forced; inspect omission requires selector capability", async () => {
  const { resources, context, clear } = fixture();
  await assert.rejects(clear({ force: true }, { signal: context.signal }), { message: "Plugin scope context is unavailable" });
  await assert.rejects(executeAdminRequest({ resource: "plugin", action: "inspect", args: [], flags: {} }, context, resources), { message: "Plugin selection capability is unavailable" });
});

test("confirmation is required unless forced and denial is atomic", async () => {
  const { clear, context, resources } = fixture();
  const before = structuredClone(resources);
  await assert.rejects(clear({}), { message: "Plugin clear confirmation capability is unavailable" });
  await assert.rejects(clear({}, { ...context, confirmPluginClear: () => false }), { message: "Plugin clear was not confirmed" });
  assert.deepEqual(resources, before);
  await clear({ force: true }, { ...context, confirmPluginClear: () => { throw new Error("must not run"); } });
});

test("confirmation contains only selected immutable metadata and callback errors stay private", async () => {
  const { clear, context, resources } = fixture();
  let observed: PluginClearConfirmation | undefined;
  let observedSignal: AbortSignal | undefined;
  await assert.rejects(clear({}, { ...context, confirmPluginClear: (confirmation, invocation) => {
    observed = confirmation;
    observedSignal = invocation.signal;
    throw new Error("secret-provider-detail");
  } }), { message: "Plugin clear confirmation failed" });
  assert.deepEqual(observed, { pluginId: "aws", defaults: [{ id: "terminal", scope: { kind: "terminal", terminalSession: "terminal" } }] });
  assert.equal(observedSignal, context.signal);
  assert.ok(Object.isFrozen(observed!.defaults[0]!.scope));
  assert.equal((resources.get("plugin")![0]!.defaults as PluginDefault[]).length, 8);
});

test("pending confirmation binds scope, preserves concurrent unrelated writes and aborts promptly", async () => {
  for (const abort of [false, true]) {
    const { clear, context, resources, ids } = fixture();
    const controller = new AbortController();
    let approve!: (accepted: boolean) => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const mutableScope = { ...scope };
    const execution = clear({}, { ...context, signal: controller.signal, pluginScope: mutableScope, confirmPluginClear: () => {
      entered();
      return new Promise<boolean>(resolve => { approve = resolve; });
    } });
    await Promise.race([ready, execution.then(() => { throw new Error("Clear finished before confirmation"); })]);
    mutableScope.terminalSession = "other";
    resources.get("plugin")![1]!.name = "Concurrent";
    resources.set("group", [{ id: "new" }]);
    if (abort) {
      controller.abort();
      await assert.rejects(execution, { name: "AbortError" });
      approve(true);
      assert.ok(ids().includes("terminal"));
    } else {
      approve(true);
      await execution;
      assert.ok(!ids().includes("terminal"));
    }
    assert.ok(ids().includes("other-terminal"));
    assert.equal(resources.get("plugin")![1]!.name, "Concurrent");
    assert.deepEqual(resources.get("group"), [{ id: "new" }]);
  }
});

test("duplicate defaults and concurrent selected-plugin mutations fail atomically", async () => {
  const duplicate = fixture([setting("one", { kind: "global" }), setting("two", { kind: "global" })]);
  await assert.rejects(duplicate.clear(), { message: "Plugin defaults contain duplicate IDs or scopes" });
  const { clear, context, resources } = fixture();
  await assert.rejects(clear({}, { ...context, confirmPluginClear: () => {
    resources.get("plugin")![0]!.name = "Changed";
    return true;
  } }), { message: "Plugin changed during confirmation" });
  assert.equal(resources.get("plugin")![0]!.name, "Changed");
});

test("--force never bypasses central authorization", async () => {
  let backendCalls = 0;
  let confirmations = 0;
  const context: OpCommandContext = {
    args: ["plugin", "clear", "aws", "--force"], env: {}, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write() {} },
    async readFile() { throw new Error("Unexpected read"); },
    async writeFile() { throw new Error("Unexpected write"); },
    async invoke() { throw new Error("Unexpected spawn"); },
  };
  const op = createOp({
    backend: { async execute() { backendCalls++; } },
    authorize: () => "deny", approve: () => { confirmations++; return true; },
  });
  assert.equal((await op.execute(context)).exitCode, 1);
  assert.equal(backendCalls, 0);
  assert.equal(confirmations, 0);
});

test("account-scoped clear preserves other-account plugin defaults", async () => {
  const { resources, context } = fixture();
  resources.set("account", [{ id: "work" }, { id: "personal" }]);
  resources.get("plugin")![0]!.account = "work";
  resources.get("plugin")![1]!.account = "personal";
  const before = structuredClone(resources.get("plugin")![1]);
  await executeAdminRequest({ resource: "plugin", action: "clear", args: ["aws"], flags: { force: true, all: true, account: "work" } }, context, resources);
  assert.deepEqual(resources.get("plugin")!.find(entry => entry.id === "gh"), before);
});

for (const action of ["init", "run", "clear"]) test(`plugin ${action} hooks receive detached frozen scope without confirmation capability`, async () => {
  const { resources, context } = fixture();
  const sourceScope = { ...scope };
  let observed: OpBackendContext | undefined;
  const executionContext: OpAdminContext = {
    ...context, pluginScope: sourceScope, confirmPluginClear: () => true,
    adminHooks: { [`plugin ${action}`]: async (_request, hookContext) => {
      observed = hookContext;
      sourceScope.cwd = "/changed";
      return {};
    } },
  };
  await executeAdminRequest({ resource: "plugin", action, args: ["aws"], flags: {} }, executionContext, resources);
  assert.deepEqual(observed?.pluginScope, scope);
  assert.notEqual(observed?.pluginScope, sourceScope);
  assert.ok(Object.isFrozen(observed));
  assert.ok(Object.isFrozen(observed?.pluginScope));
  assert.equal(observed?.signal, context.signal);
  assert.deepEqual(Object.keys(observed!).sort(), ["pluginScope", "signal"]);
});

for (const malformed of [
  [{ id: "one", scope: { kind: "directory", path: "relative" }, configuration: {} }],
  [{ id: "one", scope: { kind: "terminal", terminalSession: "" }, configuration: {} }],
  [{ id: "one", scope: { kind: "invented" }, configuration: {} }],
  [{ id: "one", scope: { kind: "global" }, configuration: [] }],
  [setting("duplicate", { kind: "global" }), setting("duplicate", { kind: "directory", path: "/" })],
]) test("malformed persisted defaults fail atomically", async () => {
  const { resources, clear } = fixture();
  resources.get("plugin")![0]!.defaults = malformed;
  const before = structuredClone(resources);
  await assert.rejects(clear());
  assert.deepEqual(resources, before);
});
