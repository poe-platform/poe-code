import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { namespace, oracle, oracleRoot, sha256, suiteRoot } from "./helpers.js";

const evidence = JSON.parse(await readFile(new URL("./oracle-evidence.json", import.meta.url), "utf8")) as { binaries: Record<string, string>; authorFilesSha256: Record<string, string>; archiveSha256: string };

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
