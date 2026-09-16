import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { commandRuntimeIdentity } from "../../../../src/contracts/command.js";
import { readBytes } from "../../../../src/contracts/io.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { captureShellSyntax, parseShell } from "../../../../src/shell/parser.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

function setup(extensions: readonly ShellExtension[] = [arraysExtension()]) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" }, extensions });
  for (const command of basicCommands()) shell.register(command);
  shell.register({ name: "emit", async execute(context) {
    for await (const chunk of readBytes(context.stdin, context.signal)) await context.stdout.write(chunk);
    return { exitCode: 0 };
  } });
  return { fs, shell };
}

const show = `show() { printf '%s:' "$#"; printf '<%s>' "$@"; printf '\\n'; }; `;
const expansion = `show "\${!a[@]}"; show "\${!a[*]}"; show \${!a[@]}; show \${!a[*]}`;
const profiles = [
  { name: "unset", source: "unset a", keys: [] },
  { name: "empty scalar", source: "a=''", keys: ["0"] },
  { name: "raw scalar", source: "a=$'\\xff'", keys: ["0"] },
  { name: "empty indexed", source: "a=()", keys: [] },
  { name: "sparse numeric order", source: "a=([20]=x [0]=y [10]=z)", keys: ["0", "10", "20"] },
  { name: "no zero cell", source: "a=([20]=x [10]=y)", keys: ["10", "20"] },
] as const;
const separators = [
  { name: "default", source: "unset IFS", value: " " },
  { name: "colon", source: "IFS=:", value: ":" },
  { name: "empty", source: "IFS=''", value: "" },
  { name: "numeric", source: "IFS=0", value: "0" },
  { name: "raw FF", source: "IFS=$'\\xff'", value: "\xff" },
  { name: "genuine replacement UTF8 in C", source: "IFS=$'\\xef\\xbf\\xbd'", value: "\xef" },
] as const;

for (const profile of profiles) for (const separator of separators) {
  const keys: readonly string[] = profile.keys;
  const unquoted = separator.value === "0" && keys.length ? keys.join("0").split("0").slice(0, -1) : keys;
  const rows = [keys, [keys.join(separator.value)], unquoted, separator.value === "" && keys.length ? [keys.join(" ")] : unquoted];
  const expected = Buffer.from(rows.map(row => `${row.length}:${row.length ? row.map(value => `<${value}>`).join("") : "<>"}\n`).join(""), "latin1");
  const source = `${show}${profile.source}; ${separator.source}; ${expansion}`;
  test(`array keys ${profile.name}, ${separator.name}`, async context => {
    const subject = setup(); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected);
    assert.equal(result.stderr, "");
  });
  test(`pinned Bash array keys ${profile.name}, ${separator.name}`, nativeOptions(), () => {
    const result = runNative(source);
    assert.equal(result.status, 0);
    assert.deepEqual(result.stdout, expected);
    assert.deepEqual(result.stderr, Buffer.alloc(0));
  });
}

for (const separator of ["@", "*"]) test(`default shell accepts array keys: ${separator}`, async context => {
  const subject = setup([]); context.after(() => subject.shell.dispose());
  const source = `a=([2]=x [10]=y); printf '<%s>' "\${!a[${separator}]}"`;
  assert.doesNotThrow(() => parseShell(source));
  const result = await subject.shell.exec(source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, separator === "@" ? "<2><10>" : "<2 10>");
});

for (const source of ["true &", "printf $!"]) test(`default shell syntax remains disabled: ${source}`, async context => {
  const subject = setup([]); context.after(() => subject.shell.dispose());
  assert.throws(() => parseShell(source));
  const result = await subject.shell.exec(source);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
});

