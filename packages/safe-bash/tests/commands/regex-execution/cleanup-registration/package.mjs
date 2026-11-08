import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = "tests/commands/regex-execution/cleanup-registration";
const build = resolve(directory, "artifacts/phase-a");
const workspace = mkdtempSync(resolve(directory, "artifacts/package-"));
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: "--unhandled-rejections=strict" } });
  return { command: [command, ...args], status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, error: result.error?.message };
};
const pack = run("npm", ["pack", "--ignore-scripts", "--json", "--cache", resolve(workspace, "cache"), "--pack-destination", workspace], build);
assert.equal(pack.status, 0, pack.stderr);
const tarball = resolve(workspace, JSON.parse(pack.stdout)[0].filename);
const consumer = resolve(workspace, "consumer");
const installed = resolve(consumer, "node_modules/virtual-bash");
mkdirSync(installed, { recursive: true });
const extract = run("tar", ["-xzf", tarball, "--strip-components=1", "-C", installed], workspace);
assert.equal(extract.status, 0, extract.stderr);
writeFileSync(resolve(consumer, "package.json"), '{"name":"regex-cleanup-author-consumer","private":true,"type":"module"}\n');
copyFileSync("tests/commands/regex-execution/continuation/public-child.mjs", resolve(consumer, "ordinary.mjs"));
writeFileSync(resolve(consumer, "resolution.mjs"), 'import assert from "node:assert/strict"; assert.ok(import.meta.resolve("virtual-bash").startsWith(new URL("./node_modules/virtual-bash/", import.meta.url).href)); console.log(import.meta.resolve("virtual-bash"));\n');
writeFileSync(resolve(consumer, "consumer.mts"), 'import { Shell, MemoryFileSystem, agentCommands } from "virtual-bash";\nimport type { CommandContext, InvocationCleanup } from "virtual-bash/contracts";\nconst cleanup: InvocationCleanup = () => {};\nconst register: CommandContext["registerCleanup"] = hook => { void hook; };\nregister(cleanup);\nconst shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());\nvoid shell;\n');
const moved = resolve(workspace, "moved-consumer");
renameSync(consumer, moved);
const resolution = run(process.execPath, ["resolution.mjs"], moved);
const types = run(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--target", "ES2023", "--skipLibCheck", "--types", "node", "consumer.mts"], moved);
const ordinary = run(process.execPath, ["ordinary.mjs", "virtual-bash"], moved);
const lifecycle = run(process.execPath, ["ordinary.mjs", "virtual-bash", "lifecycle"], moved);
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const assets = {};
for (const name of readdirSync(resolve(build, "dist/commands/regex-execution"))) {
  const path = `dist/commands/regex-execution/${name}`;
  assets[path] = { built: hash(resolve(build, path)), packed: hash(resolve(moved, "node_modules/virtual-bash", path)) };
  assert.equal(assets[path].built, assets[path].packed);
}
const manifest = JSON.parse(readFileSync(resolve(moved, "node_modules/virtual-bash/package.json"), "utf8"));
assert.deepEqual(manifest.dependencies ?? {}, {});
const evidence = { base: "07acb1a4d30b7592cf247a0220250317be4e2038", node: process.version, workspace, pack, extract, tarballSHA256: hash(tarball), resolution, types, ordinary, lifecycle, assets, runtimeDependencies: manifest.dependencies ?? {} };
writeFileSync(`${directory}/final-package-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ordinary: ordinary.status, lifecycle: lifecycle.status, resolution, types, assets: Object.keys(assets).length, tarballSHA256: evidence.tarballSHA256 }));
process.exitCode = ordinary.status === 0 && resolution.status === 0 && types.status === 0 ? 0 : 1;
