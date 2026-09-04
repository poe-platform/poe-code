import assert from "node:assert/strict";
import { test } from "node:test";
import { chunks, fixture, run } from "./helpers.js";

const cases = [
  { name: "issue mid-file bytes", args: ["-c", "1-2"], input: "410aefbbbf420a", output: "410aefbbbf420a" },
  { name: "BOM is the first character of each line", args: ["-c", "1"], input: "efbbbf410aefbbbf420a", output: "efbbbf0aefbbbf0a" },
  { name: "character after BOM", args: ["-c", "2"], input: "efbbbf410aefbbbf420a", output: "410a420a" },
  { name: "successive BOM characters", args: ["-c", "1-2"], input: "efbbbfefbbbf580a", output: "efbbbfefbbbf0a" },
  { name: "interior BOM", args: ["-c", "2"], input: "41efbbbf420a", output: "efbbbf0a" },
  { name: "astral character uses one position", args: ["-c", "2-3"], input: "efbbbff09f9982c3a95a0a", output: "f09f9982c3a90a" },
  { name: "byte mode keeps BOM bytes", args: ["-b", "1-3"], input: "efbbbf420a", output: "efbbbf0a" },
  { name: "byte mode can split BOM bytes", args: ["-b", "1-2"], input: "efbbbf420a", output: "efbb0a" },
  { name: "unterminated BOM record", args: ["-c", "1-"], input: "efbbbf", output: "efbbbf0a" },
  { name: "CRLF framing", args: ["-c", "1-"], input: "efbbbf410d0a", output: "efbbbf410d0a" },
  { name: "NUL framing", args: ["-z", "-c", "1"], input: "efbbbf4100efbbbf42", output: "efbbbf00efbbbf00" },
  { name: "replacement decoding remains nonfatal", args: ["-c", "1-"], input: "efbbbfff420a", output: "efbbbfefbfbd420a" },
];

for (const specimen of cases) for (const source of ["stdin", "single-byte chunks", "file"] as const) {
  test(`cut BOM: ${specimen.name} from ${source}`, async () => {
    const input = Buffer.from(specimen.input, "hex");
    const fs = await fixture(source === "file" ? { input } : {});
    const result = await run("cut", [...specimen.args, ...(source === "file" ? ["input"] : [])], {
      fs,
      ...(source === "file" ? {} : { stdin: source === "single-byte chunks" ? chunks(input, 1) : input }),
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdoutBytes.toString("hex"), specimen.output);
  });
}

test("cut BOM: code-point positions survive the existing 4096-byte decoder boundary", async () => {
  const input = "\ufeff" + "a".repeat(4092) + "🙂éZ\n";
  const result = await run("cut", ["-c", "4094-4095"], { stdin: input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdoutBytes.toString("hex"), "f09f9982c3a90a");
});

test("cut BOM: cancellation after decoding preserves reason and closes input", async context => {
  const controller = new AbortController();
  const reason = new Error("stop cut decode");
  let reads = 0;
  let closed = false;
  let decoded = 0;
  async function* input() {
    try {
      reads++;
      yield Buffer.from("efbbbff09f99820a", "hex");
      reads++;
      yield Buffer.from("5a0a", "hex");
    } finally { closed = true; }
  }
  const decode = TextDecoder.prototype.decode;
  context.mock.method(TextDecoder.prototype, "decode", function(this: TextDecoder, ...args: Parameters<TextDecoder["decode"]>) {
    const text = decode.apply(this, args);
    if (text === "\ufeff🙂" || text === "🙂") { decoded++; controller.abort(reason); }
    return text;
  });
  await assert.rejects(run("cut", ["-c", "1-"], { stdin: input(), signal: controller.signal }), error => error === reason);
  assert.equal(decoded, 1);
  assert.equal(reads, 1);
  assert.equal(closed, true);
});
