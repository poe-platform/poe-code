import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";

const context = { signal: new AbortController().signal };

test("invalid vault icon and travel mode values fail without changing state", async () => {
  for (const [action, args, flags, input] of [
    ["create", ["New"], { icon: "invalid-private-icon" }, undefined],
    ["edit", ["vault"], { icon: "invalid-private-icon" }, undefined],
    ["edit", ["vault"], { "travel-mode": "invalid-private-mode" }, undefined],
    ["create", ["New"], {}, { icon: 123 }],
    ["edit", ["vault"], {}, { "travel-mode": true }],
  ] as const) {
    const backend = createObjectBackend({ vaults: [{ id: "vault", name: "Private" }] });
    const before = backend.snapshot();
    await assert.rejects(backend.execute({ resource: "vault", action, args, flags, input }, context), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("private"));
      return true;
    });
    assert.deepEqual(backend.snapshot(), before);
  }
});

test("documented vault options persist on create and edit", async () => {
  const backend = createObjectBackend();
  const created = await backend.execute({ resource: "vault", action: "create", args: ["Private"], flags: { icon: "vault-door" } }, context) as { id: string; icon: string };
  assert.equal(created.icon, "vault-door");
  for (const mode of ["on", "off"]) {
    const edited = await backend.execute({ resource: "vault", action: "edit", args: [created.id], flags: { icon: "heart-with-monitor", "travel-mode": mode } }, context) as Record<string, unknown>;
    assert.equal(edited.icon, "heart-with-monitor");
    assert.equal(edited["travel-mode"], mode);
  }
});
