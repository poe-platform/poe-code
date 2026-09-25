import {expect, it} from "vitest";
import {convert} from "./engine.js";
import {createLuaFilterCapability} from "./lua-filters.js";

it.each([
  'function Str(el) Str = nil; el.text = string.upper(el.text); return el end',
  'function Str(el) Str = function(other) other.text = "WRONG"; return other end; el.text = string.upper(el.text); return el end',
  'return {Str = function(el) Str = nil; el.text = string.upper(el.text); return el end}'
])("keeps the loaded callback identity when a filter changes globals: %s", async script => {
  const filters = createLuaFilterCapability({readFile: async () => new TextEncoder().encode(script)});
  await expect(convert([{bytes: new TextEncoder().encode("Hello world")}], {
    from: "commonmark", to: "html", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters})).resolves.toMatchObject({text: "<p>HELLO WORLD</p>\n"});
});
