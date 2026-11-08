import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wget depends on the shared network engine, not another command", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.devDependencies["safe-bash-network-engine"], "*");
  assert.equal(manifest.devDependencies["safe-bash-command-curl"], undefined);
});
