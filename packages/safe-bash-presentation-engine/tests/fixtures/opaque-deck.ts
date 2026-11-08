import { storedArchive } from "./archive.js";

export const opaqueContext = {
  limits: { maxBytes: 131072, maxReads: 1000, chunkBytes: 8192 },
  archiveLimits: { maxArchiveBytes: 131072, maxEntryBytes: 32768, maxTotalBytes: 131072, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 32768, chunkSize: 8192 },
  xmlLimits: { maxBytes: 32768, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 32768, maxParts: 64, maxRelationships: 64 }
};

export function opaqueDeck() {
  const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const relationship = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const payload = new Uint8Array([208, 207, 17, 224, 161, 177, 26, 225, 0, 255, 19]);
  const parts = new Map<string, string | Uint8Array>([
    ["_rels/.rels", rels(relationship("doc", `${r}/officeDocument`, "ppt/presentation.xml"))],
    ["ppt/presentation.xml", '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'],
    ["ppt/_rels/presentation.xml.rels", rels(relationship("object", `${r}/oleObject`, "embeddings/capsule.bin") + relationship("font", `${r}/font`, "fonts/family.fntdata"))],
    ["ppt/embeddings/capsule.bin", payload],
    ["ppt/embeddings/_rels/capsule.bin.rels", rels(relationship("preview", `${r}/image`, "../media/preview.bin"))],
    ["ppt/media/preview.bin", new Uint8Array([137, 0, 254, 42])],
    ["ppt/fonts/family.fntdata", new Uint8Array([0, 1, 0, 0, 9, 128])],
    ["[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/embeddings/capsule.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/><Override PartName="/ppt/fonts/family.fntdata" ContentType="application/x-fontdata"/></Types>']
  ]);
  const members = [...parts].map(([name, content]) => ({ name, bytes: typeof content === "string" ? new TextEncoder().encode(content) : content }));
  return { bytes: storedArchive(members), members, payload };
}
