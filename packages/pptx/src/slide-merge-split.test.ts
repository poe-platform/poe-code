import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPresentation, mergeSlides, splitSlides } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
import { SlideTransferBudget } from "./slide-transfer-budget.js";
import { storedArchive } from "../tests/fixtures/archive.js";

const context = {
  limits: { maxBytes: 10000000, maxReads: 10000, chunkBytes: 4096 },
  archiveLimits: {
    maxArchiveBytes: 10000000,
    maxEntryBytes: 1000000,
    maxTotalBytes: 10000000,
    maxMembers: 1000,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 1000000,
    chunkSize: 4096
  },
  xmlLimits: { maxBytes: 1000000, maxNodes: 100000, maxDepth: 40 },
  relationshipLimits: { maxBytes: 1000000, maxParts: 1000, maxRelationships: 2000 }
};
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
async function deck(...names: string[]) {
  return createPresentation({ slides: names.map((name) => ({ name })) }, context);
}
function parts(bytes: Uint8Array) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/deck", bytes);
  return new Map(
    inspectZip(new Uint8Array(volume.readFileSync("/deck") as Buffer)).map((part) => [
      part.name,
      part.payload
    ])
  );
}
function attributes(bytes: Uint8Array, name: string) {
  const result: Record<string, string>[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === name)
      result.push(Object.fromEntries(Object.values(tag.attributes).map((a) => [a.name, a.value])));
  });
  parser.write(decoder.decode(bytes)).close();
  return result;
}
function names(bytes: Uint8Array) {
  const map = parts(bytes);
  const rels = attributes(map.get("ppt/_rels/presentation.xml.rels")!, "Relationship");
  return attributes(map.get("ppt/presentation.xml")!, "sldId").map((slide) => {
    const target = rels.find((rel) => rel.Id === slide["r:id"])!.Target!;
    return attributes(map.get(`ppt/${target}`)!, "cSld")[0]!.name;
  });
}
function linked(bytes: Uint8Array, target: string) {
  const map = parts(bytes);
  const name = "ppt/slides/_rels/slide1.xml.rels";
  const old = decoder.decode(map.get(name));
  const close = old.lastIndexOf("</");
  map.set(
    name,
    encoder.encode(
      old.slice(0, close) +
        `<Relationship Id="jump" Type="${r}/slide" Target="${target}"/>` +
        old.slice(close)
    )
  );
  return storedArchive([...map].map(([name, bytes]) => ({ name, bytes })));
}

