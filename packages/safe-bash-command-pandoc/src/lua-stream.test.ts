import {expect, it, vi} from "vitest";
import {convert} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import {createLuaFilterCapability} from "./lua-filters.js";

const encoder = new TextEncoder();
const options = {from: "commonmark", to: "html", filters: [{kind: "lua" as const, path: "/filter.lua"}]};
const input = [{bytes: encoder.encode("Hello *world*")}];

it("compiles real Lua across asynchronous source chunks without a whole-file reader", async () => {
  const source = encoder.encode('local suffix = "✓"; return {Str = function(el) el.text = string.upper(el.text) .. suffix; return el end}');
  const closed = vi.fn();
  const readStream = vi.fn(async function* (path: string) {
    expect(path).toBe("/filter.lua");
    try {
      for (let offset = 0; offset < source.length; offset += 3) {
        await Promise.resolve();
        yield source.subarray(offset, offset + 3);
      }
    } finally {closed();}
  });
  await expect(convert(input, options, {filters: createLuaFilterCapability({readStream})})).resolves.toMatchObject({
    text: "<p>HELLO✓ <em>WORLD✓</em></p>\n"
  });
  expect(closed).toHaveBeenCalledOnce();
});

it("reports an early syntax error without consuming the rest of a filter", async () => {
  const closed = vi.fn();
  const tail = vi.fn();
  const readStream = async function* () {
    try {
      yield encoder.encode("function ) invalid prefix\n");
      tail();
      throw new Error("must not read the tail");
    } finally {closed();}
  };
  await expect(convert(input, options, {filters: createLuaFilterCapability({readStream})})).rejects.toMatchObject({code: "E_AST"});
  expect(tail).not.toHaveBeenCalled();
  expect(closed).toHaveBeenCalledOnce();
});

it("closes a streamed filter when cancellation arrives during a read", async () => {
  const controller = new AbortController();
  const closed = vi.fn();
  const readStream = async function* (_path: string, signal: AbortSignal | undefined) {
    expect(signal).toBe(controller.signal);
    try {
      yield encoder.encode("local x = ");
      controller.abort();
      yield encoder.encode("1");
    } finally {closed();}
  };
  await expect(convert(input, options, {signal: controller.signal, filters: createLuaFilterCapability({readStream})})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(closed).toHaveBeenCalledOnce();
});

it("uses the supplied safe-fs stream for command filter files", async () => {
  const {MemoryFileSystem} = await import("@poe-code/safe-fs/fs/memory");
  const {createPandocCommand} = await import("./command.js");
  const fs = new MemoryFileSystem();
  await fs.writeFile("/filter.lua", encoder.encode('function Str(el) el.text = string.upper(el.text); return el end'));
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("whole-file reading is forbidden"));
  const readStream = vi.spyOn(fs, "readStream");
  let stdout = "";
  const stderr = vi.fn(async () => {});
  await expect(createPandocCommand().execute({
    command: "pandoc", args: ["-f", "commonmark", "-t", "html", "-L", "/filter.lua"],
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {yield encoder.encode("Hello");})(),
    stdout: {async write(bytes) {stdout += new TextDecoder().decode(bytes);}}, stderr: {write: stderr}
  })).resolves.toEqual({exitCode: 0});
  expect(stdout).toBe("<p>HELLO</p>\n");
  expect(stderr).not.toHaveBeenCalled();
  expect(readStream).toHaveBeenCalledWith("/filter.lua", expect.objectContaining({chunkSize: 65536}));
});

