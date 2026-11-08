import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { addImage, createPresentation, readImages, setImage } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";
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
const tile = new Uint8Array([
  71, 73, 70, 56, 57, 97, 6, 0, 4, 0, 128, 0, 0, 0, 0, 0, 12, 34, 56, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0,
  2, 2, 68, 1, 0, 59
]);
async function deck(crop?: string) {
  const input = await addImage(
    await createPresentation({ slides: [{}] }, context),
    { slide: 1, bytes: tile, contentType: "image/gif" },
    context
  );
  if (crop === undefined) return input;
  return writePackageArchive(
    inspectZip(input).map(({ name, payload }) => ({
      name,
      bytes:
        name === "ppt/slides/slide1.xml"
          ? new TextEncoder().encode(
              new TextDecoder()
                .decode(payload)
                .replace('<a:srcRect l="0" t="0" r="0" b="0"/>', crop)
            )
          : payload
    })),
    context,
    { compression: "auto" }
  );
}
function parts(bytes: Uint8Array) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/out.pptx", bytes);
  return new Map(
    inspectZip(new Uint8Array(fs.readFileSync("/out.pptx") as Buffer)).map((x) => [
      x.name,
      x.payload
    ])
  );
}
function attrs(bytes: Uint8Array, local: string) {
  const found: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      found.push(
        Object.fromEntries(
          Object.values(tag.attributes)
            .filter((x) => x.uri !== "http://www.w3.org/2000/xmlns/")
            .map((x) => [x.name, x.value])
        )
      );
  });
  parser.write(new TextDecoder().decode(bytes)).close();
  return found;
}
it.each([
  ["", { left: 0, top: 0, right: 0, bottom: 0 }],
  ["<a:srcRect/>", { left: 0, top: 0, right: 0, bottom: 0 }],
  ['<a:srcRect l="0%" t="19%"/>', { left: 0, top: 0.19, right: 0, bottom: 0 }],
  ['<a:srcRect l="45678"/>', { left: 0.45678, top: 0, right: 0, bottom: 0 }],
  [
    '<a:srcRect l="37214" t="-17000" r="270000" b="28456"/>',
    { left: 0.37214, top: -0.17, right: 2.7, bottom: 0.28456 }
  ],
  [
    '<a:srcRect l="17.25%" t="009%" r="-028.375%"/>',
    { left: 0.1725, top: 0.09, right: -0.28375, bottom: 0 }
  ]
])("inspects stored crop without imposing editing policy %s", async (xml, expected) => {
  const input = await deck(xml);
  expect((await readImages(input, {}, context)).occurrences[0]!.crop).toEqual(expected);
  const output = await setImage(input, { slide: 1, image: 1 }, { opacity: 0.35 }, context);
  expect((await readImages(output.bytes, {}, context)).occurrences[0]!.crop).toEqual(expected);
});
it.each(["Left", "Top", "Right", "Bottom"] as const)(
  "quantizes and resets the %s crop independently",
  async (side) => {
    let input = await deck();
    const option = `crop${side}`;
    const key = side[0]!.toLowerCase();
    for (const [value, stored] of [
      [0.123455, 12346],
      [-0.000005, -1],
      [0, 0]
    ] as const) {
      const result = await setImage(input, { slide: 1, image: 1 }, { [option]: value }, context);
      expect(attrs(parts(result.bytes).get("ppt/slides/slide1.xml")!, "srcRect")[0]![key]).toBe(
        String(stored)
      );
      input = result.bytes;
    }
  }
);
it("allows compensated extended crop and preserves unedited metadata and media", async () => {
  const input = await deck('<a:srcRect l="-210000" r="250000" t="12000" b="18000"/>');
  const result = await setImage(
    input,
    { slide: 1, image: 1 },
    {
      cropRight: 2.65,
      rotation: -419.5,
      flipHorizontal: true,
      flipVertical: false,
      opacity: 0.456785,
      borderColor: "127abc",
      borderWidth: 19050,
      altText: "Ocean & coast"
    },
    context
  );
  const before = parts(input),
    after = parts(result.bytes),
    slide = after.get("ppt/slides/slide1.xml")!;
  expect(attrs(slide, "srcRect")).toEqual([{ l: "-210000", r: "265000", t: "12000", b: "18000" }]);
  expect(attrs(slide, "xfrm").at(-1)).toMatchObject({ rot: "18030000", flipH: "1", flipV: "0" });
  expect(attrs(slide, "alphaModFix")).toEqual([{ amt: "45679" }]);
  expect(attrs(slide, "ln")).toEqual([{ w: "19050" }]);
  expect(attrs(slide, "srgbClr").at(-1)).toEqual({ val: "127ABC" });
  expect(attrs(slide, "cNvPr").at(-1)).toMatchObject({ descr: "Ocean & coast" });
  for (const [name, bytes] of before)
    if (name !== "ppt/slides/slide1.xml") expect(after.get(name)).toEqual(bytes);
  expect(result.affected).toBe(1);
  expect(result.affectedSlides).toEqual([1]);
});
it.each([
  { cropLeft: 1 },
  { cropTop: 0.6, cropBottom: 0.4 },
  { cropRight: Infinity },
  { cropLeft: 21474.83648 },
  { cropLeft: -21474.83649 },
  { cropLeft: 0.499999, cropRight: 0.499999 },
  { opacity: 1.01 },
  { opacity: NaN },
  { borderWidth: -1 },
  { borderColor: null },
  { flipHorizontal: 1 },
  { rotation: Infinity }
])("rejects invalid edits before publication %j", async (options) => {
  await expect(
    setImage(
      await deck(),
      { slide: 1, image: 1 },
      options as Parameters<typeof setImage>[2],
      context
    )
  ).rejects.toMatchObject({ code: "invalid-value" });
});
it("repairs invalid existing crops only with a positive final rectangle", async () => {
  const input = await deck('<a:srcRect t="25571" b="80000"/>');
  await expect(
    setImage(input, { slide: 1, image: 1 }, { cropBottom: 0.8 }, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
  const result = await setImage(input, { slide: 1, image: 1 }, { cropBottom: 0.4 }, context);
  expect((await readImages(result.bytes, {}, context)).occurrences[0]!.crop.bottom).toBe(0.4);
});
it("requires explicit unambiguous selection and owns options before awaiting", async () => {
  const input = await deck();
  await expect(setImage(input, {}, { opacity: 0.5 }, context)).rejects.toBeDefined();
  const options = { opacity: 0.25 };
  const pending = setImage(input, { slide: 1, image: 1 }, options, context);
  options.opacity = 0.9;
  expect(attrs(parts((await pending).bytes).get("ppt/slides/slide1.xml")!, "alphaModFix")).toEqual([
    { amt: "25000" }
  ]);
});
it("retains untouched crop lexemes, effects, and outline details during partial changes", async () => {
  const input = await deck('<a:srcRect l="-20%" r="8%" t="00000" b="0"/>');
  const custom = await writePackageArchive(
    inspectZip(input).map(({ name, payload }) => ({
      name,
      bytes:
        name === "ppt/slides/slide1.xml"
          ? new TextEncoder().encode(
              new TextDecoder()
                .decode(payload)
                .replace(
                  '<a:blip r:embed="rId2"/>',
                  '<a:blip r:embed="rId2"><a:grayscl/><a:alphaModFix amt="76000"/><a:extLst/></a:blip>'
                )
                .replace(
                  "</p:spPr>",
                  '<a:ln w="12700" cap="rnd"><a:solidFill><a:srgbClr val="223344"/></a:solidFill><a:prstDash val="dash"/><a:round/><a:extLst/></a:ln></p:spPr>'
                )
            )
          : payload
    })),
    context,
    { compression: "auto" }
  );
  const output = await setImage(
    custom,
    { slide: 1, image: 1 },
    { cropBottom: 0.15, opacity: 0, borderWidth: 0 },
    context
  );
  const slide = parts(output.bytes).get("ppt/slides/slide1.xml")!;
  expect(attrs(slide, "srcRect")).toEqual([{ l: "-20%", r: "8%", t: "00000", b: "15000" }]);
  expect(attrs(slide, "alphaModFix")).toEqual([{ amt: "0" }]);
  expect(attrs(slide, "grayscl")).toHaveLength(1);
  expect(attrs(slide, "ln")).toEqual([{ w: "0", cap: "rnd" }]);
  expect(attrs(slide, "prstDash")).toEqual([{ val: "dash" }]);
  expect(attrs(slide, "round")).toHaveLength(1);
  const recolored = await setImage(
    output.bytes,
    { slide: 1, image: 1 },
    { borderColor: "ABCDEF", opacity: 1 },
    context
  );
  expect(attrs(parts(recolored.bytes).get("ppt/slides/slide1.xml")!, "ln")).toEqual([
    { w: "0", cap: "rnd" }
  ]);
  expect(attrs(parts(recolored.bytes).get("ppt/slides/slide1.xml")!, "alphaModFix")).toEqual([
    { amt: "100000" }
  ]);
});
it("accepts signed crop bounds with positive visible extent", async () => {
  const result = await setImage(
    await deck(),
    { slide: 1, image: 1 },
    { cropLeft: -21474.83648, cropRight: 21474.83647 },
    context
  );
  expect(attrs(parts(result.bytes).get("ppt/slides/slide1.xml")!, "srcRect")).toEqual([
    { l: "-2147483648", t: "0", r: "2147483647", b: "0" }
  ]);
});
it("changes only the selected occurrence and refuses stale tokens", async () => {
  const input = await addImage(
    await deck(),
    { slide: 1, bytes: tile, contentType: "image/gif" },
    context
  );
  const before = (await readImages(input, {}, context)).occurrences;
  await expect(setImage(input, { slide: 1 }, { opacity: 0.5 }, context)).rejects.toMatchObject({
    code: "invalid-selection"
  });
  const output = await setImage(input, { slide: 1, image: 1 }, { cropLeft: 0.17 }, context);
  await expect(
    setImage(
      output.bytes,
      { select: JSON.stringify(before[0]!.location) },
      { opacity: 0.2 },
      context
    )
  ).rejects.toMatchObject({ code: "stale-selection" });
  const after = (await readImages(output.bytes, {}, context)).occurrences;
  expect(after.map((x) => x.crop.left)).toEqual([0.17, 0]);
  expect(after[1]!.sha256).toBe(before[1]!.sha256);
  const all = await setImage(output.bytes, { slide: 1 }, { opacity: 0.3, all: true }, context);
  expect(all.affected).toBe(2);
  const missing = await setImage(
    input,
    { slide: 1, image: 99 },
    { opacity: 0.2, allowEmpty: true },
    context
  );
  expect(missing.affected).toBe(0);
  expect(missing.bytes).toEqual(input);
});

it("rejects shared edit scope and accessor options without invoking them", async () => {
  const input = await deck();
  await expect(
    setImage(input, { scope: "shared" }, { all: true, opacity: 0.5 }, context)
  ).rejects.toMatchObject({ code: "invalid-selection" });
  const getter = vi.fn(() => 0.2);
  const options = Object.defineProperty({}, "opacity", { get: getter, enumerable: true });
  await expect(setImage(input, { slide: 1, image: 1 }, options, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
  expect(getter).not.toHaveBeenCalled();
});
