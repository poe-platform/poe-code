import { it, expect } from "vitest";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
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
it("creates complete declared core metadata using supplied values only", async () => {
  const bytes = await createPresentation(
    {
      properties: {
        category: "Research",
        content_status: "Reviewed",
        identifier: "ID-4",
        language: "en",
        version: "2"
      }
    },
    context
  );
  const xml = new TextDecoder().decode(
    inspectZip(bytes).find((e) => e.name === "docProps/core.xml")!.payload
  );
  for (const tag of [
    "<cp:category>Research</cp:category>",
    "<cp:contentStatus>Reviewed</cp:contentStatus>",
    "<dc:identifier>ID-4</dc:identifier>",
    "<dc:language>en</dc:language>",
    "<cp:version>2</cp:version>"
  ])
    expect(xml).toContain(tag);
  expect(xml).not.toContain("dcterms:created>");
  expect(xml).not.toContain("dc:creator>");
});
