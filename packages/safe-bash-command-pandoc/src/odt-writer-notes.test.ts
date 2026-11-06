import {expect, it} from "vitest";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {SaxesParser} from "saxes";
import {convert} from "./engine.js";

it("writes numbered ODT footnotes with formatted, multi-block bodies", async () => {
  const source = "Text with a note[^1] and another[^2].\n\n[^1]: Footnote **text** & &lt;value&gt;.\n\n    Second paragraph.\n\n[^2]: Other *note*.\n";
  const result = await convert([{bytes: new TextEncoder().encode(source)}], {from: "markdown", to: "odt"}, {});
  if (result.kind !== "binary") throw new Error("Expected ODT");
  const xml = new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("content.xml"));
  const notes: {id: string; noteClass: string; citation: string; paragraphs: number}[] = [];
  let citation = false;
  const parser = new SaxesParser({xmlns: true});
  parser.on("opentag", tag => {
    if (tag.name === "text:note") notes.push({id: tag.attributes["text:id"]?.value ?? "", noteClass: tag.attributes["text:note-class"]?.value ?? "", citation: "", paragraphs: 0});
    if (tag.name === "text:note-citation") citation = true;
    if (tag.name === "text:p" && notes.length) notes.at(-1)!.paragraphs++;
  });
  parser.on("text", value => {if (citation) notes.at(-1)!.citation += value;});
  parser.on("closetag", tag => {if (tag.name === "text:note-citation") citation = false;});
  parser.write(xml).close();
  expect(notes).toEqual([
    {id: "ftn1", noteClass: "footnote", citation: "1", paragraphs: 2},
    {id: "ftn2", noteClass: "footnote", citation: "2", paragraphs: 1}
  ]);
  expect(xml).toContain('<text:span text:style-name="Strong">text</text:span>');
  expect(xml).toContain('<text:span text:style-name="Emph">note</text:span>');
  expect(xml).toContain('&amp;<text:s/>&lt;value&gt;');
  expect(xml).toContain('<text:note-body><text:p>Footnote');
});
