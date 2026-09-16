import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { primaryReference } from "./function-origin-primary-reference.js";

const definition = "origin_fn() {\n:\nmissing_origin_command;\n}\n";

function quote(source: string): string {
  return `'${source.split("'").join("'\\''")}'`;
}

const routes = [
  { name: "direct", native: "origin_fn", actual: "origin_fn" },
  { name: "eval", native: "eval origin_fn", actual: "eval origin_fn" },
  { name: "extension.evaluate", native: "eval origin_fn", actual: "origin_eval origin_fn" },
  { name: "command extension.evaluate", native: "command eval origin_fn", actual: "command origin_eval origin_fn" },
  { name: "builtin extension.evaluate", native: "builtin eval origin_fn", actual: "builtin origin_eval origin_fn" },
];

type Case = { name: string; native: string; actual: string; source?: string };

const cases: Case[] = [
  ...routes.map(route => ({
    name: `command-text definition through ${route.name}`,
    native: `:\n:\n${definition}:\n:\n${route.native}; printf 'status=%s' "$?"`,
    actual: `:\n:\n${definition}:\n:\n${route.actual}; printf 'status=%s' "$?"`,
  })),
  ...routes.map(route => ({
    name: `sourced definition through ${route.name}`,
    native: `. /dev/fd/3 3<<'FUNCTION_ORIGIN_REVIEW'\n${definition}FUNCTION_ORIGIN_REVIEW\n:\n:\n${route.native}; printf 'status=%s' "$?"`,
    actual: `. /dev/fd/3 3<<'FUNCTION_ORIGIN_REVIEW'\n${definition}FUNCTION_ORIGIN_REVIEW\n:\n:\n${route.actual}; printf 'status=%s' "$?"`,
    source: definition,
  })),
  ...["eval", "origin_eval"].flatMap(declare => routes.slice(0, 2).map(route => ({
    name: `${declare} definition through ${route.name}`,
    native: `:\n:\neval ${quote(definition)}\n:\n:\n${route.native}; printf 'status=%s' "$?"`,
    actual: `:\n:\n${declare} ${quote(definition)}\n:\n:\n${route.actual}; printf 'status=%s' "$?"`,
  }))),
  ...["command", "builtin"].map(route => ({
    name: `${route} bypasses the function rather than adopting its definition origin`,
    native: `${definition}\n${route} origin_fn; printf 'status=%s' "$?"`,
    actual: `${definition}\n${route} origin_fn; printf 'status=%s' "$?"`,
  })),
  { name: "top-level command-text error retains caller name", native: "missing_origin_command; printf 'status=%s' \"$?\"", actual: "missing_origin_command; printf 'status=%s' \"$?\"" },
];

async function setup(source?: string) {
  const fs = createMemoryFileSystem();
  if (source !== undefined) {
    await fs.mkdir("/dev/fd", { recursive: true });
    await fs.writeFile("/dev/fd/3", Buffer.from(source));
  }
  const shell = new Shell({ fs, extensions: [{ name: "function-origin-review", create: () => ({ builtins: [{
    name: "origin_eval",
    execute(context) { return context.evaluate(context.argumentValues[0]!); },
  }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const entry of cases) test(`function diagnostic origin: ${entry.name}`, async context => {
  const native = primaryReference(context.name, entry.native);
  const shell = await setup(entry.source);
  context.after(() => shell.dispose());
  const actual = await shell.exec(entry.actual);
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});

for (const entry of [
  { name: "direct function", script: `${definition}:\n:\norigin_fn; printf 'status=%s' "$?"` },
  { name: "eval function", script: `${definition}:\n:\neval origin_fn; printf 'status=%s' "$?"` },
  { name: "top-level error", script: "missing_origin_command; printf 'status=%s' \"$?\"" },
]) test(`function diagnostic origin: stdin-defined program ${entry.name}`, async context => {
  const native = primaryReference(context.name, entry.script, { stdin: true, argv0: "bash" });
  const shell = await setup();
  context.after(() => shell.dispose());
  const actual = await shell.exec("bash", { stdin: entry.script });
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});
