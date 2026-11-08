import {expect, it} from "vitest";
import {convert} from "./engine.js";

it.each(["article", "footer", "nav"])("unwraps %s and its attributes in JSON and HTML output", async tag => {
  const bytes = new TextEncoder().encode(`<${tag} id="x" class="wrapper" data-label="ignored"><p>One</p><p>Two</p></${tag}>`);
  for (const to of ["json", "html5"]) {
    const result = await convert([{bytes}], {from: "html", to}, {});
    if (result.kind !== "text") throw new Error("Expected text");
    if (to === "json") expect(JSON.parse(result.text).blocks).toEqual([
      {t: "Para", c: [{t: "Str", c: "One"}]},
      {t: "Para", c: [{t: "Str", c: "Two"}]}
    ]);
    else expect(result.text).toBe("<p>One</p>\n<p>Two</p>\n");
  }
});

it("preserves surrounding blocks and nested content when unwrapping HTML containers", async () => {
  const result = await convert([{bytes: new TextEncoder().encode(
    '<p>Before</p><article><nav><p><em>One</em></p></nav><footer><p>Two</p></footer></article><div id="kept"><p>After</p></div>'
  )}], {from: "html", to: "html5"}, {});
  if (result.kind !== "text") throw new Error("Expected text");
  expect(result.text).toBe('<p>Before</p>\n<p><em>One</em></p>\n<p>Two</p>\n<div id="kept"><p>After</p>\n</div>\n');
});
