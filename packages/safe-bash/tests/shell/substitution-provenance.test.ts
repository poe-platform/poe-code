import assert from "node:assert/strict";
import { test } from "node:test";
import { shellValueBytes } from "../../src/contracts/value.js";
import { HereDocumentSyntaxError, hereDocumentWords, parseShell, parseShellUnit } from "../../src/shell/parser.js";
import type { Script, Word, WordPart } from "../../src/shell/parser.js";
import { ShellSyntaxError } from "../../src/shell/types.js";

function simpleCommand(script: Script, listIndex = 0, pipelineIndex = 0) {
  const command = script.lists[listIndex]?.pipelines[pipelineIndex]?.commands[0];
  assert.ok(command?.kind === "simple");
  return command;
}

function substitution(word: Word) {
  const parts = word.parts.filter(part => part.kind === "substitution");
  assert.equal(parts.length, 1);
  return parts[0]!;
}

for (const { source, form, quoted } of [
  { source: "printf $(printf value)", form: "dollar-parenthesis", quoted: false },
  { source: 'printf "$(printf value)"', form: "dollar-parenthesis", quoted: true },
  { source: "printf `printf value`", form: "backtick", quoted: false },
  { source: 'printf "`printf value`"', form: "backtick", quoted: true },
] as const) {
  test(`substitution provenance: ${form}, quoted=${quoted}`, () => {
    const word = simpleCommand(parseShell(source)).words[1]!;
    assert.deepEqual(substitution(word), {
      kind: "substitution", form, script: parseShell("printf value"), line: 1,
      ...(form === "dollar-parenthesis" ? { sourceLine: 1 } : {}), quoted,
    });
    assert.equal(word.offset, 7);
    assert.equal(word.spelling, source.slice(7));
    assert.equal(word.printedNewlines, 0);
  });
}

test("nested substitutions retain each syntax form independently", () => {
  const command = simpleCommand(parseShell('printf "$(printf `printf inner`)" `printf "$(printf inner)"`'));
  const dollar = substitution(command.words[1]!);
  const backtick = substitution(command.words[2]!);
  assert.equal(dollar.form, "dollar-parenthesis");
  assert.equal(dollar.quoted, true);
  assert.equal(backtick.form, "backtick");
  assert.equal(backtick.quoted, false);
  const innerBacktick = substitution(simpleCommand(dollar.script).words[1]!);
  const innerDollar = substitution(simpleCommand(backtick.script).words[1]!);
  assert.equal(innerBacktick.form, "backtick");
  assert.equal(innerBacktick.quoted, false);
  assert.equal(innerDollar.form, "dollar-parenthesis");
  assert.equal(innerDollar.quoted, true);
});

test("parameter alternates retain substitution forms without evaluating their branches", () => {
  const command = simpleCommand(parseShell('printf "${present:-$(printf skipped)}" "${absent:+`printf skipped`}"'));
  for (const [index, name, operator, form] of [
    [1, "present", ":-", "dollar-parenthesis"],
    [2, "absent", ":+", "backtick"],
  ] as const) {
    const part = command.words[index]!.parts.find(part => part.kind === "variable");
    assert.ok(part);
    assert.equal(part.name, name);
    assert.equal(part.operator, operator);
    assert.ok(part.alternate);
    const alternate = substitution(part.alternate);
    assert.equal(alternate.form, form);
    assert.equal(alternate.quoted, true);
    assert.equal(simpleCommand(alternate.script).words[1]!.plain, "skipped");
  }
});

test("short-circuited lists keep substitution provenance in their unevaluated AST", () => {
  const script = parseShell('false && printf "$(printf skipped)"; true || printf "`printf skipped`"');
  assert.deepEqual(script.lists.map(list => list.operators), [["&&"], ["||"]]);
  assert.equal(substitution(simpleCommand(script, 0, 1).words[1]!).form, "dollar-parenthesis");
  assert.equal(substitution(simpleCommand(script, 1, 1).words[1]!).form, "backtick");
});

test("syntax provenance does not replace multiline diagnostic locations", () => {
  for (const [source, form, printedNewlines] of [
    ['printf "$(\n  printf value\n)"', "dollar-parenthesis", 0],
    ['printf "`\n  printf value\n`"', "backtick", 2],
  ] as const) {
    const word = simpleCommand(parseShell(source)).words[1]!;
    const part = substitution(word);
    assert.equal(part.form, form);
    assert.equal(part.line, 1);
    assert.equal(part.script.line, 2);
    assert.equal(simpleCommand(part.script).line, 2);
    assert.equal(part.sourceLine, form === "dollar-parenthesis" ? 2 : undefined);
    assert.equal(Object.hasOwn(part, "sourceLine"), form === "dollar-parenthesis");
    assert.equal(word.printedNewlines, printedNewlines);
    assert.equal(word.spelling, source.slice(7));
  }
});

