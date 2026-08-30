import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const snapshot = process.argv[2];
const history = JSON.parse(await readFile(new URL("./HISTORICAL10.json", import.meta.url), "utf8"));
const { createExprCommand } = await import(pathToFileURL(join(snapshot, "dist/commands/expr/index.js")));
const { createMemoryFileSystem } = await import(pathToFileURL(join(snapshot, "dist/fs/memory/index.js")));
const { exprMatchCeilings, validateExprInput } = await import(pathToFileURL(join(snapshot, "dist/commands/regex-execution/protocol.js")));

async function run(argv, env, options = {}) {
  const stdout = [], stderr = [];
  const originalEnv = structuredClone(env);
  const context = {
    command: "expr", args: argv, cwd: "/", env,
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error("expr acquired stdin"); } },
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
  };
  const result = await createExprCommand(options).execute(context);
  assert.deepEqual(env, originalEnv);
  return { status: result.exitCode, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") };
}

const named = [], scalarCounterfactuals = [];
for (const row of history.rows) {
  const actual = await run(row.input.argv, row.virtualInvocation.environment);
  assert.deepEqual(actual, { status: row.actual.status, stdoutHex: row.actual.stdout.hex, stderrHex: row.actual.stderr.hex }, row.id);
  named.push({ id: row.id, environment: row.virtualInvocation.environment, actual, historicalMismatchRetained: true });
  if (row.id !== "unicode-collation") {
    const environment = { ...row.virtualInvocation.environment, LC_ALL: "C.UTF-8" };
    const scalar = await run(row.input.argv, environment);
    assert.deepEqual(scalar, { status: row.expected.status, stdoutHex: row.expected.stdout.hex, stderrHex: row.expected.stderr.hex }, row.id);
    scalarCounterfactuals.push({ id: row.id, originalEnvironment: row.virtualInvocation.environment, environment, actual: scalar,
      qualification: "Different explicitly selected C.UTF-8 control; scalar machinery evidence only, NOT named-locale execution or support." });
  }
}

const controls = [];
for (const [id, argv, env, status, stdout, options] of [
  ["default-is-byte-no-ambient", ["length", "é"], {}, 0, "2\n"],
  ["empty-default-is-byte-no-ambient", ["length", "é"], { LC_ALL: "", LC_CTYPE: "", LC_COLLATE: "", LANG: "" }, 0, "2\n"],
  ["arithmetic-unknown-locale", ["40", "+", "2"], { LC_ALL: "unknown" }, 0, "42\n"],
  ["numeric-relation-unknown-locale", ["1", "<", "2"], { LC_ALL: "unknown" }, 0, "1\n"],
  ["ctype-unneeded-qualified-collation", ["a", "<", "b"], { LC_CTYPE: "unknown", LC_COLLATE: "C" }, 0, "1\n"],
  ["scalar-literal", ["é😀", ":", "é"], { LC_ALL: "C.UTF-8" }, 0, "1\n"],
  ["scalar-backreference", ["éé", ":", "\\(é\\)\\1"], { LC_ALL: "C.UTF-8" }, 0, "é\n"],
  ["escaped-bracket-literal", ["[", ":", "\\["], { LC_ALL: "C.UTF-8" }, 0, "1\n"],
  ["backreference-bounded-states", ["aaaaaaaaab", ":", "\\(a*\\)\\1$"], { LC_ALL: "C.UTF-8" }, 3, "", { limits: { maxRegexStates: 1 } }],
]) {
  const actual = await run(argv, env, options);
  assert.equal(actual.status, status, id);
  assert.equal(actual.stdoutHex, Buffer.from(stdout).toString("hex"), id);
  if (status === 3) assert.equal(Buffer.from(actual.stderrHex, "hex").toString(), "expr: regex states limit exceeded\n");
  else assert.equal(actual.stderrHex, "", id);
  controls.push({ id, argv, environment: env, options: options ?? {}, actual });
}

const descriptor = { kind: "expr-match", pattern: Buffer.from("."), profile: "utf8-scalar", limits: exprMatchCeilings };
const input = [{ bytes: Buffer.from("é"), all: false, terminated: false }];
validateExprInput(descriptor, input, new AbortController().signal);
assert.throws(() => validateExprInput({ ...descriptor, locale: "en_US.UTF-8" }, input, new AbortController().signal), /invalid expr request/u);
assert.throws(() => validateExprInput({ ...descriptor, profile: "en_US.UTF-8" }, input, new AbortController().signal), /invalid expr request/u);
console.log(JSON.stringify({ named, scalarCounterfactuals, controls, descriptorControls: { existingAccepted: true, localeFieldRejected: true, namedProfileRejected: true } }));
