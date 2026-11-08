import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verify } from "./contracts.mjs";

const [candidate, output, oracle] = process.argv.slice(2);
if (!candidate || !output || !oracle) throw new Error("Pass frozen candidate, unique output, authenticated oracle");
const load = path => import(pathToFileURL(join(candidate, "dist", path)).href);
const { Shell } = await load("shell/index.js");
const { duCommands, createDuCommand } = await load("commands/du/index.js");
const { createMemoryFileSystem } = await load("fs/memory/index.js");
const { createRealFileSystem } = await load("fs/real/index.js");
const { FsError } = await load("contracts/index.js");
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const run = async (fs, args, env = {}, options = {}) => {
  const shell = new Shell({ fs, env }).use(duCommands(options));
  try {
    const result = await shell.exec(`du ${args.map(quote).join(" ")}`);
    return { status: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  } finally { await shell.dispose(); }
};
const results = { nativeProfile: [], nativeIndependent: [], checks: [], blockers: [] };
const save = () => writeFile(join(output, "independent.json"), JSON.stringify(results, null, 2) + "\n");
const fixture = await mkdtemp(join(output, "fixture-"));
const check = async (name, callback) => {
  try { await callback(); results.checks.push({ name, status: "pass" }); }
  catch (error) { results.checks.push({ name, status: "fail", error: error.stack }); await save(); throw error; }
};
const records = (value, nul = false) => value.split(nul ? "\0" : "\n").sort();
const same = (native, product, nul = false) => native.status === product.status && native.stderr === product.stderr && JSON.stringify(records(native.stdout, nul)) === JSON.stringify(records(product.stdout, nul));
try {
  const profile = JSON.parse(await readFile(join(candidate, "tests/commands/du/native-profile.json"), "utf8"));
  const memory = createMemoryFileSystem();
  await memory.mkdir("/tree/sub", { recursive: true });
  await memory.writeFile("/tree/a", new Uint8Array(3));
  await memory.writeFile("/tree/sub/b", new Uint8Array(5));
  await memory.link("/tree/a", "/alias");
  await memory.symlink("tree", "/link");
  await memory.symlink("absent", "/broken");
  for (const size of profile.sizes) await memory.writeFile(`/size-${size}`, new Uint8Array(size));
  for (const native of profile.results) {
    const product = await run(memory, native.args, native.env);
    const exact = native.status === product.status && native.stdout === product.stdout && native.stderr === product.stderr;
    let classification = exact ? "exact-all-fields" : "UNEXPLAINED";
    if (!exact && native.name === "-b tree tree") classification = "intentional-directory-namespace-not-pruned";
    else if (!exact && ["env:{\"DU_BLOCK_SIZE\":\"bad\"}", "env:{\"DU_BLOCK_SIZE\":\"\",\"BLOCK_SIZE\":\"2K\"}"].includes(native.name)) classification = "intentional-strict-invalid-environment";
    else if (!exact && native.status === product.status && native.stdout === product.stdout) classification = "diagnostic-profile-only";
    results.nativeProfile.push({ native, product, exact, classification, ...(native.name.startsWith("block:") ? { topic: "format-grammar/safe-range; these rejected cases differ only in diagnostic text" } : {}) });
    if (classification === "UNEXPLAINED") throw new Error(`Unexplained original native case: ${native.name}`);
  }
  await save();
  const real = await createRealFileSystem({ root: fixture });
  await real.mkdir("/tree/sub/deep", { recursive: true });
  await real.writeFile("/tree/a", new Uint8Array(3));
  await real.writeFile("/tree/sub/b", new Uint8Array(1025));
  await real.writeFile("/tree/sub/deep/c", new Uint8Array(511));
  await real.link("/tree/a", "/alias");
  await real.symlink("tree", "/link");
  await real.symlink("missing", "/broken");
  await real.symlink("../..", "/tree/sub/cycle");
  await real.writeFile("/sparse", new Uint8Array());
  await truncate(join(fixture, "sparse"), 4 * 1024 * 1024 + 1);
  await real.writeFile("/-dash", new Uint8Array(7));
  const sizes = [0, 1, 511, 512, 513, 999, 1000, 1001, 1023, 1024, 1025, 9217, 10239, 10240, 1047552, 1047553, 1048575, 1048576, 1048577];
  for (const size of sizes) await real.writeFile(`/size-${size}`, new Uint8Array(size));
  const cases = [];
  for (const flags of [[], ["-a"], ["-s"], ["-c"], ["-h"], ["-k"], ["-m"], ["-B1"], ["-b"], ["-d0"], ["-d1"], ["-l"], ["-0"], ["-ac0B512"], ["-bc"], ["-bacd1"], ["--all", "--total", "--null", "--block-size=1"], ["--summarize", "--count-links", "--human-readable"], ["--apparent-size", "--max-depth=1"], ["--bytes", "--total"], ["-bkh"], ["-hkb"]]) cases.push({ args: [...flags, "tree"] });
  for (const size of sizes) for (const flags of [["-bh"], ["-b", "-Bsi"], ["--apparent-size", "-B512"], ["-B1"]]) cases.push({ args: [...flags, `size-${size}`] });
  for (const args of [["-bc", "tree/a", "alias"], ["-blc", "tree/a", "alias"], ["-cB1", "sparse"], ["-b", "sparse"], ["-bc", "link", "broken"], ["-cB1", "link", "broken"], ["-b", "link/"], ["-bs", "."], ["-bs", "./"], ["-bs", "./tree/"], ["-bs", "tree/sub/../"], ["-b", "--", "-dash"]]) cases.push({ args });
  for (const env of [{ DU_BLOCK_SIZE: "2K" }, { BLOCK_SIZE: "KB" }, { BLOCKSIZE: "512" }, { POSIXLY_CORRECT: "" }, { DU_BLOCK_SIZE: "1", BLOCK_SIZE: "2K", BLOCKSIZE: "4K" }]) cases.push({ args: ["--apparent-size", "size-1025"], env });
  for (const item of cases) {
    const nativeResult = spawnSync(oracle, item.args, { cwd: fixture, env: { PATH: "/usr/bin:/bin", LC_ALL: "C", ...item.env }, encoding: "utf8", timeout: 10000 });
    const native = { status: nativeResult.status, stdout: nativeResult.stdout, stderr: nativeResult.stderr, error: nativeResult.error?.message };
    const product = await run(real, item.args, item.env);
    const equal = same(native, product, item.args.some(argument => argument === "--null" || /^-[^-]*0/u.test(argument)));
    results.nativeIndependent.push({ ...item, native, product, sameRecordsStatusStderr: equal, exactAllFields: native.status === product.status && native.stdout === product.stdout && native.stderr === product.stderr });
    if (!equal) {
      results.stop = { reason: "new native mismatch; broad extra checks stopped pending minimal reproduction", args: item.args };
      await save();
      throw new Error(`Native mismatch: ${JSON.stringify(item.args)}`);
    }
  }
  await check("virtual root operand mapped only in native display", async () => {
    const native = spawnSync(oracle, ["-bs", fixture], { cwd: fixture, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, encoding: "utf8", timeout: 10000 });
    const product = await run(real, ["-bs", "/"]);
    assert.equal(product.status, native.status);
    assert.equal(product.stderr, native.stderr);
    assert.equal(product.stdout, native.stdout.replaceAll(fixture, "/"));
    results.rootMapping = { native: { status: native.status, stdout: native.stdout, stderr: native.stderr }, product, transformation: "replace owned native fixture absolute path with virtual /" };
  });
  await save();
  await verify({ candidate, load, run, check, results });
} catch (error) {
  results.error = error.stack;
  process.exitCode = 1;
} finally {
  await rm(fixture, { recursive: true, force: true });
  results.nativeFixtureCleaned = true;
  await save();
  console.log(JSON.stringify({ captured: results.nativeProfile.length, nativeIndependent: results.nativeIndependent.length, checks: results.checks, stop: results.stop }));
}
