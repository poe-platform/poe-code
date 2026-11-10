import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { basicCommands, formatPrintf } from "../../src/commands/basic.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { Shell } from "../../src/shell/index.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";

for (const entry of [
  { setup: "unset LC_ALL; export LC_TIME=en_US.utf8", us: true },
  { setup: "export LC_TIME=en_US.utf8", us: false },
  { setup: "unset LC_ALL; export LC_TIME=C", us: false },
  { setup: "export LC_ALL=en_US.utf8 LC_TIME=C", us: true },
  { setup: "unset LC_ALL LC_TIME; export LANG=en_US.UTF-8", us: true },
  { setup: "export LC_ALL='' LC_TIME='' LANG=en_US.utf8", us: true },
  { setup: "unset LC_ALL; export LC_TIME=POSIX LANG=en_US.utf8", us: false },
  { setup: "export LC_ALL=C.UTF-8 LC_TIME=en_US.utf8", us: false },
  { setup: "unset LC_ALL LC_TIME LANG", us: false },
]) test(`printf timestamps honor time locale precedence: ${entry.setup}`, async t => {
  const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()), env: { LC_ALL: "C", TZ: "UTC0" } });
  t.after(() => shell.dispose());
  for (const [format, expected] of [
    ["%D/%x", entry.us ? "01/01/21/01/01/2021" : "01/01/21/01/01/21"],
    ["%T/%X", entry.us ? "00:00:00/12:00:00 AM" : "00:00:00/00:00:00"],
    ["%c", entry.us ? "Fri 01 Jan 2021 12:00:00 AM UTC" : "Fri Jan  1 00:00:00 2021"],
    ["%F", "2021-01-01"],
  ]) {
    const result = await shell.exec(`${entry.setup}; printf '%(${format})T' 1609459200`);
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, expected, ""], format);
  }
});

for (const script of [
  "printf '%(%X)T' 1609506307",
  "builtin printf '%(%X)T' 1609506307",
  "command printf '%(%X)T' 1609506307",
  "printf -v value '%(%X)T' 1609506307; printf %s \"$value\"",
  "for value in 1609506307; do printf '%(%X)T' \"$value\"; done",
  "printf '%()T' 1609506307",
  "printf '%(%EX)T' 1609506307",
]) test(`printf locale timestamps work through shell routes: ${script}`, async t => {
  const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()), env: { LC_TIME: "en_US.utf8", TZ: "UTC0" } });
  t.after(() => shell.dispose());
  const result = await shell.exec(script);
  assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "01:05:07 PM", ""]);
});

const cases = [
  { input: "f09f90b3", quoted: "f09f90b3" },
  { input: "c3a9ff", quoted: "2427c3a95c33373727" },
  { input: "ffc3a9", quoted: "24275c333737c3a927" },
  { input: "eda080c3a9", quoted: "24275c3335355c3234305c323030c3a927" },
  { input: "c2a0", quoted: "c2a0" },
  { input: "e280a8", quoted: "e280a8" },
  { input: "e2808b", quoted: "24275c3334325c3230305c32313327" },
  { input: "c285", quoted: "24275c3330325c32303527" },
  { input: "", quoted: "2727" },
];
for (const entry of cases) for (const precision of [undefined, 0, 1, 3, 8]) {
  for (const left of [false, true]) test(`printf UTF8 q ${entry.input} precision ${precision} left ${left}`, async () => {
    const argumentValues = createCommandArguments([`%${left ? "-" : ""}10${precision === undefined ? "" : "." + precision}q`, shellValueFromBytes(Buffer.from(entry.input, "hex"))]);
    const chunks: Uint8Array[] = [];
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C.UTF-8" },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { assert.equal(bytes.length, 0); } },
    });
    const value = Buffer.from(entry.quoted, "hex").subarray(0, precision);
    const padding = Buffer.from(" ".repeat(Math.max(0, 10 - value.length)));
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(chunks), Buffer.concat(left ? [value, padding] : [padding, value]));
  });
}

test("printf q retains partial UTF-8 precision through shell routes", async () => {
  const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
  try {
    for (const script of [
      'printf %.3q "$VALUE"',
      'printf -v result %.3q "$VALUE"; printf %s "$result"',
      'result=$(printf %.3q "$VALUE"); printf %s "$result"',
      'for value in "$VALUE"; do printf %.3q "$value"; done',
      'printf %.3q "$VALUE" > /work/quoted; printf %s "$(< /work/quoted)"',
    ]) {
      const result = await shell.exec(script, { env: { LC_ALL: "C.UTF-8", VALUE: "🐳" } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "f09f90", script);
    }
  } finally { await shell.dispose(); }
});

test("printf q checks cancellation while quoting before writing output", async () => {
  const controller = new AbortController();
  const expired = new Error("quote CPU allowance exhausted");
  let checkpoints = 0, writes = 0;
  registerYieldCheckpoint(controller.signal, () => {
    if (++checkpoints < 4) return;
    controller.abort(expired);
    throw expired;
  });
  const argumentValues = createCommandArguments(["%q", "a".repeat(8192)]);
  await assert.rejects(formatPrintf({
    command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: {},
    fs: await fixture(), signal: controller.signal, stdin: toByteSource(""),
    stdout: { async write() { writes++; } }, stderr: { async write() { writes++; } },
  }), error => error === expired);
  assert.equal(checkpoints, 4);
  assert.equal(writes, 0);
});
