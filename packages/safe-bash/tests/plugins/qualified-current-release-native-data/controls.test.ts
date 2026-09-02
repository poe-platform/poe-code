import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { baseline, compile, createCopy, diagnostics, native, owned, root, run } from "./helpers.js";
import { collectSourceInputs, isAdmittedSourcePath, type SourceInputFileSystem } from "../../source-census.js";
import { compilerToolPaths } from "../../shell-stress/invocation-cleanup-runtime/migration/binding.js";

test("public snapshot resolves only the compiler and its hoisted type dependencies", () => {
  const calls: [string, string][] = [];
  const manifests = new Map([
    ["typescript/package.json", "/workspace/node_modules/typescript/package.json"],
    ["@types/node/package.json", "/workspace/node_modules/@types/node/package.json"],
    ["undici-types/package.json", "/workspace/node_modules/@types/node/node_modules/undici-types/package.json"],
  ]);
  assert.deepEqual(compilerToolPaths("/workspace/packages/safe-bash", (from, specifier) => {
    calls.push([from, specifier]);
    assert.ok(manifests.has(specifier));
    return manifests.get(specifier)!;
  }), [
    { name: "typescript", source: "/workspace/node_modules/typescript" },
    { name: "@types/node", source: "/workspace/node_modules/@types/node" },
    { name: "undici-types", source: "/workspace/node_modules/@types/node/node_modules/undici-types" },
  ]);
  assert.deepEqual(calls, [
    ["/workspace/packages/safe-bash/package.json", "typescript/package.json"],
    ["/workspace/packages/safe-bash/package.json", "@types/node/package.json"],
    ["/workspace/node_modules/@types/node/package.json", "undici-types/package.json"],
  ]);
});

test("public snapshot reports unavailable compiler dependencies rather than substituting tools", () => {
  const unavailable = new Error("missing compiler package");
  assert.throws(() => compilerToolPaths("/workspace/packages/safe-bash", () => { throw unavailable; }), error => error === unavailable);
});

const capturedTypePaths = [
  "tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__command.ts",
  "tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__filesystem.ts",
  "tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__io.ts",
  "tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__path.ts",
  "tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__plugin.ts",
];

const stagedDuPaths = [
  "tests/integration/du-overlay-independent-20260827/approved-v5-9a5a6f92/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/approved-v6-9a5a6f92/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/approved-v7-9a5a6f92/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/approved-v8-9a5a6f92/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/approved-v9-9a5a6f92/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/candidate-9a5a6f92/evidence/candidate-9a5a6f92-2026-08-27T184628110Z-fdd7-TvfiaD/harness/harness/consumer-v2/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/candidate-9a5a6f92/evidence/candidate-9a5a6f92-2026-08-27T184718966Z-42b7-ik3KTO/harness/harness/consumer-v2/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/candidate-9a5a6f92/evidence/candidate-9a5a6f92-2026-08-27T184742640Z-4378-47r2eR/harness/harness/consumer-v2/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/candidate-9a5a6f92/evidence/supplied-revision-9a5a6f92-2026-08-27T183910720Z-c216-VLoupP/harness/harness/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/candidate-9a5a6f92/harness/consumer-v2/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/candidate-9a5a6f92/harness/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/evidence/baseline-877144ea-2026-08-27T182017267Z-cbc5-YXsTka/harness/consumer/consumer.ts",
  "tests/integration/du-overlay-independent-20260827/evidence/baseline-877144ea-2026-08-27T182141438Z-2e8b-bTCRpv/harness/consumer/consumer.ts",
];

interface CompilerConfiguration {
  compilerOptions: Record<string, unknown>;
  include: string[];
  exclude: string[];
}

