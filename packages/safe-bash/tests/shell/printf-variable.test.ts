import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { browserCommands, MemoryFileSystem as BrowserMemoryFileSystem, Shell as BrowserShell } from "../../src/browser.js";
import { basicCommands } from "../../src/commands/basic.js";
import { standardCommands } from "../../src/commands/index.js";
import { createCommandArguments } from "../../src/contracts/command.js";
import { shellValueFromBytes } from "../../src/contracts/value.js";
import { Runtime } from "../../src/shell/runtime.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { ValueArena, ValueStore } from "../../src/shell/value-state.js";
import { setup } from "./helpers.js";

function fixture(options: Parameters<typeof setup>[0] = {}) {
  const result = setup(options);
  for (const command of basicCommands()) result.commands.register(command);
  return result;
}

const cases = [
  ["scalar and empty assignment", 'value=old; printf -v value "%s:%03d" hi 7; printf "<%s>" "$value"; printf -v value ""; printf "<%s>" "$value"'],
  ["dynamic locals", 'value=global; inner() { printf -v value %s changed; }; outer() { local value=local; inner; printf "<%s>" "$value"; }; outer; printf "<%s>" "$value"'],
  ["readonly refusal", 'readonly value=old; printf -v value %s new; printf "<%s:%s>" "$?" "$value"'],
  ["temporary prefix publication", 'value=old; value=temp printf -v value %s new; printf "<%s>" "$value"'],
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

for (const [name, script] of cases) {
  test(`printf -v: ${name}`, async () => {
    const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", script], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000 });
    assert.ifError(oracle.error);
    assert.equal(oracle.signal, null);
    const { shell } = fixture();
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, oracle.status, result.stderr);
      assert.deepEqual(result.stdoutBytes, new Uint8Array(oracle.stdout), result.stderr);
      assert.equal(result.stderr.length > 0, oracle.stderr.length > 0);
    } finally { await shell.dispose(); }
  });
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
    assert.equal(result.exitCode, 2);
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

