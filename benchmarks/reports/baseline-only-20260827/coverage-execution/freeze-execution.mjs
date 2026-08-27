import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { cases, diagnostics, environment, budgets, networkFixture, delta } from "./execution-cases.mjs";
import { root, owned, setup, hash, json, tree, evidence, publish } from "./audit-common.mjs";

export function freeze(destination, url, priorDestination) {
  assert.equal(process.cwd(), root);
  const release = "/tmp/safe-bash-baseline-coverage-execute.ready";
  assert.ok(readFileSync(release, "utf8").includes("ROOT RELEASE"));
  const inventory = json(`${setup}/inventory.json`);
  assert.deepEqual(cases.filter(specimen => specimen.cohort === "historical-unmeasured").map(specimen => specimen.name).sort(), [...inventory.exactDefaultUnmeasuredNames].sort());
  const baselinePackage = json("benchmarks/node_modules/just-bash/package.json");
  const lock = json("benchmarks/package-lock.json").packages["node_modules/just-bash"];
  assert.equal(baselinePackage.version, "3.4.2");
  assert.equal(lock.version, "3.4.2");
  const prior = priorDestination ? json(`${priorDestination}/manifest.json`) : null;
  const source = prior ? prior.source : tree("src");
  const runtimeSource = readFileSync(prior ? `${prior.paths.snapshot}/src/shell/runtime.ts` : "src/shell/runtime.ts", "utf8");
  const builtinDeclaration = runtimeSource.match(/const shellBuiltinNames = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(builtinDeclaration);
  const concreteKernel = [...builtinDeclaration[1].matchAll(/"([^"]+)"/g)].map(match => match[1]).filter(name => !["echo", "printf", "test", "["].includes(name)).sort();
  assert.deepEqual(concreteKernel, [...inventory.current.virtual.kernel].sort());
  assert.ok(source.entries.every(entry => entry.type === "file"), "Source symlinks need explicit snapshot design, not live dereference");
  const snapshot = prior ? prior.paths.snapshot : `/tmp/safe-bash-baseline-coverage-execution-${Date.now()}-${process.pid}`;
  for (const entry of prior ? [] : source.entries) {
    const bytes = readFileSync(`src/${entry.path}`);
    assert.equal(Buffer.from(bytes.toString("utf8")).compare(bytes), 0, "No binary snapshot via text patch");
    publish(`${snapshot}/src/${entry.path}`, bytes.toString("utf8"));
  }
  if (!prior) for (const filename of ["package.json", "tsconfig.json"]) publish(`${snapshot}/${filename}`, readFileSync(filename, "utf8"));
  const snapshotTree = tree(`${snapshot}/src`);
  assert.equal(snapshotTree.sha256, source.sha256);
  const snapshotConfiguration = ["package.json", "tsconfig.json"].map(filename => evidence(`${snapshot}/${filename}`));
  if (prior) for (const entry of snapshotConfiguration) assert.equal(entry.sha256, prior.evidence.find(original => original.path === path.basename(entry.path)).sha256);
  if (!prior) assert.equal(tree("src").sha256, source.sha256, "Live source changed during copying");
  const rootRequire = createRequire(path.join(root, "package.json"));
  const baselineRequire = createRequire(path.join(root, "benchmarks/node_modules/just-bash/package.json"));
  const paths = {
    node: process.execPath, tsx: rootRequire.resolve("tsx"),
    oursEntry: `${snapshot}/src/index.ts`,
    baselineEntry: path.resolve("benchmarks/node_modules/just-bash", baselinePackage.exports["."].import.default),
    child: path.resolve(owned, "engine-child.mjs"), trace: path.resolve(owned, "trace-register.mjs"), snapshot, snapshotRealpath: realpathSync(snapshot),
  };
  const dependencies = [tree("node_modules"), tree("benchmarks/node_modules")];
  for (const dependency of dependencies) for (const entry of dependency.entries.filter(item => item.type === "symlink")) {
    assert.ok(entry.realpath.startsWith(path.resolve(dependency.directory) + path.sep), `Dependency symlink escapes audited tree: ${entry.path}`);
  }
  const resolvedDependencies = Object.keys({ ...baselinePackage.dependencies, ...baselinePackage.optionalDependencies }).map(name => {
    try { return { name, ...evidence(baselineRequire.resolve(name)) }; }
    catch (error) { return { name, resolutionError: String(error) }; }
  });
  const assetPaths = [
    "benchmarks/node_modules/just-bash/dist/bundle/chunks/js-exec-worker.js",
    "benchmarks/node_modules/just-bash/dist/bundle/chunks/worker.js",
    "benchmarks/node_modules/just-bash/dist/bundle/chunks/sqlite3-worker.js",
    "benchmarks/node_modules/just-bash/vendor/cpython-emscripten/python.cjs",
    "benchmarks/node_modules/just-bash/vendor/cpython-emscripten/python.wasm",
    "benchmarks/node_modules/just-bash/vendor/cpython-emscripten/python313.zip",
    "benchmarks/node_modules/sql.js/dist/sql-wasm.wasm",
    ...dependencies[1].entries.filter(entry => entry.path.startsWith("@jitl/") && entry.path.endsWith(".wasm")).map(entry => `benchmarks/node_modules/${entry.path}`),
  ];
  const harness = readdirSync(owned).filter(name => name.endsWith(".mjs")).sort().map(name => evidence(`${owned}/${name}`));
  const manifest = {
    schemaVersion: 1, frozenAt: new Date().toISOString(), destination,
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    status: execFileSync("git", ["status", "--porcelain=v1"], { encoding: "utf8" }),
    cachedDiff: execFileSync("git", ["diff", "--cached", "--binary"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
    node: { version: process.version, versions: process.versions, platform: process.platform, arch: process.arch, executable: evidence(process.execPath) },
    baseline: { name: baselinePackage.name, version: baselinePackage.version, lockIntegrity: lock.integrity, entry: evidence(paths.baselineEntry), integrityBoundary: "Installed SHA256 + lock SRI metadata, not installed tarball reattestation; no install/download." },
    source, snapshot: snapshotTree, snapshotConfiguration, paths, dependencies, resolvedDependencies, reusedSourceFrom: priorDestination ?? null, sourceCapturedHead: prior?.head ?? null,
    runtimeAssets: assetPaths.map(evidence), harness,
    evidence: [release, "/tmp/safe-bash-baseline-coverage-review-preflight.txt", "/tmp/safe-bash-baseline-coverage-execution-result.txt", "/tmp/safe-bash-baseline-coverage-setup-result.txt", "package.json", "package-lock.json", "tsconfig.json", "benchmarks/package.json", "benchmarks/package-lock.json", `${owned}/prepared-inputs.json`, `${owned}/prepared-matrix.json`, ...["SETUP.md", "setup-profiles.json", "inventory.json", "primary-sources.json", "setup-local.json"].map(name => `${setup}/${name}`), ...["engine.mjs", "inventory.mjs", "native.mjs", "recipes.mjs"].map(name => `benchmarks/expanded/${name}`), inventory.historical.input.path].map(evidence),
    primaryWebReview: { date: "2026-08-27", method: "web.run open, pinned upstream README and js-exec source; installed primary README/types/source determine options", upstreamCommit: "a021f95f53f7e01df48dab71b46ffd4637fb4b53", urls: ["https://raw.githubusercontent.com/vercel-labs/just-bash/a021f95f53f7e01df48dab71b46ffd4637fb4b53/packages/just-bash/README.md", "https://raw.githubusercontent.com/vercel-labs/just-bash/a021f95f53f7e01df48dab71b46ffd4637fb4b53/packages/just-bash/src/commands/js-exec/js-exec.ts"] },
  };
  if (prior) {
    assert.equal(source.sha256, "30f5cfb47f69af0aeb4460fa901904d0b70f4ca8594013f70aa308dafb379732");
    assert.ok(dependencies.every((dependency, index) => dependency.sha256 === prior.dependencies[index].sha256));
    for (const filename of ["/tmp/safe-bash-baseline-coverage-run-root-response.txt", "/tmp/safe-bash-baseline-coverage-run-correction-request.txt", "/tmp/safe-bash-baseline-coverage-run-correction-response.txt", "/tmp/safe-bash-baseline-coverage-run-trace-response.txt", "/tmp/safe-bash-baseline-coverage-run-freeze-response.txt", "/tmp/safe-bash-baseline-coverage-normative-update.txt", "tests/commands/core-regression-stress/NORMATIVE_PROFILES.md"]) manifest.evidence.push(evidence(filename));
  }
  const baseLimits = { maxExecutionTimeMs: budgets.ordinaryMs, maxOutputSize: budgets.maxOutputBytes, maxInputBytes: budgets.maxCensusBytes, maxCommandCount: 100, maxLoopIterations: 100 };
  const baseline = { executionLimitProfile: "normal", executionLimits: baseLimits };
  const ours = { limits: { maxOutputBytes: budgets.maxOutputBytes, maxCommands: 100, maxLoopIterations: 100, pipeHighWaterMark: 4096 } };
  const configurations = {
    ours: Object.fromEntries(["default", "javascript", "python", "sqlite", "loopback-network"].map(name => [name, { ...ours, plugins: name === "loopback-network" ? ["agentCommands", "networkCommands exact GET authorization + default public Node transport"] : ["agentCommands"], optionalRuntimeInjected: false, ...(name === "loopback-network" ? { networkLimits: { maxUploadBytes: 67108864, maxDownloadBytes: 65536, maxBufferBytes: 8388608, maxHeaderBytes: 65536, maxRedirects: 10, maxRetries: 5, maxUrls: 1, maxTimeMs: 3000 }, policy: "Exact URL/GET authorization at each call; fixed server does not redirect. Supported positive limit defaults do not promise zero redirect count." } : {}) }])),
    baseline: {
      default: baseline,
      javascript: { ...baseline, javascript: true, executionLimits: { ...baseLimits, maxExecutionTimeMs: budgets.optionalMs, maxJsTimeoutMs: budgets.optionalMs } },
      python: { ...baseline, python: true, executionLimits: { ...baseLimits, maxExecutionTimeMs: budgets.optionalMs, maxPythonTimeoutMs: budgets.optionalMs } },
      sqlite: { ...baseline, executionLimits: { ...baseLimits, maxExecutionTimeMs: budgets.optionalMs, maxSqliteTimeoutMs: budgets.optionalMs } },
      "loopback-network": { ...baseline, transportPolicy: { publicInjection: "BashOptions.fetch SecureFetch", exactUrl: url, method: "GET", maxBytes: 65536, timeoutMs: 3000, redirects: 0, transport: "node:http GET; fixed local server only; no implementation replacement" } },
    },
  };
  const concrete = specimen => {
    const effective = { ...specimen, effectiveScript: specimen.script.replaceAll("{{BASE}}", new URL(url).origin), budgetMs: ["javascript", "python", "sqlite"].includes(specimen.configuration) ? budgets.optionalMs : budgets.ordinaryMs };
    return { ...effective, inputSha256: hash(JSON.stringify(effective)) };
  };
  const inputs = {
    schemaVersion: 1, frozenAt: manifest.frozenAt, paths, environment, budgets, configurations, delta,
    childEnvironment: { PATH: "/usr/bin:/bin", HOME: snapshot, TMPDIR: snapshot, LANG: "C", LC_ALL: "C", TZ: "UTC", USER: "coverage", TSX_DISABLE_CACHE: "1", TSX_TSCONFIG_PATH: `${snapshot}/tsconfig.json` },
    loaderBinding: { cwd: root, tsx: evidence(paths.tsx), config: snapshotConfiguration.find(entry => entry.path.endsWith("/tsconfig.json")), package: snapshotConfiguration.find(entry => entry.path.endsWith("/package.json")), trace: "registered in main child only; baseline workers retain default execArgv, no inherited audit preload", tsxConfigSelection: "TSX_TSCONFIG_PATH supported by installed tsx loader source" },
    network: { ...networkFixture, url, port: Number(new URL(url).port) },
    dispatch: { ours: inventory.current.virtual, baseline: inventory.current.baseline },
    sourceSha256: source.sha256, cases: cases.map(concrete), diagnostics: diagnostics.map(concrete),
    correctedSetup: { infrastructure: ["/fixture", "/tmp", "/home/user"], omitted: "/fixture/tmp", authority: "/tmp/safe-bash-baseline-coverage-run-root-response.txt", unchangedExpectedBytes: true, priorAttempt: priorDestination ?? null },
    comparisonPolicy: {
      expected: "Predetermined workflow intent, not native captures. Exact status/byte fields and declared includes/excludes, file requirements, input content/type/mode preservation. No equality credit for both failing.",
      metadata: "Raw all available fields retained. Stable effects use path,type,permission bits, regular-file bytes, symlink target. Dates, opaque identity, inode/device allocation and directory sizes not cross-engine equality fields.",
      namespace: "Full root census including fixture/tmp/infrastructure; all effects listed. Fixture mode differences remain visible. Input preservation ignores read-induced metadata timestamps, not content/mode/type.",
      diagnostics: "7 reachability-only sub-attempts per engine; never primary positive coverage.",
      timing: "performance.now around product exec only; sleep lower-bound sanity only. No speed comparison.",
      optionalSafejs: "No installed legitimate runtime in allowed module roots per setup; no plugin registration with fake hooks; no compatible replacement for the four optional names.",
    },
  };
  publish(`${destination}/manifest.json`, manifest);
  publish(`${destination}/execution-inputs.json`, inputs);
  publish(`${destination}/freeze.json`, { manifestSha256: hash(readFileSync(`${destination}/manifest.json`)), inputsSha256: hash(readFileSync(`${destination}/execution-inputs.json`)), frozenBeforeAnyProductExecution: true });
  return { manifest, inputs };
}
