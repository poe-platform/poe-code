import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { root, owned, stress, author, review, digest, read, json, artifact, key } from './common.mjs';

const map = json(`${owned}/row-map-v3.json`);
const audit = json(`${review}/audit.json`);
const files = new Map();
function file(path, patch = 'native') {
  if (!files.has(path)) files.set(path, { path, patch, before: read(path), edits: [] });
  return files.get(path);
}
function edit(path, oldText, newText, reason, patch = 'native') {
  const target = file(path, patch);
  const start = target.before.indexOf(oldText);
  assert.ok(start >= 0 && target.before.indexOf(oldText, start + 1) === -1, `${path}: nonunique/missing ${reason}`);
  assert.ok(oldText.endsWith('\n') && newText.endsWith('\n'));
  assert.ok(start === 0 || target.before[start - 1] === '\n');
  target.edits.push({ start, end: start + oldText.length, oldText, newText, reason });
}
function addImport(path, anchor, line) { edit(path, `${anchor}\n`, `${anchor}\n${line}\n`, 'test-only exact native assertion import'); }
const expectationPath = `${stress}/jq-grammar-native-v3.json`;
const vectors = [];
for (const row of map.rows) for (const item of row.constituents) {
  const existing = vectors.find(vector => key(vector) === key(item));
  if (existing) { assert.deepEqual(existing.expected, item.expected); existing.ids.push(item.id); }
  else vectors.push({ ids: [item.id], argv: item.argv, inputHex: item.inputHex, files: item.files, expected: item.expected });
}
const expectationText = `${JSON.stringify({ version: 3, nativeProofPath: `${owned}/native-v3.json`, nativeProofSha256: digest(read(`${owned}/native-v3.json`)),
  literalFileLimit: 'Two frozen historical literal-file tuples retained; new literal-file verification unavailable. Prior fd controls are not literal-file evidence.',
  vectors, byteMutants: audit.byteMutationDemonstrations }, null, 2)}\n`;