it.each([
  `local items = {}; for i = 1, 4 do items[#items + 1] = i end
   local n = 2; repeat n = n - 1 until n == 0
   while n < 3 do n = n + 1 end
   local function suffix(text, ...) local a = ...; if n == 3 and #text > 0 then return text .. a else return text end end
   return {{Str = function(el) el.text = suffix(el.text, tostring(items[4])); return el end}}`,
  `--[=[ a long comment with ]] delimiters ]=]
   local suffix = [==[✓]==]; local value = {suffix = suffix}
   function value:decorate(text) return text .. self.suffix end
   return {Str = function(el) ::again:: if false then goto again end; el.text = value:decorate(el.text); return el end}`,
  `local values = {"a", "b", "c"}; local combined = ""
   for _, value in ipairs(values) do combined = combined .. value end
   return {Str = function(el) el.text = el.text .. combined .. "\\x21\\u{2713}"; return el end}`,
])("preserves the buffered compiler's semantics across single-byte reads", async source => {
  const bytes = encoder.encode(source);
  const buffered = await convert(input, options, {filters: createLuaFilterCapability({readFile: async () => bytes})});
  const streamed = await convert(input, options, {filters: createLuaFilterCapability({readStream: async function* () {
    for (const byte of bytes) yield Uint8Array.of(byte);
  }})});
  expect(streamed).toEqual(buffered);
});

