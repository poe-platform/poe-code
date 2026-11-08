import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const baseline = "5137a74ec855a32d8a8860eb66b62eb44d11e290";
const acceptedLength = "74361026502d76b8c2b696f9c60e410ac9b78d95";
const acceptedInterpreterBlob = "d3ba11f0057b07d5ad307c5dfbb5f0612a87a047";
const acceptedInterpreterSha256 = "e32ad45efe69544ed95b43b97f191006f10d3beea9ca9e2a3327843dffd45a74";
const sourceRevision = "b8f5d60d";
const originalTestsRevision = "1d802e7af02add9e334ab934668d41d6e5ffbbe2";
const repairTestsRevision = "e889e523";
const freeze = "bd471ef682d768692a682d40009a874f51e3ad68";
const verification = "de89e478d8ddce62eac955708f1b87d7be1bd137";
const review = "4b219eae";
const repository = resolve(new URL("../../../..", import.meta.url).pathname);
const output = resolve(process.argv[2] ?? join(repository, "tests/commands/yq-author-20260828/repair-allocation-v1/evidence-v1"));
if (existsSync(output)) throw new Error(`refusing existing output: ${output}`);
mkdirSync(output, { recursive: true });
const rawDirectory = join(output, "raw");
mkdirSync(rawDirectory);
const temporary = mkdtempSync(join(tmpdir(), "virtual-bash-yq-repair-"));
const candidate = join(temporary, "candidate");
mkdirSync(candidate);

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repository });
const resolveCommit = revision => git("rev-parse", `${revision}^{commit}`).toString().trim();
const baselineCommit = resolveCommit(baseline);
const lengthCommit = resolveCommit(acceptedLength);
const sourceCommit = resolveCommit(sourceRevision);
const originalTestsCommit = resolveCommit(originalTestsRevision);
const repairTestsCommit = resolveCommit(repairTestsRevision);
const reviewCommit = resolveCommit(review);
const driverCommit = git("log", "-1", "--format=%H", "--", "tests/commands/yq-author-20260828/repair-allocation-v1/reconstruct.mjs").toString().trim();
if (resolveCommit(freeze) !== freeze || resolveCommit(verification) !== verification) throw new Error("contract binding mismatch");
if (git("rev-parse", `${lengthCommit}:src/commands/structured/interpreter.ts`).toString().trim() !== acceptedInterpreterBlob) throw new Error("interpreter blob mismatch");
const acceptedInterpreter = git("show", `${lengthCommit}:src/commands/structured/interpreter.ts`);
if (sha256(acceptedInterpreter) !== acceptedInterpreterSha256) throw new Error("interpreter content mismatch");

