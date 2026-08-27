import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = dirname(fileURLToPath(import.meta.url));
const root = resolve(base, "../../../..");
assert.equal(process.cwd(), root);
const name = process.argv[2];
assert.ok(typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name), "supply a new capture directory name");
const destination = join(base, name);
await mkdir(destination);
const candidate = "a3febbee84e2c1c871376a9d5d30baddb96dae68";
const corePaths = [
  "src/contracts/filesystem.ts", "src/contracts/filesystem.md", "src/fs/real/index.ts",
  "src/fs/real/allocation.ts", "tests/contracts/filesystem-allocation.test.ts", "tests/fs/real/allocation.test.ts",
];
const focused = ["tests/contracts/filesystem-allocation.test.ts", "tests/fs/real/allocation.test.ts"];
const legacy = [
  "tests/contracts/filesystem.test.ts", "tests/contracts/filesystem-identity.test.ts",
  "tests/fs/real/conformance.test.ts", "tests/fs/real/cancellation-regression.test.ts",
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const inventory = () => [...new Set([
  ...git("ls-files", "--cached", "--others", "--exclude-standard", "--", "src/contracts", "src/fs/real").split("\n"),
  ...focused, ...legacy, "tests/fs/real/helpers.ts", "package.json", "tsconfig.json",
])].sort();
const manifest = async () => Promise.all(inventory().map(async path => {
  const content = await readFile(join(root, path));
  const committed = spawnSync("git", ["show", `${candidate}:${path}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(committed.status, 0, `candidate input missing: ${path}`);
  assert.equal(hash(content), hash(committed.stdout), `live input differs from candidate: ${path}`);
  return { path, sha256: hash(content), bytes: content.length, gitBlob: git("rev-parse", `${candidate}:${path}`) };
}));
const fixtures = async () => (await readdir(base)).filter(entry => entry.startsWith(".native-")).sort();
const report = {
  candidate, startedAt: new Date().toISOString(), headBefore: git("rev-parse", "HEAD"),
  node: process.version, platform: process.platform, arch: process.arch, uv: process.versions.uv,
  compiler: JSON.parse(await readFile(join(root, "node_modules/typescript/package.json"), "utf8")).version,
  qualification: "Named live inputs equal committed candidate before and after; not an archive run, full gate, wrapper verification, Linux runtime witness, or public built-package acceptance.",
  inventoryScope: "Enumerates tracked and nonignored untracked additions in src/contracts and src/fs/real; tests/helpers/configs are exact named inputs. Not an append-proof whole-repository check.",
  commands: [],
};
const save = async (name, content) => writeFile(join(destination, name), content, { flag: "wx" });
const run = async (label, executable, args) => {
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  await save(`${label}.stdout.txt`, result.stdout ?? "");
  await save(`${label}.stderr.txt`, result.stderr ?? "");
  const counts = {};
  for (const field of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const match = result.stdout?.match(new RegExp(`^# ${field} (\\d+)$`, "m"));
    if (match) counts[field] = Number(match[1]);
  }
  report.commands.push({ label, executable, args, status: result.status, signal: result.signal,
    error: result.error?.message ?? null, counts });
  assert.equal(result.status, 0, `${label}: ${result.stderr}`);
  return result.stdout;
};

try {
  report.inputsBefore = await manifest();
  report.fixturesBefore = await fixtures();
  const stdout = await run("focused-runtime", process.execPath, ["--import", "tsx", "--test", ...focused]);
  const witness = stdout.split("\n").find(line => line.startsWith('# {"node":'));
  assert.ok(witness, "native observation diagnostic missing");
  report.nativeWitness = JSON.parse(witness.slice(2));
  assert.equal(report.nativeWitness.observations.length, 14);
  await run("legacy-regressions", process.execPath, ["--import", "tsx", "--test", ...legacy]);
  await run("focused-types", process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit",
    "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict",
    "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax",
    "--forceConsistentCasingInFileNames", "--skipLibCheck", "--types", "node", ...focused]);
  await run("core-whitespace", "git", ["diff", "--check", `${candidate}^`, candidate, "--", ...corePaths]);
  report.inputsAfter = await manifest();
  assert.deepEqual(report.inputsAfter, report.inputsBefore);
  report.fixturesAfter = await fixtures();
  assert.deepEqual(report.fixturesAfter, report.fixturesBefore);
  report.status = "passed-scoped-author-checks";
} catch (error) {
  report.status = "failed-scoped-author-checks";
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  report.headAfter = git("rev-parse", "HEAD");
  report.finishedAt = new Date().toISOString();
  await save("report.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ destination, status: report.status, commands: report.commands }));
}
