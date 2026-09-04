import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import { posix, relative } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { Script } from "node:vm";
import { createFsFromVolume, Volume } from "memfs";
import { createLintInputGuard } from "../../../scripts/lint-input-guard.mjs";
import { discoverTests, integrationExclusions, lintExclusions, lintInventoryPaths, loadBoundaries, readIntegrationLintInputs, readTypecheckInventories, validateBoundaries, validateImportRetirement, verifyLintInventory } from "./integration-inputs.mjs";
import { parseTestExecution, runTests } from "./test.mjs";
import { planTestPhases, planTestShards, validateShardArguments } from "./test-shards.mjs";
import { assertAdmittedInputPath, assertLiteralInputPath, readIntegrationTypeInputs, readRegularInput } from "./typecheck-integration-inputs.mjs";

const owner = "fixture producer";

function shardFixture() {
  const selected = ["tests/safe-a.test.ts", "tests/safe-b.test.ts", "tests/native.test.ts"];
  const contents = new Map([
    ["/package/integration-boundaries.json", Buffer.from(JSON.stringify(boundary))],
    ["/package/" + fixture.owner, Buffer.from(owner)],
    ["/package/tests/safe-a.test.ts", Buffer.from("pure-a")],
    ["/package/tests/safe-b.test.ts", Buffer.from("pure-b")],
    ["/package/tests/helper.ts", Buffer.from("pure-helper")],
    ["/package/tests/native.test.ts", Buffer.from("native")],
  ]);
  const digest = path => createHash("sha256").update(contents.get("/package/" + path)).digest("hex");
  const profile = { version: 1, unknownWeightMs: 5000, weights: { "tests/safe-a.test.ts": 10, "tests/safe-b.test.ts": 10, "tests/native.test.ts": 20 } };
  const review = { version: 1, files: {
    "tests/safe-a.test.ts": { "tests/safe-a.test.ts": digest("tests/safe-a.test.ts"), "tests/helper.ts": digest("tests/helper.ts") },
    "tests/safe-b.test.ts": { "tests/safe-b.test.ts": digest("tests/safe-b.test.ts") },
  } };
  contents.set("/package/scripts/test-duration-weights.json", Buffer.from(JSON.stringify(profile)));
  contents.set("/package/scripts/test-parallel-review.json", Buffer.from(JSON.stringify(review)));
  const fileSystem = { ...fileSystemFor(contents), globSync(ignoredPattern, options) { return selected.filter(path => !options.exclude(path)); } };
  return { selected, contents, profile, review, fileSystem };
}

test("Bash shards: env parsing is opt-in and strictly bounded", () => {
  assert.equal(parseTestExecution({}), undefined);
  assert.deepEqual(parseTestExecution({ SAFE_BASH_TEST_SHARD: "1/4" }), { shardIndex: 0, shardCount: 4, concurrency: 1 });
  assert.deepEqual(parseTestExecution({ SAFE_BASH_TEST_SHARD: "4/4", SAFE_BASH_TEST_CONCURRENCY: "2" }), { shardIndex: 3, shardCount: 4, concurrency: 2 });
  assert.deepEqual(parseTestExecution({ SAFE_BASH_TEST_CONCURRENCY: "2" }), { shardIndex: 0, shardCount: 1, concurrency: 2 });
  for (const value of ["", "0/4", "5/4", "1/3", "1/04", "01/4", " 1/4", "1/4 ", "1", undefined]) {
    assert.throws(() => parseTestExecution({ SAFE_BASH_TEST_SHARD: value }), /SAFE_BASH_TEST_SHARD/);
  }
  for (const value of ["", "0", "3", "02", "-1", "1.5", " 2", undefined]) {
    assert.throws(() => parseTestExecution({ SAFE_BASH_TEST_CONCURRENCY: value }), /SAFE_BASH_TEST_CONCURRENCY/);
  }
  for (const flag of ["--test-concurrency=8", "--test-shard=1/2", "--experimental-test-isolation=none", "--test-force-exit"]) {
    assert.throws(() => parseTestExecution({ SAFE_BASH_TEST_CONCURRENCY: "2", NODE_OPTIONS: flag }), /Conflicting NODE_OPTIONS/);
    assert.equal(parseTestExecution({ NODE_OPTIONS: flag }), undefined);
  }
});

test("Bash shards: longest-first balancing is deterministic with stable ties", () => {
  const files = ["d", "b", "a", "c", "e", "f", "g", "h"];
  const weights = { a: 8, b: 7, c: 6, d: 5, e: 4, f: 3, g: 2, h: 1 };
  const plan = planTestShards(files, weights, 4, 5000);
  assert.deepEqual(plan.map(shard => shard.estimatedMs), [9, 9, 9, 9]);
  assert.deepEqual(plan.map(shard => shard.files), [["a", "h"], ["b", "g"], ["c", "f"], ["d", "e"]]);
  assert.deepEqual(planTestShards([...files].reverse(), weights, 4, 5000), plan);
  assert.deepEqual(files, ["d", "b", "a", "c", "e", "f", "g", "h"]);
});

test("Bash shards: discovery is membership; missing weights and new files cannot disappear", () => {
  const files = ["known", "new", "other"];
  const plan = planTestShards(files, { known: 100, obsolete: 100000 }, 4, 5000);
  assert.deepEqual(plan.flatMap(shard => shard.files).sort(), [...files].sort());
  assert.equal(new Set(plan.flatMap(shard => shard.files)).size, files.length);
  assert.equal(plan.reduce((sum, shard) => sum + shard.estimatedMs, 0), 10100);
  assert.equal(plan.some(shard => shard.files.includes("obsolete")), false);
  assert.throws(() => planTestShards(["same", "same"], {}, 4, 5000), /duplicate/i);
  for (const weight of [0, -1, NaN, Infinity, "2"]) assert.throws(() => planTestShards(["known"], { known: weight }, 4, 5000));
  assert.throws(() => planTestShards(files, {}, 3, 5000));
  assert.throws(() => planTestShards(files, {}, 4, 0));
});

test("Bash shards: only reviewed unchanged pure files enter the parallel phase", () => {
  const specimen = shardFixture();
  assert.deepEqual(planTestPhases("/package", specimen.selected, 2, specimen.review, specimen.fileSystem), [
    { concurrency: 2, files: ["tests/safe-a.test.ts", "tests/safe-b.test.ts"] },
    { concurrency: 1, files: ["tests/native.test.ts"] },
  ]);
  specimen.contents.set("/package/tests/helper.ts", Buffer.from("changed helper"));
  assert.deepEqual(planTestPhases("/package", specimen.selected, 2, specimen.review, specimen.fileSystem), [{ concurrency: 1, files: specimen.selected }]);
  specimen.contents.delete("/package/tests/safe-b.test.ts");
  assert.deepEqual(planTestPhases("/package", specimen.selected, 2, specimen.review, specimen.fileSystem), [{ concurrency: 1, files: specimen.selected }]);
});

test("Bash shards: new and symlinked files stay serial without reading link targets", () => {
  const specimen = shardFixture();
  const fileSystem = { ...specimen.fileSystem, lstatSync(path) {
    if (path === "/package/tests/safe-a.test.ts") return { isFile: () => false, isSymbolicLink: () => true };
    return specimen.fileSystem.lstatSync(path);
  }, readFileSync(path) {
    assert.notEqual(path, "/package/tests/safe-a.test.ts");
    return specimen.fileSystem.readFileSync(path);
  } };
  const phases = planTestPhases("/package", [...specimen.selected, "tests/new.test.ts"], 2, specimen.review, fileSystem);
  assert.deepEqual(phases, [{ concurrency: 1, files: [...specimen.selected, "tests/new.test.ts"] }]);
  assert.deepEqual(planTestPhases("/package", specimen.selected, 1, specimen.review, fileSystem), [{ concurrency: 1, files: specimen.selected }]);
});

test("Bash shards: a singleton reviewed group needs no extra runner process", () => {
  const specimen = shardFixture();
  specimen.selected.splice(1, 1);
  const calls = [];
  assert.equal(runTests("/package", [], (ignoredExecutable, args) => { calls.push(args); return { status: 0 }; }, specimen.fileSystem, { shardIndex: 0, shardCount: 1, concurrency: 2 }), 0);
  assert.deepEqual(calls, [["--import", "tsx", "--test", "--test-concurrency=1", ...[...specimen.selected].sort()]]);
});

test("Bash shards: the executable rejects invalid opt-ins before discovery or test execution", () => {
  for (const [key, value] of [["SAFE_BASH_TEST_SHARD", "0/4"], ["SAFE_BASH_TEST_CONCURRENCY", "3"]]) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.SAFE_BASH_TEST_SHARD;
    delete env.SAFE_BASH_TEST_CONCURRENCY;
    env[key] = value;
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./test.mjs", import.meta.url))], { env, encoding: "utf8", timeout: 5000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes(key), result.stderr);
  }
});

test("Bash shards: controlled arguments preserve selectors and reject scheduler bypasses", () => {
  for (const args of [[], ["--test-name-pattern", "some case"], ["--test-skip-pattern=skip", "--test-reporter=tap"], ["--test-reporter", "spec"]]) assert.doesNotThrow(() => validateShardArguments(args));
  for (const args of [["--test-concurrency=4"], ["--test-concurrency", "1"], ["--test-shard=1/2"], ["--experimental-test-isolation=none"], ["--test-force-exit"], ["--test-reporter-destination=result.tap"], ["tests/extra.test.ts"], ["--"], ["--test-name-pattern"]]) assert.throws(() => validateShardArguments(args));
});

test("Bash shards: phases are sequential, bounded, and strip scheduling env from children", () => {
  const specimen = shardFixture();
  const calls = [];
  assert.equal(runTests("/package", ["--test-name-pattern", "a case", "--test-reporter=tap"], (executable, args, options) => {
    assert.equal(executable, process.execPath);
    assert.equal(options.cwd, "/package"); assert.equal(options.stdio, "inherit");
    assert.equal(Object.hasOwn(options.env, "SAFE_BASH_TEST_SHARD"), false);
    assert.equal(Object.hasOwn(options.env, "SAFE_BASH_TEST_CONCURRENCY"), false);
    assert.equal(options.env.PATH, process.env.PATH);
    calls.push(args);
    return { status: 0 };
  }, specimen.fileSystem, { shardIndex: 0, shardCount: 1, concurrency: 2 }), 0);
  assert.deepEqual(calls, [
    ["--import", "tsx", "--test", "--test-concurrency=2", "--test-name-pattern", "a case", "--test-reporter=tap", "tests/safe-a.test.ts", "tests/safe-b.test.ts"],
    ["--import", "tsx", "--test", "--test-concurrency=1", "--test-name-pattern", "a case", "--test-reporter=tap", "tests/native.test.ts"],
  ]);
});

test("Bash shards: failure or termination prevents later phases without retries", () => {
  const specimen = shardFixture();
  for (const result of [{ status: 17 }, { status: null, signal: "SIGTERM" }]) {
    let calls = 0;
    assert.equal(runTests("/package", [], () => { calls++; return result; }, specimen.fileSystem, { shardIndex: 0, shardCount: 1, concurrency: 2 }), result.status ?? 1);
    assert.equal(calls, 1);
  }
  const failure = new Error("spawn failed");
  let calls = 0;
  assert.throws(() => runTests("/package", [], () => { calls++; return { error: failure }; }, specimen.fileSystem, { shardIndex: 0, shardCount: 1, concurrency: 2 }), error => error === failure);
  assert.equal(calls, 1);
});

test("Bash shards: all four runner selections cover discovery exactly once including new files", () => {
  const specimen = shardFixture();
  specimen.selected.push("tests/new.test.ts", "tests/review/run/source/frozen.test.ts", "tests/commands/xan-author-20260828/held.test.ts");
  const executed = [];
  for (let shardIndex = 0; shardIndex < 4; shardIndex++) {
    assert.equal(runTests("/package", [], (ignoredExecutable, args) => { executed.push(...args.filter(value => value.endsWith(".test.ts"))); return { status: 0 }; }, specimen.fileSystem, { shardIndex, shardCount: 4, concurrency: 2 }), 0);
  }
  assert.deepEqual(executed.sort(), ["tests/safe-a.test.ts", "tests/safe-b.test.ts", "tests/native.test.ts", "tests/new.test.ts"].sort());
});

test("Bash shards: empty shards do not accidentally invoke Node discovery", () => {
  const specimen = shardFixture();
  specimen.selected.splice(1);
  assert.equal(runTests("/package", [], () => { throw new Error("must not launch an empty shard"); }, specimen.fileSystem, { shardIndex: 3, shardCount: 4, concurrency: 2 }), 0);
});

test("Bash shards: maintained discovery union is dynamic, without profile-only members", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = discoverTests(root, loadBoundaries(root));
  const profile = JSON.parse(readFileSync(new URL("./test-duration-weights.json", import.meta.url)));
  const shards = planTestShards(files, profile.weights, 4, profile.unknownWeightMs);
  assert.deepEqual(shards.flatMap(shard => shard.files).sort(), files);
  assert.equal(new Set(shards.flatMap(shard => shard.files)).size, files.length);
  const expanded = planTestShards([...files, "tests/new-unweighted-shard-control.test.ts"], profile.weights, 4, profile.unknownWeightMs);
  assert.deepEqual(expanded.flatMap(shard => shard.files).sort(), [...files, "tests/new-unweighted-shard-control.test.ts"].sort());
});

test("Bash shards: real workers rendezvous in pairs, retire before serial work, and forward failures", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const entries = ["tests/contracts/command.test.ts", "tests/contracts/value.test.ts", "tests/shell/value-state.test.ts", "tests/commands/time-env/format-regressions.test.ts"];
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const failing of [null, 0, 2]) {
    const coordinator = spawn(process.execPath, ["--input-type=module", "-e", `
      import { createServer } from 'node:net';
      const seen = [];
      const waiting = [];
      const sockets = new Set();
      const server = createServer(socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        let input = '';
        socket.on('data', chunk => {
          input += chunk;
          if (!input.includes('\\n')) return;
          const row = JSON.parse(input);
          input = '';
          const previousAlive = seen.filter(previous => {
            try { process.kill(previous.pid, 0); return true; }
            catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
          }).map(previous => previous.id);
          seen.push(row);
          console.log(JSON.stringify({ ...row, previousAlive }));
          if (row.id < 2) {
            waiting.push(socket);
            if (waiting.length === 2) for (const peer of waiting) peer.end('release');
          } else socket.end('release');
        });
      });
      server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
      process.on('SIGTERM', () => { for (const socket of sockets) socket.destroy(); server.close(); });
    `], { env, stdio: ["ignore", "pipe", "pipe"] });
    const closed = once(coordinator, "close");
    let output = "";
    let errors = "";
    coordinator.stdout.setEncoding("utf8");
    coordinator.stderr.setEncoding("utf8");
    coordinator.stdout.on("data", chunk => { output += chunk; });
    coordinator.stderr.on("data", chunk => { errors += chunk; });
    const lines = createInterface({ input: coordinator.stdout });
    try {
      const [ready] = await Promise.race([once(lines, "line"), closed.then(() => { throw new Error("fixture coordinator exited before ready: " + errors); })]);
      const { port } = JSON.parse(ready);
      const sources = Object.fromEntries(entries.map((entry, id) => [pathToFileURL(root + entry).href, `
        import assert from 'node:assert/strict';
        import { createConnection } from 'node:net';
        import test from 'node:test';
        test('shard fixture ${id}', async () => {
          assert.equal(process.env.SAFE_BASH_TEST_SHARD, undefined);
          assert.equal(process.env.SAFE_BASH_TEST_CONCURRENCY, undefined);
          await new Promise((resolve, reject) => {
            const socket = createConnection({ host: '127.0.0.1', port: ${port} });
            socket.setTimeout(3000, () => socket.destroy(new Error('missing worker rendezvous')));
            socket.on('connect', () => socket.write(JSON.stringify({ id: ${id}, pid: process.pid }) + '\\n'));
            socket.resume();
            socket.on('error', reject);
            socket.on('end', () => { socket.setTimeout(0); resolve(); });
          });
          assert.notEqual(${id}, ${JSON.stringify(failing)}, 'controlled shard failure');
        });
      `]));
      const loader = `
        import { registerHooks } from 'node:module';
        const sources = ${JSON.stringify(sources)};
        registerHooks({ load(url, context, next) {
          return Object.hasOwn(sources, url) ? { format: 'module', source: sources[url], shortCircuit: true } : next(url, context);
        } });
      `;
      const contents = new Map([
        [root + "integration-boundaries.json", Buffer.from(JSON.stringify(boundary))],
        [root + fixture.owner, Buffer.from(owner)],
        ...entries.map(entry => [root + entry, Buffer.from(sources[pathToFileURL(root + entry).href])]),
      ]);
      const review = { version: 1, files: Object.fromEntries(entries.slice(0, 2).map(entry => [entry, { [entry]: createHash("sha256").update(contents.get(root + entry)).digest("hex") }])) };
      contents.set(root + "scripts/test-parallel-review.json", Buffer.from(JSON.stringify(review)));
      contents.set(root + "scripts/test-duration-weights.json", Buffer.from(JSON.stringify({ version: 1, weights: {}, unknownWeightMs: 5000 })));
      const fileSystem = { ...fileSystemFor(contents), globSync() { return [...entries]; } };
      const results = [];
      const result = runTests(root.slice(0, -1), ["--test-reporter=tap"], (executable, args, options) => {
        const childEnv = { ...options.env };
        delete childEnv.NODE_TEST_CONTEXT;
        assert.deepEqual(args.slice(0, 2), ["--import", "tsx"]);
        const child = spawnSync(executable, ["--import", `data:text/javascript,${encodeURIComponent(loader)}`, ...args.slice(2)], { ...options, env: childEnv, stdio: "pipe", encoding: "utf8", timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
        results.push(child);
        return child;
      }, fileSystem, { shardIndex: 0, shardCount: 1, concurrency: 2 });
      assert.equal(result, failing === null ? 0 : 1, results.map(child => child.stdout + child.stderr).join("\n"));
      assert.equal(results.length, failing === 0 ? 1 : 2);
      for (const child of results) assert.ifError(child.error);
      if (failing !== null) assert.ok(results.some(child => child.stdout.includes("controlled shard failure")));
    } finally {
      coordinator.kill("SIGTERM");
      await closed;
      lines.close();
    }
    assert.equal(errors, "");
    const rows = output.trim().split("\n").slice(1).map(line => JSON.parse(line));
    assert.deepEqual(rows.map(row => row.id).sort(), failing === 0 ? [0, 1] : [0, 1, 2, 3]);
    assert.equal(rows[0].previousAlive.length, 0);
    assert.deepEqual(rows[1].previousAlive, [rows[0].id]);
    for (const row of rows.slice(2)) assert.deepEqual(row.previousAlive, [], "previous workers must retire before serial admission");
    assert.equal(new Set(rows.map(row => row.pid)).size, rows.length);
    for (const row of rows) assert.throws(() => process.kill(row.pid, 0), error => error.code === "ESRCH", "fixture worker leaked");
  }
});
const removedGitFixtureRoots = [
  "tests/commands/git-author-20260828",
  "tests/commands/git-design-20260828",
  "tests/commands/git-independent-20260828",
  "tests/commands/git-pack-author-20260828",
  "tests/commands/git-pack-design-20260828",
  "tests/commands/git-pack-independent-20260828",
  "tests/integration/git-public-20260829",
  "tests/integration/git-public-independent-20260829",
  "tests/integration/git-public-loader-review-20260829",
];

test("Git fixture cleanup removes obsolete roots without opening payloads", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  for (const path of removedGitFixtureRoots) {
    assertAdmittedInputPath(path, boundaries);
    assert.equal(fs.lstatSync(root + path, { throwIfNoEntry: false }), undefined, path);
  }
});

