import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { validateSourceRevision } from "../source-gate.ts";

const directory = "tests/commands/network-stress";
const owned = `${directory}/final-verification`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (path) => readFile(path, "utf8");
const json = async (path) => JSON.parse(await text(path));
const source = await validateSourceRevision();
const results = [];
const immutable = [];
for (const name of ["README.md", "REPORT.md", "BASELINE.md", "SUPPLEMENT.md", "oracle.json", "rows.ts", "lab.ts", "native.ts", "evidence.ts", "baseline.json", "handoff.json", "supplement-native.json", "supplement-pins.json", "supplement-product.json", "supplement.ts", "supplement-lab.ts", "supplement-rows.ts"]) {
  const path = `${directory}/${name}`;
  const original = spawnSync("git", ["show", `0a3fb6ec419c5614457100757816671db7a39c4f:${path}`]);
  assert.equal(original.status, 0);
  const current = await readFile(path);
  assert.equal(digest(current), digest(original.stdout), `Historical evidence changed: ${path}`);
  immutable.push({ path, sha256: digest(current), revision: "0a3fb6ec419c5614457100757816671db7a39c4f" });
}
results.push({ id: "historical-files-unchanged", count: immutable.length, status: "passed" });
for (const pinName of ["supplement-pins.json", "retry-pins.json"]) {
  const pins = await json(`${directory}/${pinName}`);
  for (const [path, expected] of Object.entries(pins.hashes)) {
    const actualPath = path.startsWith("tests/") ? path : `${directory}/${path}`;
    assert.equal(digest(await readFile(actualPath)), expected);
  }
  results.push({ id: pinName, count: Object.keys(pins.hashes).length, status: "passed" });
}
for (const [earlier, later] of [["06d1aecb1322954608857d3716d1af2085e793a5", "deab14d9f4b3b6f0d73f96587c74a9de23091300"], ["3b63f98a785b84d78bbc4080ea475ee426b471e2", source.revision]]) {
  assert.equal(spawnSync("git", ["merge-base", "--is-ancestor", earlier, later]).status, 0);
  results.push({ id: "freeze-before-product-revision", earlier, later, status: "passed" });
}
const oldLab = await text(`${directory}/lab.ts`);
assert.equal(await text(`${directory}/lab-v2.ts`), oldLab
  .replace('import assert from "node:assert/strict";\n', 'import assert from "node:assert/strict";\nimport { closeResources } from "./close-resources.js";\n')
  .replace('      for (const socket of sockets) socket.destroy();\n      await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));\n      assert.equal(sockets.size, 0, "Fixture socket cleanup incomplete");', '      await closeResources(servers, sockets);'));
assert.equal(await text(`${directory}/product-v2.ts`), 'import { validateSourceRevision } from "./source-gate.js";\n' + (await text(`${directory}/product.ts`))
  .replace('from "./lab.js";', 'from "./lab-v2.js";')
  .replace('  const publicEntry =', '  await validateSourceRevision();\n  const publicEntry ='));
assert.equal(await text(`${directory}/supplement-v2.ts`), 'import { validateSourceRevision } from "./source-gate.js";\n' + (await text(`${directory}/supplement.ts`))
  .replace('  api = await import', '  await validateSourceRevision();\n  api = await import'));
results.push({ id: "exact-versioned-harness-transformations", count: 3, status: "passed" });
const lifecycle = await text(`${directory}/retry-lifecycle.ts`);
assert.equal(await text(`${directory}/retry-lifecycle-v2.ts`), lifecycle
  .replace('|| ["sink-failure", "stream-quota"].includes(name)', '|| name === "stream-quota"')
  .replace('["body-timeout", "partial-stdout"].includes(name)', '["body-timeout", "partial-stdout", "sink-failure"].includes(name)')
  .replace('      assert.equal(result.stdout, expectedText);', '      assert.equal(result.stdout, expectedText);\n      if (name === "sink-failure") assert.equal(Buffer.concat(emitted).length, 0, "Rejected external sink accepted no bytes despite shell capture");'));
