import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem } from "../../src/index.js";
import { expandBraces } from "../../src/shell/brace-expansion.js";
import { Budget, resolveLimits } from "../../src/shell/runtime.js";

const environment = { PATH: "/usr/bin:/bin", HOME: "/home/brace", LC_ALL: "C" };

function native(source: string) {
  const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], {
    cwd: "/", env: environment, timeout: 2000, maxBuffer: 64 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return { stdout: result.stdout.toString("hex"), stderr: result.stderr.toString("hex"), exitCode: result.status };
}

const cases = [
  ["default comma lists", String.raw`printf '<%s>\n' {a,b}`],
  ["empty alternatives", String.raw`printf '<%s>\n' prefix{,,a,}suffix {,}`],
  ["nested and cartesian order", String.raw`printf '<%s>\n' pre{a,{b,c}}{1,2}post`],
  ["ascending descending and stepped numbers", String.raw`printf '<%s>\n' {1..5..2} {5..1..2} {-3..3..2} {3..-3..-2}`],
  ["zero and negative steps", String.raw`printf '<%s>\n' {1..3..0} {1..5..-2} {5..1..-2}`],
  ["padding across signs", String.raw`printf '<%s>\n' {-03..03..2} {003..-1} {1..003} {-0..2}`],
  ["explicit plus signs and padded steps", String.raw`printf '<%s>\n' {+01..3} {01..3..+2} {3..1..-02}`],
  ["out of range signed integer endpoints stay literal", String.raw`printf '<%s>\n' {9223372036854775808..9223372036854775809} {-9223372036854775809..-9223372036854775808}`],
  ["alphabetic sequences", String.raw`printf '<%s>\n' {a..f..2} {F..A..2} {x..z..0}`],
  ["alphabetic sequences cross ASCII punctuation", String.raw`printf '<%s>\n' {Z..a}`],
  ["range generated backtick diagnoses unfinished substitution", String.raw`(printf '<%s>\n' pre{Z..a}post) 2>/dev/null; printf 'status=%s\n' "$?"`],
  ["range generated backslash quote removal", String.raw`printf '<%s>\n' {Y..c..3} {Y..c..3}post`],
  ["range generated backslash escapes parameter spelling", "value=tail; printf '<%s>\\n' {Y..c..3}$value {Y..c..3}${value}"],
  ["range generated backslash preserves escaped quote spelling", String.raw`printf '<%s>\n' {Y..c..3}"post"`],
  ["range generated backslash preserves ANSI quoted raw bytes", String.raw`printf '<%s>\n' {Y..c..3}$'\xff'`],
  ["range generated backslash changes parameter quote context", String.raw`value='x y'; printf '<%s>\n' {Y..c..3}"$value"`],
  ["range generated backslash escapes an existing escape", String.raw`unset name; printf '<%s>\n' {Y..c..3}\$name`],
  ["malformed forms and nested valid forms", String.raw`printf '<%s>\n' {} {a} {1..x} {1..3..x} {1...3} {a,{b,c}} {{a,b}} {a,b`],
  ["quotes inhibit syntax", String.raw`printf '<%s>\n' '{a,b}' "{1..3}" {'a,b',c} {"a,b",c} {a,"b,c"}`],
  ["escapes inhibit delimiters", String.raw`printf '<%s>\n' \{a,b} {a\,b,c} {a,b\}c} {1\.\.3} {a,\{b,c\}}`],
  ["empty quotes preserve quoted boundaries", String.raw`printf '<%s>\n' {''a,b} {a'',b} {1..''3} {a,''}`],
  ["produced braces stay literal", String.raw`value='{a,b}'; printf '<%s>\n' $value "$value" $(printf '{c,d}') "$(printf '{e,f}')"`],
  ["parameter alternatives stay literal", "unset value; printf '<%s>\\n' ${value:-{a,b}} \"${value:-{c,d}}\""],
  ["parameter expansion follows brace expansion", String.raw`value='x y'; printf '<%s>\n' {a,b}$value {a,b}"$value"`],
  ["substitutions repeat after brace expansion", String.raw`printf '<%s>\n' {a,b}$(printf tick >&2; printf x)`],
  ["substitution alternatives preserve execution order", String.raw`printf '<%s>\n' {$(printf first >&2; printf x),$(printf second >&2; printf y)}`],
  ["tilde expansion follows brace expansion", String.raw`printf '<%s>\n' {~,~/child} '~'{a,b}`],
  ["raw bytes remain distinct from replacement text", String.raw`printf '<%s>\n' $'\xff'{a,b} {a,b}$'\xfe' {"$(printf '\377')",�}`],
  ["raw fragments preserve byte concatenation", String.raw`printf '<%s>\n' $'\xc3'{a,b}$'\xa9' {"$'literal'",$'\xff'}`],
  ["scalar assignments do not brace expand", String.raw`value={a,b}; copy={1..3}; printf '<%s>\n' "$value" "$copy"; value={x,y} bash -c 'printf "<%s>\n" "$value"'`],
  ["declaration assignments do brace expand", String.raw`export value={a,b}; printf '<%s>\n' "$value"; inspect() { local copy={x,y}; printf '<%s>\n' "$copy"; }; inspect`],
  ["compound array values expand", "values=({a,b} {01..03}); printf '<%s>\\n' \"${values[@]}\""],
  ["indexed array assignment remains scalar", "values[2]={a,b}; printf '<%s>\\n' \"${values[@]}\""],
  ["indexed compound entries become expanded ordinary values", "values=([2]={a,b} [5]={1..3}); printf '<%s>\\n' \"${values[@]}\""],
  ["conditional operands do not brace expand", String.raw`[[ {a,b} == '{a,b}' ]]; printf '%s\n' "$?"; case '{a,b}' in {a,b}) printf 'matched\n';; *) printf 'missed\n';; esac`],
  ["here strings do not brace expand", String.raw`cat <<< {a,b}`],
  ["heredocs do not brace expand", "cat <<'END'\n{a,b} {1..3}\nEND\n"],
  ["redirection alternatives are ambiguous", String.raw`( : > {left,right} ) 2>/dev/null; printf '%s\n' "$?"`],
  ["for words expand", String.raw`for value in {c..a} pre{1,2}; do printf '<%s>\n' "$value"; done`],
  ["short option toggles", String.raw`set +B; printf '<%s>\n' {a,b}; set -B; printf '<%s>\n' {1..5..2}`],
  ["long option toggles", String.raw`set +o braceexpand; printf '<%s>\n' {a,b}; set -o braceexpand; printf 'status=%s\n' "$?"; printf '<%s>\n' {a,b}`],
  ["braceexpand is not a shopt option", String.raw`shopt -s braceexpand 2>/dev/null; printf 'status=%s\n' "$?"; printf '<%s>\n' {a,b}`],
  ["short option observability", String.raw`case $- in *B*) printf on;; *) printf off;; esac; set +B; case $- in *B*) printf on;; *) printf off;; esac; set -B; case $- in *B*) printf on;; *) printf off;; esac`],
  ["long option listing reflects state", String.raw`set -o | while read name setting; do if [[ $name == braceexpand ]]; then printf '%s\n' "$setting"; fi; done; set +B; set -o | while read name setting; do if [[ $name == braceexpand ]]; then printf '%s\n' "$setting"; fi; done`],
  ["subshell inherits but isolates option state", String.raw`set +B; (printf '<%s>\n' {a,b}; set -B; printf '<%s>\n' {a,b}); printf '<%s>\n' {a,b}`],
  ["function and eval share option state", String.raw`disable() { set +B; }; disable; eval 'printf "<%s>\n" {a,b}'; enable() { set -B; }; enable; eval 'printf "<%s>\n" {a,b}'`],
  ["command substitution inherits and isolates options", String.raw`set +B; printf '<%s>\n' "$(printf '%s' {a,b}; set -B; printf '%s' {c,d})"; printf '<%s>\n' {a,b}`],
  ["child Bash starts with independent default", String.raw`set +B; bash -c 'printf "<%s>\n" {a,b}'; printf '<%s>\n' {a,b}`],
  ["child Bash accepts short option", String.raw`bash +B -c 'printf "<%s>\n" {a,b}; set -B; printf "<%s>\n" {a,b}'`],
  ["pipeline stages inherit but isolate option state", String.raw`set +B; printf '<%s>\n' {a,b} | cat; set -B | cat; printf '<%s>\n' {a,b}`],
] as const;