for (const target of ["value[-1]", "value[1+1]", "value[01]", "value[index]", "value[$(printf bad)]", "value[2147483648]", "value[]", "value[1]tail", 'value["2"]']) {
  test(`printf -v refuses unsupported lvalue without evaluating it: ${target}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec(`value=old; printf -v '${target}' %s new; printf '<%s:%s>' "$?" "$value"`);
      assert.equal(result.stdout, "<2:old>");
      assert.notEqual(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

for (const target of ["value", "value[1]"]) {
  test(`printf -v refuses non-UTF-8 indexed publication: ${target}`, async () => {
    const { shell } = fixture();
    try {
      const result = await shell.exec(`value=(old tail); printf -v '${target}' '\\377'; printf '<%s:%s:%s>' "$?" "\${value[0]}" "\${value[1]}"`);
      assert.equal(result.stdout, "<1:old:tail>");
      assert.match(result.stderr, /non-UTF-8/u);
    } finally { await shell.dispose(); }
  });
}

test("printf -v refuses lossy promotion of an existing byte scalar", async () => {
  const { shell } = fixture();
  try {
    const result = await shell.exec('value=$(printf "\\377"); printf -v "value[1]" %s new; printf "%s:" "$?"; printf "%s" "$value"');
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(49, 58, 255));
    assert.match(result.stderr, /non-UTF-8/u);
  } finally { await shell.dispose(); }
});

for (const [name, script, expected] of [
  ["bare indexed binding", 'value=(old tail); printf -v value "\\377"; printf "<%s:%s:%s>" "$?" "${value[0]}" "${value[1]}"', new TextEncoder().encode("<1:old:tail>")],
  ["indexed lvalue", 'value=(old tail); printf -v "value[1]" "\\377"; printf "<%s:%s:%s>" "$?" "${value[0]}" "${value[1]}"', new TextEncoder().encode("<1:old:tail>")],
  ["byte scalar promotion", 'printf -v value "\\377"; printf -v "value[1]" %s new; printf "%s:" "$?"; printf "%s" "$value"', Uint8Array.of(49, 58, 255)],
] as const) {
  test(`printf -v browser decoder TypeError has no Node code: ${name}`, async context => {
    const decode = TextDecoder.prototype.decode;
    let failures = 0;
    context.mock.method(TextDecoder.prototype, "decode", function (this: InstanceType<typeof TextDecoder>, ...args: Parameters<typeof decode>) {
      try { return decode.apply(this, args); }
      catch (error) {
        if (!this.fatal || !(error instanceof TypeError)) throw error;
        failures++;
        const platformError = new TypeError("The encoded data was not valid UTF-8");
        assert.equal("code" in platformError, false);
        throw platformError;
      }
    });
    const shell = new BrowserShell({ fs: new BrowserMemoryFileSystem() }).use(browserCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdoutBytes, expected);
      assert.equal(result.stderr, "printf: indexed variables do not support non-UTF-8 bytes\n");
      assert.equal(failures, 1);
      const valid = await shell.exec('printf -v "value[1]" "\\357\\273\\277é"; printf "%s" "${value[1]}"');
      assert.equal(valid.exitCode, 0, valid.stderr);
      assert.equal(valid.stderr, "");
      assert.deepEqual(valid.stdoutBytes, Uint8Array.of(239, 187, 191, 195, 169));
    } finally { await shell.dispose(); }
  });
}

test("printf -v browser decoding does not relabel a storage TypeError", async context => {
  const decode = TextDecoder.prototype.decode;
  let failStorage = false;
  context.mock.method(TextDecoder.prototype, "decode", function (this: InstanceType<typeof TextDecoder>, ...args: Parameters<typeof decode>) {
    const result = decode.apply(this, args);
    if (this.fatal) failStorage = true;
    return result;
  });
  const get = ValueStore.prototype.get;
  let failures = 0;
  context.mock.method(ValueStore.prototype, "get", function (this: ValueStore, ...args: Parameters<ValueStore["get"]>) {
    if (failStorage) {
      failStorage = false;
      failures++;
      throw new TypeError("storage read failed");
    }
    return get.apply(this, args);
  });
  const shell = new BrowserShell({ fs: new BrowserMemoryFileSystem() }).use(browserCommands());
  try {
    const result = await shell.exec('value=old; printf -v "value[1]" %s new; printf "<%s:%s>" "$?" "$value"');
    assert.equal(result.stdout, "<1:old>");
    assert.match(result.stderr, /storage read failed/u);
    assert.doesNotMatch(result.stderr, /non-UTF-8/u);
    assert.equal(failures, 1);
  } finally { await shell.dispose(); }
});

for (const reason of [false, 0, null, ""]) test(`printf -v browser decoder cancellation wins: ${String(reason)}`, async context => {
  const controller = new AbortController();
  const decode = TextDecoder.prototype.decode;
  context.mock.method(TextDecoder.prototype, "decode", function (this: InstanceType<typeof TextDecoder>, ...args: Parameters<typeof decode>) {
    if (this.fatal) {
      controller.abort(reason);
      throw new TypeError("The encoded data was not valid UTF-8");
    }
    return decode.apply(this, args);
  });
  const writes = context.mock.method(Runtime.prototype, "arrayAssignment");
  const shell = new BrowserShell({ fs: new BrowserMemoryFileSystem() }).use(browserCommands());
  try {
    await assert.rejects(shell.exec('printf -v "value[1]" "\\377"', { signal: controller.signal }), error => error === reason);
    assert.equal(writes.mock.callCount(), 0);
  } finally { await shell.dispose(); }
});

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
    const writes = context.mock.method(Runtime.prototype, "writeVariable");
    try {
      await assert.rejects(shell.exec(`value=old; printf -v value '${format}' x`), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
      assert.equal(writes.mock.calls.filter(call => call.arguments[1] === "value").length, 1);
    } finally { await shell.dispose(); }
  });
}

test("printf -v capture shares the existing value-slot budget", async context => {
  const { shell } = fixture({ limits: { maxExpansionFields: 8 } });
  const writes = context.mock.method(Runtime.prototype, "writeVariable");
  try {
    await assert.rejects(shell.exec('value=old; printf -v value "a%%b%%c%%d%%e%%f"'), error => error instanceof ShellLimitError && error.limit === "maxExpansionFields");
    assert.equal(writes.mock.calls.filter(call => call.arguments[1] === "value").length, 1);
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
  const writes = context.mock.method(Runtime.prototype, "writeVariable");
  const { shell } = fixture();
  try {
    await assert.rejects(shell.exec('value=old; printf -v value "%s%d" partial invalid', {
      signal: controller.signal,
      stderr: { write: async () => { controller.abort(reason); } },
    }), error => error === reason);
    assert.equal(writes.mock.calls.filter(call => call.arguments[1] === "value").length, 1);
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
