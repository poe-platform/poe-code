import {expect, it} from "vitest";
import {convert} from "./engine.js";
import {createLuaFilterCapability} from "./lua-filters.js";

it("executes a returned Lua Str filter table with local closures", async () => {
  const source = new TextEncoder().encode('local suffix = "!"; return {Str = function(el) el.text = string.upper(el.text) .. suffix; return el end}');
  const filters = createLuaFilterCapability({readFile: async () => source});
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], {
    from: "commonmark", to: "html", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters})).resolves.toMatchObject({text: "<p>HELLO!</p>\n"});
});

it.each(['return {Para = function(el) return el end}', 'return {{Str = function(el) return el end}}', 'return 42'])("rejects unsupported returned filters: %s", async script => {
  const filters = createLuaFilterCapability({readFile: async () => new TextEncoder().encode(script)});
  await expect(convert([{bytes: new TextEncoder().encode("Hello")}], {
    from: "commonmark", to: "html", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters})).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
});
