import assert from "node:assert/strict";
import { atomicMockBinding } from "../atomic-webdav-profile/atomic-mock.js";
import { withFixture, type AdapterName, type Fixture } from "../fixtures.js";

export function withRmdirFixture(name: AdapterName, run: (fixture: Fixture) => Promise<void>): Promise<void> {
  return withFixture(name, async fixture => {
    if (name === "s3") {
      assert.equal(fixture.fs.capabilities.snapshotRmdir, true, "S3 positive removal uses the weaker explicit snapshot-marker profile, not atomic emptiness");
    }
    return run(fixture);
  }, undefined, name === "webdav" ? { webdavAtomicBinding: atomicMockBinding } : {});
}
