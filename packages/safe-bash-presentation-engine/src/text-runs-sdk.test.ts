import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation, mutateTextRuns, readTextRuns } from "./index.js";
import { inspectZip } from "../tests/zip-reader.js";
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());
const context = {
  limits: { maxBytes: 65536, maxReads: 1000, chunkBytes: 512 },
  archiveLimits: {
    maxArchiveBytes: 65536,
    maxEntryBytes: 8192,
    maxTotalBytes: 32768,
    maxMembers: 32,
    maxPathBytes: 256,
    maxDepth: 16,
    maxPaxBytes: 1024,
    maxTextBytes: 8192,
    chunkSize: 512
  },
  xmlLimits: { maxBytes: 8192, maxNodes: 1000, maxDepth: 32 },
  relationshipLimits: { maxBytes: 8192, maxParts: 32, maxRelationships: 64 },
  validationLimits: {
    maxBytes: 8192,
    maxNodes: 1000,
    maxDepth: 32,
    maxParts: 32,
    maxRelationships: 64,
    maxEntries: 32
  }
};

it("persists selected run formatting through an explicit memory volume", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync(
    "/deck.pptx",
    await createPresentation(
      {
        slides: [{ shapes: [{ name: "Label", x: 0, y: 0, width: 100, height: 100, text: "Oak" }] }]
      },
      context
    )
  );
  const source = new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer);
  const result = await mutateTextRuns(
    source,
    {
      paragraph: 0,
      run: 0,
      bold: false,
      italic: true,
      size: 17.5,
      font: "Cedar",
      language: "en-NZ",
      color: "123ABC",
      highlight: "F0D080",
      underline: "DOUBLE_LINE",
      strike: "single",
      capitalization: "all",
      baseline: 25,
      spacing: -1
    },
    context
  );
  expect(result.affected).toBe(1);
  volume.writeFileSync("/styled.pptx", result.bytes);
  const raw = new TextDecoder().decode(
    inspectZip(result.bytes).find((e) => e.name === "ppt/slides/slide1.xml")!.payload
  );
  for (const fragment of [
    'b="0"',
    'i="1"',
    'sz="1750"',
    'lang="en-NZ"',
    'u="dbl"',
    'strike="sngStrike"',
    'cap="all"',
    'baseline="25000"',
    'spc="-100"',
    'typeface="Cedar"',
    'val="123ABC"',
    'val="F0D080"'
  ])
    expect(raw).toContain(fragment);
  const read = await readTextRuns(
    new Uint8Array(volume.readFileSync("/styled.pptx") as Buffer),
    {},
    context
  );
  expect(read[0]?.formatting).toMatchObject({
    font: "Cedar",
    size: 17.5,
    language: "en-NZ",
    bold: false,
    italic: true,
    underline: "dbl",
    strike: "single",
    baseline: 25,
    spacing: -1
  });
  const cleared = await mutateTextRuns(
    result.bytes,
    { run: 0, bold: null, color: null, font: null },
    context
  );
  expect((await readTextRuns(cleared.bytes, {}, context))[0]?.formatting).toMatchObject({
    bold: null,
    color: null,
    font: null,
    italic: true
  });
  expect(new Uint8Array(volume.readFileSync("/deck.pptx") as Buffer)).toEqual(source);
  for (const old of inspectZip(source).filter((e) => e.name !== "ppt/slides/slide1.xml"))
    expect(inspectZip(result.bytes).find((e) => e.name === old.name)?.payload).toEqual(old.payload);
});

it("rejects a mutation without explicit selection before accessing input", async () => {
  await expect(mutateTextRuns(new Uint8Array(), { bold: true }, context)).rejects.toMatchObject({
    code: "missing-selection"
  });
});
