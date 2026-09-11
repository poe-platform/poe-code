import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/types.js";
import { parseShellUnit } from "../../src/shell/parser.js";
import { ParseBudget } from "../../src/shell/parse-budget.js";
import { setup } from "./helpers.js";

const parseLimit = (error: unknown): boolean => error instanceof ShellLimitError && error.limit === "maxParseUnits";

test("shell execution enforces parse admission before command effects", async () => {
  const { shell } = setup();
  let writes = 0;
  try {
    await assert.rejects(shell.exec(`say ${"w ".repeat(32)}`, {
      limits: { maxParseUnits: 48 }, stdout: { async write() { writes++; } },
    }), parseLimit);
    assert.equal(writes, 0);
    assert.equal((await shell.exec("say ok")).stdout, "ok\n");
  } finally { await shell.dispose(); }
});

for (const source of [
  'eval "$program"', 'sh -c "$program"', "sh /program", ". /program", "sh",
  'let "$expression"', "let expression", 'say "$((expression))"', "((expression))",
  'say "${text:expression}"',
  'say "$(eval \'say $((expression))\')"',
  'pass <<END\n$((expression))\nEND\n',
  'getopts a option; OPTIND="$expression"',
  'set -- "$expression"; say "$(($1))"',
]) {
  test(`runtime reparses share admission: ${source}`, async () => {
    const program = `say ${"w ".repeat(96)}`;
    const { shell, fs } = setup({ env: { program, expression: `1${"+1".repeat(96)}`, text: "abcdef" } });
    await fs.writeFile("/program", new TextEncoder().encode(program));
    try {
      await assert.rejects(shell.exec(source, { stdin: program, limits: { maxParseUnits: 128 } }), parseLimit);
    } finally { await shell.dispose(); }
  });
}

test("parse limit overrides are local and caller cancellation identity survives", async () => {
  const { shell } = setup({ limits: { maxParseUnits: 0 } });
  try {
    await assert.rejects(shell.exec(":"), parseLimit);
    assert.equal((await shell.exec(":", { limits: { maxParseUnits: 32 } })).exitCode, 0);
    await assert.rejects(shell.exec(":"), parseLimit);
    const reason = new Error("caller cancelled");
    await assert.rejects(shell.exec(":", { signal: AbortSignal.abort(reason) }), error => error === reason);
  } finally { await shell.dispose(); }
});

test("newline units share allowance without rolling back already completed effects", async () => {
  const { shell } = setup();
  const chunks: Uint8Array[] = [];
  try {
    await assert.rejects(shell.exec("say one\nsay two\n", {
      limits: { maxParseUnits: 24 }, stdout: { async write(chunk) { chunks.push(Uint8Array.from(chunk)); } },
    }), parseLimit);
    assert.equal(Buffer.concat(chunks).toString(), "one\n");
  } finally { await shell.dispose(); }
});

test("runtime arithmetic quota rejection is the invocation abort reason", async () => {
  const { shell, commands } = setup({ env: { expression: `1${"+1".repeat(96)}` } });
  let observed: unknown;
  commands.register({ name: "watch", execute({ signal }) {
    signal.addEventListener("abort", () => { observed = signal.reason; }, { once: true });
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec('watch\nlet "$expression"', { limits: { maxParseUnits: 128 } }), error => {
      assert.ok(parseLimit(error));
      assert.equal(observed, error);
      return true;
    });
  } finally { await shell.dispose(); }
});

test("admitted syntax, quoting, byte identity, and arithmetic failures retain behavior", async () => {
  const { shell } = setup();
  try {
    assert.equal((await shell.exec('args a""b "" "*" "${missing:-x y}"', { limits: { maxParseUnits: 256 } })).stdout, '["ab","","*","x y"]');
    const bytes = await shell.exec("pass <<'END'\n$((1+2))\nEND\n", { limits: { maxParseUnits: 128 } });
    assert.equal(bytes.stdout, "$((1+2))\n");
    assert.equal((await shell.exec("echo '", { limits: { maxParseUnits: 128 } })).exitCode, 2);
    assert.equal((await shell.exec("say $((1+))", { limits: { maxParseUnits: 128 } })).exitCode, 1);
  } finally { await shell.dispose(); }
});

for (const source of ['eval "$program"', 'sh -c "$program"', "sh /program", ". /program", "sh", 'let "$expression"', "let expression", 'say "$((expression))"', "((expression))"]) {
  test(`individually affordable reparses cannot reset allowance: ${source}`, async () => {
    const program = "say w w w w";
    const expression = `1${"+1".repeat(8)}`;
    assert.doesNotThrow(() => parseShellUnit(source, 0, false, new ParseBudget(40)));
    assert.doesNotThrow(() => parseShellUnit(program, 0, false, new ParseBudget(40)));
    const { shell, fs } = setup({ env: { program, expression } });
    await fs.writeFile("/program", new TextEncoder().encode(program));
    try {
      await assert.rejects(shell.exec(source, { stdin: program, limits: { maxParseUnits: 40 } }), parseLimit);
    } finally { await shell.dispose(); }
  });
}

test("runtime indexed-unset admission is not translated to a subscript diagnostic", async () => {
  const source = "array=(x); unset 'array[0]'";
  let required = 0;
  for (; required < 256; required++) {
    try { parseShellUnit(source, 0, false, new ParseBudget(required)); break; }
    catch (error) { if (!parseLimit(error)) throw error; }
  }
  assert.ok(required < 256);
  const { shell } = setup();
  try {
    await assert.rejects(shell.exec(source, { limits: { maxParseUnits: required } }), parseLimit);
    assert.equal((await shell.exec(source, { limits: { maxParseUnits: required + 1 } })).exitCode, 0);
  } finally { await shell.dispose(); }
});
