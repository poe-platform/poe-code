import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bytesSource, executeBytes, type BytesResult } from "../independent-increment/harness.js";

interface Fixture { id: string; argv: string[]; inputHex: string; expected: BytesResult }
const content = readFileSync(new URL("./fresh-native.json", import.meta.url));
const evidence = JSON.parse(content.toString("utf8")) as { cases: Fixture[] };
test("fresh native expectations are unchanged", () => {
  assert.equal(createHash("sha256").update(content).digest("hex"), "2724f85ce5745706a96fb9c0052d84df2cabd28e00811eb9e42ad34be105a4ca");
});
for (const fixture of evidence.cases) {
  for (const size of [65536, 1]) {
    test(`fresh ${fixture.id} chunks=${size}`, async () => {
      const input = bytesSource(Buffer.from(fixture.inputHex, "hex"), size);
      assert.deepEqual(await executeBytes(fixture.argv, input), fixture.expected);
    });
  }
}
