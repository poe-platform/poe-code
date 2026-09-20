import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { preparePublicSnapshot } from "../shell-stress/invocation-cleanup-runtime/migration/binding.js";

test("private checkout cannot qualify cleanup through retired public sandbox exports", async () => {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  await assert.rejects(preparePublicSnapshot(repository), /Public SafeFS must preserve shared SafeJS runtime identity/);
});
