import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { parseXmlPart } from "./xml.js";
import { writePackageArchive } from "./package-writer.js";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
import { mutatePresentationSettings, readPresentationSettings } from "./presentation-settings.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

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
function parts(bytes: Uint8Array) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((e) => [
      e.name,
      new TextDecoder().decode(e.payload)
    ])
  );
}
function attributes(xml: string, name: string) {
  const output: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === name)
      output.push(
        Object.fromEntries(
          Object.values(tag.attributes)
            .filter((a) => a.uri !== "http://www.w3.org/2000/xmlns/")
            .map((a) => [a.local, a.value])
        )
      );
  });
  parser.write(xml).close();
  return output;
}
describe("presentation canvas and slideshow settings", () => {
  it.each(["transitional"] as const)(
    "reads explicit dimensions and defaults in %s",
    async (dialect) => {
      const input = await createPresentation({ dialect }, context);
      expect(await readPresentationSettings(input, context)).toEqual({
        width: 12192000,
        height: 6858000,
        orientation: "landscape",
        notesWidth: 6858000,
        notesHeight: 9144000,
        notesOrientation: "portrait",
        slideNumberStart: 1,
        loop: false,
        showType: "speaker"
      });
    }
  );
  it("changes only the canvas and notes dimensions while preserving drawing bytes", async () => {
    const input = await createPresentation(
      {
        slides: [{ shapes: [{ x: 10, y: 20, width: 300, height: 400, text: "Original sample" }] }]
      },
      context
    );
    const output = await mutatePresentationSettings(
      input,
      { orientation: "portrait", notesOrientation: "landscape", slideNumberStart: 7 },
      context
    );
    const original = parts(input),
      changed = parts(output);
    expect(attributes(changed.get("ppt/presentation.xml")!, "sldSz")[0]).toEqual({
      cx: "6858000",
      cy: "12192000"
    });
    expect(attributes(changed.get("ppt/presentation.xml")!, "notesSz")[0]).toEqual({
      cx: "9144000",
      cy: "6858000"
    });
    expect(attributes(changed.get("ppt/presentation.xml")!, "presentation")[0]!.firstSlideNum).toBe(
      "7"
    );
    for (const [name, bytes] of original)
      if (name !== "ppt/presentation.xml") expect(changed.get(name)).toBe(bytes);
  });
  it.each(["speaker", "window", "kiosk"] as const)(
    "writes a discoverable %s slideshow and loop flag",
    async (showType) => {
      const output = await mutatePresentationSettings(
        await createPresentation({}, context),
        { showType, loop: true },
        context
      );
      const result = parts(output);
      expect(attributes(result.get("ppt/presProps.xml")!, "showPr")[0]!.loop).toBe("1");
      expect(
        attributes(
          result.get("ppt/presProps.xml")!,
          { speaker: "present", window: "browse", kiosk: "kiosk" }[showType]
        )
      ).toHaveLength(1);
      expect(await readPresentationSettings(output, context)).toMatchObject({
        loop: true,
        showType
      });
    }
  );
  it.each([
    { width: 0 },
    { height: 51206401 },
    { width: 914400, height: 1828800, orientation: "landscape" },
    { notesWidth: NaN },
    { width: 914400, height: 914400, orientation: "portrait" },
    { slideNumberStart: 1.5 },
    { scaleContent: "yes" }
  ])("rejects invalid settings %j", async (options) => {
    await expect(
      mutatePresentationSettings(await createPresentation({}, context), options as never, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("requires a canvas change for explicit content scaling", async () => {
    const input = await createPresentation({}, context);
    await expect(
      mutatePresentationSettings(input, { scaleContent: true }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(await readPresentationSettings(input, context)).toMatchObject({ width: 12192000 });
  });
});

async function fixture(presentation: string, extra: Record<string, string> = {}) {
  const archive = parts(await createPresentation({}, context));
  const supplied = parseXmlPart(new TextEncoder().encode(presentation), context.xmlLimits);
  const withMaster = supplied.spliceChildren(supplied.root, 0, 0, [
    `<p:sldMasterIdLst xmlns:p="${p}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
  ]);
  const complete = withMaster.spliceChildren(withMaster.root, withMaster.root.children.length, 0, [
    `<p:notesSz xmlns:p="${p}" cx="6858000" cy="9144000"/>`
  ]);
  archive.set("ppt/presentation.xml", new TextDecoder().decode(complete.bytes()));
  for (const [name, value] of Object.entries(extra)) archive.set(name, value);
  return writePackageArchive(
    [...archive].map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value) })),
    context,
    { compression: "store" }
  );
}
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
describe("sparse presentation dimensions", () => {
  it.each(["width", "height"] as const)(
    "reads absent %s without creating a size element",
    async (axis) => {
      const input = await fixture(`<p:presentation xmlns:p="${p}"/>`);
      expect((await readPresentationSettings(input, context))[axis]).toBeNull();
      expect(parts(input).get("ppt/presentation.xml")).not.toContain("sldSz");
    }
  );
  it.each(["width", "height"] as const)(
    "reads a present %s independently of writing bounds",
    async (axis) => {
      const input = await fixture(
        `<p:presentation xmlns:p="${p}"><p:sldSz cx="42" cy="42"/></p:presentation>`
      );
      expect((await readPresentationSettings(input, context))[axis]).toBe(42);
    }
  );
  it.each(["width", "height"] as const)(
    "requires the companion dimension to create an absent %s",
    async (axis) => {
      const input = await fixture(`<p:presentation xmlns:p="${p}"/>`);
      await expect(
        mutatePresentationSettings(input, { [axis]: 914400 }, context)
      ).rejects.toMatchObject({ code: "invalid-value" });
      const output = await mutatePresentationSettings(
        input,
        { width: 914400, height: 1828800 },
        context
      );
      expect(attributes(parts(output).get("ppt/presentation.xml")!, "sldSz")).toEqual([
        { cx: "914400", cy: "1828800" }
      ]);
    }
  );
  it.each(["width", "height"] as const)(
    "sets an existing %s and preserves the other axis",
    async (axis) => {
      const input = await createPresentation({}, context);
      const output = await mutatePresentationSettings(input, { [axis]: 914400 }, context);
      expect(attributes(parts(output).get("ppt/presentation.xml")!, "sldSz")).toEqual([
        axis === "width" ? { cx: "914400", cy: "6858000" } : { cx: "12192000", cy: "914400" }
      ]);
    }
  );
  it("preserves identical archive bytes for an unchanged setting", async () => {
    const input = await createPresentation({}, context);
    expect(await mutatePresentationSettings(input, { width: 12192000 }, context)).toEqual(input);
  });
});

describe("settings preservation and explicit scaling", () => {
  it("scales geometry only on explicit request through the package API", async () => {
    const input = await createPresentation(
      {
        width: 9144000,
        height: 6858000,
        slides: [{ shapes: [{ x: -3, y: 5, width: 101, height: 203, text: "Measured geometry" }] }]
      },
      context
    );
    const output = await mutatePresentationSettings(
      input,
      { width: 13716000, height: 13716000, scaleContent: true },
      context
    );
    const slide = parts(output).get("ppt/slides/slide1.xml")!;
    expect(attributes(slide, "off")).toContainEqual({ x: "-5", y: "10" });
    expect(attributes(slide, "ext")).toContainEqual({ cx: "152", cy: "406" });
  });
  it("preserves slideshow, print, and vendor values outside requested fields", async () => {
    const base = await mutatePresentationSettings(
      await createPresentation({}, context),
      { showType: "window", loop: true },
      context
    );
    const archive = parts(base);
    const vendor =
      '<p:extLst><p:ext uri="vendor"><v:state xmlns:v="urn:example:settings" value="retain"/></p:ext></p:extLst>';
    archive.set(
      "ppt/presProps.xml",
      `<p:presentationPr xmlns:p="${p}"><p:prnPr prnWhat="notes"/><p:showPr loop=" true " showNarration="0"><p:browse showScrollbar="0"/><p:sldRg st="2" end="5"/>${vendor}</p:showPr>${vendor}</p:presentationPr>`
    );
    const input = await writePackageArchive(
      [...archive].map(([name, xml]) => ({ name, bytes: new TextEncoder().encode(xml) })),
      context,
      { compression: "store" }
    );
    expect((await readPresentationSettings(input, context)).loop).toBe(true);
    const output = await mutatePresentationSettings(input, { loop: false }, context);
    expect(parts(output).get("ppt/presProps.xml")).toBe(
      archive.get("ppt/presProps.xml")!.replace('loop=" true "', 'loop="0"')
    );
    expect(parts(output).get("ppt/presentation.xml")).toBe(archive.get("ppt/presentation.xml"));
  });
});

describe("root presentation parts and edit boundaries", () => {
  it.each(["http://schemas.openxmlformats.org", "http://purl.oclc.org/ooxml"])(
    "discovers root presentation properties using %s relationships",
    async (base) => {
      const strict = base.includes("purl");
      const pn = strict ? `${base}/presentationml/main` : `${base}/presentationml/2006/main`;
      const rn = strict
        ? `${base}/officeDocument/relationships`
        : `${base}/officeDocument/2006/relationships`;
      const input = await writePackageArchive(
        [
          {
            name: "[Content_Types].xml",
            bytes: new TextEncoder().encode(
              '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>'
            )
          },
          {
            name: "_rels/.rels",
            bytes: new TextEncoder().encode(
              `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${rn}/officeDocument" Target="presentation.xml"/></Relationships>`
            )
          },
          {
            name: "presentation.xml",
            bytes: new TextEncoder().encode(
              `<p:presentation xmlns:p="${pn}"><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
            )
          }
        ],
        context,
        { compression: "store" }
      );
      const output = await mutatePresentationSettings(
        input,
        { loop: true, orientation: "portrait" },
        context
      );
      expect(parts(output).has("presProps.xml")).toBe(true);
      expect(await readPresentationSettings(output, context)).toMatchObject({
        loop: true,
        width: 6858000,
        height: 9144000
      });
    }
  );
  it.each(["width", "height"] as const)(
    "rejects partial %s repairs that leave an invalid companion dimension",
    async (axis) => {
      const input = await fixture(
        `<p:presentation xmlns:p="${p}"><p:sldSz cx="424242" cy="424242"/></p:presentation>`
      );
      await expect(
        mutatePresentationSettings(input, { [axis]: 914400 }, context)
      ).rejects.toMatchObject({ code: "invalid-value" });
      const output = await mutatePresentationSettings(
        input,
        { width: 914400, height: 914400 },
        context
      );
      expect(attributes(parts(output).get("ppt/presentation.xml")!, "sldSz")).toEqual([
        { cx: "914400", cy: "914400" }
      ]);
    }
  );
  it("rejects orientation-only rewrites of undersized source dimensions", async () => {
    const input = await fixture(
      `<p:presentation xmlns:p="${p}"><p:sldSz cx="42" cy="73"/></p:presentation>`
    );
    await expect(
      mutatePresentationSettings(input, { orientation: "landscape" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it.each(["width", "height"] as const)(
    "requires a complete pair when replacing an axis-only stored %s",
    async (axis) => {
      const coordinate = axis === "width" ? "cx" : "cy";
      const input = await fixture(
        `<p:presentation xmlns:p="${p}"><p:sldSz ${coordinate}="424242"/></p:presentation>`
      );
      expect((await readPresentationSettings(input, context))[axis]).toBe(424242);
      await expect(
        mutatePresentationSettings(input, { [axis]: 914400 }, context)
      ).rejects.toMatchObject({ code: "invalid-value" });
    }
  );
  it("requires a setting beyond the content-scaling switch", async () => {
    await expect(
      mutatePresentationSettings(
        await createPresentation({}, context),
        { scaleContent: false },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
});
