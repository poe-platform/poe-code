import {expect, it, vi} from "vitest";
import {convert} from "./engine.js";
import {createLuaFilterCapability} from "./lua-filters.js";

const options = {from: "commonmark", to: "html", filters: [{kind: "lua" as const, path: "filter.lua"}]};
function filters(source: string) {
  return createLuaFilterCapability({readFile: async () => new TextEncoder().encode(source)});
}

it("executes the genuine pandoc.Str constructor", async () => {
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], options, {
    filters: filters("function Str(el) return pandoc.Str(string.upper(el.text)) end")
  })).resolves.toMatchObject({text: "<p>HELLO</p>\n"});
});

it("replaces a word with a list of constructed inline elements", async () => {
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], options, {
    filters: filters('function Str(el) return {pandoc.Str("Before"), pandoc.Space(), pandoc.Emph({el}), pandoc.Space(), pandoc.Str("After")} end')
  })).resolves.toMatchObject({text: "<p>Before <em>Hello</em> After</p>\n"});
});

it("deletes an element with an empty replacement list", async () => {
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], options, {
    filters: filters("function Str(el) return {} end")
  })).resolves.toMatchObject({text: "<p></p>\n"});
});

it("does not recursively apply Str to a generated replacement", async () => {
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], options, {
    filters: filters('function Str(el) return pandoc.Str(el.text .. "!") end')
  })).resolves.toMatchObject({text: "<p>Hello!</p>\n"});
});

it.each([
  'function Str(el) return 42 end',
  'function Str(el) return pandoc.Str(42) end',
  'function Str(el) return {pandoc.Str("ok"), 42} end',
  'function Str(el) return pandoc.Emph({42}) end'
])("rejects invalid constructed output before publication: %s", async source => {
  const publish = vi.fn();
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], options, {filters: filters(source), output: {publish}})).rejects.toMatchObject({code: "E_AST"});
  expect(publish).not.toHaveBeenCalled();
});

it("bounds cyclic constructed content", async () => {
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], options, {
    filters: filters('function Str(el) local x = pandoc.Emph({}); x.content[1] = x; return x end'), limits: {depth: 20}
  })).rejects.toMatchObject({code: "E_LIMIT"});
});
