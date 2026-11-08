import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPeerBinding } from "../../scripts/typecheck-consumers.mjs";
import { bindPeerArtifact } from "../plugins/qualified-current-release/peer.mjs";

test("private checkout cannot qualify cleanup without an explicit canonical peer artifact", () => {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.throws(() => bindPeerArtifact({ root: repository,
    declarations: { peer: createPeerBinding(repository, manifest) },
  }), /An explicit canonical peer artifact is required/);
});
