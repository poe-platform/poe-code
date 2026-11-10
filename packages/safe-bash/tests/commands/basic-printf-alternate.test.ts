import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { basicCommands, formatPrintf } from "../../src/commands/basic.js";
import { CommandRegistry, createCommandArguments, toByteSource } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { parsePrintfDirective } from "../../src/commands/printf-format.js";

for (const [format, expected] of [
  ["%(stamp(%Y)_%m)T", "stamp(1970)_01"],
  ["%((%F))T", "(1970-01-01)"],
  ["%(a((%Y))b(%m))T", "a((1970))b(01)"],
  ["%(%F %T %z)T", "1970-01-01 00:00:00 +0000"],
] as const) for (const assignment of [false, true]) {
  test(`printf balanced time format ${format} assignment=${assignment}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
    try {
      const result = await shell.exec(assignment
        ? `printf -v stamp '${format}' 0; rc=$?; printf '%s:<%s>\\n' "$rc" "$stamp"`
        : `printf '${format}|%s' 0 tail`, { env: { TZ: "UTC0", LC_ALL: "C" } });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, assignment ? `0:<${expected}>\n` : `${expected}|tail`);
    } finally { await shell.dispose(); }
  });
}

for (const raw of [false, true]) {
  test(`printf time parser balances parentheses raw=${raw}`, async () => {
    const format = "%((%Y)T)Ttail";
    const result = await parsePrintfDirective(raw ? Buffer.from(format) : format, 0, new AbortController().signal);
    assert.equal(result.timeFormat, "(%Y)T");
    assert.equal(result.end, 9);
    for (const [invalid, character] of [["%((%Y)T", "\0"], ["%((%Y))s", "s"], ["%(%Y))T", ")"]] as const) {
      const directive = await parsePrintfDirective(raw ? Buffer.from(invalid) : invalid, 0, new AbortController().signal);
      assert.equal(directive.end, 1);
      assert.equal(directive.specifier, "%");
      assert.equal(directive.warning, `warning: \`${character}': invalid time format specification`);
    }
  });
}

for (const [format, args, expected, character, warnings] of [
  ["%(xx)X:%s", ["0", "end"], "%(xx)X:0%(xx)X:end", "X", 2],
  ["%(bad:%s", ["0", "end"], "%(bad:0%(bad:end", "\\000", 2],
  ["A%(x)Z", ["ok"], "A%(x)Z", "Z", 1],
  ["%(bad)", [], "%(bad)", "\\000", 1],
  ["%((x)Z:%s", ["0", "end"], "%((x)Z:0%((x)Z:end", "\\000", 2],
  ["%10(x)Z:%s", ["0", "end"], "%10(x)Z:0%10(x)Z:end", "Z", 2],
  ["%*(x)Z:%s", ["3", "one", "4", "two"], "%*(x)Z:one%*(x)Z:two", "Z", 2],
  ["%.*(bad:%s", ["2", "one", "3", "two"], "%.*(bad:one%.*(bad:two", "\\000", 2],
] as const) for (const raw of [false, true]) {
  test(`printf resumes after malformed time format ${format} raw=${raw}`, async () => {
    const argumentValues = createCommandArguments([raw ? shellValueFromBytes(Buffer.from(format)) : format, ...args]);
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C", TZ: "UTC" },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.concat(stdout).toString(), expected);
    assert.equal(Buffer.concat(stderr).toString(), `printf: warning: \`${character}': invalid time format specification\n`.repeat(warnings));
  });
}

for (const [source, expected, character, warnings] of [
  ["printf '%(xx)X:%s' 0 end", "%(xx)X:0%(xx)X:end", "X", 2],
  ["printf '%(bad:%s' 0 end", "%(bad:0%(bad:end", "\\000", 2],
  ["v=KEEP; printf -v v 'A%(x)Z' 'ok'; s=$?; printf \"[%s/%s]\" \"$s\" \"$v\"", "[0/A%(x)Z]", "Z", 1],
  ["printf '%(%Y)T:%s' 0 end", "1970:end", "", 0],
] as const) {
  test(`printf time-format recovery through shell: ${source}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()), env: { LC_ALL: "C", TZ: "UTC" } });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, `printf: warning: \`${character}': invalid time format specification\n`.repeat(warnings));
    } finally { await shell.dispose(); }
  });
}

for (const entry of [
  { value: "foo", quoted: "'foo'" },
  { value: "a b", quoted: "'a b'" },
  { value: "a'b", quoted: "'a'\\''b'" },
  { value: "", quoted: "''" },
  { value: "🐳", quoted: "'🐳'" },
  { value: "one\ntwo", quoted: "$'one\\ntwo'" },
]) for (const raw of [false, true]) for (const precision of [undefined, 0, 3]) for (const left of [false, true]) {
  test(`printf alternate q ${JSON.stringify(entry.value)} raw=${raw} precision=${precision} left=${left}`, async () => {
    const argumentValues = createCommandArguments([`%${left ? "-" : ""}#10${precision === undefined ? "" : "." + precision}q`, raw ? shellValueFromBytes(Buffer.from(entry.value)) : entry.value]);
    const chunks: Uint8Array[] = [];
    const result = await formatPrintf({
      command: "printf", args: argumentValues.args, argumentValues, cwd: "/work", env: { LC_ALL: "C.UTF-8" },
      fs: await fixture(), signal: new AbortController().signal, stdin: toByteSource(""),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { assert.equal(bytes.length, 0); } },
    });
    const bytes = Buffer.from(entry.quoted).subarray(0, precision);
    const padding = Buffer.from(" ".repeat(Math.max(0, 10 - bytes.length)));
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.concat(chunks), Buffer.concat(left ? [bytes, padding] : [padding, bytes]));
  });
}

for (const entry of [
  { format: "%#q", value: "a'b", expected: "'a'\\''b'" },
]) for (const route of ["direct", "assignment", "substitution", "loop", "redirection"]) {
  test(`current source ${entry.format} ${JSON.stringify(entry.value)} via ${route}`, async () => {
    const shell = new Shell({ fs: await fixture(), commands: new CommandRegistry(basicCommands()) });
    try {
      const invocation = `printf '${entry.format}' "$VALUE"`;
      const script = route === "direct" ? invocation
        : route === "assignment" ? `printf -v result '${entry.format}' "$VALUE"; printf %s "$result"`
        : route === "substitution" ? `result=$(${invocation}); printf %s "$result"`
        : route === "loop" ? `for value in "$VALUE"; do printf '${entry.format}' "$value"; done`
        : `${invocation} > /work/quoted; printf %s "$(< /work/quoted)"`;
      const result = await shell.exec(script, { env: { LC_ALL: "C.UTF-8", VALUE: entry.value } });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(entry.expected));
    } finally { await shell.dispose(); }
  });
}
