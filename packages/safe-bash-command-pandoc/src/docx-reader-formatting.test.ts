import "safe-bash-docx-engine";
import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {convert} from "./engine.js";

// Pandoc 3.10.1 DOCX generated from:
// ~~gone~~ H~2~O and x^2^.
//
// ***~~~sub~~~*** and ***~~^sup^~~***.
//
// `<w:r><w:rPr><w:strike w:val="false"/><w:vertAlign w:val="baseline"/></w:rPr><w:t>plain</w:t></w:r>`{=openxml}
// JSON and HTML fixtures are native Pandoc's DOCX reader output (--wrap=none).
const bytes = readFileSync(new URL("./fixtures/run-formatting.docx", import.meta.url));

it.each(["json", "html"] as const)("preserves DOCX strikeout and script formatting with native %s parity", async to => {
  const result = await convert([{bytes}], {from: "docx", to}, {});
  if (result.kind !== "text") throw new Error("Expected text");
  const expected = readFileSync(new URL(`./fixtures/run-formatting.${to}`, import.meta.url), "utf8");
  if (to === "json") expect(JSON.parse(result.text)).toEqual(JSON.parse(expected));
  else expect(result.text).toBe(expected);
});
