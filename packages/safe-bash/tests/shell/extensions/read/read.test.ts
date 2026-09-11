import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { readCases, readErrors, readUsage } from "./cases.js";

function setup(transform?: (context: ShellExtensionContext) => ShellExtensionContext) {
  const fs = createMemoryFileSystem();
  const definition = readExtension();
  const failures: unknown[] = [];
  const shell = new Shell({ fs, onInternalError: reason => { failures.push(reason); }, extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, name: "read_probe", execute: (context: ShellExtensionContext) => builtin.execute(transform?.(context) ?? context) })) };
  } }] });
  for (const command of basicCommands()) shell.register(command);
  return { shell, fs, failures };
}

for (const entry of readCases) test(`read leaf: ${entry.name}`, async context => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from(entry.input));
  const actual = await shell.exec(`{ ${"before" in entry ? entry.before : ""} read_probe ${entry.args}; printf '%s:' "$?"; ${entry.after}; } </input`, { env: { LC_ALL: "C" } });
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout, entry.output);
  assert.equal(actual.stderr, "diagnostic" in entry ? `shell: line 1: ${entry.diagnostic}\n` : "");
});

for (const entry of readErrors) test(`read leaf diagnostic: ${entry.args}`, async context => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from("one\n"));
  const actual = await shell.exec(`read_probe ${entry.args} </input`, { env: { LC_ALL: "C" } });
  assert.equal(actual.exitCode, entry.status);
  assert.equal(actual.stdout, "");
  assert.equal(actual.stderr, `shell: line 1: ${entry.diagnostic}\n${"usage" in entry ? readUsage : ""}`);
});

test("read leaf descriptor alias shares cursor through a VFS script", async context => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from("one\ntwo\n"));
  await fs.writeFile("/script", Buffer.from(`{ read_probe -u3 first; read -r second <&4; printf '<%s><%s>' "$first" "$second"; } 3</input 4<&3`));
  const actual = await shell.exec("source /script");
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout, "<one><two>");
  assert.equal(actual.stderr, "");
});

test("read replacement is explicit and disabling it preserves collision rejection", async context => {
  const definition = readExtension();
  assert.equal(definition.create().builtins[0]!.replace, true);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ ...definition, create: () => ({ builtins: definition.create().builtins.map(builtin => ({ ...builtin, replace: false })) }) }] });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("read -a values"), /Extension builtin conflicts with existing builtin: read/u);
});

for (const args of ["-t0 value", "-t .01 -a values", "-t+1 value", "-t. value", "-t-0 value", "-t '' value", "-t+ value", "-t-0.0000001 value", "-t1.000000extra value", "-p prompt value", "-s value", "-e value"]) {
  test(`unavailable input capability refuses before consuming or clearing: ${args}`, async context => {
    const { shell, failures } = setup();
    context.after(() => shell.dispose());
    const actual = await shell.exec(`values=(old keep); read_probe ${args}; printf '%s:' "$?"; read -r tail; printf '<%s><%s>' "\${values[*]}" "$tail"`, { stdin: { async *[Symbol.asyncIterator]() { yield Buffer.from("first\nsecond\n"); } } });
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stdout, "1:<old keep><first>");
    if (args.startsWith("-p") || args.startsWith("-s") || args.startsWith("-e")) assert.match(actual.stderr, /terminal input capabilities unavailable/u);
    else if (["-t .01 -a values", "-t+1 value", "-t1.000000extra value"].includes(args)) {
      assert.equal(actual.stderr, "shell: line 1: internal error\n");
      assert.equal(failures.length, 1);
      assert.ok(failures[0] instanceof TypeError);
      assert.equal(failures[0].message, "Read timeout requires explicit input provenance");
    } else {
      assert.match(actual.stderr, /input readiness is unknown/u);
      assert.deepEqual(failures, []);
    }
  });
}

test("exported indexed promotion uses the generic admitted writer", async context => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Buffer.from("first second\ntail\n"));
  const actual = await shell.exec(`{ export values=old; read_probe -a values; printf '%s:' "$?"; read -r tail; printf '<%s><%s>' "$values" "$tail"; } </input`);
  assert.equal(actual.stdout, "0:<first><tail>");
  assert.equal(actual.stderr, "");
});

test("raw invalid UTF-8 array values retain distinct bytes", async context => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Uint8Array.of(255, 32, 254, 10));
  const actual = await shell.exec(`read_probe -ra values </input; printf '%s' "\${values[@]}"`);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.stdoutBytes, Uint8Array.of(255, 254));
  assert.equal(actual.stderr, "");
});

test("raw byte-valued IFS splits without reconstructing display strings", async context => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Uint8Array.of(254, 255, 253, 10));
  const actual = await shell.exec(`IFS=$'\\xff'; read_probe -ra values </input; printf '<%s>' "\${values[@]}"`);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.deepEqual(actual.stdoutBytes, Uint8Array.of(60, 254, 62, 60, 253, 62));
  assert.equal(actual.stderr, "");
});

test("raw attached delimiter is its original byte, not display text", async context => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  await fs.writeFile("/input", Uint8Array.of(97, 255, 98, 10));
  const actual = await shell.exec(`read_probe -rd$'\\xff' value </input; printf '%s' "$value"`);
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdout, "a");
  assert.equal(actual.stderr, "");
});

test("lookalike provider errors cannot masquerade as an already diagnosed status", async context => {
  const original = { readStatus: 1 };
  const events: string[] = [];
  let observed: unknown;
  const builtin = readExtension().create().builtins[0]!;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "read-failure-probe", create: () => ({ builtins: [{ name: "probe", async execute(command) {
    try { await builtin.execute({ ...command, argumentValues: ["-u3", "value"], input: {
      observe() { throw new Error("Unexpected descriptor observation"); },
      validateOpen(descriptor) { assert.equal(descriptor, 3); events.push("validate:3"); },
      borrow(descriptor) { assert.equal(descriptor, 3); assert.deepEqual(events, ["validate:3"]); events.push("borrow:3"); throw original; },
    } }); }
    catch (error) { observed = error; }
    return 0;
  } }] }) }] });
  context.after(() => shell.dispose());
  await shell.exec("probe");
  assert.equal(observed, original);
  assert.deepEqual(events, ["validate:3", "borrow:3"]);
});

test("shared borrow does not guess unknown external stream provenance", async context => {
  let observed = false;
  const { shell } = setup(command => {
    const input = command.input;
    return { ...command, input: { ...input, borrow(descriptor) {
      const lease = input.borrow(descriptor);
      assert.equal(lease.readiness(), "unknown");
      observed = true;
      return lease;
    } } };
  });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("read_probe value", { stdin: { async *[Symbol.asyncIterator]() { yield Buffer.from("one\n"); } } })).exitCode, 0);
  assert.equal(observed, true);
});

for (const delta of [0, -1]) test(`raw read diagnostic uses the shared exact output budget delta=${delta}`, async context => {
  const expected = Buffer.concat([Buffer.from("shell: line 1: read: "), Buffer.from([255]), Buffer.from(": invalid timeout specification\n")]);
  const writes: Uint8Array[] = [];
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [readExtension()], limits: { maxOutputBytes: expected.length + delta } });
  context.after(() => shell.dispose());
  const execution = shell.exec("read -t $'\\xff' value", { stderr: { async write(bytes) { writes.push(bytes.slice()); } } });
  if (delta === 0) {
    assert.equal((await execution).exitCode, 1);
    assert.deepEqual(Buffer.concat(writes), expected);
    assert.equal(writes.length, 1);
  } else {
    await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(writes, []);
  }
});
