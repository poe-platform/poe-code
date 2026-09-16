import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./function-origin-primary-reference.js";

function quote(source: string): string {
  return `'${source.split("'").join("'\\''")}'`;
}

async function setup(source?: string) {
  const fs = createMemoryFileSystem();
  if (source !== undefined) {
    await fs.mkdir("/dev/fd", { recursive: true });
    await fs.writeFile("/dev/fd/3", Buffer.from(source));
  }
  const shell = new Shell({ fs, extensions: [{ name: "function-provenance-review", create: () => ({ builtins: [{
    name: "origin_named",
    execute(context) { return context.evaluate(context.argumentValues[0]!, { name: context.args[1]! }); },
  }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const name of ["shell", "bash", "environment", "main"]) test(`function diagnostic source follows command-string argv0 ${name}`, async context => {
  const script = "cb() { missing_inside; return 0; }; cb; missing_after; printf 'status=%s' \"$?\"";
  const native = primaryReference(context.name, script, { name, argv0: "bash" });
  const shell = await setup();
  context.after(() => shell.dispose());
  const actual = await shell.exec(`bash -c ${quote(script)} ${quote(name)}`);
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});

for (const name of ["environment", "main", "stdin"]) test(`function declared by returned evaluate name=${name} retains definition provenance and restores caller`, async context => {
  const declaration = "cb() { missing_inside; return 0; }";
  const suffix = "; cb; missing_after; printf 'status=%s' \"$?\"";
  const native = primaryReference(context.name, `eval ${quote(declaration)}${suffix}`);
  const shell = await setup();
  context.after(() => shell.dispose());
  const actual = await shell.exec(`origin_named ${quote(declaration)} ${quote(name)}${suffix}`);
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});

for (const name of ["environment", "main"]) test(`sourced function via evaluate name=${name} returns to the caller's diagnostic origin`, async context => {
  const declaration = "cb() {\nmissing_inside;\nreturn 0;\n}\n";
  const prefix = `. /dev/fd/3 3<<'FUNCTION_PROVENANCE_REVIEW'\n${declaration}FUNCTION_PROVENANCE_REVIEW\n:\n`;
  const suffix = "; missing_after; printf 'status=%s' \"$?\"";
  const native = primaryReference(context.name, `${prefix}eval cb${suffix}`);
  const shell = await setup(declaration);
  context.after(() => shell.dispose());
  const actual = await shell.exec(`${prefix}origin_named cb ${quote(name)}${suffix}`);
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});

test("returned unsuccessful named evaluation does not rename later caller errors", async context => {
  const native = primaryReference(context.name, "eval false; printf 'eval=%s;' \"$?\"; missing_after; printf 'status=%s' \"$?\"");
  const shell = await setup();
  context.after(() => shell.dispose());
  const actual = await shell.exec("origin_named false environment; printf 'eval=%s;' \"$?\"; missing_after; printf 'status=%s' \"$?\"");
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});

test("named evaluation of command-bypass errors retains caller rather than function provenance", async context => {
  const declaration = "cb() { missing_inside; }; ";
  const suffix = "; missing_after; printf 'status=%s' \"$?\"";
  const native = primaryReference(context.name, `${declaration}eval 'command cb'${suffix}`);
  const shell = await setup();
  context.after(() => shell.dispose());
  const actual = await shell.exec(`${declaration}origin_named 'command cb' main${suffix}`);
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});