files.set(expectationPath, { path: expectationPath, patch: 'native', before: null, after: expectationText, edits: [] });
const nativeHelperPath = `${stress}/jq-grammar-native-v3.ts`;
const nativeHelper = `import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

interface NativeTuple { status: number; stdoutHex: string; stderrHex: string }
interface NativeVector { ids: string[]; argv: string[]; inputHex: string; files: Record<string, string>; expected: NativeTuple }
interface ByteMutant { id: string; expectedHex: string; mutantHex: string }
export const nativeGrammar = JSON.parse(readFileSync(new URL("./jq-grammar-native-v3.json", import.meta.url), "utf8")) as { vectors: NativeVector[]; byteMutants: ByteMutant[] };
const inputKey = (argv: readonly string[], inputHex: string, files: Readonly<Record<string, string>>) => JSON.stringify([argv, inputHex, Object.entries(files).sort(([left], [right]) => left.localeCompare(right))]);
const expectedByInput = new Map<string, NativeTuple>();
for (const vector of nativeGrammar.vectors) {
  const key = inputKey(vector.argv, vector.inputHex, vector.files);
  assert.ok(!expectedByInput.has(key), "duplicate frozen native input");
  expectedByInput.set(key, vector.expected);
}

export function nativeExpected(argv: readonly string[], input: string | Uint8Array, files: Readonly<Record<string, string>> = {}): NativeTuple {
  assert.ok(typeof input === "string" || input instanceof Uint8Array, "explicit actual input required");
  const inputHex = Buffer.from(input).toString("hex");
  const expected = expectedByInput.get(inputKey(argv, inputHex, files));
  assert.ok(expected, "missing frozen native input");
  return expected;
}

export function assertNative(result: { status?: number; exitCode?: number; stdoutBytes: Uint8Array; stderrBytes: Uint8Array }, argv: readonly string[], input: string | Uint8Array, files: Readonly<Record<string, string>> = {}): void {
  assert.ok(result.stdoutBytes instanceof Uint8Array && result.stderrBytes instanceof Uint8Array, "raw captured bytes required");
  assert.deepEqual({ status: result.status ?? result.exitCode, stdoutHex: Buffer.from(result.stdoutBytes).toString("hex"), stderrHex: Buffer.from(result.stderrBytes).toString("hex") }, nativeExpected(argv, input, files));
}
`;
files.set(nativeHelperPath, { path: nativeHelperPath, patch: 'native', before: null, after: nativeHelper, edits: [] });
const mutationPath = `${stress}/jq-grammar-byte-assertions-v3.test.ts`;
files.set(mutationPath, { path: mutationPath, patch: 'native', before: null, after: `import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNative, nativeExpected, nativeGrammar } from "./jq-grammar-native-v3.js";

for (const mutant of nativeGrammar.byteMutants) test(\x60native grammar byte assertion rejects documented mutant: \x24{mutant.id}\x60, () => {
  const vector = nativeGrammar.vectors.find(vector => vector.ids.includes(mutant.id));
  assert.ok(vector);
  assert.equal(vector.expected.stdoutHex, mutant.expectedHex);
  const actual = { status: vector.expected.status, stdoutBytes: Buffer.from(mutant.expectedHex, "hex"), stderrBytes: Buffer.from(vector.expected.stderrHex, "hex") };
  const input = Buffer.from(vector.inputHex, "hex");
  assertNative(actual, vector.argv, input, vector.files);
  assert.equal(Buffer.from(mutant.mutantHex, "hex").toString(), actual.stdoutBytes.toString());
  assert.throws(() => assertNative({ ...actual, stdoutBytes: Buffer.from(mutant.mutantHex, "hex") }, vector.argv, input, vector.files), assert.AssertionError);
});

test("native grammar lookup requires exact argv, input and files", () => {
  assert.throws(() => nativeExpected(["not-a-frozen-filter"], "null"), /missing frozen native input/u);
  assert.throws(() => nativeExpected(["-nc", "1/0"], ""), /missing frozen native input/u);
  assert.equal(nativeExpected(["-nc", "1/0"], "null").status, 5);
  assert.throws(() => nativeExpected(["-Rc", ".", "unicode-start", "-"], Buffer.from("98800a", "hex")), /missing frozen native input/u);
});
`, edits: [] });

const stressHelper = `${stress}/harness.ts`;
edit(stressHelper, 'export async function execute(\n', 'export async function executeWithBytes(\n', 'opt-in raw helper; legacy wrapper retains original shape');
edit(stressHelper,
  '  return { status: result.exitCode, stdout: Buffer.concat(output.stdout).toString(), stderr: Buffer.concat(output.stderr).toString() };\n',
  '  const stdoutBytes = Buffer.concat(output.stdout);\n  const stderrBytes = Buffer.concat(output.stderr);\n  return { status: result.exitCode, stdout: stdoutBytes.toString(), stderr: stderrBytes.toString(), stdoutBytes, stderrBytes };\n', 'raw copied chunks exposed without decoded reconstruction');
edit(stressHelper, 'export async function check(fixture: Fixture) {\n',
  'export async function execute(...args: Parameters<typeof executeWithBytes>) {\n  const { status, stdout, stderr } = await executeWithBytes(...args);\n  return { status, stdout, stderr };\n}\n\nexport async function check(fixture: Fixture) {\n', 'legacy return fields and default stdin unchanged');
const structuredHelper = 'tests/commands/structured/helpers.ts';
const runSignature = file(structuredHelper).before.split('\n').find(line => line.startsWith('export async function run('));
edit(structuredHelper, `${runSignature}\n`, `${runSignature.replace('function run(', 'function runWithBytes(')}\n`, 'opt-in structured raw helper');
edit(structuredHelper, '    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },\n    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },\n',
  '    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },\n    stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },\n', 'copy raw Uint8Array/Buffer chunks before host reuse');
