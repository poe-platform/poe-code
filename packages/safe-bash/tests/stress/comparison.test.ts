import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deterministicCases, parseFixtures } from "../../benchmarks/fixtures.js";
import { assertionStatus, compareObservation, sha256, summarize, textBytes,
  type BenchmarkCase, type CaseResult, type Observation } from "../../benchmarks/model.js";
import { EngineSession } from "../../benchmarks/session.js";

function example(): BenchmarkCase {
  return { name: "example", tier: "core", tags: ["example.feature"], source: "bash-oracle",
    script: "printf hello", initialFiles: {}, stdin: "", env: {},
    expected: { stdout: textBytes("hello"), stderr: "", exitCode: 0, files: {} } };
}

function observation(): Observation {
  return { ...example().expected, unsupportedEntries: [], stdoutCapture: "native-bytes", stderrCapture: "native-bytes" };
}

function rawFixture() {
  return { schemaVersion: 1, fixtures: [{ name: "example", tier: "core", tags: ["example.feature"],
    script: "printf hello", expected: { stdout: "hello", stderr: "", exitCode: 0, files: {} } }] };
}

test("comparison consumes all 88 oracle fixtures without filtering advanced cases", async () => {
  const fixtures = parseFixtures(await readFile(new URL("../fixtures/shell-cases.json", import.meta.url), "utf8"));
  assert.equal(fixtures.length, 88);
  assert.equal(fixtures.filter((fixture) => fixture.tier === "core").length, 64);
  assert.equal(fixtures.filter((fixture) => fixture.tier === "advanced-pending").length, 24);
  assert.equal(new Set(fixtures.flatMap((fixture) => fixture.tags)).size, 73);
});

test("comparison preserves exact whitespace and binary output bytes", () => {
  assert.equal(assertionStatus(compareObservation(example(), observation())), "pass");
  assert.equal(assertionStatus(compareObservation(example(), { ...observation(), stdout: textBytes("hello\n") })), "fail");
  const binary = Buffer.from([0, 255, 128]).toString("base64");
  const fixture = { ...example(), expected: { ...example().expected, stdout: binary } };
  assert.equal(assertionStatus(compareObservation(fixture, { ...observation(), stdout: binary })), "pass");
  assert.equal(assertionStatus(compareObservation(fixture, { ...observation(), stdout: binary, stdoutCapture: "public-text-utf8" })), "pending");
});

test("empty expected files means no regular files, not a disabled assertion", () => {
  const assertions = compareObservation(example(), { ...observation(), files: { "unexpected.txt": textBytes("data") } });
  assert.equal(assertionStatus(assertions), "fail");
  assert.equal(assertions.find((assertion) => assertion.name.includes("filesystem"))?.status, "fail");
});

test("filesystem assertions reject missing, changed, and nonregular entries", () => {
  const fixture = { ...example(), expected: { ...example().expected, files: { "expected.txt": textBytes("data") } } };
  assert.equal(assertionStatus(compareObservation(fixture, observation())), "fail");
  assert.equal(assertionStatus(compareObservation(fixture, { ...observation(), files: { "expected.txt": textBytes("changed") } })), "fail");
  assert.equal(assertionStatus(compareObservation(example(), { ...observation(), unsupportedEntries: ["link:symlink"] })), "fail");
});

test("filesystem comparison uses complete bytes rather than base64 spelling", () => {
  const fixture = { ...example(), expected: { ...example().expected, files: { "file.txt": "YQ==" } } };
  const actual = { ...observation(), files: { "file.txt": "YQ" } };
  assert.equal(assertionStatus(compareObservation(fixture, actual)), "pass");
});

test("stderr and exit status are independent mandatory assertions", () => {
  assert.equal(assertionStatus(compareObservation(example(), { ...observation(), stderr: textBytes("warning") })), "fail");
  assert.equal(assertionStatus(compareObservation(example(), { ...observation(), exitCode: 127 })), "fail");
});

test("reports retain unsupported, pending, error, and timeout in every feature denominator", () => {
  const states = ["pass", "fail", "error", "timeout", "pending", "unsupported"] as const;
  const results: CaseResult[] = states.map((status) => ({ engine: "virtual-bash", ...example(),
    name: status, status, assertions: [], durationMs: 0 }));
  const summary = summarize(results);
  assert.equal(summary.byEngine["virtual-bash"]!.total, 6);
  assert.equal(summary.byEngine["virtual-bash"]!.passRate, 1 / 6);
  assert.equal(summary.byFeature["example.feature"]!["virtual-bash"]!.unsupported, 1);
  assert.equal(summary.overall, "fail");
  assert.equal(summarize([]).overall, "incomplete");
  assert.equal(summarize(results.filter((result) => ["pending", "unsupported"].includes(result.status))).overall, "incomplete");
  assert.equal(assertionStatus([]), "pending");
});

test("seeded stress is reproducible and varies with the seed", () => {
  const first = JSON.stringify(deterministicCases(123));
  assert.equal(sha256(first), sha256(JSON.stringify(deterministicCases(123))));
  assert.notEqual(sha256(first), sha256(JSON.stringify(deterministicCases(456))));
  assert.equal(deterministicCases().length, 18);
});

test("oracle loader rejects duplicate keys, duplicate names, and traversal paths", () => {
  const raw = rawFixture();
  assert.throws(() => parseFixtures(JSON.stringify(raw).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')), /Duplicate JSON key/u);
  raw.fixtures.push(raw.fixtures[0]!);
  assert.throws(() => parseFixtures(JSON.stringify(raw)), /duplicate fixture name/u);
  for (const path of ["../escape", "/absolute", "a/../b", "a//b", "a\\b", ".", "a/"]) {
    const fixture = rawFixture();
    fixture.fixtures[0]!.expected.files = { [path]: "content" };
    assert.throws(() => parseFixtures(JSON.stringify(fixture)), /Unsafe fixture file path/u);
  }
});

test("oracle loader rejects file/parent collisions and missing expectations", () => {
  const raw = rawFixture();
  raw.fixtures[0]!.expected.files = { parent: "file", "parent/child": "file" };
  assert.throws(() => parseFixtures(JSON.stringify(raw)), /also a parent/u);
  assert.throws(() => parseFixtures(JSON.stringify(rawFixture()).replace(',"stderr":""', "")), /Expected a string/u);
});

test("worker comparison exercises the actual virtual runtime and tools", { timeout: 15000 }, async () => {
  const session = new EngineSession("virtual-bash");
  try {
    const result = await session.run({ kind: "fixture", fixture: example() });
    assert.equal(result.status, "pass", JSON.stringify(result));
    assert.equal(result.assertions.length, 4);
    assert.deepEqual(result.details?.configuredPluginNames, ["standard-commands", "text-program-commands", "structured-commands", "search-commands", "byte-commands", "diff-patch-commands"]);
    for (const name of ["sed", "awk", "jq", "rg", "base64", "gzip", "diff", "patch"]) assert.ok((result.details?.configuredCommandNames as string[]).includes(name), name);
    assert.deepEqual(session.backgroundErrors, []);
  } finally { await session.dispose(); }
});

test("hard worker deadlines produce explicit timeouts rather than successful skips", { timeout: 15000 }, async () => {
  const session = new EngineSession("virtual-bash", 1);
  try {
    const result = await session.run({ kind: "fixture", fixture: example() });
    assert.equal(result.status, "timeout");
    assert.match(result.reason ?? "", /Hard worker deadline/u);
    assert.equal(summarize([result]).byEngine["virtual-bash"]!.timeout, 1);
  } finally { await session.dispose(); }
});
