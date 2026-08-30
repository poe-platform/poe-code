import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../../..");
await mkdir(join(directory, "evidence"), { recursive: true });
const output = await mkdtemp(join(directory, "evidence/checks-v1-"));
const git = args => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout;
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(), status: git(["status", "--short"]), time: new Date().toISOString() });
const before = state();
const hashes = {};
async function record(path) {
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) { if (!entry.name.startsWith(".") && entry.name !== "evidence") await record(child); }
    else if (/\.(?:ts|mjs|json)$/u.test(entry.name)) hashes[child] = createHash("sha256").update(await readFile(join(root, child))).digest("hex");
  }
}
await record("src"); await record("tests/commands/du/functional-v1");
hashes["tests/commands/du/helpers.ts"] = createHash("sha256").update(await readFile(join(root, "tests/commands/du/helpers.ts"))).digest("hex");
const steps = [];
async function execute(name, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(join(output, `${name}.stdout.txt`), result.stdout ?? ""); await writeFile(join(output, `${name}.stderr.txt`), result.stderr ?? "");
  steps.push({ name, command, args, status: result.status, error: result.error?.message }); return result.status === 0;
}
const tests = (await readdir(directory)).filter(name => name.endsWith(".test.ts")).sort().map(name => join(directory, name));
await execute("focused-tests", process.execPath, ["--import", "tsx", "--test", ...tests]);
if (process.argv.includes("--owner-handoff")) await execute("unowned-expectation-handoff", process.execPath, ["--import", "tsx", "--test", "--test-name-pattern=all argument and environment validation|GNU 9.7 captured profile: (env:|-b $)", join(directory, "../behavior.test.ts"), join(directory, "../native.test.ts")]);
if (!process.argv.includes("--tests-only")) {
  await execute("typecheck", join(root, "node_modules/.bin/tsc"), ["-p", join(directory, "tsconfig.json")]);
  await mkdir(join(directory, ".build"), { recursive: true }); const build = await mkdtemp(join(directory, ".build/run-"));
  try {
    if (await execute("isolated-build", join(root, "node_modules/.bin/tsc"), ["-p", join(directory, "tsconfig.build.json"), "--outDir", build])) await execute("built-boundary", process.execPath, [join(directory, "verify-built.mjs"), build]);
  } finally { await rm(build, { recursive: true, force: true }); }
}
const changed = [];
for (const [path, expected] of Object.entries(hashes)) if (createHash("sha256").update(await readFile(join(root, path))).digest("hex") !== expected) changed.push(path);
await writeFile(join(output, "manifest.json"), JSON.stringify({ qualification: "Live scoped author checks; not an archive gate or competing-owner suite", before, after: state(), hashes, changedOriginalPaths: changed, appendProof: false, steps }, null, 2) + "\n");
console.log(JSON.stringify({ output, steps: steps.map(({ name, status }) => ({ name, status })), changedOriginalPaths: changed }));
if (steps.some(step => step.status !== 0)) process.exitCode = 1;
