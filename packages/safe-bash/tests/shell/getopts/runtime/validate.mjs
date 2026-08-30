import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const own = dirname(fileURLToPath(import.meta.url));
const repo = resolve(own, "../../../..");
const candidate = "618d8967009117547ab476256bc6eb0a9463309a";
const output = process.argv[2];
assert(output?.startsWith("/tmp/safe-bash-getopts-runtime."));
const root = join(output, "archive");
mkdirSync(root);
mkdirSync(join(output, "logs"));
mkdirSync(join(output, "tmp"));
const baseline = JSON.parse(readFileSync(join(own, "baseline.json")));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const paths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "tests/shell", "tests/contracts", "tests/commands/helpers.ts", "tests/commands/streams.test.ts", "tests/commands/pipelines.test.ts", "tests/commands/network", "tests/commands/network-zero-caps-review", "tests/integration/owned-output-production-rebase/author/helpers.ts", "tests/integration/owned-output-production-rebase/author/operation.test.ts", "tests/integration/owned-output-production-rebase/author/shell.test.ts", "tests/integration/owned-output-production-rebase/author/network.test.ts", "tests/integration/owned-output-production-rebase/author-public/fixtures"];
const archive = execFileSync("git", ["archive", candidate, "--", ...paths], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
writeFileSync(join(output, "candidate.tar"), archive);
execFileSync("tar", ["-xf", join(output, "candidate.tar"), "-C", root]);
function inventory(directory) {
  const result = {};
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), path);
    if (stat.isDirectory()) {
      result[name + "/"] = "directory";
      for (const [child, digest] of Object.entries(inventory(path))) result[name + "/" + child] = digest;
    } else { assert(stat.isFile(), path); result[name] = hash(readFileSync(path)); }
  }
  return result;
}
const before = inventory(root);
symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
const env = { ...process.env, TSX_DISABLE_CACHE: "1", TMPDIR: join(output, "tmp"), GIT_OPTIONAL_LOCKS: "0" };
const rows = [];
function run(label, command, cwd = root) {
  const actual = command[0] === "node" ? [process.execPath, ...command.slice(1)] : command;
  const started = new Date().toISOString();
  const child = spawnSync(actual[0], actual.slice(1), { cwd, env, encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  writeFileSync(join(output, "logs", label + ".stdout"), child.stdout ?? "");
  writeFileSync(join(output, "logs", label + ".stderr"), child.stderr ?? "");
  const counts = Object.fromEntries([...String(child.stdout).matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  rows.push({ label, command: actual, cwd, started, ended: new Date().toISOString(), status: child.status, signal: child.signal, error: child.error?.message, counts });
  console.log(label, child.status, counts);
  writeFileSync(join(output, "RUN.json"), JSON.stringify({ candidate, archiveSHA256: hash(archive), archivePaths: paths, node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, environment: { TSX_DISABLE_CACHE: "1", TMPDIR: env.TMPDIR, GIT_OPTIONAL_LOCKS: "0" }, tooling: { link: join(repo, "node_modules"), typescript: hash(readFileSync(join(repo, "node_modules/typescript/lib/typescript.js"))), tsx: hash(readFileSync(join(repo, "node_modules/tsx/package.json"))) }, inputs: before, rows }, null, 2) + "\n");
  return child.status === 0;
}
for (const label of ["source-types-final-02", "focused-types-final-02"]) run(label, baseline.commands[label]);
run("build", ["node", "node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"]);
const runtimeTests = ["state", "ordering", "host"].map(name => "tests/shell/getopts/runtime/" + name + ".test.ts");
run("runtime-types", ["node", "node_modules/typescript/bin/tsc", "--noEmit", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--strict", "--verbatimModuleSyntax", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--skipLibCheck", "tests/shell/getopts/runtime/helpers.ts", ...runtimeTests]);
run("runtime", ["node", "--unhandled-rejections=strict", "--import", "tsx", "--test", ...runtimeTests]);
for (const label of ["focused-final-02", "legacy-core-final-02", "legacy-state-final"]) run(label, baseline.commands[label]);
const consumer = join(output, "consumer"), product = join(consumer, "node_modules/virtual-bash");
mkdirSync(product, { recursive: true });
cpSync(join(root, "dist"), join(product, "dist"), { recursive: true });
cpSync(join(root, "package.json"), join(product, "package.json"));
writeFileSync(join(consumer, "package.json"), '{"type":"module","private":true}\n');
cpSync(join(root, "tests/integration/owned-output-production-rebase/author-public/fixtures/public.mjs"), join(consumer, "public.mjs"));
cpSync(join(root, "tests/integration/owned-output-production-rebase/author-public/fixtures/consumer.ts.data"), join(consumer, "consumer.ts"));
symlinkSync(join(repo, "node_modules/@types"), join(consumer, "node_modules/@types"));
run("moved-public-runtime", ["node", "--unhandled-rejections=strict", "--test", "public.mjs"], consumer);
run("moved-public-types", ["node", join(repo, "node_modules/typescript/bin/tsc"), "--noEmit", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--strict", "--verbatimModuleSyntax", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--skipLibCheck", "consumer.ts"], consumer);
const after = {};
for (const name of readdirSync(root).sort()) {
  if (name === "dist" || name === "node_modules") continue;
  const path = join(root, name);
  if (lstatSync(path).isDirectory()) { after[name + "/"] = "directory"; for (const [child, digest] of Object.entries(inventory(path))) after[name + "/" + child] = digest; }
  else after[name] = hash(readFileSync(path));
}
assert.deepEqual(after, before);
writeFileSync(join(output, "INTEGRITY.json"), JSON.stringify({ candidate, unchangedIncludingNewEntries: true, excludedGenerated: ["dist", "node_modules"], built: inventory(join(root, "dist")), moved: inventory(product), childrenSettled: true }, null, 2) + "\n");
if (rows.some(row => row.status !== 0)) process.exitCode = 1;