edit(structuredHelper, '  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), context };\n',
  '  const stdoutBytes = Buffer.concat(stdout);\n  const stderrBytes = Buffer.concat(stderr);\n  return { ...result, stdout: stdoutBytes.toString(), stderr: stderrBytes.toString(), context, stdoutBytes, stderrBytes };\n', 'retain command result/context and expose raw bytes');
edit(structuredHelper, 'export async function* chunks(input: string | Uint8Array, size = 1): ByteSource {\n',
  'export async function run(...args: Parameters<typeof runWithBytes>) {\n  const { stdoutBytes: _stdoutBytes, stderrBytes: _stderrBytes, ...result } = await runWithBytes(...args);\n  return result;\n}\n\nexport async function* chunks(input: string | Uint8Array, size = 1): ByteSource {\n', 'legacy run shape preserved including context/result fields');

const increment = `${stress}/independent-increment/safety.test.ts`;
addImport(increment, 'import { allVectors, executeBytes, expectedBytes } from "./harness.js";', 'import { nativeExpected } from "../jq-grammar-native-v3.js";');
edit(increment, '  test(`strict UTF-8 rejection remains chunk invariant (not native parity): ${id}`, async () => {\n', '  test(`native UTF-8 replacement remains chunk invariant: ${id}`, async () => {\n', 'rows 1–4 explicit name correction');
edit(increment, '    assert.equal(baseline.status, 5);\n    assert.match(Buffer.from(baseline.stderrHex, "hex").toString(), /invalid UTF-8/u);\n',
  '    assert.deepEqual(baseline, nativeExpected(vector.argv!, input));\n', 'baseline input remains bytes; every source() split remains identical');

const raw = `${stress}/raw-input.test.ts`;
edit(raw, 'import { execute } from "./harness.js";\n', 'import { execute, executeWithBytes } from "./harness.js";\nimport { assertNative } from "./jq-grammar-native-v3.js";\n', 'raw selected-path helper import');
const rawIds = map.rows.slice(4, 17).map(row => row.constituents[0].id);
edit(raw, 'for (const fixture of corpus.cases) test(`raw native: ${fixture.id}`, async () => {\n',
  `const nativeOverrides = new Set(${JSON.stringify(rawIds)});\nfor (const fixture of corpus.cases) test(\x60raw native: \x24{fixture.id}\x60, async () => {\n`, 'exactly thirteen raw fixture overrides');
edit(raw, '    const result = await execute(fixture.argv, input, {}, { fs });\n',
  '    if (nativeOverrides.has(fixture.id)) {\n      const result = await executeWithBytes(fixture.argv, input, {}, { fs });\n      const files = Object.fromEntries((fixture.files ?? []).map(file => [file.path, file.inputHex]));\n      assertNative(result, fixture.argv, Buffer.from(fixture.inputHex, "hex"), files);\n      continue;\n    }\n    const result = await execute(fixture.argv, input, {}, { fs });\n', 'selected exact bytes; original unselected branch unchanged');

const safety = `${stress}/safety.test.ts`;
edit(safety, 'import { execute } from "./harness.js";\n', 'import { execute, executeWithBytes } from "./harness.js";\nimport { assertNative } from "./jq-grammar-native-v3.js";\n', 'selected safety assertions import');
const malformedHeader = 'for (const [index, input] of malformed.entries()) test(`${input === \'1e9999\' ? \'valid large exponent\' : \'strict malformed JSON\'} ${index} across chunk boundaries`, { timeout: 3000 }, async () => {\n';
edit(safety, malformedHeader,
  'const nativeAcceptanceOverrides = new Set([5, 14, 15, 16, 21, 22]);\nfor (const [index, input] of malformed.entries()) test(`${nativeAcceptanceOverrides.has(index) ? \'native JSON acceptance\' : input === \'1e9999\' ? \'valid large exponent\' : \'strict malformed JSON\'} ${index} across chunk boundaries`, { timeout: 3000 }, async () => {\n', 'six names only; native-success index20 and other seventeen branches untouched');