test("Git fixture cleanup retains historical identities but removes their live admissions", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  const inventory = JSON.parse(readRegularInput(root, "integration-lint-inventory.json", 1048576, fs, boundaries));
  const receiptBytes = readRegularInput(root, "integration-lint-audit/import-697ad-verification-retirement.json", 524288, fs, boundaries);
  assert.equal(createHash("sha256").update(receiptBytes).digest("hex"), "9f73d12df64ba05609d58e8e591828d246bf0eab2276167f43caf5f46fa5aa49");
  const paths = Object.keys(JSON.parse(receiptBytes).files);
  const isRemoved = path => removedGitFixtureRoots.some(root => path === root || path.startsWith(root + "/"));
  assert.equal(paths.length, 789);
  assert.equal(paths.filter(isRemoved).length, 37);
  const retirement = inventory.records.find(record => record.id === "import-697ad-verification-tools-retired-789");
  assert.deepEqual(retirement.members.map(member => member.path), paths.filter(path => !isRemoved(path)));
  assert.ok(inventory.records.every(record => [...record.owners, ...record.members].every(entry => !isRemoved(entry.path))));
  const typeInputs = JSON.parse(readRegularInput(root, "integration-type-inputs.json", 100000, fs, boundaries));
  assert.ok(typeInputs.cohorts.every(cohort => !isRemoved(cohort.owner.path) && cohort.entries.every(entry => !isRemoved(entry.path))));
});

test("runner exposes no native qualification selector", async () => {
  const runner = await import("./test.mjs");
  assert.equal(Object.hasOwn(runner, "selectNativeTests"), false);
});
const fixture = {
  path: "tests/review/run/source",
  owner: "tests/review/produce.mjs",
  sha256: createHash("sha256").update(owner).digest("hex"),
};
const boundary = {
  version: 1,
  heldSourceFiles: ["src/commands/xan/argv.ts"],
  heldEvidenceDirectories: ["tests/commands/xan-author-20260828"],
  fixtureDirectories: [fixture],
};

function assertSource7Discovery(files) {
  const removed = [
    "tests/fs/memory/faithful-binding.test.ts",
    "tests/fs/mount/comparison.test.ts",
    "tests/fs/mount/identity-authority-review/authority.test.ts",
    "tests/fs/mount/identity-authority-review/implementation/remote-comparison.test.ts",
    "tests/fs/mount/identity-scope.test.ts",
    "tests/fs/real/allocation-independent/boundary.test.ts",
    "tests/fs/s3/faithful-decorators.test.ts",
    "tests/fs/s3/http/unit/signature.test.ts",
    "tests/fs/s3/late-authority.test.ts",
    "tests/fs/webdav/operation-authority.test.ts",
    "tests/fs/webdav/resource-id.test.ts",
    "tests/fs/webdav/trusted-binding.test.ts",
    "tests/fs/webdav/xml.test.ts",
  ];
  const added = [
    "tests/fs/canonical-boundaries.test.ts",
    "tests/fs/migration-permission-contract.test.ts",
    "tests/fs/public-comparison.test.ts",
    "tests/integration/qualified-current-release-repair/canonical-peer.test.ts",
    "tests/integrations/safejs/canonical-filesystem.test.ts",
    "tests/integrations/safejs/published-replay.test.ts",
  ];
  for (const path of [
    "tests/commands/bytes/input-budget.test.ts",
    "tests/commands/node-safejs.test.ts",
    "tests/commands/input.test.ts",
    "tests/commands/network/mounted-output.test.ts",
    "tests/contracts/value.test.ts",
    "tests/shell/value-state.test.ts",
    "tests/shell/byte-values.test.ts",
  ]) assert.ok(files.includes(path), "retained byte-value test is missing: " + path);
  assert.equal(new Set(files).size, files.length);
  for (const path of removed) assert.ok(!files.includes(path), "removed filesystem test remains selected: " + path);
  for (const path of added) assert.ok(files.includes(path), "retained filesystem test is missing: " + path);
  assert.ok(files.includes("tests/fs/conformance/provenance.test.ts"));
  assert.ok(files.includes("tests/integration/typecheck-consumer-resolution.test.ts"));
  assert.ok(files.includes("tests/shell/redirect-limits.test.ts"));
  assert.ok(files.includes("tests/shell/parse-budget.test.ts"));
  assert.ok(files.includes("tests/shell/parse-admission.test.ts"));
  assert.ok(files.includes("tests/shell/parse-admission-runtime.test.ts"));
  assert.ok(files.includes("tests/shell/arithmetic-admission.test.ts"));
  assert.ok(files.includes("tests/shell/string-operations.test.ts"));
  assert.ok(files.includes("tests/shell/parameter-depth.test.ts"));
  assert.ok(files.includes("tests/shell/runtime-parameter-depth.test.ts"));
  assert.ok(files.includes("tests/commands/structured/string-work.test.ts"));
  assert.ok(files.includes("tests/commands/cut-bom.test.ts"));
  assert.ok(files.includes("tests/commands/line-fragment-admission.test.ts"));
  assert.ok(files.includes("tests/commands/yq-author-20260828/input-admission.test.ts"));
  assert.ok(files.includes("tests/commands/text-programs/allocation-admission.test.ts"));
  assert.ok(files.includes("tests/commands/directory-admission.test.ts"));
  assert.ok(files.includes("tests/commands/recursive-filesystem-admission.test.ts"));
  assert.ok(files.includes("tests/commands/text-programs/awk-retention.test.ts"));
  assert.ok(files.includes("tests/commands/text-programs/awk-reader-retention.test.ts"));
  assert.ok(files.includes("tests/contracts/filesystem-direct-output.test.ts"));
  assert.ok(files.includes("tests/commands/text-programs/awk-file-output-budget.test.ts"));
  assert.ok(files.includes("tests/commands/text-programs/sed-file-output-budget.test.ts"));
  assert.ok(files.includes("tests/commands/text-programs/awk-format-integration.test.ts"));
  assert.ok(files.includes("tests/commands/text-programs/awk-format-work-budget.test.ts"));
  assert.ok(files.includes("tests/commands/text-programs/format-admission.test.ts"));
  assert.ok(files.includes("tests/plugins/git-removal.test.ts"));
  assert.ok(files.includes("tests/shell-stress/invocation-closure/v2-batch-controls.test.ts"));
  assert.ok(!files.includes("tests/commands/git/io-cleanup.test.ts"));
}

function fileSystemFor(files) {
  return {
    readdirSync(path) { return [...new Set([...files.keys()].filter(file => file.startsWith(path + "/")).map(file => file.slice(path.length + 1).split("/")[0]))]; },
    lstatSync(path) {
      assert.ok(files.has(path) || [...files.keys()].some(file => file.startsWith(path + "/")), `unexpected admission: ${path}`);
      return { isFile: () => files.has(path), isDirectory: () => !files.has(path), isSymbolicLink: () => false, size: files.get(path)?.length ?? 0 };
    },
    readFileSync(path) { assert.ok(files.has(path), `unexpected content read: ${path}`); return files.get(path); },
  };
}

function lintFixture() {
  const capture = "tests/review/sealed";
  const ownerPath = "tests/review/manifest.json";
  const memberPath = `${capture}/copied.mjs`;
  const files = new Map([
    [`/package/${ownerPath}`, Buffer.from('{"captured":["copied.mjs"]}')],
    [`/package/${memberPath}`, Buffer.from("export const captured = true;")],
    ["/package/tests/review/current.mjs", Buffer.from("throw new Error('live failure');")],
  ]);
  const bind = path => ({ path, bytes: files.get(`/package/${path}`).length, sha256: createHash("sha256").update(files.get(`/package/${path}`)).digest("hex") });
  const inventory = { version: 1, records: [{
    id: "reviewed-capture", role: "immutable-harness-capture", owners: [bind(ownerPath)],
    proof: { owner: ownerPath, selector: "captured", pathBase: capture, relation: "reviewed recorded copy; not proof of successful execution" },
    members: [bind(memberPath)], codeDirectory: capture,
  }] };
  const memory = fileSystemFor(files);
  const reads = [];
  const links = new Map();
  const fileSystem = {
    ...memory,
    lstatSync(path) { return links.has(path) ? { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true, size: links.get(path).length } : memory.lstatSync(path); },
    readFileSync(path) { reads.push(path); assert.ok(!links.has(path), "symlink contents must not be read"); return memory.readFileSync(path); },
    readlinkSync(path) { assert.ok(links.has(path)); return links.get(path); },
  };
  return { inventory, files, reads, links, fileSystem, memberPath, ownerPath, capture };
}

const successorSubjects = [
  {
    "id": "candidate7-01-failed-attempt-capture",
    "role": "immutable-harness-capture",
    "owners": [
      "tests/compatibility/bash-conditional-author-20260829/EXECUTOR-v4.json",
      "tests/compatibility/bash-conditional-author-20260829/HANDOFF-v5.md",
      "tests/compatibility/bash-conditional-author-20260829/run-v5.mjs",
      "tests/compatibility/bash-conditional-author-20260829/launch-v5.mjs"
    ],
    "proof": {
      "owner": "tests/compatibility/bash-conditional-author-20260829/EXECUTOR-v4.json",
      "selector": "/files/61",
      "pathBase": ".",
      "relation": "Immutable failed-attempt harness capture with a positively identified corrected successor and retained selector/validator. Original FAILED status is preserved; this is not a passing test or a passive-data relabeling of the current driver. "
    },
    "member": "tests/compatibility/bash-conditional-author-20260829/run-v4.mjs"
  },
  {
    "id": "candidate7-02-failed-attempt-capture",
    "role": "immutable-harness-capture",
    "owners": [
      "tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/BUILD-PRESEAL.json",
      "tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/HANDOFF.md",
      "tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/host-doubles-v2.mjs",
      "tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/double-owner-v2.mjs"
    ],
    "proof": {
      "owner": "tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/BUILD-PRESEAL.json",
      "selector": "/fixtures/2",
      "pathBase": ".",
      "relation": "Immutable failed-attempt harness capture with a positively identified corrected successor and retained selector/validator. Original FAILED status is preserved; this is not a passing test or a passive-data relabeling of the current driver. Owner path uses the exact historical /Users/kjopek/Workspace/safe-bash/ metadata prefix; only its authorized current relative counterpart may be accessed."
    },
    "member": "tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/l02-repair-v1/host-doubles.mjs"
  },
  {
    "id": "candidate7-06-failed-attempt-capture",
    "role": "immutable-harness-capture",
    "owners": [
      "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/ARTIFACTS.json",
      "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/HANDOFF.md",
      "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/SEAL-FOLLOWUP-FREEZE.json",
      "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/seal-v2.mjs",
      "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/validate.mjs"
    ],
    "proof": {
      "owner": "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/ARTIFACTS.json",
      "selector": "/files/27",
      "pathBase": "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10",
      "relation": "Immutable failed-attempt harness capture with a positively identified corrected successor and retained selector/validator. Original FAILED status is preserved; this is not a passing test or a passive-data relabeling of the current driver. "
    },
    "member": "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/seal.mjs"
  },
  {
    "id": "candidate7-07-content-binding-refusal",
    "role": "generated-negative",
    "owners": [
      "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1/ACTUAL-01/RESULT.json",
      "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1/runner.mjs",
      "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1/SEAL.json",
      "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/FINAL-PRESEAL.json",
      "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/FINAL-RESULT.json",
      "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/FINAL-SEAL.json",
      "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1/ACTUAL-01/work/emitted/matcher.js"
    ],
    "proof": {
      "owner": "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1/ACTUAL-01/RESULT.json",
      "selector": "/finalCensus/0",
      "pathBase": ".",
      "relation": "Generated B01-content refusal operand, not a JavaScript diagnostic control or maintained driver. Raw finalCensus[0] binds this exact member; the same retained runner bound() checks the restored positive matcher before and after refusal. Original-root path and mode records are metadata only; both size and hash differ."
    },
    "member": "tests/compatibility/bash-ere-engine-independent-20260829/r01-v1/closure/tests/compatibility/bash-ere-engine-author-20260829/r01-v1/ACTUAL-01/work/changed.js"
  },
  {
    "id": "regex-design-revised-controlled-prototype",
    "role": "controlled-prototype-source",
    "owners": [
      "tests/stress/regex-execution/design/revision/evidence/build.json",
      "tests/stress/regex-execution/design/revision/REPORT.md",
      "tests/stress/regex-execution/design/revision/tsconfig.json",
      "tests/stress/regex-execution/design/revision/prepare.mjs",
      "tests/stress/regex-execution/design/revision/child.mjs",
      "tests/stress/regex-execution/design/tsconfig.json",
      "tests/stress/regex-execution/design/validation/REPORT.md",
      "tests/stress/regex-execution/design/validation/evidence/audit.json",
      "tests/stress/regex-execution/design/frozen.json"
    ],
    "proof": {
      "owner": "tests/stress/regex-execution/design/revision/evidence/build.json",
      "selector": "/source/tests~1stress~1regex-execution~1design~1client.ts",
      "pathBase": ".",
      "relation": "Single revised experimental Client/Capacity implementation is the controlled subject compiled and selected by the separately retained preparation/config/child. Revision and independent validation source maps authenticate it; original frozen.json deliberately binds a different predecessor. Retain ordinary compiler input and every maintained validator/production runtime. Emitted identity is recorded only; historical failures remain."
    },
    "member": "tests/stress/regex-execution/design/client.ts"
  }
];

function successorFixture(index = 0) {
  const subject = successorSubjects[index];
  const files = new Map(subject.owners.map(path => ["/package/" + path, Buffer.from(path.endsWith(".json") ? "{}" : "retained provenance")]));
  files.set("/package/" + subject.member, Buffer.from("throw new Error('must never execute');"));
  files.set("/package/tests/review/live.mjs", Buffer.from("unknownCurrentValue();"));
  const bind = path => ({ path, bytes: files.get("/package/" + path).length, sha256: createHash("sha256").update(files.get("/package/" + path)).digest("hex") });
  const record = { id: subject.id, role: subject.role, owners: subject.owners.map(bind), proof: structuredClone(subject.proof), members: [bind(subject.member)] };
  const manifests = new Map();
  function saveOwner(path, manifest) {
    manifests.set(path, manifest);
    files.set("/package/" + path, Buffer.from(JSON.stringify(manifest)));
    Object.assign(record.owners.find(owner => owner.path === path), bind(path));
  }
  const prefix = "/Users/kjopek/Workspace/safe-bash/";
  let selected;
  if (index === 4) {
    selected = record.members[0].sha256;
    saveOwner(subject.proof.owner, { source: { [subject.member]: selected } });
    saveOwner(subject.owners[7], { sourceHashes: { [subject.member]: selected } });
  } else {
    const [collection, offset] = subject.proof.selector.slice(1).split("/");
    const historical = index === 1 || index === 3;
    selected = { path: historical ? prefix + subject.member : subject.proof.pathBase === "." ? subject.member : posix.basename(subject.member), [historical ? "size" : "bytes"]: record.members[0].bytes, sha256: record.members[0].sha256 };
    if (historical) selected.mode = 420;
    const rows = Array.from({ length: Number(offset) + 1 }, () => null);
    rows[Number(offset)] = selected;
    saveOwner(subject.proof.owner, { [collection]: rows });
  }
  function refreshRefusal() {
    const raw = manifests.get(subject.proof.owner);
    const rawBinding = bind(subject.proof.owner);
    const summary = { result: { sourceResult: prefix + subject.proof.owner, resultSha256: rawBinding.sha256 }, guards: structuredClone(raw.guards) };
    saveOwner(subject.owners[4], summary);
    const seal = { productResultSha256: rawBinding.sha256, rows: [null, { ...bind(subject.owners[4]), path: "FINAL-RESULT.json", mode: 384 }, null, { ...bind(subject.owners[3]), path: "FINAL-PRESEAL.json", mode: 384 }] };
    saveOwner(subject.owners[5], seal);
  }
  if (index === 3) {
    files.set("/package/" + subject.owners[6], Buffer.from("positive matcher"));
    Object.assign(record.owners[6], bind(subject.owners[6]));
    const historicalRow = path => ({ path: prefix + path, size: bind(path).bytes, sha256: bind(path).sha256, mode: 420 });
    const positive = historicalRow(subject.owners[6]);
    const raw = manifests.get(subject.proof.owner);
    raw.emittedBindings = [null, null, null, null, null, positive];
    raw.finalCensus[6] = structuredClone(positive);
    raw.guards = [{ id: "B01-content", refused: true, dataOnly: true, reason: [
      "AssertionError [ERR_ASSERTION]: SAFETY input binding", "+ actual - expected", "", "  {", "    mode: 420,",
      "    path: '" + selected.path + "',", "+   sha256: '" + selected.sha256 + "',", "+   size: " + selected.size,
      "-   sha256: '" + positive.sha256 + "',", "-   size: " + positive.size, "  }", "",
    ].join("\n") }];
    raw.rows = Array.from({ length: 26 }, () => null);
    for (const [offset, role] of [[19, "M01-old-reporting-restored"], [21, "M02-history-link-restored"], [23, "M03-reset-checkpoint-restored"], [25, "M04-reset-precharge-restored"]]) {
      raw.rows[offset] = { role, mutated: false, observed: { fail: 0 }, loaded: { files: { matcher: { [offset === 21 ? "url" : "path"]: (offset === 21 ? "file://" : "") + positive.path, sha256: positive.sha256 } } } };
    }
    saveOwner(subject.proof.owner, raw);
    saveOwner(subject.owners[2], { fixtures: [null, null, null, null, null, null, null, historicalRow(subject.owners[1])] });
    saveOwner(subject.owners[3], { runner: historicalRow(subject.owners[1]), seal: historicalRow(subject.owners[2]) });
    refreshRefusal();
  }
  const memory = fileSystemFor(files);
  const reads = [];
  const fileSystem = { ...memory, readFileSync(path) { reads.push(path); return memory.readFileSync(path); } };
  return { files, reads, fileSystem, record, inventory: { version: 1, records: [record] }, manifests, saveOwner, refreshRefusal, selected, subject };
}

test("five-record successors admit only literal subjects and preserve retained owners and live neighbors", () => {
  for (let index = 0; index < 5; index++) {
    const fixture = successorFixture(index);
    const result = verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem);
    assert.deepEqual(result.files, [fixture.subject.member]);
    for (const path of [...fixture.subject.owners, "tests/review/live.mjs"]) assert.ok(!result.files.includes(path));
    assert.equal(fixture.reads.at(-1), "/package/" + fixture.subject.member);
    assert.ok(fixture.reads.every(path => path.startsWith("/package/")));
  }
});

