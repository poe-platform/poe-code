import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const directory = "tests/commands/diff-patch-stress/formats";
async function hashes() {
  const result = {};
  for (const name of (await readdir("src/commands/diff-patch")).filter(name => name.endsWith(".ts")).sort()) {
    result[name] = createHash("sha256").update(await readFile(`src/commands/diff-patch/${name}`)).digest("hex");
  }
  for (const name of ["runtime.ts", "shell.ts", "types.ts"]) {
    result[`shell/${name}`] = createHash("sha256").update(await readFile(`src/shell/${name}`)).digest("hex");
  }
  return result;
}
console.log("HEAD_BEFORE", execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
console.log("SOURCE_BEFORE", JSON.stringify(await hashes()));
const files = (await readdir(directory)).filter(name => name.endsWith(".test.ts")).sort().map(name => `${directory}/${name}`);
const child = spawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", ...files], { stdio: ["ignore", "pipe", "pipe"] });
let output = "";
let bytes = 0;
let failure;
const timer = setTimeout(() => { failure = "suite timeout 180s"; child.kill("SIGKILL"); }, 180_000);
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
  bytes += chunk.length;
  if (bytes > 16 * 1024 * 1024) { failure = "suite output cap 16MiB"; child.kill("SIGKILL"); }
  else output += chunk.toString("utf8");
});
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
clearTimeout(timer);
const lines = output.split("\n");
const failures = lines.filter(line => /^not ok /u.test(line));
console.log("FAILURE_COUNT", failures.length);
console.log(failures.slice(0, 30).join("\n"));
if (failures.length > 30) console.log(`Further failing names: ${failures.length - 30}; rerun node:test directly for full TAP.`);
const groups = {};
for (const match of output.matchAll(/^(ok|not ok) \d+ - (.+)$/gmu)) {
  const name = match[2];
  const group = ["native-native control", "independent formatter", "independent parser", "GNU whitespace static control", "whitespace", "mixed actual changes", "patch -l", "context merging", "option interactions", "format budget", "patch format budget", "format cancellation", "Shell plugin"].find(prefix => name.startsWith(prefix)) ?? "focused-other";
  groups[group] ??= { pass: 0, fail: 0 };
  groups[group][match[1] === "ok" ? "pass" : "fail"]++;
}
console.log("GROUP_COUNTS", JSON.stringify(groups));
const diagnostics = [...output.matchAll(/^not ok [\s\S]*?^  \.\.\./gmu)].slice(0, 8);
console.log(diagnostics.map(match => match[0]).join("\n"));
console.log(lines.filter(line => /^# (?:tests|pass|fail|cancelled|skipped|todo|duration_ms|FORMAT_ORACLES|DIALECT_CONTROL)/u.test(line)).join("\n"));
console.log("SOURCE_AFTER", JSON.stringify(await hashes()));
console.log("HEAD_AFTER", execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
if (failure) console.error(failure);
process.exitCode = failure ? 2 : code ?? 2;
