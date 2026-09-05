import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { Shell } from "../../../../src/shell/shell.js";
import { browserCommands } from "../../../../src/browser.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { commandRuntimeIdentity } from "../../../../src/contracts/command.js";
import { shellValueFromBytes } from "../../../../src/contracts/value.js";
import type { ShellExtension, ShellExtensionInstance, ShellExtensionContext } from "../../../../src/shell/extensions.js";

test("jobs factory explicitly declares syntax and matching runtime identity", () => {
  const extension = jobsExtension();
  assert.equal(extension.runtimeIdentity, commandRuntimeIdentity);
  assert.deepEqual(extension.syntax, { listTerminators: [{ operator: "&" }], specialParameters: [{ name: "!" }] });
  assert.deepEqual(extension.create().builtins.map(builtin => builtin.name), ["wait"]);
});

test("standalone jobs refuse absent execution-cleanup capability before acquiring owner resources", () => {
  let signalReads = 0;
  let localRegistrations = 0;
  const context = {
    get signal() { signalReads++; return new AbortController().signal; },
    registerCleanup() { localRegistrations++; },
  } as unknown as ShellExtensionContext;
  assert.throws(() => jobsExtension().create().start!(context), /execution-scoped cleanup ownership/u);
  assert.equal(signalReads, 0);
  assert.equal(localRegistrations, 0);
});

for (const syntax of [{ listTerminators: [{ operator: "&" }] }, { specialParameters: [{ name: "!" }] }]) {
  test(`declared syntax requires instance handlers after one factory call: ${JSON.stringify(syntax)}`, async context => {
    let created = 0;
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "missing", syntax, create() { created++; return { builtins: [] }; } }] });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(":"), TypeError);
    assert.equal(created, 1);
  });
}

for (const kind of ["getter", "hole", "extra", "duplicate", "wrong", "missing"]) {
  test(`hook capture refuses ${kind} without reading getters`, async context => {
    let getterCalls = 0;
    let hooks: unknown = [{ name: "!", lookup: () => "bad" }];
    if (kind === "getter") hooks = [{ name: "!", get lookup() { getterCalls++; return () => "bad"; } }];
    if (kind === "hole") hooks = Array(1);
    if (kind === "extra") Object.assign(hooks as object, { extra: true });
    if (kind === "duplicate") hooks = [...hooks as object[], ...hooks as object[]];
    if (kind === "wrong") hooks = [{ name: "?", lookup: () => "bad" }];
    if (kind === "missing") hooks = undefined;
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{
      name: "invalid", syntax: { specialParameters: [{ name: "!" }] },
      create: () => ({ builtins: [], specialParameters: hooks }) as ShellExtensionInstance,
    }] });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(":"), TypeError);
    assert.equal(getterCalls, 0);
  });
}

test("extension names do not activate syntax or builtins", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "jobs", create: () => ({ builtins: [] }) }] }).use(browserCommands());
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("true &")).exitCode, 2);
  assert.equal((await shell.exec("wait")).exitCode, 127);
});

test("captured hook callbacks survive mutation of original definitions", async context => {
  const hook = { name: "!", lookup: () => "before" };
  const extension: ShellExtension = { name: "mutation", syntax: { specialParameters: [{ name: "!" }] }, create: () => ({
    builtins: [{ name: "mutate", execute: () => { hook.lookup = () => "after"; return 0; } }],
    specialParameters: [hook],
  }) };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("mutate; printf '%s' \"$!\"");
  assert.equal(result.stdout, "before");
});

test("captured special parameters retain generic length and alternate expansion semantics", async context => {
  let value: ReturnType<typeof shellValueFromBytes> | undefined;
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" }, extensions: [{
    name: "raw-parameter", syntax: { specialParameters: [{ name: "!" }] },
    create: () => ({ builtins: [{ name: "fill", execute: () => { value = shellValueFromBytes(Uint8Array.of(255, 97)); return 0; } }],
      specialParameters: [{ name: "!", lookup: () => value }],
    }),
  }] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("printf '%s:' \"${!:-missing}\"; fill; printf '%s:%s' \"${#!}\" \"${!}\"");
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat([Buffer.from("missing:2:"), Buffer.from([255, 97])]));
  assert.equal(result.stderr, "");
});
