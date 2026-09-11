import assert from "node:assert/strict";
import { test } from "node:test";
import { hereDocumentWords, parseShell, parseShellInputUnit, parseShellUnit } from "../../src/shell/parser.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellLimitError, ShellSyntaxError } from "../../src/shell/types.js";
import { cloudflareWorkerLimits } from "../../src/shell/worker-limits.js";
import { shellValueBytes } from "../../src/contracts/value.js";

const parseLimit = (error: unknown): boolean => error instanceof ShellLimitError && error.limit === "maxParseUnits";

function minimumUnits(source: string): number {
  for (let units = 0; units < 256; units++) {
    try { parseShell(source, 0, { maxParseUnits: units }); return units; }
    catch (error) { if (!parseLimit(error)) throw error; }
  }
  throw new Error("Fixture exceeds its bounded admission search");
}

test("standalone parsing admits structures before accepting even empty source", () => {
  assert.throws(() => parseShell("", 0, { maxParseUnits: 0 }), parseLimit);
});

for (const source of [
  `echo ${"w ".repeat(32)}`,
  `echo $((1${"+1".repeat(32)}))`,
  `echo ${"`:` ".repeat(16)}`,
  `echo ${'a"b"'.repeat(32)}`,
  `cat ${"<<X ".repeat(16)}\n${"X\n".repeat(16)}`,
  `array=(${"[1]=x ".repeat(16)})`,
]) {
  test(`standalone parsing rejects bounded structural density: ${source.slice(0, 24)}`, () => {
    assert.throws(() => parseShell(source, 0, { maxParseUnits: 48 }), parseLimit);
    assert.doesNotThrow(() => parseShell(source, 0, { maxParseUnits: 4096 }));
  });
}

test("literal length does not consume additional structural units", () => {
  const plain = minimumUnits("echo a");
  const quoted = minimumUnits('echo "a"');
  for (const length of [1, 64, 256]) {
    assert.doesNotThrow(() => parseShell(`echo ${"a".repeat(length)}`, 0, { maxParseUnits: 32 }));
    assert.doesNotThrow(() => parseShell(`echo "${"a".repeat(length)}"`, 0, { maxParseUnits: 32 }));
    assert.equal(minimumUnits(`echo ${"a".repeat(length)}`), plain);
    assert.equal(minimumUnits(`echo "${"a".repeat(length)}"`), quoted);
  }
});

test("raw ANSI-C ownership records are admitted without conflating decoded bytes", () => {
  assert.equal(minimumUnits("echo $'\\xff'"), minimumUnits("echo $'a'") + 2);
  const script = parseShell("echo $'\\xff'$'\\xfe'");
  const command = script.lists[0]!.pipelines[0]!.commands[0]!;
  assert.equal(command.kind, "simple");
  if (command.kind !== "simple") throw new Error("Expected simple command");
  const parts = command.words[1]!.parts;
  assert.equal(parts.length, 2);
  for (const [index, part] of parts.entries()) {
    assert.equal(part.kind, "text");
    if (part.kind !== "text" || !part.byteValue) throw new Error("Expected owned bytes");
    assert.deepEqual([...shellValueBytes(part.byteValue)], [255 - index]);
  }
});

test("legacy parser arguments and syntax diagnostics remain compatible", () => {
  assert.deepEqual(parseShell("echo ok"), parseShell("echo ok", 0));
  assert.throws(() => parseShell("echo '"), ShellSyntaxError);
  for (const maxParseUnits of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseShell(":", 0, { maxParseUnits }), RangeError);
  }
  assert.equal(cloudflareWorkerLimits.maxParseUnits, 65_536);
});

test("input units and incomplete attempts retain their shared charges", () => {
  const budget = new ParseBudget(32);
  parseShellUnit(":", 0, false, budget);
  parseShellUnit(":", 0, false, budget);
  assert.throws(() => parseShellUnit(":", 0, false, budget), parseLimit);
  const partial = new ParseBudget(24);
  assert.equal(parseShellInputUnit("echo '", false, partial), undefined);
  assert.throws(() => partial.admit(24), parseLimit);
  assert.throws(() => parseShellInputUnit("echo '", false, partial), parseLimit);
});

test("nested shell parsers cannot obtain a fresh allowance", () => {
  for (const source of ["echo $(echo a)", "echo `echo a`"]) {
    assert.throws(() => parseShell(source, 0, { maxParseUnits: 24 }), parseLimit);
    assert.doesNotThrow(() => parseShell(source, 0, { maxParseUnits: 64 }));
  }
});

test("deferred heredoc words and nested parsers consume the supplied ledger", () => {
  const document = { delimiter: "END", body: "a".repeat(1025), quoted: false, stripTabs: false, offset: 0, depth: 0, endLine: 1 };
  assert.equal([...hereDocumentWords(document, 1, false, [], new ParseBudget(5))].length, 2);
  assert.throws(() => [...hereDocumentWords(document, 1, false, [], new ParseBudget(4))], parseLimit);
  assert.equal([...hereDocumentWords({ ...document, quoted: true }, 1, false, [], new ParseBudget(2))].length, 1);
  assert.throws(() => [...hereDocumentWords({ ...document, quoted: true }, 1, false, [], new ParseBudget(1))], parseLimit);
  for (const body of ["$(echo a)", "`echo a`", "$((1+2+3))", "${value:-replacement}"]) {
    assert.throws(() => [...hereDocumentWords({ ...document, body }, 1, false, [], new ParseBudget(4))], parseLimit);
  }
});
