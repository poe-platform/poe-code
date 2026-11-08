import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpCommand } from "./cli.js";
import { resolveOpCompletion } from "./completion-resolver.js";

async function run(path: string, flags: readonly string[]) {
  const calls: string[] = [];
  let received: Readonly<Record<string, unknown>> = {};
  let error = "";
  const result = await createOpCommand({
    authorize() { calls.push("authorize"); return "allow"; },
    backend: { async execute(request) { calls.push("backend"); received = request.flags; return []; } },
  }).execute({
    args: [...path.split(" "), ...(path === "item edit" || path === "item get" ? ["synthetic"] : []), ...flags],
    env: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { calls.push("stdin"); yield new Uint8Array(); } },
    stdout: { async write() { calls.push("stdout"); } },
    stderr: { async write(data) { error += Buffer.from(data); } },
  });
  return { ...result, calls, received, error };
}

test("password recipes reject invalid classes and lengths before authorization", async () => {
  for (const path of ["item create", "item edit"]) for (const value of ["synthetic-private", "", "0", "-1", "65", "20,30", "20,20", " 20", "20 ", "letters,", "letters,,digits", '"letters"', "9223372036854775808"]) {
    const result = await run(path, [`--generate-password=${value}`]);
    assert.equal(result.exitCode, 1, JSON.stringify({ path, value, result }));
    assert.deepEqual(result.calls, []);
    assert.equal(result.error.includes("synthetic-private"), false);
    assert.deepEqual(resolveOpCompletion([...path.split(" "), `--generate-password=${value}`, "--"]), { candidates: [], directive: 0 });
  }
});

test("password recipe labels remain raw and bare generation retains its default marker", async () => {
  for (const value of ["1", "64", "+20", "01", "letters", "LETTERS", "digits,symbols", "letters,letters", "LETTERS,+20"]) {
    const result = await run("item create", [`--generate-password=${value}`]);
    assert.equal(result.exitCode, 0, result.error);
    assert.equal(result.received["generate-password"], value);
  }
  assert.equal((await run("item create", ["--generate-password"])).received["generate-password"], true);
  assert.equal((await run("item create", ["--generate-password=20", "--generate-password=30"])).received["generate-password"], "30");
});

test("CSV flags reject malformed quoting before authorization and completion", async () => {
  for (const value of ['a"b', '"a"b', '"a" ', '"unterminated', "\n"]) {
    const result = await run("item list", [`--tags=${value}`]);
    assert.equal(result.exitCode, 1, value);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(resolveOpCompletion(["item", "list", `--tags=${value}`, "--"]), { candidates: [], directive: 0 });
  }
});

test("CSV flags decode one record with quoted commas, escaped quotes and normalized line endings", async () => {
  for (const [value, expected] of [["", []], ['"a,b"', ["a,b"]], ['"a""b"', ['a"b']], ["a,", ["a", ""]], ["a\nb", ["a"]], ["\nvalue", ["value"]], ['"a\r\nb"', ["a\nb"]], ["a\r", ["a"]], ["a\rX", ["a\rX"]], [" a", [" a"]]] as const) {
    const result = await run("item list", [`--tags=${value}`]);
    assert.equal(result.exitCode, 0, result.error);
    assert.deepEqual(result.received.tags, expected);
  }
});

test("native string-slice flags stay repeatable completion candidates", () => {
  for (const [path, flag, value] of [["item list", "tags", "synthetic"], ["item list", "categories", "Login"], ["events-api create", "features", "signinattempts"], ["item get", "fields", "label=password"], ["item share", "emails", "synthetic@example.invalid"], ["connect server create", "vaults", "synthetic"]]) {
    const completion = resolveOpCompletion([...path!.split(" "), `--${flag}=${value}`, "--"]);
    assert.equal(completion.candidates.some(candidate => candidate.value === `--${flag}`), true, flag);
  }
  assert.equal(resolveOpCompletion(["vault", "list", "--permission=view_items", "--"]).candidates.some(candidate => candidate.value === "--permission"), false);
});
