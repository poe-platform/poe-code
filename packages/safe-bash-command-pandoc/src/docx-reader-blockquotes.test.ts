import "safe-bash-docx-engine";
import {readFileSync} from "node:fs";
import {expect, it} from "vitest";
import {Document} from "safe-bash-docx-engine/pandoc-adapter";
import {convert} from "./engine.js";

// Pandoc 3.10.1 DOCX generated from:
// Before.
//
// > Quoted *line*.
// >
// > Second paragraph.
// >
// >> Nested quote.
//
// After.
//
// > Separate quote.
// Native DOCX flattens nested quotes and groups adjacent quote paragraphs.
// JSON and HTML are native DOCX reader output (--wrap=none).
const bytes = readFileSync(new URL("./fixtures/blockquote.docx", import.meta.url));

it.each(["json", "html"] as const)("recovers DOCX blockquotes with native %s parity", async to => {
  const result = await convert([{bytes}], {from: "docx", to}, {});
  if (result.kind !== "text") throw new Error("Expected text");
  const expected = readFileSync(new URL(`./fixtures/blockquote.${to}`, import.meta.url), "utf8");
  if (to === "json") expect(JSON.parse(result.text)).toEqual(JSON.parse(expected));
  // The HTML writers differ only in the newline after the opening quote tag.
  else expect(result.text.replaceAll("<blockquote>\n", "<blockquote>")).toBe(expected.replaceAll("<blockquote>\n", "<blockquote>"));
});

it.each([720, 360, 0, -720])("recognizes positive paragraph indentation (%s twips)", async indent => {
  const model = await Document(bytes);
  for (const paragraph of model.paragraphs) {
    if (paragraph.style?.style_id !== "BlockText") continue;
    paragraph.style = "Normal";
    paragraph.paragraph_format.left_indent = {value: indent, unit: "twip"};
  }
  const chunks: Uint8Array[] = [];
  await model.save({async write(bytes) {chunks.push(bytes.slice());}});
  const result = await convert([{bytes: Buffer.concat(chunks)}], {from: "docx", to: "json"}, {});
  if (result.kind !== "text") throw new Error("Expected JSON");
  expect(JSON.parse(result.text).blocks.map((block: {t: string}) => block.t)).toEqual(indent > 0
    ? ["Para", "BlockQuote", "Para", "BlockQuote"]
    : ["Para", "Para", "Para", "Para", "Para", "Para"]);
});
