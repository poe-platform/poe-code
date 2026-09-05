import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";

const referenceBytes = readFileSync(new URL("./command-name-review-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), "0f6c1e59ed9c1a4841216fbeadd01400ba4b2518ac269d39b402e4ce883d8dda");
const reference = JSON.parse(referenceBytes.toString()) as {
  oracle: { sha256: string; version: string };
  profiles: { locale: string; supported: boolean; observation: { status: number; stdoutHex: string; stderrHex: string } }[];
  records: {
    locale: string;
    name: string;
    nameHex: string;
    source: string;
    route: "direct" | "command" | "builtin";
    expected: { status: number; stdoutHex: string; stderrHex: string };
  }[];
};
assert.equal(reference.oracle.sha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");
assert.equal(reference.oracle.version, "GNU bash, version 5.3.0(1)-release (aarch64-apple-darwin25.4.0)");
assert.deepEqual(reference.profiles.map(profile => profile.locale), ["C", "en_US.UTF-8", "C.UTF-8"]);
for (const profile of reference.profiles) {
  assert.equal(profile.supported, true);
  assert.equal(profile.observation.status, 0);
  assert.equal(profile.observation.stderrHex, "");
  assert.equal(profile.observation.stdoutHex, Buffer.from(profile.locale === "C" ? "C;2;1" : `${profile.locale};1;0`).toString("hex"));
}
assert.equal(reference.records.length, 86);
assert.equal(new Set(reference.records.map(record => `${record.locale}:${record.name}`)).size, 86);
for (const [locale, count] of [["C", 26], ["en_US.UTF-8", 30], ["C.UTF-8", 30]] as const) {
  assert.equal(reference.records.filter(record => record.locale === locale).length, count);
}

for (const fixture of reference.records) test(`command name primary 5.3 independent: ${fixture.locale}: ${fixture.name}`, async context => {
  const bytes = Buffer.from(fixture.nameHex, "hex");
  assert.equal(bytes.toString("hex"), fixture.nameHex);
  const quoted = `$'${[...bytes].map(byte => `\\${byte.toString(8).padStart(3, "0")}`).join("")}'`;
  const source = `name=${quoted}; printf '%s' "$name"; ${fixture.route === "direct" ? "" : `${fixture.route} `}"$name"`;
  assert.equal(source, fixture.source);
  assert.equal(fixture.expected.stdoutHex, fixture.nameHex);
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: fixture.locale } });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(source);
  assert.equal(actual.exitCode, fixture.expected.status, fixture.name);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), bytes, fixture.name);
  assert.deepEqual(Buffer.from(actual.stderrBytes), Buffer.from(fixture.expected.stderrHex, "hex"), fixture.name);
});
