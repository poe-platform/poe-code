import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { native } from "../formats/helpers.js";
import { assertNativeCapture, calibration, calibrationSha256 } from "./calibration.js";
import { oracleIdentity, oraclePath, pins } from "./oracle.js";
import { nativeGnuBinding } from "../../../native-profile.js";

test("binding: exact selected GNU versions and executable hashes", () => {
  for (const tool of ["diff", "patch"] as const) {
    const identity = oracleIdentity(tool);
    const expected = nativeGnuBinding(tool) ?? pins.gnu[tool];
    assert.equal(identity.sha256, expected.sha256);
    assert.equal(identity.version.split("\n")[0], expected.version);
    assert.equal(identity.dialect, "gnu");
  }
});

for (const value of ["", "patch", "/missing/gnu/patch", "/usr/bin/patch", pins.gnu.diff.path]) {
  test(`binding: fail closed for unproved patch ${JSON.stringify(value)}`, () => {
    const source = `import { oraclePath } from ${JSON.stringify(new URL("./oracle.ts", import.meta.url).href)}; oraclePath("patch");`;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
      env: { ...process.env, DIFF_PATCH_NATIVE_PATCH: value }, encoding: "utf8", timeout: 5000, maxBuffer: 65_536, killSignal: "SIGKILL",
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /absolute executable path|ENOENT|SHA-256 mismatch|native executable size mismatch/u);
  });
}

for (const fixture of calibration.formats.filter(item => item.name !== "repeated-alignment-0")) {
  test(`Apple alternate calibration only: exact reverse corruption ${fixture.name}`, async context => {
    context.diagnostic(`evidence SHA-256 ${calibrationSha256}`);
    const direction = fixture.directions.find(item => item.reverse)!;
    assert.equal(direction.apple.input, fixture.gnuDiff.stdout);
    assert.equal(direction.apple.before.target, fixture.flow.next);
    assert.notEqual(direction.apple.after.target, fixture.flow.old);
    const actual = await native("patch", direction.apple.args, direction.apple.before, direction.apple.input, true);
    assertNativeCapture(actual, direction.apple, true);
  });
}

for (const fixture of calibration.parser) {
  test(`GNU parser calibration only: ${fixture.id}`, { timeout: 7000 }, async context => {
    const captured = fixture.gnu;
    const binary = oraclePath("patch");
    if (fixture.generated) {
      const generated = await native("diff", fixture.generated.args, fixture.generated.before);
      assert.equal(generated.exitCode, fixture.generated.exitCode);
      assert.equal(generated.stdout, fixture.generated.stdout);
      assert.equal(generated.stderr, fixture.generated.stderr);
      assert.equal(generated.stdout, captured.input);
    }
    context.diagnostic(`evidence SHA-256 ${calibrationSha256}; input ${JSON.stringify(captured.input)}`);
    const root = await mkdtemp(join(fileURLToPath(new URL("./", import.meta.url)), ".native-"));
    try {
      for (const [name, text] of Object.entries(captured.before)) { assert(/^[a-z]+$/u.test(name)); await writeFile(join(root, name), text); }
      const actual = spawnSync(binary, captured.args, { cwd: root, input: captured.input, encoding: "utf8", shell: false,
        timeout: 3000, killSignal: "SIGKILL", maxBuffer: 256 * 1024,
        env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC", HOME: root, TMPDIR: root } });
      assert.equal(actual.status, captured.exitCode);
      assert.equal(actual.signal, captured.signal);
      if (captured.bounded === "timeout-3000ms") assert.equal((actual.error as NodeJS.ErrnoException | undefined)?.code, "ETIMEDOUT");
      else { assert.equal(captured.bounded, null); assert.ifError(actual.error); }
      assert.equal(actual.stdout, captured.stdout);
      assert.equal(actual.stderr, captured.stderr.replaceAll(captured.binary, binary));
      for (const name of Object.keys(captured.before)) assert.equal(await readFile(join(root, name), "utf8"), captured.after[name]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
