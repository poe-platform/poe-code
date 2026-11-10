import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { test } from "node:test";
import { MemoryFileSystem as BrowserMemoryFileSystem, Shell as BrowserShell } from "../../src/index.js";
import { basicCommands } from "../../src/commands/basic.js";
import { standardCommands } from "../../src/commands/index.js";
import { createCommandArguments } from "../../src/contracts/command.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { Runtime } from "../../src/shell/runtime.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { ValueArena, ValueStore } from "../../src/shell/value-state.js";
import { setup } from "./helpers.js";

for (const script of [
  "printf -v bad-name %s hello",
  "printf -vbad-name %s hello",
  "builtin printf -v bad-name %s hello",
  "command printf -v bad-name %s hello",
  "printf -v '' %s hello",
  'value=old\nprintf -v "value[0" %s hello\nstatus=$?\nprintf "%s" "$value"\nexit "$status"',
  "bash --noprofile --norc -c '\n\nprintf -v bad-name %s hello' named-script",
]) {
  test(`printf -v invalid destination keeps Bash diagnostic context: ${script}`, async () => {
    const oracle = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", script, "shell"], {
      env: { PATH: `${dirname(bashExecutable)}:/usr/bin:/bin`, LC_ALL: "C" }, timeout: 2000,
    });
    assert.ifError(oracle.error);
    assert.equal(oracle.signal, null);
    assert.equal(oracle.status, 2);
    const shell = new BrowserShell({ fs: new BrowserMemoryFileSystem(), env: { LC_ALL: "C" } }).use(standardCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, oracle.status);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
      assert.deepEqual(result.stderrBytes, new Uint8Array(oracle.stderr));
    } finally { await shell.dispose(); }
  });
}

