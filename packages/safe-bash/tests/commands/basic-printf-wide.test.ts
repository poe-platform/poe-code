import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { basicCommands, formatPrintf } from "../../src/commands/basic.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
const cases = [
  {
    "input": "",
    "format": "%S",
    "output": ""
  },
  {
    "input": "",
    "format": "%C",
    "output": "00"
  },
  {
    "input": "616263",
    "format": "%S",
    "output": "616263"
  },
  {
    "input": "616263",
    "format": "%C",
    "output": "61"
  },
  {
    "input": "c3a9636c616972",
    "format": "%.1ls",
    "output": "c3a9"
  },
  {
    "input": "c3a9636c616972",
    "format": "%.2ls",
    "output": "c3a963"
  },
  {
    "input": "c3a9636c616972",
    "format": "%4.2ls",
    "output": "2020c3a963"
  },
  {
    "input": "c3a9636c616972",
    "format": "%-4.2ls",
    "output": "c3a9632020"
  },
  {
    "input": "c3a9636c616972",
    "format": "%lc",
    "output": "c3a9"
  },
  {
    "input": "c3a9636c616972",
    "format": "%4lc",
    "output": "202020c3a9"
  },
  {
    "input": "c3a9636c616972",
    "format": "%-4lc",
    "output": "c3a9202020"
  },
  {
    "input": "c3a9636c616972",
    "format": "%S",
    "output": "c3a9636c616972"
  },
  {
    "input": "c3a9636c616972",
    "format": "%C",
    "output": "c3a9"
  },
  {
    "input": "f09f90b3616263",
    "format": "%.1ls",
    "output": "f09f90b3"
  },
  {
    "input": "f09f90b3616263",
    "format": "%.2ls",
    "output": "f09f90b361"
  },
  {
    "input": "f09f90b3616263",
    "format": "%4.2ls",
    "output": "2020f09f90b361"
  },
  {
    "input": "f09f90b3616263",
    "format": "%-4.2ls",
    "output": "f09f90b3612020"
  },
  {
    "input": "f09f90b3616263",
    "format": "%lc",
    "output": "f09f90b3"
  },
  {
    "input": "f09f90b3616263",
    "format": "%4lc",
    "output": "202020f09f90b3"
  },
  {
    "input": "f09f90b3616263",
    "format": "%-4lc",
    "output": "f09f90b3202020"
  },
  {
    "input": "f09f90b3616263",
    "format": "%S",
    "output": "f09f90b3616263"
  },
  {
    "input": "f09f90b3616263",
    "format": "%C",
    "output": "f09f90b3"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%.1ls",
    "output": "e0b287"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%.2ls",
    "output": "e0b287e0b2b3"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%4.2ls",
    "output": "2020e0b287e0b2b3"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%-4.2ls",
    "output": "e0b287e0b2b32020"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%lc",
    "output": "e0b287"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%4lc",
    "output": "202020e0b287"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%-4lc",
    "output": "e0b287202020"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%S",
    "output": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381"
  },
  {
    "input": "e0b287e0b2b3e0b2bfe0b295e0b386e0b297e0b2b3e0b381",
    "format": "%C",
    "output": "e0b287"
  },
  {
    "input": "610a62",
    "format": "%S",
    "output": "610a62"
  },
  {
    "input": "610a62",
    "format": "%C",
    "output": "61"
  },
  ...["hls", "lls", "Lls", "zls", "tls", "jls", "llls"].map(modifiers => ({
    input: "c3a9636c616972", format: "%5.2" + modifiers, output: "202020c3a963",
  })),
];

for (const entry of cases) for (const raw of [false, true]) {
  test(`wide printf ${entry.format} ${entry.input} raw=${raw}`, async () => {
    const value = Buffer.from(entry.input, "hex");
    const argumentValues = createCommandArguments([entry.format, raw ? shellValueFromBytes(value) : value.toString("utf8")]);
    const chunks: Uint8Array[] = [];
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C.UTF-8" },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { assert.equal(bytes.length, 0); } },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(entry.output, "hex"));
  });
}

for (const entry of [
  { format: "%4.2ls", output: "  éc" },
  { format: "%4lc", output: "   é" },
]) for (const route of ["direct", "assignment", "substitution", "loop", "redirection"]) {
  test(`wide printf ${entry.format} through ${route}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
    try {
      const invocation = `printf '${entry.format}' "$VALUE"`;
      const script = route === "direct" ? invocation
        : route === "assignment" ? `printf -v result '${entry.format}' "$VALUE"; printf %s "$result"`
        : route === "substitution" ? `result=$(${invocation}); printf %s "$result"`
        : route === "loop" ? `for value in "$VALUE"; do printf '${entry.format}' "$value"; done`
        : `${invocation} > /work/printed; printf %s "$(< /work/printed)"`;
      const result = await shell.exec(script, { env: { LC_ALL: "C.UTF-8", VALUE: "éclair" } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(entry.output));
    } finally { await shell.dispose(); }
  });
}

for (const entry of [
  { format: "%4.1ls", value: "éclair", output: "202020c3" },
  { format: "%4.2ls", value: "éclair", output: "2020c3a9" },
  { format: "%4lc", value: "éclair", output: "202020c3" },
  { format: "%.0lc", value: "", output: "00" },
  { format: "%5.2hls", value: "éclair", output: "202020c3a9" },
]) for (const locale of ["C", "POSIX"]) {
  test(`wide syntax preserves byte locale ${locale} ${entry.format}`, async () => {
    const argumentValues = createCommandArguments([entry.format, entry.value]);
    const chunks: Uint8Array[] = [];
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: locale },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { assert.equal(bytes.length, 0); } },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(chunks), Buffer.from(entry.output, "hex"));
  });
}

for (const format of ["%S", "%.0ls", "%" + "l".repeat(8192) + "s"]) {
  for (const reason of [false, 0, "", null, new Error("wide printf cancelled")]) {
    test(`wide printf cooperates during ${format.length > 20 ? "length modifiers" : format} with reason ${String(reason)}`, async () => {
      const controller = new AbortController();
      let checkpoints = 0, writes = 0;
      registerYieldCheckpoint(controller.signal, () => {
        if (++checkpoints === 3) controller.abort(reason);
      });
      const argumentValues = createCommandArguments([format, "a".repeat(8192)]);
      await assert.rejects(formatPrintf({
        command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C.UTF-8" },
        fs: await fixture(), signal: controller.signal, stdin: toByteSource(""),
        stdout: { async write() { writes++; } },
        stderr: { async write() { writes++; } },
      }), error => Object.is(error, reason));
      assert.equal(checkpoints, 3);
      assert.equal(writes, 0);
    });
  }
}
