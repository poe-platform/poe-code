import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidenceBytes = await readFile(new URL("./final-evidence.json", import.meta.url));
const evidence = JSON.parse(evidenceBytes.toString());
const sourceBytes = await readFile(new URL("./source-proof.json", import.meta.url));
const proof = JSON.parse(sourceBytes.toString());
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

test("frozen chmod classification has six original cases, not twelve bugs", () => {
  assert.equal(hash(evidenceBytes), "fbb39aedeb0155e249f16413e294575dc570629394c22e562bb5f5706a712ae4");
  assert.equal(evidence.originalDistinctCases, 6);
  assert.equal(evidence.rows.length, 6);
  assert.equal(evidence.summary.originalNativeReproduced, 6);
  assert.equal(evidence.summary.sameSixRealCounterpartsReproduced, 6);
  assert.equal(evidence.inputsStable, true);
  assert.equal(Object.keys(evidence.before.files).length, 90);
  assert.deepEqual(evidence.before.files, evidence.after.files);
  assert.equal(hash(JSON.stringify(evidence.before.files)), evidence.before.digest);
  assert.equal(evidence.ownedFixtureRemoved, true);
  assert.equal(evidence.contentsAndSentinelUnchanged, true);
});

for (const row of evidence.rows) {
  test(`${row.id}: frozen unresolved GNU mismatch is the same syscall-wrapper cause`, () => {
    assert.deepEqual(row.quartet.gnu.result.argv.slice(1), ["--", "u-s,g=s,o-t", row.original.name]);
    assert.equal(row.parsed.modeDecimal, 0o2707);
    assert.equal(row.quartet.gnu.before.uid, "501");
    assert.equal(row.quartet.gnu.before.gid, "0");
    assert.equal(evidence.profile.groups.includes(0), false);
    assert.equal(row.quartet.gnu.result.status, 1);
    assert.equal(row.quartet.gnu.result.stdout, "");
    assert.equal(row.quartet.gnu.result.stderr, `chmod: changing permissions of '${row.original.name}': Operation not permitted\n`);
    assert.equal(row.quartet.gnu.after.permissionsOctal, row.original.initial);
    for (const name of ["node", "real", "command"]) {
      const layer = row.quartet[name];
      assert.equal(layer.result.status, 0);
      assert.equal(layer.result.stdout, "");
      assert.equal(layer.result.stderr, "");
      assert.equal(layer.after.permissionsOctal, "707");
      assert.equal(layer.nodeChmodCalls.length, 1);
      assert.equal(layer.nodeChmodCalls[0].args[1], 0o2707);
      for (const field of ["uid", "gid", "dev", "ino", "size", "nlink"]) assert.equal(layer.before[field], layer.after[field]);
    }
    for (const name of ["kernel-chmod", "fchmodat"]) {
      assert.equal(row.directControls[name].syscall.returnValue, -1);
      assert.equal(row.directControls[name].syscall.errno, 1);
      assert.equal(row.directControls[name].after.permissionsOctal, row.original.initial);
    }
    assert.equal(row.directControls["libc-chmod"].syscall.returnValue, 0);
    assert.equal(row.directControls["libc-chmod"].after.permissionsOctal, "707");
    assert.deepEqual(row.directControls.gnuTrace.events, [{ function: "fchmodat", descriptor: -2, path: row.original.name, modeDecimal: 0o2707, modeOctal: "2707", flags: 0, returnValue: -1, errno: 1 }]);
    const calls = row.quartet.command.result.calls;
    assert.equal(calls.at(-1).method, "chmod");
    assert.equal(row.originalNativeReproduced, true);
    assert.equal(row.originalMemoryReproduced, true);
  });
}

test("four causal controls preserve useful chmod, not a blanket EPERM waiver", () => {
  assert.equal(evidence.positiveControls.length, 4);
  let observations = 0;
  for (const control of evidence.positiveControls) {
    for (const layer of Object.values(control.outcomes) as { before: { gid: string }; after: { permissionsOctal: string }; result: { status: number } }[]) {
      observations++;
      assert.equal(layer.result.status, 0);
      assert.equal(layer.before.gid, control.control === "member-gid-with-sgid" ? "20" : "0");
      assert.equal(layer.after.permissionsOctal, control.control === "member-gid-with-sgid" ? "2707" : "707");
    }
  }
  assert.equal(observations, 24);
});

test("primary-source evidence pins the matching XNU version and Node/libuv versions", () => {
  assert.equal(hash(sourceBytes), "010a22e7ddffc00436f258274d500b9432fb13841aeb40207e7cf77afbe3a67f");
  assert.equal(proof.tag.ref, "refs/tags/xnu-12377.101.15");
  assert.match(evidence.profile.kernel.stdout, /xnu-12377\.101\.15/u);
  assert.equal(proof.sources.length, 5);
  assert.equal(evidence.profile.versions.node, "22.22.2");
  assert.equal(evidence.profile.versions.uv, "1.51.0");
});
