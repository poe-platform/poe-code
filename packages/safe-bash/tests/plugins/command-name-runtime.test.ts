import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

function reference(file: string, sha256: string): unknown {
  const bytes = readFileSync(new URL(`../shell/extensions/core/${file}`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
  return JSON.parse(bytes.toString());
}

const originals = reference("command-name-diagnostic-reference.json", "5828468727c5abf173d1065d7fe43a011f5876158c34ccdf1faad44ed4206c00") as {
  records: { name: string; source: string; status: number; stdoutBase64: string; stderrBase64: string }[];
};
const reviewed = reference("command-name-review-reference.json", "0f6c1e59ed9c1a4841216fbeadd01400ba4b2518ac269d39b402e4ce883d8dda") as {
  records: { name: string; route: string; locale: string; source: string; expected: { status: number; stdoutHex: string; stderrHex: string } }[];
};
const finalReview = reference("command-name-final-review-reference.json", "827a06c0933968ac36df08a9f7d666cae9a904132c59647524712c2b7dfe5ece") as {
  records: { name: string; locale: string; source: string; expected: { status: number; stdoutHex: string; stderrHex: string } }[];
};
assert.equal(originals.records.length, 2);
assert.equal(reviewed.records.length, 86);
assert.equal(finalReview.records.length, 12);

const cases = [
  ...originals.records.map(record => ({
    name: record.name, locale: "C", source: record.source, status: record.status,
    stdout: Buffer.from(record.stdoutBase64, "base64"), stderr: Buffer.from(record.stderrBase64, "base64"),
  })),
  ...reviewed.records.map(record => ({
    name: `${record.locale} ${record.route} ${record.name}`, locale: record.locale, source: record.source, status: record.expected.status,
    stdout: Buffer.from(record.expected.stdoutHex, "hex"), stderr: Buffer.from(record.expected.stderrHex, "hex"),
  })),
  ...finalReview.records.map(record => ({
    name: `${record.locale} final review ${record.name}`, locale: record.locale, source: record.source, status: record.expected.status,
    stdout: Buffer.from(record.expected.stdoutHex, "hex"), stderr: Buffer.from(record.expected.stderrHex, "hex"),
  })),
];

describe("compiled primary command-name diagnostics", { skip: selected === undefined ? "Requires a current build and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  for (const fixture of cases) test(fixture.name, async context => {
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    const shell = new published.Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: fixture.locale } }).use(published.agentCommands());
    context.after(() => shell.dispose());
    const actual = await shell.exec(fixture.source);
    assert.equal(actual.exitCode, fixture.status);
    assert.deepEqual(Buffer.from(actual.stdoutBytes), fixture.stdout);
    assert.deepEqual(Buffer.from(actual.stderrBytes), fixture.stderr);
  });
});
