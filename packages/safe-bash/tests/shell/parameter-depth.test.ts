import assert from "node:assert/strict";
import { test } from "node:test";
import { hereDocumentWords, parseShell, parseShellInputUnit, parseShellUnit } from "../../src/shell/parser.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellLimitError, ShellSyntaxError } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

function depthFailure(error: unknown): boolean {
  assert.ok(error instanceof ShellSyntaxError);
  assert.equal(error.reason, "Syntax nesting exceeds 64");
  assert.equal(error.exitCode, 2);
  assert.ok(error.offset >= 0);
  return true;
}

for (const source of [
  "echo ${a:-${b:-x}}",
  'echo "${a:-${b:-x}}"',
  "echo ${a-${b-x}}",
  "echo ${a:=${b:-x}}",
  "echo ${a:+${b:-x}}",
  "echo ${a:?${b:-x}}",
  "echo ${a#${b:-x}}",
  "echo ${a##${b:-x}}",
  "echo ${a%${b:-x}}",
  "echo ${a%%${b:-x}}",
  "echo ${a/${b:-x}/y}",
  "echo ${a/x/${b:-y}}",
  "echo ${a//x/${b:-y}}",
  "echo ${a/#x/${b:-y}}",
  "echo ${a/%x/${b:-y}}",
  "echo ${a:${b:-0}:1}",
  "echo ${a:0:${b:-1}}",
]) {
  test(`parameter operand depth is inclusive and inherited: ${source}`, () => {
    assert.doesNotThrow(() => parseShell(source, 62));
    assert.throws(() => parseShell(source, 63), depthFailure);
  });
}

test("parameter sibling operands release depth without charging plain words", () => {
  assert.doesNotThrow(() => parseShell("echo ${a:-x}${b:-y} ${c:-z} ${a/x/y} ${a:0:1}", 63));
  assert.doesNotThrow(() => parseShell("echo ${a/${b:-x}/${c:-y}} ${a:${b:-0}:${c:-1}}", 62));
  assert.doesNotThrow(() => parseShell("echo $a ${a} '$a' $((1 + 2))", 63));
});

for (const source of [
  "echo ${a:-$(echo x)}",
  "echo ${a:-`echo x`}",
]) {
  test(`command substitution inherits active operand depth: ${source}`, () => {
    assert.doesNotThrow(() => parseShell(source, 61));
    assert.throws(() => parseShell(source, 62), depthFailure);
  });
}

for (const source of [
  "echo $(echo ${a:-${b:-x}})",
  "echo `echo ${a:-${b:-x}}`",
]) {
  test(`parameter operands inherit command substitution depth: ${source}`, () => {
    assert.doesNotThrow(() => parseShell(source, 61));
    assert.throws(() => parseShell(source, 62), depthFailure);
  });
}

test("a completed operand does not add depth to a sibling command substitution", () => {
  assert.doesNotThrow(() => parseShell("echo ${a:-x}$(echo y)`echo z`", 62));
});

test("here-document operand depth retains syntax classification and quoted literals", () => {
  const document = { delimiter: "END", quoted: false, stripTabs: false, offset: 0, body: "${a:-${b:-x}}", endLine: 1, depth: 62 };
  assert.doesNotThrow(() => [...hereDocumentWords(document, 1, false, [])]);
  assert.throws(() => [...hereDocumentWords({ ...document, depth: 63 }, 1, false, [])], depthFailure);
  assert.doesNotThrow(() => [...hereDocumentWords({ ...document, quoted: true, depth: 64 }, 1, false, [])]);
  const siblings = hereDocumentWords({ ...document, body: "${a:-x}${b:-y}", depth: 63 }, 1, false, []);
  assert.equal(siblings.next().done, false);
  assert.equal(siblings.next().done, false);
  assert.equal(siblings.next().done, true);
});

test("here-document command substitutions retain depth errors instead of remapping them", () => {
  for (const body of ["${a:-$(echo x)}", "${a:-`echo x`}"]) {
    const document = { delimiter: "END", quoted: false, stripTabs: false, offset: 0, body, endLine: 1, depth: 61 };
    assert.doesNotThrow(() => [...hereDocumentWords(document, 1, false, [])]);
    assert.throws(() => [...hereDocumentWords({ ...document, depth: 62 }, 1, false, [])], depthFailure);
  }
});

