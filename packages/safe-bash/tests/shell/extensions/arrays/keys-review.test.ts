import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { commandRuntimeIdentity } from "../../../../src/contracts/command.js";
import { readBytes } from "../../../../src/contracts/io.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { authenticateOracle, nativeOptions, runNative } from "../trap/oracle.js";

function setup(extensions: readonly ShellExtension[] = [arraysExtension()]) {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" }, extensions });
  for (const command of basicCommands()) shell.register(command);
  shell.register({ name: "emit", async execute(context) {
    for await (const chunk of readBytes(context.stdin, context.signal)) await context.stdout.write(chunk);
    return { exitCode: 0 };
  } });
  return shell;
}

const valid: ShellExtension = { name: "review", create: () => ({ builtins: [] }) };
const invalidDefinitions = [
  { label: "empty name", definitions: [{ ...valid, name: "" }], message: "Invalid or duplicate shell extension" },
  { label: "invalid create", definitions: [{ ...valid, create: 42 }], message: "Invalid or duplicate shell extension" },
  { label: "foreign identity", definitions: [{ ...valid, runtimeIdentity: {} }], message: "Shell extension requires its matching shell runtime; do not mix source and compiled runtime modules" },
  { label: "duplicate name", definitions: [valid, valid], message: "Invalid or duplicate shell extension" },
];

for (const fixture of invalidDefinitions) {
  test(`array keys review: malformed default source precedes ${fixture.label}`, async context => {
    const shell = setup(fixture.definitions as readonly ShellExtension[]);
    context.after(() => shell.dispose());
    const result = await shell.exec("'unterminated");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdoutBytes.length, 0);
    assert.equal(result.stderr, "shell: -c: line 1: unexpected EOF while looking for matching `''\n");
  });

  test(`array keys review: valid source still rejects ${fixture.label}`, async context => {
    const shell = setup(fixture.definitions as readonly ShellExtension[]);
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(":"), { name: "TypeError", message: fixture.message });
  });
}

const show = `show() { printf '%s:' "$#"; printf '<%s>' "$@"; printf '\\n'; }; `;
const emit = `emit() { local line; while IFS= read -r line; do printf '%s\\n' "$line"; done; }; `;
const differentialCases = [
  { label: "two empty quoted splices retain only surrounding fields", source: `a=(); b=(); show "\${!a[@]}" "\${!b[@]}"; show pre"\${!a[@]}""\${!b[@]}"post; show "\${!a[@]}"'' """\${!b[@]}"` },
  { label: "empty splices between populated key fields", source: `a=(); b=([2]=x [10]=y); show pre"\${!a[@]}\${!b[@]}\${!a[@]}"post; show "\${!b[@]}\${!a[@]}\${!b[@]}"` },
  { label: "local unset and nested local restoration", source: `a=([9]=outer); inner() { local -a a=deep; show "\${!a[@]}"; }; outer() { local -a a=local; unset a; show "\${!a[@]}"; inner; show "\${!a[@]}"; }; outer; show "\${!a[@]}"` },
  { label: "command substitution unset and recreate do not change parent", source: `a=([2]=x [10]=y); result=$(unset a; a=([3]=child); show "\${!a[@]}"); printf '%s\\n' "$result"; show "\${!a[@]}"` },
  { label: "local readonly enumeration retains outer identity", source: `a=([9]=outer); inner() { local -a a=inner; readonly a; show "\${!a[@]}"; }; inner; a[2]=after; show "\${!a[@]}"` },
  { label: "raw IFS differs from replacement UTF8 in a retained key join", source: `a=([2]=x [10]=y); IFS=$'\\xff'; raw="\${!a[*]}"; IFS=$'\\xef\\xbf\\xbd'; replacement="\${!a[*]}"; printf '<%s><%s>' "$raw" "$replacement"` },
  { label: "key at heredoc ignores raw IFS and preserves literal quotes", source: `a=([2]=x [10]=y); IFS=$'\\xff'; emit <<DOC\npre\${!a[@]}post\n"\${!a[@]}"\n\${!a[@]}\${!a[*]}\nDOC` },
  { label: "key star heredoc ignores replacement UTF8 IFS", source: `a=([2]=x [10]=y); IFS=$'\\xef\\xbf\\xbd'; emit <<DOC\npre\${!a[*]}post\nDOC` },
  { label: "empty key heredoc fields retain literal surrounding bytes", source: `a=(); IFS=$'\\xff'; emit <<DOC\npre\${!a[@]}post\n"\${!a[*]}"\nDOC` },
  { label: "mixed key heredoc retains raw scalar bytes", source: `a=([2]=x [10]=y); raw=$'\\xff'; emit <<DOC\n\${raw}\${!a[*]}\${raw}\nDOC` },
  { label: "mixed key heredoc retains raw member IFS bytes", source: `a=([2]=x [10]=y); IFS=$'\\xff'; emit <<DOC\n\${a[*]}:\${!a[*]}\nDOC` },
  { label: "raw scalar heredoc baseline without key syntax", source: `raw=$'\\xff'; emit <<DOC\n\${raw}\nDOC`, defaults: true },
];