test("five-record successor schema rejects retargeting roles selectors and directories before reads", () => {
  const mutations = [
    record => { record.id = "candidate7-03-unapproved"; },
    record => { record.role = "immutable-source-capture"; },
    record => { record.proof.selector += "/extra"; },
    record => { record.proof.selector = "/files/061"; },
    record => { record.proof.pathBase = "tests"; },
    record => { record.proof.owner = record.owners[1].path; },
    record => { record.members[0].path = "tests/review/live.mjs"; },
    record => { record.members[0].path = record.owners[1].path; },
    record => { record.members.push({ ...record.members[0], path: "tests/review/extra.mjs" }); },
    record => { record.codeDirectory = "tests/review"; },
    record => { record.symlinks = []; },
    record => { record.proof.unknown = true; },
  ];
  for (let index = 0; index < 5; index++) for (const mutate of mutations) {
    const fixture = successorFixture(index);
    mutate(fixture.record);
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
});

test("five-record successors reject contradictory owner rows before any subject read", () => {
  const mutations = [
    row => { row.path = "tests/review/live.mjs"; },
    row => { row.path = "file://" + row.path; },
    row => { row.path += "/../copied.mjs"; },
    row => { row.sha256 = "0".repeat(64); },
    row => { row[Object.hasOwn(row, "size") ? "size" : "bytes"]++; },
    row => { row[Object.hasOwn(row, "size") ? "bytes" : "size"] = 1; },
  ];
  for (let index = 0; index < 4; index++) for (const mutate of mutations) {
    const fixture = successorFixture(index);
    mutate(fixture.selected);
    fixture.saveOwner(fixture.subject.proof.owner, fixture.manifests.get(fixture.subject.proof.owner));
    if (index === 3) fixture.refreshRefusal();
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.ok(!fixture.reads.includes("/package/" + fixture.subject.member));
  }
  for (let index = 0; index < 4; index++) for (const mutation of ["missing", "wrong-type", "duplicate"]) {
    const fixture = successorFixture(index);
    const manifest = fixture.manifests.get(fixture.subject.proof.owner);
    const [collection, offset] = fixture.subject.proof.selector.slice(1).split("/");
    if (mutation === "missing") manifest[collection][Number(offset)] = null;
    if (mutation === "wrong-type") manifest[collection] = { [offset]: fixture.selected };
    if (mutation === "duplicate") manifest[collection].push({ ...fixture.selected });
    fixture.saveOwner(fixture.subject.proof.owner, manifest);
    if (index === 3) fixture.refreshRefusal();
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.ok(!fixture.reads.includes("/package/" + fixture.subject.member));
  }
});

test("five-record prototype requires canonical own source maps not predecessor or diagnostic roles", () => {
  const mutations = [
    fixture => { fixture.record.proof.selector = fixture.record.proof.selector.replace("~1", "/"); },
    fixture => { fixture.record.proof.owner = fixture.subject.owners[8]; },
    fixture => { fixture.record.members[0].path = "tests/review/active.test.ts"; },
    fixture => { fixture.record.role = "generated-negative"; },
    fixture => { fixture.saveOwner(fixture.subject.proof.owner, { source: [] }); },
    fixture => { fixture.saveOwner(fixture.subject.proof.owner, { source: {} }); },
    fixture => { fixture.saveOwner(fixture.subject.proof.owner, { source: { [fixture.subject.member]: "0".repeat(64) } }); },
    fixture => { fixture.saveOwner(fixture.subject.owners[7], { sourceHashes: { [fixture.subject.member]: "0".repeat(64) } }); },
  ];
  for (const mutate of mutations) {
    const fixture = successorFixture(4);
    mutate(fixture);
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.ok(!fixture.reads.includes("/package/" + fixture.subject.member));
  }
});

test("five-record refusal requires the same positive binding raw result and restored rows", () => {
  const mutations = [
    raw => { raw.emittedBindings[5].sha256 = "0".repeat(64); },
    raw => { raw.finalCensus[6].path += "/other"; },
    raw => { raw.guards[0].refused = false; },
    raw => { raw.guards[0].dataOnly = false; },
    raw => { raw.guards[0].id = "JS-diagnostic"; },
    raw => { raw.guards[0].reason = raw.guards[0].reason.replace("+   sha256:", "-   sha256:"); },
    raw => { raw.rows[19].observed.fail = 1; },
    raw => { raw.rows[21].loaded.files.matcher.url = "file:///other/matcher.js"; },
    raw => { raw.rows[23].loaded.files.matcher.sha256 = "0".repeat(64); },
    raw => { raw.rows[25].role = "unrelated"; },
  ];
  for (const mutate of mutations) {
    const fixture = successorFixture(3);
    const raw = fixture.manifests.get(fixture.subject.proof.owner);
    mutate(raw);
    fixture.saveOwner(fixture.subject.proof.owner, raw);
    fixture.refreshRefusal();
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.ok(!fixture.reads.includes("/package/" + fixture.subject.member));
  }
  for (const [ownerIndex, mutate] of [
    [2, manifest => { manifest.fixtures[7].sha256 = "0".repeat(64); }],
    [3, manifest => { manifest.runner.path += "/different-binder"; }],
    [4, manifest => { manifest.result.resultSha256 = "0".repeat(64); }],
    [5, manifest => { manifest.productResultSha256 = "0".repeat(64); }],
    [5, manifest => { manifest.rows[1].sha256 = "0".repeat(64); }],
  ]) {
    const fixture = successorFixture(3);
    const owner = fixture.subject.owners[ownerIndex];
    const manifest = fixture.manifests.get(owner);
    mutate(manifest);
    fixture.saveOwner(owner, manifest);
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.ok(!fixture.reads.includes("/package/" + fixture.subject.member));
  }
});

test("five-record successors refuse held aliases ancestors and invalid literals before content reads", () => {
  const crossRecord = successorFixture();
  const provenance = lintFixture();
  provenance.inventory.records[0].owners.push({ ...crossRecord.record.members[0] });
  crossRecord.inventory.records.push(provenance.inventory.records[0]);
  for (const [path, bytes] of provenance.files) crossRecord.files.set(path, bytes);
  assert.throws(() => verifyLintInventory("/package", crossRecord.inventory, boundary, crossRecord.fileSystem));
  assert.deepEqual(crossRecord.reads, []);
  for (const path of ["tests/commands/xan-author-20260828/input.mjs", "tests/commands/XAN-author-20260828/input.mjs", "tests/commands", "tests/review/../input.mjs", "tests/review/*.mjs", "tests/review/@(live|data).mjs"]) {
    for (let index = 0; index < 5; index++) for (const target of ["owner", "member"]) {
      const fixture = successorFixture(index);
      if (target === "owner") { fixture.record.owners[0].path = path; fixture.record.proof.owner = path; }
      else fixture.record.members[0].path = path;
      assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
      assert.deepEqual(fixture.reads, []);
    }
  }
});

test("five-record successors reject metadata aliases symlinks special files and oversize before payload reads", () => {
  for (let index = 0; index < 5; index++) for (const target of ["owner", "member"]) for (const kind of ["alias", "symlink", "ancestor", "special", "oversize"]) {
    const fixture = successorFixture(index);
    const selected = "/package/" + (target === "owner" ? fixture.subject.proof.owner : fixture.subject.member);
    const parent = posix.dirname(selected);
    const memory = fixture.fileSystem;
    const denied = kind === "ancestor" ? parent : selected;
    const fileSystem = {
      ...memory,
      readdirSync(path) { return kind === "alias" && path === parent ? memory.readdirSync(path).map(name => name === posix.basename(selected) ? name.toUpperCase() : name) : memory.readdirSync(path); },
      lstatSync(path) {
        if (path !== denied || kind === "alias") return memory.lstatSync(path);
        if (kind === "oversize") return { ...memory.lstatSync(path), size: 65 * 1024 * 1024 };
        return { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => kind === "symlink" || kind === "ancestor", size: 0 };
      },
    };
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fileSystem));
    assert.ok(!fixture.reads.includes(selected));
  }
});

test("five-record successors reject separate owner and member hash or size drift", () => {
  for (let index = 0; index < 5; index++) for (const target of ["owner", "member"]) for (const resize of [false, true]) {
    const fixture = successorFixture(index);
    const selected = "/package/" + (target === "owner" ? fixture.subject.proof.owner : fixture.subject.member);
    const previous = fixture.files.get(selected);
    fixture.files.set(selected, resize ? Buffer.concat([previous, Buffer.from("x")]) : Buffer.alloc(previous.length, 120));
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    if (resize) assert.ok(!fixture.reads.includes(selected));
  }
});

const archivedLauncherNames = [
  "common.mjs",
  "profile.mjs",
  "admission.mjs",
  "inventory.mjs",
  "run.mjs",
  "worker.mjs",
  "supervise.mjs",
  "execute.mjs",
  "policy.mjs",
  "transport.mjs",
  "external.mjs",
  "external-admission.mjs",
  "built-consumers.mjs",
  "consumer-admission.mjs",
  "tap.mjs",
  "public.mjs",
  "build-audit.mjs",
  "build-types.mjs",
  "phase-runner.mjs",
  "process-observer.mjs",
  "review-build-types.mjs",
  "review-build-types-worker.mjs",
  "projection.mjs",
  "os-instruction-fence.mjs",
  "fenced-supervisor.mjs",
  "tool-routing.mjs",
  "historical-eligibility.mjs",
  "maintained-prerequisites.mjs"
];

const archivedLauncherOtherNames = [
  "CANDIDATE.json",
  "PROFILE.json.gz.base64",
  "PROFILE-RECEIPT.json",
  "CLEANUP.json",
  "EXTERNAL.json.gz.base64",
  "EXTERNAL-RECEIPT.json",
  "consumer.mts.fixture",
  "negative.mts.fixture",
  "INSTRUCTION-PROJECTION.json",
  "OS-INSTRUCTION-FENCE.json",
  "TOOL-ROUTES.json",
  "ELIGIBILITY.json"
];

function archivedLauncherFixture() {
  const base = "tests/integration/full-gate-20260827/unified76-driver/launcher-v3";
  const ownerPath = base + "/DRIVER.json";
  const files = new Map([...archivedLauncherNames, ...archivedLauncherOtherNames].map(name => ["/package/" + base + "/" + name, Buffer.from("throw new Error('historical program must not execute: " + name + "');")]));
  const bind = path => ({ path, bytes: files.get("/package/" + path).length, sha256: createHash("sha256").update(files.get("/package/" + path)).digest("hex") });
  const manifest = { schema: 1, candidate: "f5e9fc49b6abb38e180cc9de16c95fced102ff75", wholeGateLaunched: false, files: Object.fromEntries([...archivedLauncherNames, ...archivedLauncherOtherNames].map(name => [name, bind(base + "/" + name).sha256])) };
  const record = { id: "launcher-v3-retired-operational-tooling", role: "archived-operational-tooling", owners: [], proof: { owner: ownerPath, selector: archivedLauncherNames.map(name => "/files/" + name), pathBase: base, relation: "Retired current manual tooling; preserved executable protocol and failures, not passive fixture data or a successful replay." }, members: archivedLauncherNames.map(name => bind(base + "/" + name)) };
  function saveManifest() {
    files.set("/package/" + ownerPath, Buffer.from(JSON.stringify(manifest)));
    record.owners = [bind(ownerPath)];
  }
  saveManifest();
  const memory = fileSystemFor(files);
  const reads = [];
  const fileSystem = { ...memory, readFileSync(path) { reads.push(path); return memory.readFileSync(path); } };
  return { base, files, reads, fileSystem, manifest, record, inventory: { version: 1, records: [record] }, ownerPath, saveManifest };
}

test("archived operational tooling admits exactly28 literal programs without reading the other12 members", () => {
  const fixture = archivedLauncherFixture();
  const result = verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem);
  assert.deepEqual(result.files, archivedLauncherNames.map(name => fixture.base + "/" + name));
  assert.equal(result.records[0].role, "archived-operational-tooling");
  assert.deepEqual(fixture.reads, [fixture.ownerPath, ...result.files].map(path => "/package/" + path));
  for (const name of archivedLauncherOtherNames) assert.ok(!result.files.includes(fixture.base + "/" + name));
  assert.ok(!result.files.includes(fixture.ownerPath));
});

test("archived operational schema refuses unsupported roles selectors extra members and current roots before reads", () => {
  const mutations = [
    record => { record.id = "other-retirement"; },
    record => { record.role = "immutable-harness-capture"; },
    record => { record.proof.owner = record.proof.owner.replace("DRIVER", "OTHER"); record.owners[0].path = record.proof.owner; },
    record => { record.proof.pathBase = "tests/integration"; },
    record => { record.proof.selector[0] = "/files"; },
    record => { record.proof.selector[0] = "/files/__proto__"; },
    record => { record.proof.selector[0] = record.proof.selector[1]; },
    record => { record.proof.selector = "/files/common.mjs"; },
    record => { record.proof.extra = true; },
    record => { record.codeDirectory = record.proof.pathBase; },
    record => { record.symlinks = []; },
    record => { record.members.pop(); },
    record => { record.members.push({ ...record.members[0], path: record.proof.pathBase + "/new-neighbor.mjs" }); },
    record => { record.owners.push({ ...record.owners[0], path: "tests/review/current.mjs" }); },
  ];
  for (const mutate of mutations) {
    const fixture = archivedLauncherFixture();
    mutate(fixture.record);
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
  for (const path of ["scripts/verify-current-consumers.mjs", "scripts/verify-qualified-release.mjs", "tests/integration/s3-http-exports/verify.mjs", "tests/review/current.test.ts", "tests/integration/full-gate-20260827/preflight-repair/preflight.mjs", "tests/integration/full-gate-20260827/combined-b494675c/inspect.mjs"]) {
    const fixture = archivedLauncherFixture();
    fixture.record.members[0].path = path;
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
});

test("archived operational selectors bind the complete DRIVER map before program reads", () => {
  const mutations = [
    manifest => { manifest.files = []; },
    manifest => { delete manifest.files[archivedLauncherNames[0]]; },
    manifest => { delete manifest.files[archivedLauncherOtherNames[0]]; },
    manifest => { manifest.files[archivedLauncherNames[0]] = "0".repeat(64); },
    manifest => { manifest.files[archivedLauncherNames[0]] = { sha256: "0".repeat(64) }; },
    manifest => { manifest.files["unreviewed.mjs"] = "0".repeat(64); },
    manifest => { manifest.files[archivedLauncherNames[0].toUpperCase()] = manifest.files[archivedLauncherNames[0]]; },
    manifest => { manifest.files["../current.mjs"] = "0".repeat(64); },
    manifest => { manifest.schema = 2; },
    manifest => { manifest.candidate = "HEAD"; },
    manifest => { manifest.wholeGateLaunched = true; },
  ];
  for (const mutate of mutations) {
    const fixture = archivedLauncherFixture();
    mutate(fixture.manifest);
    fixture.saveManifest();
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, ["/package/" + fixture.ownerPath]);
  }
});

test("archived operational admission refuses held aliases and nonliteral metadata before content reads", () => {
  for (const path of ["tests/commands/xan-author-20260828/input.mjs", "tests/commands/XAN-author-20260828/input.mjs", "tests/commands", "tests/review/../input.mjs", "tests/review/*.mjs", "tests/review/@(live|archive).mjs"]) for (const target of ["owner", "member"]) {
    const fixture = archivedLauncherFixture();
    if (target === "owner") { fixture.record.owners[0].path = path; fixture.record.proof.owner = path; }
    else fixture.record.members[0].path = path;
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
  const fixture = archivedLauncherFixture();
  const current = lintFixture();
  current.inventory.records[0].owners.push({ ...fixture.record.members[0] });
  fixture.inventory.records.push(current.inventory.records[0]);
  for (const [path, bytes] of current.files) fixture.files.set(path, bytes);
  assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
  assert.deepEqual(fixture.reads, []);
});

test("archived operational admission rejects metadata aliases ancestors symlinks special files and oversized inputs", () => {
  for (const target of ["owner", "member"]) for (const kind of ["alias", "ancestor", "symlink", "special", "oversize"]) {
    const fixture = archivedLauncherFixture();
    const selected = "/package/" + (target === "owner" ? fixture.ownerPath : fixture.record.members[0].path);
    const parent = posix.dirname(selected);
    const memory = fixture.fileSystem;
    const denied = kind === "ancestor" ? parent : selected;
    const fileSystem = {
      ...memory,
      readdirSync(path) { return kind === "alias" && path === parent ? memory.readdirSync(path).map(name => name === posix.basename(selected) ? name.toUpperCase() : name) : memory.readdirSync(path); },
      lstatSync(path) {
        if (path !== denied || kind === "alias") return memory.lstatSync(path);
        if (kind === "oversize") return { ...memory.lstatSync(path), size: 65 * 1024 * 1024 };
        return { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => kind === "ancestor" || kind === "symlink", size: 0 };
      },
    };
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fileSystem));
    assert.ok(!fixture.reads.includes(selected));
  }
});

test("archived operational bindings reject independent size and hash drift while retaining new neighbors", () => {
  for (const target of ["owner", "member"]) for (const resize of [false, true]) {
    const fixture = archivedLauncherFixture();
    const selected = "/package/" + (target === "owner" ? fixture.ownerPath : fixture.record.members[0].path);
    const previous = fixture.files.get(selected);
    fixture.files.set(selected, resize ? Buffer.concat([previous, Buffer.from("x")]) : Buffer.alloc(previous.length, 120));
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    if (resize) assert.ok(!fixture.reads.includes(selected));
  }
  const fixture = archivedLauncherFixture();
  const neighbor = fixture.base + "/new-current.mjs";
  fixture.files.set("/package/" + neighbor, Buffer.from("undeclaredCurrentFailure();"));
  const result = verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem);
  assert.ok(!result.files.includes(neighbor));
  assert.ok(!fixture.reads.includes("/package/" + neighbor));
});

