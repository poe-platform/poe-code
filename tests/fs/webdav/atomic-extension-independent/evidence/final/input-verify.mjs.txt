import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../..");
const label = process.argv[2];
if (!/^[a-z0-9-]+$/u.test(label ?? "")) throw new Error("unique cohort label required");
const output = join(own, "evidence", label);
await mkdir(output);
const workspace = await mkdtemp(join(own, ".work-"));
const source = join(workspace, "source");
const consumer = join(workspace, "consumer");
await mkdir(source);
await mkdir(consumer);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(await readFile(join(own, "evidence/freeze/manifest.json"), "utf8"));
const records = [];
const env = { PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, HOME: workspace, TMPDIR: workspace,
  npm_config_cache: join(workspace, "npm-cache"), INDEPENDENT_LOADED_LOG: join(output, "loaded.jsonl") };
function run(name, command, args, cwd = source) {
  const start = Date.now();
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  records.push({ name, command, args, cwd, startedAt: new Date(start).toISOString(), elapsedMs: Date.now() - start,
    status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  console.log(name, result.status, result.stdout?.match(/# (?:tests|pass|fail) \d+/gu)?.join(", ") ?? "");
  return result;
}
try {
  const archive = await readFile(join(own, "evidence/freeze/candidate.tar.gz"));
  if (hash(archive) !== manifest.archives.candidate.sha256) throw new Error("archive hash mismatch");
  execFileSync("tar", ["xzf", join(own, "evidence/freeze/candidate.tar.gz"), "-C", source]);
  for (const [path, expected] of Object.entries(manifest.inputs.candidate)) {
    if (hash(await readFile(join(source, path))) !== expected) throw new Error(`frozen input differs: ${path}`);
  }
  const holdout = "tests/fs/webdav/atomic-extension-independent/holdouts.test.ts";
  await mkdir(dirname(join(source, holdout)), { recursive: true });
  await copyFile(join(own, "holdouts.test.ts"), join(source, holdout));
  const inputs = {};
  for (const name of ["holdouts.test.ts", "consumer.mts", "loaded.mjs", "verify.mjs"]) {
    const bytes = await readFile(join(own, name));
    inputs[name] = hash(bytes);
    await writeFile(join(output, `input-${name}.txt`), bytes);
  }
  const tooling = {};
  for (const name of ["typescript", "tsx", "@types/node"]) {
    const bytes = await readFile(join(repo, "node_modules", name, "package.json"));
    tooling[name] = { version: JSON.parse(bytes).version, packageSha256: hash(bytes) };
  }
  await writeFile(join(output, "inputs.json"), JSON.stringify({ revision: manifest.candidate, archiveSha256: hash(archive),
    node: process.version, platform: process.platform, arch: process.arch, tooling, inputs, workspace,
    sourceInputCount: Object.keys(manifest.inputs.candidate).length, inputHashesVerified: true,
    sharedDirtyStatus: execFileSync("git", ["status", "--short"], { cwd: repo, encoding: "utf8" }) }, null, 2));
  const tests = (name, paths) => run(name, join(repo, "node_modules/.bin/tsx"), ["--test", ...paths]);
  tests("independent", [holdout]);
  tests("original33-unchanged", [manifest.original33]);
  tests("top-level-unchanged", manifest.top.filter(path => path.endsWith(".test.ts")));
  for (const path of manifest.guards) tests(path.split("/").at(-1), [path]);
  tests("aliases-unchanged", manifest.aliases);
  const compiler = join(repo, "node_modules/typescript/bin/tsc");
  const strict = ["--strict", "--target", "ES2023", "--lib", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext",
    "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess", "--verbatimModuleSyntax", "--skipLibCheck", "--typeRoots", join(repo, "node_modules/@types")];
  run("scoped-types", process.execPath, [compiler, "--noEmit", ...strict, holdout, manifest.original33]);
  const build = run("isolated-build", process.execPath, [compiler, "-p", "tsconfig.build.json", "--typeRoots", join(repo, "node_modules/@types")]);
  if (build.status !== 0) throw new Error("isolated build failed");
  const pack = run("npm-pack", "npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", workspace]);
  if (pack.status !== 0) throw new Error("pack failed");
  const packed = join(workspace, JSON.parse(pack.stdout)[0].filename);
  await copyFile(packed, join(output, "virtual-bash-0.0.0.tgz"));
  const extracted = join(consumer, "node_modules/virtual-bash");
  await mkdir(extracted, { recursive: true });
  execFileSync("tar", ["xzf", packed, "--strip-components=1", "-C", extracted]);
  if (hash(await readFile(join(extracted, "package.json"))) !== manifest.inputs.candidate["package.json"]) throw new Error("packed manifest changed");
  const consumerPackage = { name: "atomic-extension-independent-consumer", private: true, type: "module" };
  await writeFile(join(consumer, "package.json"), JSON.stringify(consumerPackage));
  await copyFile(join(own, "consumer.mts"), join(consumer, "consumer.mts"));
  const consumerBuild = run("public-consumer-types", process.execPath, [compiler, ...strict, "consumer.mts"], consumer);
  if (consumerBuild.status === 0) {
    const runtime = run("public-consumer-runtime", process.execPath, ["--experimental-loader", join(own, "loaded.mjs"), "consumer.mjs"], consumer);
    if (runtime.status === 0) {
      const loaded = (await readFile(join(output, "loaded.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
      if (loaded.length === 0) throw new Error("no package modules observed loading");
      for (const entry of loaded) {
        const relative = entry.url.split("/consumer/node_modules/virtual-bash/")[1];
        if (hash(await readFile(join(source, relative))) !== entry.sha256
          || hash(await readFile(join(extracted, relative))) !== entry.sha256) throw new Error(`loaded module differs: ${relative}`);
      }
      await writeFile(join(output, "loaded-verification.json"), JSON.stringify({ loadedModules: loaded.length,
        everyLoadedSourceMatchesIsolatedBuildAndExtractedPackage: true, selfReferenceDefeated: true }, null, 2));
    }
  }
  await writeFile(join(output, "package.json"), JSON.stringify({ consumerPackage, packageSha256: hash(await readFile(packed)),
    extractedManifestSha256: hash(await readFile(join(extracted, "package.json"))), selfReferenceDefeated: true }, null, 2));
} finally {
  await writeFile(join(output, "commands.json"), JSON.stringify(records, null, 2) + "\n");
  await rm(workspace, { recursive: true, force: true });
  await writeFile(join(output, "cleanup.json"), JSON.stringify({ workspace, removed: true, sharedDistWritten: false }) + "\n");
}
process.exitCode = records.some(record => record.status !== 0) ? 1 : 0;
