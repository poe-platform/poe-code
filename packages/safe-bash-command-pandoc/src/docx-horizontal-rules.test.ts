import "safe-bash-docx-engine";
import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {parseFragment, serialize} from "parse5";
import {convert, readDocument} from "./engine.js";

// Pandoc 3.10.1 DOCX from Before.\n\n---\n\nAfter., followed by a
// bottom-border-only paragraph and End. JSON/HTML are native reader output.
const bytes = readFileSync(new URL("./fixtures/horizontal-rules.docx", import.meta.url));

it.each(["json", "html"] as const)("reads VML and bottom-border DOCX rules with native %s parity", async to => {
  const result = await convert([{bytes}], {from: "docx", to}, {});
  if (result.kind !== "text") throw new Error("Expected text");
  const expected = readFileSync(new URL(`./fixtures/horizontal-rules.${to}`, import.meta.url), "utf8");
  if (to === "json") expect(JSON.parse(result.text)).toEqual(JSON.parse(expected));
  else expect(serialize(parseFragment(result.text))).toBe(serialize(parseFragment(expected)));
});

it("reads horizontal rules produced by the DOCX writer", async () => {
  const output = await convert([{bytes: new TextEncoder().encode("Before.\n\n---\n\nAfter.")}], {from: "markdown", to: "docx"}, {});
  if (output.kind !== "binary") throw new Error("Expected DOCX");
  const document = await readDocument({bytes: output.bytes}, {from: "docx"}, {});
  expect(document.blocks).toEqual([
    {t: "Para", c: [{t: "Str", c: "Before."}]},
    {t: "HorizontalRule"},
    {t: "Para", c: [{t: "Str", c: "After."}]}
  ]);
});
