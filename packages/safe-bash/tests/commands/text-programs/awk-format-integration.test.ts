import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { CommandRegistry, FsError, MemoryFileSystem, Shell, createTextProgramCommands } from "../../../src/index.js";

function fixture(context: TestContext, maxSteps: number) {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands({ maxSteps, maxBufferBytes: 256 })) });
  context.after(() => shell.dispose());
  return { fs, shell };
}

const escapedPercents = "%%".repeat(64);
const numericFormat = `%${"0".repeat(128)}.1f`;
const conversion = `CONVFMT="${numericFormat}";`;
const cases = [
  ["printf escaped format", `printf "${escapedPercents}"`, "%".repeat(64)],
  ["sprintf", `x=sprintf("${escapedPercents}"); print length(x)`, "64\n"],
  ["OFMT numeric print", `OFMT="${numericFormat}"; print 1.5`, "1.5\n"],
  ["CONVFMT concatenation", `${conversion} x=1.5 ""; print x`, "1.5\n"],
  ["string comparison", `${conversion} print (1.5 == "1.5")`, "1\n"],
  ["numeric OFMT lookup", `${conversion} OFMT=1.5; print 2.5`, "1.5\n"],
  ["printf nested string conversion", `${conversion} printf "%s", 1.5`, "1.5"],
  ["numeric array key", `${conversion} a[1.5]=1; print length(a)`, "1\n"],
  ["field-zero conversion", `${conversion} $0=1.5; print $0`, "1.5\n"],
  ["regex subject conversion", `${conversion} print (1.5 ~ /^1/)`, "1\n"],
] as const;

for (const [name, program, expected] of cases) {
  for (const maxSteps of [96, 4096]) {
    test(`public awk ${name} uses the execution formatting budget ${maxSteps}`, async context => {
      const { shell } = fixture(context, maxSteps);
      const result = await shell.exec(`awk 'BEGIN { ${program} }'`);
      assert.equal(result.exitCode, maxSteps === 96 ? 2 : 0, result.stderr);
      assert.equal(result.stdout, maxSteps === 96 ? "" : expected);
      if (maxSteps === 96) assert.match(result.stderr, /execution step limit exceeded/u);
      else assert.equal(result.stderr, "");
    });
  }
}

test("awk formatting refusal preserves argument effects but never evaluates its output destination", async context => {
  const { fs, shell } = fixture(context, 96);
  const program = `function arg(){ print "arg" > "/effects"; return 1.5 } function dest(){ print "dest" > "/effects"; return "/out" } BEGIN { printf "${numericFormat}", arg() > dest() }`;
  const result = await shell.exec(`awk '${program}'`);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /execution step limit exceeded/u);
  assert.equal(Buffer.from(await fs.readFile("/effects")).toString(), "arg\n");
  await assert.rejects(fs.stat("/out"), error => error instanceof FsError && error.code === "ENOENT");
  assert.equal(result.stdout, "");
});

test("awk dynamic invalid formats fail after arguments and before destination evaluation", async context => {
  const { fs, shell } = fixture(context, 4096);
  const program = 'function arg(){ print "arg" > "/effects"; return 1.5 } function dest(){ print "dest" > "/effects"; return "/out" } BEGIN { fmt="%q"; printf fmt, arg() > dest() }';
  const result = await shell.exec(`awk '${program}'`);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unsupported format/u);
  assert.equal(Buffer.from(await fs.readFile("/effects")).toString(), "arg\n");
  await assert.rejects(fs.stat("/out"), error => error instanceof FsError && error.code === "ENOENT");
});

test("awk print converts arguments only after their evaluation changes OFMT", async context => {
  const { shell } = fixture(context, 4096);
  const result = await shell.exec('awk \'function arg(){ OFMT="%.1f"; OFS="|"; ORS="!"; return 2.75 } BEGIN { print 1.25, arg() }\'');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1.3|2.8!");
});

test("awk numeric comparisons and integer conversion do not invoke an unused invalid format", async context => {
  const { shell } = fixture(context, 96);
  const result = await shell.exec('awk \'BEGIN { CONVFMT="%q"; OFMT="%q"; print (1.5 == 1.5), 42 }\'');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1 42\n");
});

test("awk formatted output retains raw string bytes and dynamic width precision behavior", async context => {
  const { shell } = fixture(context, 4096);
  const result = await shell.exec('awk \'{ printf "%*.*s", -4, 2, $0 }\'', { stdin: Uint8Array.of(255, 0, 65, 10) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 0, 32, 32));
});
