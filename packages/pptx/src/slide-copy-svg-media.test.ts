import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { SaxesParser } from "saxes";
import { createPresentation } from "./creation.js";
import { duplicateSlides } from "./slide-copy.js";
import { mutateSlides } from "./slides.js";
import { removeSlides } from "./slide-removal.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { inspectZip } from "../tests/zip-reader.js";
import { parseXmlPart } from "./xml.js";
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

const encode = new TextEncoder();
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const svg = encode.encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><metadata><record xmlns="urn:opaque:media" id="keep">  preserved  </record></metadata></svg>'
);
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void, ms?: number) =>
    ms === 0 ? queueMicrotask(cb) : timer(cb, ms)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
function parts(bytes: Uint8Array): Map<string, Uint8Array> {
  return new Map(inspectZip(bytes).map((entry) => [entry.name, entry.payload]));
}
function targets(bytes: Uint8Array) {
  const result: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", (tag) => {
    if (tag.local === "Relationship") {
      const attributes = Object.fromEntries(
        Object.values(tag.attributes).map((value) => [value.local, value.value])
      );
      if (attributes.Type === `${r}/image`) result.push(attributes.Target!);
    }
  });
  parser.write(new TextDecoder().decode(bytes)).close();
  return result;
}
async function fixture() {
  const entries = parts(
    await createPresentation({ slides: [{ name: "One" }, { name: "Two" }] }, context)
  );
  const append = (name: string, fragment: string) => {
    const document = parseXmlPart(entries.get(name)!, context.xmlLimits);
    entries.set(
      name,
      document.spliceChildren(document.root, document.root.children.length, 0, [fragment]).bytes()
    );
  };
  entries.set("ppt/media/record.svg", svg);
  append(
    "[Content_Types].xml",
    '<Override xmlns="http://schemas.openxmlformats.org/package/2006/content-types" PartName="/ppt/media/record.svg" ContentType="image/svg+xml"/>'
  );
  for (const number of [1, 2])
    append(
      `ppt/slides/_rels/slide${number}.xml.rels`,
      `<Relationship xmlns="http://schemas.openxmlformats.org/package/2006/relationships" Id="media" Type="${r}/image" Target="../media/record.svg"/>`
    );
  return storedArchive([...entries].map(([name, bytes]) => ({ name, bytes })));
}
it.each(["shared-media", "isolated-instance"] as const)(
  "preserves opaque SVG bytes and shared owners using %s",
  async (mediaPolicy) => {
    const input = await fixture();
    const options = { selection: { kind: "slide" as const, id: "256" }, position: 2, mediaPolicy };
    const output = await duplicateSlides(input, options, context);
    expect(await duplicateSlides(input, options, context)).toEqual(output);
    const result = parts(output);
    for (const [name, bytes] of parts(input)) {
      if (
        ![
          "[Content_Types].xml",
          "ppt/presentation.xml",
          "ppt/_rels/presentation.xml.rels"
        ].includes(name)
      )
        expect(result.get(name), name).toEqual(bytes);
    }
    expect(targets(result.get("ppt/slides/_rels/slide1-copy1.xml.rels")!)).toEqual([
      mediaPolicy === "isolated-instance" ? "../media/record-copy1.svg" : "../media/record.svg"
    ]);
    expect(result.get("ppt/media/record.svg")).toEqual(svg);
    if (mediaPolicy === "isolated-instance")
      expect(result.get("ppt/media/record-copy1.svg")).toEqual(svg);
    const removed = parts(
      await removeSlides(output, { selection: { kind: "slide", id: "258" } }, context)
    );
    expect(removed.has("ppt/slides/slide1-copy1.xml")).toBe(false);
    expect(removed.has("ppt/slides/_rels/slide1-copy1.xml.rels")).toBe(false);
    for (const number of [1, 2])
      expect(targets(removed.get(`ppt/slides/_rels/slide${number}.xml.rels`)!)).toEqual([
        "../media/record.svg"
      ]);
    expect(removed.get("ppt/media/record.svg")).toEqual(svg);
  }
);
it("publishes isolated opaque SVG media through the duplicate command", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.pptx", await fixture());
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 1000000
  });
  const result = await engine.execute({
    args: [
      "slides",
      "duplicate",
      "/input.pptx",
      "--slide",
      "1",
      "--position",
      "2",
      "--media-policy",
      "isolated-instance",
      "--output",
      "/output.pptx",
      "--json"
    ].map((value) => encode.encode(value)),
    signal: new AbortController().signal,
    readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
    publishOutput: async (request) => {
      volume.writeFileSync(request.outputPath, request.bytes);
    }
  });
  expect(result.exitCode, new TextDecoder().decode(result.stdout)).toBe(0);
  const output = parts(new Uint8Array(volume.readFileSync("/output.pptx") as Buffer));
  expect(output.get("ppt/media/record-copy1.svg")).toEqual(svg);
  expect(targets(output.get("ppt/slides/_rels/slide1-copy1.xml.rels")!)).toEqual([
    "../media/record-copy1.svg"
  ]);
});

it("keeps opaque media stable during no-op, rename and reorder", async () => {
  const input = await fixture();
  const selection = { kind: "slide" as const, id: "256" };
  expect(await mutateSlides(input, { selection, name: "One", position: 1 }, context)).toEqual(
    input
  );
  const renamed = parts(await mutateSlides(input, { selection, name: "Renamed" }, context));
  const reordered = parts(await mutateSlides(input, { selection, position: 2 }, context));
  for (const [name, bytes] of parts(input)) {
    if (name !== "ppt/slides/slide1.xml") expect(renamed.get(name), name).toEqual(bytes);
    if (name !== "ppt/presentation.xml") expect(reordered.get(name), name).toEqual(bytes);
  }
});
it("rejects opaque SVG media with outbound relationships before copying", async () => {
  const entries = parts(await fixture());
  entries.set(
    "ppt/media/_rels/record.svg.rels",
    encode.encode(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="self" Type="${r}/image" Target="record.svg"/></Relationships>`
    )
  );
  const input = storedArchive([...entries].map(([name, bytes]) => ({ name, bytes })));
  await expect(
    duplicateSlides(
      input,
      { selection: { kind: "slide", id: "256" }, position: 2, mediaPolicy: "isolated-instance" },
      context
    )
  ).rejects.toMatchObject({ code: "unsupported-edit" });
});
