import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type ByteSource, type CommandContext } from "../../src/contracts/index.js";
import { numfmtCommand } from "../../src/commands/numfmt.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

async function format(args: readonly string[], input: string | ByteSource, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await numfmtCommand().execute({
    command: "numfmt", args, cwd: "/work", env: { LC_ALL: "C" }, fs: new MemoryFileSystem(),
    stdin: typeof input === "string" ? toByteSource(input) : input,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    signal: new AbortController().signal, ...overrides,
  });
  return { status: result.exitCode, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex") };
}

const captures = [
  { name: "cross-field-abort", args: ["--from=auto", "-d,"], input: "1 ,x\n", status: 2, stdout: "", stderr: "numfmt: invalid suffix in input '1 ': 'x'\n" },
  { name: "minimal-unterminated", args: ["--from=auto", "-d,"], input: "1 ,x", status: 2, stdout: "", stderr: "numfmt: invalid suffix in input '1 ': 'x'\n" },
  { name: "cross-field-si", args: ["--from=si", "-d,"], input: "1 ,x\n", status: 2, stdout: "", stderr: "numfmt: invalid suffix in input '1 ': 'x'\n" },
  { name: "iec-i-lookahead", args: ["--from=iec-i", "-d,"], input: "1 ,i\n", status: 0, stdout: "1,i\n", stderr: "" },
  { name: "stripped-suffix-tail", args: ["--from=auto", "--suffix=xy", "-d,"], input: "1 xy,2\n", status: 2, stdout: "", stderr: "numfmt: invalid suffix in input '1 ': 'y'\n" },
  { name: "embedded-nul-tail", args: ["--from=auto", "-d,"], input: "1 \0x\n", status: 2, stdout: "", stderr: "numfmt: invalid suffix in input '1 ': 'x'\n" },
  { name: "nul-header-fail", args: ["--from=auto", "-d,", "-z", "--header=1", "--invalid=fail"], input: "H\0" + "1 ,x\0" + "2,3\0", status: 2, stdout: "H1 ,x\0" + "2,3\0", stderr: "numfmt: invalid suffix in input '1 ': 'x'\n" },
  { name: "warn-all-fields-debug", args: ["--from=auto", "-d,", "--field=-", "--invalid=warn", "--debug"], input: "1 ,x\n2,3\n", status: 0, stdout: "1 ,x\n2,3\n", stderr: "numfmt: invalid suffix in input '1 ': 'x'\nnumfmt: invalid number: 'x'\nnumfmt: failed to convert some of the input numbers\n" },
  { name: "ignore-cross-field", args: ["--from=auto", "-d,", "--invalid=ignore"], input: "1 ,x\n", status: 0, stdout: "1 ,x\n", stderr: "" },
  { name: "none-rejection-control", args: ["--from=none", "-d,"], input: "1 ,x\n", status: 2, stdout: "", stderr: "numfmt: rejecting suffix in input: '1 ' (consider using --from)\n" },
  { name: "unselected-control", args: ["--from=auto", "-d,", "--field=2"], input: "1 ,2\n", status: 0, stdout: "1 ,2\n", stderr: "" },
  { name: "adjacent-delimiter-tail", args: ["--from=auto", "-d,"], input: "1 ,,x\n", status: 2, stdout: "", stderr: "numfmt: invalid suffix in input '1 ': ',x'\n" },
  { name: "prior-header-short-eof", args: ["--header", "--from=auto", "-d,"], input: "abcXYZ\n1 ", status: 2, stdout: "abcXYZ\n", stderr: "numfmt: invalid suffix in input '1 ': 'XYZ\\n'\n" },
  { name: "prior-number-short-eof", args: ["--from=auto", "-d,"], input: "12345\n1 ", status: 2, stdout: "12345\n", stderr: "numfmt: invalid suffix in input '1 ': '45'\n" },
  { name: "prior-number-newline-control", args: ["--from=auto", "-d,"], input: "12345\n1 \n", status: 0, stdout: "12345\n1\n", stderr: "" },
  { name: "prior-field-mutation-short-eof", args: ["--from=auto", "-d,"], input: "7,89,0\n1 ", status: 2, stdout: "7,89,0\n", stderr: "numfmt: invalid suffix in input '1 ': '9'\n" },
];

for (const capture of captures) test(`numfmt initialized field buffer: ${capture.name}`, async () => {
  const input = capture.name === "embedded-nul-tail" ? { async *[Symbol.asyncIterator]() {
    for (const byte of Buffer.from(capture.input)) yield Uint8Array.of(byte);
  } } : capture.input;
  assert.deepEqual(await format(capture.args, input), {
    status: capture.status,
    stdoutHex: Buffer.from(capture.stdout).toString("hex"),
    stderrHex: Buffer.from(capture.stderr).toString("hex"),
  });
});

for (const capture of captures) test(`numfmt initialized field buffer reused chunks: ${capture.name}`, async () => {
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    const reusable = new Uint8Array(1);
    for (const byte of Buffer.from(capture.input)) { reusable[0] = byte; yield reusable; }
    reusable[0] = 255;
  } };
  assert.deepEqual(await format(capture.args, source), {
    status: capture.status,
    stdoutHex: Buffer.from(capture.stdout).toString("hex"),
    stderrHex: Buffer.from(capture.stderr).toString("hex"),
  });
});

