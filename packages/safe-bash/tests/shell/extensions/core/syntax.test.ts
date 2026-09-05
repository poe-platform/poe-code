import assert from "node:assert/strict";
import test from "node:test";
import * as parser from "../../../../src/shell/parser.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { ShellSyntaxError } from "../../../../src/shell/types.js";

const declarations = {
  listTerminators: [{ operator: "&" }],
  specialParameters: [{ name: "!" }],
} as const;

function simple(script: parser.Script, list = 0, pipeline = 0, command = 0) {
  const selected = script.lists[list]!.pipelines[pipeline]!.commands[command]!;
  assert.equal(selected.kind, "simple");
  if (selected.kind !== "simple") throw new Error("expected simple command");
  return selected;
}

test("default parsing still refuses asynchronous syntax and special parameters", () => {
  for (const source of ["first & second", "printf $!", "printf ${!}"]) {
    assert.throws(() => parser.parseShell(source), ShellSyntaxError);
  }
  assert.throws(() => parser.parseShell("first & second"), { reason: "Unsupported operator &", offset: 6 });
});

test("declarations are captured deeply and do not retain mutable caller entries", () => {
  const input = { listTerminators: [{ operator: "&" }], specialParameters: [{ name: "!" }] };
  const captured = parser.captureShellSyntax(input);
  input.listTerminators[0]!.operator = ";";
  input.specialParameters[0]!.name = "?";
  input.listTerminators.length = 0;
  assert.deepEqual(captured, declarations);
  for (const value of [captured, captured.listTerminators, captured.specialParameters,
    captured.listTerminators[0], captured.specialParameters[0]]) assert.equal(Object.isFrozen(value), true);
  assert.equal(parser.captureShellSyntax(captured), captured);
  assert.equal(parser.parseShell("first &", 0, captured).lists[0]!.terminator?.operator, "&");
});

