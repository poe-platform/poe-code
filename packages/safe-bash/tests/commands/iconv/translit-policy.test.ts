import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource, CommandContext } from "../../../src/contracts/index.js";
import { run } from "./helpers.js";

const args = ["-f", "UTF-8", "-t", "ASCII//TRANSLIT"];
for (const env of [{}, { LC_ALL: "C" }, { LC_ALL: "POSIX" }, { LC_ALL: "", LC_CTYPE: "C" }, { LANG: "POSIX" }, { LC_ALL: "C", LC_CTYPE: "C.UTF-8", LANG: "en_US.UTF-8" }]) test(`admitted transliteration locale ${JSON.stringify(env)}`, async () => {
  assert.deepEqual(await run(args, Buffer.from("éß€😀"), {}, { env }), { exitCode: 0, stdoutHex: "3f73734555523f", stderrHex: "" });
});
for (const locale of ["C.UTF-8", "C.utf8", "en_US.UTF-8", "en_US", "de_DE", "c", "POSIX.UTF-8"]) test(`explicitly unsupported transliteration locale ${locale}`, async () => {
  let acquired = 0;
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() { acquired++; yield Uint8Array.of(65); } };
  const result = await run(args, undefined, {}, { env: { LC_ALL: locale, LC_CTYPE: "C" }, stdin });
  assert.equal(result.exitCode, 1); assert.equal(result.stdoutHex, ""); assert.equal(acquired, 0);
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), `iconv: unsupported transliteration locale: ${locale}; supported: C, POSIX, or unset\n`);
});
for (const reason of [false, 0, "", null]) {
  test(`locale getter cancellation prevents lower lookups and I/O: ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let lower = 0, acquired = 0;
    const env = { get LC_ALL() { caller.abort(reason); return ""; }, get LC_CTYPE() { lower++; return "C"; } };
    const stdin: ByteSource = { async *[Symbol.asyncIterator]() { acquired++; yield* []; } };
    await assert.rejects(run(args, undefined, {}, { env, stdin, signal: caller.signal }), error => error === reason);
    assert.equal(lower, 0); assert.equal(acquired, 0);
  });
  test(`environment getter cancellation prevents locale lookup: ${JSON.stringify(reason)}`, async () => {
    const caller = new AbortController();
    let reads = 0;
    const overrides: Partial<CommandContext> = { signal: caller.signal, get env() { caller.abort(reason); return { get LC_ALL() { reads++; return "C"; } }; } };
    await assert.rejects(run(args, undefined, {}, overrides), error => error === reason);
    assert.equal(reads, 0);
  });
}
test("without transliteration, explicit codecs never inspect locale", async () => {
  const overrides: Partial<CommandContext> = { get env(): never { throw new Error("unneeded locale lookup"); } };
  assert.deepEqual(await run(["-f", "UTF-8", "-t", "latin1"], Buffer.from("éß"), {}, overrides), { exitCode: 0, stdoutHex: "e9df", stderrHex: "" });
});
test("representable bytes never pass through ASCII transliteration", async () => {
  assert.deepEqual(await run(["-f", "UTF-8", "-t", "latin1//TRANSLIT"], Buffer.from("éß€")), { exitCode: 0, stdoutHex: "e9df455552", stderrHex: "" });
});
test("seven-byte expansion obeys output limits", async () => {
  assert.deepEqual(await run(args, Buffer.from("㎯"), { limits: { maxOutputBytes: 7 } }), { exitCode: 0, stdoutHex: "7261642f735e32", stderrHex: "" });
  const result = await run(args, Buffer.from("㎯"), { limits: { maxOutputBytes: 6 } });
  assert.equal(result.exitCode, 1); assert.equal(result.stdoutHex, "");
  assert.match(Buffer.from(result.stderrHex, "hex").toString(), /output bytes limit exceeded/);
});
test("locale text is bounded before diagnostic allocation", async () => {
  const result = await run(args, undefined, { limits: { maxArgumentBytes: 64 } }, { env: { LC_ALL: "X".repeat(65) } });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "iconv: locale bytes limit exceeded\n");
});
test("an admitted locale stops lower-priority getters", async () => {
  const env = { LC_ALL: "C", get LC_CTYPE(): never { throw new Error("lower locale getter"); } };
  assert.equal((await run(args, Buffer.from("é"), {}, { env })).stdoutHex, "3f");
});
