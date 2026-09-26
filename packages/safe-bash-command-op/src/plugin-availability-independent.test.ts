import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./index.js";
import { availablePlugins } from "./plugin-catalog.js";
import type { OpBackendRequest } from "./types.js";

const list: OpBackendRequest = { resource: "plugin", action: "list", args: [], flags: {} };
const context = () => ({ signal: new AbortController().signal });

test("native executable metadata wins configured label collisions without moving registry rows", () => {
  const native = availablePlugins([]);
  const merged = availablePlugins([
    { id: "custom-first", name: "First", credentials: "private" },
    { id: "AWS", name: "Override", defaults: "private" },
    { id: "CUSTOM-FIRST", name: "Duplicate" },
    { id: "custom-second", name: "Second" },
  ]);
  assert.deepEqual(merged.slice(0, native.length), native);
  assert.deepEqual(merged.slice(native.length), [{ id: "custom-first", name: "First" }, { id: "custom-second", name: "Second" }]);
  assert.equal(merged.filter(row => row.executable === "aws").length, 1);
  assert.equal(JSON.stringify(merged).includes("private"), false);
  assert.equal(new Set(native.flatMap(row => row.executable ? [row.executable] : [])).size, 89);
  assert.deepEqual(native.filter(row => row.executable === undefined), [{ source: "1password-registry", plugin_name: "rediscloud" }]);
});

test("managed local availability preserves account isolation and resolves a native executable to its configured ID", async () => {
  const backend = createObjectBackend({ authentication: { mode: "managed" }, accounts: [{ id: "work" }, { id: "personal" }], resources: { plugin: [
    { id: "AWS", account: "work", name: "Configured override", credentials: "work-private" },
    { id: "custom-work", account: "work", name: "Work" },
    { id: "custom-personal", account: "personal", name: "Personal", credentials: "personal-private" },
  ] } });
  const before = backend.snapshot();
  const rows = await backend.execute({ ...list, flags: { account: "work" } }, context()) as Record<string, unknown>[];
  assert.equal(rows.length, 91);
  assert.deepEqual(rows.at(-1), { id: "custom-work", name: "Work" });
  assert.ok(!JSON.stringify(rows).includes("private"));
  let selections = 0;
  const executionContext = { ...context(), selectPlugin(candidates: readonly Readonly<{ id: string; name: string }>[]) {
    selections++;
    assert.equal(candidates.filter(candidate => candidate.id === "aws").length, 1);
    assert.deepEqual(candidates.find(candidate => candidate.id === "aws"), { id: "aws", name: "AWS" });
    assert.equal(candidates.some(candidate => candidate.id === "custom-personal"), false);
    return "aws";
  } };
  const inspect = { ...list, action: "inspect", flags: { account: "work" } };
  const binding = await backend.prepareBinding([inspect], executionContext);
  assert.deepEqual(binding.targets.filter(target => target.resource === "plugin").map(target => target.id), ["AWS"]);
  const inspected = await backend.execute(inspect, { ...executionContext, binding: binding.handle }) as { id: string };
  assert.equal(inspected.id, "AWS");
  assert.equal(selections, 1);
  backend.cancelBinding(binding.handle);
  assert.deepEqual(backend.snapshot(), before);
  await assert.rejects(backend.execute({ ...list, flags: { account: "work", session: "invalid" } }, context()), { message: "Invalid session" });
  await assert.rejects(backend.execute({ ...inspect, flags: { account: "missing" } }, { ...context(), selectPlugin() { assert.fail("Invalid account must not reach selection"); } }), { message: "Account selection is required" });
  await assert.rejects(backend.execute({ resource: "vault", action: "list", args: [], flags: { account: "work" } }, context()), { message: "No authenticated session" });
  assert.deepEqual(backend.snapshot(), before);
});
