import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { currentDriverBindings, currentHelperBindings, historicalSealCommit, nativeCaptureSha256, validateSourceBindings } from "./current-binding.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const baseline = readFileSync(join(root, "benchmarks/shell-stress/diagnostic-profiles/native-baseline.json"));
assert.equal(createHash("sha256").update(baseline).digest("hex"), nativeCaptureSha256);
const { sources } = JSON.parse(baseline.toString()) as { sources: Record<string, string> };

function hashFailure(path: string, expected: string, bytes: Uint8Array): (error: unknown) => boolean {
  return error => {
    assert.ok(error instanceof assert.AssertionError);
    assert.equal(error.message.split("\n")[0], `Current fixture/helper binding changed: ${path}`);
    assert.equal(error.code, "ERR_ASSERTION");
    assert.equal(error.operator, "strictEqual");
    assert.equal(error.expected, expected);
    assert.equal(error.actual, createHash("sha256").update(bytes).digest("hex"));
    return true;
  };
}

function withCopiedInputs(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "safe-bash-diagnostic-pins-control-"));
  try {
    for (const path of Object.keys(sources).filter(path => path.startsWith("tests/"))) {
      const destination = join(directory, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(join(root, path)), { flag: "wx" });
      assert.ok(lstatSync(destination).isFile());
      assert.equal(lstatSync(destination).isSymbolicLink(), false);
    }
    run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("current binding authenticates all fourteen inputs with two migrated drivers and the admitted-source helper", () => {
  assert.equal(Object.keys(sources).filter(path => path.startsWith("tests/")).length, 14);
  assert.equal(currentDriverBindings.length, 2);
  assert.deepEqual(currentHelperBindings.map(binding => binding.path), ["tests/shell-stress/helpers.ts"]);
  validateSourceBindings(root, sources, "current");
});

for (const driver of [...currentDriverBindings, ...currentHelperBindings]) {
  test(`changed current input rejected before case effects: ${driver.path}`, () => {
    withCopiedInputs(directory => {
      const destination = join(directory, driver.path);
      writeFileSync(destination, Buffer.concat([readFileSync(destination), Buffer.from("\n")]));
      let caseEffects = 0;
      const marker = join(directory, "case-effect");
      assert.throws(() => {
        validateSourceBindings(directory, sources, "current");
        caseEffects++;
        writeFileSync(marker, "must not happen");
      }, hashFailure(driver.path, driver.currentSha256, readFileSync(destination)));
      assert.equal(caseEffects, 0);
      assert.equal(existsSync(marker), false);
    });
  });
}

test("historical binding replays authenticated historical drivers and helper without executing them", () => {
  withCopiedInputs(directory => {
    for (const driver of [...currentDriverBindings, ...currentHelperBindings]) {
      const bytes = execFileSync("git", ["show", `${historicalSealCommit}:${driver.path}`], { cwd: root, timeout: 5000, maxBuffer: 65536 });
      assert.equal(createHash("sha256").update(bytes).digest("hex"), driver.historicalSha256);
      writeFileSync(join(directory, driver.path), bytes);
    }
    validateSourceBindings(directory, sources, "historical");
    assert.throws(() => validateSourceBindings(directory, sources, "current"), /Current fixture\/helper binding changed/u);
  });
});

test("current helper migration cannot rewrite its historical crosswalk", () => {
  const helper = currentHelperBindings[0]!;
  assert.throws(() => validateSourceBindings(root, { ...sources, [helper.path]: helper.currentSha256 }, "current"), /Historical helper crosswalk changed/u);
});

test("historical binding still rejects the migrated current drivers", () => {
  assert.throws(() => validateSourceBindings(root, sources, "historical"), /Frozen historical fixture\/helper changed/u);
});

test("unchanged fixture pin still rejects mutation", () => {
  withCopiedInputs(directory => {
    const destination = join(directory, "tests/shell-stress/cases.ts");
    writeFileSync(destination, Buffer.concat([readFileSync(destination), Buffer.from("\n")]));
    assert.throws(() => validateSourceBindings(directory, sources, "current"), hashFailure("tests/shell-stress/cases.ts", sources["tests/shell-stress/cases.ts"]!, readFileSync(destination)));
  });
});
