import { describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { readPackage } from "./package-reader.js";
import { validatePresentation } from "./validation.js";

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
function reopen(bytes: Uint8Array) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  const entries = inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer));
  return new Map(entries.map(({ name, payload }) => [name, new TextDecoder().decode(payload)]));
}
function elements(xml: string, local: string) {
  const found: { attributes: Record<string, string> }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      found.push({
        attributes: Object.fromEntries(Object.values(tag.attributes).map((a) => [a.local, a.value]))
      });
  });
  parser.write(xml).close();
  return found;
}

describe("authored presentation creation", () => {
  it.each(["pptx", "potx", "ppsx"] as const)(
    "creates deterministic macro-free %s packages with an explicit empty graph",
    async (kind) => {
      const bytes = await createPresentation({ kind }, context);
      expect(bytes).toEqual(await createPresentation({ kind }, context));
      const parts = reopen(bytes);
      expect([...parts.keys()].sort()).toEqual(
        [
          "[Content_Types].xml",
          "_rels/.rels",
          "docProps/app.xml",
          "docProps/core.xml",
          "ppt/_rels/presentation.xml.rels",
          "ppt/presentation.xml",
          "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
          "ppt/slideLayouts/slideLayout1.xml",
          "ppt/slideMasters/_rels/slideMaster1.xml.rels",
          "ppt/slideMasters/slideMaster1.xml",
          "ppt/theme/theme1.xml"
        ].sort()
      );
      expect(elements(parts.get("ppt/presentation.xml")!, "sldSz")[0]!.attributes).toEqual({
        cx: "12192000",
        cy: "6858000"
      });
      expect(elements(parts.get("ppt/presentation.xml")!, "sldId")).toEqual([]);
      const main = elements(parts.get("[Content_Types].xml")!, "Override").find(
        (e) => e.attributes.PartName === "/ppt/presentation.xml"
      );
      expect(main!.attributes.ContentType).toBe(
        `application/vnd.openxmlformats-officedocument.presentationml.${{ pptx: "presentation", potx: "template", ppsx: "slideshow" }[kind]}.main+xml`
      );
      expect(parts.get("docProps/core.xml")).not.toContain("W3CDTF");
      for (const omitted of ["title", "revision", "created", "modified", "lastModifiedBy"])
        expect(elements(parts.get("docProps/core.xml")!, omitted)).toEqual([]);
      expect(elements(parts.get("docProps/core.xml")!, "creator")).toEqual([]);
      expect(elements(parts.get("ppt/theme/theme1.xml")!, "clrScheme")).toHaveLength(1);
      const theme = parts.get("ppt/theme/theme1.xml")!;
      for (const list of ["fillStyleLst", "lnStyleLst", "effectStyleLst", "bgFillStyleLst"]) {
        let children = 0;
        let depth = 0;
        const parser = new SaxesParser({ xmlns: true });
        parser.on("opentag", (tag) => {
          if (depth) {
            if (depth === 1) children++;
            depth++;
          } else if (tag.local === list) depth = 1;
        });
        parser.on("closetag", () => {
          if (depth) depth--;
        });
        parser.write(theme).close();
        expect(children).toBe(3);
      }
      const expectedTypes = new Map([
        [
          "/ppt/slideMasters/slideMaster1.xml",
          "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"
        ],
        [
          "/ppt/slideLayouts/slideLayout1.xml",
          "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"
        ],
        ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
        ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"],
        [
          "/docProps/app.xml",
          "application/vnd.openxmlformats-officedocument.extended-properties+xml"
        ]
      ]);
      for (const [path, type] of expectedTypes)
        expect(
          elements(parts.get("[Content_Types].xml")!, "Override").find(
            (e) => e.attributes.PartName === path
          )?.attributes.ContentType
        ).toBe(type);
      expect(
        elements(parts.get("_rels/.rels")!, "Relationship").map((e) => e.attributes.Target)
      ).toEqual(["ppt/presentation.xml", "docProps/core.xml", "docProps/app.xml"]);
      expect(
        elements(parts.get("ppt/_rels/presentation.xml.rels")!, "Relationship").map(
          (e) => e.attributes.Target
        )
      ).toEqual(["slideMasters/slideMaster1.xml"]);
      expect(
        elements(parts.get("ppt/slideMasters/_rels/slideMaster1.xml.rels")!, "Relationship").map(
          (e) => e.attributes.Target
        )
      ).toEqual(["../slideLayouts/slideLayout1.xml", "../theme/theme1.xml"]);
      expect(
        elements(parts.get("ppt/slideLayouts/_rels/slideLayout1.xml.rels")!, "Relationship").map(
          (e) => e.attributes.Target
        )
      ).toEqual(["../slideMasters/slideMaster1.xml"]);
      const reader = await readPackage(bytes, context);
      expect(
        validatePresentation(reader, {
          ...context.xmlLimits,
          ...context.relationshipLimits,
          maxEntries: 100
        }).issues
      ).toEqual([]);
    }
  );
  it("creates one structured slide with escaped text and separately defaulted dimensions", async () => {
    const parts = reopen(
      await createPresentation(
        {
          width: 9144000,
          slides: [
            {
              name: "Survey & review",
              shapes: [
                {
                  name: "Heading",
                  x: 0,
                  y: 20,
                  width: 8000000,
                  height: 500000,
                  text: "Orchard <survey>\nSecond line\vSoft break"
                }
              ]
            }
          ]
        },
        context
      )
    );
    expect(elements(parts.get("ppt/presentation.xml")!, "sldSz")[0]!.attributes).toEqual({
      cx: "9144000",
      cy: "6858000"
    });
    expect(elements(parts.get("ppt/presentation.xml")!, "sldId")).toHaveLength(1);
    const slide = parts.get("ppt/slides/slide1.xml")!;
    expect(elements(slide, "cSld")[0]!.attributes.name).toBe("Survey & review");
    expect(elements(slide, "p")).toHaveLength(2);
    expect(elements(slide, "br")).toHaveLength(1);
    expect(slide).toContain("Orchard &lt;survey&gt;");
    expect(
      elements(parts.get("ppt/slides/_rels/slide1.xml.rels")!, "Relationship")[0]!.attributes.Target
    ).toBe("../slideLayouts/slideLayout1.xml");
  });
  it("writes only explicit metadata, preserves empty strings and truncates UTC dates to seconds", async () => {
    const parts = reopen(
      await createPresentation(
        {
          properties: {
            title: "",
            author: "River team",
            revision: 0,
            created: new Date("2024-02-29T12:34:56.987Z"),
            modified: new Date("2001-01-01T00:00:00Z")
          }
        },
        context
      )
    );
    const core = parts.get("docProps/core.xml")!;
    expect(elements(core, "title")).toHaveLength(1);
    expect(core).toContain("2024-02-29T12:34:56Z");
    expect(core).toContain("2001-01-01T00:00:00Z");
    expect(core).toContain("<cp:revision>0</cp:revision>");
    expect(core).not.toContain("lastPrinted");
  });
  it.each([
    { width: 0 },
    { width: 914399 },
    { height: 51206401 },
    { width: null },
    { height: null },
    { kind: null },
    { slides: new Array(1) },
    { slides: [new Date(0)] },
    { properties: new Date(0) },
    { slides: [{ shapes: new Array(1) }] },
    { slides: [{ shapes: [{ name: null, x: 0, y: 0, width: 1, height: 1, text: "" }] }] },
    { height: 1.1 },
    { width: NaN },
    { kind: "pptm" },
    { dialect: "strict" },
    { slides: null },
    { slides: [{ shapes: [{ text: "x" }] }] },
    { properties: { created: new Date(NaN) } },
    { properties: { author: "x".repeat(256) } },
    { properties: { revision: -1 } },
    { unknown: true }
  ])("rejects invalid creation input %#", async (options) => {
    await expect(createPresentation(options as never, context)).rejects.toMatchObject({
      name: "OfficeError"
    });
  });
  it.each(["&".repeat(20000), "&".repeat(3000), "\n".repeat(2000)])(
    "bounds generated text before encoding oversized XML %#",
    async (text) => {
      const encode = vi.spyOn(TextEncoder.prototype, "encode");
      try {
        await expect(
          createPresentation(
            { slides: [{ shapes: [{ x: 0, y: 0, width: 1, height: 1, text }] }] },
            { ...context, xmlLimits: { ...context.xmlLimits, maxBytes: 10000 } }
          )
        ).rejects.toMatchObject({ code: "resource-limit" });
        expect(encode.mock.calls.every(([input]) => (input?.length ?? 0) <= 10000)).toBe(true);
      } finally {
        encode.mockRestore();
      }
    }
  );
  it("bounds cumulative shapes before encoding a slide", async () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      await expect(
        createPresentation(
          {
            slides: [
              {
                shapes: Array.from({ length: 30 }, () => ({
                  x: 0,
                  y: 0,
                  width: 1,
                  height: 1,
                  text: "&".repeat(100)
                }))
              }
            ]
          },
          { ...context, xmlLimits: { ...context.xmlLimits, maxBytes: 10000 } }
        )
      ).rejects.toMatchObject({ code: "resource-limit" });
      expect(encode.mock.calls.every(([input]) => (input?.length ?? 0) <= 10000)).toBe(true);
    } finally {
      encode.mockRestore();
    }
  });
  it("accepts the exact UTF-8 part budget for escaped and supplementary text", async () => {
    const options = {
      slides: [
        { name: "測定", shapes: [{ x: 0, y: 0, width: 1, height: 1, text: "&🌿".repeat(1000) }] }
      ]
    };
    const bytes = await createPresentation(options, context);
    const maximum = Math.max(...inspectZip(bytes).map((entry) => entry.payload.length));
    expect(
      await createPresentation(options, {
        ...context,
        xmlLimits: { ...context.xmlLimits, maxBytes: maximum }
      })
    ).toEqual(bytes);
    await expect(
      createPresentation(options, {
        ...context,
        xmlLimits: { ...context.xmlLimits, maxBytes: maximum - 1 }
      })
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("honors cancellation and bounded authored output", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createPresentation({}, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
    await expect(
      createPresentation(
        {},
        { ...context, archiveLimits: { ...context.archiveLimits, maxMembers: 2 } }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
});
