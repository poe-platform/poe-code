import { describe, expect, it } from "vitest";

import { runSnapshotMutationCorpus } from "./snapshot-mutation.js";

describe("snapshot mutation corpus", () => {
  it("rejects malformed mutations with typed errors and preserves valid roundtrips", async () => {
    await expect(runSnapshotMutationCorpus()).resolves.toBeUndefined();
  }, 2_000);
});
