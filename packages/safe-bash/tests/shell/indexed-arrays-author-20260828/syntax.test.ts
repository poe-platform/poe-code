import assert from "node:assert/strict";
import test from "node:test";
import {
  arraySelector, compoundEntry, compoundHead, copyArraySelector, elementAssignment,
  getArrayAssignment, getArraySelector, literalIndex, numericIndex, setArrayAssignment,
  setArraySelector,
} from "../../../src/shell/arrays/syntax.js";
import { parseShell } from "../../../src/shell/parser.js";
import type { Word, WordPart } from "../../../src/shell/parser.js";
import { ShellSyntaxError } from "../../../src/shell/types.js";

function parsedWord(source: string): Word {
  const command = parseShell(source).lists[0]!.pipelines[0]!.commands[0]!;
  assert.equal(command.kind, "simple");
  assert(command.kind === "simple");
  return command.words[0]!;
}

test("private syntax: canonical literal spelling, domain deferred", { timeout: 1000 }, () => {
  for (const spelling of ["0", "1", "2147483647", "'0'", '"2147483647"']) {
    assert.equal(numericIndex(literalIndex(spelling, 0)), Number(spelling.replace(/['"]/gu, "")));
  }
  for (const spelling of ["2147483648", "999999999999999999999999999999999999"]) {
    assert.equal(numericIndex(literalIndex(spelling, 0)), undefined);
  }
  for (const spelling of ["", "00", "01", "+0", "-1", " 0", "0 ", "1+1", "$index", "0x1", "'0'\"\"", "'0\"", '""', "1][2"]) {
    assert.throws(() => literalIndex(spelling, 0), ShellSyntaxError, spelling);
  }
});

test("private syntax: typed selector metadata survives explicit quote copying", { timeout: 1000 }, () => {
  const part: WordPart = { kind: "variable", name: "items", quoted: false };
  const selector = arraySelector("@", 0);
  setArraySelector(part, selector);
  const copy = copyArraySelector(part, { ...part, quoted: true });
  assert.equal(getArraySelector(copy), selector);
  assert.equal(getArraySelector(part), selector);
  assert.deepEqual(arraySelector("*", 0), { kind: "members", separator: "*" });
  assert.deepEqual(arraySelector('"2"', 0), { kind: "element", index: { decimal: "2" } });
  assert.throws(() => arraySelector('"@"', 0), ShellSyntaxError);
  assert.deepEqual(Object.keys(part), ["kind", "name", "quoted"]);
});

test("private syntax: element RHS preserves parts without argv rewriting", { timeout: 1000 }, () => {
  for (const source of ["items[0]=value", "items['0']=value", 'items["0"]=value']) {
    const word = parsedWord(source);
    const assignment = elementAssignment(word);
    assert(assignment);
    assert.equal(assignment.name, "items");
    assert.equal(assignment.index.decimal, "0");
    assert.equal(assignment.append, false);
    assert.deepEqual(assignment.value.parts, [{ kind: "text", value: "value", quoted: false }]);
    setArrayAssignment(word, assignment);
    assert.equal(getArrayAssignment(word), assignment);
    assert.equal(word.spelling, source);
  }
  const assignment = elementAssignment(parsedWord('items[2]+="${other:-fallback}"'));
  assert(assignment);
  assert.equal(assignment.append, true);
  assert.equal(assignment.value.parts.at(-1)?.kind, "variable");
  assert.equal(elementAssignment(parsedWord("'items[1]=text'")), undefined);
  assert.throws(() => elementAssignment(parsedWord("items[01]=text")), ShellSyntaxError);
});

test("private syntax: compound head and explicit entry classification", { timeout: 1000 }, () => {
  assert.deepEqual(compoundHead(parsedWord("items=")), { name: "items", append: false });
  assert.deepEqual(compoundHead(parsedWord("items+=")), { name: "items", append: true });
  assert.equal(compoundHead(parsedWord("'items='")), undefined);
  const entry = compoundEntry(parsedWord("['2']='two words'"));
  assert.equal(entry.index?.decimal, "2");
  assert.deepEqual(entry.value.parts, [{ kind: "text", value: "two words", quoted: true }]);
  const ordinary = parsedWord("'[2]=ordinary'");
  assert.equal(compoundEntry(ordinary).value, ordinary);
  assert.equal(compoundEntry(ordinary).index, undefined);
  assert.throws(() => compoundEntry(parsedWord("[01]=bad")), ShellSyntaxError);
});
