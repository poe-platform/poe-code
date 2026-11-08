import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface Result {
  exitCode: number | null;
  signal?: string | null;
  bounded?: string | null;
  stdout: string;
  stderr: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}
interface Evidence {
  baselineCommit: string;
  beforeHashes: Record<string, string>;
  afterHashes: Record<string, string>;
  frozenHashes: Record<string, string>;
  failures: { name: string; category: string; artifact: string; ordinal: number }[];
  selectors: { flags: string[]; gnu: Result; frozenProduct: Result }[];
  formats: {
    name: string; identicalFrozenDiff: boolean;
    directions: { reverse: boolean; expected: string; gnuOnGnu: Result; gnuOnFrozen: Result; appleOnGnu: Result; frozenOnGnu: Result; frozenOnFrozen: Result }[];
  }[];
  parser: { id: string; gnu: Result; frozenProduct: Result; generated: Result | null }[];
  patch: { name: string; gnu: Result; apple: Result; frozenProduct: Result }[];
  mutations: { name: string; gnu: Result; product: Result }[];
  calibrationIssues: string[];
}
const evidence = JSON.parse(await readFile(new URL("./evidence.json", import.meta.url), "utf8")) as Evidence;

test("classification evidence retains all 30 historical failures without exclusions", () => {
  assert.equal(evidence.baselineCommit, "b92841a8ceaba9fb1f9c8c7915e218f880a9d1ed");
  assert.equal(evidence.failures.length, 30);
  assert.equal(new Set(evidence.failures.map(entry => entry.name)).size, 30);
  const counts: Record<string, number> = {};
  for (const entry of evidence.failures) counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  assert.deepEqual(counts, { "gnu-selector-defect": 12, "gnu-patch-defect": 2, "gnu-native-native-control": 6, "apple-reverse-control": 5, "parser-native-control": 5 });
  assert.deepEqual(evidence.beforeHashes, evidence.afterHashes);
  assert.equal(Object.keys(evidence.frozenHashes).length, 11);
});

test("frozen selector defects remain defects, not successful calibration", () => {
  for (const flags of ["-U0 -u", "-U0 --unified", "--unified=1 -ru", "-u -U 0", "-C0 -c", "-U5 -U1"]) {
    const entry = evidence.selectors.find(row => row.flags.join(" ") === flags)!;
    assert(entry);
    assert.equal(entry.gnu.exitCode, 1);
    assert.equal(entry.frozenProduct.exitCode, 1);
    assert.notEqual(entry.frozenProduct.stdout, entry.gnu.stdout);
  }
});

test("frozen literal-coordinate and asymmetric-boundary gaps are real GNU mismatches", () => {
  const legacy = evidence.patch.find(entry => entry.name === "legacy-empty-range-reverse")!;
  assert.equal(legacy.gnu.after.target, "b\na\n");
  assert.equal(legacy.apple.after.target, "a\nb\n");
  assert.equal(legacy.frozenProduct.after.target, "a\nb\n");
  const boundary = evidence.patch.find(entry => entry.name === "asymmetric-non-EOF")!;
  assert.equal(boundary.gnu.exitCode, 1);
  assert.equal(boundary.frozenProduct.exitCode, 0);
  assert.notEqual(boundary.gnu.after.target, boundary.frozenProduct.after.target);
});

test("six native context-zero failures reject byte-identical GNU and frozen output", () => {
  assert.equal(evidence.formats.length, 6);
  for (const entry of evidence.formats) {
    assert.equal(entry.identicalFrozenDiff, true, entry.name);
    for (const direction of entry.directions) {
      assert.equal(direction.gnuOnGnu.exitCode, 2);
      assert.equal(direction.gnuOnFrozen.exitCode, 2);
      assert.match(direction.gnuOnGnu.stderr, /replacement text or line numbers mangled/u);
      assert.equal(direction.frozenOnGnu.exitCode, 0);
      assert.equal(direction.frozenOnGnu.after.target, direction.expected);
      assert.equal(direction.frozenOnFrozen.after.target, direction.expected);
    }
  }
});

test("five Apple reverse gates corrupt bytes despite successful exits", () => {
  let corruption = 0;
  for (const entry of evidence.formats) for (const direction of entry.directions) {
    assert.equal(direction.appleOnGnu.exitCode, 0);
    if (!direction.reverse || entry.name === "repeated-alignment-0") assert.equal(direction.appleOnGnu.after.target, direction.expected);
    else { corruption++; assert.notEqual(direction.appleOnGnu.after.target, direction.expected); }
  }
  assert.equal(corruption, 5);
});

test("five parser-native observations retain four grammar rejections and bounded timeout", () => {
  assert.equal(evidence.parser.length, 5);
  for (const entry of evidence.parser) {
    if (entry.id === "normal-unsafe-integer") {
      assert.equal(entry.gnu.bounded, "timeout-3000ms");
      assert.equal(entry.gnu.signal, "SIGKILL");
      assert.equal(entry.gnu.exitCode, null);
      assert.equal(entry.frozenProduct.exitCode, 2);
      assert.equal(entry.frozenProduct.after.target, entry.gnu.before.target);
    } else {
      assert.equal(entry.gnu.exitCode, 2);
      assert.equal(entry.frozenProduct.exitCode, 0);
      assert.equal(entry.generated?.stdout, (entry.gnu as Result & { input: string }).input);
    }
    assert.equal(entry.gnu.after.target, entry.gnu.before.target);
  }
  assert.deepEqual(evidence.calibrationIssues, []);
});

test("native mutation evidence proves pruning, rejects, and continued partial application", () => {
  const find = (name: string) => evidence.mutations.find(entry => entry.name === name)!.gnu;
  assert.equal(evidence.mutations.length, 12);
  assert.deepEqual(find("delete-prunes-parents").after, {});
  assert.deepEqual(find("E-prunes-parents").after, {});
  assert.equal(find("empty-without-E").after["dir/sub/target"], "");
  const partial = find("same-file-partial-default-reject");
  assert.equal(partial.exitCode, 1);
  assert.equal(partial.after.target, "NEW\nkeep\nend\n");
  assert.equal(partial.after["target.rej"], "--- target\n+++ target\n@@ -3 +3 @@\n-not-present\n+END\n");
  assert.equal(find("multi-file-partial-default-reject").after.third, "NEW\n");
  assert.equal(find("discard-reject-file").after["target.rej"], undefined);
  assert.equal(find("malformed-later-section").exitCode, 2);
  assert.equal(find("malformed-later-section").after.first, "NEW\n");
  assert.equal(find("partial-keeps-later-matching-hunk").after.target, "NEW\nkeep\nFINAL\n");
});