const malformedAssertion = "    assert.equal(result.status, input === '1e9999' ? 0 : 5, JSON.stringify({ input, size, result }));\n";
edit(safety, "    const result = await execute(['-c', '.'], split(Buffer.from(input), size));\n" + malformedAssertion,
  "    if (nativeAcceptanceOverrides.has(index)) {\n      const result = await executeWithBytes(['-c', '.'], split(Buffer.from(input), size));\n      assertNative(result, ['-c', '.'], input);\n      continue;\n    }\n    const result = await execute(['-c', '.'], split(Buffer.from(input), size));\n" + malformedAssertion, 'six acceptance overrides, no expansion of neighboring failures');
edit(safety, "test('invalid UTF-8 never becomes replacement text', async () => {\n", "test('invalid UTF-8 JSON tokens preserve prefix and native diagnostics', async () => {\n", 'row20 accurate name');
edit(safety, "      const result = await execute(['-c', '.'], split(bytes, size));\n      assert.equal(result.status, 5);\n      assert.equal(result.stdout, '{}\\n');\n      assert.match(result.stderr, /UTF-8/u);\n",
  "      const result = await executeWithBytes(['-c', '.'], split(bytes, size));\n      assertNative(result, ['-c', '.'], bytes);\n", 'row20 only; stop before preflight and all unrelated safety');

const cli = 'tests/commands/structured/cli.test.ts';
const cliImport = file(cli).before.split('\n').find(line => line.includes('from "./helpers.js"'));
edit(cli, `${cliImport}\n`, `${cliImport.replace('{ ', '{ runWithBytes, ')}\nimport { assertNative } from "../structured-stress/jq-grammar-native-v3.js";\n`, 'CLI opt-in byte assertion imports');
edit(cli, '      const expected = prefix === \'{}\\n\' ? \'{}\\n\' : prefix.startsWith(\'"😀"\') ? \'"😀"\\n1\\n\' : \'{"a":[1]}\\n\';\n', '\n', 'native exact tuples contain completed prefixes');
edit(cli, '        const result = await run(["-c", "."], source);\n        assert.equal(result.exitCode, 5); assert.equal(result.stdout, expected, `${suffix} split ${split}`); assert.match(result.stderr, /invalid UTF-8/);\n',
  '        const result = await runWithBytes(["-c", "."], source);\n        assertNative(result, ["-c", "."], bytes);\n', 'inclusive split source remains unchanged');
edit(cli, '      const single = await run(["-c", "."], chunks(bytes)); assert.equal(single.stdout, expected); assert.equal(single.exitCode, 5);\n      const slurp = await run(["-sc", "."], bytes); assert.equal(slurp.stdout, ""); assert.equal(slurp.exitCode, 5);\n',
  '      const single = await runWithBytes(["-c", "."], chunks(bytes));\n      assertNative(single, ["-c", "."], bytes);\n      const slurp = await runWithBytes(["-sc", "."], bytes);\n      assertNative(slurp, ["-sc", "."], bytes);\n', 'exact single and slurp stderr as well as status/prefix');

const resources = 'tests/commands/structured/resources.test.ts';
const resourceImport = file(resources).before.split('\n').find(line => line.includes('from "./helpers.js"'));
edit(resources, `${resourceImport}\n`, `${resourceImport.replace('{ ', '{ runWithBytes, ')}\nimport { assertNative } from "../structured-stress/jq-grammar-native-v3.js";\n`, 'resource opt-in bytes import');
edit(resources, 'test("valid large decimals survive while malformed JSON and division by zero fail", async () => {\n', 'test("native JSON grammar, large decimals and division diagnostics", async () => {\n', 'mixed resource test accurate name');
map.rows[21].newTestName = 'native JSON grammar, large decimals and division diagnostics';
edit(resources, '    const result = await run(["-c", "."], input);\n    assert.equal(result.exitCode, 5, input); assert.equal(result.stdout, "", input);\n',
  '    const result = await runWithBytes(["-c", "."], input);\n    assertNative(result, ["-c", "."], input);\n', 'all fifteen JSON constituents retained');
