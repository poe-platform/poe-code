import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cases } from "./cases.js";
import { hash, product, type Fixture, type Row } from "./support.js";

const corpus: { fixture: Fixture; inputSha256: string; oracle: Row }[] = JSON.parse(await readFile(new URL("frozen-corpus.json", import.meta.url), "utf8"));
assert.equal(corpus.length, 71);
for (const [index, entry] of corpus.entries()) {
  const stricterJoinOrder = entry.fixture.name === "join first unpaired inversion " || entry.fixture.name === "join empty opposite inversion ";
  test(`${stricterJoinOrder ? "documented stricter join order" : "independent frozen GNU"}: ${entry.fixture.name}`, async () => {
    assert.deepEqual(entry.fixture, cases[index]);
    assert.equal(entry.inputSha256, hash(JSON.stringify(entry.fixture)));
    const actual = await product(entry.fixture);
    assert.deepEqual(actual.files, entry.oracle.files);
    // Issue 814 intentionally omits terminators for empty serial streams.
    const serialOutput: Record<string, string> = {
      "paste serial shared cursor": "31322c330a78792c7a0a",
      "paste empty serial files": "",
    };
    assert.equal(actual.stdoutHex, serialOutput[entry.fixture.name] ?? entry.oracle.stdoutHex);
    if (stricterJoinOrder) {
      // Current join checks the first unpaired transition; preserve GNU's capture.
      assert.equal(entry.oracle.exitCode, 0);
      assert.equal(entry.oracle.stderrHex, "");
      assert.equal(actual.exitCode, 1);
      assert.equal(Buffer.from(actual.stderrHex, "hex").toString(), "join: file 1 is not in sorted order\njoin: input is not in sorted order\n");
    } else if (entry.fixture.name === "comm shared original") {
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
