import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";

const referenceBytes = readFileSync(new URL("./function-coordinate-review-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), "517ae50d5f216f28119b151ab48c9f4c67b5428bf6bfb339a1b05e18961b6c1b");
const reference = JSON.parse(referenceBytes.toString()) as {
  profile: string;
  oracle: { version: string; executableHash: string };
  records: { name: string; source: string; expected: { status: number; stdoutHex: string; stderrHex: string } }[];
};
assert.equal(reference.profile, "primary-5.3");
assert.equal(reference.oracle.version, "GNU bash, version 5.3.0(1)-release (aarch64-apple-darwin25.4.0)");
assert.equal(reference.oracle.executableHash, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");

const quote = (source: string): string => `'${source.split("'").join("'\\''")}'`;
const cases = [
  { name: "eval-created function inside substitution", source: `:\n:\nprintf '%s' "$(eval ${quote("fn() {\n:\nmissing_coordinate;\n}\n")}; fn)"` },
  { name: "if in substituted function body", source: `:\nprintf '%s' "$(fn(){ if true; then missing_coordinate; fi; }; fn)"` },
  { name: "for in substituted function body", source: `:\nprintf '%s' "$(fn(){ for item in one; do missing_coordinate; done; }; fn)"` },
  { name: "while in substituted function body", source: `:\nprintf '%s' "$(fn(){ while true; do missing_coordinate; break; done; }; fn)"` },
  { name: "if before substituted function declaration", source: `:\nprintf '%s' "$(if true; then :; fi; fn(){ missing_coordinate; }; fn)"` },
  { name: "multiline argument before substituted function declaration", source: `:\nprintf '%s' "$(printf '%s' 'first\nlast'; fn(){ missing_coordinate; }; fn)"` },
  { name: "multiple multiline arguments in substituted function", source: `:\nprintf '%s' "$(fn(){ printf '%s' 'first\nlast' 'more\nlines'; missing_coordinate; }; fn)"` },
  { name: "eval-created conditional function outside substitution", source: `:\n:\neval ${quote("fn() {\nif true; then\nmissing_coordinate;\nfi;\n}\n")}; eval fn` },
];

assert.equal(reference.records.length, cases.length);
assert.equal(new Set(reference.records.map(record => record.name)).size, cases.length);
for (const fixture of cases) test(`function coordinate primary 5.3 independent: ${fixture.name}`, async context => {
  const record = reference.records.find(entry => entry.name === fixture.name);
  assert.ok(record);
  assert.equal(record.source, fixture.source);
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(fixture.source);
  assert.equal(actual.exitCode, record.expected.status, fixture.source);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), Buffer.from(record.expected.stdoutHex, "hex"), fixture.source);
  assert.deepEqual(Buffer.from(actual.stderrBytes), Buffer.from(record.expected.stderrHex, "hex"), fixture.source);
});
