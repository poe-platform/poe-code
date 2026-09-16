import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Volume } from "memfs";
import { Presentation } from "./presentation-model.js";
import { Picture } from "./slide-model.js";
import { createPresentation } from "./creation.js";
import { addImage } from "./image-insertion.js";
import { createPptxCommandEngine } from "./command-engine.js";
import { parseXmlPart } from "./xml.js";
import { inspectZip } from "../tests/zip-reader.js";
import { storedArchive } from "../tests/fixtures/archive.js";
import { opaqueContext as context } from "../tests/fixtures/opaque-deck.js";

beforeAll(() => {
  const timer = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) =>
    delay === 0 ? setImmediate(callback) : timer(callback, delay)) as typeof setTimeout);
});
afterAll(() => vi.restoreAllMocks());

const jpeg = Uint8Array.from([255, 216, 255, 192, 0, 11, 8, 0, 24, 0, 42, 1, 1, 17, 0, 255, 217]);
async function imported(declaredType: string, replacement?: Uint8Array): Promise<Uint8Array> {
  const input = await createPresentation({ slides: [{}] }, context);
  const inserted = await addImage(
    input,
    { slide: 1, bytes: jpeg, contentType: "image/jpeg" },
    context
  );
  return storedArchive(
    inspectZip(inserted).map((entry) => {
      if (replacement && entry.name === "ppt/media/image1.jpg")
        return { name: entry.name, bytes: replacement };
      if (entry.name !== "[Content_Types].xml") return { name: entry.name, bytes: entry.payload };
      const xml = parseXmlPart(entry.payload, context.xmlLimits);
      const imageType = xml.root.children.find((node) =>
        node.attributes.some(
          (attribute) =>
            attribute.name.localName === "ContentType" && attribute.value === "image/jpeg"
        )
      )!;
      return {
        name: entry.name,
        bytes: xml
          .merge(imageType, {
            attributes: [{ namespace: "", localName: "ContentType", value: declaredType }]
          })
          .bytes()
      };
    })
  );
}
it("accesses an imported JPEG picture with a legacy MIME alias while preserving its package", async () => {
  const bytes = await imported("image/jpg"),
    model = await Presentation(bytes);
  const picture = model.slides[0]!.shapes[0] as Picture;
  expect(picture).toBeInstanceOf(Picture);
  const image = picture.image;
  expect(image.content_type).toBe("image/jpeg");
  expect(image.ext).toBe("jpg");
  expect(image.size).toEqual([42, 24]);
  expect(image.blob).toEqual(jpeg);
  expect(inspectZip(await model.save()).map(({ name, payload }) => ({ name, payload }))).toEqual(
    inspectZip(bytes).map(({ name, payload }) => ({ name, payload }))
  );
});
it("continues to reject contradictory imported image declarations", async () => {
  const model = await Presentation(await imported("image/png"));
  expect(() => (model.slides[0]!.shapes[0] as Picture).image).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
});
it("extracts the original aliased JPEG bytes through an explicit CLI capability", async () => {
  const volume = Volume.fromJSON({
    "/deck.pptx": Buffer.from(await imported("image/jpg")),
    "/out": null
  });
  const engine = createPptxCommandEngine({
    context,
    maxArgumentBytes: 8192,
    maxOutputBytes: 131072
  });
  const result = await engine.execute({
    args: [
      "images",
      "extract",
      "/deck.pptx",
      "--output-dir",
      "/out",
      "--allow-partial-output",
      "--json"
    ].map((arg) => new TextEncoder().encode(arg)),
    signal: new AbortController().signal,
    async readInput(path) {
      return new Uint8Array(volume.readFileSync(path) as Buffer);
    },
    async publishOutput(publication) {
      volume.writeFileSync(publication.outputPath, publication.bytes);
    }
  });
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
  expect(volume.readdirSync("/out")).toEqual(["part-000001.bin"]);
  expect(new Uint8Array(volume.readFileSync("/out/part-000001.bin") as Buffer)).toEqual(jpeg);
});
it("still validates JPEG signatures when a legacy MIME alias is present", async () => {
  const model = await Presentation(
    await imported("image/jpg", Uint8Array.from([71, 73, 70, 56, 57, 97]))
  );
  expect(() => (model.slides[0]!.shapes[0] as Picture).image).toThrowError(
    expect.objectContaining({ code: "invalid-value" })
  );
});
