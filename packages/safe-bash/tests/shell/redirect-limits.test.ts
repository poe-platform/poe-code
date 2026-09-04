import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { cloudflareWorkerLimits, ShellLimitError, type ShellLimits } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

function fixture(t: TestContext, limits: ShellLimits = {}) {
  const instance = setup({ limits });
  t.after(() => instance.shell.dispose());
  return instance;
}

const redirectLimit = (error: unknown): boolean => error instanceof ShellLimitError && error.limit === "maxRedirects";

test("zero redirect capacity permits commands and ordinary pipelines but rejects one redirect", async t => {
  const { shell } = fixture(t, { maxRedirects: 0 });
  assert.equal((await shell.exec(":; { :; }; (:); : | :")).exitCode, 0);
  await assert.rejects(shell.exec(": 3<&0"), redirectLimit);
});

test("exact redirect capacity counts operations even when the descriptor and target repeat", async t => {
  const { shell, fs } = fixture(t, { maxRedirects: 2 });
  await fs.writeFile("/input", new Uint8Array());
  const access = t.mock.method(fs, "access");
  assert.equal((await shell.exec(": 3<input 3<input")).exitCode, 0);
  assert.equal(access.mock.callCount(), 2);
  access.mock.resetCalls();
  await assert.rejects(shell.exec(": 3<input 3<input 3<input"), redirectLimit);
  assert.equal(access.mock.callCount(), 0);
});

test("default and Worker profiles admit 64 redirects and reject 65", async t => {
  assert.equal(cloudflareWorkerLimits.maxRedirects, 64);
  const { shell } = fixture(t);
  assert.equal((await shell.exec(": " + Array(64).fill("3<&0").join(" "))).exitCode, 0);
  await assert.rejects(shell.exec(": " + Array(65).fill("3<&0").join(" ")), redirectLimit);
});

for (const command of [":", "", "{ :; }", "(:)", "if true; then :; fi", "while false; do :; done", "for value in one; do :; done", "[[ x ]]", "((1))"]) {
  test(`redirect admission covers ${command || "redirect-only command"}`, async t => {
    const { shell } = fixture(t, { maxRedirects: 1 });
    assert.equal((await shell.exec(`${command} 3<&0`)).exitCode, 0);
    await assert.rejects(shell.exec(`${command} 3<&0 3<&0`), redirectLimit);
  });
}

for (const redirects of ["3<$(target) 4<input", ">$(target) >out", "<<<$(target) <<<word"]) {
  test(`over-cap rejection precedes target expansion and redirect IO: ${redirects}`, async t => {
    const { shell, fs, commands } = fixture(t, { maxRedirects: 1 });
    await fs.writeFile("/input", new Uint8Array());
    let expanded = 0, executed = 0;
    commands.register({ name: "target", async execute({ stdout }) { expanded++; await stdout.write(new TextEncoder().encode("input")); return { exitCode: 0 }; } });
    commands.register({ name: "body", execute() { executed++; return { exitCode: 0 }; } });
    const access = t.mock.method(fs, "access"), stat = t.mock.method(fs, "stat"), write = t.mock.method(fs, "writeFile"), read = t.mock.method(fs, "readFile");
    await assert.rejects(shell.exec(`body ${redirects}`), redirectLimit);
    assert.equal(expanded, 0);
    assert.equal(executed, 0);
    for (const operation of [access, stat, write, read]) assert.equal(operation.mock.callCount(), 0);
  });
}

test("here-documents count before expansion and implicit pipe-stderr duplication counts once", async t => {
  const { shell, commands } = fixture(t, { maxRedirects: 1 });
  let expanded = 0;
  commands.register({ name: "target", execute() { expanded++; return { exitCode: 0 }; } });
  await assert.rejects(shell.exec(": 3<<FIRST 4<<SECOND\n$(target)\nFIRST\nsecond\nSECOND\n"), redirectLimit);
  assert.equal(expanded, 0);
  assert.equal((await shell.exec(": |& :")).exitCode, 0);
  await assert.rejects(shell.exec(": |& :", { limits: { maxRedirects: 0 } }), redirectLimit);
  await assert.rejects(shell.exec(": 3<&0 |& :"), redirectLimit);
});

test("redirect capacity is reused by sequential invocations and independently nested lists", async t => {
  const { shell } = fixture(t, { maxRedirects: 1 });
  for (const source of [": 3<&0; : 3<&0", "{ : 3<&0; } 4<&0", "(: 3<&0) 4<&0", "for value in one two; do : 3<&0; done"]) {
    assert.equal((await shell.exec(source)).exitCode, 0, source);
  }
  assert.equal((await shell.exec(": 3<&0")).exitCode, 0);
  assert.equal((await shell.exec(": 3<&0")).exitCode, 0);
});

