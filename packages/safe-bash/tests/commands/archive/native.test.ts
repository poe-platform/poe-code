import assert from "node:assert/strict";
import test from "node:test";
import { archive, binary, fixture, member } from "./helpers.js";

test("archive rejects forward hardlinks before extraction", async () => {
const bytes = archive(member("hard", new Uint8Array(), "1", "later"), member("later", binary));
const { shell } = await fixture();
try {
      const virtual = await shell.exec("tar xf - -C /out", { stdin: bytes });
      assert.equal(virtual.exitCode, 2);
      assert.match(virtual.stderr, /forward or unselected target/u);
    } finally { await shell.dispose(); }
});
