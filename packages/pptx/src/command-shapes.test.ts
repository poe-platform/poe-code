import { Volume } from "memfs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { addShape, readShapes, mutateShapes } from "./shape-operations.js";
import { Inches, Pt } from "./length.js";
import { createPresentation } from "./creation.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { readPackage } from "./package-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { parseXmlPart } from "./xml.js";
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
const engine = createPptxCommandEngine({
  context,
  maxArgumentBytes: 65536,
  maxOutputBytes: 262144
});
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
async function fixture(input?: Uint8Array) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", input ?? (await createPresentation({ slides: [{}] }, context)));
  return async (args: string[]) => {
    const output = await engine.execute({
      args: [...args, "--json"].map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      readInput: async (path) => new Uint8Array(fs.readFileSync(path) as Buffer),
      publishOutput: async (request) => {
        if (!request.dryRun) fs.writeFileSync(request.outputPath, request.bytes);
      }
    });
    return { code: output.exitCode, value: JSON.parse(new TextDecoder().decode(output.stdout)) };
  };
}
describe("shape resource commands", () => {
  it("projects nested group coordinates through CLI and changes only local placement", async () => {
    const archive = await readPackage(await createPresentation({ slides: [{}] }, context), context);
    const part = "/ppt/slides/slide1.xml";
    let xml = parseXmlPart(archive.get(part), context.xmlLimits);
    const p = xml.root.name.namespace,
      a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const tree = xml.root.children[0]!.children.find((x) => x.name.localName === "spTree")!;
    const group = `<p:grpSp xmlns:p="${p}" xmlns:a="${a}"><p:nvGrpSpPr><p:cNvPr id="2" name="Outer"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="10800000"><a:off x="1000" y="2000"/><a:ext cx="300" cy="600"/><a:chOff x="0" y="0"/><a:chExt cx="300" cy="300"/></a:xfrm></p:grpSpPr><p:grpSp><p:nvGrpSpPr><p:cNvPr id="3" name="Inner"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm rot="5400000" flipH="1"><a:off x="30" y="-20"/><a:ext cx="200" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="4" name="Panel"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="-10" y="20"/><a:ext cx="40" cy="20"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:sp></p:grpSp></p:grpSp>`;
    xml = xml.spliceChildren(tree, tree.children.length, 0, [group]);
    const input = storedArchive(
      archive.names.map((name) => ({
        name: name.slice(1),
        bytes: name === part ? xml.bytes() : archive.get(name)
      }))
    );
    const run = await fixture(input);
    const before = await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Panel"]);
    expect(before.code, JSON.stringify(before.value)).toBe(0);
    expect(before.value.data.records[0].geometry).toEqual({
      coordinateSystem: "group",
      unit: "emu",
      groupPath: ["2", "3"],
      corners: [
        { x: 1140, y: 2300 },
        { x: 1140, y: 2460 },
        { x: 1160, y: 2460 },
        { x: 1160, y: 2300 }
      ]
    });
    const changed = await run([
      "shapes",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Panel",
      "--left",
      "-20emu",
      "--in-place"
    ]);
    expect(changed.code, JSON.stringify(changed.value)).toBe(0);
    const after = await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Panel"]);
    expect(after.value.data.records[0]).toMatchObject({
      left: -20,
      top: 20,
      geometry: {
        corners: [
          { x: 1140, y: 2260 },
          { x: 1140, y: 2420 },
          { x: 1160, y: 2420 },
          { x: 1160, y: 2260 }
        ]
      }
    });
    const sdk = await mutateShapes(
      input,
      { slide: 1, shape: "Panel", update: { left: { value: -20, unit: "emu" } } },
      context
    );
    expect(
      (await readShapes(sdk.bytes, { slide: 1, shape: "Panel" }, context))[0]!.geometry
    ).toEqual(after.value.data.records[0].geometry);
  });
  it("applies signed placement, center rotation and explicit flips through CLI and byte SDK", async () => {
    const run = await fixture();
    const added = await run([
      "shapes",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--kind",
      "text-box",
      "--name",
      "Tile",
      "--left",
      "-10emu",
      "--top",
      "20emu",
      "--width",
      "40emu",
      "--height",
      "20emu",
      "--rotation",
      "90",
      "--flip-horizontal",
      "true",
      "--in-place"
    ]);
    expect(added.code, JSON.stringify(added.value)).toBe(0);
    const inspected = await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Tile"]);
    expect(inspected.code).toBe(0);
    expect(inspected.value.data.records[0]).toMatchObject({
      left: -10,
      top: 20,
      width: 40,
      height: 20,
      rotation: 90,
      flipHorizontal: true,
      flipVertical: false,
      geometry: {
        coordinateSystem: "slide",
        unit: "emu",
        groupPath: [],
        corners: [
          { x: 20, y: 50 },
          { x: 20, y: 10 },
          { x: 0, y: 10 },
          { x: 0, y: 50 }
        ]
      }
    });
    const schema = (await run(["schema", "shapes", "get"])).value.data.operations["shapes.get"]
      .result;
    expect(compileJsonSchema(schema).validate(inspected.value).ok).toBe(true);
    const set = await run([
      "shapes",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Tile",
      "--flip-horizontal",
      "false",
      "--flip-vertical",
      "true",
      "--left",
      "-2.5emu",
      "--in-place"
    ]);
    expect(set.code, JSON.stringify(set.value)).toBe(0);
    const after = (await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Tile"]))
      .value.data.records[0];
    expect(after).toMatchObject({
      left: -3,
      top: 20,
      width: 40,
      height: 20,
      flipHorizontal: false,
      flipVertical: true
    });
    const source = await createPresentation(
      { slides: [{ shapes: [{ x: -10, y: 20, width: 40, height: 20, text: "Tile" }] }] },
      context
    );
    const result = await mutateShapes(
      source,
      { slide: 1, update: { rotation: 90, flipHorizontal: true } },
      context
    );
    expect((await readShapes(result.bytes, { slide: 1 }, context))[0]!.geometry?.corners).toEqual([
      { x: 20, y: 50 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 50 }
    ]);
    for (const value of ["null", "0", "1", "False"]) {
      expect(
        (
          await run([
            "shapes",
            "set",
            "/deck.pptx",
            "--slide",
            "1",
            "--shape",
            "Tile",
            "--flip-horizontal",
            value,
            "--in-place"
          ])
        ).code
      ).toBe(2);
    }
  });
  it("rejects untyped SDK selector controls before input admission", async () => {
    const read = vi.fn(async () => null);
    for (const invalid of [
      { all: "false" },
      { allowEmpty: "false" },
      { ignored: 1 },
      { shape: 2 },
      { part: "" }
    ]) {
      await expect(
        mutateShapes({ read }, { ...invalid, update: { name: "Changed" } } as never, context)
      ).rejects.toMatchObject({ code: "invalid-value" });
      expect(read).not.toHaveBeenCalled();
    }
    await expect(readShapes({ read }, { all: true }, context)).rejects.toMatchObject({
      code: "invalid-value"
    });
    expect(read).not.toHaveBeenCalled();
    const bytes = await createPresentation(
      {
        slides: [
          {
            shapes: [
              { x: 0, y: 0, width: 100, height: 100, text: "One" },
              { x: 0, y: 0, width: 100, height: 100, text: "Two" }
            ]
          }
        ]
      },
      context
    );
    await expect(
      mutateShapes(bytes, { all: "false", update: { name: "Bulk" } } as never, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect((await readShapes(bytes, {}, context)).map((x) => x.name)).not.toContain("Bulk");
  });
  it.each([
    { ids: [], expected: 2 },
    { ids: [2], expected: 3 },
    { ids: [3], expected: 4 },
    { ids: [4], expected: 5 },
    { ids: [4294967295], expected: 2 }
  ])("allocates a local available ID for $ids", async ({ ids, expected }) => {
    const bytes = await createPresentation({ slides: [{}] }, context);
    const archive = await readPackage(bytes, context);
    const name = "/ppt/slides/slide1.xml";
    let doc = parseXmlPart(archive.get(name), context.xmlLimits);
    const p = doc.root.name.namespace;
    const tree = doc.root.children[0]!.children.find((x) => x.name.localName === "spTree")!;
    doc = doc.spliceChildren(
      tree,
      tree.children.length,
      0,
      ids.map(
        (id) =>
          `<p:sp xmlns:p="${p}"><p:nvSpPr><p:cNvPr id="${id}" name="Existing ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`
      )
    );
    const source = storedArchive(
      archive.names.map((part) => ({
        name: part.slice(1),
        bytes: part === name ? doc.bytes() : archive.get(part)
      }))
    );
    const result = await addShape(
      source,
      {
        slide: 1,
        update: {
          kind: "text-box",
          name: "Added",
          left: new Pt(0),
          top: new Pt(0),
          width: new Pt(20),
          height: new Pt(10)
        }
      },
      context
    );
    expect(
      (await readShapes(result.bytes, { slide: 1, shape: "Added" }, context))[0]!.shapeId
    ).toBe(expected);
  });
  it("ignores foreign identity metadata when allocating a drawing identity", async () => {
    const bytes = await createPresentation({ slides: [{}] }, context);
    const archive = await readPackage(bytes, context);
    const name = "/ppt/slides/slide1.xml";
    let doc = parseXmlPart(archive.get(name), context.xmlLimits);
    const p = doc.root.name.namespace;
    const tree = doc.root.children[0]!.children.find((x) => x.name.localName === "spTree")!;
    doc = doc.spliceChildren(tree, tree.children.length, 0, [
      `<p:extLst xmlns:p="${p}"><p:ext uri="urn:original:metadata"><v:cNvPr xmlns:v="urn:original:metadata" id="not-an-id"/></p:ext></p:extLst>`
    ]);
    const source = storedArchive(
      archive.names.map((part) => ({
        name: part.slice(1),
        bytes: part === name ? doc.bytes() : archive.get(part)
      }))
    );
    const changed = await addShape(
      source,
      {
        slide: 1,
        update: {
          kind: "text-box",
          left: new Pt(0),
          top: new Pt(0),
          width: new Pt(20),
          height: new Pt(10)
        }
      },
      context
    );
    expect((await readShapes(changed.bytes, { slide: 1 }, context))[0]!.shapeId).toBe(2);
    const xml = new TextDecoder().decode((await readPackage(changed.bytes, context)).get(name));
    expect(xml).toContain('id="not-an-id"');
    const parsed = parseXmlPart(new TextEncoder().encode(xml), context.xmlLimits);
    const children = parsed.root.children[0]!.children.find(
      (x) => x.name.localName === "spTree"
    )!.children.map((x) => x.name.localName);
    expect(children).toEqual(["nvGrpSpPr", "grpSpPr", "sp", "extLst"]);
  });
  it("exposes byte SDK shape units with original independent expectations", async () => {
    const bytes = await createPresentation({ slides: [{}] }, context);
    const changed = await addShape(
      bytes,
      {
        slide: 1,
        update: {
          kind: "OVAL",
          name: "Oval card",
          left: new Pt(-2),
          top: new Pt(0),
          width: new Inches(2),
          height: new Inches(1),
          description: "An oval",
          lineColor: "123456"
        }
      },
      context
    );
    const records = await readShapes(changed.bytes, { slide: 1 }, context);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      shapeId: 2,
      name: "Oval card",
      left: -25400,
      top: 0,
      width: 1828800,
      height: 914400,
      description: "An oval",
      lineColor: "123456"
    });
    expect(await readShapes(bytes, { slide: 1 }, context)).toEqual([]);
  });
  it("publishes preset constraints and scoped help without acquiring input", async () => {
    const run = await fixture();
    const schema = (await run(["schema", "shapes", "set"])).value.data.operations["shapes.set"];
    const check = compileJsonSchema(schema.options);
    expect(
      check.validate({ slide: 1, shape: "Card", dryRun: true, kind: "RECTANGLE", fill: "123AbC" })
        .ok
    ).toBe(true);
    expect(check.validate({ slide: 1, shape: "Card", dryRun: true, lineWidth: null }).ok).toBe(
      true
    );
    for (const invalid of [
      { kind: "imaginary" },
      { kind: 100000 },
      { kind: "from_xml" },
      { kind: null },
      { fill: "abc" },
      { lineColor: "GGGGGG" },
      { rotation: 360001 },
      { width: { value: -1, unit: "cm" } }
    ])
      expect(check.validate({ slide: 1, shape: "Card", dryRun: true, ...invalid }).ok).toBe(false);
    const help = await run(["shapes", "set", "--help"]);
    expect(help.code).toBe(0);
    expect(help.value.data.usage).toContain("--description");
  });
  it("adds a slide preset and reads independently specified geometry and metadata", async () => {
    const run = await fixture();
    const added = await run([
      "shapes",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--kind",
      "RECTANGLE",
      "--name",
      "Card",
      "--left",
      "-1pt",
      "--top",
      "0emu",
      "--width",
      "2in",
      "--height",
      "1cm",
      "--fill",
      "1256AB",
      "--title",
      "Card title",
      "--locked",
      "false",
      "--in-place"
    ]);
    expect(added.code, JSON.stringify(added.value)).toBe(0);
    const read = await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Card"]);
    expect(read.code).toBe(0);
    const resultSchema = (await run(["schema", "shapes", "get"])).value.data.operations[
      "shapes.get"
    ].result;
    expect(compileJsonSchema(resultSchema).validate(read.value).ok).toBe(true);
    expect(
      compileJsonSchema(resultSchema).validate({ ...read.value, data: { unexpected: true } }).ok
    ).toBe(false);
    expect(read.value.data.records[0]).toMatchObject({
      name: "Card",
      left: -12700,
      top: 0,
      width: 1828800,
      height: 360000,
      fill: "1256AB",
      title: "Card title",
      locked: false
    });
    const changed = await run([
      "shapes",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Card",
      "--description",
      "A small card",
      "--line-color",
      "ABCDEF",
      "--line-width",
      "2pt",
      "--in-place"
    ]);
    expect(changed.code, JSON.stringify(changed.value)).toBe(0);
    const final = await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Card"]);
    expect(final.value.data.records[0]).toMatchObject({
      description: "A small card",
      lineColor: "ABCDEF",
      lineWidth: 25400,
      width: 1828800
    });
    const cleared = await run([
      "shapes",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Card",
      "--line-width",
      "null",
      "--in-place"
    ]);
    expect(cleared.code, JSON.stringify(cleared.value)).toBe(0);
    const inherited = await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Card"]);
    expect(inherited.value.data.records[0]).toMatchObject({
      lineWidth: null,
      lineColor: "ABCDEF",
      fill: "1256AB"
    });
    expect(
      (
        await run([
          "shapes",
          "set",
          "/deck.pptx",
          "--slide",
          "1",
          "--shape",
          "Card",
          "--fill",
          "solid",
          "--line-color",
          "solid",
          "--in-place"
        ])
      ).code
    ).toBe(0);
    const retained = await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Card"]);
    expect(retained.value.data.records[0]).toMatchObject({ fill: "1256AB", lineColor: "ABCDEF" });
    expect(
      (
        await run([
          "shapes",
          "set",
          "/deck.pptx",
          "--slide",
          "1",
          "--shape",
          "Card",
          "--fill",
          "null",
          "--line-color",
          "null",
          "--in-place"
        ])
      ).code
    ).toBe(0);
    const emptySolid = await run([
      "shapes",
      "set",
      "/deck.pptx",
      "--slide",
      "1",
      "--shape",
      "Card",
      "--fill",
      "solid",
      "--line-color",
      "solid",
      "--in-place"
    ]);
    expect(emptySolid.code, JSON.stringify(emptySolid.value)).toBe(0);
    const empty = await run(["shapes", "get", "/deck.pptx", "--slide", "1", "--shape", "Card"]);
    expect(empty.value.data.records[0]).toMatchObject({
      fillType: "solidFill",
      fill: null,
      lineFillType: "solidFill",
      lineColor: null
    });
    const setSchema = (await run(["schema", "shapes", "set"])).value.data.operations["shapes.set"]
      .options;
    expect(
      compileJsonSchema(setSchema).validate({
        slide: 1,
        shape: "Card",
        fill: "solid",
        lineColor: "solid",
        dryRun: true
      }).ok
    ).toBe(true);
  });
  it.each(["1", "NaNpt", "-1in"])("rejects invalid width %s before writing", async (width) => {
    const run = await fixture();
    expect(
      (
        await run([
          "shapes",
          "add",
          "/deck.pptx",
          "--slide",
          "1",
          "--kind",
          "text-box",
          "--left",
          "0emu",
          "--top",
          "0emu",
          "--width",
          width,
          "--height",
          "1in",
          "--in-place"
        ])
      ).code
    ).toBe(2);
  });
});
