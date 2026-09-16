import { expect, it } from "vitest";
import { Volume } from "memfs";
import { layoutContext, layoutFixture } from "../tests/fixtures/image-layout.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { inspectDocumentImages } from "./images.js";
import { readArchive } from "./archive.js";

it("publishes native layout through the SDK without acquiring media or altering relationship bytes", async () => {
  const input = await layoutFixture(), volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "" }); let reads = 0, diagnostics = "";
  const result = await createDocxInspectionCommandEngine({ limits: layoutContext.limits }).execute({ args: ["images", "set", "input.docx", "--image", "1", "--horizontal-alignment", "inside", "--vertical-relative-from", "line", "--distance-left", "1pt", "--lock-aspect", "false", "--output", "-"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: layoutContext.signal,
    filesystem: { async readFile(path) { reads++; expect(path).toBe("/input.docx"); return new Uint8Array(volume.readFileSync(path) as Buffer); }, readStream(path) { reads++; expect(path).toBe("/input.docx"); return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { diagnostics += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode, diagnostics).toBe(0); expect(reads).toBe(1);
  const output = new Uint8Array(volume.readFileSync("/out") as Buffer), before = await readArchive(input, layoutContext), after = await readArchive(output, layoutContext);
  for (const name of ["word/media/pixel.png", "word/_rels/document.xml.rels", "_rels/.rels", "[Content_Types].xml"]) expect(after.members.find(member => member.name === name)?.bytes).toEqual(before.members.find(member => member.name === name)?.bytes);
  expect((await inspectDocumentImages(output, { operation: "images.get", image: 1 }, layoutContext)).item?.details.horizontalPosition).toMatchObject({ alignment: "inside" });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});
