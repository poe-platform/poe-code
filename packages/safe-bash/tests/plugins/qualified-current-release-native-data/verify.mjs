import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const owned = "tests/plugins/qualified-current-release-native-data";
const label = process.argv[2];
assert.match(label ?? "", /^controls-(initial|final|committed)$/u);
const digest = path => createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");
const paths = ["package.json", "tsconfig.json", "tsconfig.build.json", `${owned}/controls.test.ts`, `${owned}/helpers.ts`, `${owned}/capture.mjs`, `${owned}/verify.mjs`];
const bindings = () => Object.fromEntries(paths.map(path => [path, digest(path)]));
const before = bindings();
const commands = [
  ["--import", "tsx", "--test", `${owned}/controls.test.ts`],
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--noEmit", "--pretty", "false"],
];
const results = commands.map(args => {
  const started = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  return { command: process.execPath, args, started, ended: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
});
const after = bindings();
const result = { label, node: process.version, platform: process.platform, arch: process.arch, head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), profile: "Author scoped tests and production build configuration noEmit only; no rootdist output or full product suite", before, results, after };
writeFileSync(resolve(root, owned, `${label}.json`), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ label, statuses: results.map(result => result.status), unchanged: JSON.stringify(before) === JSON.stringify(after) }));
process.exitCode = results.every(result => result.status === 0) ? 0 : 1;