const quote = (source: string): string => `'${source.split("'").join("'\\''")}'`;
const body = `a=([10]=x [2]=y); printf '%s' "\${!a[*]}"`;
for (const route of ["exec", "eval", "extension evaluate", "function", "source", "bash -c", "sh file", "executable", "substitution", "backtick", "heredoc", "stream", "pipeline stream"]) {
  test(`captured key syntax reaches ${route}`, async context => {
    const extensions: ShellExtension[] = [arraysExtension(), { name: "evaluate", create: () => ({ builtins: [{ name: "evaluate", execute: invocation => invocation.evaluate(invocation.argumentValues[0]!) }] }) }];
    const subject = setup(extensions); context.after(() => subject.shell.dispose());
    await subject.fs.writeFile("/script", Buffer.from(`#!/bin/bash\n${body}`));
    await subject.fs.chmod("/script", 0o755);
    const source = route === "exec" ? body : route === "eval" ? `eval ${quote(body)}` : route === "extension evaluate" ? `evaluate ${quote(body)}`
      : route === "function" ? `fn() { ${body}; }; fn` : route === "source" ? ". /script" : route === "bash -c" ? `bash -c ${quote(body)}`
      : route === "sh file" ? "sh /script" : route === "executable" ? "/script" : route === "substitution" ? `printf '%s' "$(${body})"`
      : route === "backtick" ? `printf '%s' "\`${body}\`"` : route === "heredoc" ? `a=([10]=x [2]=y); emit <<DOC\n\${!a[*]}\nDOC`
      : route === "pipeline stream" ? `printf '%s' ${quote(body)} | bash` : "bash";
    const result = await subject.shell.exec(source, route === "stream" ? { stdin: `${body}\n` } : {});
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, route === "heredoc" ? "2 10\n" : "2 10");
    assert.equal(result.stderr, "");
  });
}

const writer: ShellExtension = { name: "seed", create: () => ({ builtins: [{ name: "seed", async execute(context) {
  const target = await context.bindings.openIndexed("a", { clear: true });
  try { for (const index of [4294967295, 10, 2147483648, 0]) await target.set(index, "value"); }
  finally { await target.close(); }
  return 0;
} }] }) };