edit(resources, '    const result = await run(["-c", "."], Uint8Array.from(bytes)); assert.equal(result.exitCode, 5); assert.equal(result.stdout, "");\n',
  '    const result = await runWithBytes(["-c", "."], Uint8Array.from(bytes));\n    assertNative(result, ["-c", "."], Uint8Array.from(bytes));\n', 'all four byte inputs retained');
edit(resources, '    const result = await run(["-nc", filter]); assert.equal(result.exitCode, 5, filter); assert.equal(result.stdout, "");\n',
  '    const result = await runWithBytes(["-nc", filter]);\n    assertNative(result, ["-nc", filter], "null");\n', 'division filters keep implicit helper default null');
edit(resources, '    const result = await run(["-c", "."], input);\n    assert.equal(result.exitCode, 0, result.stderr);\n    assert.equal(result.stdout, `${input.replace("e", "E+")}\\n`);\n',
  '    const result = await runWithBytes(["-c", "."], input);\n    assertNative(result, ["-c", "."], input);\n', 'all three large decimals retained');
edit(resources, '    const result = await run(["-nc", filter!]);\n    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, `${expected}\\n`);\n',
  '    const result = await runWithBytes(["-nc", filter!]);\n    assertNative(result, ["-nc", filter!], "null");\n    assert.equal(result.stdout, `${expected}\\n`);\n', 'arithmetic and conversions retain filters, expected strings, implicit null');
edit(resources, String.raw`  assert.equal((await run(["-c", "."], '"\\uD83D\\uDE00"')).stdout, '"😀"\n');` + '\n',
  String.raw`  const surrogate = await runWithBytes(["-c", "."], '"\\uD83D\\uDE00"');` + '\n' + String.raw`  assertNative(surrogate, ["-c", "."], '"\\uD83D\\uDE00"');` + '\n', 'inline surrogate preserved as explicit captured invocation');

const join = `${stress}/join.test.ts`;
edit(join, 'import { execute, type Fixture } from "./harness.js";\n', 'import { execute, executeWithBytes, type Fixture } from "./harness.js";\nimport { assertNative } from "./jq-grammar-native-v3.js";\n', 'join exact compiler diagnostics import');
edit(join, '  const result = await execute(fixture.argv, fixture.input);\n',
  '  if (fixture.id === "join-zero-arity" || fixture.id === "join-two-arity") {\n    const result = await executeWithBytes(fixture.argv, fixture.input);\n    assertNative(result, fixture.argv, fixture.input);\n    return;\n  }\n  const result = await execute(fixture.argv, fixture.input);\n', 'only join0/join2 compile diagnostics; others untouched');
const split = `${stress}/split-increment/command.test.ts`;
edit(split, 'import { execute } from "../harness.js";\n', 'import { execute, executeWithBytes } from "../harness.js";\nimport { assertNative } from "../jq-grammar-native-v3.js";\n', 'split0 exact bytes helper import');
edit(split, 'for (const filter of ["split", \'split(","; "g")\']) test(`split rejects out-of-scope arity: ${filter}`, { timeout: 3000 }, async () => {\n',
  'for (const filter of ["split", \'split(","; "g")\']) test(`${filter === "split" ? "split rejects undefined native arity" : "split rejects out-of-scope arity"}: ${filter}`, { timeout: 3000 }, async () => {\n', 'rename split0 only; split2 name/guard unchanged');
edit(split, '  const actual = await execute([filter], { [Symbol.asyncIterator]() { acquired = true; throw new Error("input must not be acquired"); } });\n',
  '  if (filter === "split") {\n    const actual = await executeWithBytes([filter], { [Symbol.asyncIterator]() { acquired = true; throw new Error("input must not be acquired"); } });\n    assertNative(actual, [filter], "");\n    assert.equal(acquired, false);\n    return;\n  }\n  const actual = await execute([filter], { [Symbol.asyncIterator]() { acquired = true; throw new Error("input must not be acquired"); } });\n', 'split0 exact compiler-only oracle; retain split2 branch bytewise');

