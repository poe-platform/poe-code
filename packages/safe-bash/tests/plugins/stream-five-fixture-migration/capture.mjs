import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const directory = "tests/plugins/stream-five-fixture-migration";
const owned = [
  "tests/integration/stream-inspection-public-author/public.test.ts",
  "tests/integration/stream-inspection-public-author/consumer.mts",
  "tests/commands/stream-format/helpers.ts",
  "tests/commands/stream-format-author-stress/contracts.test.ts",
  "tests/commands/split/integration.test.ts",
  "src/commands/stream-format/README.md",
  "src/commands/split/README.md",
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const command = (executable, args, options = {}) => {
  const result = spawnSync(executable, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...options });
  assert.ifError(result.error);
  return { executable, args, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr };
};
const git = args => {
  const result = command("git", args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
};
function save(relative, value) {
  const target = `${directory}/${relative}`;
  assert.equal(existsSync(target), false, `Refusing to overwrite ${target}`);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
  const patch = `*** Begin Patch\n*** Add File: ${target}\n${text.trimEnd().split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n`;
  const result = command("apply_patch", [], { input: patch });
  assert.equal(result.status, 0, result.stderr);
}
const tracked = git(["ls-files", "src", "tests/commands/stream-format", "tests/commands/stream-format-author-stress", "tests/commands/split", "tests/integration/stream-inspection-public-author", "package.json", "tsconfig.json", "tsconfig.build.json"]).split("\n");
const manifest = () => Object.fromEntries(tracked.map(file => [file, hash(readFileSync(file))]));
const stage = process.argv[2];
assert.match(stage ?? "", /^(original|registry|helper|final)$/u);
if (stage === "original") {
  assert.equal(git(["status", "--porcelain", "--", ...owned]), "");
  const originalRegistry = git(["show", "b7e9eb5^:tests/plugins/agent-commands.test.ts"]);
  const expected = originalRegistry.match(/const expected = \[([\s\S]*?)\]\.sort\(\)/u);
  assert.ok(expected);
  const baseline60 = [...expected[1].matchAll(/"([^"\n]+)"/gu)].map(match => match[1]);
  assert.equal(baseline60.length, 60);
  save("baseline60.json", baseline60);
  save("original-bytes.json", Object.fromEntries(owned.map(file => [file, { sha256: hash(readFileSync(file)), base64: readFileSync(file).toString("base64") }])));
  save("original-registry.ts.txt", originalRegistry);
}
const before = manifest();
const head = git(["rev-parse", "HEAD"]);
const sourceFiles = tracked.filter(file => file.startsWith("src/") && file.endsWith(".ts"));
const sourceDifferences = sourceFiles.filter(file => {
  const result = command("git", ["show", `${head}:${file}`]);
  return result.status !== 0 || hash(result.stdout) !== before[file];
});
assert.deepEqual(sourceDifferences, [], "Tracked runtime source must match the captured commit");
const formatTests = readdirSync("tests/commands/stream-format").filter(file => file.endsWith(".test.ts")).map(file => `tests/commands/stream-format/${file}`);
const groups = {
  publicAuthor: [owned[0]],
  formatContracts: [owned[3]],
  splitIntegration: [owned[4]],
  formatNativeAndLimits: formatTests,
  formatNativeStress: ["tests/commands/stream-format-author-stress/native-streams.test.ts", "tests/commands/stream-format-author-stress/seq-format.test.ts"],
};
const results = {};
for (const [name, files] of Object.entries(groups)) {
  const result = command(process.execPath, ["--import", "tsx", "--test", ...files]);
  results[name] = { ...result, counts: Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])) };
  console.log(stage, name, JSON.stringify(results[name].counts));
}
const runtime = command(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { createAgentCommands, agentCommands, CommandRegistry } from './src/index.ts'; const registry = new CommandRegistry(); await agentCommands().setup({ commands: registry }); console.log(JSON.stringify({ factory: createAgentCommands().map(command => command.name), registry: registry.list().map(command => command.name) }));`]);
assert.equal(runtime.status, 0, runtime.stderr);
const names = JSON.parse(runtime.stdout);
const baseline60 = JSON.parse(readFileSync(`${directory}/baseline60.json`, "utf8"));
assert.deepEqual(names.factory, [...baseline60, "seq", "nl", "rev", "unexpand", "split", "date", "sleep", "printenv", "tree", "file"]);
assert.deepEqual(names.registry, names.factory);
assert.equal(new Set(names.factory).size, 70);
const references = Object.fromEntries(["seq", "nl", "unexpand", "split", "rev"].map(name => {
  const file = name === "rev" ? "/usr/bin/rev" : `tests/commands/metadata-stress/.oracle/coreutils-9.7/src/${name}`;
  return [name, existsSync(file) ? { file, sha256: hash(readFileSync(file)), identity: name === "rev" ? "Apple/BSD rev; no version flag" : command(file, ["--version"]).stdout.split("\n")[0] } : { file, unavailable: true }];
}));
const after = manifest();
save(`${stage}-runs.json`, { capturedAt: new Date().toISOString(), head, platform: { platform: platform(), release: release(), arch: arch(), node: process.version }, sourceDifferences, before, after, runtime: names, references, results, status: git(["status", "--porcelain"]), index: git(["diff", "--cached", "--name-only"]), scope: "Exact author fixtures on committed tracked runtime source; shared working tree, not an independent final freeze. Native cases/diagnostics unchanged; no original82 or historical verifier rerun." });
assert.deepEqual(after, before, "Validation must not rewrite source or fixture evidence");
if (stage === "helper" || stage === "final") for (const result of Object.values(results)) assert.equal(result.status, 0, result.stdout);

if (stage === "original" || stage === "final") {
  const base = `${directory}/dist/${stage}`;
  const consumer = `${base}/consumer`;
  const packageRoot = `${consumer}/node_modules/virtual-bash`;
  for (const file of sourceFiles) {
    const destination = `${base}/build/${file}`;
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file, destination);
  }
  mkdirSync(packageRoot, { recursive: true });
  save(`dist/${stage}/consumer/package.json`, { name: "stream-five-fixture-consumer", private: true, type: "module" });
  copyFileSync("package.json", `${packageRoot}/package.json`);
  copyFileSync(owned[1], `${consumer}/consumer.mts`);
  const consumerFiles = ["consumer.mts"];
  if (stage === "final") {
    copyFileSync(`${directory}/public-options.mts`, `${consumer}/public-options.mts`);
    consumerFiles.push("public-options.mts");
  }
  save(`dist/${stage}/build/tsconfig.json`, { compilerOptions: { target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext", strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, verbatimModuleSyntax: true, forceConsistentCasingInFileNames: true, skipLibCheck: true, types: ["node"], rootDir: "src", outDir: "../consumer/node_modules/virtual-bash/dist", declaration: true, declarationMap: true, sourceMap: true }, include: ["src/**/*.ts"] });
  const build = command(resolve("node_modules/.bin/tsc"), ["-p", `${base}/build/tsconfig.json`]);
  const types = command(resolve("node_modules/.bin/tsc"), ["--strict", "--noUncheckedIndexedAccess", "--exactOptionalPropertyTypes", "--verbatimModuleSyntax", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2023", "--types", "node", "--rootDir", ".", "--outDir", "emitted", ...consumerFiles], { cwd: consumer });
  const execution = types.status === 0 && build.status === 0 ? command(process.execPath, ["emitted/consumer.mjs"], { cwd: consumer }) : null;
  const publicOptionsExecution = stage === "final" && types.status === 0 && build.status === 0 ? command(process.execPath, ["emitted/public-options.mjs"], { cwd: consumer }) : null;
  save(`${stage}-consumer.json`, { head, sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, before[file]])), consumerSha256: before[owned[1]], publicOptionsSha256: stage === "final" ? hash(readFileSync(`${directory}/public-options.mts`)) : null, build, types, execution, publicOptionsExecution, qualification: "Isolated emitted package exports and strict consumer; not npm-packed independent final proof. No root dist writes." });
  console.log(stage, "consumer", JSON.stringify({ build: build.status, types: types.status, runtime: execution?.status, publicOptions: publicOptionsExecution?.status }));
  if (stage === "final") {
    for (const result of [build, types, execution, publicOptionsExecution]) assert.equal(result?.status, 0, result?.stdout + result?.stderr);
  }
}
