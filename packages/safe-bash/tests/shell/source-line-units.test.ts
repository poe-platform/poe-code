import assert from "node:assert/strict";
import { test } from "node:test";
import { parseShellUnit } from "../../src/shell/parser.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { SourceLineIndex } from "../../src/shell/source-line-index.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { setup } from "./helpers.js";

async function observeNewlines(source: string, action: () => void | Promise<void>): Promise<number> {
  const indexOf = String.prototype.indexOf;
  const charCodeAt = String.prototype.charCodeAt;
  let matches = 0;
  String.prototype.indexOf = function (search, position) {
    const result = indexOf.call(this, search, position);
    if (String(this) === source && search === "\n" && result !== -1) matches++;
    return result;
  };
  String.prototype.charCodeAt = function (position) {
    const result = charCodeAt.call(this, position);
    if (String(this) === source && result === 10) matches++;
    return result;
  };
  try { await action(); return matches; }
  finally { String.prototype.indexOf = indexOf; String.prototype.charCodeAt = charCodeAt; }
}

test("#614 exhausted parse allowance does not index an unread suffix", async () => {
  const source = "x\n".repeat(12);
  const matches = await observeNewlines(source, () => {
    assert.throws(() => parseShellUnit(source, 0, false, new ParseBudget(2)), error => error instanceof ShellLimitError && error.limit === "maxParseUnits");
  });
  assert.equal(matches, 0);
});

test("#614 execution units share one lazy source index", async context => {
  const source = "pass <<E\n".repeat(4) + "E\n".repeat(4);
  const { shell, commands } = setup();
  context.after(() => shell.dispose());
  let completed = 0;
  commands.register({ name: "E", execute() { completed++; return { exitCode: 0 }; } });
  const matches = await observeNewlines(source, async () => {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "pass <<E\n".repeat(3));
  });
  assert.equal(completed, 3);
  assert.ok(matches > 0 && matches <= 8, `indexed ${matches} newlines for an eight-newline source`);
});

test("#614 successive units retain locale changes and earlier effects", async context => {
  const { shell, fs } = setup();
  context.after(() => shell.dispose());
  const locale = await shell.exec("LC_ALL=C\nargs $'\\u00e9'\nLC_ALL=C.UTF-8\nargs $'\\u00e9'");
  assert.equal(locale.exitCode, 0);
  assert.equal(locale.stdout, '["\\\\u00E9"]["é"]');
  const result = await shell.exec(": >before\nvalue=$(true |); : >after");
  assert.equal(result.exitCode, 127);
  assert.equal(result.stderr, "shell: -c: line 2: syntax error near unexpected token `)'\nshell: -c: line 2: `value=$(true |); : >after'\n");
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["before"]);
});

for (const invocation of ['eval "$program"', 'sh -c "$program"', ". /program", "sh /program"]) {
  test(`#614 ${invocation} reuses the source index across units`, async context => {
    const program = "say first\nsay second\n";
    const { shell, fs } = setup({ env: { program } });
    context.after(() => shell.dispose());
    await fs.writeFile("/program", new TextEncoder().encode(program));
    const matches = await observeNewlines(program, async () => {
      const result = await shell.exec(invocation);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "first\nsecond\n");
    });
    assert.ok(matches > 0 && matches <= 2, `indexed ${matches} newlines for a two-newline source`);
  });
}

test("#614 streamed incomplete units keep their index while input grows", async context => {
  const { shell } = setup();
  context.after(() => shell.dispose());
  async function* input(): AsyncGenerator<Uint8Array> {
    for (const line of ["pass <<END\n", "one\n", "two\n", "END\n", "say last\n"]) yield new TextEncoder().encode(line);
  }
  const result = await shell.exec("sh", { stdin: input() });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "one\ntwo\nlast\n");
});

test("#614 lazy line lookup charges storage before publishing an index entry", () => {
  const index = new SourceLineIndex("\n", new ParseBudget(1));
  const push = Array.prototype.push;
  let entries = 0;
  let failure: unknown;
  Array.prototype.push = function (...values) {
    if (values.length === 1 && values[0] === 0) entries++;
    return push.apply(this, values);
  };
  try { index.lineAt(1); }
  catch (error) { failure = error; }
  finally { Array.prototype.push = push; }
  assert.ok(failure instanceof ShellLimitError && failure.limit === "maxParseUnits");
  assert.equal(entries, 0);
});

test("#614 scan work is admitted in bounded blocks before character reads", () => {
  const source = "x".repeat(1025);
  const index = new SourceLineIndex(source, new ParseBudget(1));
  const charCodeAt = String.prototype.charCodeAt;
  let reads = 0;
  String.prototype.charCodeAt = function (position) {
    if (String(this) === source) reads++;
    return charCodeAt.call(this, position);
  };
  try { assert.throws(() => index.lineAt(source.length), error => error instanceof ShellLimitError && error.limit === "maxParseUnits"); }
  finally { String.prototype.charCodeAt = charCodeAt; }
  assert.equal(reads, 1024);
});

test("#614 cached lines and appended text preserve exact newline boundaries", () => {
  const budget = new ParseBudget(4);
  const index = new SourceLineIndex("a\nb\n", budget);
  assert.deepEqual([0, 1, 2, 3, 4].map(position => index.lineAt(position)), [1, 1, 2, 2, 3]);
  assert.deepEqual([4, 2, 0].map(position => index.lineAt(position)), [3, 2, 1]);
  index.append("c\n");
  assert.equal(index.lineAt(6), 4);
  assert.throws(() => budget.admit(), error => error instanceof ShellLimitError && error.limit === "maxParseUnits");
});

test("#614 a supplied source index cannot cross source or budget ownership", () => {
  const budget = new ParseBudget();
  const index = new SourceLineIndex(":", budget);
  assert.throws(() => parseShellUnit("true", 0, false, budget, index), TypeError);
  assert.throws(() => parseShellUnit(":", 0, false, new ParseBudget(), index), TypeError);
});

for (const reason of [0, false, "", null]) {
  test(`#614 cancellation during a newline scan preserves ${JSON.stringify(reason)}`, () => {
    const controller = new AbortController();
    const source = "\n\n\n";
    const index = new SourceLineIndex(source, new ParseBudget(32, controller.signal));
    const charCodeAt = String.prototype.charCodeAt;
    let reads = 0;
    String.prototype.charCodeAt = function (position) {
      if (String(this) === source) { reads++; controller.abort(reason); }
      return charCodeAt.call(this, position);
    };
    try { assert.throws(() => index.lineAt(source.length), error => error === reason); }
    finally { String.prototype.charCodeAt = charCodeAt; }
    assert.equal(reads, 1);
    assert.throws(() => index.lineAt(0), error => error === reason);
  });
}