const host = `${stress}/jq-42-author-20260827/safety.test.ts`;
edit(host, '  const running = executeBytes(["-c", "."], source, {}, { stdout: { async write() { writes++; throw error; } } });\n  if (error instanceof FsError) await assert.rejects(running, failure => failure === error);\n  else assert.equal((await running).status, 5);\n',
  '  let stderrWrites = 0;\n  const running = executeBytes(["-c", "."], source, {}, {\n    stdout: { async write() { writes++; throw error; } },\n    ...(error instanceof JqError ? { stderr: { async write() { stderrWrites++; } } } : {}),\n  });\n  await assert.rejects(running, failure => failure === error);\n  if (error instanceof JqError) assert.equal(stderrWrites, 0);\n', 'CONDITIONAL host JqError identity/no stderr; EPIPE behavior unchanged', 'host');

const manifests = [];
const patchParts = { native: [], host: [] };
for (const target of files.values()) {
  if (target.before !== null) {
    target.edits.sort((left, right) => left.start - right.start);
    let previous = 0;
    let after = '';
    const preserved = [];
    for (const change of target.edits) {
      assert.ok(change.start >= previous, `${target.path}: overlapping spans`);
      const unchanged = target.before.slice(previous, change.start);
      preserved.push({ beforeStartByte: Buffer.byteLength(target.before.slice(0, previous)), afterStartByte: Buffer.byteLength(after), bytes: Buffer.byteLength(unchanged), sha256: digest(unchanged) });
      after += unchanged + change.newText;
      previous = change.end;
    }
    const unchanged = target.before.slice(previous);
    preserved.push({ beforeStartByte: Buffer.byteLength(target.before.slice(0, previous)), afterStartByte: Buffer.byteLength(after), bytes: Buffer.byteLength(unchanged), sha256: digest(unchanged) });
    target.after = after + unchanged;
    target.preserved = preserved;
    artifact(`before/${target.path}.txt`, target.before);
  }
  artifact(`after-${target.patch}/${target.path}.txt`, target.after);
  const beforePath = target.before === null ? '/dev/null' : `${owned}/before/${target.path}.txt`;
  const afterPath = `${owned}/after-${target.patch}/${target.path}.txt`;
  const diff = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', beforePath, afterPath], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(diff.status, 1, diff.stderr);
  let patch = diff.stdout;
  patch = patch.replace(/^diff --git .*$/m, `diff --git a/${target.path} b/${target.path}`)
    .replace(/^--- .*$/m, target.before === null ? '--- /dev/null' : `--- a/${target.path}`)
    .replace(/^\+\+\+ .*$/m, `+++ b/${target.path}`);
  patchParts[target.patch].push(patch);
  manifests.push({ path: target.path, patch: target.patch, beforeSha256: target.before === null ? null : digest(target.before), afterSha256: digest(target.after),
    beforeSnapshot: target.before === null ? null : beforePath, afterSnapshot: afterPath,
    edits: target.edits.map(change => ({ ...change, startByte: Buffer.byteLength(target.before.slice(0, change.start)), endByte: Buffer.byteLength(target.before.slice(0, change.end)), oldSha256: digest(change.oldText), newSha256: digest(change.newText) })),
    preserved: target.preserved ?? [], newCanonicalFile: target.before === null });
}
artifact('native-v3.patch', patchParts.native.join(''));
artifact('host-conditional-v3.patch', patchParts.host.join(''));
artifact('patch-manifest-v3.json', { version: 3, applied: false, files: manifests, patches: Object.fromEntries(Object.entries(patchParts).map(([name, parts]) => [name, digest(parts.join(''))])) });
artifact('row-map-final-v3.json', map);
console.log(JSON.stringify({ files: manifests.length, nativeFiles: manifests.filter(item => item.patch === 'native').length, hostFiles: manifests.filter(item => item.patch === 'host').length, nonoverlappingEdits: manifests.reduce((sum, item) => sum + item.edits.length, 0) }));
