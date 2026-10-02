import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { parseXmlPart } from "./xml.js";
import { readSelectionIndex } from "./selectors.js";
import { mutateTransitions } from "./transitions.js";
import { readAnimations } from "./animations.js";
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
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
async function fixture(content: string, shapes = false) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync(
    "/deck",
    await createPresentation(
      {
        slides: [
          {
            shapes: shapes
              ? [{ name: "Badge", text: "Badge", x: 0, y: 0, width: 100, height: 100 }]
              : []
          }
        ]
      },
      context
    )
  );
  const entries = inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer));
  const bytes = entries.map(({ name, payload }) => {
    if (name !== "ppt/slides/slide1.xml") return { name, bytes: payload };
    const doc = parseXmlPart(payload, context.xmlLimits);
    return {
      name,
      bytes: doc
        .spliceChildren(doc.root, doc.root.children.length, 0, [
          `<p:timing xmlns:p="${p}">${content}</p:timing>`
        ])
        .bytes()
    };
  });
  return writePackageArchive(bytes, context, { compression: "store" });
}
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
describe("animation graph inventory", () => {
  it("retains nested sequence, parallel, effects, trigger metadata and opaque motion without execution", async () => {
    const bytes = await fixture(
      '<p:tnLst><p:seq><p:cTn id="1" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="2"><p:stCondLst><p:cond evt="onClick" delay="indefinite"><p:tgtEl><p:spTgt spid="77"/></p:tgtEl></p:cond></p:stCondLst><p:childTnLst><p:animMotion path="M 0 0 C .1 .2 .3 .4 1 1 E"><p:cBhvr><p:cTn id="3" presetClass="entr" presetID="10"/><p:tgtEl><p:spTgt spid="77"/></p:tgtEl></p:cBhvr></p:animMotion></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:tnLst>'
    );
    const before = bytes.slice();
    const [record] = await readAnimations(bytes, {}, context);
    expect(record!.nodes.map((n) => n.type)).toEqual([
      "timing",
      "tnLst",
      "seq",
      "cTn",
      "childTnLst",
      "par",
      "cTn",
      "stCondLst",
      "cond",
      "tgtEl",
      "spTgt",
      "childTnLst",
      "animMotion",
      "cBhvr",
      "cTn",
      "tgtEl",
      "spTgt"
    ]);
    expect(record!.nodes[2]).toMatchObject({
      kind: "sequence",
      children: [record!.nodes[3]!.id],
      parentId: record!.nodes[1]!.id
    });
    expect(record!.nodes[5]!.kind).toBe("parallel");
    expect(record!.nodes[8]!.triggerType).toBe("onClick");
    expect(record!.nodes[12]).toMatchObject({
      kind: "effect",
      effectType: "animMotion",
      motionPath: "M 0 0 C .1 .2 .3 .4 1 1 E"
    });
    expect(record!.targetShapeIds).toEqual(["77"]);
    expect(record!.diagnostics.filter((d) => d.code === "missing-target")).toHaveLength(2);
    expect(record!.executionVerified).toBe(false);
    expect(bytes).toEqual(before);
    expect(await readAnimations(bytes, {}, context)).toEqual([record]);
  });
  it("reports duplicate timing identifiers, unresolved references and cycles without following them", async () => {
    const bytes = await fixture(
      '<p:tnLst><p:par><p:cTn id="1"><p:stCondLst><p:cond><p:tn val="2"/></p:cond></p:stCondLst></p:cTn></p:par><p:par><p:cTn id="2"><p:endCondLst><p:cond><p:tn val="1"/><p:tn val="404"/></p:cond></p:endCondLst></p:cTn></p:par><p:par><p:cTn id="8"/></p:par><p:par><p:cTn id="8"/></p:par></p:tnLst>'
    );
    const [record] = await readAnimations(bytes, {}, context);
    expect(record!.diagnostics.map((d) => d.code)).toEqual([
      "duplicate-timing-id",
      "missing-timing-reference",
      "timing-cycle"
    ]);
    expect(
      record!.nodes
        .filter((n) => n.type === "tn")
        .map((n) => n.timingReferences.map((r) => r.timingId))
    ).toEqual([["2"], ["1"], ["404"]]);
  });
  it.each([
    ["", 0],
    ['<p:tnLst><p:video><p:cMediaNode><p:cTn id="1"/></p:cMediaNode></p:video></p:tnLst>', 1],
    ["<p:tnLst><p:video/><p:video/></p:tnLst>", 2],
    ['<p:tnLst><p:par><p:cTn id="1"/></p:par></p:tnLst>', 0]
  ] as const)("inventories media structure without repairing it: %s", async (markup, expected) => {
    const bytes = await fixture(markup);
    const saved = bytes.slice();
    const [record] = await readAnimations(bytes, {}, context);
    expect(record!.nodes.filter((n) => n.mediaInteraction === "video")).toHaveLength(expected);
    expect(bytes).toEqual(saved);
  });
  it("returns empty timelines and rejects invalid selectors and exhausted XML budgets", async () => {
    const bytes = await createPresentation({ slides: [{}, {}] }, context);
    expect((await readAnimations(bytes, {}, context)).map((r) => [r.slide, r.nodes])).toEqual([
      [1, []],
      [2, []]
    ]);
    await expect(
      readAnimations(bytes, { selection: { kind: "part", all: true } }, context)
    ).rejects.toMatchObject({ code: "invalid-selection" });
    await expect(
      readAnimations(bytes, {}, { ...context, xmlLimits: { ...context.xmlLimits, maxNodes: 1 } })
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("retains opaque content and media commands through an unrelated transition edit", async () => {
    const bytes = await fixture(
      '<p:tnLst><p:seq><p:cTn id="1"><p:childTnLst><p:audio/><p:video/><p:cmd cmd="playFrom(0.0)"/><p:animMotion path="M 0 0 L 1 1 E"/><p:rtn val="all"/><p:sndTgt name="Chime"/><x:seq xmlns:x="urn:custom" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" x:id="77">opaque text</x:seq></p:childTnLst></p:cTn></p:seq></p:tnLst>'
    );
    const before = (await readAnimations(bytes, {}, context))[0]!;
    expect(
      before.nodes.filter((n) => n.mediaInteraction !== null).map((n) => n.mediaInteraction)
    ).toEqual(["audio", "video", "playFrom(0.0)", "sndTgt"]);
    expect(before.nodes.find((n) => n.namespace === "urn:custom")).toMatchObject({
      kind: "opaque",
      timingId: null
    });
    expect(before.xml[0]).toContain("opaque text");
    const changed = await mutateTransitions(
      bytes,
      "add",
      {
        selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
        kind: "fade"
      },
      context
    );
    const after = (await readAnimations(changed.bytes, {}, context))[0]!;
    expect(after.xml).toEqual(before.xml);
    const sourceXml = new TextDecoder().decode(
      inspectZip(bytes).find((e) => e.name === "ppt/slides/slide1.xml")!.payload
    );
    const changedXml = new TextDecoder().decode(
      inspectZip(changed.bytes).find((e) => e.name === "ppt/slides/slide1.xml")!.payload
    );
    const start = sourceXml.indexOf("<p:timing"),
      end = sourceXml.indexOf("</p:timing>") + 11;
    expect(changedXml).toContain(sourceXml.slice(start, end));
  });
  it("selects target shapes while retaining complete graph ancestry", async () => {
    const bytes = await fixture(
      '<p:tnLst><p:seq><p:cTn id="1"><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cTn></p:seq></p:tnLst>',
      true
    );
    const records = await readAnimations(
      bytes,
      { selection: { kind: "object", owner: "/ppt/slides/slide1.xml", name: "Badge" } },
      context
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.nodes.map((n) => n.type)).toEqual([
      "timing",
      "tnLst",
      "seq",
      "cTn",
      "tgtEl",
      "spTgt"
    ]);
    expect(records[0]!.diagnostics).toEqual([]);
    const empty = await fixture("<p:tnLst/>", true);
    expect(
      await readAnimations(
        empty,
        { selection: { kind: "object", owner: "/ppt/slides/slide1.xml", name: "Badge" } },
        context
      )
    ).toEqual([]);
  });
  it("rejects accessor options without evaluating them and observes cancellation", async () => {
    const access = vi.fn();
    await expect(
      readAnimations(
        new Uint8Array(),
        Object.defineProperty({}, "selection", { get: access }),
        context
      )
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(access).not.toHaveBeenCalled();
    const signal = AbortSignal.abort();
    await expect(
      readAnimations(new Uint8Array(), {}, { ...context, signal })
    ).rejects.toMatchObject({ code: "cancelled" });
  });
  it("accepts an emitted shape token without requiring a redundant kind", async () => {
    const bytes = await fixture(
      '<p:tnLst><p:seq><p:cTn id="1"><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cTn></p:seq></p:tnLst>',
      true
    );
    const index = await readSelectionIndex(bytes, context);
    const [record] = await readAnimations(
      bytes,
      { selection: { token: index.objects[0]!.token } },
      context
    );
    expect(record!.targetShapeIds).toEqual(["2"]);
  });
  it("rejects duplicate shape identifiers through the shared selection boundary", async () => {
    const bytes = await fixture(
      '<p:tnLst><p:seq><p:cTn id="1"><p:tgtEl><p:spTgt spid="2"/></p:tgtEl></p:cTn></p:seq></p:tnLst>',
      true
    );
    const entries = inspectZip(bytes).map(({ name, payload }) => {
      if (name !== "ppt/slides/slide1.xml") return { name, bytes: payload };
      const doc = parseXmlPart(payload, context.xmlLimits);
      const tree = doc.root.children[0]!.children.find((n) => n.name.localName === "spTree")!;
      const shape = tree.children.find((n) => n.name.localName === "sp")!;
      return {
        name,
        bytes: doc.spliceChildren(tree, tree.children.length, 0, [doc.markup(shape, true)]).bytes()
      };
    });
    const source = await writePackageArchive(entries, context, { compression: "store" });
    await expect(readAnimations(source, {}, context)).rejects.toMatchObject({
      code: "invalid-opc"
    });
  });
  it("bounds expanded timing reference destinations before producing inventory", async () => {
    const bytes = await fixture(
      "<p:tnLst>" +
        Array.from({ length: 35 }, () => '<p:par><p:cTn id="4"/></p:par>').join("") +
        '<p:par><p:cTn id="9"><p:stCondLst>' +
        Array.from({ length: 35 }, () => '<p:cond><p:tn val="4"/></p:cond>').join("") +
        "</p:stCondLst></p:cTn></p:par></p:tnLst>"
    );
    await expect(
      readAnimations(bytes, {}, { ...context, xmlLimits: { ...context.xmlLimits, maxNodes: 500 } })
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("orders slides by presentation membership and nodes by XML order despite reversed archive members", async () => {
    const source = await createPresentation({ slides: [{}, {}] }, context);
    const entries = inspectZip(source).map(({ name, payload }) => {
      if (!["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"].includes(name))
        return { name, bytes: payload };
      const doc = parseXmlPart(payload, context.xmlLimits);
      const timeline =
        name === "ppt/slides/slide1.xml"
          ? '<p:seq><p:cTn id="20"/></p:seq><p:par><p:cTn id="3"/></p:par>'
          : '<p:par><p:cTn id="5"/></p:par>';
      return {
        name,
        bytes: doc
          .spliceChildren(doc.root, doc.root.children.length, 0, [
            `<p:timing xmlns:p="${p}"><p:tnLst>${timeline}</p:tnLst></p:timing>`
          ])
          .bytes()
      };
    });
    const expected = [
      [
        1,
        "/ppt/slides/slide1.xml",
        [
          ["timing", null],
          ["tnLst", null],
          ["seq", null],
          ["cTn", "20"],
          ["par", null],
          ["cTn", "3"]
        ]
      ],
      [
        2,
        "/ppt/slides/slide2.xml",
        [
          ["timing", null],
          ["tnLst", null],
          ["par", null],
          ["cTn", "5"]
        ]
      ]
    ];
    for (const members of [entries, [...entries].reverse()]) {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/deck", storedArchive(members));
      const bytes = new Uint8Array(volume.readFileSync("/deck") as Buffer);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(new TextDecoder().decode(bytes.slice(30, 30 + view.getUint16(26, true)))).toBe(
        members[0]!.name
      );
      const records = await readAnimations(bytes, {}, context);
      expect(
        records.map((r) => [r.slide, r.part, r.nodes.map((n) => [n.type, n.timingId])])
      ).toEqual(expected);
    }
  });
});
