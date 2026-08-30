import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const output = new URL(`./${process.argv[2]}.json`, import.meta.url);
const command = process.argv[3];
const args = process.argv.slice(4);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout.trim();
async function identities() {
  const paths = git(["ls-files", "src"]).split("\n");
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, digest(await readFile(new URL(`../../../../${path}`, import.meta.url)))])));
}
const evidence = { started: new Date().toISOString(), node: process.version, command, args, head: git(["rev-parse", "HEAD"]), status: git(["status", "--short"]), before: await identities() };
await writeFile(output, JSON.stringify({ ...evidence, claimed: true }) + "\n", { flag: "wx" });
const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 120000, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 });
Object.assign(evidence, { ended: new Date().toISOString(), result: { status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, after: await identities(), finalHead: git(["rev-parse", "HEAD"]), finalStatus: git(["status", "--short"]) });
await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ output: output.pathname, status: result.status, signal: result.signal }));
process.exitCode = result.status ?? 1;
