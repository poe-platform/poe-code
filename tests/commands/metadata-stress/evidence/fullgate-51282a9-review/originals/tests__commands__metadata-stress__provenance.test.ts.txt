import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { namespace, oracle, oracleRoot, sha256, suiteRoot } from "./helpers.js";

const parsed: unknown = JSON.parse(await readFile(new URL("./oracle-evidence.json", import.meta.url), "utf8"));
assert.ok(typeof parsed === "object" && parsed !== null);
assert.ok("binaries" in parsed && "authorFilesSha256" in parsed && "archiveSha256" in parsed && "nativeSources" in parsed);
assert.equal(typeof parsed.archiveSha256, "string");

function hashes(value: unknown): Record<string, string> {
  assert.ok(typeof value === "object" && value !== null);
  const output: Record<string, string> = {};
  for (const [name, hash] of Object.entries(value)) {
    assert.equal(typeof hash, "string");
    output[name] = hash;
  }
  return output;
}

const evidence = { binaries: hashes(parsed.binaries), authorFilesSha256: hashes(parsed.authorFilesSha256), archiveSha256: parsed.archiveSha256, nativeSources: hashes(parsed.nativeSources) };

test("GNU native source identities are complete SHA256 hashes matching the pinned source", async () => {
  for (const [name, expected] of Object.entries(evidence.nativeSources)) {
    assert.match(expected, /^[0-9a-f]{64}$/u, name);
    assert.equal(await sha256(join(oracleRoot, name)), expected, name);
  }
});

test("GNU oracle binaries/archive match the independently captured exact identities", async context => {
  assert.equal(await sha256(join(oracleRoot, "../coreutils-9.7.tar.xz")), evidence.archiveSha256);
  const root = await namespace(context);
  for (const command of ["chmod", "stat", "mktemp"] as const) {
    assert.equal(await sha256(join(oracleRoot, "src", command)), evidence.binaries[command]);
    const version = oracle(command, ["--version"], root);
    assert.equal(version.exitCode, 0, version.stderr);
    assert.equal(version.stdout.toString().split("\n")[0], `${command} (GNU coreutils) 9.7`);
  }
});

test("all seven original author artifacts retain their handoff hashes", async () => {
  for (const [name, expected] of Object.entries(evidence.authorFilesSha256)) assert.equal(await sha256(join(suiteRoot, "../metadata", name)), expected, name);
});
