import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";
import { pluginRequiredFieldLabels } from "./plugin-catalog.js";
import type { OpBackendRequest } from "./types.js";

const request: OpBackendRequest = { resource: "plugin", action: "list", args: [], flags: {} };
const context = () => ({ signal: new AbortController().signal });

test("native human required-field labels remain separate from JSON availability and credential schemas", async () => {
  assert.ok(Object.isFrozen(pluginRequiredFieldLabels));
  assert.equal(Object.keys(pluginRequiredFieldLabels).length, 90);
  assert.equal(pluginRequiredFieldLabels.aws, "Access Key ID, Secret Access Key");
  assert.equal(pluginRequiredFieldLabels.tofu, "Depends on configured credentials");
  assert.equal(pluginRequiredFieldLabels.rediscloud, "Account Key, User Key");
  const rows = await createObjectBackend().execute(request, context()) as Record<string, unknown>[];
  assert.ok(rows.every(row => !Object.hasOwn(row, "requiredFields") && !Object.hasOwn(row, "required_fields")));
});

test("empty object backends list the pinned available plugins without fabricating configurations", async () => {
  const backend = createObjectBackend();
  const before = backend.snapshot();
  const result = await backend.execute(request, context()) as Record<string, unknown>[];
  assert.equal(result.length, 90);
  assert.equal(result.filter(plugin => plugin.executable !== undefined).length, 89);
  assert.deepEqual(result.find(plugin => plugin.executable === "aws"), { source: "1password-registry", name: "AWS CLI", executable: "aws", plugin_name: "AWS" });
  assert.deepEqual(result.find(plugin => plugin.plugin_name === "rediscloud"), { source: "1password-registry", plugin_name: "rediscloud" });
  assert.deepEqual(backend.snapshot(), before);
  result[0]!.name = "Changed";
  assert.notDeepEqual(await backend.execute(request, context()), result);
});

test("available catalog entries merge scoped custom identities but never credentials or defaults", async () => {
  const backend = createObjectBackend({ accounts: [{ id: "a" }, { id: "b" }], resources: { plugin: [
    { id: "aws", name: "Configured AWS", account: "a", defaults: [{ configuration: "private" }], credentials: ["private"] },
    { id: "custom", name: "Custom", account: "a", alias: "private", fields: ["private"] },
    { id: "foreign", name: "Foreign", account: "b", credentials: ["private"] }
  ] } });
  const before = backend.snapshot();
  const result = await backend.execute({ ...request, flags: { account: "a" } }, context()) as Record<string, unknown>[];
  assert.equal(result.length, 91);
  assert.equal(result.filter(plugin => plugin.executable === "aws").length, 1);
  assert.ok(result.some(plugin => plugin.id === "custom"));
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.ok(!result.some(plugin => plugin.id === "foreign"));
  assert.deepEqual(backend.snapshot(), before);
  const inspected = await backend.execute({ resource: "plugin", action: "inspect", args: ["custom"], flags: { account: "a" } }, context()) as { id: string };
  assert.equal(inspected.id, "custom");
});

test("metadata-only selection offers available executables but does not invent unconfigured inspect results", async () => {
  const backend = createObjectBackend();
  let calls = 0;
  await assert.rejects(backend.execute({ ...request, action: "inspect" }, { ...context(), selectPlugin(candidates) {
    calls++;
    assert.equal(candidates.length, 89);
    assert.ok(candidates.some(plugin => plugin.id === "aws" && plugin.name === "AWS"));
    assert.ok(!candidates.some(plugin => plugin.id === "rediscloud" || plugin.id === "-"));
    assert.ok(Object.isFrozen(candidates) && candidates.every(Object.isFrozen));
    assert.ok(candidates.every(plugin => Object.keys(plugin).sort().join(",") === "id,name"));
    return "aws";
  } }), { message: "Plugin configuration is unavailable" });
  assert.equal(calls, 1);
  await assert.rejects(backend.execute({ ...request, action: "inspect", args: ["aws"] }, context()), { message: "Plugin configuration is unavailable" });
});
