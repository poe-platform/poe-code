import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("./classification-seal/", import.meta.url);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("permission classification seal authenticates every surviving historical artifact", async () => {
  const manifest = JSON.parse(await readFile(new URL("MANIFEST.json", root), "utf8"));
  const finalSeal = JSON.parse(await readFile(new URL("FINAL_SEAL.json.data", root), "utf8"));
  assert.equal(manifest.records.length, 25);
  assert.equal(manifest.originalFailureTests, 2);
  assert.equal(manifest.originalFailureTransitions, 17);
  assert.equal(manifest.originalFrozenRevision, "b494675c34dc289f4ad4b10a9201e1211eb0a7d8");
  const names: string[] = [];
  for (const record of manifest.records) {
    const bytes = await readFile(new URL(record.destination, root));
    assert.equal(bytes.length, record.bytes, record.destination);
    assert.equal(hash(bytes), record.sha256, record.destination);
    if (record.destination !== "FINAL_SEAL.json.data") {
      assert.equal(hash(bytes), finalSeal.files[record.destination.slice(0, -5)], record.destination);
    }
    names.push(record.destination);
  }
  assert.deepEqual((await readdir(root)).sort(), [...names, "MANIFEST.json", "README.md"].sort());
});

test("original 17 GNU-strict failures stay distinct from qualified fixtures and later measured metadata", async () => {
  const raw = JSON.parse(await readFile(new URL("raw-failure-excerpts.json.data", root), "utf8"));
  assert.deepEqual(raw.map((entry: { start: number }) => entry.start), [30300, 30420]);
  assert.match(raw[0].text, /6755 \+2000/u);
  assert.match(raw[0].text, /expected: 1/u);
  assert.match(raw[0].text, /actual: 0/u);
  assert.doesNotMatch(raw[0].text, /4755/u);
  const replay = JSON.parse(await readFile(new URL("results.json.data", root), "utf8"));
  for (const candidate of ["frozen", "current"]) {
    const failures = replay.observations.filter((row: { candidate: string; input?: { id: string } }) =>
      row.candidate === candidate && row.input && !row.input.id.startsWith("success"));
    assert.equal(failures.length, 17);
    assert.equal(failures[0].input.initial, "6755");
    assert.equal(failures[0].initialMeasured.mode, "4755");
    assert.equal(failures[0].layers["command-memory"].after.mode, "6755");
    for (const row of failures) {
      assert.equal(row.initialMeasured.uid, 501);
      assert.equal(row.initialMeasured.gid, 0);
      assert.equal(row.layers.gnu.status, 1);
      assert.equal(row.layers.gnu.metadataUnchanged, true);
      assert.equal(row.layers.node.status, 0);
      assert.equal(row.layers.realfs.status, 0);
      assert.equal(row.layers["command-memory"].status, 0);
      assert.equal(row.layers.node.after.mode, (Number.parseInt(row.requestedMode, 8) & ~0o2000).toString(8).padStart(4, "0"));
      if (row.input.iteration !== undefined) {
        assert.match(raw[1].text, new RegExp(`iteration: ${row.input.iteration}\\b`, "u"));
        assert.equal(row.input.mode, "ug+s");
      }
    }
  }
});
