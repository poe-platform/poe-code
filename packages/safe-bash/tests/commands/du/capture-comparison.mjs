import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.ts";
import { createRealFileSystem } from "../../../src/fs/real/index.ts";
import { seed, shellRun } from "./helpers.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../../..");
const profile = JSON.parse(await readFile(join(directory, "native-profile.json"), "utf8"));
const oracle = resolve(directory, "../metadata-stress/.oracle/coreutils-9.7/src/du");
const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex");
const binaryBefore = await hash(oracle), oracleSourceBefore = await hash(`${oracle}.c`);
if (binaryBefore !== profile.binarySha256) throw new Error("Pinned GNU binary changed");
await mkdir(join(directory, "evidence"), { recursive: true });
const output = await mkdtemp(join(directory, "evidence/comparison-"));
const fixture = await mkdtemp(join(output, "fixture-"));
const sources = {};
for (const name of (await readdir(join(root, "src/commands/du"))).filter(name => name.endsWith(".ts"))) sources[`src/commands/du/${name}`] = await hash(join(root, "src/commands/du", name));
const state = () => ({ head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), status: spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).stdout });
const before = state();
try {
  const memory = createMemoryFileSystem(); await seed(memory);
  await memory.link("/tree/a", "/alias"); await memory.symlink("tree", "/link"); await memory.symlink("absent", "/broken");
  for (const size of profile.sizes) await memory.writeFile(`/size-${size}`, new Uint8Array(size));
  const memoryResults = [];
  for (const native of profile.results) {
    const product = await shellRun(memory, native.args, native.env);
    memoryResults.push({ native, product: { status: product.exitCode, stdout: product.stdout, stderr: product.stderr }, exactStatusStdout: product.exitCode === native.status && product.stdout === native.stdout, exactAllFields: product.exitCode === native.status && product.stdout === native.stdout && product.stderr === native.stderr });
  }
  const real = await createRealFileSystem({ root: fixture }); await seed(real);
  await real.link("/tree/a", "/alias"); await real.writeFile("/sparse", new Uint8Array()); await truncate(join(fixture, "sparse"), 1048576);
  await symlink("tree", join(fixture, "link")); await symlink("absent", join(fixture, "broken"));
  const realResults = [];
  const cases = [["tree"], ["-s", "tree"], ["-sc", "tree"], ["-sB1", "tree"], ["-sh", "tree"], ["-sk", "tree"], ["-sm", "tree"], ["-sBKB", "tree"], ["-a", "tree"], ["-ad1", "tree"], ["-b", "tree"], ["-bc", "tree/a", "alias"], ["-blc", "tree/a", "alias"], ["-B1", "sparse"], ["-b", "sparse"], ["-bc", "link", "broken"], ["-c", "link", "broken"], ["-b", "link/"]];
  for (const args of cases) {
    const native = spawnSync(oracle, args, { cwd: fixture, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, encoding: "utf8", timeout: 10000, maxBuffer: 65536 });
    const product = await shellRun(real, args);
    const records = text => text.trimEnd().split("\n").sort();
    realResults.push({ args, native: { status: native.status, stdout: native.stdout, stderr: native.stderr }, product: { status: product.exitCode, stdout: product.stdout, stderr: product.stderr }, exactAllFields: product.exitCode === native.status && product.stdout === native.stdout && product.stderr === native.stderr, sameRecordsStatusStderr: product.exitCode === native.status && JSON.stringify(records(product.stdout)) === JSON.stringify(records(native.stdout)) && product.stderr === native.stderr });
  }
  const binaryAfter = await hash(oracle), oracleSourceAfter = await hash(`${oracle}.c`);
  const changedSources = [];
  for (const [path, expected] of Object.entries(sources)) if (await hash(join(root, path)) !== expected) changedSources.push(path);
  const summary = { memoryCapturedNativeCases: memoryResults.length, memoryExactStatusStdout: memoryResults.filter(result => result.exactStatusStdout).length, memoryExactAllFields: memoryResults.filter(result => result.exactAllFields).length, liveRealCases: realResults.length, realExactAllFields: realResults.filter(result => result.exactAllFields).length, realSameRecordsStatusStderr: realResults.filter(result => result.sameRecordsStatusStderr).length };
  await writeFile(join(output, "results.json"), JSON.stringify({ created: new Date().toISOString(), platform: process.platform, node: process.version, before, after: state(), sources, changedSources, binaryBefore, binaryAfter, oracleSourceBefore, oracleSourceAfter, appendProof: false, summary, memoryResults, realResults }, null, 2) + "\n");
  console.log(JSON.stringify({ output, ...summary }));
  if (binaryBefore !== binaryAfter || oracleSourceBefore !== oracleSourceAfter || changedSources.length || realResults.some(result => !result.sameRecordsStatusStderr)) process.exitCode = 1;
} finally { await rm(fixture, { recursive: true, force: true }); }
