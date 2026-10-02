import { Volume } from "memfs";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { compileJsonSchema } from "toolcraft-schema";
import { createPptxCommandEngine } from "./command-engine.js";
import { createPresentation } from "./creation.js";
import { readImages } from "./images.js";
import { opaqueContext as context } from "../tests/fixtures/opaque-deck.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

it("admits a bounded bitmap via filename and explicit MIME with discovery parity", async () => {
  const bitmap = new Uint8Array(58),
    view = new DataView(bitmap.buffer);
  bitmap.set([66, 77]);
  view.setUint32(2, 58, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, 1, true);
  view.setInt32(22, 1, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  const volume = Volume.fromJSON({
    "/image.bmp": Buffer.from(bitmap),
    "/deck.pptx": Buffer.from(await createPresentation({ slides: [{}] }, context))
  });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 8192,
    maxOutputBytes: 131072
  });
  async function run(args: string[]) {
    const result = await engine.execute({
      args: args.map((x) => new TextEncoder().encode(x)),
      signal: new AbortController().signal,
      async readInput(path) {
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      },
      async publishOutput(p) {
        if (!p.dryRun) volume.writeFileSync(p.outputPath, p.bytes);
      }
    });
    return { ...result, text: new TextDecoder().decode(result.stdout) };
  }
  for (const extra of [[], ["--content-type", "image/bmp"]]) {
    const result = await run([
      "images",
      "add",
      "/deck.pptx",
      "--slide",
      "1",
      "--file",
      "/image.bmp",
      "--output",
      "/out.pptx",
      "--json",
      ...extra
    ]);
    expect(result.exitCode, result.text).toBe(0);
    const inventory = await readImages(
      new Uint8Array(volume.readFileSync("/out.pptx") as Buffer),
      {},
      context
    );
    expect(inventory.media[0]).toMatchObject({
      contentType: "image/bmp",
      pixelWidth: 1,
      pixelHeight: 1
    });
  }
  const schema = JSON.parse((await run(["schema", "images", "add", "--json"])).text).data
    .operations["images.add"];
  for (const type of [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/x-wmf"
  ]) {
    expect(
      compileJsonSchema(schema.options).validate({
        slide: 1,
        file: "/asset",
        contentType: type,
        dryRun: true
      }).ok
    ).toBe(true);
  }
});
