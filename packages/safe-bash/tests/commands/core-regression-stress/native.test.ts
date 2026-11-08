import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { chunks, execute, fixture, snapshot } from "./helpers.js";
import { vectors } from "./vectors.js";

interface NativeCapture {
  platform: string;
  versions: Record<string, { version: string; sha256: string }>;
  observations: { name: string; vectorSha256: string; stdout: string; stderr: string; exitCode: number; files: Record<string, string> }[];
}
const native = JSON.parse(readFileSync(new URL("./native.json", import.meta.url), "utf8")) as NativeCapture;
const linuxBytes = readFileSync(new URL("./native-linux91.json", import.meta.url));
const linux = JSON.parse(linuxBytes.toString()) as NativeCapture;
const profile = JSON.parse(readFileSync(new URL("./native-linux91-profile.json", import.meta.url), "utf8")) as {
  nativeCaptureSha256: string;
  identity: { platform: string; libc: string; binaries: Record<string, { version: string; sha256: string }> };
};

test("current wc native oracle binds GNU 9.1 Linux observations to the unchanged original controls", () => {
  assert.equal(createHash("sha256").update(linuxBytes).digest("hex"), profile.nativeCaptureSha256);
  assert.equal(linux.platform, "linux");
  assert.equal(profile.identity.platform, "linux");
  assert.equal(profile.identity.libc, "glibc 2.36");
  assert.equal(linux.versions.wc!.version, "wc (GNU coreutils) 9.1");
  assert.equal(profile.identity.binaries.wc!.version, linux.versions.wc!.version);
  assert.equal(linux.versions.wc!.sha256, profile.identity.binaries.wc!.sha256);
  assert.deepEqual(linux.observations.map(row => [row.name, row.vectorSha256]), native.observations.map(row => [row.name, row.vectorSha256]));
  assert.deepEqual(vectors.map(vector => [vector.name, createHash("sha256").update(JSON.stringify(vector)).digest("hex")]), native.observations.map(row => [row.name, row.vectorSha256]));
});

for (const vector of vectors) test(`independent native ${vector.name}`, async () => {
  const expected = (vector.command === "wc" ? linux : native).observations.find(row => row.name === vector.name)!;
  assert.ok(expected);
  assert.equal(createHash("sha256").update(JSON.stringify(vector)).digest("hex"), expected.vectorSha256);
  for (const width of [1, 3, 65536]) {
    const fs = await fixture(vector);
    const result = await execute(vector.command, vector.args, { fs, env: { LC_ALL: "C", ...vector.env }, stdin: chunks(Buffer.from(vector.stdin ?? "", "base64"), width) });
    assert.deepEqual(await snapshot(fs), expected.files, `filesystem effects, chunk=${width}`);
    assert.equal(result.exitCode, expected.exitCode, result.stderr.toString());
    assert.equal(result.stdout.toString("base64"), expected.stdout, `stdout, chunk=${width}`);
    assert.equal(result.stderr.length === 0, expected.stderr.length === 0);
    if (vector.command === "wc") assert.equal(result.stderr.toString(), expected.stderr, `stderr, chunk=${width}`);
  }
});
