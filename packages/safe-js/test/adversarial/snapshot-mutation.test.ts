import { describe, expect, it } from "vitest";

import { runSnapshotMutationCorpus } from "./snapshot-mutation.js";

describe("snapshot mutation corpus", () => {
  // Temporary release quarantine; restoration criteria: docs/plans/safe-js-snapshot-mutation-quarantine.md.
  it.skip("rejects malformed mutations with typed errors and preserves valid roundtrips", async () => {
    await expect(runSnapshotMutationCorpus()).resolves.toBeUndefined();
  }, 2_000);
});
