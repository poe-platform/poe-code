import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import runtime from "./fengari.generated.js";
import {ExecutionContext} from "./execution.js";
import {LuaStorage, type LuaReference, type StoredLuaValue} from "./lua-storage.js";
import {LuaLexer} from "./lua-lexer.js";

const encoder = new TextEncoder();
async function usingLexer(source: string | AsyncIterable<Uint8Array>, run: (lexer: LuaLexer, heap: LuaStorage) => Promise<void>, signal?: AbortSignal, work?: number) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {...(signal ? {signal} : {}), ...(work === undefined ? {} : {limits: {work}})});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: signal ?? new AbortController().signal}, 1);
  const heap = new LuaStorage(storage, units => context.cooperate(units));
  const chunks = typeof source === "string" ? (async function* () {
    // Every byte boundary is also a source boundary, including escape sequences.
    for (const byte of encoder.encode(source)) yield Uint8Array.of(byte);
  })() : source;
  const lexer = new LuaLexer(chunks, heap, units => context.cooperate(units));
  try {await run(lexer, heap);}
  finally {await lexer.close(); await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}
async function bytes(heap: LuaStorage, value: LuaReference): Promise<number[]> {
  const result: number[] = [];
  for await (const chunk of heap.bytes(value)) result.push(...chunk);
  return result;
}
function nativeLiteral(source: string): StoredLuaValue | number[] {
  const compiler = runtime as typeof import("fengari"), state = compiler.lauxlib.luaL_newstate();
  try {
    const input = encoder.encode(`return ${source}`);
    expect(compiler.lauxlib.luaL_loadbuffer(state, input, input.length, encoder.encode("fixture"))).toBe(compiler.lua.LUA_OK);
    const internal = state as unknown as {top: number; stack: {value: {p: {k: {type: number; value: unknown}[]}}}[]};
    const value = internal.stack[internal.top - 1]!.value.p.k[0]!;
    if (value.type === 19) return {kind: "integer", value: value.value as number};
    if (value.type === 3) return value.value as number;
    return [...(value.value as {getstr(): Uint8Array}).getstr()];
  } finally {compiler.lua.lua_close(state);}
}

it("scans keywords, operators and identifiers across every source boundary", async () => {
  const source = "and break do else elseif end false for function goto if in local nil not or repeat return then true until while // .. ... == >= <= ~= << >> :: + - * / % ^ # & | ~ = < > ( ) { } [ ] ; : , . _ENV hello123";
  await usingLexer(source, async (lexer, heap) => {
    const found: string[] = [];
    for (;;) {
      const token = await lexer.next();
      if (token.kind === "eof") break;
      found.push(token.kind === "name" ? new TextDecoder().decode(Uint8Array.from(await bytes(heap, token.value as LuaReference))) : token.kind);
    }
    expect(found).toEqual(source.split(" "));
  });
});

it.each(["0", "2147483647", "2147483648", "0xffffffff", "0x100000001", "1.", ".5", "1e2", "1e-324", "0x1.8p2", "0x1p-1074",
  String.raw`"\a\b\f\n\r\t\v\\\"\'"`, String.raw`'\0\255\12x\x41\u{2713}\u{1f600}\u{d800}'`,
  '"a\\\r\nb"', '"a\\z \t\r\n b"', '[==[\r\na\rb\n\rc]==]'])
("matches existing compiler literal bytes and numeric tags: %s", async source => {
  await usingLexer(source, async (lexer, heap) => {
    const token = await lexer.next();
    const value = token.kind === "string" ? await bytes(heap, token.value as LuaReference) : token.value;
    expect(value).toEqual(nativeLiteral(source));
    expect((await lexer.next()).kind).toBe("eof");
  });
});

it("discards comments and counts paired newlines once", async () => {
  await usingLexer('-- short\r\n--[=[\nlong\r\ncomment]=]\nlocal x = [=[\nhi\rthere]=]\r\nreturn x', async lexer => {
    const tokens: {kind: string; line: number}[] = [];
    for (;;) {const token = await lexer.next(); tokens.push({kind: token.kind, line: token.line}); if (token.kind === "eof") break;}
    expect(tokens).toEqual([
      {kind:"local",line:5},{kind:"name",line:5},{kind:"=",line:5},{kind:"string",line:5},
      {kind:"return",line:8},{kind:"name",line:8},{kind:"eof",line:8}
    ]);
  });
});