describe("ordered slide merge and split", () => {
  beforeAll(() => {
    const timer = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) =>
      delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  });
  afterAll(() => vi.restoreAllMocks());
  it("appends selected source positions in deck and selection order deterministically", async () => {
    const destination = await deck("Base"),
      first = await deck("Oak", "Elm"),
      second = await deck("Sun", "Moon");
    const options = { sourceSlides: [2, 1], themePolicy: "source" as const };
    const result = await mergeSlides(destination, [first, second], options, context);
    expect(names(result)).toEqual(["Base", "Elm", "Oak", "Moon", "Sun"]);
    expect(await mergeSlides(destination, [first, second], options, context)).toEqual(result);
    const map = parts(result);
    expect([...map.keys()].filter((name) => name.startsWith("ppt/theme/")).length).toBe(3);
    expect(
      [...map.keys()].filter(
        (name) => name.startsWith("ppt/slideLayouts/") && name.endsWith(".xml")
      ).length
    ).toBe(3);
  });
  it("defaults to every source slide and resolves navigation within a selected source", async () => {
    const source = linked(await deck("North", "South"), "slide2.xml");
    const result = await mergeSlides(await deck(), [source], { themePolicy: "source" }, context);
    expect(names(result)).toEqual(["North", "South"]);
    expect(
      attributes(
        parts(result).get("ppt/slides/_rels/slide1-import1.xml.rels")!,
        "Relationship"
      ).find((edge) => edge.Type === `${r}/slide`)!.Target
    ).toBe("slide2-import1.xml");
  });
  it("splits selected positions into independent packages in emitted order", async () => {
    const input = await deck("North", "Center", "South");
    const outputs = await splitSlides(input, { slides: [3, 1] }, context);
    expect(outputs.map((output) => [output.name, output.sourceSlide])).toEqual([
      ["slide-000001.pptx", 3],
      ["slide-000002.pptx", 1]
    ]);
    expect(outputs.map((output) => names(output.bytes))).toEqual([["South"], ["North"]]);
    for (const output of outputs) {
      const map = parts(output.bytes);
      expect(
        [...map.keys()].filter((name) => name.startsWith("ppt/slides/") && name.endsWith(".xml"))
      ).toHaveLength(1);
      expect(
        [...map.keys()].some((name) => name.startsWith("ppt/theme/") && name.endsWith(".xml"))
      ).toBe(true);
    }
    expect(await splitSlides(input, { slides: [3, 1] }, context)).toEqual(outputs);
  });
  it("keeps self navigation but rejects navigation crossing separate split outputs", async () => {
    const self = await splitSlides(
      linked(await deck("Loop"), "slide1.xml"),
      { slides: [1] },
      context
    );
    expect(names(self[0]!.bytes)).toEqual(["Loop"]);
    await expect(
      splitSlides(linked(await deck("Start", "End"), "slide2.xml"), { slides: [1, 2] }, context)
    ).rejects.toMatchObject({ code: "unsupported-edit" });
  });
  it("rejects a missing referenced slide before emitting a result", async () => {
    const source = linked(await deck("Start"), "missing.xml");
    await expect(
      mergeSlides(await deck(), [source], { themePolicy: "source" }, context)
    ).rejects.toMatchObject({ code: "invalid-opc" });
    await expect(splitSlides(source, { slides: [1] }, context)).rejects.toMatchObject({
      code: "invalid-opc"
    });
  });
  it("charges combined input bytes rather than resetting for each source", async () => {
    const input = await deck("Small");
    await expect(
      mergeSlides(
        input,
        [input, input],
        { themePolicy: "source" },
        {
          ...context,
          limits: { ...context.limits, maxBytes: input.length * 2 }
        }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("charges combined graph, expanded data and XML work", async () => {
    const input = await deck("Small");
    for (const limited of [
      { ...context, relationshipLimits: { ...context.relationshipLimits, maxParts: 15 } },
      { ...context, archiveLimits: { ...context.archiveLimits, maxTotalBytes: 15000 } },
      { ...context, xmlLimits: { ...context.xmlLimits, maxNodes: 200 } }
    ])
      await expect(
        mergeSlides(input, [input, input], { themePolicy: "source" }, limited)
      ).rejects.toMatchObject({ code: "resource-limit" });
  });
  it.each([[], [0], [1, 1], [3], new Array<number>(1)].map((slides) => ({ slides })))(
    "rejects invalid split selection %j",
    async ({ slides }) => {
      await expect(
        splitSlides(await deck("One", "Two"), { slides }, context)
      ).rejects.toBeDefined();
    }
  );
  it("keeps cumulative read exhaustion typed across independent input streams", async () => {
    const input = await deck("Stream");
    const stream = () => {
      let sent = false;
      return {
        read: async () => {
          if (sent) return null;
          sent = true;
          return input;
        }
      };
    };
    await expect(
      mergeSlides(
        stream(),
        [stream()],
        { themePolicy: "source" },
        {
          ...context,
          limits: { ...context.limits, chunkBytes: input.length, maxReads: 3 }
        }
      )
    ).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("validates destination content and rejects empty source selections", async () => {
    await expect(
      mergeSlides(new Uint8Array([1]), [await deck()], { themePolicy: "source" }, context)
    ).rejects.toMatchObject({ code: "invalid-archive" });
    await expect(
      mergeSlides(await deck("Base"), [await deck()], { themePolicy: "source" }, context)
    ).rejects.toMatchObject({ code: "missing-selection" });
  });
  it("reports missing positions as selection failures", async () => {
    await expect(splitSlides(await deck("One"), { slides: [2] }, context)).rejects.toMatchObject({
      code: "missing-selection",
      phase: "select"
    });
    await expect(
      mergeSlides(
        await deck(),
        [await deck("One")],
        { sourceSlides: [2], themePolicy: "source" },
        context
      )
    ).rejects.toMatchObject({ code: "missing-selection", phase: "select" });
  });
  it("snapshots caller selections, source order and limits before input awaits", async () => {
    const base = await deck("Base"),
      first = await deck("Oak", "Elm"),
      second = await deck("Sun", "Moon");
    const sources = [first, second];
    const options = { sourceSlides: [2], themePolicy: "source" as const };
    const mutableContext = { ...context, xmlLimits: { ...context.xmlLimits } };
    let offset = 0;
    const destination = {
      read: async (maxBytes: number) => {
        sources.reverse();
        options.sourceSlides[0] = 99;
        mutableContext.xmlLimits.maxNodes = 1;
        if (offset === base.length) return null;
        const chunk = base.slice(offset, offset + maxBytes);
        offset += chunk.length;
        return chunk;
      }
    };
    expect(names(await mergeSlides(destination, sources, options, mutableContext))).toEqual([
      "Base",
      "Elm",
      "Moon"
    ]);
  });
  it("normalizes explicit capability failures and cancellation", async () => {
    const denied = {
      path: "/deck",
      capability: {
        openRead: async () => {
          throw new Error("private details");
        }
      }
    };
    await expect(splitSlides(denied, { slides: [1] }, context)).rejects.toMatchObject({
      code: "io-failure",
      message: "Byte input failed."
    });
    await expect(
      splitSlides({ path: "/deck" } as Parameters<typeof splitSlides>[0], { slides: [1] }, context)
    ).rejects.toMatchObject({ code: "invalid-type" });
    const controller = new AbortController();
    const cancelled = {
      path: "/deck",
      capability: {
        openRead: async () => {
          controller.abort();
          throw new Error("private details");
        }
      }
    };
    await expect(
      splitSlides(cancelled, { slides: [1] }, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ code: "cancelled" });
  });
  it("charges directory records toward combined archive member admission", async () => {
    const map = parts(await deck("One"));
    const bytes = storedArchive([
      ...Array.from({ length: 8 }, (_, index) => ({
        name: `empty${index}/`,
        bytes: new Uint8Array(),
        mode: 0o40755
      })),
      ...[...map].map(([name, bytes]) => ({ name, bytes }))
    ]);
    const budget = new SlideTransferBudget({
      ...context,
      archiveLimits: { ...context.archiveLimits, maxMembers: map.size * 2 + 8 }
    });
    await budget.open(bytes);
    await expect(budget.open(bytes)).rejects.toMatchObject({ code: "resource-limit" });
  });
  it("keeps the source dialect and normalizes a split output to presentation kind", async () => {
    const fixture = parts(
      await createPresentation({ kind: "ppsx", slides: [{ name: "Night" }] }, context)
    );
    for (const [name, bytes] of fixture) {
      if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
      let text = decoder.decode(bytes);
      for (const [from, to] of [
        [
          "http://schemas.openxmlformats.org/presentationml/2006/main",
          "http://purl.oclc.org/ooxml/presentationml/main"
        ],
        [
          "http://schemas.openxmlformats.org/drawingml/2006/main",
          "http://purl.oclc.org/ooxml/drawingml/main"
        ],
        [r, "http://purl.oclc.org/ooxml/officeDocument/relationships"]
      ])
        text = text.split(from!).join(to!);
      fixture.set(name, encoder.encode(text));
    }
    const input = storedArchive([...fixture].map(([name, bytes]) => ({ name, bytes })));
    const output = (await splitSlides(input, { slides: [1] }, context))[0]!;
    const map = parts(output.bytes);
    expect(decoder.decode(map.get("ppt/presentation.xml"))).toContain(
      "http://purl.oclc.org/ooxml/presentationml/main"
    );
    expect(
      attributes(map.get("[Content_Types].xml")!, "Override").find(
        (node) => node.PartName === "/ppt/presentation.xml"
      )!.ContentType
    ).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
    expect(names(output.bytes)).toEqual(["Night"]);
  });
  it("rejects sparse sources before invoking any input capability", async () => {
    const read = vi.fn();
    await expect(
      mergeSlides({ read }, new Array<Uint8Array>(1), { themePolicy: "source" }, context)
    ).rejects.toMatchObject({ code: "invalid-type", phase: "usage" });
    expect(read).not.toHaveBeenCalled();
  });
  it("requires explicit merge policies and nonempty sources before reading input", async () => {
    const read = vi.fn();
    await expect(
      mergeSlides({ read }, [], { themePolicy: "source" }, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    await expect(
      mergeSlides({ read }, [{ read }], {} as Parameters<typeof mergeSlides>[2], context)
    ).rejects.toMatchObject({ code: "invalid-value" });
    expect(read).not.toHaveBeenCalled();
  });
});