test("function-body redirects are admitted on invocation and eval retains the limit", async t => {
  const { shell } = fixture(t, { maxRedirects: 1 });
  assert.equal((await shell.exec("f() { :; } 3<&0 3<&0")).exitCode, 0);
  await assert.rejects(shell.exec("f() { :; } 3<&0 3<&0; f"), redirectLimit);
  await assert.rejects(shell.exec("eval ': 3<&0 3<&0'"), redirectLimit);
  await assert.rejects(shell.exec("say \"$(: 3<&0 3<&0)\""), redirectLimit);
});

test("source and sh command lists inherit redirect admission", async t => {
  const { shell, fs } = fixture(t, { maxRedirects: 1 });
  await fs.writeFile("/script", new TextEncoder().encode(": 3<&0 3<&0"));
  await assert.rejects(shell.exec(". /script"), redirectLimit);
  await assert.rejects(shell.exec("sh /script"), redirectLimit);
});

test("literal invoke argv is not redirection syntax but invoked eval is admitted", async t => {
  const { shell, commands } = fixture(t, { maxRedirects: 0 });
  commands.register({ name: "literal", async execute(context) {
    assert.ok(context.invoke);
    return context.invoke("args", ["3<&0", "3<&0"]);
  } });
  commands.register({ name: "nested", async execute(context) {
    assert.ok(context.invoke);
    return context.invoke("eval", [": 3<&0"]);
  } });
  assert.equal((await shell.exec("literal")).stdout, '["3<&0","3<&0"]');
  await assert.rejects(shell.exec("nested"), redirectLimit);
});

test("execution overrides are local and redirect limits reject invalid numeric settings", async t => {
  const { shell } = fixture(t, { maxRedirects: 0 });
  assert.equal((await shell.exec(": 3<&0", { limits: { maxRedirects: 1 } })).exitCode, 0);
  await assert.rejects(shell.exec(": 3<&0"), redirectLimit);
  for (const maxRedirects of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => setup({ limits: { maxRedirects } }), RangeError);
    await assert.rejects(shell.exec(":", { limits: { maxRedirects } }), RangeError);
  }
});

test("below-cap redirects preserve left-to-right effects and stop after the first failure", async t => {
  const { shell, fs } = fixture(t, { maxRedirects: 3 });
  assert.equal((await shell.exec("say final >first >second")).exitCode, 0);
  assert.equal((await fs.readFile("/first")).length, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/second")), "final\n");
  const result = await shell.exec(": >created 3<missing >never");
  assert.equal(result.exitCode, 1);
  assert.equal((await fs.stat("/created")).type, "file");
  await assert.rejects(fs.stat("/never"), { code: "ENOENT" });
});

test("below-cap buffered inputs retain eager timing and independent byte allowances", async t => {
  const { shell, fs } = fixture(t, { maxRedirects: 3, maxInputBytes: 8 });
  await fs.writeFile("/input", new Uint8Array(8));
  Object.defineProperty(fs, "readStream", { value: undefined });
  const read = t.mock.method(fs, "readFile");
  assert.equal((await shell.exec(": 3<input 3<input 3<input")).exitCode, 0);
  assert.equal(read.mock.callCount(), 3);
  assert.deepEqual(read.mock.calls.map(call => call.arguments[1]?.maxBytes), [8, 8, 8]);
  read.mock.resetCalls();
  assert.equal((await shell.exec(": 3<input 3<input", { limits: { maxInputBytes: 7 } })).exitCode, 1);
  assert.equal(read.mock.callCount(), 1);
});

for (const reason of [null, false, 0, "", new Error("cancel")]) {
  test(`caller and local invocation cancellation precede redirect admission: ${String(reason)}`, async t => {
    const { shell, commands } = fixture(t, { maxRedirects: 0 });
    const controller = new AbortController(); controller.abort(reason);
    await assert.rejects(shell.exec(": 3<&0", { signal: controller.signal }), error => error === reason);
    commands.register({ name: "localcheck", async execute(context) {
      assert.ok(context.invoke);
      await assert.rejects(context.invoke("eval", [": 3<&0"], { signal: controller.signal }), error => error === reason);
      return { exitCode: 0 };
    } });
    assert.equal((await shell.exec("localcheck")).exitCode, 0);
    assert.equal((await shell.exec(":")).exitCode, 0);
  });
}