test("empty substitutions and file shortcuts retain syntax rather than execution provenance", () => {
  const command = simpleCommand(parseShell("printf $() `` $(<file)"));
  const emptyDollar = substitution(command.words[1]!);
  const emptyBacktick = substitution(command.words[2]!);
  const shortcut = substitution(command.words[3]!);
  assert.equal(emptyDollar.form, "dollar-parenthesis");
  assert.equal(emptyBacktick.form, "backtick");
  assert.equal(shortcut.form, "dollar-parenthesis");
  assert.deepEqual(emptyDollar.script.lists, []);
  assert.deepEqual(emptyBacktick.script.lists, []);
  const redirect = simpleCommand(shortcut.script);
  assert.deepEqual(redirect.words, []);
  assert.equal(redirect.redirects[0]!.operator, "<");
  assert.equal(redirect.redirects[0]!.target.plain, "file");
});

test("quoted and escaped substitution spellings remain literal text", () => {
  const command = simpleCommand(parseShell("printf '$(printf value)' '`printf value`' \\$\\(literal\\) \\`literal\\`"));
  assert.ok(command.words.every(word => word.parts.every(part => part.kind === "text" && !Object.hasOwn(part, "form"))));
});

test("both substitution forms preserve raw source bytes separately from Unicode text", () => {
  const source = "printf $(printf '\xff') `printf '\xff'`";
  for (const byteSource of [true, false]) {
    const command = simpleCommand(parseShellUnit(source, 0, false, byteSource).script);
    for (const [index, form] of [[1, "dollar-parenthesis"], [2, "backtick"]] as const) {
      const part = substitution(command.words[index]!);
      assert.equal(part.form, form);
      const text = simpleCommand(part.script).words[1]!.parts[0]!;
      assert.ok(text.kind === "text");
      assert.equal(text.value, byteSource ? "\ufffd" : "\xff");
      assert.equal(Object.hasOwn(text, "byteValue"), byteSource);
      assert.deepEqual(shellValueBytes(text.byteValue ?? text.value), Uint8Array.from(byteSource ? [255] : [195, 191]));
    }
  }
});

test("here-document word parsing adds forms without changing quoted locations", () => {
  const document = simpleCommand(parseShell("cat <<EOF\n$(printf value) `printf value`\nEOF\n")).redirects[0]!.document!;
  const words = [...hereDocumentWords(document, 2, false, [])];
  for (const [index, form] of [[0, "dollar-parenthesis"], [2, "backtick"]] as const) {
    const part = substitution(words[index]!);
    assert.equal(part.form, form);
    assert.equal(part.quoted, true);
    assert.equal(part.line, 2);
    assert.equal(part.script.line, 2);
    assert.equal(part.sourceLine, form === "dollar-parenthesis" ? 2 : undefined);
  }
});

test("substitution syntax failures preserve established exact diagnostics", () => {
  for (const [source, reason, offset, exitCode] of [
    ["printf $(;)", "Expected command", 9, 127],
    ["printf `;`", "Expected command", 0, 2],
    ["printf $(", "Unterminated command substitution", 8, 2],
    ["printf `", "Unterminated command substitution", 8, 2],
  ] as const) {
    assert.throws(() => parseShell(source), error => {
      assert.ok(error instanceof ShellSyntaxError);
      assert.equal(error.message, `${reason} at offset ${offset}`);
      assert.equal(error.reason, reason);
      assert.equal(error.offset, offset);
      assert.equal(error.exitCode, exitCode);
      return true;
    });
  }
});

test("here-document substitution failures retain their distinct diagnostic representations", () => {
  const dollarDocument = simpleCommand(parseShell("cat <<EOF\n$(;)\nEOF\n")).redirects[0]!.document!;
  assert.throws(() => [...hereDocumentWords(dollarDocument, 2, false, [])], error => {
    assert.ok(error instanceof HereDocumentSyntaxError);
    assert.equal(error.diagnostic, "shell: command substitution: line 3: syntax error near unexpected token `;'\nshell: command substitution: line 3: `;)'\n");
    return true;
  });
  const backtickDocument = simpleCommand(parseShell("cat <<EOF\n`;`\nEOF\n")).redirects[0]!.document!;
  assert.deepEqual([...hereDocumentWords(backtickDocument, 2, false, [])][0]!.parts, [{
    kind: "failed-substitution", quoted: true,
    diagnostic: "shell: command substitution: line 3: syntax error near unexpected token `;'\nshell: command substitution: line 3: `;'\n",
  }]);
});

test("manual substitution ASTs may omit form without implying either syntax", () => {
  const part: WordPart = { kind: "substitution", script: parseShell(":"), line: 1, quoted: false };
  const form: "backtick" | "dollar-parenthesis" | undefined = part.form;
  assert.equal(form, undefined);
  assert.equal(Object.hasOwn(part, "form"), false);
});