function executableFixture() {
  const fixture = lintFixture();
  const record = fixture.inventory.records[0];
  record.role = "controlled-executable-fixture";
  const copy = { ...record.members[0], path: `${fixture.capture}/staged.mjs` };
  fixture.files.set(`/package/${copy.path}`, fixture.files.get(`/package/${fixture.memberPath}`));
  record.members.push(copy);
  const driver = "tests/review/driver.mjs";
  const driverBytes = Buffer.from("readFileSync('./sealed/copied.mjs'); assert.equal(actual, expected);");
  fixture.files.set(`/package/${driver}`, driverBytes);
  record.owners.push({ path: driver, bytes: driverBytes.length, sha256: createHash("sha256").update(driverBytes).digest("hex") });
  record.proof.selector = ["/files/0", "/files/1"];
  record.proof.relation = "Reviewed finite executable subjects and exact staged copies; not a producer, driver, validator or historical pass.";
  const manifest = { files: record.members.map(member => ({ ...member, path: member.path.slice(fixture.capture.length + 1) })) };
  function saveManifest() {
    const bytes = Buffer.from(JSON.stringify(manifest));
    fixture.files.set(`/package/${fixture.ownerPath}`, bytes);
    Object.assign(record.owners[0], { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  saveManifest();
  return { ...fixture, record, manifest, saveManifest, driver };
}

test("controlled executable fixtures retain distinct paths with identical hashes and keep drivers linted", () => {
  const fixture = executableFixture();
  const result = verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem);
  assert.equal(new Set(fixture.record.members.map(member => member.sha256)).size, 1);
  assert.deepEqual(result.files, fixture.record.members.map(member => member.path));
  assert.equal(result.records[0].role, "controlled-executable-fixture");
  for (const path of [fixture.driver, fixture.ownerPath, "tests/review/current.mjs"]) assert.ok(!result.files.includes(path));
  assert.equal(fixture.reads.length, 4);
});

test("controlled executable fixture schema refuses malformed selectors before content reads", () => {
  const mutations = [
    record => { record.role = "positive-data"; },
    record => { record.role = "generated-negative"; },
    record => { record.extra = true; },
    record => { record.proof.extra = true; },
    record => { delete record.codeDirectory; },
    record => { record.proof.owner = "tests/review/unbound.json"; },
    record => { record.proof.owner = "tests/review/driver.mjs"; },
    record => { record.members[1].path = record.members[0].path; },
    record => { record.proof.selector = "/files/0"; },
    record => { record.proof.selector = []; },
    record => { record.proof.selector = ["/files/0"]; },
    record => { record.proof.selector = ["/files/0", "/files/0"]; },
    ...["/files/01", "/files/-1", "/files/1e0", "/files/1.0", "/files/Infinity", "/files/9007199254740992", "/files/0/path", "/other/0"].map(selector => record => { record.proof.selector[0] = selector; }),
    record => { record.proof.pathBase = "tests/review/@(current|frozen)"; },
    record => { record.symlinks = [{ path: "tests/review/sealed/link.mjs", target: "outside" }]; },
  ];
  for (const mutate of mutations) {
    const fixture = executableFixture();
    mutate(fixture.record);
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
  assert.equal(mutations.length, 22);
});

test("controlled executable fixtures bind exact owner rows and reject relocation before subject reads", () => {
  const mutations = [
    fixture => { fixture.record.proof.selector.reverse(); },
    fixture => { fixture.record.proof.selector[0] = "/files/99"; },
    fixture => { fixture.manifest.files = {}; },
    fixture => { fixture.manifest.files[0] = null; },
    fixture => { fixture.manifest.files[0].bytes++; },
    fixture => { fixture.manifest.files[0].sha256 = "0".repeat(64); },
    fixture => { fixture.manifest.files[0].path = "COPIED.mjs"; },
    fixture => { fixture.manifest.files[0].path = "../sealed/copied.mjs"; },
    fixture => { fixture.manifest.files[0].path = "@(copied|current).mjs"; },
    ...["src/commands/xan/argv.ts", "src/commands/XAN/argv.ts"].map(path => fixture => {
      fixture.record.proof.pathBase = ".";
      fixture.manifest.files[0].path = path;
    }),
    fixture => { fixture.record.proof.pathBase = "tests/review"; },
    fixture => {
      fixture.record.members[0].path = `${fixture.capture}/relocated.mjs`;
      fixture.files.set(`/package/${fixture.record.members[0].path}`, fixture.files.get(`/package/${fixture.memberPath}`));
    },
  ];
  for (const mutate of mutations) {
    const fixture = executableFixture();
    mutate(fixture);
    fixture.saveManifest();
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.ok(fixture.reads.every(path => fixture.record.owners.some(owner => path === `/package/${owner.path}`)));
  }
  assert.equal(mutations.length, 13);
});

test("controlled executable fixtures reject owner and subject size or hash drift", () => {
  for (const role of ["owner", "subject"]) for (const resized of [false, true]) {
    const fixture = executableFixture();
    const path = `/package/${role === "owner" ? fixture.ownerPath : fixture.memberPath}`;
    const changed = Buffer.concat([fixture.files.get(path), Buffer.alloc(Number(resized))]);
    changed[0] ^= 1;
    fixture.files.set(path, changed);
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /size|changed/);
    if (resized) assert.ok(!fixture.reads.includes(path));
  }
});

test("controlled executable fixtures refuse held paths and aliases before owner or subject content reads", () => {
  let denials = 0;
  for (const role of ["owner", "subject"]) for (const path of ["src/commands/xan/argv.ts", "src/commands/XAN/argv.ts", "tests/commands/xan-author-20260828/input.mjs", "tests/commands/XAN-author-20260828/input.mjs"]) {
    const fixture = executableFixture();
    const binding = role === "owner" ? fixture.record.owners[0] : fixture.record.members[0];
    binding.path = path;
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
    denials++;
  }
  assert.equal(denials, 8);
});

test("controlled executable fixture admission refuses aliases, symlinks, ancestors and special files before payload reads", () => {
  let denials = 0;
  for (const role of ["owner", "subject"]) for (const kind of ["alias", "symlink", "ancestor", "special"]) {
    const fixture = executableFixture();
    const binding = role === "owner" ? fixture.record.owners[0] : fixture.record.members[0];
    const originalPath = binding.path;
    if (kind === "alias") {
      binding.path = originalPath.replace("review", "REVIEW");
      if (role === "owner") fixture.record.proof.owner = binding.path;
    }
    if (kind === "symlink") fixture.links.set(`/package/${originalPath}`, "/held/never-follow");
    if (kind === "ancestor") fixture.links.set("/package/tests/review", "/held/never-follow");
    if (kind === "special") {
      const original = fixture.fileSystem.lstatSync;
      fixture.fileSystem.lstatSync = path => path === `/package/${originalPath}` ? { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false } : original(path);
    }
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.ok(!fixture.reads.includes(`/package/${originalPath}`));
    assert.ok(fixture.reads.every(path => fixture.record.owners.some(owner => path === `/package/${owner.path}`)));
    denials++;
  }
  assert.equal(denials, 8);
});

test("controlled executable fixture census refuses new code and held descendants without content reads", () => {
  for (const kind of ["code", "held", "alias", "symlink"]) {
    const fixture = executableFixture();
    const boundaries = structuredClone(boundary);
    const path = `${fixture.capture}/${kind === "alias" ? "HELD" : kind === "held" ? "held" : "new"}/input.mjs`;
    boundaries.heldEvidenceDirectories.push(`${fixture.capture}/held`);
    fixture.files.set(`/package/${path}`, Buffer.from("must never be read"));
    if (kind === "symlink") fixture.links.set(`/package/${path}`, "/held/never-follow");
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundaries, fixture.fileSystem));
    assert.ok(fixture.reads.every(path => fixture.record.owners.some(owner => path === `/package/${owner.path}`)));
  }
});

test("controlled executable fixtures cannot exclude their retained producer driver or validator", () => {
  for (const role of ["producer", "driver", "validator"]) {
    const fixture = executableFixture();
    const path = `${fixture.capture}/${role}.mjs`;
    const bytes = Buffer.from("throw new Error('maintained implementation');");
    const binding = { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    fixture.files.set(`/package/${path}`, bytes);
    fixture.record.owners.push(binding);
    fixture.record.members.push(binding);
    fixture.record.proof.selector.push("/files/2");
    fixture.manifest.files.push({ ...binding, path: `${role}.mjs` });
    fixture.saveManifest();
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /producer|owner/);
    assert.deepEqual(fixture.reads, []);
  }
});

test("lint inventory authenticates literal captures without excluding a live neighboring input", () => {
  const fixture = lintFixture();
  const result = verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem);
  assert.deepEqual(result.files, [fixture.memberPath]);
  assert.deepEqual(result.records[0].proof, fixture.inventory.records[0].proof);
  assert.deepEqual(fixture.reads, [`/package/${fixture.ownerPath}`, `/package/${fixture.memberPath}`]);
  assert.ok(!result.files.includes("tests/review/current.mjs"));
  assert.ok(result.files.every(path => !path.includes("*")));
});

test("lint inventory permits independently sealed historical provenance, not self-excluded producers", () => {
  const fixture = lintFixture();
  const original = fixture.inventory.records[0];
  const bytes = Buffer.from("historical dependent program");
  const path = `${fixture.capture}/dependent.mjs`;
  fixture.files.set(`/package/${path}`, bytes);
  fixture.inventory.records.push({
    id: "dependent-historical-capture", role: "immutable-harness-capture",
    owners: [structuredClone(original.members[0])],
    proof: { owner: fixture.memberPath, selector: "reviewed static dependency", pathBase: fixture.capture, relation: "independently sealed historical harness, not maintained validation or successful execution" },
    members: [{ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }],
  });
  assert.deepEqual(verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem).files, [fixture.memberPath, path]);
  fixture.inventory.records[1].owners[0].sha256 = "0".repeat(64);
  fixture.reads.length = 0;
  assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /provenance.*binding/);
  assert.deepEqual(fixture.reads, []);
});

test("frozen lint inventory authenticates exact size and SHA before any owner or member reads", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const approved = readRegularInput(root, "integration-lint-inventory.json", 535875, fs, loadBoundaries(root));
  assert.equal(approved.length, 535875);
  assert.equal(createHash("sha256").update(approved).digest("hex"), "c67f5004c29e0974e166fc007e794e1ae35083a017a1c96b6e60cb79b59c6689");
  for (const resize of [false, true]) {
    const changed = Buffer.concat([approved, Buffer.alloc(Number(resize))]);
    changed[0] = 32;
    const files = new Map([["/package/integration-lint-inventory.json", changed]]);
    const memory = fileSystemFor(files);
    const reads = [];
    assert.throws(() => readIntegrationLintInputs("/package", boundary, {
      ...memory,
      readFileSync(path) { reads.push(path); return memory.readFileSync(path); },
    }), /unapproved.*lint inventory|lint inventory size/);
    assert.deepEqual(reads, resize ? [] : ["/package/integration-lint-inventory.json"]);
  }
});

test("frozen lint inventory adds only its 1804 literal exclusions and preserves current tests and consumers", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  const reads = [];
  const input = readIntegrationLintInputs(root, boundaries, {
    ...fs,
    readFileSync(path) {
      const local = relative(root, path);
      assertAdmittedInputPath(local, boundaries);
      reads.push(local);
      return fs.readFileSync(path);
    },
  });
  assert.equal(input.records.length, 70);
  assert.equal(createHash("sha256").update(JSON.stringify(input.records.slice(0, 69))).digest("hex"), "461159ff69833865729890157e3cb7dcc978478f5f211725ce1be2fffe8ec9f5");
  assert.equal(createHash("sha256").update(JSON.stringify(input.records.slice(0, 68))).digest("hex"), "fa6b3e9e830c0d72706e72179ce067efbb158ebd0076c5bcb21e457fed96a45c");
  assert.equal(createHash("sha256").update(JSON.stringify(input.records.slice(0, 63))).digest("hex"), "8dfa6ec503dcb28e11e4c8fd9d176a60e08213981ffb4992ef42eaaf95809cdf");
  assert.deepEqual(input.records.slice(63, 68).map(record => ({ id: record.id, role: record.role, path: record.members[0].path })), successorSubjects.map(subject => ({ id: subject.id, role: subject.role, path: subject.member })));
  assert.ok(input.records.slice(63, 68).every(record => record.members.length === 1 && record.codeDirectory === undefined && record.symlinks === undefined));
  const archivalBase = "tests/integration/full-gate-20260827/unified76-driver/launcher-v3";
  const archival = input.records[68];
  assert.equal(archival.id, "launcher-v3-retired-operational-tooling");
  assert.equal(archival.role, "archived-operational-tooling");
  assert.deepEqual(archival.members.map(member => member.path), archivedLauncherNames.map(name => archivalBase + "/" + name));
  assert.deepEqual(archival.proof.selector, archivedLauncherNames.map(name => "/files/" + name));
  assert.ok(archival.codeDirectory === undefined && archival.symlinks === undefined);
  for (const name of [...archivedLauncherOtherNames, "DRIVER.json"]) {
    assert.ok(!input.files.includes(archivalBase + "/" + name), "non-JS protocol and consumer fixtures must not become exclusions");
  }
  for (const path of [
    "scripts/verify-whole-gate.mjs", "scripts/verify-qualified-release.mjs", "scripts/verify-current-consumers.mjs",
    "scripts/typecheck.mjs", "scripts/typecheck-inputs.mjs", "scripts/typecheck-consumers.mjs",
    "tests/plugins/qualified-current-release/consumers.mjs", "tests/plugins/qualified-current-release/runtime-coverage.mjs",
    "tests/plugins/qualified-current-release/prerequisites.mjs", "tests/plugins/qualified-current-release/snapshot.mjs",
    "tests/plugins/stream-five-public/verify-public.mjs", "tests/plugins/stream-five-public/harness.mjs", "tests/plugins/stream-five-public/public-checks.mjs",
    "tests/integration/s3-http-exports/exports.test.ts", "tests/integration/s3-http-exports/verify.mjs", "tests/integration/s3-http-exports/committed-archive.mjs",
    "tests/integration/full-gate-20260827/preflight-repair/preflight.mjs", "tests/integration/full-gate-20260827/combined-b494675c/inspect.mjs",
  ]) assert.ok(!input.files.includes(path), `current selector or outward dependency must remain admitted: ${path}`);
  const retiredProvenance = [
    "tests/comparison/breadth-continuation-20260828/executor-v7/test-worker.mjs",
    "tests/compatibility/bash-conditional-author-20260829/run-v5.mjs",
    "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/seal-v2.mjs",
    "tests/stress/regex-execution/production-review/freeze.mjs"
  ];
  for (const subject of successorSubjects) for (const owner of subject.owners) assert.equal(input.files.includes(owner), retiredProvenance.includes(owner), `exact named historical provenance transition: ${owner}`);
  for (const path of [
    "tests/compatibility/bash-function-keyword-author-20260829/k08-harness-v3/controls.mjs",
    "tests/integration/full-gate-20260827/unified76-driver-independent/r3-repair-v20/review.mjs",
  ]) assert.ok(input.files.includes(path), `named retired parser failure remains historical, not repaired: ${path}`);
  assert.ok(!input.files.includes("src/commands/regex-execution/client.ts"));
  assert.equal(createHash("sha256").update(JSON.stringify(input.records.slice(0, 55))).digest("hex"), "7dd1e5befafb5ee874b27366c1db288a52e38a649470d7085cb5f85e4833863b");
  const subjects = input.records.filter(record => record.role === "controlled-executable-fixture");
  assert.equal(subjects.length, 8);
  assert.equal(new Set(subjects.flatMap(record => record.members.map(member => member.sha256))).size, 9);
  assert.deepEqual(subjects.flatMap(record => record.members.map(member => member.path)).sort(), [
    "tests/comparison/breadth-continuation-20260828/executor-preparation-v1/fixtures/expected.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-preparation-v1/fixtures/forbidden-source.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-preparation-v1/fixtures/wrong.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/load-01/synthetic-view/loaded.cjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/load-01/synthetic-view/loaded.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/load-01/synthetic-view/require-consumer.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/repair-01/synthetic-view/loaded.cjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/repair-01/synthetic-view/loaded.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/repair-01/synthetic-view/require-consumer.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/synthetic-01/synthetic-view/loaded.cjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/synthetic-01/synthetic-view/loaded.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/runs/synthetic-01/synthetic-view/require-consumer.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/fixtures/actual-effects.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/fixtures/noop.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/fixtures/wrong-status.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/runs/focused-01/focused-view/actual-effects.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/runs/focused-01/focused-view/noop.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/runs/focused-01/focused-view/wrong-status.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/runs/focused-01/persistence-negative/focused-view/actual-effects.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/runs/focused-01/persistence-negative/focused-view/noop.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/runs/focused-01/persistence-negative/focused-view/wrong-status.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v7/fixtures/bootstrap-stub.mjs"
  ]);
  const retained = [
    "tests/comparison/breadth-continuation-20260828/executor-v3/fixtures/forbidden.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/fixtures/loaded.cjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/fixtures/loaded.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/fixtures/require-consumer.mjs",
    "tests/integration/full-gate-20260827/loader-null-source-review/diagnose.mjs",
    "tests/integration/full-gate-20260827/loader-null-source-review/verify.mjs",
    "tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/run.mjs",
    "tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/verify.mjs",
    "tests/integration/full-gate-20260827/runtime-profile-independent-20260827/run.mjs",
    "tests/integration/full-gate-20260827/runtime-profile-independent-20260827/verify.mjs",
    "tests/integration/full-gate-20260827/cold-typecheck-independent/check.mjs",
    "tests/integration/full-gate-20260827/cold-typecheck-independent/finalize.mjs",
    "tests/integration/full-gate-20260827/cold-typecheck-independent/public-control.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-preparation-v1/controls.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-preparation-v1/synthetic-child.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/controls.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/loader.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/projection.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v3/synthetic-worker.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/focused.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/loaded-outcome.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v4/synthetic-worker.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v7/body-driver.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v7/bootstrap.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v7/loader.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v7/synthetic.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v7/test-worker.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-preparation-v1/observe-load.mjs"
  ];
  const retiredPreviousControls = [
    "tests/integration/full-gate-20260827/loader-null-source-review/diagnose.mjs",
    "tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/run.mjs",
    "tests/integration/full-gate-20260827/runtime-profile-independent-20260827/run.mjs",
    "tests/comparison/breadth-continuation-20260828/executor-v7/test-worker.mjs"
  ];
  for (const path of retained) assert.equal(input.files.includes(path), retiredPreviousControls.includes(path), `only the exact named retirement may change prior admission: ${path}`);
  assert.equal(input.records.flatMap(record => record.members).length, 1802);
  assert.equal(new Set(input.records.flatMap(record => record.owners.map(owner => owner.path))).size, 103);
  assert.equal(input.records.filter(record => record.codeDirectory !== undefined).length, 23);
  const symlinks = input.records.flatMap(record => record.symlinks ?? []);
  assert.equal(symlinks.length, 2);
  assert.equal(input.files.length, 1804);
  assert.equal(new Set(input.files).size, 1804);
  assert.equal(reads.length, 1 + 103 + 1802);
  for (const link of symlinks) assert.ok(!reads.includes(link.path));
  const { consumerGroups, currentConsumerPaths, currentSourceConsumerGroups, negativeGroups } = await import("../tests/plugins/qualified-current-release/consumers.mjs");
  const tests = discoverTests(root, boundaries);
  assertSource7Discovery(tests);
  assert.ok(tests.includes("tests/plugins/git-removal.test.ts"));
  assert.equal(currentConsumerPaths().length, 37);
  assert.ok(currentConsumerPaths().includes("tests/plugins/qualified-current-release/current-shell-parse-limits.mts"));
  assert.equal(negativeGroups.length, 3);
  const protectedPaths = [
    ...tests,
    ...currentConsumerPaths(),
    ...currentSourceConsumerGroups.flatMap(group => group.files),
    ...negativeGroups.map(group => group.path),
    ...consumerGroups.flatMap(group => group.runtime.map(path => posix.join(posix.dirname(group.files[0]), path))),
    "scripts/test.mjs", "scripts/integration-inputs.mjs", "scripts/typecheck-consumers.mjs",
    "tests/source-census.ts", "tests/shell-stress/helpers.ts",
    "tests/shell-stress/invocation-cleanup-runtime/migration/binding.ts",
  ];
  for (const path of protectedPaths) assert.ok(!input.files.includes(path), `current input must remain linted: ${path}`);
  assert.ok(input.files.every(path => !path.startsWith("src/")));
  const prototype = "tests/stress/regex-execution/design/client.ts";
  const compiler = JSON.parse(readRegularInput(root, "tsconfig.json", 65536, fs, boundaries));
  assert.ok(compiler.include.includes("tests/**/*.ts"));
  for (const excluded of [...compiler.exclude, ...integrationExclusions(boundaries), ...readIntegrationTypeInputs(root, boundaries).entries.map(entry => entry.path)]) {
    assert.ok(prototype !== excluded && !prototype.startsWith(excluded + "/"), "prototype must remain an ordinary compiler input");
  }
  const exclusions = lintExclusions(root, boundaries);
  for (const path of input.files) assert.ok(exclusions.files.includes(path), `missing literal lint exclusion: ${path}`);
  for (const record of input.records) if (record.codeDirectory) assert.ok(!exclusions.directories.includes(record.codeDirectory), "code census must not become a directory glob");
});

