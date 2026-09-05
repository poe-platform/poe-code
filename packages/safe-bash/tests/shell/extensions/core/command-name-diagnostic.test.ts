import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";

const referenceBytes = readFileSync(new URL("./command-name-diagnostic-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), "5828468727c5abf173d1065d7fe43a011f5876158c34ccdf1faad44ed4206c00");
const reference = JSON.parse(referenceBytes.toString()) as {
  profile: string;
  executableSha256: string;
  records: { name: string; source: string; nativeSource: string; status: number; stdoutBase64: string; stderrBase64: string }[];
};
assert.equal(reference.profile, "primary-5.3");
assert.equal(reference.executableSha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");

const body = "origin_fn(){ 'origin_\nmissing'; }; origin_fn";
const cases = [
  { name: `function reprint layout ${JSON.stringify(body)}`, source: `:\nprintf '%s' "$(${body})"` },
  { name: "direct multiline unknown command", source: "'origin_\nmissing'" },
];

assert.equal(reference.records.length, cases.length);
assert.equal(new Set(reference.records.map(record => record.name)).size, cases.length);
for (const fixture of cases) test(`command name primary 5.3: ${fixture.name}`, async context => {
  const native = reference.records.find(record => record.name === fixture.name);
  assert.ok(native);
  assert.equal(native.source, fixture.source);
  assert.equal(native.nativeSource, fixture.source);
  const shell = new Shell({
    fs: createMemoryFileSystem(), env: { LC_ALL: "C" },
    extensions: [{ name: "origin-callback", create: () => ({ builtins: [{
      name: "origin_eval", execute: invocation => invocation.evaluate(invocation.argumentValues[0]!),
    }] }) }],
  });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(fixture.source);
  assert.equal(result.exitCode, native.status, fixture.source);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(native.stdoutBase64, "base64"), fixture.source);
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(native.stderrBase64, "base64"), fixture.source);
});
