import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const owned = "tests/stress/byte-ownership-20260827/";
const manifest = `${owned}source-public-before.json`;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
if (process.argv.includes("--freeze")) {
  const files = [...new Set([
    ...git("ls-files", "src").split("\n"),
    "AGENTS.md", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json",
    "tests/contracts/io.test.ts", `${owned}ownership.test.ts`, `${owned}expectations.ts`, `${owned}binding.mjs`, `${owned}tsconfig.json`,
  ])].sort();
  const hashes = Object.fromEntries(files.map(path => [path, sha256(readFileSync(`${root}${path}`))]));
  const tooling = Object.fromEntries(["tsx", "typescript"].map(name => [name, JSON.parse(readFileSync(`${root}node_modules/${name}/package.json`, "utf8")).version]));
  const data = {
    capturedAt: new Date().toISOString(), head: git("rev-parse", "HEAD"),
    status: git("status", "--short"), staged: git("diff", "--cached", "--stat"),
    trackedSourceDiff: git("diff", "HEAD", "--", "src"),
    node: process.version, platform: process.platform, arch: process.arch, tooling,
    loadBinding: "node --import tsx --test loads explicit ../../../src/index.js and ../../../src/commands/internal.js through tsx .js-to-.ts mapping; no dist imports/writes; all tracked src files hash-checked before execution and after cohort",
    hashes,
  };
  const text = JSON.stringify(data, null, 2) + "\n";
  execFileSync("apply_patch", [`*** Begin Patch\n*** Add File: ${manifest}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch`], { cwd: root, stdio: "inherit" });
} else {
  const frozen = JSON.parse(readFileSync(`${root}${manifest}`, "utf8"));
  for (const [path, expected] of Object.entries(frozen.hashes)) {
    assert.equal(sha256(readFileSync(`${root}${path}`)), expected, `frozen source mismatch: ${path}`);
  }
  console.log(`BINDING verified ${Object.keys(frozen.hashes).length} source/fixture hashes; node=${process.version}; currentHead=${git("rev-parse", "HEAD")}; frozenHead=${frozen.head}`);
}