test("lint inventory rejects malformed or held metadata before reading selected bytes", () => {
  const mutations = [
    data => { data.extra = true; },
    data => { data.version = 2; },
    data => { data.records[0].extra = true; },
    data => { data.records[0].role = "current"; },
    data => { data.records[0].owners[0].extra = true; },
    data => { data.records[0].members[0].extra = true; },
    data => { data.records[0].proof.extra = true; },
    data => { data.records[0].proof.owner = "tests/other/owner.json"; },
    data => { data.records[0].owners = []; },
    data => { data.records[0].members = []; },
    data => { data.records[0].members[0].bytes = -1; },
    data => { data.records[0].members[0].sha256 = "unbound"; },
    data => { data.records[0].members = [{ path: "tests/review/sealed/link", target: "outside" }]; data.records[0].role = "generated-negative"; },
    data => { data.records[0].symlinks = [structuredClone(data.records[0].members[0])]; data.records[0].members[0].path = "tests/review/sealed/other.mjs"; },
    data => { data.records[0].members[0].path = "tests/review/current.mjs"; },
    data => { data.records[0].proof.pathBase = "../escape"; },
    data => { data.records[0].symlinks = [{ path: "tests/review/sealed/link", target: "outside", extra: true }]; },
  ];
  for (const field of ["owner", "member", "directory", "base", "symlink"]) {
    for (const path of ["tests/commands/xan-author-20260828/held.mjs", "src/commands/xan/argv.ts", "tests/review/@(current|frozen).mjs", "tests/review/../outside.mjs", "tests/review/*.mjs", "/outside.mjs", "tests\\escape.mjs"]) {
      mutations.push(data => {
        const record = data.records[0];
        if (field === "owner") record.owners[0].path = path;
        if (field === "member") record.members[0].path = path;
        if (field === "directory") record.codeDirectory = path;
        if (field === "base") record.proof.pathBase = path;
        if (field === "symlink") record.symlinks = [{ path, target: "../../outside" }];
      });
    }
  }
  for (const mutate of mutations) {
    const fixture = lintFixture();
    mutate(fixture.inventory);
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
});

test("lint inventory rejects duplicate records, owners, members and case aliases", () => {
  for (const mutate of [
    data => { data.records.push(structuredClone(data.records[0])); },
    data => { data.records[0].owners.push(structuredClone(data.records[0].owners[0])); },
    data => { data.records[0].members.push(structuredClone(data.records[0].members[0])); },
    data => { const member = structuredClone(data.records[0].members[0]); member.path = member.path.replace("copied", "COPIED"); data.records[0].members.push(member); },
  ]) {
    const fixture = lintFixture();
    mutate(fixture.inventory);
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /duplicate|alias/);
    assert.deepEqual(fixture.reads, []);
  }
});

test("lint inventory rejects size and hash tampering and owner ancestry before payload reads", () => {
  for (const field of ["ownerPath", "memberPath"]) {
    for (const resize of [false, true]) {
      const fixture = lintFixture();
      const path = `/package/${fixture[field]}`;
      const bytes = fixture.files.get(path);
      fixture.files.set(path, Buffer.alloc(bytes.length + Number(resize), "X"));
      assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /size|changed/);
      if (resize) assert.ok(!fixture.reads.includes(path));
      if (field === "ownerPath") assert.ok(!fixture.reads.includes(`/package/${fixture.memberPath}`));
    }
  }
  const fixture = lintFixture();
  fixture.links.set("/package/tests/review", "/held");
  assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /directory/);
  assert.deepEqual(fixture.reads, []);
});

test("lint inventory census rejects new unbound code without reading or broadly excluding it", () => {
  const fixture = lintFixture();
  const neighbor = `/package/${fixture.capture}/new-current.mjs`;
  fixture.files.set(neighbor, Buffer.from("throw new Error('real failure');"));
  assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /unbound|census/);
  assert.ok(!fixture.reads.includes(neighbor));
});

test("lint inventory treats declared negative symlink targets as metadata and never follows them", () => {
  const fixture = lintFixture();
  const path = `${fixture.capture}/escape.mjs`;
  const target = "../../../../src/commands/xan/@(arbitrary|held).mjs";
  fixture.inventory.records[0].role = "generated-negative";
  fixture.inventory.records[0].symlinks = [{ path, target }];
  fixture.files.set(`/package/${path}`, Buffer.alloc(0));
  fixture.links.set(`/package/${path}`, target);
  const operations = [];
  const fileSystem = { ...fixture.fileSystem };
  for (const method of ["readdirSync", "lstatSync", "readFileSync", "readlinkSync"]) fileSystem[method] = candidate => {
    operations.push({ method, path: candidate });
    return fixture.fileSystem[method](candidate);
  };
  const result = verifyLintInventory("/package", fixture.inventory, boundary, fileSystem);
  assert.deepEqual(result.files, [fixture.memberPath, path]);
  assert.ok(!fixture.reads.includes("/package/" + path));
  assert.ok(fixture.reads.includes("/package/" + fixture.memberPath));
  assert.deepEqual(operations.filter(operation => operation.method === "readlinkSync"), [{ method: "readlinkSync", path: "/package/" + path }]);
  assert.deepEqual(operations.filter(operation => operation.path.startsWith("/package/" + path + "/") || operation.path === "/package/" + path && ["readdirSync", "readFileSync"].includes(operation.method)), []);
  fixture.links.set(`/package/${path}`, "different-target");
  assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /target/);
  delete fixture.inventory.records[0].symlinks;
  assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /unbound|symlink/);
});


for (const kind of ["symlink", "regular member"]) test("lint inventory admits declared leaf kind before any replacement-directory descent: " + kind, () => {
  for (const sentinel of [true, false]) {
    const fixture = lintFixture();
    const path = kind === "symlink" ? fixture.capture + "/escape.mjs" : fixture.memberPath;
    const absolute = "/package/" + path;
    if (kind === "symlink") {
      fixture.inventory.records[0].role = "generated-negative";
      fixture.inventory.records[0].symlinks = [{ path, target: "matching.mjs" }];
    } else fixture.files.delete(absolute);
    fixture.files.set(absolute + "/nested/inert.data", Buffer.from("UNREAD"));
    const operations = [];
    const fileSystem = { ...fixture.fileSystem };
    for (const method of ["readdirSync", "lstatSync", "readFileSync", "readlinkSync"]) fileSystem[method] = candidate => {
      operations.push({ method, path: candidate });
      if (sentinel && method === "readdirSync" && candidate === absolute) throw new Error("replacement enumeration sentinel reached");
      return fixture.fileSystem[method](candidate);
    };
    let failure;
    try {
      verifyLintInventory("/package", fixture.inventory, boundary, fileSystem);
    } catch (error) {
      failure = error;
    }
    assert.deepEqual(operations.filter(operation => operation.path.startsWith(absolute + "/") || operation.path === absolute && operation.method !== "lstatSync"), [], "declared leaf replacement must have zero enumeration, descendant metadata, readlink or payload access");
    assert.ok(failure instanceof assert.AssertionError);
    assert.match(failure.message, kind === "symlink" ? /must remain a symlink/ : /must remain a regular file/);
    assert.equal(operations.filter(operation => operation.method === "lstatSync" && operation.path === absolute).length, 1);
    assert.ok(fixture.reads.includes("/package/" + fixture.ownerPath), "authenticated provenance reads remain separately accounted");
    assert.ok(!fixture.reads.some(candidate => candidate === absolute || candidate.startsWith(absolute + "/")));
  }
});


test("lint inventory admits declared leaf kind before a descendant provenance read", () => {
  for (const kind of ["symlink", "regular member"]) {
    const fixture = lintFixture();
    const path = kind === "symlink" ? fixture.capture + "/escape.mjs" : fixture.memberPath;
    const absolute = "/package/" + path;
    if (kind === "symlink") {
      fixture.inventory.records[0].role = "generated-negative";
      fixture.inventory.records[0].symlinks = [{ path, target: "matching.mjs" }];
    } else fixture.files.delete(absolute);
    const ownerPath = path + "/owner.json";
    const bytes = Buffer.from("{}");
    fixture.files.set("/package/" + ownerPath, bytes);
    fixture.inventory.records[0].owners = [{ path: ownerPath, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
    fixture.inventory.records[0].proof.owner = ownerPath;
    const operations = [];
    const fileSystem = { ...fixture.fileSystem };
    for (const method of ["readdirSync", "lstatSync", "readFileSync", "readlinkSync"]) fileSystem[method] = candidate => {
      operations.push({ method, path: candidate });
      return fixture.fileSystem[method](candidate);
    };
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fileSystem), kind === "symlink" ? /must remain a symlink/ : /must remain a regular file/);
    assert.deepEqual(operations.filter(operation => operation.path.startsWith(absolute + "/") || operation.path === absolute && operation.method !== "lstatSync"), []);
    assert.deepEqual(fixture.reads, []);
  }
});

test("lint inventory admits generated-negative inputs while keeping their maintained producer and validator linted", () => {
  const fixture = lintFixture();
  const record = fixture.inventory.records[0];
  record.role = "generated-negative";
  record.owners = ["producer", "validator"].map(name => {
    const path = `tests/review/${name}.mjs`;
    const bytes = Buffer.from(`readFileSync('./sealed/copied.mjs'); export const role = '${name}';`);
    fixture.files.set(`/package/${path}`, bytes);
    return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  record.proof.owner = record.owners[0].path;
  record.proof.selector = "explicit generated syntax-negative input";
  const negative = Buffer.from("export const = deliberate syntax error;");
  fixture.files.set(`/package/${fixture.memberPath}`, negative);
  record.members[0] = { path: fixture.memberPath, bytes: negative.length, sha256: createHash("sha256").update(negative).digest("hex") };
  const result = verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem);
  assert.deepEqual(result.files, [fixture.memberPath]);
  for (const owner of record.owners) assert.ok(!result.files.includes(owner.path));
  delete record.codeDirectory;
  record.proof.pathBase = "tests/review";
  record.members.push(record.owners[0]);
  fixture.reads.length = 0;
  assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundary, fixture.fileSystem), /producer|owner/);
  assert.deepEqual(fixture.reads, []);
});

test("lint inventory rejects held census descendants, aliases and special members without reading them", () => {
  for (const kind of ["held", "alias", "special", "ancestor"]) {
    const fixture = lintFixture();
    const boundaries = structuredClone(boundary);
    if (kind === "held") {
      boundaries.heldEvidenceDirectories.push(`${fixture.capture}/held`);
      fixture.files.set(`/package/${fixture.capture}/held/input.mjs`, Buffer.from("must not be read"));
    }
    if (kind === "alias") {
      const entry = fixture.inventory.records[0].members[0];
      entry.path = entry.path.replace("copied", "COPIED");
    }
    if (kind === "special") {
      const original = fixture.fileSystem.lstatSync;
      fixture.fileSystem.lstatSync = path => path === `/package/${fixture.memberPath}` ? { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => false } : original(path);
    }
    if (kind === "ancestor") fixture.links.set(`/package/${fixture.capture}`, "/outside");
    assert.throws(() => verifyLintInventory("/package", fixture.inventory, boundaries, fixture.fileSystem));
    assert.ok(fixture.reads.every(path => path === `/package/${fixture.ownerPath}`));
  }
});

test("boundary paths reject globs, traversal, and whole source or test trees", () => {
  for (const path of ["src/**", "../outside.ts", "/src/file.ts", "src/../file.ts", "src/commands", "src\\file.ts"]) {
    assert.throws(() => validateBoundaries({ ...boundary, heldSourceFiles: [path] }));
  }
  assert.throws(() => validateBoundaries({ ...boundary, heldEvidenceDirectories: ["tests"] }));
  assert.throws(() => validateBoundaries({ ...boundary, fixtureDirectories: [{ ...fixture, sha256: "unbound" }] }));
});

test("fixture owners authenticate before exclusion without reading held content", () => {
  const files = new Map([
    ["/package/integration-boundaries.json", Buffer.from(JSON.stringify(boundary))],
    ["/package/tests/review/produce.mjs", Buffer.from(owner)],
  ]);
  const fileSystem = fileSystemFor(files);
  assert.deepEqual(loadBoundaries("/package", fileSystem), boundary);
  files.set("/package/tests/review/produce.mjs", Buffer.from("changed owner"));
  assert.throws(() => loadBoundaries("/package", fileSystem), /owner/);
});

test("discovery preserves YQ and neighboring failures while pruning explicit data roots", () => {
  const native = "tests/commands/regex-execution/continuation/artifacts/native";
  const candidates = [
    "tests/commands/yq-author-20260828/yq.test.ts",
    "tests/commands/yq-author-20260828/repair-allocation-v1/repair.test.ts",
    "tests/canonical/failing.test.ts",
    "tests/review/run/source-neighbor/failing.test.ts",
    `${native}-neighbor/failing.test.ts`,
    "tests/other/artifacts/native/failing.test.ts",
    "tests/review/run/source/tests/copied.test.ts",
    "tests/commands/xan-author-20260828/held.test.ts",
    `${native}/payload.test.ts`,
  ];
  const fileSystem = {
    globSync(pattern, options) {
      assert.equal(pattern, "tests/**/*.test.ts");
      assert.equal(options.cwd, "/package");
      return candidates.filter(path => !options.exclude(path));
    },
  };
  assert.deepEqual(discoverTests("/package", boundary, fileSystem), candidates.slice(0, 6).sort());
});

test("empty discovery fails rather than reporting a green suite", () => {
  assert.throws(() => discoverTests("/package", boundary, { globSync: () => [] }), /No test files/);
});

test("integration exclusions retain exact files and directory boundaries", () => {
  assert.deepEqual(integrationExclusions(boundary), [
    "src/commands/xan/argv.ts",
    "tests/commands/xan-author-20260828",
    "tests/review/run/source",
  ]);
});

test("lint admission reads only classification metadata and retains current inputs", () => {
  const directory = new URL("../tests/plugins/qualified-current-release/", import.meta.url);
  const captured = JSON.parse(readFileSync(new URL("captured-types.json", directory)));
  const staged = JSON.parse(readFileSync(new URL("staged-types.json", directory)));
  const inventory = JSON.parse(readFileSync(new URL("inventory.json", directory)));
  const paths = lintInventoryPaths(captured, staged, inventory);
  const typeInputs = JSON.parse(readFileSync(new URL("../integration-type-inputs.json", import.meta.url)));
  const source7Additions = typeInputs.cohorts.flatMap(cohort => cohort.entries).filter(entry => entry.path.endsWith(".mts")).map(entry => entry.path);
  assert.equal(source7Additions.length, 13);
  assert.equal(new Set(source7Additions).size, 13);
  const previousInventory = { ...inventory, entries: inventory.entries.filter(entry => !source7Additions.includes(entry.path)) };
  const previousPaths = lintInventoryPaths(captured, staged, previousInventory);
  assert.equal(previousPaths.length, 173);
  assert.equal(createHash("sha256").update(JSON.stringify(previousPaths)).digest("hex"), "0788349f778770ff6f85ec24a8de74b60251a15f26f5e0ac9f36510e44e6a4a1");
  assert.deepEqual(paths.filter(path => !previousPaths.includes(path)).sort(), [...source7Additions].sort());
  assert.deepEqual([...paths].sort(), [...previousPaths, ...source7Additions].sort());
  assert.equal(paths.length, 173 + source7Additions.length);
  assert.ok(inventory.entries.filter(entry => entry.classification === "current").every(entry => !paths.includes(entry.path)));
  for (const path of ["tests/**", "../outside.ts", "tests/a/../escape.ts", "tests/unowned/capture.ts", null]) {
    assert.throws(() => lintInventoryPaths({ ...captured, entries: [{ ...captured.entries[0], path }] }, staged, inventory));
  }
  assert.throws(() => lintInventoryPaths(captured, { ...staged, entries: [{ ...staged.entries[0], path: "tests/elsewhere/input.ts" }] }, inventory));
  assert.throws(() => lintInventoryPaths(captured, staged, { ...inventory, entries: [{ ...inventory.entries[0], path: "tests/**" }] }));
  assert.throws(() => lintInventoryPaths(captured, staged, { ...inventory, entries: [{ ...inventory.entries[0], classification: "current-but-ignore" }] }));
  for (const operator of ["@", "+", "!", "?", "*"]) {
    const path = `tests/review/${operator}(current|frozen).mts`;
    assert.throws(() => lintInventoryPaths(captured, staged, { ...inventory, entries: [{ ...inventory.entries[0], path }] }), /literal/);
    assert.throws(() => validateBoundaries({ ...boundary, fixtureDirectories: [{ ...fixture, path: `tests/review/${operator}(current|frozen)` }] }), /literal/);
  }
  const prefix = "/package/tests/plugins/qualified-current-release/";
  const files = new Map([
    [prefix + "captured-types.json", Buffer.from(JSON.stringify({ ...captured, entries: [{ ...captured.entries[0], path: "tests/**" }] }))],
  ]);
  assert.throws(() => lintExclusions("/package", boundary, fileSystemFor(files)), /unapproved.*inventory/);
});

function assertWholeGateRetired(source, args = []) {
  assert.doesNotMatch(source, /\bimport\b/u, "retired entrypoint must not import legacy or builtin modules");
  const diagnostics = [];
  const effects = [];
  const denied = name => () => { effects.push(name); throw new Error(`unexpected retired entrypoint activity: ${name}`); };
  const state = { argv: ["node", "scripts/verify-whole-gate.mjs", ...args], exitCode: 0 };
  const process = new Proxy(state, {
    get(target, key) {
      if (Object.hasOwn(target, key)) return target[key];
      return denied(`process.${String(key)}`)();
    },
    set(target, key, value) {
      if (key !== "exitCode") return denied(`process.${String(key)} assignment`)();
      target.exitCode = value;
      return true;
    },
  });
  new Script(source, { filename: "scripts/verify-whole-gate.mjs" }).runInNewContext({
    console: { error: message => diagnostics.push(message), log: denied("stdout") }, process,
    require: denied("require"), fetch: denied("fetch"),
    setTimeout: denied("setTimeout"), setInterval: denied("setInterval"), setImmediate: denied("setImmediate"),
  }, { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } });
  assert.equal(state.exitCode, 78);
  assert.deepEqual(effects, []);
  assert.equal(diagnostics.length, 1);
  return diagnostics[0];
}

test("retired whole-gate alias refuses all arguments before legacy activity", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = readRegularInput(root, "scripts/verify-whole-gate.mjs", 4096).toString();
  const metadata = JSON.parse(readRegularInput(root, "package.json", 65536));
  assert.equal(metadata.scripts["verify:release:whole"], "node scripts/verify-whole-gate.mjs");
  for (const args of [
    [], ["--help"], ["--force"],
    ["--handoff", "b494675c34dc289f4ad4b10a9201e1211eb0a7d8", "--preflight-only"],
    ["--handoff", "b494675c34dc289f4ad4b10a9201e1211eb0a7d8", "--execute", "/must-not-create"],
    ["--handoff", "f5e9fc49b6abb38e180cc9de16c95fced102ff75", "--execute", "/must-not-create"],
    ["--handoff", "HEAD", "--preflight-only"],
  ]) assertWholeGateRetired(source, args);
});

test("retired whole-gate diagnostic names current routes without claiming validation", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = readRegularInput(root, "scripts/verify-whole-gate.mjs", 4096).toString();
  const message = assertWholeGateRetired(source);
  assert.match(message, /verify:release:whole is retired/u);
  assert.match(message, /no validation was run/u);
  for (const route of ["npm run build", "npm run test:unit", "npm run typecheck", "committed-archive validation", "README.md#current-imported-feature-validation"]) assert.ok(message.includes(route), route);
});

test("retired whole-gate controls reject success and external-effect regressions", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const source = readRegularInput(root, "scripts/verify-whole-gate.mjs", 4096).toString();
  assertWholeGateRetired(source);
  const success = source.replace("process.exitCode = 78", "process.exitCode = 0");
  assert.notEqual(success, source);
  assert.throws(() => assertWholeGateRetired(success));
  for (const effect of [
    'import "../tests/integration/full-gate-20260827/preflight-repair/preflight.mjs";',
    'import("../tests/integration/full-gate-20260827/preflight-repair/run.mjs");',
    'require("node:fs").mkdirSync("/must-not-create");',
    'process.getBuiltinModule("node:child_process").spawnSync("git", ["status"]);',
    "process.exit(0);", 'console.log("passed");', "setTimeout(() => {}, 1);",
  ]) assert.throws(() => assertWholeGateRetired(`${source}\n${effect}`));
});

