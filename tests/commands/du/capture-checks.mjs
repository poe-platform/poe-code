import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../..");
await mkdir(join(directory, "evidence"), { recursive: true });
const output = await mkdtemp(join(directory, "evidence/checks-"));
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 }).stdout;
const before = { head: git("rev-parse", "HEAD").trim(), status: git("status", "--short"), time: new Date().toISOString() };
const sources = {};
async function record(path) {
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) { if (!entry.name.startsWith(".") && entry.name !== "evidence") await record(child); }
    else if (/\.(?:ts|mjs|json)$/u.test(entry.name)) sources[child] = createHash("sha256").update(await readFile(join(root, child))).digest("hex");
  }
}
await record("src"); await record("tests/commands/du");
sources["tests/fs/webdav/mock.ts"] = createHash("sha256").update(await readFile(join(root, "tests/fs/webdav/mock.ts"))).digest("hex");
const tests = (await readdir(directory)).filter(name => name.endsWith(".test.ts")).sort().map(name => join(directory, name));
const steps = [];
const execute = async (name, command, args) => {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  await writeFile(join(output, `${name}.stdout.txt`), result.stdout ?? "");
  await writeFile(join(output, `${name}.stderr.txt`), result.stderr ?? "");
  steps.push({ name, command, args, started, ended: new Date().toISOString(), status: result.status, error: result.error?.message });
  return result.status === 0;
};
await execute("tests", process.execPath, ["--import", "tsx", "--test", ...tests]);
await execute("typecheck", join(root, "node_modules/.bin/tsc"), ["-p", "tests/commands/du/tsconfig.json"]);
if (!process.argv.includes("--no-build")) {
  await mkdir(join(directory, ".build"), { recursive: true });
  const build = await mkdtemp(join(directory, ".build/check-"));
  try {
    if (await execute("build", join(root, "node_modules/.bin/tsc"), ["-p", "tests/commands/du/tsconfig.build.json", "--outDir", build])) {
      await execute("built-boundary", process.execPath, [join(directory, "verify-built.mjs"), build]);
    }
  } finally { await rm(build, { recursive: true, force: true }); }
}
const changed = [];
for (const [path, expected] of Object.entries(sources)) {
  const actual = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
  if (actual !== expected) changed.push(path);
}
const after = { head: git("rev-parse", "HEAD").trim(), status: git("status", "--short"), time: new Date().toISOString() };
await writeFile(join(output, "manifest.json"), JSON.stringify({ profile: "author live scoped validation, not frozen archive or release acceptance", platform: process.platform, node: process.version, before, after, sources, changedOriginalPaths: changed, appendProof: false, steps }, null, 2) + "\n");
console.log(JSON.stringify({ output, steps: steps.map(({ name, status }) => ({ name, status })), changedOriginalPaths: changed }));
if (steps.some(step => step.status !== 0)) process.exitCode = 1;
