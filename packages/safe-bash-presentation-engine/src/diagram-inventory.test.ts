import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readSelectionIndex } from "./index.js";

const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const context = {
  limits: { maxBytes: 65536, maxReads: 100, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 65536,
    maxMembers: 50,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 30 },
  relationshipLimits: { maxBytes: 8192, maxParts: 50, maxRelationships: 50 }
};
const types = {
  data: "application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml",
  layout: "application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml",
  style: "application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml",
  colors: "application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml",
  drawing: "application/vnd.ms-office.drawingml.diagramDrawing+xml"
};
function fixture(fallbackOnly = false, reverse = false) {
  const entries: { name: string; bytes: Uint8Array }[] = [];
  const xml = (name: string, value: string) =>
    entries.push({ name, bytes: new TextEncoder().encode(value) });
  const rels = (owner: string, rows: [string, string, string][]) =>
    xml(
      `_rels/${owner}.rels`,
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("")}</Relationships>`
    );
  xml(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/>${Object.entries(
      types
    )
      .filter(([kind]) => !fallbackOnly || kind === "drawing")
      .map(([kind, type]) => `<Override PartName="/${kind}.xml" ContentType="${type}"/>`)
      .join("")}</Types>`
  );
  rels("", [["main", `${r}/officeDocument`, "deck.xml"]]);
  xml(
    "deck.xml",
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${r}"/>`
  );
  xml(
    "drawing.xml",
    '<d:drawing xmlns:d="http://schemas.microsoft.com/office/drawing/2008/diagram"/>'
  );
  xml("image.xml", "<image/>");
  rels("drawing.xml", [
    ["image", `${r}/image`, "image.xml"],
    ["lost", `${r}/image`, "missing.bin"]
  ]);
  if (!fallbackOnly) {
    for (const kind of ["data", "layout", "style", "colors"])
      xml(
        `${kind}.xml`,
        '<d:resource xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>'
      );
    for (const name of ["first", "second"]) {
      xml(`${name}.xml`, "<owner/>");
      rels(`${name}.xml`, [
        ["data", `${r}/diagramData`, "data.xml"],
        ["style", `${r}/diagramQuickStyle`, "style.xml"],
        ["colors", `${r}/diagramColors`, "colors.xml"],
        ["layout", `${r}/diagramLayout`, "layout.xml"]
      ]);
    }
    rels("data.xml", [
      [
        "fallback",
        "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing",
        "drawing.xml"
      ]
    ]);
    rels("image.xml", [["cycle", `${r}/diagramData`, "data.xml"]]);
  }
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.pptx", storedArchive(reverse ? entries.reverse() : entries));
  return new Uint8Array(volume.readFileSync("/input.pptx") as Buffer);
}

describe("diagram resource inventory", () => {
  it.each([false, true])(
    "lists shared appearance resources and bounded cyclic closure, reversed %s",
    async (reverse) => {
      const index = await readSelectionIndex(fixture(false, reverse), context);
      expect(index.inventory).toMatchObject({
        diagrams: [
          {
            part: "/colors.xml",
            kind: "colors",
            owners: ["/first.xml", "/second.xml"],
            dependencies: [],
            missing: [],
            semanticEditing: false
          },
          {
            part: "/data.xml",
            kind: "data",
            owners: ["/first.xml", "/image.xml", "/second.xml"],
            dependencies: ["/drawing.xml", "/image.xml"],
            missing: ["/missing.bin"],
            semanticEditing: false
          },
          {
            part: "/drawing.xml",
            kind: "drawing",
            owners: ["/data.xml"],
            dependencies: ["/data.xml", "/image.xml"],
            missing: ["/missing.bin"],
            semanticEditing: false
          },
          {
            part: "/layout.xml",
            kind: "layout",
            owners: ["/first.xml", "/second.xml"],
            dependencies: [],
            missing: [],
            semanticEditing: false
          },
          {
            part: "/style.xml",
            kind: "style",
            owners: ["/first.xml", "/second.xml"],
            dependencies: [],
            missing: [],
            semanticEditing: false
          }
        ]
      });
    }
  );
  it("reports fallback-only drawing without inventing a data model", async () => {
    const index = await readSelectionIndex(fixture(true), context);
    expect(index.inventory).toMatchObject({
      diagrams: [
        {
          part: "/drawing.xml",
          kind: "drawing",
          owners: [],
          dependencies: ["/image.xml"],
          missing: ["/missing.bin"],
          semanticEditing: false
        }
      ]
    });
  });
});