test("runner forwards serial options and preserves real failure status", () => {
  const metadata = Buffer.from(JSON.stringify(boundary));
  const fileSystem = {
    ...fileSystemFor(new Map([["/package/integration-boundaries.json", metadata], ["/package/" + fixture.owner, Buffer.from(owner)]])),
    globSync() { return ["tests/commands/yq-author-20260828/yq.test.ts"]; },
  };
  const spawn = (executable, args, options) => {
    assert.equal(executable, process.execPath);
    assert.deepEqual(args, ["--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", "tests/commands/yq-author-20260828/yq.test.ts"]);
    assert.deepEqual(options, { cwd: "/package", stdio: "inherit" });
    return { status: 17 };
  };
  assert.equal(runTests("/package", ["--test-concurrency=1", "--test-reporter=tap"], spawn, fileSystem), 17);
  assert.equal(runTests("/package", [], () => ({ status: null, signal: "SIGTERM" }), fileSystem), 1);
  const failure = new Error("spawn unavailable");
  assert.throws(() => runTests("/package", [], () => ({ error: failure }), fileSystem), error => error === failure);
});

test("runner defaults to serial execution and preserves explicit concurrency overrides verbatim", () => {
  const files = ["tests/commands/yq-author-20260828/yq.test.ts", "tests/current/failing.test.ts"];
  const fileSystem = {
    ...fileSystemFor(new Map([["/package/integration-boundaries.json", Buffer.from(JSON.stringify(boundary))], ["/package/" + fixture.owner, Buffer.from(owner)]])),
    globSync() { return [...files]; },
  };
  for (const [options, expected] of [
    [[], ["--test-concurrency=1"]],
    [["--test-reporter=tap"], ["--test-concurrency=1", "--test-reporter=tap"]],
    [["--test-concurrency=4", "--test-reporter=tap"], ["--test-concurrency=4", "--test-reporter=tap"]],
    [["--test-reporter=tap", "--test-concurrency", "2"], ["--test-reporter=tap", "--test-concurrency", "2"]],
    [["--test-concurrency=invalid"], ["--test-concurrency=invalid"]],
    [["--test-concurrency"], ["--test-concurrency"]],
    [["--test-concurrency-extra=4"], ["--test-concurrency=1", "--test-concurrency-extra=4"]],
  ]) {
    const forwarded = Object.freeze([...options]);
    assert.equal(runTests("/package", forwarded, (executable, args, spawnOptions) => {
      assert.equal(executable, process.execPath);
      assert.deepEqual(args, ["--import", "tsx", "--test", ...expected, ...files]);
      assert.deepEqual(spawnOptions, { cwd: "/package", stdio: "inherit" });
      return { status: 19 };
    }, fileSystem), 19);
    assert.deepEqual(forwarded, options);
  }
});

test("default normal runner passes every discovered active file to serial Node execution", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files = discoverTests(root, loadBoundaries(root));
  assertSource7Discovery(files);
  assert.ok(files.includes("tests/plugins/git-removal.test.ts"));
  assert.ok(files.includes("tests/commands/cut-portable.test.ts"));
  assert.ok(files.includes("tests/commands/capability-requirements.test.ts"));
  assert.ok(files.includes("tests/commands/filesystem-output.test.ts"));
  assert.ok(files.includes("tests/contracts/filesystem-output.test.ts"));
  assert.ok(files.includes("tests/commands/regex-execution/portable.test.ts"));
  assert.ok(files.includes("tests/commands/regex-execution/provider.test.ts"));
  assert.ok(files.includes("tests/commands/regex-execution/bounded-provider.test.ts"));
  assert.ok(files.includes("tests/commands/regex-execution/range-admission.test.ts"));
  assert.ok(files.includes("tests/commands/regex-execution/reply-admission.test.ts"));
  assert.ok(files.includes("tests/commands/regex-execution/worker-range-admission.test.ts"));
  assert.ok(files.includes("tests/commands/search/capability-requirements.test.ts"));
  assert.ok(files.includes("tests/commands/search/grep-pattern-admission.test.ts"));
  assert.ok(files.includes("tests/shell-stress/invocation-modes/batch-controls.test.ts"));
  assert.equal(runTests(root, [], (executable, args, options) => {
    assert.equal(executable, process.execPath);
    assert.deepEqual(args, ["--import", "tsx", "--test", "--test-concurrency=1", ...files]);
    assert.deepEqual(options, { cwd: root, stdio: "inherit" });
    return { status: 0 };
  }), 0);
});

test("repository boundaries preserve unaccepted YQ as active source tests", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const current = loadBoundaries(root);
  const build = JSON.parse(readFileSync(new URL("../tsconfig.build.json", import.meta.url), "utf8"));
  assert.deepEqual(current.heldSourceFiles.filter(path => path.endsWith(".ts")), build.exclude.filter(path => path.startsWith("src/commands/xan/")));
  assert.deepEqual(current.heldSourceFiles.filter(path => path.endsWith(".md")), ["src/commands/xan/DESIGN.md", "src/commands/xan/README.md"]);
  assert.equal(current.fixtureDirectories.length, 6);
  const selected = discoverTests(root, current);
  assert.ok(selected.includes("tests/commands/yq-author-20260828/yq.test.ts"));
  assert.ok(selected.includes("tests/commands/yq-author-20260828/repair-allocation-v1/repair.test.ts"));
});

test("UTF-8 literal workerd acceptance remains admitted current input", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  for (const path of [
    "tests/integration/utf8-literal-search-workerd/worker.mjs",
    "tests/integration/utf8-literal-search-workerd/observe.mjs",
    "tests/integration/utf8-literal-search-workerd/config.capnp",
  ]) {
    assertAdmittedInputPath(path, boundaries);
    assert.ok(readRegularInput(root, path, 65536, fs, boundaries).length > 0);
  }
});

test("published root mirrors only declared subpaths and keeps the feature isolated", () => {
  const source = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const root = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  const build = JSON.parse(readFileSync(new URL("../tsconfig.build.json", import.meta.url), "utf8"));
  const expected = Object.fromEntries(Object.entries(source.exports).map(([key, conditions]) => [
    key === "." ? "./safe-bash" : `./safe-bash${key.slice(1)}`,
    Object.fromEntries(Object.entries(conditions).map(([condition, target]) => [condition, `./packages/safe-bash${target.slice(1)}`])),
  ]));
  assert.deepEqual(Object.fromEntries(Object.entries(root.exports).filter(([key]) => key === "./safe-bash" || key.startsWith("./safe-bash/"))), expected);
  assert.equal(root.exports["./safe-bash/*"], undefined);
  assert.equal(root.engines.node, ">=18.18");
  assert.equal(source.engines.node, ">=22");
  assert.equal(source.name, "virtual-bash");
  assert.equal(source.private, true);
  assert.equal(Object.keys(source.dependencies ?? {}).length, 0);
  assert.equal(root.dependencies["virtual-bash"], undefined);
  assert.equal(root.devDependencies["virtual-bash"], "*");
  assert.ok(root.files.includes("packages/safe-bash/dist"));
  assert.deepEqual(source.poeCode.packageLint.sourceExclude, build.exclude.filter(path => path.startsWith("src/")));
  const entry = readFileSync(new URL("../../../src/index.ts", import.meta.url), "utf8");
  assert.equal(entry.includes("virtual-bash"), false);
  assert.equal(entry.includes("safe-bash"), false);
});

test("Turbo admits maintained tests with a build dependency and prunes exact held inputs", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  const turbo = JSON.parse(readFileSync(new URL("../../../turbo.json", import.meta.url), "utf8"));
  const source = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const excluded = [
    ...boundaries.heldSourceFiles.map(path => `!${path}`),
    ...boundaries.heldEvidenceDirectories.map(path => `!${path}/**`),
    ...boundaries.fixtureDirectories.map(fixture => `!${fixture.path}/**`),
  ];
  for (const task of ["virtual-bash#build", "virtual-bash#test:unit"]) {
    for (const path of excluded) assert.ok(turbo.tasks[task].inputs.includes(path), `${task}: ${path}`);
  }
  assert.deepEqual(turbo.tasks["virtual-bash#test:unit"].dependsOn, ["build"]);
  assert.ok(turbo.tasks["virtual-bash#test:unit"].inputs.includes("tests/**"));
  assert.equal(turbo.tasks["virtual-bash#test:unit"].cache, false);
  assert.ok(turbo.tasks["virtual-bash#test:unit"].inputs.includes("integration-type-inputs.json"));
  assert.ok(turbo.tasks["virtual-bash#build"].inputs.includes("scripts/typecheck-integration-inputs.mjs"));
  assert.ok(turbo.globalDependencies.includes("scripts/guard-package-dist.mjs"));
  assert.ok(turbo.tasks["//#test:unit"].inputs.includes("!packages/safe-bash/**"));
  assert.equal(source.scripts.test, "node scripts/test.mjs");
  assert.equal(source.scripts["test:unit"], "npm run test:runner && node scripts/test.mjs");
});

test("sealed type inputs authenticate owner records before they can leave current compilation", () => {
  const payload = Buffer.from("sealed type fixture");
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  const owner = Buffer.from(JSON.stringify({ fixtures: [{ path: "/historical/input.mts", sha256: digest(payload), size: payload.length }] }));
  const data = { version: 1, cohorts: [{
    name: "sealed-example", reason: "Versioned emitted-artifact proof, not a maintained source consumer",
    owner: { path: "tests/review/SEAL.json", bytes: owner.length, sha256: digest(owner), members: "fixtures" },
    entries: [{ path: "tests/review/input.mts", ownerPath: "/historical/input.mts", bytes: payload.length, sha256: digest(payload) }],
  }] };
  const files = new Map([
    ["/package/integration-type-inputs.json", Buffer.from(JSON.stringify(data))],
    ["/package/tests/review/SEAL.json", owner],
    ["/package/tests/review/input.mts", payload],
  ]);
  const fileSystem = {
    readdirSync(path) { return [...new Set([...files.keys()].filter(file => file.startsWith(path + "/")).map(file => file.slice(path.length + 1).split("/")[0]))]; },
    lstatSync(path) { return { isFile: () => files.has(path), isDirectory: () => !files.has(path), size: files.get(path)?.length ?? 0 }; },
    readFileSync(path) { assert.ok(files.has(path), `unadmitted read: ${path}`); return files.get(path); },
  };
  const classified = readIntegrationTypeInputs("/package", boundary, fileSystem);
  assert.equal(classified.standaloneEntries[0].classification, "frozen-evidence");
  assert.deepEqual(classified.capturedPaths, []);
  files.set("/package/tests/review/input.mts", Buffer.from("changed fixture"));
  assert.throws(() => readIntegrationTypeInputs("/package", boundary, fileSystem), /fixture|size/);
  files.set("/package/tests/review/input.mts", payload);
  files.set("/package/tests/review/SEAL.json", Buffer.from("changed owner"));
  assert.throws(() => readIntegrationTypeInputs("/package", boundary, fileSystem), /owner|size/);
  files.set("/package/tests/review/SEAL.json", owner);
  data.cohorts[0].entries[0].ownerPath = "/unbound/input.mts";
  files.set("/package/integration-type-inputs.json", Buffer.from(JSON.stringify(data)));
  assert.throws(() => readIntegrationTypeInputs("/package", boundary, fileSystem), /owning record/);
  data.cohorts[0].entries[0].ownerPath = "/historical/input.mts";
  files.set("/package/integration-type-inputs.json", Buffer.from(JSON.stringify(data)));
  assert.throws(() => readIntegrationTypeInputs("/package", boundary, {
    ...fileSystem,
    lstatSync(path) { return path === "/package/tests/review" ? { isDirectory: () => false } : fileSystem.lstatSync(path); },
  }), /regular directory/);
  assert.throws(() => readIntegrationTypeInputs("/package", boundary, {
    ...fileSystem,
    lstatSync(path) { return path.endsWith("input.mts") ? { isFile: () => false, size: 0 } : fileSystem.lstatSync(path); },
  }), /unadmitted/);
  assert.throws(() => readIntegrationTypeInputs("/package", boundary, {
    ...fileSystem,
    readdirSync(path) { return fileSystem.readdirSync(path).map(name => name === "SEAL.json" ? "seal.json" : name); },
  }), /nonliteral/);
  for (const path of ["tests/review/current.test.ts", "tests/review/../input.mts", "tests/review/*.mts", "tests/commands/xan-author-20260828/held.mts", ...["@", "+", "!", "?", "*"].map(operator => `tests/review/${operator}(current|frozen).mts`)]) {
    data.cohorts[0].entries[0].path = path;
    files.set("/package/integration-type-inputs.json", Buffer.from(JSON.stringify(data)));
    files.set("/package/" + path, payload);
    assert.throws(() => readIntegrationTypeInputs("/package", boundary, fileSystem), /literal|held|maintained/);
  }
});

test("shared type reader rejects held and nonliteral paths before any filesystem access", () => {
  let accesses = 0;
  const denied = () => { accesses++; throw new Error("filesystem reached before admission"); };
  const fileSystem = { readdirSync: denied, lstatSync: denied, readFileSync: denied };
  for (const path of ["../outside", "/absolute", "tests/../escape", "tests//empty", "tests/review/@(current|frozen).mts", "src/commands/xan/argv.ts", "src/commands/XAN/argv.ts", "src/commands/xan/new.ts", "tests/commands/xan-author-20260828/held.mts"]) {
    assert.throws(() => readRegularInput("/package", path, 100, fileSystem, boundary), /literal|held/);
  }
  assert.equal(accesses, 0);
});

test("source7 inventory admits exactly the already sealed thirteen-entry source delta", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  const prefix = "tests/plugins/qualified-current-release/";
  const files = new Map(["captured-types.json", "staged-types.json", "inventory.json"].map(name => ["/package/" + prefix + name, readRegularInput(root, prefix + name, 300000, fs, boundaries)]));
  const reads = [];
  const memory = fileSystemFor(files);
  const { captured, staged, inventory: currentInventory } = readTypecheckInventories("/package", boundaries, {
    ...memory,
    readFileSync(path) { reads.push(path); return memory.readFileSync(path); },
  });
  assert.equal(currentInventory.entries.length, 214);
  assert.deepEqual(currentInventory.counts, { "frozen-evidence": 166, current: 37, declaration: 7, "frozen-oracle": 1, "negative-types": 3 });
  const inventory = structuredClone(currentInventory);
  const currentAddition = "tests/plugins/qualified-current-release/current-shell-parse-limits.mts";
  assert.equal(inventory.entries.filter(entry => entry.path === currentAddition).length, 1);
  inventory.entries = inventory.entries.filter(entry => entry.path !== currentAddition);
  inventory.counts.current = 36;
  assert.equal(createHash("sha256").update(JSON.stringify(inventory, null, 2) + "\n").digest("hex"), "ad4b990db1317e78a32db465a198d90b57008612ca6de490815d5fdd83604ea7");
  const types = JSON.parse(readRegularInput(root, "integration-type-inputs.json", 100000, fs, boundaries));
  const sealed = types.cohorts.flatMap(cohort => cohort.entries).filter(entry => entry.path.endsWith(".mts"));
  assert.equal(sealed.length, 13);
  assert.equal(new Set(sealed.map(entry => entry.path)).size, 13);
  for (const entry of sealed) {
    assertAdmittedInputPath(entry.path, boundaries);
    const matches = inventory.entries.filter(member => member.path === entry.path);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].classification, "frozen-evidence");
    assert.equal(matches[0].sha256, entry.sha256);
  }
  assert.equal(inventory.entries.length, 213);
  assert.equal(inventory.inventoriedCommit, "697ad092de111642aa376f74560da9927a0c9512");
  assert.deepEqual(inventory.counts, { "frozen-evidence": 166, current: 36, declaration: 7, "frozen-oracle": 1, "negative-types": 3 });
  const previous = structuredClone(inventory);
  const additions = new Set(sealed.map(entry => entry.path));
  previous.entries = previous.entries.filter(entry => !additions.has(entry.path));
  previous.inventoriedCommit = "1ff82cb748c60145740dba354610ac7ed7a7f15f";
  previous.counts["frozen-evidence"] = 153;
  assert.equal(createHash("sha256").update(JSON.stringify(previous, null, 2) + "\n").digest("hex"), "7dbe62573f69670f697f978c5f91beb1b7003c582ad31728fda5ed4fa0bcd6e0");
  assert.deepEqual([...new Set([...lintInventoryPaths(captured, staged, inventory), ...additions])].sort(), [...new Set([...lintInventoryPaths(captured, staged, previous), ...additions])].sort());
  const { mergeStandaloneInventory } = await import("./typecheck-inputs.mjs");
  const authenticated = sealed.map(entry => ({ ...entry, classification: "frozen-evidence" }));
  assert.deepEqual(mergeStandaloneInventory(inventory, authenticated), inventory);
  const mergedPrevious = mergeStandaloneInventory(previous, authenticated);
  assert.equal(mergedPrevious.entries.length, 213);
  assert.deepEqual(mergedPrevious.counts, inventory.counts);
  assert.deepEqual(mergedPrevious.entries.map(entry => entry.path).sort(), inventory.entries.map(entry => entry.path).sort());
  assert.deepEqual(reads, [...files.keys()]);
});

test("current standalone inventory explicitly admits the shell parse-limits consumer", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  const { inventory } = readTypecheckInventories(root, boundaries);
  const { currentConsumerPaths } = await import("../tests/plugins/qualified-current-release/consumers.mjs");
  const { verifyAdmittedStandaloneInventory } = await import("./typecheck-inputs.mjs");
  const path = "tests/plugins/qualified-current-release/current-shell-parse-limits.mts";
  const current = currentConsumerPaths();
  const entries = inventory.entries.filter(entry => entry.classification === "current");
  const currentInventory = { entries, counts: { current: inventory.counts.current } };
  const read = () => assert.fail("current-route admission must not read historical payloads");
  const admitted = verifyAdmittedStandaloneInventory(currentInventory, current, current, [], read, boundaries);
  assert.deepEqual(admitted.checked, { current: 37 });
  assert.equal(inventory.entries.length, 214);
  assert.equal(inventory.counts.current, 37);
  const selected = entries.filter(entry => entry.path === path);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].classification, "current");
  assert.equal(selected[0].group, "shell-parse-limits-public");
  assert.throws(() => verifyAdmittedStandaloneInventory({
    entries: entries.filter(entry => entry.path !== path), counts: { current: 36 },
  }, current, current, [], read, boundaries), /standalone inventory changed/);
  const unregistered = "tests/plugins/qualified-current-release/unregistered-current.mts";
  assert.throws(() => verifyAdmittedStandaloneInventory({
    entries: [...entries, { path: unregistered, classification: "current" }], counts: { current: 38 },
  }, [...current, unregistered], current, [], read, boundaries), /current consumers must have an explicit compile\/runtime route/);
});

test("source7 standalone union preserves old and new inventory epochs without double counting", async () => {
  const { mergeStandaloneInventory } = await import("./typecheck-inputs.mjs");
  assert.equal(typeof mergeStandaloneInventory, "function");
  const current = { path: "tests/current/consumer.mts", classification: "current", sha256: "1".repeat(64) };
  const frozen = { path: "tests/sealed/consumer.mts", classification: "frozen-evidence", sha256: "2".repeat(64) };
  const previous = { entries: [current], counts: { current: 1, "frozen-evidence": 0 } };
  const next = { entries: [current, frozen], counts: { current: 1, "frozen-evidence": 1 } };
  const original = structuredClone(next);
  assert.deepEqual(mergeStandaloneInventory(previous, [frozen]), next);
  assert.deepEqual(mergeStandaloneInventory(next, [frozen]), next);
  assert.deepEqual(mergeStandaloneInventory(next, []), next);
  assert.deepEqual(next, original);
});

