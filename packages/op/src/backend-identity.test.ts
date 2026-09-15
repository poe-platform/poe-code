import assert from "node:assert/strict";
import { test } from "node:test";
import { createObjectBackend } from "./backend.js";

test("generated IDs avoid existing identifiers case-insensitively", async () => {
  const existing = "1".padStart(26, "A");
  const backend = createObjectBackend({ vaults: [{ id: existing, name: "Existing" }] });
  const created = await backend.execute({ resource: "vault", action: "create", args: ["New"], flags: {} }, { signal: new AbortController().signal }) as { id: string };
  assert.notEqual(created.id.toLowerCase(), existing.toLowerCase());
  const stored = await backend.execute({ resource: "vault", action: "get", args: [existing.toLowerCase()], flags: {} }, { signal: new AbortController().signal }) as { name: string };
  assert.equal(stored.name, "Existing");
});
