import assert from "node:assert/strict";
import test from "node:test";
import { prepareNative, observeNative } from "./native.mjs";
import { encode } from "./common.mjs";

test("native role launchers actually decompress and canonical roots project", async () => {
  const profile = await prepareNative(process.cwd());
  const bytes = Buffer.from([0, 128, 255, 65, 10]);
  const base = { nativeExit: 0, directories: [], fileModes: {}, files: {}, stdin: encode(bytes) };
  try {
    for (const consumer of ["gunzip -c", "zcat"]) {
      const row = await observeNative(profile, { ...base, script: `gzip -n -c | ${consumer}` });
      assert.equal(row.oracleValid, true); assert.equal(row.stdout, encode(bytes), consumer); assert.equal(row.stderr, "");
    }
    const replacement = await observeNative(profile, { ...base, stdin: "", files: { input: encode(bytes) }, script: "gzip -n input; gunzip input.gz" });
    assert.equal(replacement.stderr, ""); assert.deepEqual(replacement.entries, { input: { type: "file", bytes: encode(bytes) } });
    const paths = await observeNative(profile, { ...base, script: "pwd; pwd -P; realpath ." });
    assert.equal(Buffer.from(paths.stdout, "base64").toString(), "/fixture\n/fixture\n/fixture\n");
    assert.match(profile.tools.gunzip.versionStdout, /^gunzip \(gzip\) 1\.14/);
    assert.match(profile.tools.zcat.versionStdout, /^zcat \(gzip\) 1\.14/);
  } finally { await profile.close(); }
});
