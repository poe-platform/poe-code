import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = "/Users/kjopek/Workspace/safe-bash";
const owned = "tests/integration/shared-external-stdin-independent-20260827";
const destination = path.join(here, "evidence");
await mkdir(destination);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const attempts = [
  { id: 1, runner: "1d7b1912", fixture: "0ec75ef320ecaea9fc66e1ba952f3961c917685c", state: "SETUP_FAILURE_NO_BEHAVIOR" },
  { id: 2, runner: "209e09e5", fixture: "0ec75ef320ecaea9fc66e1ba952f3961c917685c", state: "ORIGINAL_32_CASE_BASELINE_RETAINED" },
  { id: 3, runner: "7b983a73", fixture: "92f7626200d1509cf0efe17e4ee6c3d558f3a277", state: "PROVISIONAL_35_CASE_REPLAY_NOT_APPROVED" },
];
for (const attempt of attempts) {
  const source = `/tmp/shared-stdin-independent-baseline-attempt-${attempt.id}`;
  const target = path.join(destination, `attempt-${attempt.id}`);
  await cp(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
  for (const filename of await readdir(source)) assert.ok((await readFile(path.join(source, filename))).equals(await readFile(path.join(target, filename))), `original evidence changed: ${filename}`);
  attempt.runner = git(["rev-parse", attempt.runner]).toString().trim();
  await writeFile(path.join(target, "runner.mjs.txt"), git(["show", `${attempt.runner}:${owned}/run.mjs`]), { flag: "wx" });
  for (const filename of ["cases.mjs", "probe.mjs", "loader.mjs"]) await writeFile(path.join(target, `${filename}.txt`), git(["show", `${attempt.fixture}:${owned}/${filename}`]), { flag: "wx" });
}
const references = ["src/contracts/io.ts", "src/contracts/command.md", "src/shell/shell.ts", "src/shell/runtime.ts", "tests/shell/lifecycle.test.ts"];
await mkdir(path.join(destination, "baseline-references"));
for (const filename of references) await writeFile(path.join(destination, "baseline-references", filename.replaceAll("/", "__") + ".txt"), git(["show", `eaed12f88365e69597994c4f2e6324a020202b66:${filename}`]), { flag: "wx" });
const inventory = [];
async function visit(relative) {
  const full = path.join(destination, relative);
  const stat = await lstat(full);
  assert.equal(stat.isSymbolicLink(), false);
  if (stat.isDirectory()) { inventory.push({ path: relative || ".", kind: "directory" }); for (const name of (await readdir(full)).sort()) await visit(path.join(relative, name)); }
  else { const bytes = await readFile(full); inventory.push({ path: relative, kind: "file", size: bytes.length, sha256: sha256(bytes) }); }
}
await visit("");
await writeFile(path.join(here, "SEAL.json"), JSON.stringify({ baseline: "eaed12f88365e69597994c4f2e6324a020202b66", attempts, references, inventory, candidateNotInspected: true, status: "WAITING_NO_CANDIDATE; REVISION_2_PROVISIONAL", creation: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
console.log(`Sealed ${inventory.filter(entry => entry.kind === "file").length} original evidence/reference files without overwriting captures.`);
