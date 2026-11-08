import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";

const compressed = Buffer.from(fs.readFileSync(new URL("observations-01.json.gz.base64", import.meta.url), "utf8"), "base64");
assert.equal(createHash("sha256").update(compressed).digest("hex"), "b9f81d6f6507a5d110d0a196cabebe5d4ea1e803994d817485ed0c71520df592");
const data = JSON.parse(gunzipSync(compressed));
assert.equal(data.failure, undefined);
assert.equal(data.freezeCommit, "317128ddbce8ac9d321870f46957c33bca257612");
assert.equal(data.native.length, 28);
assert.equal(data.adapters.length, 5);
assert.equal(data.directChildren, 31);
assert.equal(data.temporaryRemoved, true);
assert.equal(fs.existsSync(data.root), false);
assert.deepEqual(data.binaryAfter, data.freeze.binary);
assert.deepEqual(data.manualAfter, data.freeze.manual);
assert.deepEqual(data.sourceAfter, data.freeze.source);
assert.equal(data.liveRuntimeAfter, data.freeze.source["src/shell/runtime.ts"]);
assert.deepEqual(data.packageBefore, data.packageAfter);
assert.equal(Object.keys(data.packageBefore).length, 846);
assert.deepEqual(data.deniedDirectoryWitness, { allowed: false, code: "EACCES" });
for (const observation of [...data.native.map(row => row.observed), data.nativeIdentity, data.nativeIdentityAfter, data.extraction]) {
  assert.equal(observation.status, 0);
  assert.equal(observation.signal, null);
  assert.equal(observation.error, null);
}
const failedCd = data.native.filter(row => row.observed.stdout.includes("status=1\n")).map(row => row.id);
assert.deepEqual(failedCd, ["C17", "C18", "C19", "C20", "C26", "C27", "C28"]);
const selected = id => data.native.find(row => row.id === id).observed;
assert.ok(selected("C01").stdout.startsWith("/fixture/p1/target\nstatus=0\n"));
assert.ok(selected("C02").stdout.startsWith("/fixture/p2/target\nstatus=0\n"));
for (const id of ["C03", "C04", "C05", "C06", "C07"])
  assert.ok(selected(id).stdout.startsWith("status=0\nPWD=/fixture/work/target\n"), id);
assert.ok(selected("C08").stdout.startsWith("status=0\nPWD=/fixture/work/onlylocal\n"));
assert.ok(selected("C15").stdout.startsWith("/fixture/p2/problem\nstatus=0\n"));
assert.ok(selected("C16").stdout.startsWith("/fixture/p2/denied\nstatus=0\n"));
for (const id of ["C17", "C18", "C19"]) assert.ok(selected(id).stderr.endsWith("No such file or directory\n"), id);
assert.ok(selected("C20").stderr.endsWith("Not a directory\n"));
assert.ok(selected("C21").stdout.startsWith("/fixture/alias/target\nstatus=0\n"));
for (const id of ["C23", "C25"]) assert.ok(selected(id).stdout.startsWith("/fixture/p1/target\nstatus=0\n"), id);
assert.ok(selected("C28").stderr.endsWith("cd: null directory\n"));
for (const adapter of data.adapters) {
  const probe = label => adapter.probes.find(item => item.label === label);
  assert.equal(probe("directory-stat").type, "directory", adapter.name);
  assert.equal(adapter.baselineCd.exitCode, 0, adapter.name);
  assert.equal(adapter.baselineCd.stdout, "/directory\n", adapter.name);
  assert.equal(adapter.baselineCd.stderr, "", adapter.name);
  if (adapter.name === "webdav-mock") {
    for (const result of adapter.probes.slice(1)) {
      assert.equal(result.returned, false);
      assert.equal(result.typedFsError, true);
      assert.equal(result.code, "ENOTSUP");
    }
  } else {
    assert.equal(probe("directory-X_OK").returned, true, adapter.name);
    assert.equal(probe("missing-X_OK").code, "ENOENT", adapter.name);
    assert.equal(probe("file-X_OK").code, "EACCES", adapter.name);
    const aborted = probe("preaborted-directory-X_OK");
    if (adapter.name === "s3-mock") {
      assert.equal(aborted.code, "ECANCELED");
      assert.equal(aborted.exactAbortReason, false);
    } else assert.equal(aborted.exactAbortReason, true, adapter.name);
  }
}
assert.deepEqual(data.webdavRequests.map(request => request.method), ["PROPFIND", "PROPFIND"]);
console.log("Verified stored evidence only: 28 native observations, 25 adapter probes + 5 baseline cd runs; DAV prerequisite BLOCKED; 31 children closed, task root removed, 846 packed files unchanged.");
