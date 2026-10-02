import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { listLinks, openLinkSession } from "./links.js";
import { SaxesParser } from "saxes";
import { Hyperlink, LinkShape, PP_ACTION } from "./links-model.js";
import { parseXmlPart } from "./xml.js";
import { writePackageArchive } from "./package-writer.js";
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
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

async function fixture(markup: string | readonly string[], relationships = "") {
  const source = await createPresentation({ slides: [{}, {}, {}] }, context);
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", source);
  const map = new Map<string, Uint8Array>(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((entry) => [
      entry.name,
      entry.payload
    ])
  );
  const xml = parseXmlPart(map.get("ppt/slides/slide2.xml")!, context.xmlLimits);
  const tree = xml.root.children
    .find((node) => node.name.localName === "cSld")!
    .children.find((node) => node.name.localName === "spTree")!;
  map.set(
    "ppt/slides/slide2.xml",
    xml
      .spliceChildren(tree, tree.children.length, 0, typeof markup === "string" ? [markup] : markup)
      .bytes()
  );
  if (relationships) {
    const rel = parseXmlPart(map.get("ppt/slides/_rels/slide2.xml.rels")!, context.xmlLimits);
    map.set(
      "ppt/slides/_rels/slide2.xml.rels",
      rel.spliceChildren(rel.root, rel.root.children.length, 0, [relationships]).bytes()
    );
  }
  return writePackageArchive(
    [...map].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "store" }
  );
}

function shape(attributes: string, trigger = "hlinkClick") {
  return `<p:sp xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:nvSpPr><p:cNvPr id="42" name="Destination"><a:${trigger} ${attributes}/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`;
}

