import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createCommandArguments } from "../../../../src/contracts/command.js";
import { shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

const cases: readonly [string, string, string][] = [
  ["compound cells distinguish identical display projections", `a=($'\\xff' $'\\xfe' '�'); printf '%s' "\${a[@]}"`, "fffeefbfbd"],
  ["sparse element assignment", `a[9]=$'\\xff'; printf '%s' "\${a[9]}"`, "ff"],
  ["scalar promotion preserves zero", `a=$'\\xff'; a[3]=z; printf '%s' "\${a[@]}"`, "ff7a"],
  ["bare zero assignment preserves other members", `a=(old tail); a=$'\\xff'; printf '%s' "$a" "\${a[1]}"`, "ff7461696c"],
  ["bare zero append", String.raw`a=($'\xff'); a+=$'\xfe'; printf '%s' "$a"`, "fffe"],
  ["element append", `a[2]=$'\\xff'; a[2]+=$'\\xfe'; printf '%s' "\${a[2]}"`, "fffe"],
  ["compound append", `a=($'\\xff'); a+=($'\\xfe'); printf '%s' "\${a[@]}"`, "fffe"],
  ["quoted member copy", `a=($'\\xff' $'\\xfe'); b=("\${a[@]}"); printf '%s' "\${b[@]}"`, "fffe"],
  ["member joining", `a=($'\\xff' $'\\xfe'); IFS=:; printf '%s' "\${a[*]}"`, "ff3afe"],
  ["member joining preserves a raw IFS separator", `a=(A B); IFS=$'\\xff'; printf '%s' "\${a[*]}"`, "41ff42"],
  ["unquoted member splitting", `a=($'\\xff \\xfe' '' z); printf '<%s>' \${a[@]}`, "3cff3e3cfe3e3c7a3e"],
  ["Unicode IFS does not decode raw payload", `raw=$'\\xff'; a=("$raw💡z"); IFS=💡; printf '<%s>' \${a[@]}`, "3cff3e3c7a3e"],
  ["replacement-character IFS does not alias invalid bytes", `a=($'\\xff' $'\\xfe'); IFS='�'; printf '<%s>' \${a[@]}`, "3cff3e3cfe3e"],
  ["raw IFS splits exact bytes only", `a=($'\\xfe\\xffz'); IFS=$'\\xff'; printf '<%s>' \${a[@]}`, "3cfe3e3c7a3e"],
  ["unquoted empty IFS preserves bytes", `a=($'\\xff \\xfe'); IFS=; printf '%s' \${a[@]}`, "ff20fe"],
  ["member splice preserves prefixes and suffixes", `a=($'\\xff' $'\\xfe'); printf '%s' pre"\${a[@]}"post`, "707265fffe706f7374"],
  ["lazy default publishes raw zero", `raw=$'\\xff'; a=([2]=z); printf '%s' "\${a:=$raw}" "$a"`, "ffff"],
  ["local indexed declaration preserves raw initializer and restores outer", String.raw`a=($'\xff'); f() { local -a a=$'\xfe'; printf '%s' "$a"; }; f; printf '%s' "$a"`, "feff"],
  ["local existing indexed binding preserves raw initializer", String.raw`a=($'\xff'); f() { local a=$'\xfe'; printf '%s' "$a"; }; f; printf '%s' "$a"`, "feff"],
  ["readonly initializer preserves raw zero", String.raw`a=(old); readonly a=$'\xff'; printf '%s' "$a"`, "ff"],
  ["for loop assigns raw indexed zero", String.raw`a=(old); for a in $'\xff' $'\xfe'; do printf '%s' "$a"; done`, "fffe"],
  ["subshell copy-on-write keeps parent bytes", String.raw`a=($'\xff'); (a[0]=$'\xfe'; printf '%s' "$a"); printf '%s' "$a"`, "feff"],
];

for (const [name, source, expected] of cases) test(`byte-cell Runtime: ${name}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expected);
});

test("byte-cell fixture bytes agree with pinned Bash in the C byte profile", nativeOptions(), async () => {
  for (const [name, source, expected] of cases) {
    const native = runNative(source);
    const byteExpected = name === "Unicode IFS does not decode raw payload" ? "3cff3e3c3e3c3e3c3e3c7a3e" : expected;
    assert.equal(native.status, 0, `${name}: ${native.stderr.toString()}`);
    assert.equal(native.stderr.toString(), "", name);
    assert.equal(native.stdout.toString("hex"), byteExpected, name);
    const shell = new Shell({ fs: createMemoryFileSystem() });
    for (const command of basicCommands()) shell.register(command);
    try {
      const actual = await shell.exec(source, { env: { LC_ALL: "C" } });
      assert.equal(actual.exitCode, native.status, name);
      assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout, name);
      assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr, name);
    } finally { await shell.dispose(); }
  }
});

for (const [name, source, expected] of [
  ["readonly element refuses RHS effects", `a=($'\\xff'); readonly a; a[0]=\${side:=bad}; printf '%s:%s' "$a" "\${side-unset}"`, "ff3a756e736574"],
  ["readonly zero retains RHS evaluation order", `a=($'\\xff'); readonly a; a=\${side:=ran}; printf '%s:%s' "$a" "\${side-unset}"`, "ff3a72616e"],
  ["stale outer publication cannot overwrite a raw inner assignment", `raw=$'\\xfe'; a=([4]=$'\\xff'); a[1]=\${a:=$raw} 2>/errors; printf '%s' "\${a[@]}"`, "feff"],
] as const) test(`byte-cell guard: ${name}`, async context => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, name.startsWith("readonly") ? "shell: line 1: indexed array: readonly binding\n" : "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expected);
  if (!name.startsWith("readonly")) assert.match(Buffer.from(await fs.readFile("/errors")).toString(), /stale binding/u);
});

test("byte-array command arguments remain immutable after caller buffer mutation", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const bytes = Uint8Array.of(255);
  const value = shellValueFromBytes(bytes);
  bytes.fill(65);
  shell.register({ name: "entry", execute(command) {
    const argumentValues = createCommandArguments([value]);
    return command.invoke!("copy", argumentValues.args, { argumentValues });
  } });
  const result = await shell.exec('copy() { a=("$1"); printf "%s" "${a[@]}"; }; entry');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff");
});

const readCases: readonly [string, string, string, string][] = [
  ["raw read assigns indexed zero", `a=(old); read -r a; printf '%s' "$a"`, "ff0a", "ff"],
  ["raw read preserves REPLY", `read -r; printf '%s' "$REPLY"`, "ff0a", "ff"],
  ["read fields preserve escaped separators", `IFS=:; a=(); b=(); read a b; printf '<%s>' "$a" "$b"`, "ff5c3afe3a7a0a", "3cff3afe3e3c7a3e"],
  ["last variable preserves remaining fields", `a=(); b=(); read -r a b; printf '<%s>' "$a" "$b"`, "20ff2020fe207a200a", "3cff3e3cfe207a3e"],
  ["byte-count exact read", `LC_ALL=C; a=(); read -rN 1 a; printf '%s' "$a"`, "fffe", "ff"],
  ["byte-count delimiter read", `LC_ALL=C; a=(); read -rn 1 a; printf '%s' "$a"`, "fffe", "ff"],
  ["unterminated raw read preserves bytes and status", `a=(); read -r a; printf '%s:%s' "$?" "$a"`, "ff", "313aff"],
  ["partial assignment before readonly failure", `a=(); b=(); readonly b; read -r a b 2>/errors; printf '%s:%s' "$?" "$a"`, "ff20fe0a", "313aff"],
];

const boundaryCases = [
  ["scalar lengths after positional copies retain byte boundaries", `a=($'\\xe2\\x82' 'é' $'\\xff'); set -- "\${a[@]}"; first=$1; second=$2; third=$3; printf '<%s>' "\${#a}" "\${#first}" "\${#second}" "\${#third}"`, ["3c323e3c323e3c323e3c313e", "3c323e3c323e3c313e3c313e"]],
  ["positional star uses the locale-specific first IFS unit", `set -- A B; IFS='é'; printf '<%s>' "$*"`, ["3c41c3423e", "3c41c3a9423e"]],
  ["invalid IFS component bytes split but valid characters stay whole", `a=($'A\\xc3B' $'A\\xa9B' 'AéB'); IFS='é'; printf '<%s>' \${a[@]}`, ["3c413e3c423e3c413e3c423e3c413e3c3e3c423e", "3c413e3c423e3c413e3c423e3c413e3c423e"]],
] as const;

for (const [profile, locale] of ["C", "en_US.UTF-8"].entries()) {
  for (const [name, source, outputs] of boundaryCases) test(`byte-cell boundary: ${locale}: ${name}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem() });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const result = await shell.exec(source, { env: { LC_ALL: locale } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), outputs[profile]);
  });
}

test("pinned Bash confirms locale boundary expectations", nativeOptions(), () => {
  for (const [profile, locale] of ["C", "en_US.UTF-8"].entries()) {
    for (const [name, source, outputs] of boundaryCases) {
      const result = runNative(`LC_ALL=${locale}; ${source}`);
      assert.equal(result.status, 0, `${name}: ${result.stderr.toString()}`);
      assert.equal(result.stderr.toString(), "", name);
      assert.equal(result.stdout.toString("hex"), outputs[profile], name);
    }
  }
});

for (const [name, source, input, expected] of readCases) test(`byte-cell read: ${name}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(source, { stdin: Buffer.from(input, "hex") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expected);
});

test("array copy budgets refuse an oversized raw cell before publishing it", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxExpansionBytes: 128, maxExpansionFields: 32 } });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const source = `a=($'${"\\xff".repeat(256)}'); printf leaked`;
  const operation = shell.exec(source);
  await assert.rejects(operation, error => error instanceof ShellLimitError || error instanceof Error && error.message.includes("capacity"));
});
