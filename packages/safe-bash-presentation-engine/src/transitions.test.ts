import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { createPresentation } from "./creation.js";
import { inspectZip } from "../tests/zip-reader.js";
import { writePackageArchive } from "./package-writer.js";
import { parseXmlPart } from "./xml.js";
import { mutateTransitions, readTransitions } from "./transitions.js";
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
const selection = {
  kind: "slide" as const,
  position: { coordinateSystem: "one-based" as const, value: 1 }
};
const p = "http://schemas.openxmlformats.org/presentationml/2006/main";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, delay?: number) =>
    delay === 0 ? setImmediate(cb) : timer(cb, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
function entries(bytes: Uint8Array): Map<string, Uint8Array> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((e) => [
      e.name,
      e.payload
    ])
  );
}
function slide(bytes: Uint8Array, number = 1) {
  return new TextDecoder().decode(entries(bytes).get(`ppt/slides/slide${number}.xml`));
}
function nodes(xml: string, local: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === local)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((a) => [a.local, a.value])));
  });
  parser.write(xml).close();
  return result;
}
async function fixture(markup: string | readonly string[]) {
  const source = await createPresentation({ slides: [{}, {}] }, context),
    map = entries(source);
  const doc = parseXmlPart(map.get("ppt/slides/slide1.xml")!, context.xmlLimits);
  map.set(
    "ppt/slides/slide1.xml",
    doc
      .spliceChildren(
        doc.root,
        doc.root.children.length,
        0,
        typeof markup === "string" ? [markup] : markup
      )
      .bytes()
  );
  return writePackageArchive(
    [...map].map(([name, bytes]) => ({ name, bytes })),
    context,
    { compression: "store" }
  );
}
describe("slide transitions", () => {
  it.each([
    ["cut", undefined, 0],
    ["fade", undefined, 500],
    ["push", "left", 500],
    ["push", "right", 500],
    ["push", "up", 500],
    ["push", "down", 500],
    ["wipe", "left", 500],
    ["wipe", "right", 500],
    ["wipe", "up", 500],
    ["wipe", "down", 500]
  ] as const)(
    "authors %s %s with exact millisecond defaults",
    async (kind, direction, duration) => {
      const input = await createPresentation({ slides: [{}, {}] }, context);
      const result = await mutateTransitions(
        input,
        "add",
        { selection, kind, ...(direction ? { direction } : {}) },
        context
      );
      expect(nodes(slide(result.bytes), "transition")[0]).toMatchObject({
        dur: String(duration),
        advClick: "1"
      });
      expect(nodes(slide(result.bytes), kind)).toHaveLength(1);
      expect((await readTransitions(result.bytes, { selection }, context))[0]).toMatchObject({
        kind,
        direction: direction ?? null,
        duration,
        advanceAfter: null,
        advanceOnClick: true
      });
      expect(slide(result.bytes, 2)).toBe(slide(input, 2));
    }
  );
  it.each([0, 1, 700, 2147483647])(
    "keeps duration and automatic advance %s in milliseconds",
    async (value) => {
      const input = await createPresentation({ slides: [{}] }, context);
      const first = await mutateTransitions(
        input,
        "set",
        { selection, kind: "fade", duration: value, advanceAfter: value, advanceOnClick: false },
        context
      );
      expect(nodes(slide(first.bytes), "transition")[0]).toMatchObject({
        dur: String(value),
        advTm: String(value),
        advClick: "0"
      });
      const cleared = await mutateTransitions(
        first.bytes,
        "set",
        { selection, advanceAfter: null, advanceOnClick: true },
        context
      );
      expect(nodes(slide(cleared.bytes), "transition")[0]).not.toHaveProperty("advTm");
      expect((await readTransitions(cleared.bytes, { selection }, context))[0]?.duration).toBe(
        value
      );
    }
  );
  it.each([
    { kind: "push" },
    { kind: "wipe" },
    { kind: "fade", direction: "up" },
    { kind: "cut", duration: 1 },
    { kind: "cut", direction: "down" },
    { kind: "fade", duration: -1 },
    { kind: "fade", duration: 1.5 },
    { kind: "fade", advanceAfter: 2147483648 },
    { kind: "fade", advanceOnClick: "false" },
    { kind: "fade", direction: "diagonal" }
  ])("rejects conflicting or invalid settings %j", async (options) => {
    await expect(
      mutateTransitions(new Uint8Array(), "add", { selection, ...options } as never, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("rejects duplicate add and missing kind while removing only selected transition", async () => {
    const input = await fixture([
      `<p:transition xmlns:p="${p}" advTm="0"><p:fade/></p:transition>`,
      `<p:timing xmlns:p="${p}"/>`,
      `<p:extLst xmlns:p="${p}"/>`
    ]);
    await expect(
      mutateTransitions(input, "add", { selection, kind: "cut" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    const result = await mutateTransitions(input, "remove", { selection }, context);
    expect(nodes(slide(result.bytes), "transition")).toHaveLength(0);
    expect(nodes(slide(result.bytes), "timing")).toHaveLength(1);
    expect(nodes(slide(result.bytes), "extLst")).toHaveLength(1);
    await expect(
      mutateTransitions(result.bytes, "set", { selection, duration: 10 }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it.each([
    `<p:wheel spokes="5"/>`,
    `<p:fade/><p:extLst><p:ext uri="urn:motion"><m:morph xmlns:m="http://schemas.microsoft.com/office/powerpoint/2015/09/main"/></p:ext></p:extLst>`,
    `<p:fade thruBlk="1"/>`
  ])("preserves unsupported transition payload %s", async (payload) => {
    const input = await fixture(`<p:transition xmlns:p="${p}">${payload}</p:transition>`);
    expect((await readTransitions(input, { selection }, context))[0]?.kind).toBe("unsupported");
    for (const action of ["set", "remove"] as const)
      await expect(
        mutateTransitions(
          input,
          action,
          { selection, ...(action === "set" ? { kind: "fade" as const } : {}) },
          context
        )
      ).rejects.toMatchObject({ code: "unsupported-edit" });
    const result = await mutateTransitions(
      input,
      "add",
      {
        selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } },
        kind: "fade"
      },
      context
    );
    expect(slide(result.bytes)).toBe(slide(input));
  });
  it("keeps sound relationships and opaque siblings when editing or removing the selected transition", async () => {
    const input = await fixture(
      `<p:transition xmlns:p="${p}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:fade/><p:sndAc><p:stSnd loop="1"><p:snd r:embed="rIdSound" name="Chime"/></p:stSnd></p:sndAc></p:transition>`
    );
    const map = entries(input),
      rel = "ppt/slides/_rels/slide1.xml.rels";
    const relDoc = parseXmlPart(map.get(rel)!, context.xmlLimits);
    map.set(
      rel,
      relDoc
        .spliceChildren(relDoc.root, relDoc.root.children.length, 0, [
          `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="rIdSound" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio" Target="../media/chime.wav"/>`
        ])
        .bytes()
    );
    map.set("ppt/media/chime.wav", new Uint8Array([82, 73, 70, 70]));
    const types = parseXmlPart(map.get("[Content_Types].xml")!, context.xmlLimits);
    map.set(
      "[Content_Types].xml",
      types
        .spliceChildren(types.root, types.root.children.length, 0, [
          `<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/media/chime.wav" ContentType="audio/wav"/>`
        ])
        .bytes()
    );
    const source = await writePackageArchive(
      [...map].map(([name, bytes]) => ({ name, bytes })),
      context,
      { compression: "store" }
    );
    const set = await mutateTransitions(
      source,
      "set",
      { selection, kind: "push", direction: "right", duration: 1200 },
      context
    );
    expect(nodes(slide(set.bytes), "snd")).toEqual([{ embed: "rIdSound", name: "Chime" }]);
    expect(entries(set.bytes).get(rel)).toEqual(map.get(rel));
    const removed = await mutateTransitions(set.bytes, "remove", { selection }, context);
    expect(nodes(slide(removed.bytes), "sndAc")).toHaveLength(0);
    expect(entries(removed.bytes).get(rel)).toEqual(map.get(rel));
    expect(entries(removed.bytes).get("ppt/media/chime.wav")).toEqual(
      map.get("ppt/media/chime.wav")
    );
  });
  it("recognizes wrapped effects as preserve-only without inserting a competing transition", async () => {
    const source = await fixture(
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:p="${p}" xmlns:v="http://schemas.microsoft.com/office/powerpoint/2010/main"><mc:Choice Requires="v"><p:transition v:dur="700"><p:fade/></p:transition></mc:Choice><mc:Fallback><p:transition><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`
    );
    expect((await readTransitions(source, { selection }, context))[0]?.kind).toBe("unsupported");
    await expect(
      mutateTransitions(source, "set", { selection, kind: "cut" }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("retains custom duration namespace aliases and writes namespaced milliseconds in both dialects", async () => {
    for (const dialect of ["strict", "transitional"] as const) {
      let input = await createPresentation({ slides: [{}] }, context);
      if (dialect === "strict") {
        const map = entries(input);
        input = await writePackageArchive(
          [...map].map(([name, bytes]) => ({
            name,
            bytes: new TextEncoder().encode(
              new TextDecoder()
                .decode(bytes)
                .split("http://schemas.openxmlformats.org/presentationml/2006/main")
                .join("http://purl.oclc.org/ooxml/presentationml/main")
                .split("http://schemas.openxmlformats.org/drawingml/2006/main")
                .join("http://purl.oclc.org/ooxml/drawingml/main")
                .split("http://schemas.openxmlformats.org/officeDocument/2006/relationships")
                .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
            )
          })),
          context,
          { compression: "store" }
        );
      }
      const result = await mutateTransitions(
        input,
        "add",
        { selection, kind: "fade", duration: 731 },
        context
      );
      const parser = new SaxesParser({ xmlns: true });
      let duration: unknown;
      let ignorable: unknown;
      parser.on("opentag", (tag) => {
        if (tag.local !== "transition") return;
        const a = Object.values(tag.attributes).find((a) => a.local === "dur");
        duration = [a?.uri, a?.value];
        ignorable = Object.values(tag.attributes)
          .find((x) => x.local === "Ignorable")
          ?.value.split(" ")
          .includes(a!.prefix);
      });
      parser.write(slide(result.bytes)).close();
      expect(duration).toEqual(["http://schemas.microsoft.com/office/powerpoint/2010/main", "731"]);
      expect(ignorable).toBe(true);
    }
    const input = await fixture(
      `<p:transition xmlns:p="${p}" xmlns:custom="http://schemas.microsoft.com/office/powerpoint/2010/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="custom" custom:dur="720"><p:fade/></p:transition>`
    );
    const result = await mutateTransitions(input, "set", { selection, duration: 900 }, context);
    expect(slide(result.bytes)).toContain('custom:dur="900"');
  });
  it("reports absent exact duration without guessing from legacy speed and defaults side direction", async () => {
    const input = await fixture(`<p:transition xmlns:p="${p}" spd="slow"><p:push/></p:transition>`);
    expect((await readTransitions(input, { selection }, context))[0]).toMatchObject({
      kind: "push",
      direction: "left",
      duration: null,
      advanceOnClick: true,
      advanceAfter: null
    });
  });
  it("rejects empty updates and direction coercion before opening input", async () => {
    for (const options of [
      { selection },
      { selection, kind: "push", direction: { toString: () => "left" } }
    ]) {
      await expect(
        mutateTransitions(new Uint8Array(), "set", options as never, context)
      ).rejects.toMatchObject({ code: "invalid-value" });
    }
  });
  it.each(["NaN", "-1", "0.5", "2147483648", "1e3", "0x10"])(
    "rejects malformed imported time %s",
    async (value) => {
      const source = await fixture(
        `<p:transition xmlns:p="${p}" advTm="${value}"><p:fade/></p:transition>`
      );
      await expect(readTransitions(source, { selection }, context)).rejects.toMatchObject({
        code: "invalid-xml"
      });
    }
  );
  it("does not accumulate compatibility tokens across duration edits", async () => {
    const source = await fixture(
      `<p:transition xmlns:p="${p}" xmlns:custom="http://schemas.microsoft.com/office/powerpoint/2010/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="custom" custom:dur="720"><p:fade/></p:transition>`
    );
    const one = await mutateTransitions(source, "set", { selection, duration: 800 }, context);
    const two = await mutateTransitions(one.bytes, "set", { selection, duration: 900 }, context);
    expect(nodes(slide(two.bytes), "transition")[0]?.Ignorable).toBe("custom");
  });
  it("rejects explicit directional kinds without direction even when the existing effect provides one", async () => {
    const source = await fixture(`<p:transition xmlns:p="${p}"><p:push dir="r"/></p:transition>`);
    await expect(
      mutateTransitions(source, "set", { selection, kind: "push" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  });
  it("rejects duplicate transition siblings", async () => {
    const source = await fixture([
      `<p:transition xmlns:p="${p}"><p:fade/></p:transition>`,
      `<p:transition xmlns:p="${p}"><p:cut/></p:transition>`
    ]);
    await expect(readTransitions(source, { selection }, context)).rejects.toMatchObject({
      code: "invalid-xml"
    });
  });
  it("preserves extension attributes on an otherwise simple effect", async () => {
    const source = await fixture(
      `<p:transition xmlns:p="${p}" xmlns:x="urn:motion:extension" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" x:mode="morph"><p:fade/></p:transition>`
    );
    expect((await readTransitions(source, { selection }, context))[0]?.kind).toBe("unsupported");
    await expect(mutateTransitions(source, "remove", { selection }, context)).rejects.toMatchObject(
      { code: "unsupported-edit" }
    );
  });
  it("requires allowEmpty for absent removal and counts only existing transitions", async () => {
    const empty = await createPresentation({ slides: [{}, {}] }, context);
    await expect(
      mutateTransitions(empty, "remove", { selection }, context).then(() => "accepted")
    ).rejects.toMatchObject({ code: "missing-selection" });
    expect(
      (await mutateTransitions(empty, "remove", { selection, allowEmpty: true }, context))
        .affectedSlides
    ).toEqual([]);
    const one = await mutateTransitions(empty, "add", { selection, kind: "fade" }, context);
    expect(
      (
        await mutateTransitions(
          one.bytes,
          "remove",
          { selection: { kind: "slide", all: true } },
          context
        )
      ).affectedSlides
    ).toEqual([1]);
  });
  it("retains a motion extension effect in direct and compatibility branches", async () => {
    const effect = `<m:morph xmlns:m="http://schemas.microsoft.com/office/powerpoint/2015/09/main" option="byObject"/>`;
    for (const markup of [
      `<p:transition xmlns:p="${p}" xmlns:m="http://schemas.microsoft.com/office/powerpoint/2015/09/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="m">${effect}</p:transition>`,
      `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:m="http://schemas.microsoft.com/office/powerpoint/2015/09/main" xmlns:p="${p}"><mc:Choice Requires="m"><p:transition>${effect}</p:transition></mc:Choice><mc:Fallback><p:transition><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`
    ]) {
      const input = await fixture(markup);
      expect((await readTransitions(input, { selection }, context))[0]?.kind).toBe("unsupported");
      await expect(
        mutateTransitions(input, "remove", { selection }, context).then(() => "accepted")
      ).rejects.toMatchObject({ code: "unsupported-edit" });
      const result = await mutateTransitions(
        input,
        "add",
        {
          selection: { kind: "slide", position: { coordinateSystem: "one-based", value: 2 } },
          kind: "cut"
        },
        context
      );
      expect(slide(result.bytes)).toBe(slide(input));
    }
  });
  it("requires a single owner for add even with explicit all", async () => {
    const input = await createPresentation({ slides: [{}, {}] }, context);
    await expect(
      mutateTransitions(
        input,
        "add",
        { selection: { kind: "slide", all: true }, kind: "fade" },
        context
      ).then(() => "accepted")
    ).rejects.toMatchObject({ code: "ambiguous-selection" });
  });
});
