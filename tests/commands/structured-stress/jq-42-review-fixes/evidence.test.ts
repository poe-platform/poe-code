import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("nearby native bytes remain frozen before the source fix", () => {
  const bytes = readFileSync(new URL("./native-frozen.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "dd7a8d16d32ed2083e2fef49de2f9b59471aeb6b0ebe6959b38e3a42d7b35743");
});

test("all original author and independent evidence paths remain unchanged", () => {
  const evidence = JSON.parse(readFileSync(new URL("./immutable-before.json", import.meta.url), "utf8")) as { files: Record<string, string> };
  for (const [path, hash] of Object.entries(evidence.files)) {
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), hash, path);
  }
});
