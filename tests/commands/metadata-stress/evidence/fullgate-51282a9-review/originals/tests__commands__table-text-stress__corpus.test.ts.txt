import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cases } from "./cases.js";
import { hash, native, product, verifyOracle, type Fixture, type Row } from "./support.js";

const corpus: { fixture: Fixture; inputSha256: string; oracle: Row }[] = JSON.parse(await readFile(new URL("frozen-corpus.json", import.meta.url), "utf8"));
assert.equal(corpus.length, 71);
for (const [index, entry] of corpus.entries()) {
  test(`independent frozen GNU: ${entry.fixture.name}`, async () => {
    assert.deepEqual(entry.fixture, cases[index]);
    assert.equal(entry.inputSha256, hash(JSON.stringify(entry.fixture)));
    const actual = await product(entry.fixture);
    assert.deepEqual(actual.files, entry.oracle.files);
    assert.equal(actual.stdoutHex, entry.oracle.stdoutHex);
    if (entry.fixture.name === "comm shared original") {
      assert.equal(entry.oracle.exitCode, 1);
      assert.equal(Buffer.from(entry.oracle.stderrHex, "hex").toString(), "comm: -: Bad file descriptor\n");
      assert.equal(actual.exitCode, 1);
      assert.equal(Buffer.from(actual.stderrHex, "hex").toString(), "comm: -: Bad file descriptor\n");
    } else {
      assert.equal(actual.exitCode, entry.oracle.exitCode);
      assert.equal(Boolean(actual.stderrHex), Boolean(entry.oracle.stderrHex));
    }
  });
}
test("independent live GNU rechecks all 71 frozen rows exactly", async () => {
  await verifyOracle();
  for (const entry of corpus) assert.deepEqual(await native(entry.fixture), entry.oracle, entry.fixture.name);
});
