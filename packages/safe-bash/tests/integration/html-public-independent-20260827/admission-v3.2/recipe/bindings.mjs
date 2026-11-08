import assert from "node:assert/strict";
import { join } from "node:path";
import { authenticate, pin, repository } from "./authenticate.mjs";
import { fileHash } from "./telemetry.mjs";

export function intactBindings(freeze, manifestSha) {
  const result = authenticate(freeze, manifestSha);
  for (const source of pin.previousEvidence.files) assert.equal(fileHash(join(repository, source.path)), source.sha256, source.path);
  return { ...result, oldLiveFilesAuthenticated: pin.previousEvidence.files.length };
}
