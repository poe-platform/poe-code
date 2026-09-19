import { expect, it } from "vitest";
import { Volume } from "memfs";
import { writeArchive } from "../src/index.js";
import { textContext, textFixture } from "./fixtures/text.js";
import { readPackage, assertPackageLinks } from "./assertions.js";

for (const strict of [false, true]) for (const kind of ["document", "template"])
for (const retained of [false, true])
it(`checks OPC edges independently with retained XML=${retained}; ${kind}; strict=${strict}`, async () => {
  const parts = readPackage(await textFixture("<w:p/>", {}, strict));
  if (kind === "template") parts.set("[Content_Types].xml", new TextEncoder().encode(
    new TextDecoder().decode(parts.get("[Content_Types].xml")).replace("document.main+xml", "template.main+xml")));
  if (retained) for (const name of ["_rels/.rels", "word/_rels/document.xml.rels"])
    parts.set(name, new TextEncoder().encode(new TextDecoder().decode(parts.get(name))
      .replace(">", "><!--original retained--><?policy keep?>")));
  const volume = Volume.fromJSON({ "/archive": "" });
  await writeArchive({ comment: new Uint8Array(), members: [...parts].map(([name, bytes]) =>
    ({ name, bytes, directory: false, modified: new Date("2026-01-02T03:04:06Z") })) },
  { async write(bytes) { volume.appendFileSync("/archive", bytes); } }, { order: "input", compression: "store" }, textContext);
  const saved = readPackage(new Uint8Array(volume.readFileSync("/archive") as Buffer));
  expect(() => assertPackageLinks(saved)).not.toThrow();
  for (const [name, bytes] of parts) expect(saved.get(name), name).toEqual(bytes);
  const wrong = new Map(saved);
  wrong.set("_rels/.rels", new TextEncoder().encode(new TextDecoder().decode(saved.get("_rels/.rels"))
    .replace("word/document.xml", "word/missing.xml")));
  expect(() => assertPackageLinks(wrong)).toThrow("missing target");
  const wrongElement = new Map(saved);
  wrongElement.set("word/_rels/document.xml.rels", new TextEncoder().encode(
    new TextDecoder().decode(saved.get("word/_rels/document.xml.rels")).replace("</Relationships>", "<Unexpected/></Relationships>")));
  expect(() => assertPackageLinks(wrongElement)).toThrow("relationship element");
});