it("preserves compiler string interning, including existing binary hash collisions", async () => {
  await usingLexer(String.raw`"\1\35" "\18\3" repeated repeated`, async (lexer, heap) => {
    const a = await lexer.next(), b = await lexer.next(), c = await lexer.next(), d = await lexer.next();
    expect(a.value).toEqual(b.value);
    expect(await bytes(heap, b.value as LuaReference)).toEqual([1,35]);
    expect(c.value).toEqual(d.value);
  });
});

it.each([['"unfinished', "unfinished string"], ['[=[unfinished', "unfinished long string"], ['--[[unfinished', "unfinished long comment"],
  ['[=x', "invalid long string delimiter"], [String.raw`"\q"`, "invalid escape"], [String.raw`"\256"`, "decimal escape too large"],
  [String.raw`"\xg1"`, "hexadecimal digit expected"], [String.raw`"\u{}"`, "hexadecimal digit expected"],
  [String.raw`"\u{110000}"`, "UTF-8 value too large"], ['1..2', "malformed number"], ['0x', "malformed number"]])
("reports lexical errors and closes source: %s", async (source, message) => {
  let closed = false;
  const chunks = (async function* () {try {yield encoder.encode(source);} finally {closed = true;}})();
  await usingLexer(chunks, async lexer => {await expect(lexer.next()).rejects.toThrow(message);});
  expect(closed).toBe(true);
});

it("retains growing identifiers and strings while discarding large comments", async () => {
  const block = new Uint8Array(4096).fill(97), size = block.length * 16;
  const source = (async function* () {
    for (let i = 0; i < 16; i++) yield block;
    yield encoder.encode(' "');
    for (let i = 0; i < 16; i++) yield block;
    yield encoder.encode('" --[==[');
    for (let i = 0; i < 16; i++) yield block;
    yield encoder.encode(']==]\nreturn');
  })();
  await usingLexer(source, async (lexer, heap) => {
    const name = await lexer.next(), literal = await lexer.next();
    expect(name.kind).toBe("name"); expect(literal.kind).toBe("string");
    expect(await heap.byteLength(name.value as LuaReference)).toBe(size);
    expect(literal.value).toEqual(name.value);
    expect(await lexer.next()).toEqual({kind:"return",line:2});
    expect((await lexer.next()).kind).toBe("eof");
  });
});

it.each(["", "name"])("checks cancellation after a source returns %s and closes the producer", async chunk => {
  const controller = new AbortController(); let closed = false;
  const source = (async function* () {
    try {
      yield new Uint8Array(); controller.abort(); yield encoder.encode(chunk);
      throw new Error("Read beyond cancellation");
    } finally {closed = true;}
  })();
  await usingLexer(source, async lexer => {
    await expect(lexer.next()).rejects.toMatchObject({code:"E_CANCELLED"});
  }, controller.signal);
  expect(closed).toBe(true);
});

it("preserves source failure identity and closes on an early consumer exit", async () => {
  const failure = new Error("reader failed"); let returned = 0;
  const source: AsyncIterable<Uint8Array> = {[Symbol.asyncIterator]: () => ({
    async next() {throw failure;}, async return() {returned++; throw new Error("cleanup failed too");}
  })};
  await usingLexer(source, async lexer => {await expect(lexer.next()).rejects.toBe(failure);});
  expect(returned).toBe(1);
  let closed = false;
  await usingLexer((async function* () {try {yield encoder.encode("return 42");} finally {closed = true;}})(), async lexer => {
    expect((await lexer.next()).kind).toBe("return");
  });
  expect(closed).toBe(true);
});


it("charges the final partial byte quantum before returning end-of-input", async () => {
  await usingLexer((async function* () {yield encoder.encode("--12345678");})(), async lexer => {
    await expect(lexer.next()).rejects.toMatchObject({code:"E_LIMIT"});
  }, undefined, 5);
});
