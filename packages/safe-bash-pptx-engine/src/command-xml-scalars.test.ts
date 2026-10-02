import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { readShapes } from "./shape-operations.js";
import { readPackage } from "./package-reader.js";
import { parseXmlPart } from "./xml.js";
import { storedArchive } from "../tests/fixtures/archive.js";
const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 262144,
    maxEntryBytes: 65536,
    maxTotalBytes: 262144,
    maxMembers: 64,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 65536,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
it("reads measured coordinates consistently through SDK and shape commands", async () => {
  const archive = await readPackage(await createPresentation({ slides: [{}] }, context), context);
  const part = "/ppt/slides/slide1.xml";
  const xml = parseXmlPart(archive.get(part), context.xmlLimits);
  const tree = xml.root.children[0]!.children.find((child) => child.name.localName === "spTree")!;
  const next = xml.spliceChildren(tree, tree.children.length, 0, [
    '<p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:nvSpPr><p:cNvPr id="2" name="Measured"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1.2in" y="-42pt"/><a:ext cx="100" cy="200"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp>'
  ]);
  const bytes = storedArchive(
    archive.names.map((name) => ({
      name: name.slice(1),
      bytes: name === part ? next.bytes() : archive.get(name)
    }))
  );
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/measured.pptx", bytes);
  const sdk = await readShapes(bytes, { slide: 1, shape: "Measured" }, context);
  expect(sdk[0]!.geometry?.corners[0]).toEqual({ x: 1097280, y: -533400 });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 262144
  });
  const result = await engine.execute({
    args: ["shapes", "get", "/measured.pptx", "--slide", "1", "--shape", "Measured", "--json"].map(
      (arg) => new TextEncoder().encode(arg)
    ),
    signal: new AbortController().signal,
    readInput: async (path) => new Uint8Array(fs.readFileSync(path) as Buffer),
    publishOutput: async () => {
      throw new Error("Read must not publish.");
    }
  });
  expect(result.exitCode).toBe(0);
  expect(
    JSON.parse(new TextDecoder().decode(result.stdout)).data.records[0].geometry.corners[0]
  ).toEqual({ x: 1097280, y: -533400 });
});
