import assert from "node:assert/strict";
import test from "node:test";
import { standardCommands } from "../../../src/commands/index.js";
import { diffPatchCommands, type DiffPatchOptions } from "../../../src/commands/diff-patch/index.js";
import { Shell } from "../../../src/shell/index.js";
import { oracleIdentity } from "../diff-patch-stress/gnu-target/oracle.js";
import { filesystem, native as nativeOracle, run } from "./helpers.js";

const labels = ["--label=BEFORE name", "-L", "AFTER name"];
const lines = Array.from({ length: 31 }, (_, index) => `line ${index + 1}\n`);
const left = lines.join("");
const right = [...lines.slice(0, 15), "CHANGED\n", ...lines.slice(16)].join("");
const files = { left, right };

async function native(args: readonly string[], oldText = left, newText = right) {
  const { exitCode, stdout, stderr } = await nativeOracle("diff", args, { left: oldText, right: newText });
  return { exitCode, stdout, stderr };
}

test("pinned GNU option oracle identity (required; no host fallback)", async context => {
  const pin = oracleIdentity("diff", "gnu");
  const identity = await native(["--version"]);
  assert.equal(identity.exitCode, 0, identity.stderr);
  assert.equal(identity.stdout.trim(), pin.version);
  context.diagnostic(JSON.stringify(pin));
});

function expected(width: number, format: "unified" | "context"): string {
  const start = Math.max(0, 15 - width);
  const end = Math.min(lines.length, 16 + width);
  const before = lines.slice(start, 15);
  const after = lines.slice(16, end);
  if (format === "unified") {
    const range = width === 0 ? "16" : `${start + 1},${end - start}`;
    return `--- BEFORE name\n+++ AFTER name\n@@ -${range} +${range} @@\n`
      + before.map(line => ` ${line}`).join("") + "-line 16\n+CHANGED\n" + after.map(line => ` ${line}`).join("");
  }
  const range = width === 0 ? "16" : `${start + 1},${end}`;
  return `*** BEFORE name\n--- AFTER name\n***************\n*** ${range} ****\n`
    + before.map(line => `  ${line}`).join("") + "! line 16\n" + after.map(line => `  ${line}`).join("")
    + `--- ${range} ----\n` + before.map(line => `  ${line}`).join("") + "! CHANGED\n" + after.map(line => `  ${line}`).join("");
}

const widths = [
  { suffix: ["U0"], width: 0 },
  { suffix: ["U", "0"], width: 0 },
  { suffix: ["U0", "u"], width: 3 },
  { suffix: ["u", "U0"], width: 3 },
  { suffix: ["U8", "U1"], width: 8 },
  { suffix: ["U1", "U8"], width: 8 },
  { suffix: ["U8", "u", "U1"], width: 8 },
  { suffix: ["U0", "U1", "U0"], width: 1 },
  { suffix: ["uU0"], width: 3 },
  { suffix: ["ruU1"], width: 3 },
  { suffix: ["U0", "uru"], width: 3 },
  { suffix: ["U2147483647", "U0"], width: 31 },
  { suffix: ["U9007199254740991"], width: 31 },
  { suffix: ["U999999999999999999999999999999"], width: 31 },
] as const;

const cases: { flags: readonly string[]; width: number; format: "unified" | "context" }[] = [];
for (const format of ["unified", "context"] as const) {
  const upper = format === "unified" ? "U" : "C";
  const lower = format === "unified" ? "u" : "c";
  for (const fixture of widths) {
    cases.push({ format, width: fixture.width, flags: fixture.suffix.map(part => part === "0" ? part : `-${part.replaceAll("U", upper).replaceAll("u", lower)}`) });
  }
  for (const fixture of [
    { flags: [`--${format}=0`], width: 0 },
    { flags: [`--${format}=1`, `--${format}`], width: 3 },
    { flags: [`--${format}`, `--${format}=1`], width: 3 },
    { flags: [`--${format}=8`, `-${lower}`], width: 8 },
    { flags: [`--${format}=8`, `--${format}=1`], width: 8 },
    { flags: [`-${upper}0`, `--${format}`], width: 3 },
    { flags: [`--${format}=1`, `-r${lower}`], width: 3 },
    { flags: [`--${format}=`], width: 0 },
    { flags: [`-${upper}`, ""], width: 0 },
    { flags: [`-${upper}`, "+1"], width: 1 },
    { flags: [`-${upper}`, "\t+01"], width: 1 },
    { flags: [`-${upper}`, "-00"], width: 0 },
    { flags: ["-0", `-${lower}`], width: 0 },
    { flags: [`-${lower}`, "-0"], width: 0 },
    { flags: [`-${lower}0`], width: 0 },
    { flags: [`-0${lower}`], width: 0 },
    { flags: ["-0", `--${format}`], width: 3 },
    { flags: ["-0", `-${upper}1`], width: 1 },
    { flags: ["-5", `-${upper}1`], width: 5 },
    { flags: ["-1", "-2", `-${lower}`], width: 12 },
    { flags: ["-1", `-${lower}`, "-2"], width: 2 },
    { flags: ["-01", `-${lower}`], width: 1 },
    { flags: ["-999999999999999999999999", `-${lower}`], width: 31 },
  ]) cases.push({ ...fixture, format });
}

