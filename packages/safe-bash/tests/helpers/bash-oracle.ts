import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

export const bashExecutable = process.env.SAFE_BASH_TEST_BASH ?? "/bin/bash";
const version = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", 'printf "%s" "$BASH_VERSION"'], {
  encoding: "utf8", env: { LC_ALL: "C" }, timeout: 2000,
});
assert.ifError(version.error);
assert.equal(version.signal, null);
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stderr, "");
const [major, minor] = version.stdout.split(".").map(Number);
assert.ok(Number.isInteger(major) && Number.isInteger(minor), `Invalid Bash version: ${version.stdout}`);
export const modernBashSkip = major! > 5 || major === 5 && minor! >= 2
  ? false : `GNU Bash 5.2+ oracle required; ${bashExecutable} is ${version.stdout}`;
