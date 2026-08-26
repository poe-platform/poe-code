import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { bashResult } from "./bash-bugfix-helpers.js";
import { setup } from "./helpers.js";

const prelude = 'say() { printf "%s\\n" "$*"; }; err() { printf "%s\\n" "$*" >&2; }; ';

for (const source of [
  'value=report.txt; case "$value" in *.md) say wrong;; *.txt|*.log) say text;; *) say wrong;; esac',
  'value="a*b"; case "$value" in "a*b") say literal;; *) say wrong;; esac',
  'pattern="a*"; case abc in "$pattern") say wrong;; $pattern|z) say expanded;; esac',
  'case abc in $(say "a*")|$(err BAD)) say hit;; $(err BAD)) say wrong;; esac',
  'false; case x in y) :;; esac; say "$?"; false; case x in x) ;; esac; say "$?"; case x in x) false;; esac; say "$?"',
  'case x in esac; say "$?"; case x in (x) say optional\nesac',
  'value="a\nb"; case "$value" in a?b) say newline;; *) say wrong;; esac',
  'case "a\n" in a) say wrong;; *) say exact;; esac',
  'case a/b in a*b) say slash;; esac; case .x in *) say dot;; esac',
  'case 7 in [[:digit:]]) say digit;; esac; case "]" in []]) say bracket;; esac',
  'case b in [!a]) say not-a;; esac; case a in [a-z]) say range;; esac',
  'case "[" in "[") say literal;; esac; case "*" in \\*) say star;; esac',
  'case - in [a\\-z]) say dash;; esac; case z in [a\\-z]) say z;; esac',
  'value="a b"; case $value in "a b") say nosplit;; esac',
  'case x in x) case y in y) say nested;; esac;; esac',
  'for item in a b; do case $item in a) continue;; b) say B; break;; esac; say wrong; done',
  'func() case x in x) say function;; esac; func',
  'say "$(case x in (x) say nested;; esac)"',
  'case x in x) say data >&3;; esac 3>out',
  'case x in x) false;; esac && say wrong || say status',
]) {
  test(`case agrees with Bash: ${JSON.stringify(source)}`, async () => {
    const expected = bashResult(prelude + source);
    const { shell, fs } = setup();
    const result = await shell.exec(source, { signal: AbortSignal.timeout(2000) });
    const files = Object.fromEntries(await Promise.all((await fs.readdir("/")).map(async (entry) =>
      [entry.name, new TextDecoder().decode(await fs.readFile(`/${entry.name}`))])));
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, files }, expected);
  });
}

for (const [source, stdout] of [
  ['case x in x) say A ;& y) say B ;; esac', 'A\nB\n'],
  ['case x in x) say A ;;& y) say B ;; x) say C ;; esac', 'A\nC\n'],
  ['case x in x) say A ;& $(err BAD)) say B ;;& x) say C ;; esac', 'A\nB\nC\n'],
  ['say "$(case x in x) say nested;; esac)"', 'nested\n'],
] as const) {
  test(`case modern grammar without Bash 3.2 parser artifacts: ${source}`, async () => {
    const { shell } = setup();
    const result = await shell.exec(source);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const [source, status] of [
  ['say ran >marker; case x in x) :;;', 2],
  ['say ran >marker; case x x) :;; esac', 2],
  ['say ran >marker; case x in x|) :;; esac', 2],
  ['say ran >marker; case x in x) : ;& ;& esac', 2],
  ['say ran >marker; : ;; :', 2],
  ['say ran >marker; case x in x) :;; y) say "$(true |)";; esac', 127],
] as const) {
  test(`malformed case fails before effects: ${source}`, async () => {
    const { shell, fs } = setup();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, status);
    assert.equal(result.stdout, "");
    assert.deepEqual(await fs.readdir("/"), []);
  });
}

test("case subject and patterns share expansion and command budgets", async () => {
  const { shell, fs } = setup();
  await assert.rejects(shell.exec('case "$VALUE" in *) say bad >marker;; esac', {
    env: { VALUE: "12345" }, limits: { maxExpansionBytes: 4 },
  }), (error) => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  await assert.rejects(shell.exec('case x in $(say x)) say bad >marker;; esac', {
    limits: { maxCommands: 1 },
  }), (error) => error instanceof ShellLimitError && error.limit === "maxCommands");
  assert.deepEqual(await fs.readdir("/"), []);
});

test("adversarial case matching has bounded work before any arm effects", { timeout: 2000 }, async () => {
  const { shell, fs } = setup();
  await assert.rejects(shell.exec('case "$VALUE" in $PATTERN) say bad >marker;; esac', {
    env: { VALUE: "a".repeat(1000), PATTERN: `*${"a".repeat(500)}b` },
    limits: { maxExpansionBytes: 4096 },
  }), (error) => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.deepEqual(await fs.readdir("/"), []);
});
