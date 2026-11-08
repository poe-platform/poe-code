import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const capture = JSON.parse(await readFile(new URL("capture.json", import.meta.url), "utf8"));
const provenance = JSON.parse(await readFile(new URL("provenance.json", import.meta.url), "utf8"));

test("historical capture retains all raw bytes, statuses, and 192 distinct observations", () => {
  assert.equal(capture.records.length, 192);
  const keys = new Set();
  const checkBytes = value => {
    if (value === null || typeof value !== "object") return;
    if ("hex" in value) assert.equal(Buffer.from(value.utf8).toString("hex"), value.hex);
    for (const child of Object.values(value)) checkBytes(child);
  };
  for (const record of capture.records) {
    const key = `${record.tool}:${record.id}:${record.generator}:${record.engine}`;
    assert(!keys.has(key), key);
    keys.add(key);
    assert.equal(record.actual.signal, null);
    assert.equal(record.actual.error, null);
    checkBytes(record);
  }
  assert.equal(capture.records.filter(record => record.tool === "diff").length, 18);
  assert.equal(capture.records.filter(record => record.generator === "literal").length, 66);
});

test("historical summary preserves failures rather than treating capture as acceptance", () => {
  for (const engine of ["gnu", "bsd", "product"]) {
    const records = capture.records.filter(record => record.engine === engine);
    assert.equal(records.length, 64);
    for (const record of records) {
      const reference = capture.records.find(candidate => candidate.engine === "gnu" && candidate.tool === record.tool && candidate.id === record.id && candidate.generator === record.generator);
      if (record.tool === "patch") {
        assert.equal(record.pass, record.actual.exitCode === record.expected.exitCode && record.actual.target?.hex === record.expected.target?.hex);
        assert.equal(record.matchesGnuStatusTarget, record.actual.exitCode === reference.actual.exitCode && record.actual.target?.hex === reference.actual.target?.hex);
      } else {
        assert.equal(record.matchesGnuBytes, record.actual.stdout.hex === reference.actual.stdout.hex);
        assert.equal(record.pass, record.actual.exitCode === 1 && record.matchesGnuBytes);
      }
    }
    const summary = capture.summary[engine];
    assert.equal(summary.pass, records.filter(record => record.pass).length);
    assert.equal(summary.fail, records.filter(record => !record.pass).length);
    assert.equal(summary.failures.length, summary.fail);
    assert.equal(summary.gnuAgreement, records.filter(record => record.matchesGnuStatusTarget ?? record.matchesGnuBytes).length);
  }
  assert.deepEqual([capture.summary.gnu.fail, capture.summary.bsd.fail, capture.summary.product.fail], [3, 20, 20]);
});

test("release and repeat evidence retains pinned identities and authenticity caveats", () => {
  assert.equal(provenance.build.evidence[0].sha256, "f87cee69eec2b4fcbf60a396b030ad6aa3415f192aa5f7ee84cad5e11f7f5ae3");
  assert.equal(provenance.build.evidence[1].sha256, "7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd");
  assert.match(provenance.signatures[0].stdout, /VALIDSIG 259B3792B3D6D319212CC4DCD5BF9FEB0313653A /u);
  assert.match(provenance.signatures[0].stdout, /EXPKEYSIG/u);
  assert.match(provenance.signatures[1].stdout, /VALIDSIG 155D3FC500C834486D1EEA677FD9FCCB000BEEEE /u);
  assert.equal(capture.identities.gnu.patch.sha256, provenance.build.evidence[0].binarySha256);
  assert.equal(capture.identities.gnu.diff.sha256, provenance.build.evidence[1].binarySha256);
  assert(capture.stableSources && provenance.repeat.stableSources && provenance.repeat.sameRecords);
  assert.equal(provenance.repeat.captureExitCode, 1);
});