test("source7 standalone union refuses duplicate and conflicting owner admissions", async () => {
  const { mergeStandaloneInventory } = await import("./typecheck-inputs.mjs");
  assert.equal(typeof mergeStandaloneInventory, "function");
  const entry = { path: "tests/sealed/consumer.mts", classification: "frozen-evidence", sha256: "1".repeat(64) };
  const inventory = { entries: [entry], counts: { "frozen-evidence": 1 } };
  assert.throws(() => mergeStandaloneInventory({ ...inventory, entries: [entry, entry] }, [entry]), /duplicate/);
  assert.throws(() => mergeStandaloneInventory(inventory, [entry, entry]), /duplicate/);
  assert.throws(() => mergeStandaloneInventory(inventory, [{ ...entry, sha256: "2".repeat(64) }]), /binding/);
  assert.throws(() => mergeStandaloneInventory({ ...inventory, entries: [{ ...entry, classification: "current" }] }, [entry]), /classification/);
  assert.throws(() => mergeStandaloneInventory(inventory, [{ ...entry, classification: "current" }]), /frozen/);
});

test("legacy readers authenticate inventories before staged, captured or historical reads", async () => {
  const { verifyTypecheckInputs } = await import("./typecheck-inputs.mjs");
  const { verifyStagedTypeInputs } = await import("./typecheck-staged-inputs.mjs");
  const prefix = "tests/plugins/qualified-current-release/";
  const actual = new Map(["captured-types.json", "staged-types.json", "inventory.json"].map(name => [prefix + name, readFileSync(new URL(`../${prefix}${name}`, import.meta.url))]));
  for (const name of ["captured-types.json", "staged-types.json", "inventory.json"]) {
    const files = new Map([...actual].map(([path, bytes]) => ["/package/" + path, bytes]));
    files.set("/package/integration-boundaries.json", Buffer.from(JSON.stringify(boundary)));
    files.set("/package/" + fixture.owner, Buffer.from(owner));
    const changed = JSON.parse(files.get("/package/" + prefix + name));
    changed.entries[0].path = "tests/commands/xan-author-20260828/consumer.ts";
    files.set("/package/" + prefix + name, Buffer.from(JSON.stringify(changed)));
    const reads = [];
    const memory = fileSystemFor(files);
    const fileSystem = { ...memory, readFileSync(path) { reads.push(path); return memory.readFileSync(path); } };
    assert.throws(() => verifyTypecheckInputs("/package", fileSystem), /unapproved.*inventory/);
    assert.throws(() => verifyStagedTypeInputs("/package", [], fileSystem), /unapproved.*inventory/);
    assert.ok(reads.every(path => files.has(path)), "no metadata-selected payload can be read before inventory authentication");
    assert.ok(reads.every(path => !path.includes("xan-author")));
  }
});

test("staged owner ancestry is admitted before owner or consumer bytes are read", async () => {
  const { verifyStagedTypeInputs } = await import("./typecheck-staged-inputs.mjs");
  const prefix = "tests/plugins/qualified-current-release/";
  const files = new Map(["captured-types.json", "staged-types.json", "inventory.json"].map(name => ["/package/" + prefix + name, readFileSync(new URL(`../${prefix}${name}`, import.meta.url))]));
  files.set("/package/integration-boundaries.json", Buffer.from(JSON.stringify(boundary)));
  files.set("/package/" + fixture.owner, Buffer.from(owner));
  const staged = JSON.parse(files.get("/package/" + prefix + "staged-types.json"));
  const first = staged.entries[0];
  files.set("/package/" + first.owner.path, Buffer.from("must not be read through an alias"));
  files.set("/package/" + first.path, Buffer.from("must not be read before its owner"));
  const memory = fileSystemFor(files);
  const reads = [];
  assert.throws(() => verifyStagedTypeInputs("/package", [], {
    ...memory,
    lstatSync(path) { return path === "/package/tests/integration" ? { isDirectory: () => false } : memory.lstatSync(path); },
    readFileSync(path) { reads.push(path); return memory.readFileSync(path); },
  }), /regular directory/);
  assert.ok(!reads.includes("/package/" + first.owner.path));
  assert.ok(!reads.includes("/package/" + first.path));
});

test("standalone admission retains held evidence accounting without fabricating hash verification", async () => {
  const { verifyAdmittedStandaloneInventory } = await import("./typecheck-inputs.mjs");
  const bytes = Buffer.from("historical nonheld input");
  const current = "tests/current/consumer.mts";
  const frozen = "tests/history/consumer.mts";
  const held = "tests/commands/xan-author-20260828/consumer.mts";
  const evidence = "tests/commands/xan-author-20260828/SEAL.json";
  const inventory = { counts: { current: 1, "frozen-evidence": 2 }, entries: [
    { path: current, classification: "current" },
    { path: frozen, classification: "frozen-evidence", sha256: createHash("sha256").update(bytes).digest("hex") },
    { path: held, classification: "frozen-evidence", freeze: { evidence: [{ path: evidence }] } },
  ] };
  const reads = [];
  const read = path => { reads.push(path); assert.equal(path, frozen); return bytes; };
  const admission = verifyAdmittedStandaloneInventory(inventory, [current, frozen, held], [current], [], read, boundary);
  assert.deepEqual(admission.checked, { current: 1, "frozen-evidence": 1 });
  assert.deepEqual(admission.heldEvidence, [{ path: held, classification: "frozen-evidence", evidence: [evidence], contentVerified: false }]);
  assert.deepEqual(reads, [frozen]);
  assert.equal(inventory.entries.length, 3);
  assert.equal(inventory.counts["frozen-evidence"], 2);
  reads.length = 0;
  inventory.entries[2].classification = "current";
  assert.throws(() => verifyAdmittedStandaloneInventory(inventory, [current, frozen, held], [current, held], [], read, boundary), /current|count/);
  assert.equal(reads.length, 0);
});

test("alternate typecheck emission guards output before compilation and preserves failures", async () => {
  const { buildForTypecheck } = await import("./typecheck-inputs.mjs");
  const directories = [];
  const fileSystem = {
    async realpath(path) { directories.push(path); return path === "/package/dist" ? "/outside" : path; },
    async lstat() { throw new Error("unexpected lstat"); },
  };
  let compilations = 0;
  await assert.rejects(() => buildForTypecheck("/package", () => { compilations++; }, fileSystem), /inside the package/);
  assert.equal(compilations, 0);
  assert.deepEqual(directories, ["/package/dist", "/package"]);
  fileSystem.realpath = async path => path;
  await buildForTypecheck("/package", (label, args) => {
    compilations++;
    assert.equal(label, "build");
    assert.deepEqual(args, ["-p", "tsconfig.build.json"]);
    return { status: 0 };
  }, fileSystem);
  assert.equal(compilations, 1);
  await assert.rejects(() => buildForTypecheck("/package", () => ({ status: 2 }), fileSystem), /Production build failed/);
});

test("current integration type accounting retains exact frozen owners and every active test", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const boundaries = loadBoundaries(root);
  const classified = readIntegrationTypeInputs(root, boundaries);
  assert.equal(classified.standaloneEntries.length, 13);
  assert.equal(classified.capturedPaths.length, 2);
  assert.equal(classified.cohorts.length, 9);
  assert.ok(classified.standaloneEntries.every(entry => entry.classification === "frozen-evidence"));
  assert.ok(classified.capturedPaths.every(path => !path.endsWith(".test.ts")));
  const tests = discoverTests(root, boundaries);
  assertSource7Discovery(tests);
  assert.ok(tests.includes("tests/plugins/git-removal.test.ts"));
});

let importRetirementTestInputs;

function importRetirementFixture(changeReceipt) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (!importRetirementTestInputs) importRetirementTestInputs = {
    receipt: JSON.parse(readRegularInput(root, "integration-lint-audit/import-697ad-verification-retirement.json", 524288, fs, boundary)),
    source: readRegularInput(root, "scripts/integration-inputs.mjs", 100000, fs, boundary).toString("utf8"),
    inventory: JSON.parse(readRegularInput(root, "integration-lint-inventory.json", 1048576, fs, boundary)),
  };
  const receipt = structuredClone(importRetirementTestInputs.receipt);
  const ownerPath = "integration-lint-audit/import-697ad-verification-retirement.json";
  const files = new Map();
  for (const [path, row] of Object.entries(receipt.files)) {
    const bytes = Buffer.from("throw new Error('synthetic historical subject must not execute');");
    files.set("/package/" + path, bytes);
    row.bytes = bytes.length;
    row.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  const bind = path => ({ path, bytes: files.get("/package/" + path).length, sha256: createHash("sha256").update(files.get("/package/" + path)).digest("hex") });
  if (changeReceipt) changeReceipt(receipt);
  files.set("/package/" + ownerPath, Buffer.from(JSON.stringify(receipt)));
  const record = { id: receipt.id, role: "archived-operational-tooling", owners: [bind(ownerPath)], proof: { owner: ownerPath, selector: "/files", pathBase: ".", relation: "root-named-import-origin-retirement-v1" }, members: Object.keys(receipt.files).filter(path => !removedGitFixtureRoots.some(root => path === root || path.startsWith(root + "/"))).map(bind) };
  const reads = [];
  const metadata = [];
  const enumerations = [];
  const memory = fileSystemFor(files);
  const fileSystem = {
    ...memory,
    readdirSync(path) { enumerations.push(path); return memory.readdirSync(path); },
    lstatSync(path) { metadata.push(path); return { ...memory.lstatSync(path), nlink: 1 }; },
    readFileSync(path) { reads.push(path); return memory.readFileSync(path); },
  };
  const source = importRetirementTestInputs.source;
  const start = source.indexOf("const importRetirementOwner = Object.freeze(");
  assert.ok(start >= 0, "closed import-origin owner binding must exist");
  const end = source.indexOf("\n);", start) + 3;
  assert.ok(end > start, "closed owner declaration must have a bounded terminator");
  const declaration = "const importRetirementOwner = Object.freeze(\n" + JSON.stringify(record.owners[0], null, 2) + "\n);";
  let syntheticSource = (source.slice(0, start) + declaration + source.slice(end)).split("\n").filter(line => !line.startsWith("import ")).join("\n").split("\nif (process.argv[1]")[0].replaceAll("export function ", "function ");
  const events = [];
  const validationCall = "    validateImportRetirement(retirement, receipt, boundaries);";
  const authenticationReturn = "    return bytes;\n  }\n  const subjectOwners";
  assert.equal(syntheticSource.split(validationCall).length, 2);
  assert.equal(syntheticSource.split(authenticationReturn).length, 2);
  syntheticSource = syntheticSource.replace(validationCall, validationCall + "\n    observeRetirement({ type: 'validated', path: importRetirementOwner.path });").replace(authenticationReturn, "    observeRetirement({ type: 'authenticated', path: entry.path });\n" + authenticationReturn);
  const context = new Script("(function (assert, createHash, fs, join, assertAdmittedInputPath, assertLiteralInputPath, readRegularInput, readIntegrationTypeInputs, observeRetirement) {\n" + syntheticSource + "\nreturn { verify: verifyLintInventory, validate: validateImportRetirement };\n})", { filename: "integration-inputs.synthetic-retirement.mjs" }).runInThisContext()(assert, createHash, {}, posix.join, assertAdmittedInputPath, assertLiteralInputPath, readRegularInput, readIntegrationTypeInputs, event => events.push(event));
  return { receipt, record, files, ownerPath, reads, metadata, enumerations, events, fileSystem, inventory: { version: 1, records: [record] }, verify: context.verify, validate: context.validate };
}


test("import-origin retirement preserves 789 historical identities and admits only 752 retained synthetic subjects without execution or outward exclusions", () => {
  const fixture = importRetirementFixture();
  fixture.files.set("/package/tests/review/current-negative-validator.mjs", Buffer.from("must remain active"));
  const result = fixture.verify("/package", fixture.inventory, boundary, fixture.fileSystem);
  assert.deepEqual([...result.files], fixture.record.members.map(member => member.path));
  assert.equal(Object.keys(fixture.receipt.files).length, 789);
  assert.equal(result.files.length, 752);
  assert.equal(new Set(fixture.record.members.map(member => member.sha256)).size, 1);
  assert.equal(fixture.reads[0], "/package/" + fixture.ownerPath);
  assert.equal(fixture.reads.length, 753);
  assert.ok(fixture.reads.every(path => !removedGitFixtureRoots.some(root => path.startsWith("/package/" + root + "/"))));
  assert.ok(!result.files.includes("tests/review/current-negative-validator.mjs"));
  for (const path of fixture.receipt.preservation.protectedPaths) assert.ok(!result.files.includes(path));
});

