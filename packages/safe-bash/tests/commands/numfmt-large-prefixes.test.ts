import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry } from "../../src/contracts/index.js";
import { numfmtCommand } from "../../src/commands/numfmt.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

// GNU coreutils 9.10 output recorded in issue 509.
for (const [prefix, zeros, operand] of [["Y", 24, "3500000"], ["R", 27, "3500000000"], ["Q", 30, "3500000000000"]] as const) {
  for (const [name, args, input] of [
    ["suffix", "--from=auto", `3.5${prefix}\n-8.5${prefix}\n`],
    ["unit multiplier", "--from-unit=1000000000000000000", `${operand}\n-${operand.replace("35", "85")}\n`],
    ["literal", "", `35${"0".repeat(zeros - 1)}\n-85${"0".repeat(zeros - 1)}\n`],
  ]) test(`numfmt ${prefix} ${name} through Shell and redirected VFS output`, async () => {
    const fs = new MemoryFileSystem();
    const shell = new Shell({ fs, commands: new CommandRegistry([numfmtCommand()]), env: { LC_ALL: "C" } });
    try {
      const result = await shell.exec(`numfmt ${args} --to=si > /converted`, { stdin: input });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "");
      assert.equal(new TextDecoder().decode(await fs.readFile("/converted")), `3.5${prefix}\n-8.5${prefix}\n`);
    } finally { await shell.dispose(); }
  });
}

test("numfmt retains a finite scaled output bound beyond quetta", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([numfmtCommand()]), env: { LC_ALL: "C" } });
  try {
    const result = await shell.exec("numfmt --from=auto --to=si", { stdin: "1000Q\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /cannot handle values > 999Q/);
  } finally { await shell.dispose(); }
});

for (const prefix of ["R", "Q"]) for (const mode of ["si", "iec", "iec-i", "auto"]) {
  test(`numfmt ${prefix} ${mode} accepts both signs and preserves binary units`, async () => {
    const suffix = prefix + (mode === "iec-i" || mode === "auto" ? "i" : "");
    const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([numfmtCommand()]), env: { LC_ALL: "C" } });
    try {
      const result = await shell.exec(`numfmt --from=${mode} --to=${mode === "si" ? "si" : "iec-i"} -z`, { stdin: `3.5${suffix}\0-8.5${suffix}\0` });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `3.5${prefix}${mode === "si" ? "" : "i"}\0-8.5${prefix}${mode === "si" ? "" : "i"}\0`);
    } finally { await shell.dispose(); }
  });
}

test("numfmt new prefixes do not relax unsigned unit-size limits", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([numfmtCommand()]), env: { LC_ALL: "C" } });
  try {
    for (const option of ["from-unit", "to-unit"]) for (const prefix of ["R", "Q", "Ri", "Qi"]) {
      const result = await shell.exec(`numfmt --${option}=${prefix} --to=si 1`);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, `numfmt: invalid unit size: '${prefix}'\n`);
    }
  } finally { await shell.dispose(); }
});

test("numfmt GNU SI output round-trips and separators may end a number", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry([numfmtCommand()]), env: { LC_ALL: "C" } });
  try {
    const result = await shell.exec("numfmt --from=auto", { stdin: "2.7k\n" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "2700\n");
    assert.equal(result.stderr, "");
    const separator = await shell.exec("numfmt --unit-separator=_", { stdin: "1_\n" });
    assert.equal(separator.exitCode, 0);
    assert.equal(separator.stdout, "1\n");
    assert.equal(separator.stderr, "");
    const scaled = await shell.exec("numfmt --from=auto --to=si --unit-separator=_", { stdin: "3.5_R\n-8.5_Q\n2.7_k\n" });
    assert.equal(scaled.exitCode, 0);
    assert.equal(scaled.stdout, "3.5_R\n-8.5_Q\n2.7_k\n");
    assert.equal(scaled.stderr, "");
  } finally { await shell.dispose(); }
});
