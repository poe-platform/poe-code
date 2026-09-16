import assert from "node:assert/strict";
import test from "node:test";
import * as parser from "../../../../src/shell/parser.js";
import { ShellSyntaxError } from "../../../../src/shell/types.js";

const declarations = { listTerminators: [{ operator: "&" }], specialParameters: [{ name: "!" }] } as const;

function simple(script: parser.Script, list = 0) {
  const command = script.lists[list]!.pipelines[0]!.commands[0]!;
  assert.equal(command.kind, "simple");
  if (command.kind !== "simple") throw new Error("Expected simple command");
  return command;
}

for (const [label, make] of [
  ["symbol field", () => ({ ...declarations, [Symbol("extra")]: true })],
  ["array extra field", () => ({ listTerminators: Object.assign([{ operator: "&" }], { extra: true }) })],
  ["entry symbol field", () => ({ specialParameters: [{ name: "!", [Symbol("extra")]: true }] })],
  ["inherited entry name", () => ({ specialParameters: [Object.create({ name: "!" })] })],
  ["numeric declaration object", () => ({ specialParameters: { 0: { name: "!" }, length: 1 } })],
] as const) test(`independent declaration validation rejects ${label}`, () => {
  assert.throws(() => parser.captureShellSyntax(make() as parser.ShellSyntaxDeclarations), TypeError);
});

test("array-slot and hidden field accessors cannot execute during capture", () => {
  let calls = 0;
  const entries = new Array(1);
  Object.defineProperty(entries, "0", { get() { calls++; return { name: "!" }; } });
  assert.throws(() => parser.captureShellSyntax({ specialParameters: entries }), TypeError);
  const root = Object.defineProperty({}, "specialParameters", { get() { calls++; return []; } });
  assert.throws(() => parser.captureShellSyntax(root), TypeError);
  assert.equal(calls, 0);
});

test("captured syntax detaches both metadata arrays and reuses only its own frozen marker", () => {
  const parameter = { name: "!" };
  const terminator = { operator: "&" };
  const captured = parser.captureShellSyntax({ specialParameters: [parameter], listTerminators: [terminator] });
  parameter.name = "?"; terminator.operator = ";";
  const detached = parser.captureShellSyntax({ ...captured });
  assert.notEqual(detached, captured);
  assert.deepEqual(detached, captured);
  const part = simple(parser.parseShell("printf $! &", 0, captured)).words[1]!.parts[0]!;
  assert.equal(part.kind, "variable");
  if (part.kind !== "variable") throw new Error("Expected variable");
  assert.equal(part.specialParameter, captured.specialParameters[0]);
  assert.equal(Object.isFrozen(part.specialParameter), true);
  assert.throws(() => parser.parseShell("printf $! &"), ShellSyntaxError);
});

for (const source of [
  "printf '&' '!' '$!' '${!}'", "printf \\& \\$!", "printf a#b # & $!\nnext",
  "printf x &>out", "printf x >&2", "first |& second", "first && second || third",
  "case word in a) first ;& b) second ;;& c) third;; esac",
  "printf \"${#01}\" \"${a[3]}\" \"${a[@]}\"", "printf \"${value:-$(first)}\"",
]) test(`opt-in leaves existing syntax structurally unchanged: ${source}`, () => {
  assert.deepEqual(parser.parseShell(source, 0, declarations), parser.parseShell(source));
});

for (const source of ["first &>> out", "printf $$", "printf ${!name}", "printf ${![0]}", "first &&& second", "first &; second"]) test(`unsupported adjacent syntax remains rejected: ${source}`, () => {
  assert.throws(() => parser.parseShell(source, 0, declarations), ShellSyntaxError);
});

test("several asynchronous lists retain AND/OR ownership and source offsets", () => {
  const source = "! first && second & third || fourth & fifth";
  const script = parser.parseShell(source, 0, declarations);
  assert.equal(script.lists.length, 3);
  assert.deepEqual(script.lists.map(list => list.operators), [["&&"], ["||"], []]);
  assert.equal(script.lists[0]!.pipelines[0]!.negate, true);
  assert.deepEqual(script.lists.map(list => list.terminator?.offset), [source.indexOf("& third"), source.indexOf("& fifth"), undefined]);
  assert.equal(script.lists[2]!.terminator, undefined);
});

test("operator continuations distinguish AND from an asynchronous list terminator", () => {
  const source = "first &\\\n& second &\\\n third";
  const script = parser.parseShell(source, 0, declarations);
  assert.equal(script.lists.length, 2);
  assert.deepEqual(script.lists[0]!.operators, ["&&"]);
  assert.deepEqual(script.lists[0]!.terminator, { operator: "&", offset: source.indexOf("&\\\n third"), line: 2 });
  assert.equal(simple(script, 1).words[0]!.plain, "third");
});

test("bare special parameter consumes one character and preserves surrounding literal text", () => {
  const words = simple(parser.parseShell('printf "$!suffix" "${!}suffix"', 0, declarations)).words;
  for (const word of words.slice(1)) {
    const part = word.parts.find(part => part.kind === "variable");
    assert.equal(part?.name, "!");
    assert.equal(part?.quoted, true);
    assert.equal(word.parts.filter(part => part.kind === "text").map(part => part.value).join(""), "suffix");
  }
});

