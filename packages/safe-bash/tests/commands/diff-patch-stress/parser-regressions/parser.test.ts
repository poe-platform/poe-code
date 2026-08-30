import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { calibration } from "../gnu-target/calibration.js";
import { captured as followupCapture } from "../gnu-target-followup/evidence.js";
import { overlapProbes } from "../gnu-target-followup/fixtures.js";
import { cases } from "./fixtures.js";
import { diffBinary, executeNative, nativeDiff, nativePatch, owned, patchBinary, product, productIssues, sha256 } from "./helpers.js";

const records: unknown[] = [];
const identities = await Promise.all([patchBinary, diffBinary].map(async binary => ({
  binary, sha256: sha256(await readFile(binary)),
  ...(await executeNative(binary, ["--version"], owned)),
})));
assert.match(identities[0]!.stdout, /^GNU patch 2\.8\n/u);
assert.match(identities[1]!.stdout, /^diff \(GNU diffutils\) 3\.12\n/u);

for (const fixture of cases) {
  test(fixture.id, { timeout: 5000 }, async () => {
    const result = await product(fixture);
    const issues = productIssues(fixture, result);
    let native: Awaited<ReturnType<typeof nativePatch>> | undefined;
    let nativeGenerated: Awaited<ReturnType<typeof nativeDiff>> | undefined;
    let nativeError: string | undefined;
    const nativeIssues: string[] = [];
    const captured = calibration.parser.find(item => item.id === fixture.id);
    if (captured) {
      assert.equal(fixture.patch, captured.gnu.input);
      assert.equal(fixture.before, captured.gnu.before.target);
      assert.equal(captured.gnu.before.other, "old\n");
      assert(captured.gnu.exitCode === 2 || captured.gnu.bounded === "timeout-3000ms");
    } else if (fixture.native !== false) {
      try {
        if (fixture.id === "normal-tab-prefix") {
          nativeGenerated = await nativeDiff(fixture.before, fixture.after!, ["--normal", "--initial-tab"]);
          if (nativeGenerated.exitCode !== 1 || nativeGenerated.stdout !== fixture.patch) nativeIssues.push("GNU diff 3.12 did not reproduce the tab-prefix golden");
        }
        native = await nativePatch(fixture.before, fixture.patch);
        if (fixture.expectedConflict) {
          const probe = overlapProbes.find(item => `atomic-extension-${item.id}` === fixture.id);
          assert(probe);
          assert.equal(fixture.patch, probe.input);
          const expected = followupCapture(probe);
          assert.equal(native.exitCode, expected.exitCode);
          assert.equal(native.stdout, expected.stdout);
          assert.equal(native.stderr, expected.stderr);
          assert.equal(native.target, "new\nkeep\nend\n");
        }
        if (fixture.after !== undefined && (native.exitCode !== 0 || native.target !== fixture.after)) {
          nativeIssues.push(`GNU 2.8 valid control: exit=${native.exitCode}, expected=${JSON.stringify(fixture.after)}, actual=${JSON.stringify(native.target)}`);
        }
      } catch (error) {
        nativeError = error instanceof Error ? error.message : String(error);
        nativeIssues.push(`GNU oracle execution failed: ${nativeError}`);
      }
    }
    records.push({ fixture, product: result, productIssues: issues, native, nativeGenerated, nativeError, nativeIssues });
    assert.deepEqual({ productIssues: issues, nativeIssues }, { productIssues: [], nativeIssues: [] }, JSON.stringify({ id: fixture.id, before: fixture.before, patch: fixture.patch, options: fixture.options }));
  });
}

const controls = [
  { id: "GNU-normal-suppress-blank-empty", before: "old\n", after: "\n", args: ["--normal", "--suppress-blank-empty"] },
  { id: "GNU-context-suppress-blank-empty", before: "old\n", after: "\n", args: ["-c", "--suppress-blank-empty"] },
  { id: "GNU-context-zero-middle-deletion", before: "left\nremoved\nright\n", after: "left\nright\n", args: ["-C0"] },
  { id: "GNU-context-zero-empty-insertion", before: "", after: "new\n", args: ["-C0"] },
] as const;

for (const control of controls) {
  test(control.id, { timeout: 5000 }, async () => {
    const diff = await nativeDiff(control.before, control.after, control.args);
    const captured = calibration.parser.find(item => item.id === control.id);
    const accepted = await product({ id: control.id, before: control.before, after: control.after, patch: diff.stdout, category: "GNU generated acceptance" });
    assert.deepEqual(productIssues({ id: control.id, before: control.before, after: control.after, patch: diff.stdout, category: "GNU generated acceptance" }, accepted), []);
    const patch = await nativePatch(control.before, diff.stdout);
    const issues: string[] = [];
    if (diff.exitCode !== 1) issues.push(`GNU diff 3.12 exit ${diff.exitCode}, expected 1`);
    if (captured) {
      assert.equal(diff.stdout, captured.gnu.input);
      assert.equal(control.before, captured.gnu.before.target);
      assert.equal(patch.exitCode, captured.gnu.exitCode);
      assert.equal(patch.target, captured.gnu.after.target);
    } else if (patch.exitCode !== 0 || patch.target !== control.after) issues.push(`GNU patch 2.8 exit ${patch.exitCode}, expected ${JSON.stringify(control.after)}, got ${JSON.stringify(patch.target)}`);
    records.push({ control, diff, patch, nativeIssues: issues });
    assert.deepEqual(issues, [], `version-specific native-native control ${control.id}`);
  });
}

after(async () => {
  if (process.env.PARSER_EVIDENCE) {
    const destination = new URL(process.env.PARSER_EVIDENCE, import.meta.url);
    assert.equal(new URL("./", destination).href, new URL("./", import.meta.url).href);
    await writeFile(destination, `${JSON.stringify({ identities, records }, null, 2)}\n`);
  }
});
