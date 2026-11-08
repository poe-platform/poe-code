import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const receiptCommit = process.argv[2];
assert.match(receiptCommit ?? "", /^[a-f0-9]{40}$/u);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const authenticate = filename => {
  const bytes = fs.readFileSync(filename);
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(execFileSync("git", ["rev-parse", `${receiptCommit}:${path.relative(repository, filename)}`], { cwd: repository, timeout: 10000 }).toString().trim(), blob);
  return bytes;
};
authenticate(fileURLToPath(import.meta.url));
const sealBytes = authenticate(path.join(own, "SUCCESSOR-SEAL.json"));
const seal = JSON.parse(sealBytes);
const allowed = [path.join(own, "../s06-v1/baseline-attempt-eZqFQv"), path.join(own, "baseline-attempt-YGwBis"), path.join(own, "successor-attempt-zs5pBq")];
assert.deepEqual(seal.attempts.map(entry => entry.directory), allowed);
const receipt = { receiptCommit, sealSha256: sha(sealBytes), startedAt: new Date().toISOString(), removed: [], complete: false };
for (const attempt of seal.attempts) {
  const archiveBytes = authenticate(path.join(own, attempt.archive));
  assert.equal(sha(archiveBytes), attempt.archiveSha256);
  const archive = JSON.parse(gunzipSync(Buffer.from(archiveBytes.toString(), "base64")));
  assert.equal(archive.originalDirectory, attempt.directory);
  assert(fs.lstatSync(attempt.directory).isDirectory());
  assert(!fs.lstatSync(attempt.directory).isSymbolicLink());
  const expected = new Map(archive.entries.map(entry => [entry.path, entry]));
  const actual = [];
  const visit = (directory, prefix) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = prefix + name;
      actual.push(relative);
      const entry = expected.get(relative);
      assert(entry, relative);
      const stat = fs.lstatSync(absolute);
      assert.equal(stat.mode & 0o777, entry.mode, relative);
      if (entry.kind === "directory") {
        assert(stat.isDirectory() && !stat.isSymbolicLink());
        visit(absolute, relative + "/");
      } else if (entry.kind === "symlink") {
        assert.equal(relative, "source/node_modules");
        assert(stat.isSymbolicLink());
        assert.equal(fs.readlinkSync(absolute), entry.target);
      } else {
        assert.equal(entry.kind, "file");
        assert(stat.isFile() && !stat.isSymbolicLink());
        const bytes = fs.readFileSync(absolute);
        assert.equal(sha(bytes), entry.sha256, relative);
        assert.deepEqual(bytes, Buffer.from(entry.base64, "base64"), relative);
      }
    }
  };
  visit(attempt.directory, "");
  assert.deepEqual(actual, [...expected.keys()], "append-aware complete raw attempt census");
  for (const command of attempt.commands) assert.throws(() => process.kill(-command.pid, 0), { code: "ESRCH" });
}
for (const attempt of seal.attempts) {
  fs.rmSync(attempt.directory, { recursive: true });
  assert(!fs.existsSync(attempt.directory));
  receipt.removed.push({ directory: attempt.directory, archive: attempt.archive, archiveSha256: attempt.archiveSha256, entriesVerified: attempt.entries, fileBytesModesAndLinksVerified: true, appendAwareCensus: true, processGroupsAbsent: attempt.commands.map(command => command.pid) });
}
for (const attempt of seal.attempts) assert.equal(sha(authenticate(path.join(own, attempt.archive))), attempt.archiveSha256);
receipt.complete = true;
receipt.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(own, "CLEANUP.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ complete: true, removed: receipt.removed.map(entry => entry.directory), receiptCommit }) + "\n");
