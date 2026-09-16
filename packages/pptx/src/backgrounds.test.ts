import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SaxesParser } from "saxes";
import { writePackageArchive } from "./package-writer.js";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { mutateBackground, readBackgrounds } from "./backgrounds.js";
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
describe("background fills and style references", () => {
  it("changes only the selected slide and explicitly changes all master dependents", async () => {
    const source = await createPresentation({ slides: [{}, {}] }, context);
    const local = await mutateBackground(
      source,
      { scope: "slides", part: "/ppt/slides/slide1.xml", kind: "solid", color: "111111" },
      context
    );
    expect(local.affectedSlides).toEqual([1]);
    expect(parts(local.bytes).get("ppt/slides/slide2.xml")).toBe(
      parts(source).get("ppt/slides/slide2.xml")
    );
    const shared = await mutateBackground(
      local.bytes,
      {
        scope: "masters",
        part: "/ppt/slideMasters/slideMaster1.xml",
        kind: "gradient",
        stops: [
          { position: 0, color: "000000" },
          { position: 1, color: "FFFFFF", opacity: 0.5 }
        ],
        angle: 90
      },
      context
    );
    expect(shared.affectedSlides).toEqual([1, 2]);
    expect(
      attributes(parts(shared.bytes).get("ppt/slideMasters/slideMaster1.xml")!, "lin")
    ).toEqual([{ ang: "5400000", scaled: "1" }]);
    expect((await readBackgrounds(shared.bytes, { scope: "slides" }, context))[0]?.color).toBe(
      "111111"
    );
  });
  it("authors picture resources from explicitly supplied bytes", async () => {
    const source = await createPresentation({ slides: [{}] }, context);
    const image = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
      0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 80, 141, 238, 255, 15, 0,
      3, 199, 2, 15, 253, 11, 32, 105, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
    ]);
    const result = await mutateBackground(
      source,
      { scope: "slides", part: "/ppt/slides/slide1.xml", kind: "picture", image },
      context
    );
    expect(
      attributes(parts(result.bytes).get("ppt/slides/slide1.xml")!, "blip")[0]?.["r:embed"]
    ).toBeTruthy();
    expect((await readBackgrounds(result.bytes, { scope: "slides" }, context))[0]?.imagePart).toBe(
      "/ppt/media/image1.png"
    );
    expect(
      inspectZip(result.bytes).find((entry) => entry.name === "ppt/media/image1.png")?.payload
    ).toEqual(image);
  });
  it.each([
    { kind: "picture" },
    { kind: "gradient", stops: [] },
    { kind: "solid", color: "ZZZZZZ" },
    { kind: "inherit", color: "112233" },
    { kind: "style-reference", styleIndex: 1004, styleColor: "112233" }
  ])("rejects invalid fills %j", async (opts) => {
    const source = await createPresentation({ slides: [{}] }, context);
    await expect(
      mutateBackground(
        source,
        { scope: "slides", part: "/ppt/slides/slide1.xml", ...opts } as never,
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("retains extended effects when changing fill and rejects destructive inheritance", async () => {
    const first = await mutateBackground(
      await createPresentation({ slides: [{}] }, context),
      { scope: "slides", part: "/ppt/slides/slide1.xml", kind: "solid", color: "112233" },
      context
    );
    const original = parts(first.bytes);
    original.set(
      "ppt/slides/slide1.xml",
      original
        .get("ppt/slides/slide1.xml")!
        .replace("<a:effectLst/>", '<a:effectLst><a:outerShdw blurRad="123"/></a:effectLst>')
    );
    const source = await writePackageArchive(
      [...original].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
      context,
      { compression: "store" }
    );
    const result = await mutateBackground(
      source,
      { scope: "slides", part: "/ppt/slides/slide1.xml", kind: "solid", color: "445566" },
      context
    );
    expect(parts(result.bytes).get("ppt/slides/slide1.xml")).toContain(
      '<a:effectLst><a:outerShdw blurRad="123"/></a:effectLst>'
    );
    await expect(
      mutateBackground(
        source,
        { scope: "slides", part: "/ppt/slides/slide1.xml", kind: "inherit" },
        context
      )
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("authors bounded background style references", async () => {
    const source = await createPresentation({ slides: [{}] }, context);
    const result = await mutateBackground(
      source,
      {
        scope: "slides",
        part: "/ppt/slides/slide1.xml",
        kind: "style-reference",
        styleIndex: 1002,
        styleColor: "223344"
      },
      context
    );
    expect(attributes(parts(result.bytes).get("ppt/slides/slide1.xml")!, "bgRef")[0]?.idx).toBe(
      "1002"
    );
  });
  it.each([
    [42.42, 2545200],
    [270, 16200000],
    [480, 7200000],
    [-90, 16200000],
    [-942.4, 8256000],
    [301.2, 18072000],
    [31.22, 1873200],
    [0, 0],
    [-460, 15600000]
  ])("normalizes authored clockwise angle %s", async (angle, expected) => {
    const source = await createPresentation({ slides: [{}] }, context);
    const result = await mutateBackground(
      source,
      {
        scope: "slides",
        part: "/ppt/slides/slide1.xml",
        kind: "gradient",
        stops: [
          { position: 0, color: "000000" },
          { position: 0.4224, color: "445566" },
          { position: 1, color: "FFFFFF" }
        ],
        angle
      },
      context
    );
    const xml = parts(result.bytes).get("ppt/slides/slide1.xml")!;
    expect(attributes(xml, "lin")[0]?.ang).toBe(String(expected));
    expect(attributes(xml, "gs").map((a) => a.pos)).toEqual(["0", "42240", "100000"]);
  });
  it.each([-0.42, 1.001])("rejects out of range gradient position %s", async (position) => {
    const source = await createPresentation({ slides: [{}] }, context);
    await expect(
      mutateBackground(
        source,
        {
          scope: "slides",
          part: "/ppt/slides/slide1.xml",
          kind: "gradient",
          stops: [
            { position: 0, color: "112233" },
            { position, color: "445566" }
          ]
        },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it.each(["solidFill", "gradFill", "grpFill", "noFill", "pattFill", "blipFill"])(
    "replaces %s while retaining unrelated effects",
    async (fill) => {
      const original = parts(await createPresentation({ slides: [{}] }, context));
      original.set(
        "ppt/slides/slide1.xml",
        original
          .get("ppt/slides/slide1.xml")!
          .replace(
            "<p:spTree>",
            `<p:bg><p:bgPr><a:${fill}/><a:effectLst><a:outerShdw blurRad="456"/></a:effectLst></p:bgPr></p:bg><p:spTree>`
          )
      );
      const source = await writePackageArchive(
        [...original].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
        context,
        { compression: "store" }
      );
      for (const kind of ["solid", "gradient"] as const) {
        const result = await mutateBackground(
          source,
          {
            scope: "slides",
            part: "/ppt/slides/slide1.xml",
            kind,
            ...(kind === "solid"
              ? { color: "654321" }
              : {
                  stops: [
                    { position: 0, color: "123456" },
                    { position: 1, color: "654321" }
                  ]
                })
          },
          context
        );
        const xml = parts(result.bytes).get("ppt/slides/slide1.xml")!;
        expect(attributes(xml, kind === "solid" ? "solidFill" : "gradFill")).toHaveLength(1);
        expect(xml).toContain('<a:effectLst><a:outerShdw blurRad="456"/></a:effectLst>');
      }
    }
  );
  it("rejects an explicitly missing image resource through the supplied capability", async () => {
    const source = await createPresentation({ slides: [{}] }, context),
      volume = Volume.fromJSON({});
    await expect(
      mutateBackground(
        source,
        {
          scope: "slides",
          part: "/ppt/slides/slide1.xml",
          kind: "picture",
          image: {
            path: "/absent.png",
            capability: {
              async openRead(path) {
                volume.readFileSync(path);
                throw new Error("unreachable");
              }
            }
          }
        },
        context
      )
    ).rejects.toBeDefined();
  });
  it("reads inherited and explicit no-fill backgrounds without creating local definitions", async () => {
    const original = parts(await createPresentation({ slides: [{}, {}] }, context));
    original.set(
      "ppt/slides/slide2.xml",
      original
        .get("ppt/slides/slide2.xml")!
        .replace("<p:spTree>", "<p:bg><p:bgPr><a:noFill/><a:effectLst/></p:bgPr></p:bg><p:spTree>")
    );
    const source = await writePackageArchive(
      [...original].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
      context,
      { compression: "store" }
    );
    expect(
      (await readBackgrounds(source, { scope: "slides" }, context)).map((bg) => bg.kind)
    ).toEqual(["inherit", "none"]);
    expect(parts(source).get("ppt/slides/slide1.xml")).not.toContain("<p:bg");
  });
  it("uses only ancestors when resolving shared style references", async () => {
    const original = parts(await createPresentation({ slides: [{}] }, context));
    original.set(
      "ppt/theme/override1.xml",
      '<a:themeOverride xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:fmtScheme name="Local"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeOverride>'
    );
    original.set(
      "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      original
        .get("ppt/slideLayouts/_rels/slideLayout1.xml.rels")!
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
    const result = await mutateBackground(
      source,
      {
        scope: "masters",
        part: "/ppt/slideMasters/slideMaster1.xml",
        kind: "style-reference",
        styleIndex: 1002,
        styleColor: "223344"
      },
      context
    );
    expect(
      attributes(parts(result.bytes).get("ppt/slideMasters/slideMaster1.xml")!, "bgRef")[0]?.idx
    ).toBe("1002");
    await expect(
      mutateBackground(
        source,
        {
          scope: "slides",
          part: "/ppt/slides/slide1.xml",
          kind: "style-reference",
          styleIndex: 1002,
          styleColor: "223344"
        },
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it.each([0, 1000, 4, 1004])(
    "rejects reserved and unavailable style index %s",
    async (styleIndex) => {
      const source = await createPresentation({ slides: [{}] }, context);
      await expect(
        mutateBackground(
          source,
          {
            scope: "slides",
            part: "/ppt/slides/slide1.xml",
            kind: "style-reference",
            styleIndex,
            styleColor: "123456"
          },
          context
        )
      ).rejects.toMatchObject({ code: "invalid-value" });
    }
  );
  it("encodes fractional gradient stops at exact integer positions", async () => {
    const source = await createPresentation({ slides: [{}] }, context);
    const result = await mutateBackground(
      source,
      {
        scope: "slides",
        part: "/ppt/slides/slide1.xml",
        kind: "gradient",
        stops: [0, 0.2, 0.42, 0.4224, 1].map((position) => ({ position, color: "112233" }))
      },
      context
    );
    expect(
      attributes(parts(result.bytes).get("ppt/slides/slide1.xml")!, "gs").map((a) => a.pos)
    ).toEqual(["0", "20000", "42000", "42240", "100000"]);
  });
  it.each(["__proto__", "constructor", "toString"])(
    "rejects inherited background kind %s",
    async (kind) => {
      const source = await createPresentation({ slides: [{}] }, context);
      await expect(
        mutateBackground(
          source,
          { scope: "slides", part: "/ppt/slides/slide1.xml", kind } as never,
          context
        ).then(() => "accepted")
      ).rejects.toMatchObject({ code: "invalid-value" });
    }
  );
  it("rejects a style reference targeting an unsupported list child", async () => {
    const original = parts(await createPresentation({ slides: [{}] }, context));
    original.set(
      "ppt/theme/theme1.xml",
      original
        .get("ppt/theme/theme1.xml")!
        .replace("</a:bgFillStyleLst>", "<a:effectLst/></a:bgFillStyleLst>")
    );
    const source = await writePackageArchive(
      [...original].map(([name, text]) => ({ name, bytes: new TextEncoder().encode(text) })),
      context,
      { compression: "store" }
    );
    await expect(
      mutateBackground(
        source,
        {
          scope: "slides",
          part: "/ppt/slides/slide1.xml",
          kind: "style-reference",
          styleIndex: 1004,
          styleColor: "123456"
        },
        context
      ).then(() => "accepted")
    ).rejects.toMatchObject({ code: "unsupported-edit" });
    const supported = await mutateBackground(
      source,
      {
        scope: "slides",
        part: "/ppt/slides/slide1.xml",
        kind: "style-reference",
        styleIndex: 1002,
        styleColor: "123456"
      },
      context
    );
    expect(parts(supported.bytes).get("ppt/theme/theme1.xml")).toBe(
      original.get("ppt/theme/theme1.xml")
    );
  });
});
