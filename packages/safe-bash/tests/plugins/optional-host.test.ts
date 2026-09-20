import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import * as core from "../../src/index.js";
import { codeOf, output, pathOf } from "../../src/commands/internal.js";
import { compareCopyIdentity, compareObservedEntries } from "../../src/commands/copy-identity.js";
import { Shell } from "../../src/shell/shell.js";
import { ShellLimitError } from "../../src/shell/types.js";
import type * as Host from "../../src/optional-host.js";
import type * as Extensions from "../../src/shell/extensions.js";
import type * as Input from "../../src/shell/input.js";

type Same<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type HostTypes = [
  Host.ShellExtension, Host.ShellBindingReference, Host.ShellExtensionContext,
  Host.ShellExtensionInstance, Host.ShellIndexedWriter, Host.ShellInputBorrow,
  Host.ShellInputObserver, Host.ShellExtensionOption, Host.ShellExtensionScope,
  Host.ShellExtensionBuiltin, Host.ShellExtensionEvent, Host.PreparedShellChild,
  Host.ShellChildPreparation, Host.ShellListTerminatorContext, Host.ShellListTerminatorHook,
  Host.ShellSpecialParameterHook, Host.ShellBindingResult<string>, Host.ShellExecutionCheckpoint,
  Host.RawRecord, Host.ReadLine,
];
type CoreTypes = [
  Extensions.ShellExtension, Extensions.ShellBindingReference, Extensions.ShellExtensionContext,
  Extensions.ShellExtensionInstance, Extensions.ShellIndexedWriter, Extensions.ShellInputBorrow,
  Extensions.ShellInputObserver, Extensions.ShellExtensionOption, Extensions.ShellExtensionScope,
  Extensions.ShellExtensionBuiltin, Extensions.ShellExtensionEvent, Extensions.PreparedShellChild,
  Extensions.ShellChildPreparation, Extensions.ShellListTerminatorContext, Extensions.ShellListTerminatorHook,
  Extensions.ShellSpecialParameterHook, Extensions.ShellBindingResult<string>, Extensions.ShellExecutionCheckpoint,
  Input.RawRecord, Input.ReadLine,
];

for (const profile of [
  { name: "workspace", url: new URL("../../package.json", import.meta.url), key: "./optional-host", prefix: "./dist" },
  { name: "root", url: new URL("../../../../package.json", import.meta.url), key: "./safe-bash/optional-host", prefix: "./packages/safe-bash/dist" },
]) test(`optional host follows the ${profile.name} package boundary`, async () => {
  const manifest = JSON.parse(await readFile(profile.url, "utf8")) as { exports: Record<string, unknown> };
  assert.deepEqual(manifest.exports[profile.key], profile.name === "root" ? undefined : {
    types: `${profile.prefix}/optional-host.d.ts`, import: `${profile.prefix}/optional-host.js`,
  });
  assert.equal(Object.hasOwn(manifest.exports, profile.key.replace("optional-host", "optional")), false);
});

test("optional host re-exports exactly five canonical helpers and twenty canonical types", async () => {
  const host = await import("../../src/optional-host.js");
  const expected = { codeOf, compareCopyIdentity, compareObservedEntries, output, pathOf };
  assert.deepEqual(Object.keys(host).sort(), Object.keys(expected).sort());
  for (const name of Object.keys(expected) as (keyof typeof expected)[]) {
    assert.equal(host[name], expected[name], name);
    assert.equal(Object.hasOwn(core, name), false, `${name} must not enter the default barrel`);
  }
  const sameTypes: Same<HostTypes, CoreTypes> = true;
  assert.equal(sameTypes, true);
});

test("optional host output preserves raw bytes in the canonical source Shell", async context => {
  const host = await import("../../src/optional-host.js");
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  shell.register({ name: "host_bytes", async execute(command) {
    await host.output(command, Uint8Array.of(255, 0, 195, 169));
    return { exitCode: 0 };
  } });
  const result = await shell.exec("host_bytes");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 0, 195, 169));
  assert.equal(result.stderr, "");
});

test("optional host output retains the canonical shared output budget", async context => {
  const host = await import("../../src/optional-host.js");
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxOutputBytes: 2 } });
  context.after(() => shell.dispose());
  shell.register({ name: "host_bytes", async execute(command) {
    await host.output(command, Uint8Array.of(1, 2, 3));
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("host_bytes"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});

for (const reason of [false, 0, "", null]) test(`optional host output preserves exact cancellation: ${String(reason)}`, async context => {
  const host = await import("../../src/optional-host.js");
  const controller = new AbortController();
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  let returned = false;
  shell.register({ name: "host_bytes", async execute(command) {
    controller.abort(reason);
    await host.output(command, Uint8Array.of(255));
    returned = true;
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("host_bytes", { signal: controller.signal }), error => Object.is(error, reason));
  assert.equal(returned, false);
});
