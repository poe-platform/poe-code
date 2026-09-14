import { expect, it } from "vitest";
import { Volume } from "memfs";
import { editDocumentNotes, inspectDocumentNotes } from "./notes.js";
import { paragraph, run, textContext, textFixture, w } from "../tests/fixtures/text.js";

it("renumbers an inserted earlier reference using its final document position", async () => {
  const input = await textFixture(paragraph("Opening") + `<w:p>${run("Closing")}<w:r><w:footnoteReference w:id="9"/></w:r></w:p>`, {
    footnotes: { kind: "footnotes", xml: `<w:footnotes xmlns:w="${w}"><w:footnote w:id="-1" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="0" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="9">${paragraph("Existing later note")}</w:footnote></w:footnotes>` }
  });
  const volume = Volume.fromJSON({ "/output": "" });
  await editDocumentNotes(input, { operation: "notes.add", options: { kind: "footnote", paragraph: 1, text: "Inserted earlier note", renumber: "document-order", output: "-" } },
    { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/output", bytes); } } });
  const result = await inspectDocumentNotes(new Uint8Array(volume.readFileSync("/output") as Buffer), { operation: "notes.list", options: {} }, textContext);
  expect(result.items.map(note => [note.id, note.text])).toEqual([[1, "Inserted earlier note"], [2, "Existing later note"]]);
});

it("does not widen a single-reference policy when selecting all note bodies", async () => {
  const input = await textFixture('<w:p><w:r><w:footnoteReference w:id="4"/></w:r><w:r><w:footnoteReference w:id="4"/></w:r></w:p>', {
    footnotes: { kind: "footnotes", xml: `<w:footnotes xmlns:w="${w}"><w:footnote w:id="4">${paragraph("Shared coastal source")}</w:footnote></w:footnotes>` }
  });
  await expect(editDocumentNotes(input, { operation: "notes.remove", options: { all: true, references: "single", dryRun: true } },
    { ...textContext, encoding: { order: "input", compression: "store" } })).rejects.toMatchObject({ code: "ambiguous-selection" });
});
