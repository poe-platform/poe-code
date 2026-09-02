import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

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
