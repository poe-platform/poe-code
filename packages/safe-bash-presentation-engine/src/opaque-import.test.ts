import { Volume } from "memfs";
import { expect, it } from "vitest";
import { createPresentation, importSlides } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";
const context = {
  limits: { maxBytes: 1000000, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 1000000,
    maxEntryBytes: 100000,
    maxTotalBytes: 1000000,
    maxMembers: 100,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 100000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 100000, maxNodes: 10000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 100000, maxParts: 100, maxRelationships: 200 }
};
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
it.each([
  ["oleObject", "application/vnd.openxmlformats-officedocument.oleObject"],
  ["package", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["control", "application/vnd.ms-office.activeX+xml"],
  [
    "http://schemas.microsoft.com/office/2011/relationships/webextension",
    "application/vnd.ms-office.webextension+xml"
  ],
  ["http://schemas.microsoft.com/office/2017/06/relationships/model3d", "model/gltf-binary"],
  ["font", "application/x-fontdata"],
  ["embedded-font-declaration", "application/x-fontdata"],
  ["urn:unsupported-reference", "application/octet-stream"]
])("rejects an import containing unresolved %s object references", async (kind, type) => {
  const bytes = await createPresentation({ slides: [{ name: "Opaque content" }] }, context);
  const volume = Volume.fromJSON({ "/source": Buffer.from(bytes) });
  const original = new Uint8Array(volume.readFileSync("/source") as Buffer);
  const parts = new Map<string, Uint8Array>(
    inspectZip(original).map((part) => [part.name, part.payload])
  );
  const insert = (name: string, markup: string) => {
    const xml = parseXmlPart(parts.get(name)!, context.xmlLimits);
    parts.set(name, xml.spliceChildren(xml.root, xml.root.children.length, 0, [markup]).bytes());
  };
  insert(
    "[Content_Types].xml",
    `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/embeddings/opaque.bin" ContentType="${type}"/>`
  );
  insert(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="opaque" Type="${kind.includes(":") ? kind : `${r}/${kind}`}" Target="../embeddings/opaque.bin"/>`
  );
  parts.set("ppt/embeddings/opaque.bin", new Uint8Array([208, 207, 17, 224, 161, 177, 26, 225]));
  if (kind === "embedded-font-declaration")
    insert(
      "ppt/presentation.xml",
      `<p:embeddedFontLst xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:embeddedFont><p:font typeface="Original Face"/></p:embeddedFont></p:embeddedFontLst>`
    );
  const source = storedArchive([...parts].map(([name, bytes]) => ({ name, bytes })));
  const originalSnapshot = original.slice();
  const sourceSnapshot = source.slice();
  await expect(
    importSlides(original, source, { sourceSlides: [1] }, context)
  ).rejects.toMatchObject({ code: "unsupported-edit" });
  expect(original).toEqual(originalSnapshot);
  expect(source).toEqual(sourceSnapshot);
});