assert.match(await text("src/shell/shell.ts"), /await capture.write\(chunk\);\s*if \(external\) await external.write\(chunk\);/);
results.push({ id: "sink-observation-boundary-only-correction", status: "passed" });
const originalIndependent = await text(`${owned}/independent-before-types.ts.txt`);
const typedIndependent = await text(`${owned}/independent.ts`);
assert.equal(typedIndependent, originalIndependent.replace('const observations = [];', 'const observations: (Awaited<ReturnType<typeof native>> & {\n  id: string;\n  files: Record<string, string>;\n  traces: Awaited<ReturnType<typeof fixture>>["traces"];\n})[] = [];'));
const independentFrozen = await json(`${owned}/independent-native-frozen.json`);
assert.equal(digest(originalIndependent), independentFrozen.fixtureSha256);
results.push({ id: "independent-type-annotation-only", before: digest(originalIndependent), after: digest(typedIndependent), status: "passed" });
const retryFrozen = (await json(`${directory}/retry-freeze.json`)).records.filter((record) => record.id);
const retryReplay = (await json(`${owned}/retry-native-replay.json`)).records.filter((record) => record.id);
assert.equal(retryReplay.length, 18);
for (const actual of retryReplay) {
  const expected = retryFrozen.find((record) => record.id === actual.id);
  assert(expected);
  for (const key of ["id", "argv", "code", "signal", "stdout", "traces", "wireTraces", "files", "consumerCode"]) assert.deepEqual(actual[key], expected[key], `${actual.id}: ${key}`);
  assert.deepEqual([...actual.stderr.matchAll(/curl: \((\d+)\)/g)].map((match) => match[1]), [...expected.stderr.matchAll(/curl: \((\d+)\)/g)].map((match) => match[1]));
  assert.equal(actual.stderr.match(/503/g)?.length, expected.stderr.match(/503/g)?.length);
}
results.push({ id: "retry-native-replay-matches-frozen-bytes-effects-status-diagnostics", count: 18, status: "passed" });
const pkg = await json("package.json");
assert.deepEqual(pkg.dependencies ?? {}, {});
assert.equal(pkg.exports["./commands/network"].import, "./dist/commands/network/index.js");
const api = await import("../../../../src/index.ts");
const subpath = await import("../../../../src/commands/network/index.ts");
assert.equal(api.networkCommands, subpath.networkCommands);
assert.equal(api.curlCommands, subpath.curlCommands);
assert.equal(api.networkCommands, api.curlCommands);
assert(!api.createAgentCommands().some((command) => command.name === "curl"));
for (const name of await readdir("src/commands/network")) if (name.endsWith(".ts")) assert.doesNotMatch(await text(`src/commands/network/${name}`), /(?:node:)?child_process|\bexecFile\b|\bspawn\(/);
results.push({ id: "zero-runtime-deps-public-aliases-explicit-opt-in-no-network-subprocess", status: "passed" });
const captures = [];
for (const name of (await readdir(owned)).filter((name) => name.endsWith(".json"))) {
  const artifact = await json(`${owned}/${name}`);
  if (!artifact.samples) continue;
  assert(artifact.networkStable);
  assert(artifact.samples.every((sample) => sample.digest === source.digest));
  assert.deepEqual(artifact.after.fixtureRoots, artifact.before.fixtureRoots);
  assert.equal(digest(artifact.stdout), artifact.stdoutSha256);
  assert.equal(digest(artifact.stderr), artifact.stderrSha256);
  captures.push({ name, exit: artifact.exit, samples: artifact.samples.length, start: artifact.before.at, end: artifact.after.at, changes: artifact.changes, summaries: artifact.records.filter((record) => record.total !== undefined), sha256: digest(await readFile(`${owned}/${name}`)) });
}
assert.deepEqual(await validateSourceRevision(), source);
const report = { at: new Date().toISOString(), source, results, immutable, captures, nativeCounts: { originalReplay: { transfers: 58, version: 1, headConsumers: 2, nodeTests: 65 }, retryReplay: { transfers: 18, version: 1, nodeTests: 0 }, independent: { transfers: 3, version: 1, nodeTests: 0 }, author: { httpTransfers: 34, fileTransfers: 5, tlsTransfers: 1, version: 0, nodeTests: 81 }, totalCurlInvocations: 122 }, allChecksPassed: true };
const label = process.argv[2] ?? "audit";
assert.match(label, /^[a-z0-9-]+$/);
const target = `${owned}/${label}.json`;
await assert.rejects(readFile(target), { code: "ENOENT" });
const saved = spawnSync("apply_patch", { input: `*** Begin Patch\n*** Add File: ${target}\n${JSON.stringify(report, null, 2).split("\n").map((line) => `+${line}`).join("\n")}\n*** End Patch\n`, encoding: "utf8" });
assert.equal(saved.status, 0, saved.stderr);
console.log(JSON.stringify({ source, checks: results, captures: captures.length, samples: captures.reduce((count, capture) => count + capture.samples, 0), nativeCounts: report.nativeCounts }));