it("rejects bytecode even after empty chunks and closes the reader", async () => {
  const closed = vi.fn();
  await expect(convert(input, options, {filters: createLuaFilterCapability({readStream: async function* () {
    try {yield new Uint8Array(); yield Uint8Array.of(27, 76, 117, 97);} finally {closed();}
  }})})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  expect(closed).toHaveBeenCalledOnce();
});

it("drains cleanup when the first source pull aborts the conversion", async () => {
  const controller = new AbortController();
  const closed = vi.fn();
  await expect(convert(input, options, {signal: controller.signal, filters: createLuaFilterCapability({readStream: async function* () {
    try {controller.abort(); yield encoder.encode("return {}");} finally {closed();}
  }})})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(closed).toHaveBeenCalledOnce();
});

it("keeps asynchronous compilers isolated between simultaneous conversions", async () => {
  const results = await Promise.all(["first", "second"].map(suffix => convert(input, options, {
    filters: createLuaFilterCapability({readStream: async function* () {
      const bytes = encoder.encode(`local suffix = "${suffix}"; function Str(el) el.text = el.text .. suffix; return el end`);
      for (let offset = 0; offset < bytes.length; offset += 7) {
        await Promise.resolve();
        yield bytes.subarray(offset, offset + 7);
      }
    }})
  })));
  expect(results).toMatchObject([
    {text: "<p>Hellofirst <em>worldfirst</em></p>\n"},
    {text: "<p>Hellosecond <em>worldsecond</em></p>\n"}
  ]);
});

it("preserves a syntax error when source cleanup also fails", async () => {
  const readStream = () => ({[Symbol.asyncIterator]() {
    return {
      async next() {return {done: false as const, value: encoder.encode("function ) invalid\n")};},
      async return(): Promise<IteratorResult<Uint8Array>> {throw new Error("cleanup failed");}
    };
  }});
  await expect(convert(input, options, {filters: createLuaFilterCapability({readStream})})).rejects.toMatchObject({code: "E_AST"});
});

it.each([false, true])("closes an owned iterator when its reader factory cancels before the first pull (async: %s)", async asynchronous => {
  const controller = new AbortController();
  const next = vi.fn(() => ({done: false as const, value: encoder.encode("return {}")}));
  const close = vi.fn(() => ({done: true as const, value: undefined}));
  const readStream = () => {
    controller.abort();
    return asynchronous
      ? {[Symbol.asyncIterator]() {return {async next() {return next();}, async return() {return close();}};}}
      : {[Symbol.iterator]() {return {next, return: close};}};
  };
  await expect(convert(input, options, {signal: controller.signal, filters: createLuaFilterCapability({readStream})})).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(next).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it("does not return an iterator that already completed normally", async () => {
  const close = vi.fn(() => {throw new Error("iterator already closed");});
  let consumed = false;
  const readStream = () => ({[Symbol.iterator]() {return {
    next() {
      if (consumed) return {done: true as const, value: undefined};
      consumed = true;
      return {done: false as const, value: encoder.encode("return {}")};
    },
    return: close
  };}});
  await expect(convert(input, options, {filters: createLuaFilterCapability({readStream})})).resolves.toMatchObject({text: "<p>Hello <em>world</em></p>\n"});
  expect(close).not.toHaveBeenCalled();
});


it("bounds owned source copies even when the supplied Lua reader yields a large chunk", async () => {
  const source = encoder.encode("--" + " ".repeat(200000) + '\nfunction Str(el) el.text = string.upper(el.text); return el end');
  const charges = vi.spyOn(ExecutionContext.prototype, "charge");
  const closed = vi.fn();
  try {
    await expect(convert(input, options, {filters: createLuaFilterCapability({readStream: async function* () {
      try {yield source;} finally {closed();}
    }})})).resolves.toMatchObject({text: "<p>HELLO <em>WORLD</em></p>\n"});
    const retained = charges.mock.calls.filter(([key]) => key === "retainedBytes").map(([, bytes]) => bytes);
    expect(Math.max(...retained)).toBeLessThanOrEqual(65536);
    expect(closed).toHaveBeenCalledOnce();
  } finally {charges.mockRestore();}
});


it("yields during a large Lua source chunk so cancellation closes the reader before another pull", async () => {
  const controller = new AbortController(), closed = vi.fn(), tail = vi.fn();
  const source = encoder.encode("--" + " ".repeat(200000) + "\nreturn {}");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect(convert(input, options, {signal: controller.signal, filters: createLuaFilterCapability({readStream: async function* () {
      timer = setTimeout(() => controller.abort(), 0);
      try {yield source; tail();} finally {closed();}
    }})})).rejects.toMatchObject({code: "E_CANCELLED"});
    expect(tail).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledOnce();
  } finally {clearTimeout(timer);}
});

it.each([
  "while true do end",
  "function Str(el) while true do end end"
])("delivers timer cancellation during Lua execution before exhausting the work budget: %s", async source => {
  const controller = new AbortController(), closed = vi.fn(), publish = vi.fn();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect(convert(input, options, {
      signal: controller.signal, limits: {work: 100000}, output: {publish},
      filters: createLuaFilterCapability({readStream: async function* () {
        try {yield encoder.encode(source);}
        finally {closed(); timer = setTimeout(() => controller.abort(), 0);}
      }})
    })).rejects.toMatchObject({code: "E_CANCELLED"});
    expect(closed).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  } finally {clearTimeout(timer);}
});

it("preserves closures and multiple return values across host-controlled VM yields", async () => {
  const cooperate = vi.fn(async () => {await Promise.resolve();});
  const source = `
    local total = 0
    local function add(i) total = total + i; return total, i end
    for i = 1, 5000 do local sum, value = add(i); assert(sum == total and value == i) end
    return {Str = function(el) total = total + 1; el.text = el.text .. tostring(total); return el end}
  `;
  await expect(convert(input, options, {yield: cooperate,
    filters: createLuaFilterCapability({readFile: async () => encoder.encode(source)})
  })).resolves.toMatchObject({text: "<p>Hello12502501 <em>world12502502</em></p>\n"});
  expect(cooperate.mock.calls.length).toBeGreaterThan(30);
});

it("preserves Lua callbacks invoked across native string and table library boundaries", async () => {
  const source = `
    local values = {}
    for i = 200, 1, -1 do values[#values + 1] = i end
    table.sort(values, function(a, b)
      local n = 0; for i = 1, 20 do n = n + 1 end
      assert(n == 20); return a < b
    end)
    assert(values[1] == 1 and values[200] == 200)
    return {Str = function(el)
      el.text = string.gsub(el.text, "(.)", function(c)
        local n = 0; for i = 1, 100 do n = n + 1 end
        assert(n == 100); return string.upper(c)
      end)
      return el
    end}
  `;
  await expect(convert(input, options, {filters: createLuaFilterCapability({readFile: async () => encoder.encode(source)})}))
    .resolves.toMatchObject({text: "<p>HELLO <em>WORLD</em></p>\n"});
});
