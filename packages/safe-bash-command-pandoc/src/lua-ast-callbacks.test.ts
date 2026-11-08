import {expect, it} from "vitest";
import {convert} from "./engine.js";
import {createLuaFilterCapability} from "./lua-filters.js";

it.each([false, true])("supports block, inline, list, metadata and document callbacks (reader=%s)", async reader => {
  const script = `
    return {
      Header = function(el) return pandoc.Header(2, {pandoc.Str("Changed")}, el.attr) end,
      Emph = function(el) return pandoc.Str(pandoc.utils.stringify(el)) end,
      Para = function(el) return pandoc.Plain(el.content) end,
      Inlines = function(el) return el end,
      Blocks = function(el) return el end,
      Meta = function(meta) meta.title = pandoc.MetaString("Book"); return meta end,
      Pandoc = function(doc) doc.blocks:insert(pandoc.Para({pandoc.Code("done")})); return doc end
    }`;
  const load = async () => new TextEncoder().encode(script);
  const result = await convert([{bytes: new TextEncoder().encode("# Before\n\nHello *world*")}], {
    from: "commonmark", to: "html", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters: createLuaFilterCapability(reader ? {readFile: load} : load)});
  expect(result).toMatchObject({text: '<h2 id="changed">Changed</h2>\nHello world<p><code>done</code></p>\n'});
});

it("runs returned filter tables in order and supports block replacement lists", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("Hello")}], {
    from: "commonmark", to: "html", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters: createLuaFilterCapability(async () => new TextEncoder().encode(`return {
    {Para = function(el) return {el, pandoc.Para({pandoc.Str("Added")})} end},
    {Str = function(el) return pandoc.Str(string.upper(el.text)) end}
  }`))});
  expect(result).toMatchObject({text: "<p>HELLO</p>\n<p>ADDED</p>\n"});
});

it("preserves nil results and splices multiple replacements without overwriting following elements", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("one two three")}], {
    from: "commonmark", to: "html", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters: createLuaFilterCapability(async () => new TextEncoder().encode(`function Str(el)
    if el.text == "one" then return {pandoc.Str("A"), pandoc.Str("B")} end
    el.text = "discarded"
  end`))});
  expect(result).toMatchObject({text: "<p>AB two three</p>\n"});
});

it("runs inline callbacks before block callbacks and lets lists replace content", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("# heading\n\nbody")}], {
    from: "commonmark", to: "plain", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters: createLuaFilterCapability(async () => new TextEncoder().encode(`
    local count = 0
    function Str(el) count = count + 1 end
    function Header(el) assert(count == 2); return {} end
    function Inlines(xs) xs:insert(pandoc.Str("!")); return xs end
  `))});
  expect(result).toMatchObject({text: "body!\n"});
});

it("supports constructors for links, images, spans, blocks, raw content and lists", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("start")}], {
    from: "commonmark", to: "json", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters: createLuaFilterCapability(async () => new TextEncoder().encode(`function Pandoc(doc)
    return pandoc.Pandoc({
      pandoc.Div({pandoc.Para({
        pandoc.Link({pandoc.Str("link")}, "https://example.test", "title"),
        pandoc.Image({pandoc.Str("alt")}, "image.png"),
        pandoc.Span({pandoc.Str("span")}), pandoc.Strong({pandoc.Str("strong")}),
        pandoc.RawInline("html", "<br>")
      })}),
      pandoc.CodeBlock("code"), pandoc.RawBlock("html", "<hr>"),
      pandoc.BulletList({{pandoc.Plain({pandoc.Str("bullet")})}}),
      pandoc.OrderedList({{pandoc.Plain({pandoc.Str("ordered")})}})
    }, {title="Book", enabled=true})
  end`))});
  if (result.kind !== "text") throw new Error("Expected JSON");
  const ast = JSON.parse(result.text);
  expect(ast.blocks.map((b: {t: string}) => b.t)).toEqual(["Div", "CodeBlock", "RawBlock", "BulletList", "OrderedList"]);
  expect(ast.meta).toEqual({title: {t: "MetaString", c: "Book"}, enabled: {t: "MetaBool", c: true}});
});

it("visits table cells and preserves null short captions and column widths", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("| A | B |\n|---|---|\n| C | D |\n")}], {
    from: "markdown", to: "html", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters: createLuaFilterCapability(async () => new TextEncoder().encode(`
    function Table(el) el.identifier = "table"; return el end
    function Str(el) el.text = string.lower(el.text); return el end
  `))});
  expect(result).toMatchObject({kind: "text"});
  if (result.kind !== "text") throw new Error("Expected HTML");
  expect(result.text).toContain('id="table"');
  expect(result.text).toContain("a</th>");
  expect(result.text).toContain("d</td>");
});

it("exposes named attributes and accepts table reconstruction", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("| A |\n|---|\n| B |\n")}], {
    from: "markdown", to: "html", filters: [{kind: "lua", path: "filter.lua"}]
  }, {filters: createLuaFilterCapability(async () => new TextEncoder().encode(`
    function Table(el)
      el.attributes.role = "presentation"
      assert(el.attributes.role == "presentation")
      return pandoc.Table(el.caption, el.colspecs, el.head, el.bodies, el.foot, el.attr)
    end
  `))});
  if (result.kind !== "text") throw new Error("Expected HTML");
  expect(result.text).toContain('role="presentation"');
});

it("preserves nested empty metadata maps and rejects malformed callbacks", async () => {
  const options = {from: "commonmark", to: "json", filters: [{kind: "lua" as const, path: "filter.lua"}]};
  const input = [{bytes: new TextEncoder().encode("text")}];
  const result = await convert(input, options, {filters: createLuaFilterCapability(async () => new TextEncoder().encode('function Meta(m) m.empty = pandoc.MetaMap({}); return m end'))});
  if (result.kind !== "text") throw new Error("Expected JSON");
  expect(JSON.parse(result.text).meta.empty).toEqual({t: "MetaMap", c: {}});
  await expect(convert(input, options, {filters: createLuaFilterCapability(async () => new TextEncoder().encode('return {Header = 42}'))})).rejects.toMatchObject({code: "E_AST"});
});
