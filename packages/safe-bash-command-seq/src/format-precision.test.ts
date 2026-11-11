import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSeqCommand } from "./index.js";

// GNU coreutils 9.4, x86_64 Linux/glibc, LC_ALL=C (64-bit long-double significand).
for (const [args, lines] of [
  [["-f", "%.0f", "9007199254740993", "9007199254740994"], ["9007199254740993", "9007199254740994"]],
  [["-f", "%.0f", "9007199254740991", "9007199254740992"], ["9007199254740991", "9007199254740992"]],
  [["-f", "%.0f", "9007199254740993", "9007199254740993"], ["9007199254740993"]],
  [["-f", "%.0f", "9007199254740994", "-1", "9007199254740991"], ["9007199254740994", "9007199254740993", "9007199254740992", "9007199254740991"]],
  [["-f", "%.0f", "-9007199254740994", "-9007199254740991"], ["-9007199254740994", "-9007199254740993", "-9007199254740992", "-9007199254740991"]],
  [["--format=%.16g", "9007199254740993", "9007199254740994"], ["9007199254740993", "9007199254740994"]],
  [["-f", "%.18e", "9007199254740993", "9007199254740994"], ["9.007199254740993000e+15", "9.007199254740994000e+15"]],
  [["-f", "%.18f", "0.1", "0.1"], ["0.100000000000000000"]],
  [["-f", "%.21f", "0.1", "0.1", "0.4"], ["0.100000000000000000001", "0.200000000000000000003", "0.300000000000000000011", "0.400000000000000000005"]],
  [["-f", "%.21f", "0.1", "0.1", "0.7"], ["0.100000000000000000001", "0.200000000000000000003", "0.300000000000000000011", "0.400000000000000000005", "0.500000000000000000000", "0.600000000000000000022"]],
  [["-f", "%.18f", "0", "0.1", "0.3"], ["0.000000000000000000", "0.100000000000000000", "0.200000000000000000", "0.300000000000000000"]],
  [["-f", "<%+.2f>", "-0.15", "0.1", "0.15"], ["<-0.15>", "<-0.05>", "<+0.05>", "<+0.15>"]],
  [["-f", "%.0f", "0.5", "1", "3.5"], ["0", "2", "2", "4"]],
  [["-f", "%+.1f", "-0", "0"], ["-0.0"]],
  [["-f", "%.0f", "9007199254740994", "9007199254740993"], []],
  [["9007199254740993", "9007199254740994"], ["9007199254740993", "9007199254740994"]],
] as const) {
  for (const limits of [undefined, { maxChunkBytes: 7, maxSteps: 500 }]) {
    test(`seq precision ${limits ? "chunked" : "batched"}: ${args.join(" ")}`, async () => {
      const values = createCommandArguments(args);
      let stdout = "", stderr = "";
      const result = await createSeqCommand(limits ? { limits } : {}).execute({
        command: "seq", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs: createMemoryFileSystem(), stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout.split("\n").length - 1, lines.length, "output count");
      assert.equal(stdout, lines.length ? lines.join("\n") + "\n" : "");
    });
  }
}

test("seq formatted endpoints retain numeric and output budgets", async () => {
  for (const [limits, exitCode, output] of [
    [{ maxNumericDigits: 1 }, 0, "1\n2\n3\n4\n5\n6\n7\n8\n9\n"],
    [{ maxOutputBytes: 4 }, 1, undefined],
    [{ maxSteps: 4 }, 1, undefined],
  ] as const) {
    const values = createCommandArguments(["-f", "%.0f", "1", "9"]);
    let stdout = "", stderr = "";
    const result = await createSeqCommand({ limits }).execute({
      command: "seq", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, exitCode, stderr);
    if (output !== undefined) { assert.equal(stdout, output); assert.equal(stderr, ""); }
    else assert.ok(stderr.includes("limit exceeded"), stderr);
  }
});
