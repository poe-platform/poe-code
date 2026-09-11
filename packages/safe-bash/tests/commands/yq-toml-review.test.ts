import assert from "node:assert/strict";
import { test } from "node:test";
import { createYqCommand } from "../../src/commands/yq/index.js";
import { createCommandArguments, toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { registerYieldCheckpoint } from "../../src/contracts/yield.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

async function run(input: string, filter = ".", signal = new AbortController().signal, afterInput?: () => void) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "yq", args: ["-p", "toml", "-o", "json", "-c", filter],
    stdin: afterInput ? { async *[Symbol.asyncIterator]() { yield Buffer.from(input); afterInput(); } } : toByteSource(input),
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal,
  };
  const result = await createYqCommand().execute(context);
  return { status: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

for (const [name, input, expected] of [
  ["empty document", "", {}],
  ["quoted and dotted keys", '""=1\n"a.b"=2\na.b=3\n1234="digits"', { "": 1, "a.b": 2, a: { b: 3 }, "1234": "digits" }],
  ["implicit parent declaration", "[a.b]\nx=1\n[a]\ny=2", { a: { b: { x: 1 }, y: 2 } }],
  ["array-of-tables parent ownership", "[[a]]\nx=1\n[a.b]\ny=2\n[[a]]\nx=3\n[a.b]\ny=4", { a: [{ x: 1, b: { y: 2 } }, { x: 3, b: { y: 4 } }] }],
  ["mixed array with comments", 'a=[1, #one\n"x",false,{x=2},[3],]', { a: [1, "x", false, { x: 2 }, [3]] }],
  ["Unicode escapes", 'a="\\u0041\\U0001F642"', { a: "A🙂" }],
  ["multiline YAML-looking content", 'a="""\nfirst\n---\n...\nlast"""', { a: "first\n---\n...\nlast" }],
  ["multiline continuation", 'a="""one\\  \n \n two"""', { a: "onetwo" }],
  ["four-quote delimiters", 'a=""""quoted""""', { a: '"quoted"' }],
  ["numeric bases and separators", "a=0xDEAD_BEEF\nb=0o755\nc=0b1010\nd=+1_234\ne=1.2_3e+4", { a: 3735928559, b: 493, c: 10, d: 1234, e: 12300 }],
  ["date and fractional time lexemes", "a=1979-05-27T07:32:00.123456789Z\nb=1979-05-27\nc=07:32:00.123456789", { a: "1979-05-27T07:32:00.123456789Z", b: "1979-05-27", c: "07:32:00.123456789" }],
] as const) test(`TOML independent oracle: ${name}`, async () => {
  const result = await run(input);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.equal(result.stderr, "");
});

for (const [name, input] of [
  ["equivalent duplicate key", 'a=1\n"a"=2'],
  ["dotted table redeclaration", "a.b=1\n[a]\nc=2"],
  ["sealed inline table", "a={b=1}\na.c=2"],
  ["nested sealed inline table", "a={b={c=1}}\n[a.b]\nd=2"],
  ["ordinary array becoming tables", "a=[]\n[[a]]\nb=1"],
  ["inline trailing comma", "a={b=1,}"],
  ["inline newline", "a={b=1,\nc=2}"],
  ["bare Unicode key", "é=1"],
  ["Unicode surrogate escape", 'a="\\uD800"'],
  ["bare carriage return", "a=1\rb=2"],
  ["BOM", "\ufeffa=1"],
  ["comment control character", "#bad\u007f\na=1"],
  ["leading zero", "a=01"],
  ["signed hexadecimal", "a=+0xff"],
  ["doubled separator", "a=1__0"],
  ["missing float fraction", "a=1."],
  ["unsafe integer", "a=9007199254740993"],
  ["nonfinite number", "a=inf"],
  ["invalid calendar date", "a=2023-02-29"],
  ["invalid offset", "a=1979-05-27T07:32:00+24:00"],
] as const) test(`TOML independent refusal: ${name}`, async () => {
  const result = await run(input, "try . catch 1");
  assert.equal(result.status, 5, result.stderr);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.length > 0);
});

test("TOML prototype-looking keys remain owned data", async () => {
  const result = await run("__proto__={polluted=true}\nconstructor={prototype={x=1}}");
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.deepEqual(value.__proto__, { polluted: true });
  assert.deepEqual(value.constructor, { prototype: { x: 1 } });
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

for (const input of [Array.from({ length: 140 }, () => "a").join(".") + "=1", "a=" + "[".repeat(140) + "1" + "]".repeat(140)]) test("TOML implicit paths and arrays enforce parse-time depth", async () => {
  const result = await run(input);
  assert.equal(result.status, 5, result.stderr);
  assert.ok(result.stderr.includes("LIMIT_MAX_DEPTH"), result.stderr);
  assert.equal(result.stdout, "");
});

for (const reason of [false, Object.freeze({ cancelled: "TOML long token" })]) test(`TOML parsing preserves live ${typeof reason} abort identity`, async () => {
  const controller = new AbortController();
  let checkpoints = 0;
  await assert.rejects(run('a="' + "x".repeat(65536) + '"', ".", controller.signal, () => {
    registerYieldCheckpoint(controller.signal, () => { checkpoints++; controller.abort(reason); });
  }), error => error === reason);
  assert.ok(checkpoints > 0);
  assert.equal((await run("a=1", ".a")).stdout, "1\n");
});

for (const filename of ["/\ufffd.toml", "/\ufeff.toml"]) test(`TOML VFS filename preserves literal Unicode identity ${JSON.stringify(filename)}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile(filename, Buffer.from("answer=42"));
  await fs.writeFile("/.toml", Buffer.from("answer=7"));
  const carrier = createCommandArguments(["-p", "toml", "-o", "json", "-c", ".answer", filename]);
  const output: Uint8Array[] = [];
  const context: CommandContext = {
    command: "yq", args: carrier.args, argumentValues: carrier, stdin: toByteSource(""),
    stdout: { async write(chunk) { output.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { assert.fail(Buffer.from(chunk).toString()); } },
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
  };
  assert.equal((await createYqCommand().execute(context)).exitCode, 0);
  assert.equal(Buffer.concat(output).toString(), "42\n");
});

test("TOML dotted assignment promotes an implicit table before later header admission", async () => {
  const implicit = "[a.b.c]\nx=1\n[a]\n";
  const throughDottedKey = await run(implicit + "b.d=2");
  assert.equal(throughDottedKey.status, 0, throughDottedKey.stderr);
  assert.deepEqual(JSON.parse(throughDottedKey.stdout), { a: { b: { c: { x: 1 }, d: 2 } } });
  const throughHeader = await run(implicit + "[a.b]\ne=3");
  assert.equal(throughHeader.status, 0, throughHeader.stderr);
  assert.deepEqual(JSON.parse(throughHeader.stdout), { a: { b: { c: { x: 1 }, e: 3 } } });
  const redefinition = await run(implicit + "b.d=2\n[a.b]\ne=3");
  assert.equal(redefinition.status, 5, redefinition.stderr);
  assert.equal(redefinition.stdout, "");
  assert.ok(redefinition.stderr.includes("SCHEMA_DUPLICATE_KEY"), redefinition.stderr);
});
