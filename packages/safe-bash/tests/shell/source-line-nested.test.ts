import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShellUnit } from "../../src/shell/parser.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { ShellSyntaxError } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

for (const count of [2, 4, 8]) {
  test(`#615 ${count} sibling substitutions share their physical source index`, () => {
    const source = "echo " + "$( :\n)".repeat(count) + " |)";
    const sources = new Set([source]);
    for (let index = 0; index < count; index++) sources.add(source.slice(7 + index * 6));
    const indexOf = String.prototype.indexOf;
    const charCodeAt = String.prototype.charCodeAt;
    let matches = 0;
    String.prototype.indexOf = function (search, position) {
      const result = indexOf.call(this, search, position);
      if (sources.has(String(this)) && search === "\n" && result !== -1) matches++;
      return result;
    };
    String.prototype.charCodeAt = function (position) {
      const result = charCodeAt.call(this, position);
      if (sources.has(String(this)) && result === 10) matches++;
      return result;
    };
    try { assert.throws(() => parseShellUnit(source), ShellSyntaxError); }
    finally { String.prototype.indexOf = indexOf; String.prototype.charCodeAt = charCodeAt; }
    assert.equal(matches, count);
  });
}

test("#615 nested and transformed sources retain output and deferred heredoc behavior", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  for (const [source, stdout] of [
    ['say "$(say "$(say inner)"\n)"', "inner\n"],
    ['say `say one\nsay two`', "one two\n"],
    ["pass <<'END'\n$(say literal)\nEND\n", "$(say literal)\n"],
    ["pass <<-END\n\t$(say expanded)\n\tEND\n", "expanded\n"],
    ["false && pass <<END\n$(true |)\nEND\nsay survived\n", "survived\n"],
  ]) {
    const result = await shell.exec(source!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
  }
});

test("#615 nested source views preserve local error offset remapping", () => {
  const source = "say $(say $(true |))";
  assert.throws(() => parseShellUnit(source), error => {
    assert.ok(error instanceof ShellSyntaxError);
    assert.equal(error.offset, source.indexOf(")"));
    assert.equal(error.exitCode, 127);
    return true;
  });
});

test("#615 nested source views retain physical lines and printed diagnostic remapping", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  const source = "say before\nsay $(\nmissing\n)\n";
  const first = parseShellUnit(source);
  const second = parseShellUnit(source, first.next);
  const command = second.script.lists[0]?.pipelines[0]?.commands[0];
  assert.ok(command?.kind === "simple");
  const substitution = command.words[1]?.parts[0];
  assert.ok(substitution?.kind === "substitution");
  assert.equal(substitution.line, 2);
  assert.equal(substitution.sourceLine, 3);
  assert.equal(substitution.script.line, 3);
  const result = await shell.exec(source);
  assert.equal(result.stdout, "before\n\n");
  assert.equal(result.stderr, "shell: line 2: missing: command not found\n");
});

for (const reason of [0, false, "", null]) {
  test(`#615 nested index scans observe cancellation ${JSON.stringify(reason)}`, () => {
    const source = "say $( :\n)$( :\n)";
    const controller = new AbortController();
    const budget = new ParseBudget(128, controller.signal);
    const charCodeAt = String.prototype.charCodeAt;
    let matches = 0;
    String.prototype.charCodeAt = function (position) {
      const result = charCodeAt.call(this, position);
      if (String(this) === source && result === 10) { matches++; controller.abort(reason); }
      return result;
    };
    try { assert.throws(() => parseShellUnit(source, 0, false, budget), error => error === reason); }
    finally { String.prototype.charCodeAt = charCodeAt; }
    assert.equal(matches, 1);
  });
}
