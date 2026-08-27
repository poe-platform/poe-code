import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const evidence = dirname(fileURLToPath(import.meta.url));
const root = resolve(evidence, "../../../..");
const [label, selection = "all"] = process.argv.slice(2);
if (!label || !/^[a-z0-9-]+$/.test(label) || !["allocation", "all"].includes(selection)) {
  throw new Error("Usage: node tests/fs/overlay/allocation-evidence/capture.mjs LABEL [allocation|all]");
}
const allocation = [
  "tests/fs/readonly/allocation.test.ts",
  "tests/fs/mount/allocation.test.ts",
  "tests/fs/overlay/allocation.test.ts",
];
const focused = [
  "tests/fs/readonly/metadata.test.ts",
  "tests/fs/readonly/readonly.test.ts",
  "tests/fs/readonly/streaming.test.ts",
  "tests/fs/readonly/rmdir.test.ts",
  "tests/fs/readonly/snapshot-rmdir.test.ts",
  "tests/fs/mount/review-regressions.test.ts",
  "tests/fs/mount/comparison.test.ts",
  "tests/fs/mount/identity-scope.test.ts",
  "tests/fs/mount/copy-identity.test.ts",
  "tests/fs/mount/copy-identity-guards.test.ts",
  "tests/fs/mount/snapshot-rmdir.test.ts",
  "tests/fs/mount/identity-authority-review/authority.test.ts",
  "tests/fs/overlay/review-regressions.test.ts",
  "tests/fs/overlay/copy-identity.test.ts",
  "tests/fs/overlay/scoped-links.test.ts",
  "tests/fs/overlay/rmdir.test.ts",
  "tests/fs/overlay/snapshot-rmdir.test.ts",
  "tests/fs/overlay/streaming.test.ts",
];
const entries = selection === "allocation" ? allocation : [...allocation, ...focused];
const typeFlags = ["--noEmit", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext",
  "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes",
  "--verbatimModuleSyntax", "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node"];
const parsed = ts.parseCommandLine([...typeFlags, ...entries.map(path => resolve(root, path))]);
if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
  getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => "\n",
}));

function manifest() {
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const files = program.getSourceFiles().map(source => relative(root, source.fileName))
    .filter(path => !path.startsWith("..") && !isAbsolute(path) && !path.startsWith("node_modules/"));
  files.push("package.json", "package-lock.json", "tsconfig.json", "src/contracts/filesystem.md",
    relative(root, fileURLToPath(import.meta.url)));
  return Object.fromEntries([...new Set(files)].sort().map(path => [path,
    createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")]));
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

mkdirSync(resolve(evidence, "captures"), { recursive: true });
const output = mkdtempSync(resolve(evidence, "captures", `${label}-`));
const save = (name, value) => writeFileSync(resolve(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const before = manifest();
save("manifest-before.json", before);
save("provenance.json", {
  startedAt: new Date().toISOString(), label, selection, head: git("rev-parse", "HEAD"),
  status: git("status", "--short"), node: process.version, platform: process.platform,
  arch: process.arch, uv: process.versions.uv, typescript: ts.version, entries,
  profile: "author worktree, scoped source-import tests; not frozen-archive or independent review",
  coverage: "TypeScript-resolved local import closure plus listed config and contract inputs; not an append-proof repository inventory",
});

const commands = [["allocation", ["--import", "tsx", "--test", "--test-concurrency=1", ...allocation]]];
if (selection === "all") {
  commands.push(["focused", ["--import", "tsx", "--test", "--test-concurrency=1", ...focused]]);
  commands.push(["types", ["node_modules/typescript/bin/tsc", ...typeFlags, ...entries]]);
}
let failed = false;
for (const [name, args] of commands) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(resolve(output, `${name}.stdout.log`), result.stdout ?? "", { flag: "wx" });
  writeFileSync(resolve(output, `${name}.stderr.log`), result.stderr ?? "", { flag: "wx" });
  const counts = Object.fromEntries([...((result.stdout ?? "").matchAll(/^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/gm))]
    .map(match => [match[1], Number(match[2])]));
  save(`${name}.json`, { executable: process.execPath, args, startedAt, finishedAt: new Date().toISOString(),
    status: result.status, signal: result.signal, error: result.error?.message, counts });
  console.log(JSON.stringify({ name, status: result.status, counts }));
  if (result.status !== 0) failed = true;
}
const after = manifest();
save("manifest-after.json", after);
const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
save("stability.json", { finishedAt: new Date().toISOString(), head: git("rev-parse", "HEAD"), changed,
  stable: changed.length === 0, detectsNewEntries: "Only newly reachable local modules in the re-resolved scoped import closure" });
console.log(relative(root, output));
if (changed.length || failed) process.exitCode = 1;