for (const fixture of cases) {
  const name = JSON.stringify(fixture.flags);
  const output = expected(fixture.width, fixture.format);
  for (const stdin of [false, true]) test(`GNU context selectors ${name}, stdin=${stdin}`, async () => {
    const actual = await run("diff", [...fixture.flags, ...labels, stdin ? "-" : "left", "right"], { files, input: left });
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { exitCode: 1, stdout: output, stderr: "" });
  });
  test(`GNU native selector evidence ${name}`, async () => {
    const actual = await native([...fixture.flags, ...labels, "left", "right"]);
    assert.deepEqual(actual, { exitCode: 1, stdout: output, stderr: "" });
  });
}

for (const fixture of [
  { flags: ["-wC0", "-c"], stdout: "*** BEFORE name\n--- AFTER name\n***************\n*** 1,2 ****\n  a b\n! old\n--- 1,2 ----\n  ab\n! new\n" },
  { flags: ["-bU0", "-uw"], stdout: "--- BEFORE name\n+++ AFTER name\n@@ -1,2 +1,2 @@\n a b\n-old\n+new\n" },
]) test(`GNU grouped whitespace selector evidence ${JSON.stringify(fixture.flags)}`, async () => {
  const inputs = { left: "a b\nold\n", right: "ab\nnew\n" };
  const actual = await run("diff", [...fixture.flags, ...labels, "left", "right"], { files: inputs });
  const frozen = { exitCode: 1, stdout: fixture.stdout, stderr: "" };
  assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, frozen);
  assert.deepEqual(await native([...fixture.flags, ...labels, "left", "right"], inputs.left, inputs.right), frozen);
});

const invalid = [
  ["-u", "-c"], ["-c", "-u"], ["-uC0"], ["-cU0"], ["-U0", "--normal"], ["--normal", "-C0"],
  ["-q", "-c", "-u"], ["-U0u"], ["-C0c"], ["--unified=-1"], ["--context=bad"],
  ["-U", " "], ["-C", "+"], ["-U", "1 "], ["-C", "0x1"], ["-U", "1e2"],
  ["-u", "-Cbad"], ["--normal", "--unified=bad"], ["--not-a-diff-option"], ["-J"],
] as const;

for (const flags of invalid) {
  test(`GNU rejects invalid selectors ${JSON.stringify(flags)}`, async () => {
    const actual = await run("diff", [...flags, ...labels, "left", "right"], { files });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
    assert.notEqual(actual.stderr, "");
    if (flags.some(flag => flag === "-Cbad" || flag === "--unified=bad")) assert.match(actual.stderr, /invalid context length/u);
  });
  test(`GNU native invalid selector evidence ${JSON.stringify(flags)}`, async () => {
    const actual = await native([...flags, ...labels, "left", "right"]);
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
    assert.notEqual(actual.stderr, "");
  });
}

test("GNU legacy digits do not select an output style", async () => {
  const actual = await run("diff", ["-0", ...labels, "left", "right"], { files });
  assert.equal(actual.exitCode, 1, actual.stderr);
  assert.equal(actual.stdout, "16c16\n< line 16\n---\n> CHANGED\n");
  assert.deepEqual(await native(["-0", ...labels, "left", "right"]),
    { exitCode: 1, stdout: actual.stdout, stderr: "" });
});

for (const flag of ["-U", "-C"]) test(`GNU missing selector argument ${flag}`, async () => {
  const actual = await run("diff", ["left", "right", flag], { files });
  assert.equal(actual.exitCode, 2);
  assert.equal(actual.stdout, "");
  assert.match(actual.stderr, /requires an argument/u);
  assert.equal((await native(["left", "right", flag])).exitCode, 2);
});

for (const fixture of [
  { flags: "-U0 -u -U1", format: "unified", width: 3 },
  { flags: "-C8 -c --context=1", format: "context", width: 8 },
  { flags: "-u0", format: "unified", width: 0 },
] as const) test(`GNU selectors through Shell plugin: ${fixture.flags}`, async () => {
  const fs = await filesystem(files);
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  const actual = await shell.exec(`cat left | diff ${fixture.flags} --label='BEFORE name' -L 'AFTER name' - right`);
  assert.equal(actual.exitCode, 1, actual.stderr);
  assert.equal(actual.stdout, expected(fixture.width, fixture.format));
  assert.equal(actual.stderr, "");
});

for (const options of [
  { maxOutputBytes: 24 }, { maxInputBytes: 8 }, { maxLines: 4 }, { maxWork: 12 },
] satisfies DiffPatchOptions[]) for (const flags of [["-U0", "-u"], ["-C999999999999999999999999"]]) {
  test(`GNU selectors retain budgets ${JSON.stringify({ flags, options })}`, async () => {
    const actual = await run("diff", [...flags, ...labels, "left", "right"], { files, options });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
    assert.match(actual.stderr, /limit|maxBytes/u);
    assert.equal(Buffer.from(await actual.fs.readFile("/work/left")).toString(), left);
    assert.equal(Buffer.from(await actual.fs.readFile("/work/right")).toString(), right);
  });
}

test("GNU maximum context merges hunks before the shared hunk budget", async () => {
  const inputs = { left: "a\nb\nc\nd\ne\nf\ng\n", right: "A\nb\nc\nd\ne\nf\nG\n" };
  for (const fixture of [{ flags: ["-U0"], status: 2 }, { flags: ["-U0", "-u"], status: 1 }]) {
    const actual = await run("diff", [...fixture.flags, ...labels, "left", "right"], { files: inputs, options: { maxHunks: 1 } });
    assert.equal(actual.exitCode, fixture.status, actual.stderr);
    if (fixture.status === 2) { assert.equal(actual.stdout, ""); assert.match(actual.stderr, /hunk limit/u); }
    else assert.equal((actual.stdout.match(/^@@/gmu) ?? []).length, 1);
  }
});
