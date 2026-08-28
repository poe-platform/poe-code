import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const baseline = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const acceptedLength = "74361026502d76b8c2b696f9c60e410ac9b78d95";
const sourceRevision = "35da1854";
const testRevision = "1d802e7a";
const interpreterBlob = "d3ba11f0057b07d5ad307c5dfbb5f0612a87a047";
const interpreterSha256 = "e32ad45efe69544ed95b43b97f191006f10d3beea9ca9e2a3327843dffd45a74";
const freeze = "bd471ef682d768692a682d40009a874f51e3ad68";
const verification = "de89e478d8ddce62eac955708f1b87d7be1bd137";
const repository = resolve(new URL("../../..", import.meta.url).pathname);
const output = resolve(process.argv[2] ?? join(repository, "tests/commands/yq-author-20260828/evidence-v1"));
if (existsSync(output)) throw new Error(`refusing existing output: ${output}`);
mkdirSync(output, { recursive: true });
const rawDirectory = join(output, "raw");
mkdirSync(rawDirectory);
const temporary = mkdtempSync(join(tmpdir(), "virtual-bash-yq-author-"));
const candidate = join(temporary, "candidate");
mkdirSync(candidate);

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository });
const resolveCommit = revision => git("rev-parse", `${revision}^{commit}`).toString().trim();
const baselineCommit = resolveCommit(baseline);
const lengthCommit = resolveCommit(acceptedLength);
const sourceCommit = resolveCommit(sourceRevision);
const testsCommit = resolveCommit(testRevision);
const driverCommit = git("log", "-1", "--format=%H", "--", "tests/commands/yq-author-20260828/reconstruct.mjs").toString().trim();
if (resolveCommit(freeze) !== freeze || resolveCommit(verification) !== verification) throw new Error("freeze binding mismatch");
if (git("rev-parse", `${lengthCommit}:src/commands/structured/interpreter.ts`).toString().trim() !== interpreterBlob) throw new Error("interpreter blob mismatch");
const acceptedInterpreter = git("show", `${lengthCommit}:src/commands/structured/interpreter.ts`);
if (sha256(acceptedInterpreter) !== interpreterSha256) throw new Error("interpreter content mismatch");

const parseTree = (revision, paths) => {
  const fields = git("ls-tree", "-r", "-z", "--full-tree", revision, "--", ...paths).toString().split("\0").filter(Boolean);
  return fields.map(field => {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(field);
    if (!match) throw new Error(`non-regular or malformed selected entry: ${field}`);
    const path = match[3];
    if (!path || path.startsWith("/") || path.split("/").includes("..") || /(^|\/)AGENTS\.md$/u.test(path)) throw new Error(`unsafe selected path: ${path}`);
    return { mode: match[1], blob: match[2], path };
  });
};

const baselineEntries = parseTree(baselineCommit, ["README.md", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "src", "scripts/typecheck.mjs"])
  .filter(entry => entry.path !== "src/commands/structured/interpreter.ts");
