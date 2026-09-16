import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";

const referenceBytes = readFileSync(new URL("./command-default-path-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), "a87f62213e6a785bef9fbb11240056948f2a83e152cf0ae8785b4cdd6a813a0f");
const reference = JSON.parse(referenceBytes.toString()) as {
  profile: string; locale: string; oracle: { sha256: string };
  records: { name: string; source: string; status: number; stdoutHex: string; stderrHex: string }[];
};
assert.equal(reference.profile, "primary-5.3");
assert.equal(reference.locale, "C");
assert.equal(reference.oracle.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(reference.records.length, 1);

function setup() {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const fixture of reference.records) test(`documented default-path divergence from primary C: ${fixture.name}`, async context => {
  const shell = setup(); context.after(() => shell.dispose());
  const result = await shell.exec(fixture.source);
  // Keep the native capture unchanged: virtual command -p deliberately has no default PATH.
  assert.equal(fixture.status, 127);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "command: -p: unsupported option\n");
});

test("nested command flags preserve raw FF without unsupported default-path lookup", async context => {
  const shell = setup(); context.after(() => shell.dispose());
  const fixture = reference.records[0]!;
  const result = await shell.exec('name=$\'\\377\'; command -- command -- "$name"');
  assert.equal(result.exitCode, fixture.status);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(fixture.stdoutHex, "hex"));
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(fixture.stderrHex, "hex"));
});
