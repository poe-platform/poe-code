import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const files = ["budgets", "edits", "properties", "regressions"].map(name =>
  fileURLToPath(new URL(`./${name}.test.ts`, import.meta.url)));
const source = new URL("../../../../src/commands/diff-patch/", import.meta.url);
const snapshot = () => Object.fromEntries(readdirSync(source).filter(name => name.endsWith(".ts")).sort().map(name =>
  [name, createHash("sha256").update(readFileSync(new URL(name, source))).digest("hex")]));
const started = snapshot();
console.log(`SOURCE_START ${JSON.stringify(started)}`);
const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", ...files], {
  cwd: root,
  encoding: "utf8",
  timeout: 180_000,
  killSignal: "SIGKILL",
  maxBuffer: 2 * 1024 * 1024,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.error) console.error(result.error);
const finished = snapshot();
const sourceChanged = JSON.stringify(started) !== JSON.stringify(finished);
console.log(`SOURCE_END ${JSON.stringify({ hashes: finished, sourceChanged })}`);
process.exitCode = sourceChanged ? 1 : result.status ?? 1;