for (const [name, source] of cases) {
  test(`brace expansion differential: ${name}`, async context => {
    const expected = native(source);
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dev");
    await fs.writeFile("/dev/null", new Uint8Array());
    const shell = new Shell({ fs, env: environment }).use(agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec(source);
    assert.deepEqual({ stdout: Buffer.from(actual.stdoutBytes).toString("hex"), stderr: Buffer.from(actual.stderrBytes).toString("hex"), exitCode: actual.exitCode }, expected);
  });
}

for (const invocation of ["bash /body", "/body", ". /body"] as const) {
  test(`brace expansion differential: VFS script through ${invocation}`, async context => {
    const body = String.raw`printf '<%s>\n' {a,b}; set +B; printf '<%s>\n' {1..3}`;
    const fs = createMemoryFileSystem();
    await fs.writeFile("/body", Buffer.from(`#!/bin/bash\n${body}\n`), { mode: 0o755 });
    const shell = new Shell({ fs, env: environment }).use(agentCommands());
    context.after(() => shell.dispose());
    const expected = native(`${invocation === ". /body" ? body : `( ${body} )`}; printf '<%s>\\n' {x,y}`);
    const actual = await shell.exec(`${invocation}; printf '<%s>\\n' {x,y}`);
    assert.deepEqual({ stdout: Buffer.from(actual.stdoutBytes).toString("hex"), stderr: Buffer.from(actual.stderrBytes).toString("hex"), exitCode: actual.exitCode }, expected);
  });
}

test("brace expansion respects small field admission before command effects", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  let calls = 0;
  shell.register({ name: "observe", execute() { calls++; return { exitCode: 0 }; } });
  await assert.rejects(shell.exec("observe {a,b}{1,2}", { limits: { maxExpansionFields: 3 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionFields");
  assert.equal(calls, 0);
  assert.equal((await shell.exec("observe {a,b}")).exitCode, 0);
  assert.equal(calls, 1);
});

test("brace expansion accounts for repeated prefix bytes before command effects", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  let calls = 0;
  shell.register({ name: "observe", execute() { calls++; return { exitCode: 0 }; } });
  await assert.rejects(shell.exec(`observe ${"x".repeat(256)}{1..8}`, { limits: { maxExpansionBytes: 1024 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.equal(calls, 0);
});

test("brace expansion preserves cancellation during a duplicated substitution", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  context.after(() => shell.dispose());
  const controller = new AbortController();
  const reason = new Error("brace-substitution-cancel");
  let calls = 0;
  shell.register({ name: "cancel", execute() { calls++; controller.abort(reason); throw reason; } });
  await assert.rejects(shell.exec("printf '%s' {a,b}$(cancel)", { signal: controller.signal }), error => error === reason);
  assert.equal(calls, 1);
});

for (const [limit, maximum, source] of [
  ["maxParseUnits", 2, "{{{a,b}}}"],
  ["maxExpansionBytes", 128, "{{{a,b}}}"],
  ["maxExpansionBytes", 1024, `${"é".repeat(128)}{1..8}`],
] as const) {
  test(`brace expansion helper releases allocations after ${limit}=${maximum}`, async context => {
    const budget = new Budget(resolveLimits({ [limit]: maximum }));
    context.after(() => budget.close());
    let yielded = 0;
    await assert.rejects(async () => {
      for await (const ignoredWord of expandBraces({ offset: 0, parts: [{ kind: "text", value: source, quoted: false }] }, budget, budget.signal)) yielded++;
    }, error => error instanceof ShellLimitError && error.limit === limit);
    assert.equal(yielded, 0);
    assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
  });
}

test("brace expansion helper releases allocations on early iterator return", async context => {
  const budget = new Budget(resolveLimits());
  context.after(() => budget.close());
  const expansion = expandBraces({ offset: 0, parts: [{ kind: "text", value: "{1..4}", quoted: false }] }, budget, budget.signal);
  assert.equal((await expansion.next()).done, false);
  assert.ok(budget.values.usage.bytes > 0);
  await expansion.return(undefined);
  assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
});

test("brace expansion helper cooperatively cancels a bounded sequence", async context => {
  const controller = new AbortController();
  const budget = new Budget(resolveLimits(), controller.signal);
  context.after(() => budget.close());
  const reason = new Error("brace-generation-cancel");
  const expansion = expandBraces({ offset: 0, parts: [{ kind: "text", value: "{1..64}", quoted: false }] }, budget, budget.signal);
  assert.equal((await expansion.next()).done, false);
  let yielded = 1;
  const immediate = setImmediate(() => controller.abort(reason));
  context.after(() => clearImmediate(immediate));
  await assert.rejects(async () => {
    for await (const ignoredWord of expansion) yielded++;
  }, error => error === reason);
  assert.ok(yielded < 64);
  assert.deepEqual(budget.values.usage, { bytes: 0, slots: 0 });
});
