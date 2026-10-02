import { Volume } from "memfs";
import { SaxesParser } from "saxes";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPresentation, mutateTextRuns, readPresentationText } from "./index.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { inspectZip } from "../tests/zip-reader.js";

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
let source: Uint8Array;
beforeAll(async () => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
  source = await createPresentation(
    {
      slides: [
        { shapes: [{ name: "Caption", x: 0, y: 0, width: 100, height: 100, text: "Before" }] }
      ]
    },
    context
  );
});
afterAll(() => vi.restoreAllMocks());

it.each([
  ["plain", "Meadow", "Meadow"],
  ["escape control", "Me\u001badow", "Me_x001B_adow"],
  ["tab", "A\tB", "A\tB"],
  ["tab and newline", "A\tB\nC", "A\tB\nC"],
  ["vertical tab", "A\vBC", "A_x000B_BC"],
  ["newline and vertical tab", "A\nB\vC", "A\nB_x000B_C"],
  ["literal escape spelling", "_x001B_ _x005F_ _x000B_", "_x001B_ _x005F_ _x000B_"],
  ["mixed scripts", "e\u0301 🧭 שלום 日本語 हिन्दी", "e\u0301 🧭 שלום 日本語 हिन्दी"],
  ["bell", "A\u0007B", "A_x0007_B"],
  ["empty", "", ""]
] as const)("assigns run text through SDK and CLI with %s", async (_label, text, expected) => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/input.pptx", source);
  const input = new Uint8Array(volume.readFileSync("/input.pptx") as Buffer);
  const result = await mutateTextRuns(input, { paragraph: 0, run: 0, text }, context);
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 65536,
    maxOutputBytes: 65536
  });
  const out = await engine.execute({
    args: [
      "text",
      "runs",
      "set",
      "/input.pptx",
      "--paragraph",
      "1",
      "--run",
      "1",
      "--text",
      text,
      "--output",
      "/output.pptx",
      "--json"
    ].map((value) => new TextEncoder().encode(value)),
    signal: new AbortController().signal,
    readInput: async (path) => new Uint8Array(volume.readFileSync(path) as Buffer),
    publishOutput: async (request) => {
      volume.writeFileSync(request.outputPath, request.bytes);
    }
  });
  expect(out.exitCode, new TextDecoder().decode(out.stderr)).toBe(0);
  expect(new Uint8Array(volume.readFileSync("/output.pptx") as Buffer)).toEqual(result.bytes);
  expect(new Uint8Array(volume.readFileSync("/input.pptx") as Buffer)).toEqual(source);
  const slide = inspectZip(result.bytes).find((entry) => entry.name === "ppt/slides/slide1.xml")!;
  const parser = new SaxesParser({ xmlns: true });
  const texts: string[] = [];
  let inText = false;
  parser.on("opentag", (tag) => {
    if (tag.uri === "http://schemas.openxmlformats.org/drawingml/2006/main" && tag.local === "t") {
      inText = true;
      texts.push("");
    }
  });
  parser.on("text", (value) => {
    if (inText) texts[texts.length - 1] += value;
  });
  parser.on("closetag", (tag) => {
    if (tag.local === "t") inText = false;
  });
  parser.write(new TextDecoder().decode(slide.payload)).close();
  expect(texts).toEqual([expected]);
  expect((await readPresentationText(result.bytes, {}, context)).segments[0]?.text).toBe(expected);
});

it.each(["\ud800", "\udfff", "\ufffe", "\uffff"])(
  "rejects invalid scalar run text %j before package admission",
  async (text) => {
    await expect(mutateTextRuns(new Uint8Array(), { run: 0, text }, context)).rejects.toMatchObject(
      { code: "invalid-value", phase: "usage" }
    );
  }
);