describe("inert link action inspection", () => {
  it("ignores foreign identity lookalikes and rejects duplicate drawing identities", async () => {
    const real = shape('action="ppaction://hlinkshowjump?jump=nextslide"');
    const bytes = await fixture([
      real,
      '<x:extension xmlns:x="urn:original:extension" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x"><x:cNvPr id="42"/></x:extension>'
    ]);
    const session = await openLinkSession(bytes, context);
    expect(
      new LinkShape(session, { owner: "/ppt/slides/slide2.xml", id: "42" }).click_action.action
    ).toBe(PP_ACTION.NEXT_SLIDE);
    await expect(openLinkSession(await fixture([real, real]), context)).rejects.toMatchObject({
      code: "invalid-opc"
    });
  });
  it.each([
    ["sp", "nvSpPr"],
    ["pic", "nvPicPr"],
    ["cxnSp", "nvCxnSpPr"],
    ["graphicFrame", "nvGraphicFramePr"]
  ] as const)("binds live click actions for %s owners", async (tag, nonvisual) => {
    const bytes = await fixture(
      `<p:${tag} xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:${nonvisual}><p:cNvPr id="64" name="Reference owner"/></p:${nonvisual}><p:spPr/></p:${tag}>`
    );
    const session = await openLinkSession(bytes, context);
    const view = new LinkShape(session, { owner: "/ppt/slides/slide2.xml", id: "64" });
    expect(view.click_action.action).toBe(PP_ACTION.NONE);
    view.click_action.hyperlink.address = "https://example.test/owned";
    expect(view.click_action.hyperlink.address).toBe("https://example.test/owned");
    expect(await listLinks(await session.save(), {}, context)).toEqual([
      expect.objectContaining({ shapeId: "64", url: "https://example.test/owned" })
    ]);
  });
  it("serializes synchronous live shape and run assignments through one owned session", async () => {
    const bytes = await fixture(
      shape('r:id="rId99"'),
      `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId99" Type="${r}/hyperlink" Target="https://example.test/old" TargetMode="External"/>`
    );
    const session = await openLinkSession(bytes, context);
    const view = new LinkShape(session, { owner: "/ppt/slides/slide2.xml", id: "42" });
    const action = view.click_action;
    action.hyperlink.address = "../reference.html";
    expect(action.hyperlink.address).toBe("../reference.html");
    action.target_slide = session.slides[2]!;
    expect(action.target_slide).toBe(session.slides[2]);
    expect(action.hyperlink.address).toBe("slide3.xml");
    expect(action.action).toBe(PP_ACTION.NAMED_SLIDE);
    const saved = await session.save();
    expect(await listLinks(saved, {}, context)).toEqual([
      expect.objectContaining({ kind: "slide", targetSlide: 3 })
    ]);
    action.target_slide = null;
    expect(await listLinks(await session.save(), {}, context)).toEqual([]);
    expect(() => view.run([999]).hyperlink.address).toThrow(
      expect.objectContaining({ code: "invalid-selection" })
    );
  });
  it("rejects group click actions on access without excluding the shape owner", async () => {
    const bytes = await fixture(
      `<p:grpSp xmlns:p="${p}"><p:nvGrpSpPr><p:cNvPr id="51" name="Container"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:grpSp>`
    );
    const session = await openLinkSession(bytes, context);
    const view = new LinkShape(session, { owner: "/ppt/slides/slide2.xml", id: "51" });
    expect(() => view.click_action).toThrow(expect.objectContaining({ code: "invalid-value" }));
  });
  it.each(["firstslide", "lastslide", "nextslide", "previousslide", "endshow", "lastslideviewed"])(
    "recognizes %s navigation without activating it",
    async (jump) => {
      const bytes = await fixture(shape(`action="ppaction://hlinkshowjump?jump=${jump}"`));
      const original = bytes.slice();
      const links = await listLinks(bytes, {}, context);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ kind: "navigation", requiresSanitization: false });
      expect(bytes).toEqual(original);
    }
  );

  it.each(["hlinkfile", "hlinkpres", "ole", "macro", "program", "media", "unrecognized"])(
    "retains %s as an inert action requiring explicit sanitization",
    async (action) => {
      const bytes = await fixture(shape(`action="ppaction://${action}"`));
      const original = bytes.slice();
      expect(await listLinks(bytes, {}, context)).toEqual([
        expect.objectContaining({
          action: `ppaction://${action}`,
          kind: "unsupported",
          requiresSanitization: true
        })
      ]);
      expect(bytes).toEqual(original);
    }
  );

  it("preserves custom-show identity and return attributes", async () => {
    const bytes = await fixture(shape('action="ppaction://customshow?id=7&amp;return=true"'));
    expect(await listLinks(bytes, {}, context)).toEqual([
      expect.objectContaining({
        action: "ppaction://customshow?id=7&return=true",
        kind: "custom-show"
      })
    ]);
  });

  it.each(["../resources/guide.html", "https://example.test/guide?q=one%20two#detail"])(
    "reads the exact external target %s without resolving or fetching it",
    async (url) => {
      const bytes = await fixture(
        shape('r:id="rId99"'),
        `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId99" Type="${r}/hyperlink" Target="${url}" TargetMode="External"/>`
      );
      expect(await listLinks(bytes, {}, context)).toEqual([
        expect.objectContaining({ url, kind: "url", relationshipId: "rId99" })
      ]);
    }
  );

  it("reads hover and table-cell run links without manufacturing a click action", async () => {
    const markup = `<p:graphicFrame xmlns:p="${p}" xmlns:a="${a}" xmlns:r="${r}"><p:nvGraphicFramePr><p:cNvPr id="43" name="Reference grid"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr h="1"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr><a:hlinkMouseOver r:id="rId99"/></a:rPr><a:t>Guide</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const bytes = await fixture(
      markup,
      `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="rId99" Type="${r}/hyperlink" Target="https://example.test/reference" TargetMode="External"/>`
    );
    const links = await listLinks(bytes, {}, context);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      trigger: "hover",
      url: "https://example.test/reference",
      shapeId: "43"
    });
    const session = await openLinkSession(bytes, context);
    const view = new LinkShape(session, { owner: "/ppt/slides/slide2.xml", id: "43" });
    const run = view.run(links[0]!.path.slice(0, -1));
    run.hyperlink.address = "../table-guide.html";
    expect(run.hyperlink.address).toBe("../table-guide.html");
    const savedLinks = await listLinks(await session.save(), {}, context);
    expect(savedLinks).toHaveLength(2);
    expect(savedLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ trigger: "hover", url: "https://example.test/reference" }),
        expect.objectContaining({ trigger: "click", url: "../table-guide.html" })
      ])
    );
    run.hyperlink.address = null;
    expect(await listLinks(await session.save(), {}, context)).toEqual([
      expect.objectContaining({ trigger: "hover", url: "https://example.test/reference" })
    ]);
    const hover = new Hyperlink(view.owner(links[0]!.path.slice(0, -1), "hover"));
    hover.address = "https://example.test/new-hover";
    const hoverBytes = await session.save();
    const xmlBytes = inspectZip(hoverBytes).find(
      (entry) => entry.name === "ppt/slides/slide2.xml"
    )!.payload;
    const names: string[] = [];
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
      if (tag.uri === a && tag.local.startsWith("hlink")) names.push(tag.local);
    });
    parser.write(new TextDecoder().decode(xmlBytes)).close();
    expect(names).toEqual(["hlinkMouseOver"]);
    expect(hover.address).toBe("https://example.test/new-hover");
  });
});