for (const suffix of ["", "; readonly a", "; unset 'a[10]'"]) test(`writer-created uint32 keys roundtrip${suffix}`, async context => {
  const subject = setup([arraysExtension(), writer]); context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(`seed${suffix}; printf '<%s>' "\${!a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, suffix.includes("unset") ? "<0><2147483648><4294967295>" : "<0><10><2147483648><4294967295>");
  assert.equal(result.stderr, "");
});

test("pinned Bash uint32 key ordering", nativeOptions(), () => {
  const result = runNative("a[4294967295]=value; a[10]=value; a[2147483648]=value; a[0]=value; printf '<%s>' \"${!a[@]}\"");
  assert.equal(result.status, 0);
  assert.deepEqual(result.stdout, Buffer.from("<0><10><2147483648><4294967295>"));
  assert.deepEqual(result.stderr, Buffer.alloc(0));
});

test("array key metadata is captured before parsing and factory mutation cannot change forks", async context => {
  const syntax = { arrayKeys: true };
  let reads = 0, creates = 0;
  const extension = { name: "captured", get syntax() { reads++; return syntax; }, create() { creates++; syntax.arrayKeys = false; return { builtins: [] }; } } as unknown as ShellExtension;
  const subject = setup([extension]); context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(`a=(x y); printf '%s|' "\${!a[*]}"; eval 'printf "%s|" "\${!a[*]}"'; (printf '%s' "\${!a[*]}")`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0 1|0 1|0 1");
  assert.equal(reads, 1);
  assert.equal(creates, 2);
});

test("initial syntax failure does not create extension instances", async context => {
  let created = 0;
  const subject = setup([{ ...arraysExtension(), create() { created++; throw new Error("must not create"); } }]);
  context.after(() => subject.shell.dispose());
  assert.equal((await subject.shell.exec("'unterminated")).exitCode, 2);
  assert.equal(created, 0);
});

for (const syntax of [{ arrayKeys: false }, { arrayKeys: "true" }, { arrayKeys: true, unknown: true }]) {
  test(`invalid or unsupported runtime key syntax metadata: ${JSON.stringify(syntax)}`, async context => {
    let created = 0;
    const subject = setup([{ name: "invalid", syntax, create() { created++; return { builtins: [] }; } } as unknown as ShellExtension]);
    context.after(() => subject.shell.dispose());
    await assert.rejects(subject.shell.exec(":"), TypeError);
    assert.equal(created, 0);
  });
}

for (const syntax of [{ listTerminators: [{ operator: "&" }] }, { specialParameters: [{ name: "!" }] }]) {
  test(`valid runtime syntax without instance handlers fails before execution: ${JSON.stringify(syntax)}`, async context => {
    let created = 0, executed = 0;
    const subject = setup([{ name: "missing-handlers", syntax, create() { created++; return { builtins: [] }; } } as unknown as ShellExtension]);
    subject.shell.use(async (_context, next) => { executed++; return next(); });
    context.after(() => subject.shell.dispose());
    await assert.rejects(subject.shell.exec(":"), TypeError);
    assert.equal(created, 1);
    assert.equal(executed, 0);
  });
}

test("identical key capabilities union across distinct extensions; accessors remain rejected", async context => {
  let created = 0, getters = 0;
  const first = { ...arraysExtension(), create() { created++; return { builtins: [] }; } };
  const subject = setup([first, { ...arraysExtension(), name: "other" }]);
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec('a=(x y); printf "%s" "${!a[*]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0 1");
  assert.equal(created, 1);
  assert.throws(() => captureShellSyntax({ get arrayKeys() { getters++; return true; } } as never), TypeError);
  assert.equal(getters, 0);
});

test("optional arrays factory is identity-tagged and declarative", () => {
  const extension = arraysExtension();
  assert.equal(extension.runtimeIdentity, commandRuntimeIdentity);
  assert.deepEqual(extension.syntax, { arrayKeys: true, indexedElementOperators: true, indexedDeclarations: ["readonly"] });
  assert.deepEqual(extension.create(), { builtins: [] });
});

test("key expansion shares the output budget", async context => {
  const subject = setup([arraysExtension(), writer]); context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec(`seed; printf '%s' "\${!a[*]}"`, { limits: { maxOutputBytes: 3 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

for (const reason of [false, 0, "", null]) test(`key expansion preserves falsey root cancellation ${String(reason)}`, async context => {
  const controller = new AbortController();
  const subject = setup([arraysExtension(), writer]); context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec(`seed; printf '%s' "\${!a[*]}"`, { signal: controller.signal, stdout: { async write() { controller.abort(reason); } } }), error => Object.is(error, reason));
});

for (const separator of [separators[0], separators[1], separators[2], separators[4]]) {
  for (const expression of ['${!a[@]}', '"${!a[@]}"', '${!a[*]}', '"${!a[*]}"']) {
    const join = expression === '${!a[@]}' || expression === '"${!a[@]}"' && separator.value === "" ? " " : separator.value;
    const expected = Buffer.from(`2${join}10`, "latin1");
    for (const route of ["assignment", "here-string"]) {
      const prefix = `a=([2]=x [10]=y); ${separator.source}; `;
      const source = prefix + (route === "assignment" ? `value=${expression}; printf '%s' "$value"` : `emit <<<${expression}`);
      const output = route === "assignment" ? expected : Buffer.concat([expected, Buffer.from("\n")]);
      test(`scalar key ${route}: ${expression}, ${separator.name}`, async context => {
        const subject = setup(); context.after(() => subject.shell.dispose());
        const result = await subject.shell.exec(source);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(Buffer.from(result.stdoutBytes), output);
        assert.equal(result.stderr, "");
      });
      test(`pinned Bash scalar key ${route}: ${expression}, ${separator.name}`, nativeOptions(), () => {
        const native = runNative(route === "assignment" ? source : `emit() { local value; IFS= read -r value; printf '%s\n' "$value"; }; ${source}`);
        assert.equal(native.status, 0);
        assert.deepEqual(native.stdout, output);
        assert.deepEqual(native.stderr, Buffer.alloc(0));
      });
    }
  }
}

const boundaries = [
  ["word prefix and suffix", 'a=([2]=x [10]=y); printf "<%s>" pre"${!a[@]}"post', "<pre2><10post>"],
  ["empty splice", 'unset a; printf "<%s>" pre"${!a[@]}"post', "<prepost>"],
  ["adjacent splices", 'a=([2]=x [10]=y); printf "<%s>" "${!a[@]}${!a[@]}"', "<2><102><10>"],
  ["nounset", 'set -u; unset a; printf "<%s>" "${!a[@]}" "${!a[*]}"; printf done', "<>done"],
  ["local restoration", 'a=([9]=outer); f() { local -a a=inner; printf "<%s>" "${!a[@]}"; }; f; printf "<%s>" "${!a[@]}"', "<0><9>"],
  ["compound splice", 'a=([2]=x [10]=y); b=("${!a[@]}"); printf "<%s>" "${b[@]}"', "<2><10>"],
  ["split boundary suffix", 'a=([2]=x [10]=y); IFS=0; printf "<%s>" pre${!a[@]}post', "<pre2><1><post>"],
  ["substitution join", 'a=([2]=x [10]=y); IFS=:; value=$(printf "%s" "${!a[*]}"); printf "%s" "$value"', "2:10"],
  ["parent binding isolation", 'a=([9]=outer); (a[2]=child; printf "<%s>" "${!a[@]}"); printf "<%s>" "${!a[@]}"', "<2><9><9>"],
  ["quoted heredoc", "a=(x); emit <<'DOC'\n${!a[@]}\nDOC", "${!a[@]}\n"],
] as const;

for (const [name, source, expected] of boundaries) {
  test(`key boundary: ${name}`, async context => {
    const subject = setup(); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(source);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  });
  test(`pinned Bash key boundary: ${name}`, nativeOptions(), () => {
    const native = runNative(name === "quoted heredoc" ? `emit() { local value; IFS= read -r value; printf '%s\n' "$value"; }; ${source}` : source);
    assert.equal(native.status, 0);
    assert.deepEqual(native.stdout, Buffer.from(expected));
    assert.deepEqual(native.stderr, Buffer.alloc(0));
  });
}

for (const duplicate of ["name", "builtin"]) test(`key capability union preserves duplicate ${duplicate} rejection`, async context => {
  let executed = 0;
  const extension = { ...arraysExtension(), create: () => ({ builtins: [{ name: "marker", execute() { executed++; return 0; } }] }) };
  const subject = setup([extension, { ...extension, name: duplicate === "name" ? extension.name : "distinct" }]);
  context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec("marker"), TypeError);
  assert.equal(executed, 0);
});

for (const source of ["true &", "printf $!", "printf ${!a}", "printf ${!a[0]}", "printf ${!a[@]:1}", "printf ${!a[@]-x}"]) {
  test(`key capability does not enable other grammar: ${source}`, async context => {
    const subject = setup(); context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(source);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  });
}

test("captured parser capability is frozen and survives caller mutation", () => {
  const declaration = { arrayKeys: true } as { arrayKeys: true | false };
  const syntax = captureShellSyntax(declaration as { arrayKeys: true });
  declaration.arrayKeys = false;
  assert.equal(Object.isFrozen(syntax), true);
  assert.equal(syntax.arrayKeys, true);
  assert.doesNotThrow(() => parseShell('printf "${!a[@]}"', 0, syntax));
  assert.doesNotThrow(() => parseShell('printf "${!a[@]}"'));
  const optional = { specialParameters: [{ name: "!" }] };
  const capturedOptional = captureShellSyntax(optional);
  optional.specialParameters.length = 0;
  assert.equal(Object.isFrozen(capturedOptional.specialParameters), true);
  assert.doesNotThrow(() => parseShell("printf $!", 0, capturedOptional));
  assert.throws(() => parseShell("printf $!"));
});

const rawDocument = "a=([2]=x [10]=y); IFS=$'\\xff'; emit <<DOC\npre${!a[*]}post\nDOC";
test("key here-document joins with spaces even with raw IFS", async context => {
  const subject = setup(); context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(rawDocument);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "70726532203130706f73740a");
  assert.equal(result.stderr, "");
});
test("pinned Bash key here-document joins with spaces even with raw IFS", nativeOptions(), () => {
  const native = runNative(`emit() { local value; IFS= read -r value; printf '%s\n' "$value"; }; ${rawDocument}`);
  assert.equal(native.status, 0);
  assert.equal(native.stdout.toString("hex"), "70726532203130706f73740a");
  assert.deepEqual(native.stderr, Buffer.alloc(0));
});

test("key enumeration observes current bindings without retaining stale cells", async context => {
  const subject = setup([arraysExtension(), writer]); context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec('seed; printf "%s|" "${!a[*]}"; unset a; a=scalar; printf "%s|" "${!a[*]}"; a=(); printf "%s" "${!a[*]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0 10 2147483648 4294967295|0|");
  assert.equal(result.stderr, "");
});

test("key capability does not widen ordinary assignment bounds", async context => {
  const subject = setup(); context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec('a[2147483648]=x');
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /index outside 0\.\.2147483647/u);
});

test("key enumeration cannot bypass shared expansion storage limits", async context => {
  const subject = setup(); context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec('a=([0]=x [10]=y [20]=z); printf "%s" "${!a[@]}"', { limits: { maxExpansionFields: 2 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /indexed array: private Map slot limit exceeded/u);
  const healthy = await subject.shell.exec('a=(x y); printf "%s" "${!a[*]}"');
  assert.equal(healthy.exitCode, 0, healthy.stderr);
  assert.equal(healthy.stdout, "0 1");
});

test("aborted key invocation drains owned cleanup exactly once", async context => {
  const controller = new AbortController();
  const events: string[] = [];
  const lifecycle: ShellExtension = { name: "lifecycle", create: () => ({ builtins: [], start(invocation) {
    invocation.registerCleanup(async () => { events.push("closing"); await Promise.resolve(); events.push("closed"); });
  } }) };
  const subject = setup([arraysExtension(), writer, lifecycle]); context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec('seed; printf "%s" "${!a[*]}"', { signal: controller.signal, stdout: { async write() { controller.abort(false); } } }), error => error === false);
  assert.deepEqual(events, ["closing", "closed"]);
  await subject.shell.dispose();
  assert.deepEqual(events, ["closing", "closed"]);
});

const preservedCells = "a=([2]=$'\\xff' [10]=$'\\xef\\xbf\\xbd'); printf '<%s>' \"${!a[@]}\"; printf '%s' \"${a[@]}\"";
test("key enumeration preserves distinct raw and Unicode cell payloads", async context => {
  const subject = setup(); context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(preservedCells);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "3c323e3c31303effefbfbd");
  assert.equal(result.stderr, "");
});
test("pinned Bash key enumeration preserves distinct raw and Unicode cell payloads", nativeOptions(), () => {
  const native = runNative(preservedCells);
  assert.equal(native.status, 0);
  assert.equal(native.stdout.toString("hex"), "3c323e3c31303effefbfbd");
  assert.deepEqual(native.stderr, Buffer.alloc(0));
});

for (const property of ["name", "create", "runtimeIdentity"]) test(`initial parsing precedes legacy ${property} getter evaluation`, async context => {
  let reads = 0;
  const failure = new Error(`legacy ${property} getter`);
  const definition = { ...arraysExtension() };
  Object.defineProperty(definition, property, { get() { reads++; throw failure; } });
  const subject = setup([definition]); context.after(() => subject.shell.dispose());
  const invalid = await subject.shell.exec("'unterminated");
  assert.equal(invalid.exitCode, 2);
  assert.equal(reads, 0);
  await assert.rejects(subject.shell.exec(":"), error => error === failure);
  assert.equal(reads, 1);
});

test("environment validation still precedes legacy definition capture", async context => {
  let reads = 0;
  const definition = { ...arraysExtension(), get name() { reads++; return "arrays"; } };
  const subject = setup([definition]); context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec(":", { env: { "BAD=NAME": "value" } }), { message: "Invalid environment entry" });
  assert.equal(reads, 0);
});

for (const enabled of [false, true]) test(`raw heredoc bytes survive mixed fragments, opt-in ${enabled}`, async context => {
  const subject = setup(enabled ? [arraysExtension()] : []); context.after(() => subject.shell.dispose());
  const source = "raw=$'\\xff'; replacement=$'\\xef\\xbf\\xbd'; emit <<DOC\nstart${raw}middle${replacement}end\n${raw}\nDOC";
  const result = await subject.shell.exec(source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "7374617274ff6d6964646c65efbfbd656e640aff0a");
  assert.equal(result.stderr, "");
});

const rawSubstitution = "emit <<EOF\n$(rawchunks)\né\nEOF\n";
test("heredoc substitution preserves split UTF8 and invalid bytes while discarding NUL", async context => {
  const subject = setup([]); context.after(() => subject.shell.dispose());
  subject.shell.register({ name: "rawchunks", async execute(invocation) {
    await invocation.stdout.write(Uint8Array.from([0, 255, 195]));
    await invocation.stdout.write(Uint8Array.from([169, 128, 10]));
    return { exitCode: 0 };
  } });
  const result = await subject.shell.exec(rawSubstitution);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ffc3a9800ac3a90a");
});
test("pinned Bash heredoc substitution preserves split UTF8 and invalid bytes while discarding NUL", nativeOptions(), () => {
  const native = runNative(`emit() { local value; while IFS= read -r value; do printf '%s\\n' "$value"; done; }; rawchunks() { printf '\\0\\377\\303'; printf '\\251\\200\\n'; }; ${rawSubstitution}`);
  assert.equal(native.status, 0);
  assert.equal(native.stdout.toString("hex"), "ffc3a9800ac3a90a");
  assert.match(native.stderr.toString(), /ignored null byte/u);
});

for (const reason of [false, 0, "", null]) test(`raw heredoc cleanup retains falsey cancellation ${String(reason)}`, async context => {
  const controller = new AbortController();
  let cleanups = 0;
  const lifecycle: ShellExtension = { name: "lifecycle", create: () => ({ builtins: [], start(invocation) {
    invocation.registerCleanup(async () => { await Promise.resolve(); cleanups++; });
  } }) };
  const subject = setup([arraysExtension(), lifecycle]); context.after(() => subject.shell.dispose());
  const source = "a=(x); raw=$'\\xff'; emit <<DOC\n${raw}${!a[*]}\nDOC";
  await assert.rejects(subject.shell.exec(source, { signal: controller.signal, stdout: { async write() { controller.abort(reason); } } }), error => Object.is(error, reason));
  assert.equal(cleanups, 1);
});

test("raw heredoc construction keeps the shared output budget and permits later execution", async context => {
  const subject = setup(); context.after(() => subject.shell.dispose());
  const source = "a=(x); raw=$'\\xff'; emit <<DOC\n${raw}${!a[*]}\nDOC";
  await assert.rejects(subject.shell.exec(source, { limits: { maxOutputBytes: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  const result = await subject.shell.exec(source);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "ff300a");
});
