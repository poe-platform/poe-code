import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { createPresentation } from "./creation.js";
import { readTags, mutateTags } from "./tags.js";
import { readPackage } from "./package-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { SaxesParser } from "saxes";
import { validatePresentation } from "./validation.js";
beforeAll(() => { const timer = globalThis.setTimeout; vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay?: number) => delay === 0 ? setImmediate(fn) : timer(fn, delay)) as typeof setTimeout); });
afterAll(() => vi.restoreAllMocks());

export const context = {
  limits: { maxBytes: 262144, maxReads: 1000, chunkBytes: 4096 },
  archiveLimits: { maxArchiveBytes: 262144, maxEntryBytes: 65536, maxTotalBytes: 262144, maxMembers: 64, maxPathBytes: 256, maxDepth: 16, maxPaxBytes: 1024, maxTextBytes: 65536, chunkSize: 4096 },
  xmlLimits: { maxBytes: 65536, maxNodes: 4000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 65536, maxParts: 64, maxRelationships: 64 }
};
describe("presentation and slide tags", () => {
  it("creates empty and Unicode tags with deterministic packages and isolated owners", async () => {
    const original = await createPresentation({ slides: [{ name: "Garden" }] }, context);
    const options = { scope: "presentation" as const, name: "Season", value: "" };
    const first = await mutateTags(original, "add", options, context);
    expect((await mutateTags(original, "add", options, context)).bytes).toEqual(first.bytes);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/deck", first.bytes);
    const second = await mutateTags(new Uint8Array(volume.readFileSync("/deck") as Buffer), "add", { selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } }, name: "季節", value: "春 & <芽>" }, context);
    expect(await readTags(second.bytes, { scope: "presentation" }, context)).toMatchObject([{ name: "Season", value: "", slide: null }]);
    const slides = await readTags(second.bytes, {}, context);
    expect(slides).toMatchObject([{ name: "季節", value: "春 & <芽>", slide: 1 }]);
    const updated = await mutateTags(second.bytes, "set", { selection: { token: slides[0]!.selector }, value: "" }, context);
    expect(await readTags(updated.bytes, {}, context)).toMatchObject([{ name: "季節", value: "" }]);
    await expect(mutateTags(updated.bytes, "remove", { selection: { token: slides[0]!.selector } }, context)).rejects.toMatchObject({ code: "stale-selection" });
    const removed = await mutateTags(updated.bytes, "remove", { selection: { all: true } }, context);
    expect(await readTags(removed.bytes, {}, context)).toEqual([]);
    expect((await readPackage(removed.bytes, context)).names).toContain("/ppt/tags/tag1.xml");
  });
  it("rejects duplicate names, ambiguous edits and invalid XML input", async () => {
    const original = await createPresentation({}, context);
    const a = await mutateTags(original, "add", { scope: "presentation", name: "Key", value: "one" }, context);
    await expect(mutateTags(a.bytes, "add", { scope: "presentation", name: "Key", value: "two" }, context)).rejects.toMatchObject({ code: "invalid-value" });
    const b = await mutateTags(a.bytes, "add", { scope: "presentation", name: "Other", value: "two" }, context);
    const present = await readTags(b.bytes, { scope: "presentation" }, context);
    await expect(mutateTags(b.bytes, "set", { selection: { token: present[1]!.selector }, name: "Key" }, context)).rejects.toMatchObject({ code: "invalid-value" });
    await expect(readTags(b.bytes, { scope: "slides", selection: { token: present[1]!.selector } }, context)).rejects.toMatchObject({ code: "invalid-selection" });
    await expect(mutateTags(b.bytes, "set", { scope: "presentation", value: "three" }, context)).rejects.toMatchObject({ code: "ambiguous-selection" });
    await expect(mutateTags(a.bytes, "set", { scope: "presentation", value: "\u0000" }, context)).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("preserves foreign tag content and custom XML associations in both dialects", async () => {
    for (const dialect of ["strict", "transitional"] as const) {
      const p = dialect === "strict" ? "http://purl.oclc.org/ooxml/presentationml/main" : "http://schemas.openxmlformats.org/presentationml/2006/main";
      const r = dialect === "strict" ? "http://purl.oclc.org/ooxml/officeDocument/relationships" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
      const initial = await createPresentation({ slides: [{}] }, context);
      const reader = await readPackage(initial, context);
      const files = new Map(reader.names.map(name => [name, reader.get(name)]));
      const decode = (name: string) => new TextDecoder().decode(files.get(name)!);
      const set = (name: string, value: string) => files.set(name, new TextEncoder().encode(value));
      if (dialect === "strict") for (const name of files.keys()) set(name, decode(name).split("http://schemas.openxmlformats.org/presentationml/2006/main").join(p).split("http://schemas.openxmlformats.org/officeDocument/2006/relationships").join(r).split("http://schemas.openxmlformats.org/drawingml/2006/main").join("http://purl.oclc.org/ooxml/drawingml/main"));
      set("/ppt/slides/slide1.xml", decode("/ppt/slides/slide1.xml").split("</p:cSld>").join(`<p:custDataLst><p:custData r:id="data"/><p:tags r:id="tags"/></p:custDataLst></p:cSld>`));
      set("/ppt/slides/_rels/slide1.xml.rels", decode("/ppt/slides/_rels/slide1.xml.rels").split("</Relationships>").join(`<Relationship Id="tags" Type="${r}/tags" Target="../tags/tag1.xml"/><Relationship Id="data" Type="${r}/customXml" Target="../../customXml/item1.xml"/></Relationships>`));
      set("/ppt/tags/tag1.xml", `<p:tagLst xmlns:p="${p}" xmlns:q="urn:garden:opaque"><p:tag name="Seed" val="old" q:mode="retain"><q:item/></p:tag><q:tag name="Seed" val="foreign"/></p:tagLst>`);
      set("/customXml/item1.xml", '<garden xmlns="urn:garden:data">original</garden>');
      set("/[Content_Types].xml", decode("/[Content_Types].xml").split("</Types>").join('<Override PartName="/customXml/item1.xml" ContentType="application/xml"/><Override PartName="/ppt/tags/tag1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tags+xml"/></Types>'));
      const source = await writePackageArchive([...files].map(([name, bytes]) => ({ name: name.slice(1), bytes })), context, { compression: "store" });
      const validation = validatePresentation(await readPackage(source, context), { ...context.xmlLimits, ...context.relationshipLimits, maxEntries: 64 });
      expect(validation.valid, JSON.stringify(validation)).toBe(true);
      const result = await mutateTags(source, "set", { selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } }, value: "new" }, context);
      const output = await readPackage(result.bytes, context);
      for (const name of ["/customXml/item1.xml", "/ppt/slides/slide1.xml", "/ppt/slides/_rels/slide1.xml.rels"]) expect(output.get(name)).toEqual(files.get(name));
      const observed: Array<{ uri: string; local: string; attributes: Record<string, string> }> = [];
      const parser = new SaxesParser({ xmlns: true });
      parser.on("opentag", node => observed.push({ uri: node.uri, local: node.local, attributes: Object.fromEntries(Object.values(node.attributes).map(a => [a.name, a.value])) }));
      parser.write(new TextDecoder().decode(output.get("/ppt/tags/tag1.xml"))).close();
      expect(observed).toContainEqual({ uri: p, local: "tag", attributes: { name: "Seed", val: "new", "q:mode": "retain" } });
      expect(observed).toContainEqual({ uri: "urn:garden:opaque", local: "tag", attributes: { name: "Seed", val: "foreign" } });
      await expect(mutateTags(result.bytes, "remove", { selection: { all: true } }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
      set("/ppt/presentation.xml", decode("/ppt/presentation.xml").split("</p:presentation>").join('<p:custDataLst><p:tags r:id="sharedTags"/></p:custDataLst></p:presentation>'));
      set("/ppt/_rels/presentation.xml.rels", decode("/ppt/_rels/presentation.xml.rels").split("</Relationships>").join(`<Relationship Id="sharedTags" Type="${r}/tags" Target="tags/tag1.xml"/></Relationships>`));
      const shared = await writePackageArchive([...files].map(([name, bytes]) => ({ name: name.slice(1), bytes })), context, { compression: "store" });
      await expect(mutateTags(shared, "set", { scope: "presentation", value: "private" }, context)).rejects.toMatchObject({ code: "unsupported-edit" });
    }
  });
});
