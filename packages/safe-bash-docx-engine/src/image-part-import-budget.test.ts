import { Volume } from "memfs";
import { expect, it } from "vitest";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { textContext } from "../tests/fixtures/text.js";

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`imports filename metadata under the destination budget without retaining source authority; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const bytes = rasterPng(), volume = Volume.fromJSON({ "/assets/coast.PNG": Buffer.from(bytes), "/input": Buffer.from(input) });
  const sourceBudget = new api.DocumentBudget({}, textContext.signal), destinationBudget = new api.DocumentBudget({}, textContext.signal);
  let acquired = 0;
  const source = await api.Image.from_file({ path: "/assets/coast.PNG", capability: "source" }, { ...textContext, budget: sourceBudget,
    binaryResolver: { capability: "source", async *open(path) { acquired++; yield new Uint8Array(volume.readFileSync(path) as Buffer); } } });
  const document = await api.Document(input, { ...textContext, budget: destinationBudget });
  const imported = await api.ImagePartView.from_image(source, "/media/imported.png", document.part.package);
  expect(imported.filename).toBe("coast.PNG"); expect(imported.image.ext).toBe("PNG"); expect(imported.image).not.toBe(source);
  const beforeSource = sourceBudget.usage, beforeDestination = destinationBudget.usage;
  const copy = imported.image.blob; expect(copy).toEqual(bytes); copy.fill(0);
  expect(sourceBudget.usage).toEqual(beforeSource);
  expect(destinationBudget.usage.retainedBytes).toBeGreaterThanOrEqual(beforeDestination.retainedBytes + bytes.length);
  expect(source.blob).toEqual(bytes); expect(imported.blob).toEqual(bytes); expect(acquired).toBe(1);
  expect(volume.readFileSync("/input")).toEqual(Buffer.from(input));
});

for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
it(`rejects an imported value over destination media limits without reserving a part; ${kind} strict=${strict}`, async () => {
  const { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, "<w:p/>");
  const bytes = rasterPng(), source = await api.Image.from_blob(bytes, textContext);
  const budget = new api.DocumentBudget({ embeddedMediaBytes: bytes.length - 1 }, textContext.signal);
  const document = await api.Document(input, { ...textContext, budget });
  const before = document.store.snapshot();
  await expect(api.ImagePartView.from_image(source, "/media/imported.png", document.part.package)).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(document.store.snapshot()).toEqual(before); expect(document.part.package.image_parts.length).toBe(0);
  expect(source.blob).toEqual(bytes);
});
