import assert from "node:assert/strict";
import { test } from "node:test";
import { captureShellSyntax, functionReprintedLines, hereDocumentWords, parseShell, parseShellInputUnit, parseShellUnit } from "../../src/shell/parser.js";
import type { Script } from "../../src/shell/parser.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { SourceLineIndex } from "../../src/shell/source-line-index.js";
import { getArraySelector } from "../../src/shell/arrays/syntax.js";
import { shellValueBytes, shellValueFromBytes } from "../../src/contracts/value.js";
import { ShellLimitError } from "../../src/shell/types.js";

function words(script: Script) {
  const command = script.lists[0]!.pipelines[0]!.commands[0]!;
  assert.equal(command.kind, "simple");
  if (command.kind !== "simple") throw new Error("Expected simple command");
  return command.words;
}

test("budgeted parsing retains captured syntax across nested substitutions", () => {
  const syntax = captureShellSyntax({ specialParameters: [{ name: "!" }], listTerminators: [{ operator: "&" }] });
  const script = parseShell('echo $(echo $!) `echo ${!}` &', 0, { maxParseUnits: 512 }, syntax);
  assert.equal(script.lists[0]!.terminator?.operator, "&");
  for (const [index, form] of [[1, "dollar-parenthesis"], [2, "backtick"]] as const) {
    const part = words(script)[index]!.parts[0]!;
    assert.equal(part.kind, "substitution");
    if (part.kind !== "substitution") throw new Error("Expected substitution");
    assert.equal(part.form, form);
    const parameter = words(part.script)[1]!.parts[0]!;
    assert.equal(parameter.kind, "variable");
    if (parameter.kind !== "variable") throw new Error("Expected parameter");
    assert.equal(parameter.specialParameter, syntax.specialParameters[0]);
  }
  assert.throws(() => parseShell('echo $!', 0, { maxParseUnits: 0 }, syntax), ShellLimitError);
});

test("legacy syntax and byte-source arguments coexist with shared parse budgets", () => {
  const syntax = { specialParameters: [{ name: "!" }] };
  assert.equal(words(parseShell('echo $!', 0, syntax))[1]!.parts[0]!.kind, "variable");
  assert.ok(parseShellInputUnit('echo $!\n', false, syntax));
  const source = 'echo "\xff"';
  const legacy = parseShellUnit(source, 0, false, true, syntax);
  const budget = new ParseBudget(512);
  const merged = parseShellUnit(source, 0, false, budget, new SourceLineIndex(source, budget), undefined, true, syntax);
  for (const script of [legacy.script, merged.script]) {
    const part = words(script)[1]!.parts.find(part => part.kind === "text" && part.byteValue)!;
    assert.equal(part.kind, "text");
    if (part.kind !== "text" || !part.byteValue) throw new Error("Expected raw text");
    assert.deepEqual([...shellValueBytes(part.byteValue)], [255]);
  }
});

test("opaque source values and raw here-document bytes remain distinct", () => {
  const source = 'echo X';
  const budget = new ParseBudget(512);
  const raw = shellValueFromBytes(new Uint8Array([0xff]));
  const script = parseShellUnit(source, 0, false, budget, new SourceLineIndex(source, budget), new Map([[5, raw]])).script;
  const part = words(script)[1]!.parts[0]!;
  assert.equal(part.kind, "text");
  if (part.kind !== "text") throw new Error("Expected opaque text");
  assert.equal(part.byteValue, raw);
  const document = { delimiter: "EOF", quoted: true, stripTabs: false, offset: 0, depth: 0, body: "\xff\n", endLine: 2, byteSource: true };
  const text = [...hereDocumentWords(document, 1, false, [], new ParseBudget(32))][0]!.parts[0]!;
  assert.equal(text.kind, "text");
  if (text.kind !== "text" || !text.byteValue) throw new Error("Expected raw document");
  assert.deepEqual([...shellValueBytes(text.byteValue)], [255, 10]);
});

test("prefix names, transforms, and extension array keys retain both selector profiles", () => {
  const source = 'echo ${!prefix*} ${value@Q} ${!items[@]} ${items[0]-fallback}';
  const parsed = words(parseShell(source, 0, { arrayKeys: true, indexedElementOperators: true }));
  assert.equal(parsed[1]!.parts[0]!.kind, "variable");
  assert.deepEqual(getArraySelector(parsed[3]!.parts[0]!), { kind: "keys", separator: "@" });
  const ordinary = words(parseShell('echo ${!items[@]}'))[1]!.parts[0]!;
  assert.deepEqual(getArraySelector(ordinary), { kind: "members", separator: "@" });
  assert.ok(ordinary.kind === "variable" && ordinary.keys);
});

test("function reprint metadata survives budgeted parser construction", () => {
  const script = parseShell('f() { echo one; echo two; }; f');
  const lines = functionReprintedLines(script);
  assert.ok(lines instanceof Map);
  assert.ok(lines.size >= 4);
});