for (const fixture of differentialCases) {
  test(`array keys review native: ${fixture.label}`, nativeOptions(), async context => {
    assert.equal(process.env.SAFE_BASH_TEST_BASH_SHA256, "f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d");
    const shell = setup(fixture.defaults ? [] : [arraysExtension()]);
    context.after(() => shell.dispose());
    try {
      const native = runNative(show + emit + fixture.source);
      assert.equal(native.status, 0, native.stderr.toString());
      assert.deepEqual(native.stderr, Buffer.alloc(0));
      const actual = await shell.exec(show + fixture.source);
      assert.equal(actual.exitCode, native.status, actual.stderr);
      assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
      assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout, fixture.source);
    } finally { authenticateOracle(); }
  });
}

test("array keys review: metadata capture preserves receiver across COW forks and deduplicates capability", async context => {
  const reads = { name: 0, create: 0, identity: 0, syntax: 0 };
  let creations = 0;
  const syntax = { arrayKeys: true as const };
  const extension: ShellExtension = {
    get name() { assert.equal(this, extension); reads.name++; return "captured"; },
    get runtimeIdentity() { assert.equal(this, extension); reads.identity++; return commandRuntimeIdentity; },
    get syntax() { assert.equal(this, extension); reads.syntax++; return syntax; },
    get create() {
      assert.equal(this, extension); reads.create++;
      return function(this: ShellExtension) {
        assert.equal(this, extension);
        creations++;
        Object.defineProperty(syntax, "arrayKeys", { value: false });
        return { builtins: [] };
      };
    },
  };
  const shell = setup([extension, { name: "same-capability", syntax, create: () => ({ builtins: [] }) }]);
  context.after(() => shell.dispose());
  const result = await shell.exec('a=([9]=x); printf "%s" "$(printf "%s" "${!a[*]}")"; (printf "%s" "${!a[*]}"); printf "%s" "${!a[*]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "999");
  assert.deepEqual(reads, { name: 1, create: 1, identity: 1, syntax: 1 });
  assert.ok(creations >= 2);
});

const seed: ShellExtension = { name: "review-seed", create: () => ({ builtins: [{ name: "seed", async execute(context) {
  const writer = await context.bindings.openIndexed("a", { clear: true });
  try {
    for (const index of [4294967295, 0, 2147483648]) await writer.set(index, shellValueFromBytes(Uint8Array.of(255)));
  } finally { await writer.close(); }
  for (const index of [0, 2147483648, 4294967295]) assert.deepEqual(shellValueBytes(context.bindings.get("a", index)!), Uint8Array.of(255));
  return 0;
} }] }) };

test("array keys review: uint32 key enumeration and raw members round-trip in substitution", async context => {
  const shell = setup([arraysExtension(), seed]);
  context.after(() => shell.dispose());
  const result = await shell.exec('seed; IFS=$\'\\xff\'; keys="$(printf "%s" "${!a[*]}")"; printf "%s:" "$keys"; printf "%s" "${a[4294967295]}" "${a[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat([Buffer.from("0\xff2147483648\xff4294967295:", "latin1"), Buffer.alloc(4, 255)]));
});

for (const limit of ["maxExpansionFields", "maxExpansionBytes"] as const) {
  test(`array keys review: repeated sparse expansion obeys ${limit}`, async context => {
    const shell = setup([arraysExtension(), seed]);
    context.after(() => shell.dispose());
    let seeded = false;
    shell.register({ name: "mark", execute() { seeded = true; return { exitCode: 0 }; } });
    const repeated = Array.from({ length: 128 }, () => '"${!a[@]}"').join(" ");
    const execution = shell.exec(`seed; mark; printf '%s' ${repeated}`, { limits: { [limit]: limit === "maxExpansionFields" ? 128 : 1024 } });
    if (limit === "maxExpansionFields") {
      const result = await execution;
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdoutBytes.length, 0);
      assert.equal(result.stderr, "shell: line 1: indexed array: private metadata limit exceeded\n");
    } else {
      await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === limit);
    }
    assert.equal(seeded, true);
    const next = await shell.exec('a=([2]=x); printf "%s" "${!a[*]}"');
    assert.equal(next.exitCode, 0, next.stderr);
    assert.equal(next.stdout, "2");
  });
}
