import {expect, it} from "vitest";
import {convert} from "./engine.js";

it.each(["json", "plain", "html5"])("preserves details paragraph boundaries in %s output", async to => {
  const result = await convert([
    {bytes: new TextEncoder().encode("<details><summary>More</summary><p>Hidden</p></details>")}
  ], {from: "html", to}, {});
  if (result.kind !== "text") throw new Error("Expected text");
  if (to === "json") expect(JSON.parse(result.text).blocks).toEqual([
    {t: "Para", c: [{t: "Str", c: "More"}]},
    {t: "Para", c: [{t: "Str", c: "Hidden"}]}
  ]);
  else expect(result.text).toBe(to === "plain" ? "More\n\nHidden\n" : "<p>More</p>\n<p>Hidden</p>\n");
});