const parseTree = (revision, paths) => git("ls-tree", "-r", "-z", "--full-tree", revision, "--", ...paths).toString().split("\0").filter(Boolean).map(field => {
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(field);
  if (!match) throw new Error(`non-regular selected entry: ${field}`);
  const path = match[3];
  if (!path || path.startsWith("/") || path.split("/").includes("..") || /(^|\/)AGENTS\.md$/u.test(path)) throw new Error(`unsafe selected path: ${path}`);
  return { mode: match[1], blob: match[2], path };
});

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
const originalTestPaths = [
  "tests/commands/yq-author-20260828/PROTOCOL.md",
  "tests/commands/yq-author-20260828/vectors.json",
  "tests/commands/yq-author-20260828/tsconfig.json",
  "tests/commands/yq-author-20260828/yq.test.ts",
];
const repairTestPaths = [
  "tests/commands/yq-author-20260828/repair-allocation-v1/PROTOCOL.md",
  "tests/commands/yq-author-20260828/repair-allocation-v1/repair.test.ts",
];
const parentPaths = ["tests/commands/structured-stress/harness.ts", "tests/commands/structured-stress/join-safety.test.ts"];
const sourceEntries = parseTree(sourceCommit, sourcePaths);
if (sourceEntries.length !== sourcePaths.length || sourceEntries.some((entry, index) => entry.path !== sourcePaths[index])) throw new Error("authorized source membership mismatch");
const originalTestEntries = parseTree(originalTestsCommit, originalTestPaths);
const repairTestEntries = parseTree(repairTestsCommit, repairTestPaths);
const parentEntries = parseTree(baselineCommit, parentPaths);
const interpreterEntry = { mode: "100644", blob: acceptedInterpreterBlob, path: "src/commands/structured/interpreter.ts" };
const selected = [...baselineEntries, ...sourceEntries, ...originalTestEntries, ...repairTestEntries, ...parentEntries, interpreterEntry];
const seen = new Set();
for (const entry of selected) {
  if (seen.has(entry.path)) throw new Error(`duplicate selected path: ${entry.path}`);
  seen.add(entry.path);
  const revision = entry.path === interpreterEntry.path ? lengthCommit
    : sourcePaths.includes(entry.path) ? sourceCommit
      : originalTestPaths.includes(entry.path) ? originalTestsCommit
        : repairTestPaths.includes(entry.path) ? repairTestsCommit : baselineCommit;
  const bytes = git("show", `${revision}:${entry.path}`);
  const destination = join(candidate, entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { mode: entry.mode === "100755" ? 0o755 : 0o644 });
  utimesSync(destination, 946684800, 946684800);
}
const manifest = selected.sort((left, right) => left.path.localeCompare(right.path)).map(entry => {
  const bytes = readFileSync(join(candidate, entry.path));
  return { ...entry, bytes: bytes.byteLength, sha256: sha256(bytes) };
});
if (manifest.some(entry => /(^|\/)AGENTS\.md$/u.test(entry.path))) throw new Error("AGENTS entry selected");
writeFileSync(join(output, "SOURCE-MANIFEST.json"), `${JSON.stringify({ schemaVersion: 1, baseline: baselineCommit, acceptedLength: lengthCommit, acceptedInterpreterBlob, acceptedInterpreterSha256, sourceCommit, originalTestsCommit, repairTestsCommit, driverCommit, freeze, verification, reviewCommit, files: manifest }, null, 2)}\n`);

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
  run("repair-types", join(candidate, "node_modules/.bin/tsc"), ["--noEmit", "--strict", "--skipLibCheck", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--types", "node", "tests/commands/yq-author-20260828/repair-allocation-v1/repair.test.ts"]);
  run("repair-runtime", process.execPath, ["--import", "tsx", "--test", "tests/commands/yq-author-20260828/repair-allocation-v1/repair.test.ts"]);
  run("original-author-runtime", process.execPath, ["--import", "tsx", "--test", "tests/commands/yq-author-20260828/yq.test.ts"]);
  run("selected-parent-jq", process.execPath, ["--import", "tsx", "--test", "tests/commands/structured-stress/join-safety.test.ts"]);
  run("wrong-source-negative", "git", ["cat-file", "-e", `${baselineCommit}:src/commands/yq/index.ts`], repository, 128);

  const archivePaths = manifest.filter(entry => !entry.path.startsWith("tests/")).map(entry => entry.path);
  run("source-archive", "tar", ["--format", "ustar", "-cf", join(output, "SOURCE.tar"), "-C", candidate, ...archivePaths], repository);
  const archiveListing = run("source-archive-list", "tar", ["-tf", join(output, "SOURCE.tar")], repository).stdout.trim().split("\n").filter(Boolean);
  if (archiveListing.length !== archivePaths.length || archiveListing.some(path => /(^|\/)AGENTS\.md$/u.test(path))) throw new Error("source archive membership mismatch");
  const secondArchive = join(temporary, "SOURCE-second.tar");
  run("source-archive-second", "tar", ["--format", "ustar", "-cf", secondArchive, "-C", candidate, ...archivePaths], repository);
  if (sha256(readFileSync(secondArchive)) !== sha256(readFileSync(join(output, "SOURCE.tar")))) throw new Error("source archive is not reproducible");

  const packed = JSON.parse(run("npm-pack", "npm", ["pack", "--json", "--ignore-scripts"], candidate).stdout)[0];
  const tarball = join(candidate, packed.filename);
  const packageDirectory = join(output, "package");
  mkdirSync(packageDirectory);
  const packagePath = join(packageDirectory, packed.filename);
  writeFileSync(packagePath, readFileSync(tarball));
  const packageListing = run("package-list", "tar", ["-tf", packagePath], repository).stdout.trim().split("\n").filter(Boolean);
  for (const required of ["package/package.json", "package/README.md", "package/dist/commands/yq/index.js", "package/dist/commands/yq/index.d.ts", "package/dist/commands/structured/query-core.js", "package/dist/commands/structured/query-core.d.ts"]) {
    if (!packageListing.includes(required)) throw new Error(`package missing ${required}`);
  }
  if (packageListing.some(path => /(^|\/)AGENTS\.md$/u.test(path))) throw new Error("package contains AGENTS");

  const builtModule = join(candidate, "dist/commands/yq/index.js");
  const builtDeclaration = join(candidate, "dist/commands/yq/index.d.ts");
  const queryModule = join(candidate, "dist/commands/structured/query-core.js");
  const moduleSha256 = sha256(readFileSync(builtModule));
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"type":"module","private":true}\n');
  run("offline-install", "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", packagePath], consumer);
  const installed = join(consumer, "node_modules/virtual-bash");
  const consumerSource = (root, expected) => `
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const modulePath = ${JSON.stringify(root)} + "/dist/commands/yq/index.js";
if (createHash("sha256").update(readFileSync(modulePath)).digest("hex") !== ${JSON.stringify(expected)}) throw new Error("bound yq module hash mismatch");
const yq = await import(pathToFileURL(modulePath));
const io = await import(pathToFileURL(${JSON.stringify(root)} + "/dist/contracts/io.js"));
const memory = await import(pathToFileURL(${JSON.stringify(root)} + "/dist/fs/memory/index.js"));
const shellModule = await import(pathToFileURL(${JSON.stringify(root)} + "/dist/shell/index.js"));
const plugins = await import(pathToFileURL(${JSON.stringify(root)} + "/dist/plugins/index.js"));
const shell = new shellModule.Shell({ fs: memory.createMemoryFileSystem() }).use(yq.yqCommands());
const result = await shell.exec("yq -o json -c .", { stdin: io.toByteSource("a: 1\\n") });
if (result.exitCode !== 0 || result.stdout !== '{"a":1}\\n' || result.stderr !== "") throw new Error("installed Shell runtime mismatch");
if (plugins.createAgentCommands().some(command => command.name === "yq")) throw new Error("yq entered defaults");
await shell.dispose();
console.log(JSON.stringify({ shellPlugin: true, defaultYq: false }));
`;
  writeFileSync(join(consumer, "consumer.mjs"), consumerSource(installed, "0".repeat(64)));
  run("wrong-module-hash-negative", process.execPath, ["consumer.mjs"], consumer, 1);
  writeFileSync(join(consumer, "consumer.mjs"), consumerSource(installed, moduleSha256));
  run("installed-runtime", process.execPath, ["consumer.mjs"], consumer);
  const typeSource = root => `import { createYqCommand, createYqCommands, yqCommands, type YqCommandsOptions } from ${JSON.stringify(`${root}/dist/commands/yq/index.js`)};\nconst options: YqCommandsOptions = { replace: true }; void createYqCommand(); void createYqCommands(); void yqCommands(options);\n`;
  writeFileSync(join(consumer, "consumer.ts"), typeSource(installed));
  const typeArgs = ["--noEmit", "--strict", "--skipLibCheck", "--target", "ES2023", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--typeRoots", join(repository, "node_modules/@types"), "consumer.ts"];
  run("installed-types", join(repository, "node_modules/.bin/tsc"), typeArgs, consumer);
  const moved = join(temporary, "moved-virtual-bash");
  renameSync(installed, moved);
  writeFileSync(join(consumer, "consumer.mjs"), consumerSource(moved, moduleSha256));
  run("moved-runtime", process.execPath, ["consumer.mjs"], consumer);
  writeFileSync(join(consumer, "consumer.ts"), typeSource(moved));
  run("moved-types", join(repository, "node_modules/.bin/tsc"), typeArgs, consumer);

  const artifact = path => ({ bytes: statSync(path).size, sha256: sha256(readFileSync(path)) });
  const report = {
    schemaVersion: 1,
    qualification: "author repair evidence for four source allocation-order contradictions; not independent acceptance, exploit proof, public integration, or closure of 31 unfulfilled review obligations",
    source: { baseline: baselineCommit, acceptedLength: lengthCommit, sourceCommit, originalTestsCommit, repairTestsCommit, driverCommit, reviewCommit, freeze, verification, acceptedInterpreterBlob, acceptedInterpreterSha256 },
    artifacts: {
      sourceArchive: { ...artifact(join(output, "SOURCE.tar")), entries: archiveListing.length, reproducibleSecondCapture: true },
      package: { path: relative(output, packagePath), ...artifact(packagePath), entries: packageListing.length, hasReadme: true, hasMetadata: true },
      builtYqModule: artifact(builtModule),
      builtYqDeclaration: artifact(builtDeclaration),
      builtQueryModule: artifact(queryModule),
    },
    tests: { repair: { passed: 9, total: 9 }, originalAuthor: { passed: 26, total: 26 }, selectedParentJq: { passed: 19, total: 19 } },
    package: { runtimeDependencies: 0, installedRuntime: true, installedTypes: true, movedRuntime: true, movedTypes: true, shellPluginRuntime: true, rootYqExport: false, defaultRegistration: false, wrongSourceDenied: true, wrongModuleHashDenied: true },
    reviewHistoryPreserved: { original35daFailed: true, b04Failed: true, independentOverallFailed: true, unfulfilledObligations: 31, cmd22HarnessPathDomainMismatchUnchanged: true },
    runs,
    resourcesNaturallyClosed: true,
  };
  writeFileSync(join(output, "REPORT.json"), `${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (!temporary.startsWith(join(tmpdir(), "virtual-bash-yq-repair-"))) throw new Error("refusing unsafe temporary cleanup");
  rmSync(temporary, { recursive: true, force: true });
}
