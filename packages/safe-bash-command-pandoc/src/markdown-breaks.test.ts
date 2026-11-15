import {expect, it} from "vitest";
import {convert} from "./engine.js";

async function render(text: string, from = "markdown", to = "json") {
  const result = await convert([{bytes: new TextEncoder().encode(text)}], {from, to}, {});
  if (result.kind !== "text") throw new Error("Expected text");
  return result.text;
}

it("preserves hard and soft breaks through Markdown and JSON", async () => {
  for (const [source, kind] of [
    ["First  \nSecond\n", "LineBreak"],
    ["First   \r\nSecond\r\n", "LineBreak"],
    ["First\\\nSecond\n", "LineBreak"],
    ["First\nSecond\n", "SoftBreak"]
  ]) {
    const wire = await render(source!);
    expect(JSON.parse(wire).blocks).toEqual([{t: "Para", c: [
      {t: "Str", c: "First"}, {t: kind}, {t: "Str", c: "Second"}
    ]}]);
    expect(JSON.parse(await render(wire, "json"))).toEqual(JSON.parse(wire));
    expect(await render(wire, "json", "html")).toBe(kind === "LineBreak" ? "<p>First<br>Second</p>\n" : "<p>First\nSecond</p>\n");
    expect(await render(wire, "json", "plain")).toBe(kind === "LineBreak" ? "First\nSecond\n" : "First Second\n");
    expect(await render(wire, "json", "markdown")).toBe(kind === "LineBreak" ? "First\\\nSecond\n" : "First\nSecond\n");
  }
});

it("keeps breaks inside emphasis and nested containers", async () => {
  const inlines = [{t: "Emph", c: [{t: "Str", c: "First"}, {t: "LineBreak"}, {t: "Str", c: "Second"}, {t: "SoftBreak"}, {t: "Str", c: "Third"}]}];
  expect(JSON.parse(await render("*First  \nSecond\nThird*\n")).blocks).toEqual([{t: "Para", c: inlines}]);
  expect(JSON.parse(await render("> - *First  \n>   Second\n>   Third*\n")).blocks).toEqual([
    {t: "BlockQuote", c: [{t: "BulletList", c: [[{t: "Plain", c: inlines}]]}]}
  ]);
});

it("preserves paragraph boundaries, escaped backslashes and literal code", async () => {
  expect(JSON.parse(await render("First  \n\nSecond\\\n")).blocks).toEqual([
    {t: "Para", c: [{t: "Str", c: "First"}]}, {t: "Para", c: [{t: "Str", c: "Second\\"}]}
  ]);
  expect(JSON.parse(await render("First\\\\\nSecond\n")).blocks[0].c).toEqual([
    {t: "Str", c: "First\\"}, {t: "SoftBreak"}, {t: "Str", c: "Second"}
  ]);
  const escaped = "First\\\\\nSecond\n";
  expect(JSON.parse(await render(await render(escaped, "markdown", "markdown")))).toEqual(JSON.parse(await render(escaped)));
  expect(JSON.parse(await render("\\\n\\\nFirst\\\n")).blocks[0].c).toEqual([
    {t: "LineBreak"}, {t: "LineBreak"}, {t: "Str", c: "First\\"}
  ]);
  expect(JSON.parse(await render("`First  \nSecond`\n")).blocks[0].c).toEqual([{t: "Code", c: [["", [], []], "First   Second"]}]);
  expect(JSON.parse(await render("```\nFirst  \nSecond\\\n```\n")).blocks).toEqual([{t: "CodeBlock", c: [["", [], []], "First  \nSecond\\"]}]);
});

it("keeps leading, trailing and consecutive JSON breaks", async () => {
  const wire = JSON.stringify({"pandoc-api-version": [1, 23, 1, 2], meta: {}, blocks: [{t: "Para", c: [{t: "LineBreak"}, {t: "LineBreak"}, {t: "Str", c: "x"}, {t: "SoftBreak"}]}]});
  expect(JSON.parse(await render(wire, "json"))).toEqual(JSON.parse(wire));
  expect(await render(wire, "json", "html")).toBe("<p><br><br>x\n</p>\n");
});