const sourcePaths = [
  "src/commands/structured/query-core.ts",
  "src/commands/yq/README.md",
  "src/commands/yq/accounting.ts",
  "src/commands/yq/encoder.ts",
  "src/commands/yq/errors.ts",
  "src/commands/yq/index.ts",
  "src/commands/yq/parser.ts",
];
const sourceEntries = parseTree(sourceCommit, sourcePaths);
if (sourceEntries.length !== sourcePaths.length || sourceEntries.some((entry, index) => entry.path !== sourcePaths[index])) throw new Error("new source membership mismatch");
const testPaths = [
  "tests/commands/yq-author-20260828/PROTOCOL.md",
  "tests/commands/yq-author-20260828/vectors.json",
  "tests/commands/yq-author-20260828/tsconfig.json",
  "tests/commands/yq-author-20260828/yq.test.ts",
];
const testEntries = parseTree(testsCommit, testPaths);
const parentPaths = ["tests/commands/structured-stress/harness.ts", "tests/commands/structured-stress/join-safety.test.ts"];
const parentEntries = parseTree(baselineCommit, parentPaths);
const allEntries = [...baselineEntries, ...sourceEntries, ...testEntries, ...parentEntries];
const seen = new Set();
for (const entry of allEntries) {
  if (seen.has(entry.path)) throw new Error(`duplicate selected path: ${entry.path}`);
  seen.add(entry.path);
  const revision = sourcePaths.includes(entry.path) ? sourceCommit : testPaths.includes(entry.path) ? testsCommit : baselineCommit;
  const bytes = git("show", `${revision}:${entry.path}`);
  const destination = join(candidate, entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
  utimesSync(destination, 946684800, 946684800);
}
const interpreterPath = join(candidate, "src/commands/structured/interpreter.ts");
mkdirSync(dirname(interpreterPath), { recursive: true });
writeFileSync(interpreterPath, acceptedInterpreter, { mode: 0o644 });
utimesSync(interpreterPath, 946684800, 946684800);
allEntries.push({ mode: "100644", blob: interpreterBlob, path: "src/commands/structured/interpreter.ts" });

const manifest = allEntries.sort((left, right) => left.path.localeCompare(right.path)).map(entry => {
  const bytes = readFileSync(join(candidate, entry.path));
  return { ...entry, bytes: bytes.byteLength, sha256: sha256(bytes) };
});
if (manifest.some(entry => /(^|\/)AGENTS\.md$/u.test(entry.path))) throw new Error("AGENTS entry selected");
writeFileSync(join(output, "SOURCE-MANIFEST.json"), `${JSON.stringify({ schemaVersion: 1, baseline: baselineCommit, acceptedLength: lengthCommit, interpreterBlob, interpreterSha256, sourceCommit, testsCommit, driverCommit, freeze, verification, files: manifest }, null, 2)}\n`);

symlinkSync(join(repository, "node_modules"), join(candidate, "node_modules"), "dir");
const runs = [];
const run = (id, command, args, cwd = candidate, expected = 0) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" } });
  writeFileSync(join(rawDirectory, `${id}.stdout.txt`), result.stdout ?? "");
  writeFileSync(join(rawDirectory, `${id}.stderr.txt`), result.stderr ?? "");
  runs.push({ id, command, args, status: result.status, expected });
  if (result.status !== expected) throw new Error(`${id} exited ${result.status}`);
  return result;
};

