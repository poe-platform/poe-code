import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [output, ...command] = process.argv.slice(2);
if (!output || !command.length) throw new Error("capture OUTPUT COMMAND [ARGS]");
const paths = ["src/commands/grep.ts", "src/commands/search/rg.ts", "src/commands/regex-execution/client.ts", "src/commands/regex-execution/protocol.ts", "src/commands/regex-execution/worker.ts", "src/commands/regex-execution/matching.ts", "src/contracts/command.ts", "src/contracts/command.md", "tests/commands/regex-execution/cleanup-registration/controls.test.ts"];
const hashes = () => Object.fromEntries(paths.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const before = hashes();
const started = new Date().toISOString();
const result = spawnSync(command[0], command.slice(1), { encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "--unhandled-rejections=strict" } });
const evidence = {
  started, finished: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  status: spawnSync("git", ["status", "--short"], { encoding: "utf8" }).stdout,
  command, before, after: hashes(), statusCode: result.status, signal: result.signal,
  error: result.error?.message, stdout: result.stdout, stderr: result.stderr,
};
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ output, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }));
process.exitCode = result.status ?? 1;