for (const prefix of ["", "builtin ", "command "]) {
  for (const readonly of [false, true]) {
    test(`${prefix}printf -v stops the script on malformed subscript arithmetic, readonly=${readonly}`, async context => {
      const shell = new BrowserShell({ fs: new BrowserMemoryFileSystem() }).use(standardCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(`a=(old); ${readonly ? "readonly -a a; " : ""}${prefix}printf -v 'a[1+]' 'ok%n' n; printf 'continued:%s' "$?"`);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(result.stdoutBytes, new Uint8Array());
      assert.ok(result.stderr.includes("1+: arithmetic syntax error"), result.stderr);
    });
  }
  for (const [subscript, status] of [["", 2], ["-2", 1]] as const) {
    test(`${prefix}printf -v keeps subscript ${JSON.stringify(subscript)} recoverable`, async context => {
      const shell = new BrowserShell({ fs: new BrowserMemoryFileSystem() }).use(standardCommands());
      context.after(() => shell.dispose());
      const result = await shell.exec(`a=(old); ${prefix}printf -v 'a[${subscript}]' 'ok%n' n; printf 'continued:%s:%s' "$?" "\${a[0]}"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `continued:${status}:old`);
      assert.notEqual(result.stderr, "");
    });
  }
}

function fixture(options: Parameters<typeof setup>[0] = {}) {
  const result = setup(options);
  for (const command of basicCommands()) result.commands.register(command);
  return result;
}

// Byte expectations captured with GNU Bash 5.3 on Linux in C.UTF-8.
for (const [format, operand, hex] of [
  ["%q", String.raw`a\u00adb`, "61c2ad62"],
  ["%Q", String.raw`a\u200db`, "61e2808d62"],
  ["%#q", String.raw`a\u00adb`, "2761c2ad6227"],
  ["%.2q", String.raw`a\u00adb`, "61c2"],
  ["%q", String.raw`a\u0065b`, "616562"],
  ["%q", String.raw`a\u0007b`, "2427615c616227"],
  ["%#q", String.raw`a\u0007b`, "2427615c616227"],
] as const) {
  test(`printf ${format} preserves C.UTF-8 quoting bytes for ${operand}`, async context => {
    const { shell } = fixture({ env: { LC_ALL: "C.UTF-8" } });
    context.after(() => shell.dispose());
    const result = await shell.exec(`printf -v v '${format}' $'${operand}'; status=$?; printf %s "$v"; exit "$status"`);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.stderrBytes, new Uint8Array());
    assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.from(hex, "hex")));
  });
}

for (const prefix of ["", "builtin ", "command "]) {
  for (const [args, exitCode, stdout] of [
    ["", 2, ""],
    ["--", 2, ""],
    ["-x", 2, ""],
    ["-v x -x", 2, ""],
    ["-v x", 2, ""],
    ["''", 0, ""],
    ["-- -x", 0, "-x"],
    ["'%Z'", 1, ""],
    ["'%d' bad", 1, "0"],
  ] as const) {
    test(`${prefix}printf ${args} distinguishes invocation and formatting errors`, async () => {
      const shell = new BrowserShell({ fs: new BrowserMemoryFileSystem(), env: { LC_ALL: "C" } }).use(standardCommands());
      try {
        const result = await shell.exec(`${prefix}printf ${args}`);
        assert.equal(result.exitCode, exitCode, result.stderr);
        assert.equal(result.stdout, stdout);
        assert.equal(result.stderr.length > 0, exitCode !== 0);
      } finally { await shell.dispose(); }
    });
  }
}

for (const prefix of ["", "builtin ", "command "]) {
  for (const args of ["-x", "-xyz", "--bad", "-v", "-v value -v"]) {
    test(`${prefix}printf ${args} prints the option diagnostic and usage`, async context => {
      const source = `\n${prefix}printf ${args}`;
      const oracle = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source, "shell"], { env: { LC_ALL: "C" }, timeout: 2000 });
      assert.ifError(oracle.error);
      assert.equal(oracle.status, 2);
      assert.equal(oracle.stdout.length, 0);
      const { shell } = fixture();
      context.after(() => shell.dispose());
      const result = await shell.exec(source, { env: { LC_ALL: "C" } });
      assert.equal(result.exitCode, oracle.status);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
      assert.deepEqual(result.stderrBytes, new Uint8Array(oracle.stderr));
    });
  }
  for (const separator of ["", "-- "]) {
    for (const loop of [false, true]) {
      test(`${prefix}printf accepts a lone hyphen with ${separator || "no separator"}, loop=${loop}`, async context => {
        const body = `${prefix}printf ${separator}-; value=old; ${prefix}printf -v value ${separator}-; echo "$?:$value"`;
        const script = loop ? `for i in 1 2; do ${body}; done` : body;
        const oracle = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", script], { encoding: "utf8", env: { LC_ALL: "C" }, timeout: 2000 });
        assert.ifError(oracle.error);
        assert.equal(oracle.status, 0);
        assert.equal(oracle.stderr, "");
        assert.equal(oracle.stdout, loop ? "-0:-\n-0:-\n" : "-0:-\n");
        const { shell } = fixture();
        context.after(() => shell.dispose());
        const result = await shell.exec(script, { env: { LC_ALL: "C" } });
        assert.equal(result.exitCode, oracle.status, result.stderr);
        assert.equal(result.stderr, oracle.stderr);
        assert.equal(result.stdout, oracle.stdout);
      });
    }
  }
  test(`${prefix}printf still rejects unknown options`, async context => {
    const { shell } = fixture();
    context.after(() => shell.dispose());
    const output = await shell.exec(`${prefix}printf -x`);
    assert.equal(output.exitCode, 2);
    assert.equal(output.stdout, "");
    assert.equal(output.stderr, "shell: line 1: printf: -x: invalid option\nprintf: usage: printf [-v var] format [arguments]\n");
    const assignment = await shell.exec(`value=old; ${prefix}printf -v value -x; echo "$?:$value"`);
    assert.equal(assignment.stdout, "2:old\n");
    assert.equal(assignment.stderr, output.stderr);
  });
}

for (const initial of ["a=(old)", "declare -A a=([0]=old)"]) {
  for (const options of ["-v 'a[]'", "'-va[]'", "-v 'a[]' -v other"]) {
    test(`printf rejects an empty subscript before formatting: ${initial}; ${options}`, async context => {
      const script = `${initial}; printf ${options} 'ok%n' n; printf '%s|%s|%s|%s' "$?" "\${n-unset}" "$a" "\${other-unset}"`;
      const oracle = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", script], { env: { LC_ALL: "C" }, timeout: 2000 });
      assert.ifError(oracle.error);
      assert.equal(oracle.status, 0);
      assert.equal(oracle.stdout.toString(), "2|unset|old|unset");
      const diagnostic = "a[]': not a valid identifier\n";
      assert.ok(oracle.stderr.toString().endsWith(diagnostic));
      const { shell } = fixture();
      context.after(() => shell.dispose());
      const result = await shell.exec(script);
      assert.equal(result.exitCode, oracle.status, result.stderr);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
      assert.ok(result.stderr.endsWith(diagnostic), result.stderr);
    });
  }
}

for (const [args, diagnostic] of [["-x", "-x: invalid option"], ["-v", "-v: option requires an argument"]]) {
  test(`printf ${args} uses the child shell command context`, async context => {
    const { shell } = fixture();
    context.after(() => shell.dispose());
    const result = await shell.exec(`bash -c '\nprintf ${args}' named`);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `named: line 2: printf: ${diagnostic}\nprintf: usage: printf [-v var] format [arguments]\n`);
  });
}

for (const name of ["IFS", "OPTIND", "RANDOM", "SECONDS"]) {
  test(`printf -v ${name} uses the normal variable writer`, async context => {
    const writes = context.mock.method(Runtime.prototype, "writeVariable");
    const { shell } = fixture({ limits: { maxExpansionFields: Infinity, maxExpansionBytes: Infinity } });
    try {
      const result = await shell.exec(`printf -v ${name} %s 123`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(writes.mock.calls.some(call => call.arguments[1] === name && call.arguments[2] === "123"));
    } finally { await shell.dispose(); }
  });
}

for (const [name, script, expected] of [
  ["outer indexed binding", 'value=(outer tail); f(){ local -a value; value[0]=inner; }; f; printf "<%s:%s>" "${value[0]}" "${value[1]}"', "<outer:tail>"],
  ["repeated declaration", 'f(){ local -a value; value[2]=inner; local -a value; printf "<%s>" "${value[2]}"; }; f', "<inner>"],
  ["previously absent binding", 'f(){ local -a value; value[0]=inner; }; f; declare -p value >/dev/null 2>&1; printf %s "$?"', "1"],
  ["nested sparse bindings", 'value=([2]=outer [5]=tail); inner(){ local -a value; value[2]=inner; }; outer(){ local -a value; value[2]=middle; inner; printf "<%s>" "${value[2]}"; }; outer; printf "<%s:%s>" "${value[2]}" "${value[5]}"', "<middle><outer:tail>"],
  ["return cleanup", 'value=(outer tail); f(){ local -a value; value[0]=inner; return 7; }; f; printf "<%s:%s:%s>" "$?" "${value[0]}" "${value[1]}"', "<7:outer:tail>"],
  ["multiple local names", 'left=(left); right=(right); f(){ local -a left right; left[0]=one; right[0]=two; }; f; printf "<%s:%s>" "${left[0]}" "${right[0]}"', "<left:right>"],
] as const) {
  test(`local -a restores scope: ${name}`, async () => {
    const oracle = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", script], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000 });
    assert.ifError(oracle.error);
    assert.equal(oracle.signal, null);
    assert.equal(oracle.status, 0);
    assert.equal(oracle.stderr.length, 0);
    assert.equal(oracle.stdout.toString(), expected);
    const { shell } = fixture();
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
    } finally { await shell.dispose(); }
  });
}

const cases = [
  ["compound printf hexadecimal fallback executes once", 'n=0; if true; then ((n++)); printf -v x "%04x" 10; fi; echo "n=$n x=$x"'],
  ["compound printf wide fallback executes once", 'n=0; if true; then ((n++)); printf -v x "%129s" a; fi; echo "n=$n x=$x"'],
  ["compound printf escaped fallback executes once", String.raw`n=0; if true; then ((n++)); printf -v x '\u0041'; fi; echo "n=$n x=$x"`],
  ["printf preserves FUNCNAME", 'f() { printf -v FUNCNAME %s hacked; echo "FUNCNAME=$FUNCNAME"; }; f'],
  ["loop printf preserves FUNCNAME", 'f() { for ((i=0;i<2;i++)); do printf -v FUNCNAME %s hacked; done; echo "FUNCNAME=$FUNCNAME"; }; f'],
  ["printf SECONDS uses its setter", 'printf -v SECONDS %s 123; echo "$SECONDS"'],
  ["printf RANDOM seeds its generator", 'RANDOM=123; first=$RANDOM; printf -v RANDOM %s 123; second=$RANDOM; [[ "$first" = "$second" ]]; echo "$?"'],
  ["printf UTF-8 string widths", 'printf "[%5s][%-5s][%5s]" é é 😀; printf -v x "[%5s][%-5s][%5s]" é é 😀; printf %s "$x"'],
  ["associative printf destinations", 'declare -A map; printf -v "map[foo]" %s hello; printf -v "map[01]" %s leading; printf "<%s:%s>" "${map[foo]}" "${map[01]}"'],
  ["arithmetic printf destinations", 'arr=(a b c); i=1; printf -v "arr[i]" %s updated; printf -v "arr[i+1]" %s last; printf "<%s:%s>" "${arr[1]}" "${arr[2]}"'],
  ["relative and quoted printf destinations", 'arr=(a b c); printf -v "arr[-1]" %s last; printf -v \'arr["01"]\' %s middle; printf "<%s:%s>" "${arr[1]}" "${arr[2]}"'],
  ["expanded associative printf destination", 'declare -A map; key="a b"; printf -v \'map[$key]\' %s spaced; printf %s "${map[$key]}"'],
  ["quoted associative printf destination", `declare -A map; printf -v "map['a b']" %s spaced; printf %s "\${map['a b']}"`],
  ["nameref associative printf destination", 'declare -A map; f(){ local -n ref=map; printf -v "ref[foo]" %s hello; }; f; printf %s "${map[foo]}"'],
  ["printf control quoting", String.raw`printf '%q\n' $'a\tb\rc\x01' $'\a\b\e\f\n\v\x7f' $'quote\'slash\\\t'`],
  ["local integer initializer", "f(){ local -i a='2+3'; printf %s \"$a\"; }; f"],
  ["local integer subsequent writes", 'a=outer; f(){ local -i a=2; a="a+3"; printf -v a %s "a*2"; printf %s "$a"; }; f; printf %s "$a"'],
  ["local uppercase subsequent writes", 'f(){ local -u value=before; printf -v value %s mixed; printf %s "$value"; }; f'],
  ["local lowercase subsequent writes", 'f(){ local -l value=before; printf -v value %s MIXED; printf %s "$value"; }; f'],
  ["scalar and empty assignment", 'value=old; printf -v value "%s:%03d" hi 7; printf "<%s>" "$value"; printf -v value ""; printf "<%s>" "$value"'],
  ["dynamic locals", 'value=global; inner() { printf -v value %s changed; }; outer() { local value=local; inner; printf "<%s>" "$value"; }; outer; printf "<%s>" "$value"'],
  ["readonly refusal", 'readonly value=old; printf -v value %s new; printf "<%s:%s>" "$?" "$value"'],
  ["readonly index side effect", 'a=(old); i=0; readonly -a a; printf -v \'a[i++]\' %s new; echo rc=$? i=$i first=${a[0]}'],
  ["writable index side effect", 'a=(old); i=0; printf -v \'a[i++]\' %s new; echo rc=$? i=$i first=${a[0]}'],
  ["missing format skips readonly index", 'a=(old); i=0; readonly -a a; printf -v \'a[i++]\'; echo rc=$? i=$i first=${a[0]}'],
  ["loop readonly index side effect", 'a=(old); i=0; readonly -a a; for n in 1 2; do printf -v \'a[i++]\' %s new; echo rc=$? i=$i first=${a[0]}; done'],
  ["temporary prefix publication", 'value=old; value=temp printf -v value %s new; printf "<%s>" "$value"'],
  ["nameref target prefix restoration", 'a=old; declare -n r=a; a=x printf -v r %s new; printf "%s|%s" "$?" "$a"'],
  ["nameref prefix restoration", 'a=old; declare -n r=a; r=x printf -v r %s new; printf "%s|%s" "$?" "$a"'],
  ["nameref indexed target prefix restoration", 'a=old; declare -n r=a; a=x printf -v "r[1]" %s new; printf "%s|%s|%s" "$?" "$a" "${a[1]-unset}"'],
  ["nameref indexed prefix restoration", 'a=old; declare -n r=a; r=x printf -v "r[1]" %s new; printf "%s|%s|%s" "$?" "$a" "${a[1]-unset}"'],
  ["nameref existing array prefix restoration", 'a=(old tail); declare -n r=a; a=x builtin printf -v "r[1]" %s new; printf "%s|%s|%s" "$?" "${a[0]}" "${a[1]}"'],
  ["nameref byte prefix restoration", String.raw`a=$(printf '\377'); declare -n r=a; a=x command printf -v r %s new; printf '%s|' "$?"; printf '%s' "$a"`],
  ["nameref publication without prefix", 'a=old; declare -n r=a; printf -v r %s new; printf "%s|%s" "$?" "$a"'],
  ["nameref prefix direct target publication", 'a=old; declare -n r=a; r=x printf -v a %s new; printf "%s|%s" "$?" "$a"'],
  ["function and explicit builtin resolution", 'printf() { builtin printf function; }; printf -v value %s ignored; command printf -v value %s command; builtin printf "<%s>" "$value"; builtin printf -v value %s builtin; builtin printf "<%s>" "$value"'],
  ["format-error partial publication", 'value=old; printf -v value "prefix%s%Z" body; printf "<%s:%s>" "$?" "$value"'],
  ["numeric-error publication", 'printf -v value "%d:%s" nope tail; printf "<%s:%s>" "$?" "$value"'],
  ["NUL truncation and invalid bytes", 'printf -v value "\\377\\000discard%s" tail; printf "%s" "$value"'],
  ["indexed lvalues and scalar promotion", 'value=zero; printf -v "value[2]" "%s" two; printf -v value "%s" replaced; printf "<%s:%s>" "${value[0]}" "${value[2]}"'],
  ["option forms and repetition", 'printf -vfirst -v second -- "-%s" A B; printf "<%s:%s>" "$first" "$second"'],
  ["same-text prefix and unrelated restoration", 'value=old; other=before; value=temp other=during printf -v value %s temp; printf "<%s:%s>" "$value" "$other"'],
  ["nested prefix and local restoration", 'value=global; outer() { local value=local; value=temp inner; printf "<%s>" "$value"; }; inner() { printf -v value %s changed; printf "<%s>" "$value"; }; outer; printf "<%s>" "$value"'],
  ["unexported prefix result", 'value=old; value=temp printf -v value %s new; sh -c \'printf "<%s>" "${value-unset}"\'; printf "<%s>" "$value"'],
  ["exported prefix result", 'export value=old; value=temp printf -v value %s new; sh -c \'printf "<%s>" "$value"\''],
  ["subshell and command substitution isolation", 'value=parent; (printf -v value %s child; printf "<%s>" "$value"); result=$(printf -v value %s substitution; printf "<%s>" "$value"); printf "%s<%s>" "$result" "$value"'],
  ["pipeline isolation", 'value=parent; printf -v value %s child | printf ignored; printf "<%s>" "$value"'],
  ["local indexed restoration", 'value=(outer tail); f() { local -a value; printf -v "value[2]" %s inner; printf -v value %s zero; printf "<%s:%s>" "${value[0]}" "${value[2]}"; }; f; printf "<%s:%s>" "${value[0]}" "${value[1]}"'],
  ["readonly indexed and local refusal", 'value=(old tail); readonly value; printf -v "value[1]" %s changed; printf "<%s:%s>" "$?" "${value[1]}"; f() { local other=old; readonly other; printf -v other %s new; printf "<%s:%s>" "$?" "$other"; }; f'],
  ["quoted lvalue and boundary subscript", 'printf -v "value[2]" %s two; printf -v "value[2147483647]" %s last; printf "<%s:%s>" "${value[2]}" "${value[2147483647]}"'],
  ["empty index-zero publication", 'value=(old tail); printf -v value ""; printf "<%s:%s>" "${value[0]}" "${value[1]}"'],
  ["missing arguments and invalid names", 'value=old; printf -v; printf "<%s>" "$?"; printf -v value; printf "<%s>" "$?"; printf -v "bad-name" %s new; printf "<%s:%s>" "$?" "$value"'],
  ["invalid earlier target is not skipped", 'value=old; printf -v "bad-name" -v value %s new; printf "<%s:%s>" "$?" "$value"'],
  ["format failure with empty prefix", 'value=old; printf -v value %Z; printf "<%s:%s>" "$?" "$value"'],
  ["format failure after NUL", 'printf -v value "a\\000b%Z"; printf "<%s:%s>" "$?" "$value"'],
  ["format failure and readonly", 'readonly value=old; printf -v value "a%Z"; printf "<%s:%s>" "$?" "$value"'],
  ["escape stop and trailing newlines", 'printf -v value "%bignored" "body\\cstop"; printf "<%s>" "$value"; printf -v value "tail\\n\\n"; printf "<%s>" "$value"'],
  ["embedded NUL argument and NUL-first output", 'printf -v value %c; printf "<%s>" "$value"; printf -v value "\\000%s%Z" tail; printf "<%s:%s>" "$?" "$value"'],
  ["split UTF-8 and BOM", 'printf -v value "\\303%s" "$(printf \'\\251\')"; printf "%s" "$value"; printf -v value "\\357\\273\\277text"; printf "%s" "$value"'],
  ["invalid UTF-8 format and argument", 'format=$(printf \'\\377%%s\\376\'); argument=$(printf \'\\200\'); printf -v value "$format" "$argument"; copy=$value; printf "%s" "$copy"'],
  ["literal formatter behavior", 'printf -v value "%05d|%-5.3s|%#x|%.2f|%o|%q" -3 abcdef 15 1.25 8 "a b"; printf "%s" "$value"'],
  ["format beginning with option marker", 'printf -v value -- --; printf "<%s>" "$value"; printf -v value -- -v ignored; printf "<%s>" "$value"'],
  ["OPTIND storage hook", 'set -- -a -b; getopts ab flag; printf -v OPTIND %s 1; getopts ab flag; printf "<%s:%s>" "$flag" "$OPTIND"'],
  ["readonly under errexit", 'set -e; readonly value=old; printf -v value %s new; printf unreachable'],
  ["invalid-format under errexit", 'set -e; printf -v value "partial%Z"; printf unreachable'],
  ["nested command and builtin prefix", 'value=old; value=temp command builtin printf -v value %s new; printf "<%s>" "$value"'],
  ["byte local and outer restoration", 'value=$(printf "\\376"); f() { local value; printf -v value "\\377"; printf "%s" "$value"; }; f; printf "%s" "$value"'],
  ["replacing byte scalar at index zero", 'value=$(printf "\\377"); printf -v "value[0]" %s new; printf "%s" "$value"'],
  ["UTF-8 indexed payload and BOM", 'printf -v "value[1]" "\\357\\273\\277é"; printf "%s" "${value[1]}"'],
] as const;

for (const [source, expected] of [
  ['f(){ local -n ref=target; target=hello; printf %s "$ref"; }; f', "hello"],
  ['target=outer; f(){ local -n ref=target; ref=inner; printf -v ref %s changed; printf %s "$target"; }; f; printf %s "$target"', "changedchanged"],
  ['target=outer; ref=global; f(){ local -n ref=target; g(){ local ref=shadow; printf %s "$ref"; }; g; printf %s "$ref"; }; f; printf %s "$ref"', "shadowouterglobal"],
  ['f(){ local -i count=2; count+=3; printf %s "$count"; }; f', "5"],
  ['f(){ local -i count=2; g(){ local count=text; printf %s "$count"; }; g; count="count+1"; printf %s "$count"; }; f', "text3"],
  ['f(){ local -n ref=target; local -n other=ref; target=hello; (printf %s "$other"); printf %s "$ref"; }; f', "hellohello"],
  [String.raw`f(){ local -n ref=target; target=$'\xff'; printf '%s' "$ref"; }; f`, "�"],
  ['f(){ local -n ref=target; target=hello; unset ref; printf "<%s>" "${target-unset}"; }; f', "<unset>"],
] as const) {
  test(`local attributes: ${source}`, async () => {
    const { shell } = fixture();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
}

test("local nameref preserves raw bytes in reads and writes", async () => {
  const { shell } = fixture();
  const result = await shell.exec(String.raw`f(){ local -n ref=target; target=$'\xff'; printf '%s' "$ref"; printf -v ref '\376'; printf '%s' "$target"; }; f`);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 254));
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

test("local nameref refuses writes to readonly targets", async () => {
  const { shell } = fixture();
  const result = await shell.exec('readonly target=old; f(){ local -n ref=target; printf -v ref %s new; printf "<%s:%s>" "$?" "$ref"; }; f');
  assert.equal(result.stdout, "<1:old>");
  assert.match(result.stderr, /readonly variable/u);
});

test("local nameref rejects invalid targets without replacing the outer binding", async () => {
  const { shell } = fixture();
  const result = await shell.exec('ref=outer; f(){ local -n ref=bad-name; printf "<%s:%s>" "$?" "$ref"; }; f; printf %s "$ref"');
  assert.equal(result.stdout, "<1:outer>outer");
  assert.match(result.stderr, /invalid name reference/u);
});

test("local nameref cycles stop with a diagnostic", async () => {
  const { shell } = fixture();
  const result = await shell.exec('f(){ local -n first=second; local -n second=first; printf %s "$first"; }; f');
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /circular name reference/u);
});

// GNU Bash 5.0.17 qualified the original corpus (docs/plans/bugfix-636-printf-variable.md).
// Fixed contracts preserve required empty/readonly/indexed assignment on Bash 3 hosts.
const modernContracts = new Map<string, { stdout: Uint8Array; hasStderr: boolean }>([
  ["compound printf escaped fallback executes once", { stdout: new TextEncoder().encode("n=1 x=A\n"), hasStderr: false }],
  ["relative and quoted printf destinations", { stdout: new TextEncoder().encode("<middle:last>"), hasStderr: false }],
  ["expanded associative printf destination", { stdout: new TextEncoder().encode("spaced"), hasStderr: false }],
  ["quoted associative printf destination", { stdout: new TextEncoder().encode("spaced"), hasStderr: false }],
  ["local uppercase subsequent writes", { stdout: new TextEncoder().encode("MIXED"), hasStderr: false }],
  ["local lowercase subsequent writes", { stdout: new TextEncoder().encode("mixed"), hasStderr: false }],
  ["arithmetic printf destinations", { stdout: new TextEncoder().encode("<updated:last>"), hasStderr: false }],
  ["associative printf destinations", { stdout: new TextEncoder().encode("<hello:leading>"), hasStderr: false }],
  ["nameref associative printf destination", { stdout: new TextEncoder().encode("hello"), hasStderr: false }],
  ["scalar and empty assignment", { stdout: new TextEncoder().encode("<hi:007><>"), hasStderr: false }],
  ["readonly refusal", { stdout: new TextEncoder().encode("<1:old>"), hasStderr: true }],
  ["readonly index side effect", { stdout: new TextEncoder().encode("rc=1 i=1 first=old\n"), hasStderr: true }],
  ["writable index side effect", { stdout: new TextEncoder().encode("rc=0 i=1 first=new\n"), hasStderr: false }],
  ["missing format skips readonly index", { stdout: new TextEncoder().encode("rc=2 i=0 first=old\n"), hasStderr: true }],
  ["loop readonly index side effect", { stdout: new TextEncoder().encode("rc=1 i=1 first=old\nrc=1 i=2 first=old\n"), hasStderr: true }],
  ["indexed lvalues and scalar promotion", { stdout: new TextEncoder().encode("<replaced:two>"), hasStderr: false }],
  ["local indexed restoration", { stdout: new TextEncoder().encode("<zero:inner><outer:tail>"), hasStderr: false }],
  ["readonly indexed and local refusal", { stdout: new TextEncoder().encode("<1:tail><1:old>"), hasStderr: true }],
  ["quoted lvalue and boundary subscript", { stdout: new TextEncoder().encode("<two:last>"), hasStderr: false }],
  ["empty index-zero publication", { stdout: new TextEncoder().encode("<:tail>"), hasStderr: false }],
  ["replacing byte scalar at index zero", { stdout: new TextEncoder().encode("new"), hasStderr: false }],
  ["UTF-8 indexed payload and BOM", { stdout: Uint8Array.of(239, 187, 191, 195, 169), hasStderr: false }],
]);
const bashExecutable = process.env.SAFE_BASH_TEST_BASH ?? "/bin/bash";
const version = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", 'printf "%s" "$BASH_VERSION"'], {
  env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000,
});
assert.ifError(version.error);
assert.equal(version.signal, null);
assert.equal(version.status, 0);
assert.equal(version.stderr.length, 0);
const bashVersion = version.stdout.toString();
const bashMajor = Number(bashVersion.split(".")[0]);
assert.ok(Number.isInteger(bashMajor) && bashMajor > 0, `Invalid Bash version: ${bashVersion}`);

for (const [name, source, expected] of [
  ["indexed escape", "a=(old keep); printf -v 'a[0]' '%b' '\\xff'; printf '%s|%s|%s' \"$?\" \"${a[0]}\" \"${a[1]}\"", [48, 124, 255, 124, 107, 101, 101, 112]],
  ["associative escape", "declare -A a; a[key]=old; a[other]=keep; printf -v 'a[key]' '%b' '\\xff'; printf '%s|%s|%s' \"$?\" \"${a[key]}\" \"${a[other]}\"", [48, 124, 255, 124, 107, 101, 101, 112]],
  ["indexed raw argument", "a=(old keep); printf -v 'a[0]' '%s' $'\\xff'; printf '%s|%s|%s' \"$?\" \"${a[0]}\" \"${a[1]}\"", [48, 124, 255, 124, 107, 101, 101, 112]],
  ["associative raw argument", "declare -A a; printf -v 'a[key]' '%s' $'\\xff'; printf '%s|%s' \"$?\" \"${a[key]}\"", [48, 124, 255]],
  ["implicit index zero", "a=(old keep); printf -v a '%s' $'\\xff'; printf '%s|%s|%s' \"$?\" \"${a[0]}\" \"${a[1]}\"", [48, 124, 255, 124, 107, 101, 101, 112]],
  ["byte scalar promotion", "a=$'\\xff'; printf -v 'a[1]' '%s' new; printf '%s|%s|%s' \"$?\" \"${a[0]}\" \"${a[1]}\"", [48, 124, 255, 124, 110, 101, 119]],
  ["indexed NUL truncation", "a=(old keep); printf -v 'a[0]' '%b' '\\xff\\0discard'; printf '%s|%s|%s' \"$?\" \"${a[0]}\" \"${a[1]}\"", [48, 124, 255, 124, 107, 101, 101, 112]],
] as const) {
  test(`printf -v preserves bytes: ${name}`, async context => {
    const { shell } = fixture({ env: { LC_ALL: "C" } });
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdoutBytes, Uint8Array.from(expected));
      await context.test("GNU Bash 5+ native comparison", { skip: bashMajor < 5 }, () => {
        const oracle = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", source], {
          env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000,
        });
        assert.ifError(oracle.error);
        assert.equal(oracle.status, result.exitCode);
        assert.equal(oracle.stderr.length, 0);
        assert.deepEqual(new Uint8Array(oracle.stdout), result.stdoutBytes);
      });
    } finally { await shell.dispose(); }
  });
}

for (const unlimited of [false, true]) {
  for (const [name, script] of cases) {
    test(`printf -v: ${name}${unlimited ? " (unlimited expansion)" : ""}`, async context => {
      const { shell } = fixture(unlimited ? { limits: { maxExpansionFields: Infinity, maxExpansionBytes: Infinity } } : {});
      try {
        const result = await shell.exec(script);
        const compareNative = () => {
          const oracle = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", script], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000 });
          assert.ifError(oracle.error);
          assert.equal(oracle.signal, null);
          assert.equal(result.exitCode, oracle.status, result.stderr);
          assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout), result.stderr);
          assert.equal(result.stderr.length > 0, oracle.stderr.length > 0);
        };
        const contract = modernContracts.get(name);
        if (contract !== undefined) {
          assert.equal(result.exitCode, 0, result.stderr);
          assert.deepEqual(result.stdoutBytes, contract.stdout, result.stderr);
          assert.equal(result.stderr.length > 0, contract.hasStderr);
          await context.test("GNU Bash 5+ native comparison", {
            skip: bashMajor < 5 ? `GNU Bash 5+ oracle unavailable; ${bashExecutable} is ${bashVersion}` : false,
          }, compareNative);
        } else {
          compareNative();
        }
      } finally { await shell.dispose(); }
    });
  }
}

for (const [initial, target, expected] of [
  ["a=(old)", "a[-3]", "1|2|old|0"],
  ["a=(old)", "a[-3-i++]", "1|2|old|1"],
  ["a=(old); declare -n ref=a", "ref[-3]", "1|2|old|0"],
  ["a=(old)", "a[-1]", "0|2|ok|0"],
] as const) {
  for (const prefix of ["", "builtin ", "command "]) {
    test(`${prefix}printf -v names an out-of-range destination after formatting: ${target}`, async context => {
      const script = `${initial}; i=0;\n${prefix}printf -v '${target}' 'ok%n' n; printf '%s|%s|%s|%s' "$?" "$n" "$a" "$i"`;
      const oracle = spawnSync(bashExecutable, ["--noprofile", "--norc", "-c", script, "shell"], {
        env: { LC_ALL: "C" }, timeout: 2000,
      });
      assert.ifError(oracle.error);
      assert.equal(oracle.status, 0);
      assert.equal(oracle.stdout.toString(), expected);
      assert.equal(oracle.stderr.toString(), target === "a[-1]" ? "" : `shell: line 2: ${target}: bad array subscript\n`);
      const { shell } = fixture();
      context.after(() => shell.dispose());
      const result = await shell.exec(script);
      assert.equal(result.exitCode, oracle.status);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
      assert.deepEqual(result.stderrBytes, new Uint8Array(oracle.stderr));
    });
  }
}

for (const [initial, target, expected] of [
  ["declare -A a=([keep]=OLD)", "a[$key]", "1:1:1:::OLD\n"],
  ["declare -A a=([keep]=OLD)", 'a[""]', "1:1:1:::OLD\n"],
  ["declare -A a=([keep]=OLD); declare -n ref=a", "ref[$key]", "1:1:1:::OLD\n"],
  ["declare -A a=([keep]=OLD)", "a[]", "2:old:1:::OLD\n"],
  ["declare -A a=([keep]=OLD)", "a[1]", "0:1:2::X:OLD\n"],
  ["a=(OLD TWO)", "a[$key]", "0:1:2:X:TWO:X\n"],
] as const) {
  for (const prefix of ["", "builtin ", "command "]) {
    test(`${prefix}printf -v handles expanded empty subscripts: ${initial}; ${target}`, async context => {
      const script = `${initial}; key=''; n=old; ${prefix}printf -v '${target}' 'X%n' n; echo "$?:$n:\${#a[@]}:\${a[0]}:\${a[1]}:\${a[keep]}"`;
      const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script, "shell"], {
        env: { LC_ALL: "C.UTF-8" }, timeout: 2000,
      });
      assert.ifError(oracle.error);
      assert.equal(oracle.signal, null);
      assert.equal(oracle.status, 0);
      assert.equal(oracle.stdout.toString(), expected);
      const { shell } = fixture({ env: { LC_ALL: "C.UTF-8" } });
      context.after(() => shell.dispose());
      const result = await shell.exec(script);
      assert.equal(result.exitCode, oracle.status);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout));
      assert.deepEqual(result.stderrBytes, new Uint8Array(oracle.stderr));
    });
  }
}

test("standalone printf still refuses -v without shell-state capability", async () => {
  const { shell, fs } = fixture();
  const env = { value: "old" };
  const stdout: number[] = [];
  const stderr: number[] = [];
  try {
    const result = await basicCommands().find(command => command.name === "printf")!.execute({
      command: "printf", args: ["-v", "value", "%s", "new"], env, fs, cwd: "/",
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { write: async chunk => { stdout.push(...chunk); } },
      stderr: { write: async chunk => { stderr.push(...chunk); } },
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(stdout, []);
    assert.match(new TextDecoder().decode(Uint8Array.from(stderr)), /invalid option/u);
    assert.deepEqual(env, { value: "old" });
  } finally { await shell.dispose(); }
});

test("printf availability and discovery still follow command registration", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('printf -v value %s new');
    assert.equal(result.exitCode, 127);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /command not found/u);
  } finally { await shell.dispose(); }
});

test("standard command plugin retains shell-state printf assignment", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const result = await shell.exec('printf -v value %s standard; printf "%s" "$value"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "standard");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("custom registered printf remains authoritative through command and builtin", async () => {
  const { shell, commands } = setup();
  let calls = 0;
  commands.register({ name: "printf", execute: () => { calls++; return { exitCode: 17 }; } });
  try {
    for (const prefix of ["", "command ", "builtin "]) {
      const result = await shell.exec(`${prefix}printf -v value %s ignored`);
      assert.equal(result.exitCode, 17);
    }
    assert.equal(calls, 3);
  } finally { await shell.dispose(); }
});

for (const target of ["value[1]tail"]) {
  test(`printf -v refuses malformed lvalue: ${target}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec(`value=old; printf -v '${target}' %s new; printf '<%s:%s>' "$?" "$value"`);
      assert.equal(result.stdout, "<2:old>");
      assert.notEqual(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

for (const target of ["value[2147483648]", "value[]", "value[-2]"]) {
  test(`printf -v rejects invalid array destination: ${target}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec(`value=old; printf -v '${target}' %s new`);
      assert.notEqual(result.exitCode, 0);
      assert.notEqual(result.stderr, "");
      assert.equal(result.stdout, "");
    } finally { await shell.dispose(); }
  });
}


test("printf -v stores raw argv bytes without retaining a mutable producer", async () => {
  const { shell } = fixture();
  const bytes = Uint8Array.of(255, 65);
  shell.use(async (context, next) => {
    if (context.command === "printf" && context.args[0] === "-v") {
      const argumentValues = createCommandArguments(["-v", "value", "%s", shellValueFromBytes(bytes)]);
      Object.assign(context, { argumentValues, args: argumentValues.args });
    }
    const result = await next();
    bytes.fill(66);
    return result;
  });
  try {
    const result = await shell.exec('printf -v value %s ignored; printf "%s" "$value"');
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 65));
  } finally { await shell.dispose(); }
});

test("printf -v preserves export attributes instead of mutating context.env", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec('value=old; printf -v value %s new; envget value; printf ":%s:" "$value"; export value; printf -v value %s exported; envget value');
    assert.equal(result.stdout, "<unset>:new:exported");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("printf -v redirection opens and closes an empty VFS destination", async () => {
  const { shell, fs } = fixture();
  try {
    const result = await shell.exec('printf -v value "partial%Z" >/out; printf "<%s:%s>" "$?" "$value"');
    assert.equal(result.stdout, "<1:partial>");
    assert.deepEqual(await fs.readFile("/out"), new Uint8Array());
  } finally { await shell.dispose(); }
});

test("printf -v invoked child state does not mutate its parent", async () => {
  const { shell, commands } = fixture();
  let calls = 0;
  commands.register({ name: "invoke-printf", async execute(context) {
    calls++;
    return context.invoke!("printf", ["-v", "value", "%s", "child"]);
  } });
  try {
    const result = await shell.exec('export value=parent; invoke-printf; printf "<%s:%s>" "$?" "$value"');
    assert.equal(result.stdout, "<0:parent>");
    assert.equal(result.stderr, "");
    assert.equal(calls, 1);
  } finally { await shell.dispose(); }
});

for (const format of ["%1000001s", "%.1001s", "%.101f"]) {
  test(`printf -v retains existing formatter bound: ${format}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec(`printf -v value 'prefix${format}' x; printf '<%s:%s>' "$?" "$value"`);
      assert.equal(result.stdout, "<1:prefix>");
      assert.match(result.stderr, /too large/u);
    } finally { await shell.dispose(); }
  });
}

test("printf -v output is storage, not external stdout budget", async () => {
  const { shell } = fixture({ limits: { maxOutputBytes: 0 } });
  try { assert.equal((await shell.exec('printf -v value %100s x')).exitCode, 0); }
  finally { await shell.dispose(); }
});

for (const format of ["%10000s", "\\000%10000s"]) {
  test(`printf -v enforces expansion budget before publication: ${format}`, async context => {
    const { shell } = fixture({ limits: { maxExpansionBytes: 2048 } });
    const strings = context.mock.method(ValueStore.prototype, "publishString");
    const values = context.mock.method(ValueStore.prototype, "publish");
    try {
      await assert.rejects(shell.exec(`value=old; printf -v value '${format}' x`), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
      assert.deepEqual([...strings.mock.calls, ...values.mock.calls].filter(call => call.arguments[0] === "value").map(call => call.arguments[1]), ["old"]);
    } finally { await shell.dispose(); }
  });
}

test("printf -v string formatting succeeds with sufficient finite value slots", async () => {
  const { shell } = fixture({ limits: { maxExpansionFields: 64 } });
  try {
    const result = await shell.exec('value=old; printf -v value "a%%b%%c%%d%%e%%f"; printf %s "$value"');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "a%b%c%d%e%f");
  } finally { await shell.dispose(); }
});

test("printf -v string capture enforces finite value slots before publication", async context => {
  const { shell } = fixture({ limits: { maxExpansionFields: 8 } });
  const strings = context.mock.method(ValueStore.prototype, "publishString");
  const values = context.mock.method(ValueStore.prototype, "publish");
  try {
    await assert.rejects(shell.exec('value=old; printf -v value "a%%b%%c%%d%%e%%f"'), error => error instanceof ShellLimitError && error.limit === "maxExpansionFields");
    assert.deepEqual([...strings.mock.calls, ...values.mock.calls].filter(call => call.arguments[0] === "value").map(call => call.arguments[1]), ["old"]);
  } finally { await shell.dispose(); }
});

const retainedByteFormat = "\\377%10000s\\376%10000s";

test("printf -v byte capture shares the existing value-slot budget before publication", async context => {
  const { shell } = fixture({ limits: { maxExpansionFields: 8 } });
  const strings = context.mock.method(ValueStore.prototype, "publishString");
  const values = context.mock.method(ValueStore.prototype, "publish");
  try {
    await assert.rejects(shell.exec(`value=old; printf -v value '${retainedByteFormat}'`), error => error instanceof ShellLimitError && error.limit === "maxExpansionFields");
    assert.deepEqual([...strings.mock.calls, ...values.mock.calls].filter(call => call.arguments[0] === "value").map(call => call.arguments[1]), ["old"]);
  } finally { await shell.dispose(); }
});

test("printf -v byte capture succeeds with sufficient finite value slots", async () => {
  const { shell } = fixture({ limits: { maxExpansionFields: 64 } });
  try {
    const result = await shell.exec(`value=old; printf -v value '${retainedByteFormat}'; printf %s "$value"`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    const expected = new Uint8Array(20002).fill(32);
    expected[0] = 255;
    expected[10001] = 254;
    assert.deepEqual(result.stdoutBytes, expected);
  } finally { await shell.dispose(); }
});

test("printf -v releases intermediate ownership across repeated local calls", async context => {
  const arenas = new Set<ValueArena>();
  const scope = ValueArena.prototype.scope;
  context.mock.method(ValueArena.prototype, "scope", function (this: ValueArena) { arenas.add(this); return scope.call(this); });
  const { shell } = fixture({ limits: { maxExpansionBytes: 8192 } });
  const writes = context.mock.method(Runtime.prototype, "writeVariable");
  try {
    const result = await shell.exec('f() { local value; printf -v value %32s x; }; count=0; while (( count < 100 )); do f; count=$((count+1)); done');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(writes.mock.calls.filter(call => call.arguments[1] === "value").length, 100);
    assert.notEqual(arenas.size, 0);
    for (const arena of arenas) assert.deepEqual(arena.usage, { bytes: 0, slots: 0 });
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, null, ""]) test(`printf -v cancellation prevents publication: ${String(reason)}`, async context => {
  const controller = new AbortController();
  const strings = context.mock.method(ValueStore.prototype, "publishString");
  const values = context.mock.method(ValueStore.prototype, "publish");
  const { shell } = fixture();
  try {
    await assert.rejects(shell.exec('value=old; printf -v value "%s%d" partial invalid', {
      signal: controller.signal,
      stderr: { write: async () => { controller.abort(reason); } },
    }), error => error === reason);
    assert.deepEqual([...strings.mock.calls, ...values.mock.calls].filter(call => call.arguments[0] === "value").map(call => call.arguments[1]), ["old"]);
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, null, ""]) test(`printf -v retains cleanup failure: ${String(reason)}`, async () => {
  const { shell } = fixture();
  shell.use(async (context, next) => {
    if (context.command === "printf") context.registerCleanup!(() => { throw reason; });
    return next();
  });
  try { await assert.rejects(shell.exec('printf -v value %s new'), error => error === reason); }
  finally { await shell.dispose(); }
});
