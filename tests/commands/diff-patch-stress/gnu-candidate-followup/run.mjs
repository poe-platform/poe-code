import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const stamp = new Date().toISOString().replaceAll(":", "-");
const prefix = `${directory}evidence-${stamp}`;
async function hashes() {
  const paths = [];
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory()) await visit(`${path}/${entry.name}`);
      else if (/\.(?:ts|js|mjs|json)$/u.test(entry.name) && !entry.name.startsWith("evidence-")) paths.push(`${path}/${entry.name}`);
    }
  }
  await visit(`${root}src`);
  await visit(directory.replace(/\/$/u, ""));
  paths.push(`${root}tests/commands/diff-patch-stress/gnu-target/oracle.ts`, `${root}package.json`, `${root}tsconfig.json`);
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [relative(root, path), createHash("sha256").update(await readFile(path)).digest("hex")])));
}
const before = await hashes();
const contamination = Object.keys(before).filter(path => path.startsWith("src/") && path.endsWith(".js"));
if (contamination.length) throw new Error(`Generated JS can shadow source: ${contamination.join(", ")}`);
const commands = [
  [process.execPath, ["--import", "tsx", "--test", `${directory}candidates.test.ts`]],
  [process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", `${directory}tsconfig.json`]],
];
const outcomes = [];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, CANDIDATE_EVIDENCE: `${prefix}.json` }, timeout: 120_000, maxBuffer: 8_388_608 });
  outcomes.push({ command, args, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
}
const after = await hashes();
const stable = JSON.stringify(before) === JSON.stringify(after);
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
await writeFile(`${prefix}-validation.json`, `${JSON.stringify({ capturedAt: stamp, headAfter: head, qualification: "Moving worktree observation only; not the root frozen independent checkpoint", stable, before, after, outcomes }, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ prefix: relative(root, prefix), stable, exits: outcomes.map(outcome => outcome.exitCode) }));
process.exitCode = stable && outcomes.every(outcome => outcome.exitCode === 0) ? 0 : 1;
