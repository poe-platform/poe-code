import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const binary = "/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash";
const binaryHash = "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const hashFile = file => digest(fs.readFileSync(file));
const protectedFiles = ["src/shell/runtime.ts", "src/shell/shell.ts", "src/shell/types.ts",
  "tests/shell/directory-stack-design-20260828/observations-01.json.gz.base64",
  "tests/shell/directory-stack-design-20260828/supplemental-observations-01.json.gz.base64"];
const protectedHashes = () => Object.fromEntries(protectedFiles.map(file => [file, hashFile(path.join(repository, file))]));
const fixtureHashes = () => Object.fromEntries(["grammar-cases.json", "grammar.mjs"].map(file => [file, hashFile(path.join(own, file))]));
const sealFile = path.join(own, "GRAMMAR-FREEZE.json");
assert.equal(hashFile(binary), binaryHash);
if (process.argv[2] === "--seal") {
  fs.writeFileSync(sealFile, JSON.stringify({ sealedAt: new Date().toISOString(), cases: 8, binary, binaryHash,
    fixtureHashes: fixtureHashes(), protectedHashes: protectedHashes(), scope: "eight additional native-only grammar observations; no virtual replay, original34+4 unchanged",
    environment: "exact per-child map, PATH empty, LC_ALL/LANG C, TZ UTC, task-owned HOME/ROOT/PWD/OLDPWD/TMPDIR; --noprofile --norc",
    normalization: "replace task-owned case root with /fixture in separate normalized views; retain raw bytes",
    timeoutMs: 3000, stdoutStderrLimitBytes: 131072 }, null, 2) + "\n", { flag: "wx" });
  console.log(sealFile);
} else {
  assert.equal(process.argv[2], "--capture");
  const seal = JSON.parse(fs.readFileSync(sealFile, "utf8"));
  assert.deepEqual(fixtureHashes(), seal.fixtureHashes);
  assert.deepEqual(protectedHashes(), seal.protectedHashes);
  const ref = spawnSync("git", ["log", "-1", "--format=%H", "--", path.relative(repository, sealFile)], { cwd: repository, encoding: "utf8" });
  assert.equal(ref.status, 0); assert.match(ref.stdout.trim(), /^[a-f0-9]{40}$/);
  const committed = spawnSync("git", ["show", `${ref.stdout.trim()}:${path.relative(repository, sealFile)}`], { cwd: repository });
  assert.equal(committed.status, 0); assert.equal(digest(committed.stdout), hashFile(sealFile));
  const output = path.join(own, "grammar-observations-01.json.gz.base64");
  assert.equal(fs.existsSync(output), false);
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "safe-bash-stack-final-grammar-")));
  const data = { startedAt: new Date().toISOString(), sealCommit: ref.stdout.trim(), seal, root, rows: [] };
  try {
    const cases = JSON.parse(fs.readFileSync(path.join(own, "grammar-cases.json"), "utf8"));
    assert.equal(cases.length, 8);
    for (const item of cases) {
      const cwd = path.join(root, item.id); fs.mkdirSync(cwd);
      for (const name of ["a", "b", "c", "-", "-dash", "+1", "home"]) fs.mkdirSync(path.join(cwd, name));
      const env = { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC", HOME: cwd, ROOT: cwd, PWD: cwd, OLDPWD: cwd, TMPDIR: root };
      const args = ["--noprofile", "--norc", "-c", item.source, "stack-final-grammar"];
      const result = spawnSync(binary, args, { cwd, env, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 131072 });
      data.rows.push({ ...item, cwd, env, args, status: result.status, signal: result.signal, error: result.error?.message ?? null,
        stdoutBase64: result.stdout.toString("base64"), stderrBase64: result.stderr.toString("base64"),
        stdout: result.stdout.toString().replaceAll(cwd, "/fixture"), stderr: result.stderr.toString().replaceAll(cwd, "/fixture") });
      assert.equal(result.error, undefined); assert.equal(result.signal, null);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: false });
    data.temporaryRemoved = !fs.existsSync(root);
    data.protectedAfter = protectedHashes(); data.binaryAfter = hashFile(binary);
    data.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, gzipSync(Buffer.from(JSON.stringify(data))).toString("base64") + "\n", { flag: "wx" });
  }
  assert.deepEqual(data.protectedAfter, seal.protectedHashes); assert.equal(data.binaryAfter, binaryHash);
  console.log(JSON.stringify({ output, observations: data.rows.length, temporaryRemoved: data.temporaryRemoved, virtualRuns: 0 }));
}
