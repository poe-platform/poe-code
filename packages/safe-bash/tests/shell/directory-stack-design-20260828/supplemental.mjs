import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const names = ["supplemental-cases.json", "supplemental.mjs"];
const files = Object.fromEntries(names.map(name => [name, hash(fs.readFileSync(path.join(own, name)))]));
const freezePath = path.join(own, "SUPPLEMENTAL-FREEZE.json");
if (process.argv[2] === "--seal") {
  fs.writeFileSync(freezePath, JSON.stringify({ sealedAt: new Date().toISOString(), files,
    originalCompressedSha256: "fe150ca75f031031acc8e3591ed6add03ea24d669e7bcc63d97d2990d7452211", cases: 4,
    timing: "After original34 native+virtual observations; before these four new topology questions; not a corrected original34 score" }, null, 2) + "\n", { flag: "wx" });
  process.exit(0);
}
const seal = JSON.parse(fs.readFileSync(freezePath, "utf8"));
assert.deepEqual(files, seal.files);
const freezeCommit = spawnSync("/usr/bin/git", ["-C", repository, "log", "-1", "--format=%H", "--", path.relative(repository, freezePath)], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" } });
assert.equal(freezeCommit.status, 0);
assert.ok(freezeCommit.stdout.trim());
const original = JSON.parse(fs.readFileSync(path.join(own, "FREEZE.json"), "utf8"));
const binary = original.binary.filename;
assert.equal(hash(fs.readFileSync(binary)), original.binary.sha256);
const output = path.join(own, "supplemental-observations-01.json.gz.base64");
assert.equal(fs.existsSync(output), false);
const root = fs.realpathSync(fs.mkdtempSync("/tmp/safe-bash-directory-stack-supplement-"));
const capture = { startedAt: new Date().toISOString(), freezeCommit: freezeCommit.stdout.trim(), seal, root, rows: [] };
try {
  for (const fixture of JSON.parse(fs.readFileSync(path.join(own, "supplemental-cases.json"), "utf8")).cases) {
    const directory = path.join(root, fixture.id);
    fs.mkdirSync(path.join(directory, "a"), { recursive: true });
    const args = ["--noprofile", "--norc", "-c", fixture.source, "directory-stack-supplement"];
    const env = { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: directory, ROOT: directory, PWD: directory, OLDPWD: directory, TMPDIR: root };
    const child = spawnSync(binary, args, { cwd: directory, env, input: "", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 128 * 1024 });
    capture.rows.push({ id: fixture.id, args, env, status: child.status, signal: child.signal, error: child.error?.message,
      stdoutBase64: child.stdout.toString("base64"), stderrBase64: child.stderr.toString("base64"),
      stdoutNormalized: child.stdout.toString().replaceAll(directory, "/fixture"), stderrNormalized: child.stderr.toString().replaceAll(directory, "/fixture") });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
  }
  capture.completed = true;
} catch (error) {
  capture.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  capture.binaryUnchanged = hash(fs.readFileSync(binary)) === original.binary.sha256;
  fs.rmSync(root, { recursive: true, force: true });
  capture.temporaryRemoved = !fs.existsSync(root);
  capture.finishedAt = new Date().toISOString();
  const bytes = gzipSync(JSON.stringify(capture), { level: 9 });
  fs.writeFileSync(output, bytes.toString("base64") + "\n", { flag: "wx" });
  console.log(JSON.stringify({ sha256: hash(bytes), completed: capture.completed, count: capture.rows.length, removed: capture.temporaryRemoved }));
}