for (const invalid of [
  null, false, [], { unknown: [] }, { listTerminators: "&" }, { specialParameters: "!" },
  { listTerminators: [undefined] }, { specialParameters: new Array(1) },
  { listTerminators: [{ operator: "&" }, { operator: "&" }] },
  { specialParameters: [{ name: "!" }, { name: "!" }] },
  { listTerminators: [{ operator: ";" }] }, { listTerminators: [{ operator: "&&" }] },
  { listTerminators: [{ operator: "|" }] }, { listTerminators: [{ operator: "&>" }] },
  { listTerminators: [{ operator: "" }] }, { listTerminators: [{ operator: "custom" }] },
  { specialParameters: [{ name: "?" }] }, { specialParameters: [{ name: "1" }] },
  { specialParameters: [{ name: "name" }] }, { specialParameters: [{ name: "" }] },
  { specialParameters: [{ name: "!", execute() {} }] },
  { listTerminators: [{ operator: "&", execute() {} }] },
]) {
  test(`invalid or reserved syntax declarations are refused: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => parser.captureShellSyntax(invalid as never), TypeError);
    assert.throws(() => parser.parseShell("true", 0, invalid as never), TypeError);
  });
}

test("capture refuses accessor declarations without invoking handlers or getters", () => {
  let calls = 0;
  const input = { get listTerminators() { calls++; return [{ operator: "&" }]; } };
  assert.throws(() => parser.captureShellSyntax(input), TypeError);
  assert.equal(calls, 0);
  const parameter = { get name() { calls++; return "!"; } };
  assert.throws(() => parser.captureShellSyntax({ specialParameters: [parameter] }), TypeError);
  assert.equal(calls, 0);
});

test("the terminator belongs to the complete AND/OR list, not a pipeline or command", () => {
  const source = "first | second && third || fourth & fifth";
  const script = parser.parseShell(source, 0, declarations);
  assert.equal(script.lists.length, 2);
  assert.deepEqual(script.lists[0]!.operators, ["&&", "||"]);
  assert.deepEqual(script.lists[0]!.terminator, { operator: "&", offset: source.indexOf("& fifth"), line: 1 });
  assert.equal(Object.isFrozen(script.lists[0]!.terminator), true);
  assert.equal(script.lists[1]!.terminator, undefined);
  for (const pipeline of script.lists[0]!.pipelines) {
    assert.equal(Object.hasOwn(pipeline, "terminator"), false);
    for (const command of pipeline.commands) assert.equal(Object.hasOwn(command, "terminator"), false);
  }
});

test("terminator declarations and parameter declarations enable only their own grammar slots", () => {
  assert.throws(() => parser.parseShell("printf $!", 0, { listTerminators: declarations.listTerminators }), ShellSyntaxError);
  assert.throws(() => parser.parseShell("first &", 0, { specialParameters: declarations.specialParameters }), ShellSyntaxError);
  for (const source of ["&", "first &; second", "first && &", "first & & second", "first &>> target"]) {
    assert.throws(() => parser.parseShell(source, 0, declarations), ShellSyntaxError);
  }
});

test("opt-in special parameters use variable lookup metadata with quote, length and alternate information", () => {
  const command = simple(parser.parseShell('printf $! "${!}" "${#!}" "${!:-fallback}"', 0, declarations));
  for (const [index, word] of command.words.slice(1).entries()) {
    const part = word.parts.find(part => part.kind === "variable")!;
    assert.equal(part.kind, "variable");
    if (part.kind !== "variable") throw new Error("expected variable");
    assert.equal(part.name, "!");
    assert.deepEqual(part.specialParameter, { name: "!" });
    assert.equal(Object.isFrozen(part.specialParameter), true);
    assert.equal(part.quoted, index !== 0);
    assert.equal(part.line, 1);
    if (index === 2) assert.equal(part.length, true);
    if (index === 3) { assert.equal(part.operator, ":-"); assert.equal(part.alternate?.parts[0]?.kind, "text"); }
  }
  assert.throws(() => parser.parseShell("printf ${!name}", 0, declarations), ShellSyntaxError);
});

test("literal ampersands and exclamation marks do not acquire execution or lookup metadata", () => {
  const source = "printf '&' \\& '$!' \\$! '!' !";
  assert.deepEqual(parser.parseShell(source, 0, declarations), parser.parseShell(source));
});

for (const source of ['printf "$(first & second $!)"', 'printf "`first & second $!`"']) {
  test(`captured syntax reaches nested substitutions: ${source}`, () => {
    const substitution = simple(parser.parseShell(source, 0, declarations)).words[1]!.parts.find(part => part.kind === "substitution")!;
    assert.equal(substitution.kind, "substitution");
    if (substitution.kind !== "substitution") throw new Error("expected substitution");
    assert.equal(substitution.script.lists[0]!.terminator?.operator, "&");
    const parameter = simple(substitution.script, 1).words[1]!.parts[0]!;
    assert.equal(parameter.kind, "variable");
    if (parameter.kind === "variable") assert.deepEqual(parameter.specialParameter, { name: "!" });
  });
}

test("input unit boundaries, source line metadata and trailing asynchronous lists are preserved", () => {
  const source = "first &\nsecond $!\n";
  const first = parser.parseShellUnit(source, 0, false, false, declarations);
  assert.equal(first.next, 8);
  assert.deepEqual(first.script.lists[0]!.terminator, { operator: "&", offset: 6, line: 1 });
  const second = parser.parseShellUnit(source, first.next, false, false, declarations);
  assert.equal(simple(second.script).line, 2);
  assert.equal(parser.parseShellInputUnit("first &", false, declarations), undefined);
  assert.deepEqual(parser.parseShellInputUnit("first &\n", false, declarations)?.script, first.script);
  assert.equal(parser.parseShell("first &", 0, declarations).lists.length, 1);
});

test("deferred here-document parsing retains captured syntax after caller mutation", () => {
  const input = { listTerminators: [{ operator: "&" }], specialParameters: [{ name: "!" }] };
  const script = parser.parseShell("cat <<EOF &\n$! $(first & second)\nEOF\n", 0, input);
  const document = simple(script).redirects[0]!.document!;
  input.listTerminators.length = 0;
  input.specialParameters.length = 0;
  const words = [...parser.hereDocumentWords(document, document.endLine, false, [])];
  const parts = words.flatMap(word => word.parts);
  assert.equal(parts[0]!.kind, "variable");
  const substitution = parts.find(part => part.kind === "substitution");
  assert.equal(substitution?.script.lists[0]!.terminator?.operator, "&");
  assert.equal(script.lists[0]!.terminator?.operator, "&");
});

test("explicit here-document syntax is captured when its iterator is created", () => {
  const document = simple(parser.parseShell("cat <<EOF\n$!\nEOF\n")).redirects[0]!.document!;
  const input = { specialParameters: [{ name: "!" }] };
  const words = parser.hereDocumentWords(document, 2, false, [], input);
  input.specialParameters.length = 0;
  assert.equal([...words][0]!.parts[0]!.kind, "variable");
});

test("quoted here-documents remain literal even with captured syntax", () => {
  const source = "cat <<'EOF'\n$! $(first &)\nEOF\n";
  const document = simple(parser.parseShell(source, 0, declarations)).redirects[0]!.document!;
  assert.deepEqual([...parser.hereDocumentWords(document, 2, false, [])], [
    { offset: document.offset, parts: [{ kind: "text", value: "$! $(first &)\n", quoted: true }] },
  ]);
});

test("byte-source words and printed metadata survive syntax opt-in unchanged", () => {
  const source = 'printf "\xff"\nsecond';
  const baseline = parser.parseShellUnit(source, 0, true, true);
  assert.deepEqual(parser.parseShellUnit(source, 0, true, true, declarations), baseline);
  const selected = parser.parseShellUnit('printf "\xff" &\n', 0, true, true, declarations).script;
  const part = simple(selected).words[1]!.parts.find(part => part.kind === "text" && part.byteValue)!;
  assert.equal(part.kind, "text");
  if (part.kind !== "text" || !part.byteValue) throw new Error("expected byte-valued literal");
  assert.deepEqual(shellValueBytes(part.byteValue), Uint8Array.of(255));
  assert.equal(selected.printedNewlines, baseline.script.printedNewlines);
  assert.equal(selected.printedLines?.get(simple(selected)), baseline.script.printedLines?.get(simple(baseline.script)));
});

test("non-declaration objects and inherited declarations are not silently admitted", () => {
  for (const input of [new Date(0), Object.create({ listTerminators: [{ operator: "&" }] })]) {
    assert.throws(() => parser.captureShellSyntax(input), TypeError);
  }
  const input = Object.assign(Object.create(null) as parser.ShellSyntaxDeclarations, declarations);
  assert.deepEqual(parser.captureShellSyntax(input), declarations);
});

test("explicit syntax validation applies before all parse entrypoints and lazy document iteration", () => {
  const document = simple(parser.parseShell("cat <<EOF\ntext\nEOF\n")).redirects[0]!.document!;
  for (const invalid of [{ specialParameters: [{ name: "?" }] }, null]) {
    assert.throws(() => parser.parseShellUnit("", 0, false, false, invalid as never), TypeError);
    assert.throws(() => parser.parseShellInputUnit("", false, invalid as never), TypeError);
    assert.throws(() => parser.hereDocumentWords(document, 2, false, [], invalid as never), TypeError);
  }
});

test("nested syntax preserves source lines and malformed-source diagnostics", () => {
  const source = 'printf "$(\nfirst &\nsecond $!\n)"';
  const command = simple(parser.parseShell(source, 0, declarations));
  const substitution = command.words[1]!.parts.find(part => part.kind === "substitution")!;
  assert.equal(substitution.kind, "substitution");
  if (substitution.kind !== "substitution") throw new Error("expected substitution");
  assert.equal(substitution.script.lists[0]!.terminator?.line, 2);
  const part = simple(substitution.script, 1).words[1]!.parts[0]!;
  assert.equal(part.kind, "variable");
  if (part.kind === "variable") assert.equal(part.line, 3);
  for (const malformed of ['printf "$(\nfirst | )"', 'printf "unterminated', "first &&\n"]) {
    let expected: unknown;
    try { parser.parseShell(malformed); } catch (error) { expected = error; }
    assert.ok(expected instanceof ShellSyntaxError);
    assert.throws(() => parser.parseShell(malformed, 0, declarations), error => {
      assert.ok(error instanceof ShellSyntaxError);
      assert.equal(error.reason, expected.reason);
      assert.equal(error.offset, expected.offset);
      assert.equal(error.exitCode, expected.exitCode);
      return true;
    });
  }
  assert.equal(parser.parseShellInputUnit('printf "$(first &', false, declarations), undefined);
});

for (const source of [
  "{ first && second & third; }",
  "(first | second & third)",
  "if first; then second & third; fi",
  "while first; do second & third; done",
  "for value in first second; do third & fourth; done",
  "case value in first) second & third;; esac",
  "function_name() { first & second; }",
]) {
  test(`captured terminators reach compound grammar: ${source}`, () => {
    assert.throws(() => parser.parseShell(source), ShellSyntaxError);
    const script = parser.parseShell(source, 0, declarations);
    assert.match(JSON.stringify(script), /"terminator":\{"operator":"&"/u);
  });
}
