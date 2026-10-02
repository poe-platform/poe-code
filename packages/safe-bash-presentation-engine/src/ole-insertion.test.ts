import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { PROG_ID } from "./ole-enum.js";
import { createPresentation } from "./creation.js";
import { addOleObject, type AddOleObjectOptions } from "./ole-insertion.js";
import { readObjects, extractObject } from "./opaque-objects.js";
import { inspectZip } from "../tests/zip-reader.js";
import { parseXmlPart } from "./xml.js";
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
const icon = new Uint8Array([
  71, 73, 70, 56, 57, 97, 2, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 44, 0, 0, 0, 0, 1, 0, 1, 0,
  0, 2, 2, 68, 1, 0, 59
]);
const options: AddOleObjectOptions = {
  slide: 1,
  bytes: new Uint8Array([82, 101, 99, 111, 114, 100]),
  progId: "Coast.Record.1",
  iconBytes: icon,
  iconContentType: "image/gif"
};
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
function parts(bytes: Uint8Array) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/deck.pptx", bytes);
  return new Map(
    inspectZip(new Uint8Array(fs.readFileSync("/deck.pptx") as Buffer)).map((entry) => [
      entry.name,
      entry.payload
    ])
  );
}
it("embeds inert bytes with a declared program identity and supplied icon while retaining unrelated parts", async () => {
  const input = await createPresentation({ slides: [{}, {}] }, context);
  const output = await addOleObject(
    input,
    {
      ...options,
      name: "Record & sample",
      left: -10,
      top: 20,
      width: 300,
      height: 200,
      iconWidth: 90,
      iconHeight: 70
    },
    context
  );
  const entries = parts(output);
  expect(entries.get("ppt/embeddings/oleObject1.bin")).toEqual(options.bytes);
  expect(entries.get("ppt/media/oleIcon1.gif")).toEqual(icon);
  const doc = parseXmlPart(entries.get("ppt/slides/slide1.xml")!, context.xmlLimits);
  const frame = doc.root.children[0]!.children[0]!.children.find(
    (n) => n.name.localName === "graphicFrame"
  )!;
  const text = new TextDecoder().decode(doc.bytes());
  expect(text).toContain('progId="Coast.Record.1"');
  expect(text).toContain('showAsIcon="1"');
  expect(text).toContain('imgW="90" imgH="70"');
  expect(frame).toBeDefined();
  expect(text).toContain('uri="http://schemas.openxmlformats.org/presentationml/2006/ole"');
  const inventory = await readObjects(output, context);
  expect(inventory.activationPerformed).toBe(false);
  expect(inventory.recursiveParsingPerformed).toBe(false);
  expect(inventory.objects[0]).toMatchObject({ kind: "ole", owners: ["/ppt/slides/slide1.xml"] });
  expect(
    (await extractObject(output, { part: "/ppt/embeddings/oleObject1.bin" }, context)).bytes
  ).toEqual(options.bytes);
  for (const [name, bytes] of parts(input))
    if (
      ![
        "[Content_Types].xml",
        "ppt/slides/slide1.xml",
        "ppt/slides/_rels/slide1.xml.rels"
      ].includes(name)
    )
      expect(entries.get(name)).toEqual(bytes);
});
it("owns both payloads before acquisition and allocates independent identities", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const copy = {
    ...options,
    bytes: new Uint8Array(options.bytes),
    iconBytes: new Uint8Array(icon)
  };
  const pending = addOleObject(input, copy, context);
  copy.bytes.fill(0);
  copy.iconBytes.fill(0);
  copy.progId = "Changed";
  const first = await pending;
  const entries = parts(await addOleObject(first, options, context));
  expect(entries.get("ppt/embeddings/oleObject1.bin")).toEqual(options.bytes);
  expect(entries.get("ppt/embeddings/oleObject2.bin")).toEqual(options.bytes);
  expect(entries.get("ppt/media/oleIcon1.gif")).toEqual(icon);
  expect(new TextDecoder().decode(entries.get("ppt/slides/slide1.xml"))).not.toContain("Changed");
});
it.each([
  { bytes: new Uint8Array() },
  { bytes: "file.bin" },
  { progId: "" },
  { progId: 42 },
  { width: 0 },
  { iconHeight: NaN },
  { iconBytes: new Uint8Array([1]) },
  { slide: 0 },
  { extra: true }
])("rejects invalid inert insertion %j", async (patch) => {
  await expect(
    addOleObject(new Uint8Array(), { ...options, ...patch } as AddOleObjectOptions, context)
  ).rejects.toMatchObject({ code: "invalid-value" });
});
it("rejects accessors without running them and applies byte limits before acquisition", async () => {
  const getter = vi.fn();
  const unsafe = { ...options };
  Object.defineProperty(unsafe, "progId", { get: getter });
  await expect(addOleObject(new Uint8Array(), unsafe, context)).rejects.toMatchObject({
    code: "invalid-value"
  });
  expect(getter).not.toHaveBeenCalled();
  await expect(
    addOleObject(new Uint8Array(), options, {
      ...context,
      archiveLimits: { ...context.archiveLimits, maxEntryBytes: 2 }
    })
  ).rejects.toMatchObject({ code: "resource-limit" });
});

