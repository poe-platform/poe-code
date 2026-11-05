import {expect, it} from "vitest";
import {convert} from "./engine.js";

it.each(["section", "main", "aside", "header"])("preserves %s semantics in JSON and HTML", async tag => {
  for (const extra of [false, true]) {
    const input = {bytes: new TextEncoder().encode(`<${tag} id="x"${extra ? ' class="custom" title="Label"' : ""}><p>One</p></${tag}>`)};
    const classes = [...(tag === "main" ? [] : [tag]), ...(extra ? ["custom"] : [])];
    const pairs = [...(tag === "main" ? [["role", "main"]] : []), ...(extra ? [["title", "Label"]] : [])];
    const json = await convert([input], {from: "html", to: "json"}, {});
    if (json.kind !== "text") throw new Error("Expected text");
    expect(JSON.parse(json.text).blocks).toEqual([
      {t: "Div", c: [["x", classes, pairs], [{t: "Para", c: [{t: "Str", c: "One"}]}]]}
    ]);
    const htmlClasses = classes.filter(name => name !== "section");
    const outputTag = tag === "section" ? "section" : "div";
    const expected = `<${outputTag} id="x"${htmlClasses.length ? ` class="${htmlClasses.join(" ")}"` : ""}${pairs.map(([key, value]) => ` ${key}="${value}"`).join("")}><p>One</p>\n</${outputTag}>\n`;
    for (const source of [input, {bytes: new TextEncoder().encode(json.text)}]) {
      const result = await convert([source], {from: source === input ? "html" : "json", to: "html5"}, {});
      expect(result).toMatchObject({kind: "text", text: expected, diagnostics: []});
    }
  }
});
