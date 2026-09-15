import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { insertDocumentImage } from "./image-insertion.js";
import { inspectDocumentImages } from "./images.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import { rasterPng, rasterGif, rasterJpeg, rasterBmp, rasterTiff } from "../tests/fixtures/raster.js";

async function embeddedFixture() {
  const volume = Volume.fromJSON({ "/out": "" });
  await insertDocumentImage(await textFixture(paragraph("Harbor")), { operation: "images.add", options: { paragraph: 1, file: { kind: "bytes", base64: Buffer.from(rasterPng()).toString("base64") }, output: "-" } }, { ...textContext, encoding: { order: "input", compression: "store" }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } } });
  return new Uint8Array(volume.readFileSync("/out") as Buffer);
}
it.each([["PNG", rasterPng(), "image/png"], ["JPG", rasterJpeg(), "image/jpeg"], ["GIF", rasterGif(), "image/gif"], ["BMP", rasterBmp(), "image/bmp"], ["TIFF", rasterTiff(), "image/tiff"]] as const)("runs the SDK-backed %s replacement with streamed media and one binary publication", async (suffix, media, mime) => {
  const input = await embeddedFixture(), path = `/Map.${suffix}`, volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), [path]: Buffer.from(media), "/out": "" });
  let diagnostics = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["images", "replace", "input.docx", "--image", "1", "--file", path.slice(1), "--output", "-"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); }, readStream(path) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { diagnostics += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode, diagnostics).toBe(0);
  expect((await inspectDocumentImages(new Uint8Array(volume.readFileSync("/out") as Buffer), { operation: "images.get", image: 1 }, textContext)).item?.details.mime).toBe(mime);
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});
it("refuses unbounded image readFile capability before reading replacement bytes", async () => {
  const input = await embeddedFixture(); let imageReads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["images", "replace", "/input.docx", "--image", "1", "--file", "/Map.PNG", "--dry-run", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { if (path === "/input.docx") return input; imageReads++; return rasterPng(); } }, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} } });
  expect(result.exitCode).not.toBe(0); expect(imageReads).toBe(0);
});
