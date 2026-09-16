import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as sdk from "./index.js";

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
beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

async function blank() {
  return sdk.Presentation(
    await sdk.createPresentation({ slides: [{ name: "Garden study" }] }, context),
    context
  );
}
it.each(["solid", "background", "gradient", "patterned"] as const)(
  "creates font %s fill after run formatting under inherited namespaces",
  async (kind) => {
    const deck = await blank();
    const run = deck.slides[0]!.shapes.add_textbox(
      new sdk.Inches(1),
      new sdk.Inches(1),
      new sdk.Inches(2),
      new sdk.Inches(1)
    ).text_frame.paragraphs[0]!.add_run();
    run.text = "Rain gauge";
    run.font.bold = true;
    run.font.size = new sdk.Pt(16);
    run.font.fill[kind]();
    expect(run.font.fill.type).toBe({ solid: 1, background: 5, gradient: 3, patterned: 2 }[kind]);
    const saved = await sdk.Presentation(await deck.save(), context);
    expect(
      (saved.slides[0]!.shapes[0] as sdk.Shape).text_frame.paragraphs[0]!.runs[0]!.font.fill.type
    ).toBe(run.font.fill.type);
  }
);
