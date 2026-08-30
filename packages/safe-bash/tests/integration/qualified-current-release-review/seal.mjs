import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const repository = "/Users/kjopek/Workspace/safe-bash";
const owner = join(repository, "tests/integration/qualified-current-release-review");
const patch = execFileSync("/usr/bin/which", ["apply_patch"], { encoding: "utf8" }).trim();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const save = (path, value) => {
  assert.equal(existsSync(path), false);
  execFileSync(patch, [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${path}\n${JSON.stringify(value, null, 2).split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`, maxBuffer: 2 * 1024 * 1024 });
};
const status = execFileSync("git", ["status", "--short"], { cwd: repository, encoding: "utf8" });
const index = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: repository, encoding: "utf8" });
const processes = execFileSync("/bin/ps", ["-axo", "pid,ppid,state,command"], { encoding: "utf8" });
const remaining = processes.split("\n").filter(line => line.includes("qualified-current-release-review/.execution-work/") || /node tests\/integration\/qualified-current-release-review\/(execute|postcheck|archive-handoff|verify-evidence)\.mjs/u.test(line));
assert.deepEqual(remaining, [], "owned execution children must finish before sealing");
save(join(owner, "execution-evidence/precommit-state.json"), { recordedAt: new Date().toISOString(), status, index, remainingOwnedExecutionProcesses: remaining, scope: "Shared foreign status is retained, never edited or staged by this leaf. Ignored owned staging/native artifacts remain intact. Atomic commit uses only the owned review path; root verifies actual leaf closure after normal exit." });
const entries = [];
const walk = relative => {
  for (const entry of readdirSync(join(owner, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".execution-work" || entry.name === "SHA256SUMS.json") continue;
    const path = join(relative, entry.name);
    if (entry.isDirectory()) walk(path);
    else {
      const bytes = readFileSync(join(owner, path));
      entries.push({ path, bytes: bytes.length, sha256: digest(bytes) });
    }
  }
};
walk("");
save(join(owner, "SHA256SUMS.json"), { schema: 1, source: "02a78bf64c29dedcd69071551ed5848b0765c107", entries, entriesSha256: digest(JSON.stringify(entries)), scope: "Owned durable artifacts only, excluding this self-referential seal and ignored isolated staging; original input/preparation files included without modification." });
console.log(JSON.stringify({ sealedFiles: entries.length, entriesSha256: digest(JSON.stringify(entries)), remainingOwnedExecutionProcesses: remaining }));
