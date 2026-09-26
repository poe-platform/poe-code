import {expect, it, vi} from "vitest";
import {convert, createLuaFilterCapability, createPandocCommand} from "./index.js";

const encoder = new TextEncoder();
const options = {from: "commonmark", to: "html", filters: [{kind: "lua" as const, path: "uppercase.lua"}]};
const input = [{bytes: encoder.encode("Hello *world*")}];

it.each([
  'function Str(el) el.text = string.upper(el.text); return el end',
  'return {Str = function(el) el.text = string.upper(el.text); return el end}'
])("executes genuine Lua Str callbacks, including nested inlines", async source => {
  const load = vi.fn(async () => encoder.encode(source));
  const result = await convert(input, options, {filters: createLuaFilterCapability(load)});
  expect(result).toMatchObject({kind: "text", text: "<p>HELLO <em>WORLD</em></p>\n"});
  expect(load).toHaveBeenCalledWith("uppercase.lua", undefined);
});

it("preserves a Str when its callback returns nil", async () => {
  const result = await convert(input, options, {filters: createLuaFilterCapability(async () => encoder.encode('function Str(el) el.text = "changed" end'))});
  expect(result).toMatchObject({text: "<p>Hello <em>world</em></p>\n"});
});

it.each(["html", "html5"])("exposes the target writer %s to loader Lua filters", async to => {
  const result = await convert([{bytes: encoder.encode("Hello")}], {...options, to}, {
    filters: createLuaFilterCapability(async () => encoder.encode('local writer = FORMAT; function Str(el) el.text = writer; return el end'))
  });
  expect(result).toMatchObject({text: `<p>${to}</p>\n`});
});

it.each([
  ['syntax', 'function Str(', "E_IO"],
  ['runtime', 'function Str(el) error("broken") end', "E_IO"],
  ['invalid result', 'function Str(el) return 123 end', "E_AST"],
  ['unsupported callback', 'function Para(el) return el end', "E_UNSUPPORTED_FEATURE"],
  ['mixed callbacks', 'function Str(el) return el end; function Para(el) return el end', "E_UNSUPPORTED_FEATURE"],
  ['host IO', 'function Str(el) return io.open("/etc/passwd") end', "E_IO"],
  ['host loading', 'function Str(el) return dofile("/etc/passwd") end', "E_IO"]
])("rejects %s without publishing", async (_name, source, code) => {
  const publish = vi.fn();
  await expect(convert(input, options, {filters: createLuaFilterCapability(async () => encoder.encode(source)), output: {publish}})).rejects.toMatchObject({code});
  expect(publish).not.toHaveBeenCalled();
});

it("terminates an infinite Lua loop at the conversion work limit", async () => {
  await expect(convert(input, options, {limits: {work: 5000}, filters: createLuaFilterCapability(async () => encoder.encode('function Str(el) while true do end end'))})).rejects.toMatchObject({code: "E_LIMIT"});
});

it("checks cancellation after script acquisition", async () => {
  const controller = new AbortController();
  await expect(convert(input, options, {signal: controller.signal, filters: createLuaFilterCapability(async (_path, signal) => {
    expect(signal).toBe(controller.signal);
    controller.abort();
    return encoder.encode('function Str(el) return el end');
  })})).rejects.toMatchObject({code: "E_CANCELLED"});
});

it.each([{flags: ["-L", "uppercase.lua"]}, {flags: ["--lua-filter=uppercase.lua"]}])("runs the Lua flag $flags through the byte command adapter", async ({flags}) => {
  let text = "";
  const command = createPandocCommand({filters: createLuaFilterCapability(async () => encoder.encode('function Str(el) el.text = string.upper(el.text); return el end'))});
  const result = await command.execute({
    args: ["-f", "commonmark", "-t", "html", ...flags],
    stdin: [encoder.encode("Hello")],
    signal: new AbortController().signal,
    stdout: {async write(bytes) {text += new TextDecoder().decode(bytes);}},
    stderr: {async write() {throw new Error("Unexpected stderr");}}
  });
  expect(result.exitCode).toBe(0);
  expect(text).toBe("<p>HELLO</p>\n");
});