try {
  run("build", "npm", ["run", "build"]);
  run("scoped-types", join(candidate, "node_modules/.bin/tsc"), ["-p", "tests/commands/yq-author-20260828/tsconfig.json"]);
  run("author-runtime", process.execPath, ["--import", "tsx", "--test", "tests/commands/yq-author-20260828/yq.test.ts"]);
  run("parent-jq-regressions", process.execPath, ["--import", "tsx", "--test", "tests/commands/structured-stress/join-safety.test.ts"]);
  run("wrong-source-negative", "git", ["cat-file", "-e", `${baselineCommit}:src/commands/yq/index.ts`], repository, 128);

  const archivePaths = manifest.filter(entry => !entry.path.startsWith("tests/")).map(entry => entry.path);
  run("source-archive", "tar", ["--format", "ustar", "-cf", join(output, "SOURCE.tar"), "-C", candidate, ...archivePaths], repository);
  const archiveListing = run("source-archive-list", "tar", ["-tf", join(output, "SOURCE.tar")], repository).stdout.trim().split("\n").filter(Boolean);
  if (archiveListing.length !== archivePaths.length || archiveListing.some(path => /(^|\/)AGENTS\.md$/u.test(path))) throw new Error("source archive membership mismatch");

  const pack = run("npm-pack", "npm", ["pack", "--json", "--ignore-scripts"], candidate);
  const packData = JSON.parse(pack.stdout);
  const tarball = join(candidate, packData[0].filename);
  const packageDirectory = join(output, "package");
  mkdirSync(packageDirectory);
  const packagePath = join(packageDirectory, packData[0].filename);
  writeFileSync(packagePath, readFileSync(tarball));
  const packageListing = run("package-list", "tar", ["-tf", packagePath], repository).stdout.trim().split("\n").filter(Boolean);
  for (const required of ["package/package.json", "package/README.md", "package/dist/commands/yq/index.js", "package/dist/commands/yq/index.d.ts", "package/dist/commands/structured/query-core.js"]) {
    if (!packageListing.includes(required)) throw new Error(`package missing ${required}`);
  }
  if (packageListing.some(path => /(^|\/)AGENTS\.md$/u.test(path))) throw new Error("package contains AGENTS");

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"type":"module","private":true}\n');
  run("offline-install", "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", packagePath], consumer);
  const installed = join(consumer, "node_modules/virtual-bash");
  const builtModuleSha256 = sha256(readFileSync(join(candidate, "dist/commands/yq/index.js")));
  const consumerSource = expectedModuleSha256 => `
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const root = ${JSON.stringify(installed)};
const modulePath = root + "/dist/commands/yq/index.js";
if (createHash("sha256").update(readFileSync(modulePath)).digest("hex") !== ${JSON.stringify(expectedModuleSha256)}) throw new Error("bound yq module hash mismatch");
const yq = await import(pathToFileURL(root + "/dist/commands/yq/index.js"));
const io = await import(pathToFileURL(root + "/dist/contracts/io.js"));
const memory = await import(pathToFileURL(root + "/dist/fs/memory/index.js"));
const shellModule = await import(pathToFileURL(root + "/dist/shell/index.js"));
const shell = new shellModule.Shell({ fs: memory.createMemoryFileSystem() }).use(yq.yqCommands());
const result = await shell.exec("yq -o json -c .", { stdin: io.toByteSource("a: 1\\n") });
if (result.exitCode !== 0 || result.stdout !== '{"a":1}\\n' || result.stderr !== "") throw new Error("installed yq Shell runtime mismatch");
const plugin = await import(pathToFileURL(root + "/dist/plugins/index.js"));
if (plugin.createAgentCommands().some(definition => definition.name === "yq")) throw new Error("yq entered defaults");
await shell.dispose();
console.log(JSON.stringify({ status: result.exitCode, stdout: result.stdout, defaultYq: false, shellPlugin: true }));
`;
  writeFileSync(join(consumer, "consumer.mjs"), consumerSource("0".repeat(64)));
  run("wrong-module-hash-negative", process.execPath, ["consumer.mjs"], consumer, 1);
  writeFileSync(join(consumer, "consumer.mjs"), consumerSource(builtModuleSha256));
  run("installed-runtime", process.execPath, ["consumer.mjs"], consumer);
  const typeSource = root => `import { createYqCommand, createYqCommands, yqCommands, type YqCommandsOptions } from ${JSON.stringify(`${root}/dist/commands/yq/index.js`)};\nconst options: YqCommandsOptions = { replace: true };\nvoid createYqCommand(); void createYqCommands(); void yqCommands(options);\n`;
  writeFileSync(join(consumer, "consumer.ts"), typeSource(installed));
  run("installed-types", join(repository, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--skipLibCheck", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--typeRoots", join(repository, "node_modules/@types"), "consumer.ts"], consumer);
  const moved = join(temporary, "moved-virtual-bash");
  renameSync(installed, moved);
  writeFileSync(join(consumer, "consumer.mjs"), consumerSource(builtModuleSha256).replaceAll(installed, moved));
  run("moved-runtime", process.execPath, ["consumer.mjs"], consumer);
  writeFileSync(join(consumer, "consumer.ts"), typeSource(moved));
  run("moved-types", join(repository, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--skipLibCheck", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--typeRoots", join(repository, "node_modules/@types"), "consumer.ts"], consumer);

  const moduleBytes = readFileSync(join(candidate, "dist/commands/yq/index.js"));
  const report = {
    schemaVersion: 1,
    qualification: "fixed baseline plus accepted interpreter plus committed new yq/query adapter paths; author evidence, not independent/full conformance",
    source: { baseline: baselineCommit, acceptedLength: lengthCommit, sourceCommit, testsCommit, driverCommit, interpreterBlob, interpreterSha256 },
    artifacts: {
      sourceArchive: { bytes: statSync(join(output, "SOURCE.tar")).size, sha256: sha256(readFileSync(join(output, "SOURCE.tar")),) },
      package: { path: relative(output, packagePath), bytes: statSync(packagePath).size, sha256: sha256(readFileSync(packagePath)) },
      builtYqModule: { bytes: moduleBytes.byteLength, sha256: sha256(moduleBytes) },
    },
    package: { entries: packageListing.length, hasReadme: true, hasMetadata: true, runtimeDependencies: 0, installedTypes: true, movedRuntime: true, movedTypes: true, shellPluginRuntime: true, rootYqExport: false, defaultRegistration: false, wrongSourceDenied: true, wrongModuleHashDenied: true },
    runs,
    resourcesNaturallyClosed: true,
  };
  writeFileSync(join(output, "REPORT.json"), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
