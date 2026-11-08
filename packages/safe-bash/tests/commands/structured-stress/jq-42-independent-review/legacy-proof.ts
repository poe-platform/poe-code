import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addArtifact, bytesResult, digest, directory, sourceSnapshot } from "./common.mjs";
import { loadEvidence } from "./evidence.mjs";
import { chunks, collector, quote, type BytesResult } from "./harness.js";

interface Probe {
  id: string;
  assertion: string;
  group: string;
  argv: string[];
  inputHex: string;
  files?: Record<string, string>;
  historicalExpected?: BytesResult;
  policy?: string;
}
interface Fixture {
  id: string;
  argv: string[];
  inputHex: string;
  files?: { path: string; inputHex: string }[];
  stdout: string;
  stderr: string;
  status: number;
  policy?: string;
}
const before = sourceSnapshot();
assert.equal(before.structuredSha256, "66dc67c31edcaf32c63b635b0d559545894ab83751b677750494fa16001ced9c");
const evidence = loadEvidence();
const probes: Probe[] = [];
const add = (id: string, assertion: string, group: string, argv: string[], input: string | Uint8Array) => {
  probes.push({ id, assertion, group, argv, inputHex: Buffer.from(input).toString("hex") });
};
for (const id of ["raw-lone-continuation", "raw-truncated", "raw-bad-continuation", "json-bad-string"]) {
  const vector = evidence.historical.find(vector => vector.id === id)!;
  probes.push({ id: `strict-${id}`, assertion: `strict UTF-8 rejection remains chunk invariant (not native parity): ${id}`, group: "explicit-strict-utf8-retirement", argv: vector.argv!, inputHex: vector.inputHex, historicalExpected: bytesResult(vector.expected) });
}
const rawBytes = readFileSync(join(directory, "../raw-input-native.json"));
const raw = JSON.parse(rawBytes.toString()) as { cases: Fixture[] };
for (const fixture of raw.cases.filter(fixture => fixture.policy)) {
  probes.push({ id: fixture.id, assertion: `raw native: ${fixture.id}`, group: fixture.policy === "stop-first-runtime-error" ? "explicit-stop-first-retirement" : "explicit-strict-utf8-retirement", argv: fixture.argv, inputHex: fixture.inputHex, files: Object.fromEntries((fixture.files ?? []).map(file => [file.path, file.inputHex])), policy: fixture.policy!, historicalExpected: { status: fixture.status, stdoutHex: Buffer.from(fixture.stdout).toString("hex"), stderrHex: Buffer.from(fixture.stderr).toString("hex") } });
}
add("malformed-14", "strict malformed JSON 14 across chunk boundaries", "non-native-low-surrogate-rejection", ["-c", "."], '"\\uDC00"');
add("malformed-16", "strict malformed JSON 16 across chunk boundaries", "non-native-terminal-nul-rejection", ["-c", "."], "null\0");
for (const [index, invalid] of [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf0, 0x9f], [0x80]].entries()) {
  add(`outside-string-${index}`, "invalid UTF-8 never becomes replacement text", "old-utf8-diagnostic-regex", ["-c", "."], Buffer.concat([Buffer.from("{}\n"), Buffer.from(invalid)]));
}
for (const [suffixIndex, suffix] of [[0xff], [0xc3], [0xc3, 0x28], [0xed, 0xa0, 0x80], [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80]].entries()) {
  for (const [prefixIndex, prefix] of ['{}\n', '"😀"\n1\n', '{"a":[1]}\n"incomplete'].entries()) {
    for (const flag of ["-c", "-sc"]) add(`prefix-${prefixIndex}-${suffixIndex}-${flag}`, "malformed UTF-8 preserves completed JSON prefix across every chunk split", "old-utf8-diagnostic-regex", [flag, "."], Buffer.concat([Buffer.from(prefix), Buffer.from(suffix)]));
  }
}
const resourceAssertion = "valid large decimals survive while malformed JSON and division by zero fail";
for (const [index, input] of ["NaN", "Infinity", "-Infinity", '"\\uD800"', '"\\uDC00"', '[}', '{"a":}', "01", "1.", "1e", "truefalse", '"bad\nstring"', "[1,]", '{"a":0,}', "\uFEFF0"].entries()) add(`resource-json-${index}`, resourceAssertion, "resource-composite-control", ["-c", "."], input);
for (const [index, bytes] of [[255], [0xc3], [0xc3, 0x28], [0xed, 0xa0, 0x80]].entries()) add(`resource-utf8-${index}`, resourceAssertion, "resource-composite-control", ["-c", "."], Buffer.from(bytes));
for (const [index, filter] of ["1/0", "0/0", "1%0", "1e308*1e308", '"1e9999"|tonumber', '"[1e9999]"|fromjson'].entries()) add(`resource-filter-${index}`, resourceAssertion, "resource-composite-control", ["-nc", filter], "");
for (const [index, input] of ['1e9999', '[1e9999]', '{"a":1e9999}', '"\\uD83D\\uDE00"'].entries()) add(`resource-large-${index}`, resourceAssertion, "resource-composite-control", ["-c", "."], input);
assert.equal(new Set(probes.map(probe => probe.assertion)).size, 22);
const joins = JSON.parse(readFileSync(join(directory, "../join-native.json"), "utf8")) as { cases: (Fixture & { input: string })[] };
for (const id of ["join-zero-arity", "join-two-arity"]) {
  const fixture = joins.cases.find(fixture => fixture.id === id)!;
  probes.push({ id, assertion: "four-author-reported-gaps", group: "supplementary-diagnostic-gap", argv: fixture.argv, inputHex: fixture.inputHex ?? Buffer.from(fixture.input).toString("hex"), historicalExpected: { status: fixture.status, stdoutHex: Buffer.from(fixture.stdout).toString("hex"), stderrHex: Buffer.from(fixture.stderr).toString("hex") } });
}
add("generator-error-after-output", "four-author-reported-gaps", "supplementary-diagnostic-gap", ["-c", 'split((",", .missing))'], '"a,b"\n');
add("generator-error-before-typecheck", "four-author-reported-gaps", "supplementary-diagnostic-gap", ["-c", "split(.missing)"], "1\n");
const parseProbe = evidence.independent.find(vector => vector.id === "review-fromjson-two-error-records")!;
probes.push({ id: parseProbe.id, assertion: "reviewer-diagnostic-failure", group: "reviewer-diagnostic-failure", argv: parseProbe.argv!, inputHex: parseProbe.inputHex, historicalExpected: bytesResult(parseProbe.expected) });
assert.equal(new Set(probes.map(probe => probe.id)).size, probes.length);
const executable = "/usr/bin/jq";
const executableSha256 = digest(readFileSync(executable));
assert.equal(executableSha256, "1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f");
const environment = { LC_ALL: "C", LANG: "C", TZ: "UTC", NO_COLOR: "1", PATH: "/usr/bin:/bin" };
const native = (argv: string[], inputHex = "", files: Record<string, string> = {}): BytesResult => {
  const temporary = mkdtempSync(join(directory, ".legacy-native-"));
  try {
    for (const [name, hex] of Object.entries(files)) {
      assert.match(name, /^[a-z][a-z.-]*$/u);
      writeFileSync(join(temporary, name), Buffer.from(hex, "hex"), { flag: "wx" });
    }
    const result = spawnSync(executable, argv, { input: Buffer.from(inputHex, "hex"), cwd: temporary, env: { ...environment, HOME: temporary }, shell: false, timeout: 2000, maxBuffer: 65536 });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.notEqual(result.status, null);
    return { status: result.status!, stdoutHex: result.stdout.toString("hex"), stderrHex: result.stderr.toString("hex") };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
};
const version = native(["--version"]);
assert.equal(Buffer.from(version.stdoutHex, "hex").toString(), "jq-1.7.1-apple\n");
const frozen = probes.map(probe => ({ ...probe, expected: native(probe.argv, probe.inputHex, probe.files) }));
for (const probe of frozen) if (probe.historicalExpected) assert.deepEqual(probe.expected, probe.historicalExpected, probe.id);
assert.equal(digest(readFileSync(executable)), executableSha256);
const nativeSha256 = addArtifact("legacy-native-proof.json", { recordedAt: new Date().toISOString(), executable, executableSha256, version, environment, node: process.version, platform: process.platform, arch: process.arch, rawFixtureSha256: digest(rawBytes), note: "Independent native freeze before public product import; exact original argv/bytes, no policy substitution. Bounded expansion only of the actual 22 composite legacy assertions plus four reported gaps and one already-frozen reviewer failure. Counts overlap original review, never add to 790.", invocations: frozen.length + 1, probes: frozen });
const { createStructuredCommands, MemoryFileSystem, Shell, structuredCommands } = await import("../../../../src/index.js");
const rows = [];
for (const probe of frozen) {
  for (const route of ["direct", "shell"] as const) for (const transport of ["whole", "bytewise"]) {
    const fs = new MemoryFileSystem();
    for (const [name, hex] of Object.entries(probe.files ?? {})) await fs.writeFile(`/${name}`, Buffer.from(hex, "hex"));
    const stdout = collector();
    const stderr = collector();
    const stdin = chunks(Buffer.from(probe.inputHex, "hex"), transport);
    const signal = AbortSignal.timeout(1500);
    const options = { limits: { maxInputBytes: 65536, maxOutputBytes: 65536, maxValueBytes: 32768, maxResults: 4096, maxSteps: 100000 } };
    const result = route === "direct"
      ? await createStructuredCommands(options).find(command => command.name === "jq")!.execute({ command: "jq", args: probe.argv, fs, cwd: "/", env: {}, stdin, stdinIsDefault: false, stdout: stdout.sink, stderr: stderr.sink, signal })
      : await new Shell({ fs, cwd: "/", env: {}, limits: { maxOutputBytes: 65536 } }).use(structuredCommands(options)).exec(["jq", ...probe.argv.map(quote)].join(" "), { stdin, stdout: stdout.sink, stderr: stderr.sink, signal });
    const actual = { status: result.exitCode, stdoutHex: stdout.hex(), stderrHex: stderr.hex() };
    const differingFields = (["status", "stdoutHex", "stderrHex"] as const).filter(field => actual[field] !== probe.expected[field]);
    rows.push({ id: probe.id, assertion: probe.assertion, group: probe.group, route, transport, expected: probe.expected, actual, differingFields, pass: differingFields.length === 0 });
  }
}
const after = sourceSnapshot();
const stableStructured = before.structuredSha256 === after.structuredSha256;
const stableProduct = before.productSha256 === after.productSha256;
addArtifact("legacy-product-proof.json", { recordedAt: new Date().toISOString(), nativeSha256, before, after, stableStructured, stableProduct, vectors: frozen.length, executions: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, rows });
console.log(JSON.stringify({ vectors: frozen.length, executions: rows.length, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, stableStructured, stableProduct, failures: rows.filter(row => !row.pass && row.route === "direct" && row.transport === "whole").map(row => ({ id: row.id, differingFields: row.differingFields })) }, null, 2));
process.exitCode = !stableStructured || !stableProduct ? 2 : rows.some(row => !row.pass) ? 1 : 0;