for (const reason of [undefined, null, false, 0, "", NaN]) for (const failure of ["stderr", "return"] as const) test(`numfmt lookahead preserves ${failure} failure ${String(reason)}`, async () => {
  let reads = 0;
  let returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { reads++; return reads === 1 ? { done: false, value: Buffer.from("1 ,x\n") } : { done: true, value: undefined }; },
    async return() { returns++; if (failure === "return") throw reason; return { done: true, value: undefined }; },
  }; } };
  await assert.rejects(format(["--from=auto", "-d,"], source, failure === "stderr" ? { stderr: { async write() { throw reason; } } } : {}), error => Object.is(error, reason));
  assert.equal(reads, 1);
  assert.equal(returns, 1);
});

test("numfmt lookahead yields before diagnosing a long initialized tail", async () => {
  const controller = new AbortController();
  const reason = false;
  let writes = 0;
  const scheduled = setImmediate(() => controller.abort(reason));
  try {
    await assert.rejects(format(["--from=auto", "-d,", `1 ,${"x".repeat(60000)}`], "", {
      signal: controller.signal,
      stdout: { async write() { writes++; } }, stderr: { async write() { writes++; } },
    }), error => error === reason);
    assert.equal(writes, 0);
  } finally { clearImmediate(scheduled); }
});

test("numfmt bounds repeated initialized-tail scans with its existing work budget", async () => {
  let stderrBytes = 0;
  let last = "";
  let returns = 0;
  const source: ByteSource = { async *[Symbol.asyncIterator]() {
    try { yield Buffer.from(`${"1 ,".repeat(32)}${"x".repeat(700000)}\n`); }
    finally { returns++; }
  } };
  const result = await format(["--from=auto", "-d,", "--field=-", "--invalid=warn"], source, {
    stdout: { async write() {} },
    stderr: { async write(bytes) { stderrBytes += bytes.length; last = Buffer.from(bytes).toString("utf8"); } },
  });
  assert.equal(result.status, 1);
  assert.equal(last, "numfmt: numfmt work limit exceeded\n");
  assert.ok(stderrBytes < 32 * 1024 * 1024);
  assert.equal(returns, 1);
});

test("numfmt keeps initialized storage invocation-local and operands independent", async () => {
  await format(["--from=auto", "-d,"], "12345\n");
  const expected = { status: 0, stdoutHex: Buffer.from("1").toString("hex"), stderrHex: "" };
  assert.deepEqual(await format(["--from=auto", "-d,"], "1 "), expected);
  assert.deepEqual(await format(["--from=auto", "-d,", "12345", "1 "], ""), { ...expected, stdoutHex: Buffer.from("12345\n1\n").toString("hex") });
});