test("nested alternate substitutions retain independent list and parameter metadata", () => {
  const source = 'printf "${value:-$(first && second & printf "$!")}"';
  const variable = simple(parser.parseShell(source, 0, declarations)).words[1]!.parts.find(part => part.kind === "variable")!;
  const nested = variable.alternate!.parts.find(part => part.kind === "substitution")!;
  assert.deepEqual(nested.script.lists[0]!.operators, ["&&"]);
  assert.equal(nested.script.lists[0]!.terminator?.operator, "&");
  const parameter = simple(nested.script, 1).words[1]!.parts.find(part => part.kind === "variable")!;
  assert.deepEqual(parameter.specialParameter, { name: "!" });
});

test("parse units stop after the first newline without consuming subsequent invalid syntax", () => {
  const source = "first & # trailing comment\n& bad\n";
  const unit = parser.parseShellUnit(source, 0, false, false, declarations);
  assert.equal(unit.next, source.indexOf("\n") + 1);
  assert.equal(unit.script.lists.length, 1);
  assert.deepEqual(parser.parseShellInputUnit(source, false, declarations), unit);
  assert.throws(() => parser.parseShellUnit(source, unit.next, false, false, declarations), ShellSyntaxError);
});

for (const source of ["first &", "first & # comment", 'printf "$(first &', "cat <<EOF &\n$!\n"]) test(`streamed unit waits for completion: ${JSON.stringify(source)}`, () => {
  assert.equal(parser.parseShellInputUnit(source, false, declarations), undefined);
});

test("independent units do not retain opt-in declarations implicitly", () => {
  const source = "first &\nprintf $!\n";
  const first = parser.parseShellUnit(source, 0, false, false, declarations);
  assert.throws(() => parser.parseShellUnit(source, first.next), ShellSyntaxError);
  assert.throws(() => parser.parseShellInputUnit(source.slice(first.next)), ShellSyntaxError);
});

test("separate quoted and unquoted heredocs retain the correct captured syntax", () => {
  const source = "cat <<FIRST <<'SECOND' &\n$! $(first &)\nFIRST\n$! $(second &)\nSECOND\n";
  const command = simple(parser.parseShell(source, 0, declarations));
  const first = [...parser.hereDocumentWords(command.redirects[0]!.document!, 2, false, [])];
  assert.ok(first.flatMap(word => word.parts).some(part => part.kind === "variable" && part.specialParameter?.name === "!"));
  const substitution = first.flatMap(word => word.parts).find(part => part.kind === "substitution")!;
  assert.equal(substitution.script.lists[0]!.terminator?.operator, "&");
  const second = [...parser.hereDocumentWords(command.redirects[1]!.document!, 4, false, [])];
  assert.deepEqual(second.flatMap(word => word.parts).map(part => part.kind), ["text"]);
  assert.equal(second[0]!.parts[0]!.kind === "text" && second[0]!.parts[0]!.value, "$! $(second &)\n");
});

test("an explicit empty heredoc profile overrides the captured opt-in profile", () => {
  const document = simple(parser.parseShell("cat <<EOF\n$!\nEOF\n", 0, declarations)).redirects[0]!.document!;
  assert.throws(() => [...parser.hereDocumentWords(document, 2, false, [], {})], parser.HereDocumentSyntaxError);
  assert.ok([...parser.hereDocumentWords(document, 2, false, [])].length > 0);
});

for (const source of ['printf "$(first &)"', 'printf "`first &`"']) test(`nested terminator opt-in does not require special parameters: ${source}`, () => {
  const syntax = { listTerminators: declarations.listTerminators };
  assert.doesNotThrow(() => parser.parseShell(source, 0, syntax));
  assert.throws(() => parser.parseShell(source, 0, { specialParameters: declarations.specialParameters }), ShellSyntaxError);
});

for (const source of ['printf "$(printf $!)"', 'printf "`printf $!`"']) test(`nested special parameter opt-in does not activate terminators: ${source}`, () => {
  const syntax = { specialParameters: declarations.specialParameters };
  assert.doesNotThrow(() => parser.parseShell(source, 0, syntax));
  assert.throws(() => parser.parseShell(source, 0, { listTerminators: declarations.listTerminators }), ShellSyntaxError);
});

test("asynchronous heredoc input-unit boundary includes document bytes but not the next command", () => {
  const source = "cat <<EOF &\n$!\nEOF\nprintf $!\n";
  const unit = parser.parseShellUnit(source, 0, false, false, declarations);
  assert.equal(unit.next, source.indexOf("printf"));
  assert.deepEqual(parser.parseShellInputUnit(source, false, declarations), unit);
  assert.equal(simple(unit.script).redirects[0]!.document!.body, "$!\n");
  assert.equal(unit.script.lists[0]!.terminator?.operator, "&");
  const second = parser.parseShellUnit(source, unit.next, false, false, declarations);
  assert.equal(simple(second.script).line, 4);
  assert.equal(simple(second.script).words[1]!.parts[0]!.kind, "variable");
});
