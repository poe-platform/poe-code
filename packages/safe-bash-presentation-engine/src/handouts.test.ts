import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { storedArchive } from "../tests/fixtures/archive.js";
import { readPresentationSettings, readSelectionIndex } from "./index.js";

const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const context = {
  limits: { maxBytes: 100000, maxReads: 100, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 100000,
    maxEntryBytes: 20000,
    maxTotalBytes: 100000,
    maxMembers: 30,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 20000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 20000, maxNodes: 2000, maxDepth: 30 },
  relationshipLimits: { maxBytes: 20000, maxParts: 30, maxRelationships: 40 }
};
function fixture(
  viewRoot = "viewPr",
  viewType = "viewProps",
  duplicateView = false,
  strict = false,
  externalView = false,
  handoutId = "handout"
) {
  const rels = (rows: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows}</Relationships>`;
  const relation = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="${r}/${type}" Target="${target}"/>`;
  const files: Record<string, string> = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${[
      ["deck.xml", "presentation.main"],
      ["print.xml", "presProps"],
      ["view.xml", viewType],
      ["handout.xml", "handoutMaster"],
      ["detached.xml", "handoutMaster"]
    ]
      .map(
        ([part, type]) =>
          `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`
      )
      .join("")}</Types>`,
    "_rels/.rels": rels(relation("main", "officeDocument", "deck.xml")),
    "deck.xml": `<p:presentation xmlns:p="${p}" xmlns:r="${r}" xmlns:x="urn:example:layout" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x"><x:handoutMasterIdLst xmlns:x="urn:example:layout"><x:handoutMasterId r:id="missing"/></x:handoutMasterIdLst><p:handoutMasterIdLst><p:handoutMasterId xmlns:x="urn:example:layout" x:id="missing" r:id="${handoutId}"/></p:handoutMasterIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "_rels/deck.xml.rels": rels(
      relation("handout", "handoutMaster", "handout.xml") +
        relation("detached", "handoutMaster", "detached.xml") +
        relation("print", "presProps", "print.xml") +
        (externalView
          ? `<Relationship Id="view" Type="${r}/viewProps" Target="https://example.invalid/view" TargetMode="External"/>`
          : relation("view", "viewProps", "view.xml")) +
        (duplicateView ? relation("view2", "viewProps", "view.xml") : "")
    ),
    "handout.xml": `<p:handoutMaster xmlns:p="${p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap/></p:handoutMaster>`,
    "detached.xml": `<p:handoutMaster xmlns:p="${p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap/></p:handoutMaster>`,
    "print.xml": `<p:presentationPr xmlns:p="${p}"><p:prnPr prnWhat="handouts6" clrMode="gray" frameSlides="1"><p:extLst/></p:prnPr></p:presentationPr>`,
    "view.xml": `<p:${viewRoot} xmlns:p="${p}" lastView="handoutView"><p:handoutViewPr><p:cViewPr varScale="1"/></p:handoutViewPr><p:gridSpacing cx="72008" cy="72008"/></p:${viewRoot}>`
  };
  const volume = Volume.fromJSON({});
  const bytes = storedArchive(
    Object.entries(files).map(([name, text]) => ({
      name,
      bytes: new TextEncoder().encode(
        strict
          ? text
              .split(p)
              .join("http://purl.oclc.org/ooxml/presentationml/main")
              .split(r)
              .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
          : text
      )
    }))
  );
  volume.writeFileSync("/deck.pptx", bytes);
  return new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer);
}
describe("handout and print inventory", () => {
  it.each([false, true])(
    "lists presentation handouts without promoting detached resources (strict=%s)",
    async (strict) => {
      const { inventory } = await readSelectionIndex(
        fixture("viewPr", "viewProps", false, strict),
        context
      );
      expect(inventory.handoutMasters).toEqual(["/handout.xml"]);
      expect(inventory.parts.some((part) => part.part === "/detached.xml")).toBe(true);
    }
  );
  it.each([false, true])(
    "exposes stored print and view markup without inferring pagination (strict=%s)",
    async (strict) => {
      const namespace = strict ? "http://purl.oclc.org/ooxml/presentationml/main" : p;
      const settings = await readPresentationSettings(
        fixture("viewPr", "viewProps", false, strict),
        context
      );
      expect(settings.notesWidth).toBe(6858000);
      expect(settings.notesHeight).toBe(9144000);
      expect(settings.printProperties).toEqual({
        part: "/print.xml",
        xml: `<p:prnPr xmlns:p="${namespace}" prnWhat="handouts6" clrMode="gray" frameSlides="1"><p:extLst/></p:prnPr>`
      });
      expect(settings.viewProperties).toEqual({
        part: "/view.xml",
        xml: `<p:viewPr xmlns:p="${namespace}" lastView="handoutView"><p:handoutViewPr><p:cViewPr varScale="1"/></p:handoutViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>`
      });
    }
  );
  it("rejects external view properties without accessing their target", async () => {
    await expect(
      readPresentationSettings(fixture("viewPr", "viewProps", false, false, true), context)
    ).rejects.toMatchObject({ code: "invalid-opc" });
  });
  it("rejects a listed handout whose relationship identity is absent", async () => {
    await expect(
      readSelectionIndex(fixture("viewPr", "viewProps", false, false, false, "missing"), context)
    ).rejects.toMatchObject({ code: "invalid-opc" });
  });
  it.each([
    ["wrong", "viewProps", false],
    ["viewPr", "presProps", false],
    ["viewPr", "viewProps", true]
  ] as const)("rejects malformed view properties %s %s %s", async (root, type, duplicate) => {
    await expect(
      readPresentationSettings(fixture(root, type, duplicate), context)
    ).rejects.toMatchObject({ code: "invalid-opc" });
  });
});