test("import-origin retirement refuses record substitutions before any content read", () => {
  for (const mutate of [
    record => { record.id += "-other"; },
    record => { record.role = "immutable-harness-capture"; },
    record => { record.proof.owner = "tests/review/other.json"; },
    record => { record.proof.selector = "/files/0"; },
    record => { record.proof.pathBase = "tests/review"; },
    record => { record.proof.relation = "unselected-means-retired"; },
    record => { record.codeDirectory = "tests/review"; },
    record => { record.symlinks = []; },
    record => { record.owners[0].bytes = 524289; },
    record => { record.owners[0].sha256 = "0".repeat(64); },
    record => { record.members.pop(); },
    record => { record.members[0].path += ".moved"; },
    record => { record.members[0].path = record.members[1].path; },
  ]) {
    const fixture = importRetirementFixture();
    mutate(fixture.record);
    assert.throws(() => fixture.verify("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
});

test("import-origin retirement validates the decision qualifications and complete original tuple schema", () => {
  for (const mutate of [
    receipt => { receipt.decision.gateWaiver = true; },
    receipt => { receipt.decision.authority = "user-statement"; },
    receipt => { receipt.selection.nonuseProved = true; },
    receipt => { receipt.selection.uncollectedWorkspaceDeclarations = 0; },
    receipt => { receipt.preservation.uf01HistoricalCopyAuthorityGap = "resolved"; },
    receipt => { receipt.preservation.historicalParserFailures = []; },
    receipt => { receipt.extra = true; },
    receipt => { delete receipt.files[Object.keys(receipt.files)[0]]; },
    receipt => { receipt.files["tests/review/new-neighbor.mjs"] = Object.values(receipt.files)[0]; },
    receipt => { Object.values(receipt.files)[0].mode = "120000"; },
    receipt => { Object.values(receipt.files)[0].parentTree = "unknown"; },
    receipt => { Object.values(receipt.files)[0].blobOid = "unknown"; },
    receipt => { Object.values(receipt.files)[0].purpose = ""; },
    receipt => { Object.values(receipt.files)[0].eligibilityPointer = "/records/814"; },
    receipt => { Object.values(receipt.files)[0].currentProof = "replayed667/0"; },
    receipt => { Object.values(receipt.files)[0].extra = true; },
  ]) {
    const fixture = importRetirementFixture();
    mutate(fixture.receipt);
    assert.throws(() => fixture.validate(fixture.record, fixture.receipt, boundary));
    assert.deepEqual(fixture.reads, []);
  }
});

test("import-origin retirement rejects owner and subject byte drift and never reads a subject before receipt admission", () => {
  for (const owner of [true, false]) for (const resize of [true, false]) {
    const fixture = importRetirementFixture();
    const selected = "/package/" + (owner ? fixture.ownerPath : fixture.record.members[0].path);
    const original = fixture.files.get(selected);
    const changed = Buffer.concat([original, Buffer.alloc(Number(resize))]);
    changed[0] ^= 1;
    fixture.files.set(selected, changed);
    assert.throws(() => fixture.verify("/package", fixture.inventory, boundary, fixture.fileSystem), /changed/);
    assert.equal(fixture.reads.includes(selected), !resize);
    if (owner) assert.ok(fixture.reads.every(path => path === selected));
  }
});

test("import-origin retirement rejects held aliases and nonliteral paths before metadata or payload", () => {
  for (const path of ["tests/commands/xan-author-20260828/hidden.mjs", "tests/commands/XAN-author-20260828/hidden.mjs", "src/commands/xan/argv.ts", "tests/review/../hidden.mjs", "tests/review/@(old|new).mjs", "tests/review/*.mjs", "tests/review/back\\slash.mjs"]) {
    const fixture = importRetirementFixture();
    fixture.record.members[0].path = path;
    assert.throws(() => fixture.verify("/package", fixture.inventory, boundary, fixture.fileSystem));
    assert.deepEqual(fixture.reads, []);
    assert.deepEqual(fixture.metadata, []);
    assert.deepEqual(fixture.enumerations, []);
  }
});

test("import-origin retirement denies replacement kinds and ancestor aliases before descendant access", () => {
  for (const kind of ["directory", "symlink", "special", "hardlink", "alias", "ancestor-link", "oversize"]) {
    const fixture = importRetirementFixture();
    const selected = "/package/" + fixture.ownerPath;
    const parent = posix.dirname(selected);
    const denied = kind === "ancestor-link" ? parent : selected;
    const original = fixture.fileSystem;
    const fileSystem = {
      ...original,
      readdirSync(path) { assert.ok(path !== denied && !path.startsWith(denied + "/"), "denied leaf must not be enumerated"); const names = original.readdirSync(path); return kind === "alias" && path === parent ? names.map(name => name === posix.basename(selected) ? name.toUpperCase() : name) : names; },
      lstatSync(path) {
        assert.ok(!path.startsWith(denied + "/"), "denied descendants must not be inspected");
        const stat = original.lstatSync(path);
        if (path !== denied || kind === "alias") return stat;
        return { ...stat, isFile: () => kind === "oversize" || kind === "hardlink", isDirectory: () => kind === "directory", isSymbolicLink: () => kind === "symlink" || kind === "ancestor-link", nlink: kind === "hardlink" ? 2 : 1, size: kind === "oversize" ? 524289 : stat.size };
      },
    };
    assert.throws(() => fixture.verify("/package", fixture.inventory, boundary, fileSystem));
    assert.deepEqual(fixture.reads, []);
  }
});

test("import-origin retirement preserves only the four retained independently bound provenance overlaps", () => {
  const fixture = importRetirementFixture();
  for (const [index, path] of fixture.receipt.preservation.retainedInventoryOwners.filter(path => fixture.record.members.some(member => member.path === path)).entries()) {
    const member = fixture.record.members.find(member => member.path === path);
    const capturedPath = "tests/review/captured-" + index + ".mjs";
    const bytes = Buffer.from("historical captured fixture");
    fixture.files.set("/package/" + capturedPath, bytes);
    fixture.inventory.records.push({ id: "synthetic-old-owner-" + index, role: "immutable-harness-capture", owners: [{ ...member }], proof: { owner: member.path, selector: "old-binding", pathBase: ".", relation: "preserved predecessor owner" }, members: [{ path: capturedPath, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }] });
  }
  fixture.inventory.records.reverse();
  const result = fixture.verify("/package", fixture.inventory, boundary, fixture.fileSystem);
  assert.equal(result.files.length, 756);
  assert.equal(fixture.reads[0], "/package/" + fixture.ownerPath);
  const changed = structuredClone(fixture.inventory);
  changed.records.find(record => record.id === "synthetic-old-owner-0").owners[0].sha256 = "0".repeat(64);
  assert.throws(() => fixture.verify("/package", changed, boundary, fixture.fileSystem), /binding/);
  const arbitrary = structuredClone(fixture.inventory);
  const arbitraryOwner = arbitrary.records.find(record => record.id === "synthetic-old-owner-0");
  arbitraryOwner.owners[0] = { ...fixture.record.members.find(member => !fixture.receipt.preservation.retainedInventoryOwners.includes(member.path)) };
  arbitraryOwner.proof.owner = arbitraryOwner.owners[0].path;
  assert.throws(() => fixture.verify("/package", arbitrary, boundary, fixture.fileSystem), /provenance/);
  fixture.reads.length = 0;
  const changedReceipt = Buffer.from(fixture.files.get("/package/" + fixture.ownerPath));
  changedReceipt[0] ^= 1;
  fixture.files.set("/package/" + fixture.ownerPath, changedReceipt);
  assert.throws(() => fixture.verify("/package", fixture.inventory, boundary, fixture.fileSystem), /changed/);
  assert.deepEqual(fixture.reads, ["/package/" + fixture.ownerPath]);
});

test("import-origin retirement preserves pinned inventory and root receipt data without member reads", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const inventoryBytes = readRegularInput(root, "integration-lint-inventory.json", 535875, fs, boundary);
  assert.equal(inventoryBytes.length, 535875);
  assert.equal(createHash("sha256").update(inventoryBytes).digest("hex"), "c67f5004c29e0974e166fc007e794e1ae35083a017a1c96b6e60cb79b59c6689");
  const inventory = JSON.parse(inventoryBytes);
  assert.equal(inventory.records.length, 70);
  assert.equal(createHash("sha256").update(JSON.stringify(inventory.records.slice(0, 69))).digest("hex"), "461159ff69833865729890157e3cb7dcc978478f5f211725ce1be2fffe8ec9f5");
  const receiptBytes = readRegularInput(root, "integration-lint-audit/import-697ad-verification-retirement.json", 524288, fs, boundary);
  assert.equal(receiptBytes.length, 500695);
  assert.equal(createHash("sha256").update(receiptBytes).digest("hex"), "9f73d12df64ba05609d58e8e591828d246bf0eab2276167f43caf5f46fa5aa49");
  const receipt = JSON.parse(receiptBytes);
  const record = inventory.records[69];
  validateImportRetirement(record, receipt, boundary);
  assert.deepEqual(record.owners, [{ path: "integration-lint-audit/import-697ad-verification-retirement.json", bytes: receiptBytes.length, sha256: createHash("sha256").update(receiptBytes).digest("hex") }]);
  assert.equal(inventory.records.flatMap(record => record.members).length, 1802);
  assert.equal(new Set(inventory.records.flatMap(record => record.owners.map(owner => owner.path))).size, 103);
  assert.equal(inventory.records.flatMap(record => record.symlinks ?? []).length, 2);
  const paths = inventory.records.flatMap(record => [...record.members.map(member => member.path), ...(record.symlinks ?? []).map(link => link.path)]);
  assert.equal(new Set(paths).size, 1804);
  for (const path of receipt.preservation.protectedPaths) assert.ok(!paths.includes(path));
  assert.equal(receipt.preservation.protectedPaths.length, 25);
  for (const path of receipt.preservation.retainedInventoryOwners.filter(path => record.members.some(member => member.path === path))) {
    const member = record.members.find(member => member.path === path);
    const predecessors = inventory.records.slice(0, 69).flatMap(record => record.owners).filter(owner => owner.path === path);
    assert.ok(predecessors.length > 0);
    for (const predecessor of predecessors) assert.deepEqual(predecessor, member);
  }
  const boundaries = JSON.parse(readRegularInput(root, "integration-lint-audit/boundary-leaf-receipts.json", 29399, fs, boundary));
  assert.deepEqual(boundaries.inventory, { path: "packages/safe-bash/integration-lint-inventory.json", bytes: inventoryBytes.length, sha256: createHash("sha256").update(inventoryBytes).digest("hex") });
  assert.equal(createHash("sha256").update(JSON.stringify(boundaries.records)).digest("hex"), "34f34da0ebbb1c45614572362a73ff7092b8014df9d69eeec6752268c99a4aaf");
  assert.equal(boundaries.records.length, 25);
});

const importRetirementOwnerAssociations = [
  {
    "recordId": "regex-baseline-source",
    "owner": "tests/stress/regex-execution/production-review/freeze.mjs",
    "proofOwner": "tests/stress/regex-execution/production-review/evidence/baseline-freeze.json",
    "selector": "identities"
  },
  {
    "recordId": "regex-production-first-source",
    "owner": "tests/stress/regex-execution/production-review/freeze.mjs",
    "proofOwner": "tests/stress/regex-execution/production-review/evidence/production-first-freeze.json",
    "selector": "identities"
  },
  {
    "recordId": "regex-production-final-source",
    "owner": "tests/stress/regex-execution/production-review/freeze.mjs",
    "proofOwner": "tests/stress/regex-execution/production-review/evidence/production-final-freeze.json",
    "selector": "identities"
  },
  {
    "recordId": "breadth-v7-bootstrap-seed",
    "owner": "tests/comparison/breadth-continuation-20260828/executor-v7/test-worker.mjs",
    "proofOwner": "tests/comparison/breadth-continuation-20260828/executor-v7/SEAL.json",
    "selector": [
      "/files/269"
    ]
  },
  {
    "recordId": "candidate7-01-failed-attempt-capture",
    "owner": "tests/compatibility/bash-conditional-author-20260829/run-v5.mjs",
    "proofOwner": "tests/compatibility/bash-conditional-author-20260829/EXECUTOR-v4.json",
    "selector": "/files/61"
  },
  {
    "recordId": "candidate7-05-failed-attempt-capture",
    "owner": "tests/integration/git-public-independent-20260829/internal-loader-repair-v1/controls-v2.mjs",
    "proofOwner": "tests/integration/git-public-independent-20260829/internal-loader-repair-v1/CONTROL-SEAL.json",
    "selector": "/files/4"
  },
  {
    "recordId": "candidate7-06-failed-attempt-capture",
    "owner": "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/seal-v2.mjs",
    "proofOwner": "tests/integration/full-gate-20260827/unified76-driver-independent/tool-routes-v10/ARTIFACTS.json",
    "selector": "/files/27"
  }
];

const currentImportRetirementOwnerAssociations = importRetirementOwnerAssociations.filter(association => !removedGitFixtureRoots.some(root => association.owner.startsWith(root + "/")));

function importRetirementCurrentOwnerFixture(changeReceipt) {
  const fixture = importRetirementFixture(changeReceipt);
  const records = structuredClone(importRetirementTestInputs.inventory.records.filter(record => currentImportRetirementOwnerAssociations.some(association => association.recordId === record.id)));
  assert.equal(records.length, 6);
  const bind = path => ({ path, bytes: fixture.files.get("/package/" + path).length, sha256: createHash("sha256").update(fixture.files.get("/package/" + path)).digest("hex") });
  for (const record of records) for (const entry of [...record.owners, ...record.members]) {
    if (!fixture.files.has("/package/" + entry.path)) fixture.files.set("/package/" + entry.path, Buffer.from(entry.path.endsWith(".json") ? "{}" : "throw new Error('inert R2 verification fixture must never execute');"));
    Object.assign(entry, bind(entry.path));
  }
  for (const record of records) {
    if (record.role === "controlled-executable-fixture" || record.id.startsWith("candidate7-")) {
      const selector = Array.isArray(record.proof.selector) ? record.proof.selector[0] : record.proof.selector;
      const [collection, offset] = selector.slice(1).split("/");
      const member = record.members[0];
      const rows = Array.from({ length: Number(offset) + 1 }, () => null);
      rows[Number(offset)] = { ...member, path: record.proof.pathBase === "." ? member.path : member.path.slice(record.proof.pathBase.length + 1) };
      fixture.files.set("/package/" + record.proof.owner, Buffer.from(JSON.stringify({ [collection]: rows })));
      Object.assign(record.owners.find(owner => owner.path === record.proof.owner), bind(record.proof.owner));
    }
  }
  fixture.inventory.records = [...records, fixture.record];
  const associations = records.flatMap(record => record.owners.filter(owner => fixture.receipt.preservation.retainedInventoryOwners.includes(owner.path)).map(owner => ({ recordId: record.id, owner: owner.path, proofOwner: record.proof.owner, selector: record.proof.selector })));
  assert.deepEqual(associations, currentImportRetirementOwnerAssociations);
  return fixture;
}

function guardedRetirementFixture(fixture, fault) {
  const root = "/retirement-owned";
  const packageRoot = root + "/packages/safe-bash";
  const volume = Volume.fromJSON(Object.fromEntries([...fixture.files].map(([path, bytes]) => [packageRoot + path.slice("/package".length), bytes.toString("utf8")])));
  const memory = createFsFromVolume(volume);
  const descriptors = new Map();
  const opened = [];
  const closed = [];
  const occurrences = new Map();
  const fileSystem = {
    ...memory,
    constants: fs.constants,
    openSync(path, flags) {
      const descriptor = memory.openSync(path, flags);
      const local = String(path).slice(packageRoot.length + 1);
      const occurrence = (occurrences.get(local) ?? 0) + 1;
      occurrences.set(local, occurrence);
      const entry = { path: local, occurrence, reads: 0, descriptor };
      descriptors.set(descriptor, entry);
      opened.push(entry);
      fixture.events.push({ type: "opened", path: local, occurrence });
      return descriptor;
    },
    readSync(descriptor, buffer, offset, length, position) {
      const entry = descriptors.get(descriptor);
      assert.ok(entry);
      entry.reads++;
      fixture.events.push({ type: "payload", path: entry.path, occurrence: entry.occurrence });
      const selected = fault && entry.path === fault.path && entry.occurrence === (fault.occurrence ?? 1);
      if (selected && fault.kind !== "close") {
        if (entry.reads === 1) return memory.readSync(descriptor, buffer, offset, Math.min(1, length), position);
        throw fault.reason;
      }
      return memory.readSync(descriptor, buffer, offset, length, position);
    },
    closeSync(descriptor) {
      const entry = descriptors.get(descriptor);
      assert.ok(entry);
      memory.closeSync(descriptor);
      descriptors.delete(descriptor);
      closed.push(entry);
      fixture.events.push({ type: "closed", path: entry.path, occurrence: entry.occurrence });
      if (fault && entry.path === fault.path && entry.occurrence === (fault.occurrence ?? 1) && fault.kind !== "read") throw fault.closeReason;
    },
  };
  const guard = createLintInputGuard({ root, boundaries: boundary, fileSystem });
  return { guard, packageRoot, memory, descriptors, opened, closed, run: () => fixture.verify(packageRoot, fixture.inventory, boundary, guard.fileSystem) };
}

test("import-origin R2 records the exact five-owner dual role and seven current associations", () => {
  const fixture = importRetirementFixture();
  const decision = fixture.receipt.decision.fiveOwnerException;
  assert.ok(decision, "R2 must explicitly record the separate root five-owner decision");
  assert.equal(decision.authority, "root-coordinator-maintenance-decision");
  assert.equal(decision.currentRole, "byte-authenticated-provenance-data-owner");
  assert.equal(decision.retiredRole, "standalone-historical-verification-tool-maintenance-and-file-wide-lint");
  assert.equal(decision.changesPriorOwnerExclusionProtection, true);
  assert.equal(decision.globalNonexecutionProved, false);
  assert.equal(decision.laterCurrentExecutedValidatorDependency, "reopen-member-disposition");
  assert.deepEqual(decision.associations, importRetirementOwnerAssociations);
});

test("import-origin R2 authenticates each of four retained owners twice after receipt validation across six uses", () => {
  const fixture = importRetirementCurrentOwnerFixture();
  const owned = guardedRetirementFixture(fixture);
  const result = owned.run();
  assert.equal(result.files.length, 1192);
  const paths = fixture.receipt.preservation.retainedInventoryOwners.filter(path => fixture.record.members.some(member => member.path === path));
  const ownerOrder = [...new Set(currentImportRetirementOwnerAssociations.map(association => association.owner))];
  const memberOrder = fixture.record.members.filter(member => paths.includes(member.path)).map(member => member.path);
  const authenticated = fixture.events.filter(event => event.type === "authenticated" && paths.includes(event.path));
  assert.deepEqual(authenticated.map(event => event.path), [...ownerOrder, ...memberOrder]);
  const validated = fixture.events.findIndex(event => event.type === "validated");
  assert.ok(validated > fixture.events.findIndex(event => event.type === "authenticated" && event.path === fixture.ownerPath));
  assert.equal(fixture.events.filter(event => event.type === "validated").length, 1);
  for (const path of paths) {
    assert.equal(authenticated.filter(event => event.path === path).length, 2, path);
    assert.deepEqual(owned.opened.filter(entry => entry.path === path).map(entry => entry.occurrence), [1, 2], path);
    assert.equal(owned.closed.filter(entry => entry.path === path).length, 2, path);
    assert.ok(fixture.events.findIndex(event => event.type === "opened" && event.path === path) > validated, path);
  }
  assert.equal(currentImportRetirementOwnerAssociations.filter(association => association.owner === "tests/stress/regex-execution/production-review/freeze.mjs").length, 3);
  assert.equal(owned.opened.filter(entry => entry.path === "tests/stress/regex-execution/production-review/freeze.mjs").length, 2);
  assert.equal(owned.descriptors.size, 0);
  assert.equal(owned.guard.snapshot().opens, owned.guard.snapshot().closes);
});

test("import-origin R2 invalid receipt admits zero payloads for each current provenance owner", () => {
  for (const invalidHeader of [false, true]) {
    const fixture = importRetirementCurrentOwnerFixture(invalidHeader ? receipt => { receipt.decision.gateWaiver = true; } : undefined);
    if (!invalidHeader) {
      const bytes = Buffer.from(fixture.files.get("/package/" + fixture.ownerPath));
      bytes[0] ^= 1;
      fixture.files.set("/package/" + fixture.ownerPath, bytes);
    }
    const owned = guardedRetirementFixture(fixture);
    assert.throws(() => owned.run(), /changed/);
    for (const path of fixture.receipt.preservation.retainedInventoryOwners) {
      assert.equal(owned.opened.filter(entry => entry.path === path).length, 0, path);
      assert.equal(fixture.events.filter(event => event.type === "payload" && event.path === path).length, 0, path);
    }
    assert.deepEqual(owned.opened.map(entry => entry.path), [fixture.ownerPath]);
    assert.equal(fixture.events.filter(event => event.type === "authenticated" && event.path === fixture.ownerPath).length, Number(invalidHeader));
    assert.equal(fixture.events.filter(event => event.type === "validated").length, 0);
    assert.equal(owned.descriptors.size, 0);
    assert.equal(owned.guard.snapshot().opens, owned.guard.snapshot().closes);
  }
});

for (const path of [...new Set(currentImportRetirementOwnerAssociations.map(association => association.owner))]) {
  test("import-origin R2 partial owner failure closes and stops at " + path, () => {
    const fixture = importRetirementCurrentOwnerFixture();
    const reason = Object.freeze({ owner: path });
    const owned = guardedRetirementFixture(fixture, { path, kind: "read", reason });
    let returned = false;
    let caught = false;
    let failure;
    try { owned.run(); returned = true; } catch (error) { caught = true; failure = error; }
    assert.ok(caught && !returned);
    assert.equal(failure, reason);
    assert.equal(owned.opened.at(-1).path, path);
    assert.equal(owned.opened.at(-1).reads, 2);
    assert.deepEqual(owned.opened.filter(entry => fixture.receipt.preservation.retainedInventoryOwners.includes(entry.path)).map(entry => entry.path), [...new Set(currentImportRetirementOwnerAssociations.map(association => association.owner))].slice(0, [...new Set(currentImportRetirementOwnerAssociations.map(association => association.owner))].indexOf(path) + 1));
    assert.equal(fixture.events.filter(event => event.type === "authenticated" && event.path === path).length, 0);
    assert.equal(owned.descriptors.size, 0);
    assert.equal(owned.guard.snapshot().opens, owned.guard.snapshot().closes);
    assert.equal(owned.guard.snapshot().failed, true);
    const opens = owned.opened.length;
    assert.throws(() => owned.run(), /failed/);
    assert.equal(owned.opened.length, opens);
  });
}

test("import-origin R2 actual guard preserves falsey read and cleanup identities without omission", () => {
  const reasons = [undefined, null, false, 0, "", NaN];
  for (const reason of reasons) for (const kind of ["read", "close", "combined"]) {
    const fixture = importRetirementCurrentOwnerFixture();
    const path = currentImportRetirementOwnerAssociations[0].owner;
    const closeReason = Object.freeze({ cleanup: reason });
    const owned = guardedRetirementFixture(fixture, { path, kind, reason, closeReason });
    let caught = false;
    let failure;
    try { owned.run(); } catch (error) { caught = true; failure = error; }
    assert.ok(caught);
    if (kind === "combined") {
      assert.ok(failure instanceof AggregateError);
      assert.equal(failure.errors.length, 2);
      assert.ok(Object.is(failure.errors[0], reason));
      assert.equal(failure.errors[1], closeReason);
    } else assert.ok(Object.is(failure, kind === "read" ? reason : closeReason));
    assert.equal(owned.opened.at(-1).path, path);
    assert.equal(owned.closed.at(-1).path, path);
    assert.equal(owned.descriptors.size, 0);
    assert.equal(owned.closed.length, owned.opened.length);
    assert.throws(() => owned.memory.fstatSync(owned.closed.at(-1).descriptor), error => error.code === "EBADF");
    assert.equal(fixture.events.filter(event => event.type === "authenticated" && event.path === path).length, 0);
    assert.equal(owned.guard.snapshot().closes, owned.guard.snapshot().opens - Number(kind !== "read"));
  }
});

test("import-origin R2 missing payload and same-hash unlisted owner do not inherit provenance admission", () => {
  for (const path of [...new Set(currentImportRetirementOwnerAssociations.map(association => association.owner))]) {
    const fixture = importRetirementCurrentOwnerFixture();
    fixture.files.delete("/package/" + path);
    const owned = guardedRetirementFixture(fixture);
    assert.throws(() => owned.run());
    assert.equal(owned.opened.filter(entry => entry.path === path).length, 0);
    assert.equal(owned.descriptors.size, 0);
    assert.equal(owned.guard.snapshot().opens, owned.guard.snapshot().closes);
  }
  const fixture = importRetirementCurrentOwnerFixture();
  const replacement = fixture.record.members.find(member => !fixture.receipt.preservation.retainedInventoryOwners.includes(member.path));
  const record = fixture.inventory.records[0];
  const previous = record.owners.find(owner => owner.path === currentImportRetirementOwnerAssociations[0].owner);
  assert.equal(replacement.sha256, previous.sha256);
  Object.assign(previous, replacement);
  const owned = guardedRetirementFixture(fixture);
  assert.throws(() => owned.run(), /provenance/);
  assert.equal(owned.opened.length, 0);
});

test("import-origin R2 operational inventory pin rejects missing swapped and relocated association metadata", () => {
  const fixture = importRetirementFixture();
  const approved = importRetirementTestInputs.inventory;
  const ownerPaths = fixture.receipt.preservation.retainedInventoryOwners;
  for (const mutate of [
    inventory => { inventory.records = inventory.records.filter(record => record.id !== currentImportRetirementOwnerAssociations[0].recordId); },
    inventory => { const record = inventory.records.find(record => record.id === currentImportRetirementOwnerAssociations[0].recordId); record.owners = record.owners.filter(owner => owner.path !== currentImportRetirementOwnerAssociations[0].owner); },
    inventory => { const record = inventory.records.find(record => record.id === currentImportRetirementOwnerAssociations[0].recordId); record.owners.find(owner => owner.path === currentImportRetirementOwnerAssociations[0].owner).path = ownerPaths.find(path => path !== currentImportRetirementOwnerAssociations[0].owner); },
    inventory => { const record = inventory.records.find(record => record.id === currentImportRetirementOwnerAssociations[0].recordId); record.owners.find(owner => owner.path === currentImportRetirementOwnerAssociations[0].owner).path += ".same-hash-other-path"; },
  ]) {
    const changed = structuredClone(approved);
    mutate(changed);
    const files = new Map([["/package/integration-lint-inventory.json", Buffer.from(JSON.stringify(changed, null, 2) + "\n")]]);
    const memory = fileSystemFor(files);
    const reads = [];
    assert.throws(() => readIntegrationLintInputs("/package", boundary, { ...memory, readFileSync(path) { reads.push(path); return memory.readFileSync(path); } }), /unapproved.*lint inventory|lint inventory size/);
    assert.ok(reads.every(path => path === "/package/integration-lint-inventory.json"));
  }
});
