import { Volume } from "memfs";
import { createPresentation } from "../../src/creation.js";
import { inspectZip } from "../zip-reader.js";
import { storedArchive } from "./archive.js";
import { parseXmlPart } from "../../src/xml.js";
export const context = {
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
const ns = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
export async function deck(authorOnly = false) {
  const entries = new Map<string, Uint8Array>(
    inspectZip(await createPresentation({ slides: [{}] }, context)).map((e) => [e.name, e.payload])
  );
  const add = (path: string, xml: string) => entries.set(path, new TextEncoder().encode(xml));
  for (const [path, target, kind] of [
    ["ppt/_rels/presentation.xml.rels", "authors.xml", "authors"],
    ["ppt/slides/_rels/slide1.xml.rels", "../review.xml", "comments"]
  ]) {
    const doc = parseXmlPart(entries.get(path!)!, context.xmlLimits);
    entries.set(
      path!,
      doc
        .spliceChildren(doc.root, doc.root.children.length, 0, [
          `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="review" Type="http://schemas.microsoft.com/office/2018/10/relationships/${kind}" Target="${target}"/>`
        ])
        .bytes()
    );
  }
  const types = parseXmlPart(entries.get("[Content_Types].xml")!, context.xmlLimits);
  entries.set(
    "[Content_Types].xml",
    types
      .spliceChildren(
        types.root,
        types.root.children.length,
        0,
        ["authors", "comments"].map(
          (kind, i) =>
            `<Override xmlns="${types.root.name.namespace}" PartName="/ppt/${i ? "review" : "authors"}.xml" ContentType="application/vnd.ms-powerpoint.${kind}+xml"/>`
        )
      )
      .bytes()
  );
  add(
    "ppt/authors.xml",
    `<m:authorLst xmlns:m="${ns}"><m:author id="{10000000-0000-0000-0000-000000000001}" name="Rowan" userId="rowan@example.test" providerId="directory"/></m:authorLst>`
  );
  add(
    "ppt/review.xml",
    `<m:cmLst xmlns:m="${ns}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:rx="http://schemas.microsoft.com/office/powerpoint/2022/03/main"><m:cm id="{20000000-0000-0000-0000-000000000001}" authorId="{10000000-0000-0000-0000-000000000001}" created="2031-01-02T03:04:05Z"><m:unknownAnchor/><m:pos x="12700" y="-50"/><m:replyLst><m:reply id="{30000000-0000-0000-0000-000000000001}" authorId="{40000000-0000-0000-0000-000000000001}" created="2031-01-02T04:00:00Z"><m:txBody><a:p><a:r><a:t>Answer</a:t></a:r></a:p></m:txBody></m:reply></m:replyLst><m:txBody><a:p><a:r><a:t>Review &amp; refine</a:t></a:r><a:br/><a:r><a:t>Next</a:t></a:r></a:p><a:p><a:r><a:t>Last</a:t></a:r></a:p></m:txBody><m:extLst><p:ext uri="review"><rx:reactions><rx:rxn type="👍"><rx:instance authorId="{40000000-0000-0000-0000-000000000001}" time="2031-01-02T05:00:00Z"/></rx:rxn></rx:reactions><u:mention xmlns:u="urn:original:unknown" person="external-person"/></p:ext></m:extLst></m:cm></m:cmLst>`
  );
  if (authorOnly) {
    entries.delete("ppt/review.xml");
    for (const [path, key, value] of [
      ["ppt/slides/_rels/slide1.xml.rels", "Id", "review"],
      ["[Content_Types].xml", "PartName", "/ppt/review.xml"]
    ]) {
      const doc = parseXmlPart(entries.get(path!)!, context.xmlLimits);
      const at = doc.root.children.findIndex((n) =>
        n.attributes.some((a) => a.name.localName === key && a.value === value)
      );
      entries.set(path!, doc.spliceChildren(doc.root, at, 1, []).bytes());
    }
  }
  const volume = Volume.fromJSON({});
  volume.writeFileSync(
    "/review.pptx",
    storedArchive([...entries].map(([name, bytes]) => ({ name, bytes })))
  );
  return new Uint8Array(volume.readFileSync("/review.pptx") as Buffer);
}
