import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SaxesParser } from "saxes";
import { writePackageArchive } from "./package-writer.js";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { mutateTheme, readThemes } from "./themes.js";
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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
function parts(bytes: Uint8Array) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((x) => [
      x.name,
      new TextDecoder().decode(x.payload)
    ])
  );
}
function attributes(xml: string, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((x) => [x.name, x.value])));
  });
  parser.write(xml).close();
  return result;
}
describe("theme palette and font editing", () => {
  it("edits shared contrast colors and fonts while keeping local slide bytes", async () => {
    const source = await createPresentation({ slides: [{}, {}] }, context);
    const result = await mutateTheme(
      source,
      {
        scope: "shared",
        theme: "/ppt/theme/theme1.xml",
        colorSlot: "dk1",
        color: "FAFAFA",
        fontSlot: "majorLatin",
        font: "Clear & Readable"
      },
      context
    );
    expect(result.affectedSlides).toEqual([1, 2]);
    const original = parts(source),
      changed = parts(result.bytes);
    expect(changed.get("ppt/slides/slide1.xml")).toBe(original.get("ppt/slides/slide1.xml"));
    expect(attributes(changed.get("ppt/theme/theme1.xml")!, "latin")[0]?.typeface).toBe(
      "Clear & Readable"
    );
    expect(attributes(changed.get("ppt/theme/theme1.xml")!, "srgbClr")[0]?.val).toBe("FAFAFA");
    expect((await readThemes(result.bytes, context))[0]?.colors.dk1).toBe("FAFAFA");
  });
  it.each([
    {},
    { scope: "slides" },
    { scope: "shared", colorSlot: "dk1" },
    { scope: "shared", colorSlot: "bad", color: "112233" },
    { scope: "shared", fontSlot: "majorLatin" }
  ])("rejects incomplete or unsafe theme edits %j", async (options) => {
    const source = await createPresentation({}, context);
    await expect(
      mutateTheme(source, { theme: "/ppt/theme/theme1.xml", ...options } as never, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("preserves extended effects and unsupported theme payloads", async () => {
    const original = parts(await createPresentation({}, context));
    original.set(
      "ppt/theme/theme1.xml",
      original
        .get("ppt/theme/theme1.xml")!
        .replace(
          "<a:effectLst/>",
          '<a:effectLst><a:outerShdw blurRad="700"/><z:effect xmlns:z="urn:original:effect"/></a:effectLst>'
        )
        .replace(
          "</a:theme>",
          '<a:extLst><a:ext uri="custom"><z:payload xmlns:z="urn:original:payload" value="retained"/></a:ext></a:extLst></a:theme>'
        )
    );
    const source = await writePackageArchive(
      [...original].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
      context,
      { compression: "store" }
    );
    const result = await mutateTheme(
      source,
      { scope: "shared", theme: "/ppt/theme/theme1.xml", colorSlot: "accent1", color: "102030" },
      context
    );
    const xml = parts(result.bytes).get("ppt/theme/theme1.xml")!;
    expect(xml).toContain(
      '<a:effectLst><a:outerShdw blurRad="700"/><z:effect xmlns:z="urn:original:effect"/></a:effectLst>'
    );
    expect(xml).toContain('<z:payload xmlns:z="urn:original:payload" value="retained"/>');
  });
  it("edits a slide theme override independently and preserves theme sources", async () => {
    const original = parts(await createPresentation({ slides: [{}, {}] }, context));
    const root = original.get("ppt/theme/theme1.xml")!;
    const scheme = root.slice(root.indexOf("<a:clrScheme"), root.indexOf("</a:clrScheme>") + 14);
    original.set(
      "ppt/theme/override1.xml",
      `<a:themeOverride xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${scheme}</a:themeOverride>`
    );
    original.set(
      "ppt/slides/_rels/slide1.xml.rels",
      original
        .get("ppt/slides/_rels/slide1.xml.rels")!
        .replace(
          "</Relationships>",
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeOverride" Target="../theme/override1.xml"/></Relationships>'
        )
    );
    original.set(
      "[Content_Types].xml",
      original
        .get("[Content_Types].xml")!
        .replace(
          "</Types>",
          '<Override PartName="/ppt/theme/override1.xml" ContentType="application/vnd.openxmlformats-officedocument.themeOverride+xml"/></Types>'
        )
    );
    const source = await writePackageArchive(
      [...original].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
      context,
      { compression: "store" }
    );
    expect((await readThemes(source, context)).find((t) => t.override)?.affectedSlides).toEqual([
      1
    ]);
    const changed = await mutateTheme(
      source,
      { scope: "shared", theme: "/ppt/theme/override1.xml", colorSlot: "dk1", color: "FFFFFF" },
      context
    );
    expect(changed.affectedSlides).toEqual([1]);
    expect(parts(changed.bytes).get("ppt/theme/theme1.xml")).toBe(root);
    expect(
      attributes(parts(changed.bytes).get("ppt/theme/override1.xml")!, "srgbClr")[0]?.val
    ).toBe("FFFFFF");
    await expect(
      mutateTheme(
        source,
        { scope: "shared", theme: "/ppt/theme/override1.xml", name: "Invalid" },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("retains color extensions or refuses a lossy color-kind conversion", async () => {
    const original = parts(await createPresentation({}, context));
    original.set(
      "ppt/theme/theme1.xml",
      original
        .get("ppt/theme/theme1.xml")!
        .replace(
          '<a:srgbClr val="17212B"/>',
          '<a:sysClr val="windowText" lastClr="000000" xmlns:z="urn:original:color" z:hint="keep"><z:modifier/></a:sysClr>'
        )
    );
    const source = await writePackageArchive(
      [...original].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
      context,
      { compression: "store" }
    );
    await expect(
      mutateTheme(
        source,
        { scope: "shared", theme: "/ppt/theme/theme1.xml", colorSlot: "dk1", color: "FFFFFF" },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });

  it.each([
    "majorLatin",
    "minorLatin",
    "majorEastAsia",
    "minorEastAsia",
    "majorComplex",
    "minorComplex"
  ] as const)("edits font scheme slot %s without replacing other slots", async (fontSlot) => {
    const source = await createPresentation({}, context);
    const result = await mutateTheme(
      source,
      { scope: "shared", theme: "/ppt/theme/theme1.xml", fontSlot, font: "Sample Typeface" },
      context
    );
    const record = (await readThemes(result.bytes, context))[0]!;
    expect(record.fonts[fontSlot]).toBe("Sample Typeface");
    expect(Object.values(record.fonts).filter((v) => v === "Sample Typeface")).toHaveLength(1);
  });
});