const integration = JSON.parse(readFileSync(join(root, "integration-boundaries.json"), "utf8")) as { heldSourceFiles: string[]; heldEvidenceDirectories: string[]; fixtureDirectories: { path: string }[] };
const integrationTypes = JSON.parse(readFileSync(join(root, "integration-type-inputs.json"), "utf8")) as { cohorts: { entries: { path: string }[] }[] };
const integrationTypePaths = [...integration.heldSourceFiles, ...integration.heldEvidenceDirectories, ...integration.fixtureDirectories.map(fixture => fixture.path), ...integrationTypes.cohorts.flatMap(cohort => cohort.entries.map(entry => entry.path)).filter(path => path.endsWith(".ts"))];

function approvedCompilerConfiguration(): CompilerConfiguration {
  const bytes = readFileSync(join(owned, "before-02.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "cb0e439212ffb280f513b6104fa69d99399afc6813cd51fe250df942542f86c1");
  const before = JSON.parse(bytes.toString()) as { before: { config: CompilerConfiguration } };
  return { ...before.before.config, exclude: [...before.before.config.exclude, native, ...capturedTypePaths, ...stagedDuPaths, ...integrationTypePaths] };
}

function assertApprovedCompilerConfiguration(current: unknown) {
  assert.deepEqual(current, approvedCompilerConfiguration());
}

function sourceCensusFixture() {
  const owner = Buffer.from("bounded fixture producer");
  const boundaries = {
    version: 1,
    heldSourceFiles: ["src/commands/xan/argv.ts", "src/commands/xan/DESIGN.md", "src/commands/xan/README.md"],
    heldEvidenceDirectories: ["src/commands/xan/design-evidence", "tests/commands/xan-author-20260828"],
    fixtureDirectories: [{ path: "tests/review/run/source", owner: "tests/review/produce.mjs", sha256: createHash("sha256").update(owner).digest("hex") }],
  };
  const files = new Map<string, Buffer>([
    ["/candidate/integration-boundaries.json", Buffer.from(JSON.stringify(boundaries))],
    ["/candidate/tests/review/produce.mjs", owner],
    ["/candidate/scripts/integration-inputs.mjs", Buffer.from("boundary loader")],
    ["/candidate/scripts/typecheck-integration-inputs.mjs", Buffer.from("regular-file admission")],
    ["/candidate/tests/source-census.ts", Buffer.from("shared current census")],
    ["/candidate/src/current.ts", Buffer.from("maintained source")],
    ["/candidate/src/commands/yq/index.ts", Buffer.from("unaccepted but not held")],
    ["/candidate/src/commands/xan-neighbor/current.ts", Buffer.from("not the held cohort")],
    ["/candidate/src/commands/xan/argv.ts", Buffer.from("held source")],
    ["/candidate/src/commands/xan/DESIGN.md", Buffer.from("held design")],
    ["/candidate/src/commands/xan/README.md", Buffer.from("held documentation")],
    ["/candidate/src/commands/xan/design-evidence/held.md", Buffer.from("held evidence")],
  ]);
  const reads: string[] = [];
  const fileSystem: SourceInputFileSystem = {
    readdirSync(path) {
      assert.ok(!path.includes("/xan/design-evidence"), "held directory must be pruned before traversal");
      return [...new Set([...files.keys()].filter(file => file.startsWith(path + "/")).map(file => file.slice(path.length + 1).split("/")[0]!))];
    },
    lstatSync(path) {
      assert.ok(files.has(path) || [...files.keys()].some(file => file.startsWith(path + "/")), `unknown input: ${path}`);
      return { isFile: () => files.has(path), isDirectory: () => !files.has(path), size: files.get(path)?.length ?? 0 };
    },
    readFileSync(path) {
      assert.ok(!path.includes("/xan/"), "held content must never be read");
      reads.push(path);
      assert.ok(files.has(path), path);
      return files.get(path)!;
    },
  };
  return { boundaries, files, reads, fileSystem };
}

test("source census admits current and YQ inputs while pruning held content before any read", () => {
  const fixture = sourceCensusFixture();
  const captured = collectSourceInputs("/candidate", fixture.fileSystem);
  assert.deepEqual([...captured.files.keys()].sort(), ["src/commands/xan-neighbor/current.ts", "src/commands/yq/index.ts", "src/current.ts"]);
  assert.ok(captured.admissionInputs.has("integration-boundaries.json"));
  assert.ok(captured.admissionInputs.has("tests/review/produce.mjs"));
  assert.equal(fixture.reads.some(path => path.includes("/xan/")), false);
  fixture.files.set("/candidate/src/commands/xan/argv.ts", Buffer.from("still held, never consumed"));
  assert.deepEqual(collectSourceInputs("/candidate", fixture.fileSystem).files, captured.files);
  fixture.files.set("/candidate/src/current.ts", Buffer.from("genuine current change"));
  assert.notDeepEqual(collectSourceInputs("/candidate", fixture.fileSystem).files, captured.files);
});

test("source census rejects unknown held members, aliases and escaping paths rather than broadening exclusions", () => {
  const fixture = sourceCensusFixture();
  for (const path of ["src/commands/xan/new.ts", "src/commands/xan/new.md", "src/commands/XAN/argv.ts", "src/commands/xan/readme.md", "src/@(current|frozen).ts", "src/../outside.ts", "tests/current.ts"]) {
    assert.throws(() => isAdmittedSourcePath(path, fixture.boundaries));
  }
  fixture.files.set("/candidate/src/commands/xan/new.ts", Buffer.from("unclassified"));
  assert.throws(() => collectSourceInputs("/candidate", fixture.fileSystem), /unclassified held/);
  assert.equal(fixture.reads.some(path => path.includes("/xan/")), false);
});

test("source census refuses symlink or special inputs and oversized files before content reads", () => {
  const fixture = sourceCensusFixture();
  for (const [path, stat] of [
    ["/candidate/src/commands", { isDirectory: () => false, isFile: () => false, size: 0 }],
    ["/candidate/src/current.ts", { isDirectory: () => false, isFile: () => false, size: 0 }],
    ["/candidate/src/current.ts", { isDirectory: () => false, isFile: () => true, size: 1048577 }],
  ] as const) {
    fixture.reads.length = 0;
    assert.throws(() => collectSourceInputs("/candidate", { ...fixture.fileSystem, lstatSync: candidate => candidate === path ? stat : fixture.fileSystem.lstatSync(candidate) }), /regular file|unadmitted type-input/);
    assert.ok(!fixture.reads.includes(path));
  }
});

test("source census authenticates ownership before source reads and reproduces an admitted-only snapshot", () => {
  const fixture = sourceCensusFixture();
  const captured = collectSourceInputs("/candidate", fixture.fileSystem);
  const copied = new Map([...captured.files, ...captured.admissionInputs].map(([path, bytes]) => [`/candidate/${path}`, bytes]));
  fixture.files.clear();
  for (const [path, bytes] of copied) fixture.files.set(path, bytes);
  assert.deepEqual(collectSourceInputs("/candidate", fixture.fileSystem), captured);
  fixture.reads.length = 0;
  fixture.files.set("/candidate/tests/review/produce.mjs", Buffer.from("changed producer"));
  assert.throws(() => collectSourceInputs("/candidate", fixture.fileSystem), /owner/);
  assert.equal(fixture.reads.some(path => path.startsWith("/candidate/src/")), false);
});

test("native-data manifest records complete classification and six exact raw payload hashes", () => {
  const manifest = baseline();
  assert.equal(manifest.counts.files, 72);
  assert.equal(manifest.counts.rawPayloads, 22);
  assert.equal(manifest.counts.generatedCaches, 50);
  assert.equal(manifest.counts.maintainedSourcesOrHelpers, 0);
  for (const entry of manifest.files) {
    assert.match(entry.sha256, /^[a-f\d]{64}$/u);
    assert.ok(entry.path.startsWith(native + "/"));
    if (entry.classification === "raw-native-glob-payload") assert.equal(entry.bytes, 4);
  }
  const rawTypeScript = manifest.files.filter(entry => entry.classification === "raw-native-glob-payload" && entry.path.endsWith(".ts"));
  assert.deepEqual(rawTypeScript.map(entry => entry.path.slice(native.length + 1)).sort(), ["dialect-bFUsLx/alpha.ts", "dialect-bFUsLx/beta.ts", "dialect-uhGVu3/ab.ts", "dialect-uhGVu3/🙂.ts", "dialect-xj7h8F/a.ts", "dialect-xj7h8F/d.ts"]);
  assert.ok(rawTypeScript.every(entry => entry.sha256 === "74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8"));
});

test("root compiler configuration contains only approved data and authenticated integration boundaries", () => {
  assertApprovedCompilerConfiguration(JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")));
});

test("approved captured-type classification retains explicit current-consumer typing routes", async () => {
  const bytes = readFileSync(join(root, "tests/plugins/qualified-current-release/captured-types.json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "70fcd5c2b8d8baec26c2c69cc3fb9110de75366757bf36416b52d7838f4b961f");
  const classification = JSON.parse(bytes.toString()) as { existingExclusions: string[]; entries: { path: string }[] };
  assert.deepEqual(classification.entries.map(entry => entry.path), capturedTypePaths);
  assert.deepEqual([...classification.existingExclusions, ...capturedTypePaths, ...stagedDuPaths, ...integrationTypePaths], approvedCompilerConfiguration().exclude);
  const stagedBytes = readFileSync(join(root, "tests/plugins/qualified-current-release/staged-types.json"));
  assert.equal(createHash("sha256").update(stagedBytes).digest("hex"), "74c0e75d5ae06a28db0647545387a2827ca3d51394aae19c4656dcb6bf9a1e43");
  const staged = JSON.parse(stagedBytes.toString()) as { entries: { path: string; role: string; currentGroup: string }[] };
  assert.deepEqual(staged.entries.map(entry => entry.path), stagedDuPaths);
  assert.equal(staged.entries.filter(entry => entry.role === "sealed-capture").length, 6);
  assert.equal(staged.entries.filter(entry => entry.role === "versioned-template").length, 5);
  assert.equal(staged.entries.filter(entry => entry.role === "reusable-template").length, 3);
  assert.ok(staged.entries.every(entry => entry.currentGroup === "du-leaf"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.typecheck, "node scripts/typecheck.mjs");
  assert.equal(pkg.scripts["typecheck:all"], "node scripts/typecheck.mjs --build");
  assert.equal(pkg.scripts["typecheck:consumers"], "node scripts/typecheck.mjs --consumers");
  const { currentSourceConsumerGroups, consumerGroups } = await import(new URL("../qualified-current-release/consumers.mjs", import.meta.url).href) as {
    currentSourceConsumerGroups: { name: string; route: string; files: string[] }[];
    consumerGroups: { name: string; localPackage?: boolean; files: string[]; runtime: string[] }[];
  };
  const du = consumerGroups.find(group => group.name === "du-leaf");
  assert.ok(du);
  assert.equal(du.localPackage, true);
  assert.deepEqual(du.files, ["tests/plugins/qualified-current-release/du-leaf.mts"]);
  assert.deepEqual(du.runtime, ["du-leaf.mjs"]);
  const required = [
    { name: "atomic-webdav-profile-source", files: ["tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts", "tests/integration/adapter-tools/atomic-webdav-profile/controls.ts"] },
    { name: "atomic-webdav-independent-source", files: ["tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts"] },
    { name: "env-split-public-source", files: ["tests/shell-stress/env-split-consumer/packed-public-types.ts"] },
  ];
  for (const expected of required) {
    const group = currentSourceConsumerGroups.find(entry => entry.name === expected.name);
    assert.ok(group, expected.name);
    assert.deepEqual(group.files, expected.files);
    assert.equal(group.route, "root-tsconfig-and-strict-build-first-consumer");
    for (const path of group.files) {
      assert.ok(readFileSync(join(root, path)).length > 0);
      assert.ok(!approvedCompilerConfiguration().exclude.includes(path));
    }
  }
});

test("compiler-policy mutations cannot add exclusions or weaken current-source coverage", () => {
  const mutations: [string, (configuration: CompilerConfiguration) => void][] = [
    ["unknown exclusion", configuration => configuration.exclude.push("tests/unknown/**")],
    ["directory-wide captured-data exclusion", configuration => configuration.exclude.push("tests/commands/filesystem-inspection-stress/tree/sealed/inputs")],
    ["uncaptured sixth contract", configuration => configuration.exclude.push("tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__errors.ts")],
    ["current contract", configuration => configuration.exclude.push("src/contracts/command.ts")],
    ["missing approved capture", configuration => { configuration.exclude = configuration.exclude.filter(path => path !== capturedTypePaths[4]); }],
    ["missing staged DU input", configuration => configuration.exclude.pop()],
    ["directory-wide DU exclusion", configuration => configuration.exclude.push("tests/integration/du-overlay-independent-20260827")],
    ["missing native-data exclusion", configuration => { configuration.exclude = configuration.exclude.filter(path => path !== native); }],
    ["test include removed", configuration => { configuration.include = ["src/**/*.ts"]; }],
    ["strict typing disabled", configuration => { configuration.compilerOptions.strict = false; }],
  ];
  for (const [name, mutate] of mutations) {
    const configuration = structuredClone(approvedCompilerConfiguration());
    mutate(configuration);
    assert.throws(() => assertApprovedCompilerConfiguration(configuration), { name: "AssertionError" }, name);
  }
});

test("five captured type files are data but current contracts and adjacent sources still compile", () => {
  const copy = createCopy();
  try {
    const current = ["command", "filesystem", "io", "path", "plugin"].map(name => `src/contracts/${name}.ts`);
    const neighbors = ["tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__errors.ts", "tests/commands/filesystem-inspection-stress/tree/sealed/inputs/neighbor.ts", "tests/canonical/typed-consumer.ts"];
    const eligible = [...current, ...neighbors];
    for (const path of eligible) copy.write(path, "export const included: number = 1;\n");
    for (const path of capturedTypePaths) copy.write(path, "HISTORICAL_DATA_ONLY\n");
    const positive = compile(copy.directory);
    assert.equal(positive.status, 0, positive.stdout + positive.stderr);
    const listed = compile(copy.directory, true);
    assert.equal(listed.status, 0, listed.stdout + listed.stderr);
    const program = listed.stdout.trim().split("\n").map(path => relative(copy.directory, path));
    for (const path of eligible) assert.ok(program.includes(path), path);
    for (const path of capturedTypePaths) assert.ok(!program.includes(path), path);
    for (const path of eligible) copy.write(path, "export const included: number = 'not a number';\n");
    const negative = compile(copy.directory);
    assert.equal(negative.status, 2);
    assert.deepEqual(diagnostics(negative.stdout).sort(), eligible.map(path => `${path}(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`).sort());
  } finally { copy.dispose(); }
});

test("copied root config includes canonical source, test, helper and artifact neighbors", () => {
  const copy = createCopy();
  try {
    const eligible = ["src/native-data-control.ts", "tests/canonical/control.test.ts", "tests/canonical/helper.ts", `${native}-neighbor/control.ts`, "tests/commands/regex-execution/continuation/artifacts/helper.ts", "tests/other/artifacts/native/helper.ts"];
    for (const path of eligible) copy.write(path, "export const included: boolean = true;\n");
    copy.write(`${native}/nested/payload.ts`, "hit\n");
    copy.write(`${native}/arbitrary.test.ts`, "hit\n");
    const positive = compile(copy.directory);
    assert.equal(positive.status, 0, positive.stdout + positive.stderr);
    const list = compile(copy.directory, true);
    assert.equal(list.status, 0, list.stdout + list.stderr);
    const program = list.stdout.trim().split("\n").map(path => relative(copy.directory, path));
    for (const path of eligible) assert.ok(program.includes(path), path);
    assert.ok(!program.some(path => path.startsWith(native + "/")));
  } finally { copy.dispose(); }
});

test("identical undefined symbols outside the exact subtree remain real TS2304 errors", () => {
  const copy = createCopy();
  try {
    const eligible = ["src/native-data-control.ts", "tests/canonical/control.test.ts", "tests/canonical/helper.ts", `${native}-neighbor/control.ts`, "tests/commands/regex-execution/continuation/artifacts/helper.ts", "tests/other/artifacts/native/helper.ts"];
    for (const path of [...eligible, `${native}/nested/payload.ts`]) copy.write(path, "hit\n");
    const negative = compile(copy.directory);
    assert.equal(negative.status, 2);
    assert.deepEqual(diagnostics(negative.stdout).sort(), eligible.map(path => `${path}(1,1): error TS2304: Cannot find name 'hit'.`).sort());
  } finally { copy.dispose(); }
});

test("actual npm script excludes future native test data without excluding neighboring tests/helpers", () => {
  const copy = createCopy();
  try {
    for (const path of ["scripts/test-shards.mjs", "scripts/test-duration-weights.json", "scripts/test-parallel-review.json"]) {
      assert.deepEqual(readFileSync(join(copy.directory, path)), readFileSync(join(root, path)), path);
    }
    copy.write("tests/canonical/helper.ts", "export const helper = 'helper-loaded';\n");
    copy.write("tests/canonical/control.test.ts", "import assert from 'node:assert/strict'; import test from 'node:test'; import { helper } from './helper.js'; test('canonical-test-and-helper', () => assert.equal(helper, 'helper-loaded'));\n");
    const neighbors = [`${native}-neighbor/control.test.ts`, "tests/commands/regex-execution/continuation/artifacts/control.test.ts", "tests/commands/regex-execution/continuation/control.test.ts", "tests/other/artifacts/native/space 🙂.test.ts"];
    for (const [index, path] of neighbors.entries()) copy.write(path, `import test from 'node:test'; test('neighbor-${index}', () => {});\n`);
    const data = [`${native}/arbitrary.test.ts`, `${native}/nested/space 🙂.test.ts`];
    for (const path of data) copy.write(path, "throw new Error('NATIVE_DATA_MUST_NOT_EXECUTE');\n");
    const current = JSON.parse(readFileSync(join(copy.directory, "package.json"), "utf8")) as { scripts: { test: string } };
    const discovery = globSync("tests/**/*.test.ts", { cwd: copy.directory }).sort();
    assert.equal(discovery.length, 7);
    assert.ok(data.every(path => discovery.includes(path)));
    for (const concurrency of [undefined, "2"]) {
      const result = run(copy.directory, "npm", ["test", "--", "--test-reporter=tap"], { SAFE_BASH_TEST_SHARD: undefined, SAFE_BASH_TEST_CONCURRENCY: concurrency });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /# tests 5\b/u);
      assert.match(result.stdout, /# pass 5\b/u);
      assert.match(result.stdout, /canonical-test-and-helper/u);
      for (const index of neighbors.keys()) assert.match(result.stdout, new RegExp(`neighbor-${index}`, "u"));
      assert.doesNotMatch(result.stdout + result.stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
      if (concurrency) assert.match(result.stdout, /# safe-bash shard: 1\/1; 5 files;/u);
    }
    const original = JSON.parse(readFileSync(join(owned, "before-02.json"), "utf8")) as { before: { testScript: string } };
    copy.write("package.json", JSON.stringify({ ...current, scripts: { ...current.scripts, test: original.before.testScript.replace("--test ", "--test --test-reporter=tap ") } }));
    const unfiltered = run(copy.directory, "npm", ["test"]);
    assert.equal(unfiltered.status, 1);
    assert.match(unfiltered.stdout + unfiltered.stderr, /NATIVE_DATA_MUST_NOT_EXECUTE/u);
    assert.match(unfiltered.stdout, /# tests 7\b/u);
    assert.match(unfiltered.stdout, /# fail 2\b/u);
  } finally { copy.dispose(); }
});
