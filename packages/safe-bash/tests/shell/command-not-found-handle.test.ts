import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

const handler = `command_not_found_handle() { printf '<%s>\\n' "$@"; mark=child; return 23; }`;
const cases = [
  ["arguments and isolated assignments", `mark=parent; ${handler}; unavailable_demo 'two words' ''; printf 'status=%s mark=%s\\n' "$?" "$mark"`],
  ["handler exit status", `${handler}; unavailable_demo`],
  ["command builtin", `${handler}; command unavailable_demo 'two words' ''`],
  ["pipeline status", `${handler}; unavailable_demo | cat; printf 'status=%s\\n' "\${PIPESTATUS[*]}"`],
  ["discovery bypass", `${handler}; command -v unavailable_demo`],
  ["isolated exit", `command_not_found_handle() { exit 24; }; unavailable_demo; printf 'status=%s\\n' "$?"`],
  ["temporary environment", `mark=parent; command_not_found_handle() { printf '%s\\n' "$mark"; }; mark=temporary unavailable_demo; printf '%s\\n' "$mark"`],
  ["local variables", `command_not_found_handle() { printf '%s\\n' "$mark"; mark=child; }; f() { local mark=local; unavailable_demo; printf '%s\\n' "$mark"; }; f`],
] as const;

for (const limits of [undefined, { maxExpansionBytes: 1048576, maxExpansionFields: 1024 }]) {
  for (const [label, source] of cases) test(`command_not_found_handle: ${label} (${limits ? "bounded" : "default"})`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem(), limits }).use(standardCommands());
    context.after(() => shell.dispose());
    const native = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", source], { env: { LC_ALL: "C", PATH: "/usr/bin:/bin" } });
    assert.equal(native.error, undefined);
    assert.equal(native.stderr.toString(), "");
    const result = await shell.exec(source);
    assert.equal(result.stdout, native.stdout.toString());
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, native.status);
  });
}

for (const [label, source, status, diagnostic] of [
  ["missing explicit path", `${handler}; ./unavailable_demo`, 127, "No such file or directory"],
  ["non-executable file", `${handler}; PATH=/bin unavailable_demo`, 126, "Permission denied"],
  ["absent handler", "missing_without_handler", 127, "command not found"],
] as const) test(`command_not_found_handle bypass: ${label}`, async context => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/bin", { recursive: true });
  await fs.writeFile("/bin/unavailable_demo", new TextEncoder().encode("echo unexpected"), { mode: 0o644 });
  const shell = new Shell({ fs }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec(source);
  assert.equal(result.stdout, "");
  assert.equal(result.exitCode, status);
  assert.ok(result.stderr.includes(diagnostic), result.stderr);
});

test("command_not_found_handle preserves command and argument bytes", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("command_not_found_handle() { printf '%s' \"$@\"; }; $'\\377' $'\\376'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(255, 254));
});
