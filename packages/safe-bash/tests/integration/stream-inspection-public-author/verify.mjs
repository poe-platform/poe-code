import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const author = dirname(fileURLToPath(import.meta.url));
const root = resolve(author, "../../..");
const mode = process.argv[2] ?? "all";
assert.ok(["tests", "package", "all"].includes(mode));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = directory => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .flatMap(entry => entry.isDirectory() ? manifest(join(directory, entry.name)) : [{ path: relative(root, join(directory, entry.name)), sha256: hash(readFileSync(join(directory, entry.name))) }]);
};
const publish = (path, text) => {
  assert.equal(existsSync(path), false, `Refusing to overwrite evidence: ${path}`);
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", [], { cwd: root, input: patch, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
};
const report = {
  started: new Date().toISOString(), mode, node: process.version, platform: process.platform, arch: process.arch,
  sourceBefore: manifest(join(root, "src")), mainDistBefore: manifest(join(root, "dist")), runs: [],
  authorInputs: ["public.test.ts", "consumer.mts", "tsconfig.json", "verify.mjs"].map(path => ({ path, sha256: hash(readFileSync(join(author, path))) })),
  primaryDocs: ["https://nodejs.org/api/packages.html", "https://docs.npmjs.com/cli/v10/commands/npm-pack/", "https://docs.npmjs.com/cli/v10/using-npm/config/"],
};
const run = (command, args, cwd = root, env = process.env) => {
  const started = new Date().toISOString();
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  report.runs.push({ command, args, cwd, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
let failure;
try {
  report.head = run("git", ["rev-parse", "HEAD"]).trim();
  report.statusBefore = run("git", ["status", "--short"]);
  report.indexBefore = run("git", ["diff", "--cached", "--name-status"]);
  const toolchain = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "node_modules/typescript/package.json", "node_modules/typescript/lib/_tsc.js", "node_modules/tsx/package.json", "node_modules/@types/node/package.json"];
  report.toolchainBefore = toolchain.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  report.versions = {
    npm: run("npm", ["--version"]).trim(),
    typescript: run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "--version"]).trim(),
    tsx: JSON.parse(readFileSync(join(root, "node_modules/tsx/package.json"), "utf8")).version,
    nodeTypes: JSON.parse(readFileSync(join(root, "node_modules/@types/node/package.json"), "utf8")).version,
  };
  if (mode !== "package") {
    const baseline = JSON.parse(readFileSync(join(author, "evidence/baseline.json"), "utf8"));
    run(process.execPath, [...baseline.args, relative(root, join(author, "public.test.ts"))]);
    run(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(author, "tsconfig.json")]);
  }
  if (mode !== "tests") {
    mkdirSync(join(author, "dist"), { recursive: true });
    const scratch = mkdtempSync(join(author, "dist/build-"));
    report.scratch = relative(root, scratch);
    const snapshot = join(scratch, "snapshot"), consumer = join(scratch, "consumer"), tarballs = join(scratch, "tarballs");
    mkdirSync(snapshot); mkdirSync(consumer); mkdirSync(tarballs);
    cpSync(join(root, "src"), join(snapshot, "src"), { recursive: true });
    for (const name of ["package.json", "tsconfig.json", "tsconfig.build.json", "README.md"]) cpSync(join(root, name), join(snapshot, name));
    report.snapshotBefore = manifest(snapshot);
    const compiler = join(root, "node_modules/typescript/bin/tsc"), typeRoots = join(root, "node_modules/@types");
    run(process.execPath, [compiler, "-p", "tsconfig.build.json", "--typeRoots", typeRoots], snapshot);
    const cleanEnv = { PATH: process.env.PATH, HOME: scratch, TMPDIR: scratch, LC_ALL: "C", TZ: "UTC", npm_config_userconfig: join(scratch, "empty-user.npmrc"), npm_config_globalconfig: join(scratch, "empty-global.npmrc"), npm_config_update_notifier: "false" };
    publish(join(scratch, "empty-user.npmrc"), "\n");
    publish(join(scratch, "empty-global.npmrc"), "\n");
    const packed = JSON.parse(run("npm", ["pack", "--offline", "--ignore-scripts", "--json", "--cache", join(scratch, "npm-cache"), "--pack-destination", tarballs], snapshot, cleanEnv));
    assert.equal(packed.length, 1);
    const tarball = join(tarballs, packed[0].filename);
    report.tarball = { path: relative(root, tarball), sha256: hash(readFileSync(tarball)), metadata: packed[0] };
    const target = join(consumer, "node_modules/virtual-bash");
    mkdirSync(target, { recursive: true });
    run("tar", ["-xzf", tarball, "--strip-components=1", "-C", target], consumer);
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) assert.equal(Object.keys(pkg[section] ?? {}).length, 0, section);
    assert.deepEqual(pkg.exports["./commands/stream-inspection"], { types: "./dist/commands/stream-inspection/index.d.ts", import: "./dist/commands/stream-inspection/index.js" });
    assert.equal(existsSync(join(target, "src")), false);
    for (const entry of manifest(join(snapshot, "dist"))) {
      const path = relative(join(snapshot, "dist"), join(root, entry.path));
      assert.equal(hash(readFileSync(join(target, "dist", path))), entry.sha256, path);
    }
    publish(join(consumer, "package.json"), JSON.stringify({ name: "stream-public-author-consumer", private: true, type: "module" }));
    cpSync(join(author, "consumer.mts"), join(consumer, "consumer.mts"));
    run(process.execPath, [compiler, "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--skipLibCheck", "--types", "node", "--typeRoots", typeRoots, "--outDir", "output", "consumer.mts"], consumer);
    report.consumer = JSON.parse(run(process.execPath, ["--unhandled-rejections=strict", "output/consumer.mjs"], consumer, cleanEnv));
    report.builtArtifacts = manifest(join(snapshot, "dist")).filter(entry => /(?:dist\/index\.|dist\/plugins\/index\.|dist\/commands\/stream-inspection\/)/u.test(entry.path));
    report.cleanup = "All child processes completed synchronously; isolated snapshot, package and consumer artifacts retained under ignored author dist directory. No installed packages, native builds or main dist writes.";
  }
  report.toolchainAfter = toolchain.map(path => ({ path, sha256: hash(readFileSync(join(root, path))) }));
  assert.deepEqual(report.toolchainAfter, report.toolchainBefore);
} catch (error) {
  failure = error;
  report.failure = { name: error.name, message: error.message, stack: error.stack };
} finally {
  report.sourceAfter = manifest(join(root, "src"));
  report.mainDistAfter = manifest(join(root, "dist"));
  report.sourceStable = JSON.stringify(report.sourceBefore) === JSON.stringify(report.sourceAfter);
  report.mainDistStable = JSON.stringify(report.mainDistBefore) === JSON.stringify(report.mainDistAfter);
  if (!report.sourceStable || !report.mainDistStable) {
    report.integrityFailure = "Source or main dist changed during validation";
    failure ??= new Error(report.integrityFailure);
  }
  report.finished = new Date().toISOString();
  report.passed = !failure;
  let attempt = 1;
  while (existsSync(join(author, `evidence/validation-${String(attempt).padStart(3, "0")}.json`))) attempt++;
  const evidence = join(author, `evidence/validation-${String(attempt).padStart(3, "0")}.json`);
  publish(evidence, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidence: relative(root, evidence), passed: report.passed, mode, scratch: report.scratch, sourceStable: report.sourceStable, mainDistStable: report.mainDistStable }));
}
if (failure) { console.error(failure.message); process.exitCode = 1; }