it("uses admitted icon dimensions or frame fallback and rejects missing slides", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const output = await addOleObject(input, options, context);
  const text = new TextDecoder().decode(parts(output).get("ppt/slides/slide1.xml"));
  expect(text).toContain('imgW="25400" imgH="12700"');
  await expect(addOleObject(input, { ...options, slide: 2 }, context)).rejects.toMatchObject({
    code: "missing-selection"
  });
  const unknownSize = {
    ...options,
    iconBytes: new Uint8Array([255, 216, 255, 217]),
    iconContentType: "image/jpeg"
  };
  expect(
    parts(await addOleObject(input, unknownSize, context)).get("ppt/media/oleIcon1.jpg")
  ).toEqual(unknownSize.iconBytes);
  expect(
    parts(await addOleObject(input, { ...unknownSize, width: 30, height: 40 }, context)).get(
      "ppt/media/oleIcon1.jpg"
    )
  ).toEqual(unknownSize.iconBytes);
});
it("honors explicit cancellation without acquiring input", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    addOleObject(new Uint8Array(), options, { ...context, signal: controller.signal })
  ).rejects.toBe(controller.signal.reason);
});

it("retains the explicit Strict namespace dialect", async () => {
  const entries = parts(await createPresentation({ slides: [{}] }, context));
  const input = await writePackageArchive(
    [...entries].map(([name, bytes]) => ({
      name,
      bytes:
        name.endsWith(".xml") || name.endsWith(".rels")
          ? new TextEncoder().encode(
              new TextDecoder()
                .decode(bytes)
                .split("http://schemas.openxmlformats.org/presentationml/2006/main")
                .join("http://purl.oclc.org/ooxml/presentationml/main")
                .split("http://schemas.openxmlformats.org/drawingml/2006/main")
                .join("http://purl.oclc.org/ooxml/drawingml/main")
                .split("http://schemas.openxmlformats.org/officeDocument/2006/relationships")
                .join("http://purl.oclc.org/ooxml/officeDocument/relationships")
            )
          : bytes
    })),
    context,
    { compression: "store" }
  );
  const output = parts(await addOleObject(input, options, context));
  expect(new TextDecoder().decode(output.get("ppt/slides/slide1.xml"))).toContain(
    'uri="http://purl.oclc.org/ooxml/presentationml/ole"'
  );
  expect(new TextDecoder().decode(output.get("ppt/slides/_rels/slide1.xml.rels"))).toContain(
    'Type="http://purl.oclc.org/ooxml/officeDocument/relationships/oleObject"'
  );
});

it.each([
  [PROG_ID.DOCX, "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [
    PROG_ID.PPTX,
    "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ],
  [PROG_ID.XLSX, "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
] as const)(
  "inserts registered %s package bytes with declared type and enum geometry",
  async (progId, extension, contentType) => {
    const input = await createPresentation({ slides: [{}] }, context);
    const output = parts(await addOleObject(input, { ...options, progId }, context));
    expect(output.get(`ppt/embeddings/oleObject1.${extension}`)).toEqual(options.bytes);
    expect(new TextDecoder().decode(output.get("[Content_Types].xml"))).toContain(
      `ContentType="${contentType}"`
    );
    expect(new TextDecoder().decode(output.get("ppt/slides/_rels/slide1.xml.rels"))).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package"'
    );
    const slide = new TextDecoder().decode(output.get("ppt/slides/slide1.xml"));
    expect(slide).toContain(`progId="${progId.progId}"`);
    expect(slide).toContain('cx="965200" cy="609600"');
  }
);
it("uses square string defaults and rejects enum lookalikes without property access", async () => {
  const input = await createPresentation({ slides: [{}] }, context);
  const output = parts(await addOleObject(input, options, context));
  expect(new TextDecoder().decode(output.get("ppt/slides/slide1.xml"))).toContain(
    'cx="914400" cy="914400"'
  );
  const getter = vi.fn();
  const counterfeit = Object.defineProperty({}, "progId", { get: getter });
  for (const progId of [{ ...PROG_ID.DOCX }, counterfeit])
    await expect(
      addOleObject(input, { ...options, progId } as AddOleObjectOptions, context)
    ).rejects.toMatchObject({ code: "invalid-value" });
  expect(getter).not.toHaveBeenCalled();
});
