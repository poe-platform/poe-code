import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {convert} from "./engine.js";

it("preserves inline code when writing Markdown to ODT", async () => {
  const source = "A **bold** *italic* `a < b & c` [link](https://example.com).";
  const odt = await convert([{bytes: new TextEncoder().encode(source)}], {from: "markdown", to: "odt"}, {});
  if (odt.kind !== "binary") throw new Error("Expected ODT");
  const html = await convert([{bytes: odt.bytes}], {from: "odt", to: "html"}, {});
  expect(html).toMatchObject({text: '<p>A <strong>bold</strong> <em>italic</em> <code>a &lt; b &amp; c</code> <a href="https://example.com">link</a>.</p>\n'});
});

// Pandoc 3.10.1: A **bold** *italic* `code` [link](https://example.com).
// The nested fixture adds repeated spaces, a tab, a line break, bold and code spans inside code.
// Native Pandoc splits text into Str/Space; our ODT reader preserves text runs.
function textRuns(value: unknown): unknown {
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      const normalized = textRuns(item);
      if (typeof normalized === "string" && typeof result.at(-1) === "string") result[result.length - 1] += normalized;
      else result.push(normalized);
    }
    return result;
  }
  if (value && typeof value === "object") {
    if ("t" in value && value.t === "Str" && "c" in value) return value.c;
    if ("t" in value && value.t === "Space") return " ";
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, textRuns(item)]));
  }
  return value;
}

it.each(["inline-code", "inline-code-nested"])("preserves native ODT code in JSON and HTML: %s", async name => {
  const bytes = readFileSync(new URL(`./fixtures/${name}.odt`, import.meta.url));
  const json = await convert([{bytes}], {from: "odt", to: "json"}, {});
  if (json.kind !== "text") throw new Error("Expected JSON");
  const native = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
  expect(textRuns(JSON.parse(json.text).blocks)).toEqual(textRuns(native.blocks));
  const html = await convert([{bytes}], {from: "odt", to: "html"}, {});
  expect(html).toMatchObject({text: readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8")});
});