test("depth rejection precedes operand admission and reports the operator offset", () => {
  const document = { delimiter: "END", quoted: false, stripTabs: false, offset: 0, body: "${a:-x}", endLine: 1, depth: 64 };
  const budget = new ParseBudget(3);
  assert.throws(() => [...hereDocumentWords(document, 1, false, [], budget)], error => {
    depthFailure(error);
    assert.equal((error as ShellSyntaxError).offset, 3);
    return true;
  });
  assert.doesNotThrow(() => budget.admit(0));
  assert.throws(() => budget.admit(), ShellLimitError);
});

test("an admitted operand retains its existing structural parse-unit cost", () => {
  const document = { delimiter: "END", quoted: false, stripTabs: false, offset: 0, body: "${a:-x}", endLine: 1, depth: 63 };
  const budget = new ParseBudget(5);
  assert.equal([...hereDocumentWords(document, 1, false, [], budget)].length, 1);
  assert.throws(() => budget.admit(), ShellLimitError);
});

test("parse allowance and cancellation retain precedence and failure identity", () => {
  assert.throws(() => parseShell("echo ${a:-${b:-x}}", 63, { maxParseUnits: 0 }), error => error instanceof ShellLimitError && error.limit === "maxParseUnits");
  const reason = Object.freeze({ cancelled: true });
  const document = { delimiter: "END", quoted: false, stripTabs: false, offset: 0, body: "${a:-${b:-x}}", endLine: 1, depth: 63 };
  const cancelled = new ParseBudget(0, AbortSignal.abort(reason));
  assert.throws(() => [...hereDocumentWords(document, 1, false, [], cancelled)], error => error === reason);
  const failures: ShellLimitError[] = [];
  const exhausted = new ParseBudget(0, undefined, error => { failures.push(error); });
  assert.throws(() => [...hereDocumentWords(document, 1, false, [], exhausted)], ShellLimitError);
  assert.equal(failures.length, 1);
  assert.throws(() => exhausted.admit(0), error => error === failures[0]);
});

test("cancellation between deferred sibling operands retains its original reason", () => {
  const controller = new AbortController();
  const reason = Object.freeze({ cancelled: true });
  const document = { delimiter: "END", quoted: false, stripTabs: false, offset: 0, body: "${a:-x}${b:-y}", endLine: 1, depth: 63 };
  const words = hereDocumentWords(document, 1, false, [], new ParseBudget(64, controller.signal));
  assert.equal(words.next().done, false);
  controller.abort(reason);
  assert.throws(() => words.next(), error => error === reason);
});

test("ordinary parameter syntax preserves legacy and incremental parser entry points", () => {
  const source = 'echo "${a:-${b:-x}}" ${value:1 ? 0 : 1:2} ${value/x/${b:-y}}\n';
  assert.deepEqual(parseShell(source), parseShell(source, 0));
  assert.deepEqual(parseShell(source), parseShell(source, 0, {}));
  assert.deepEqual(parseShellInputUnit(source), parseShellUnit(source));
  assert.equal(parseShellInputUnit("echo ${a:-${b:-x}"), undefined);
  assert.throws(() => parseShell("echo ${a:-${b:-x}"), ShellSyntaxError);
});

test("ordinary execution preserves quoting, replacement, arithmetic and deferred heredocs", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const quoted = await shell.exec('args "${missing:-a\'b\'c}" "${missing:-${other:-\'nested\'}}"');
  assert.equal(quoted.exitCode, 0);
  assert.equal(quoted.stderr, "");
  assert.equal(quoted.stdout, '["a\'b\'c","\'nested\'"]');
  const parameters = await shell.exec('value=abcdef; args "${value:${offset:-1}:${length:-2}}" "${value/b/${replacement:-X}}" "${value:1 ? 0 : 1:2}" "${value:$((1 + 1)):2}"');
  assert.equal(parameters.exitCode, 0);
  assert.equal(parameters.stderr, "");
  assert.equal(parameters.stdout, '["bc","aXcdef","ab","cd"]');
  const document = await shell.exec("pass <<END\n${missing:-${other:-x}}\nEND\n");
  assert.equal(document.exitCode, 0);
  assert.equal(document.stderr, "");
  assert.equal(document.stdout, "x\n");
});
