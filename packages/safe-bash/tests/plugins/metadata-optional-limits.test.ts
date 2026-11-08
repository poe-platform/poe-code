import assert from "node:assert/strict";
import test from "node:test";
import { createMetadataCommands } from "../../src/commands/metadata/index.js";

test("metadata composition accepts undefined optional limits for truncate", () => {
  for (const key of ["maxArgumentBytes", "maxArguments", "maxOutputBytes", "maxEntries", "maxDepth", "maxAttempts"]) {
    assert.doesNotThrow(() => createMetadataCommands({ limits: { [key]: undefined } }));
  }
});
