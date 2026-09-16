import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { inspectDocumentStyles } from "./styles.js";
import { textFixture, paragraph, textContext } from "../tests/fixtures/text.js";
import { rasterPng } from "../tests/fixtures/raster.js";
const batch = { version: 1, operations: [
  { operation: "model.document.Document.styles.get", receiver: { resultHandle: "document" }, arguments: {}, resultHandle: "styles" },
  { operation: "model.styles.styles.Styles.add_style.call", receiver: { resultHandle: "styles" }, arguments: { name: "Channel", styleType: { enum: "WD_STYLE_TYPE", name: "PARAGRAPH" } }, resultHandle: "style" },
  { operation: "model.styles.style.ParagraphStyle.font.get", receiver: { resultHandle: "style" }, arguments: {}, resultHandle: "font" },
  { operation: "model.text.run.Font.bold.set", receiver: { resultHandle: "font" }, arguments: { value: true } }
] };
async function execute(flags: string[]) {
  const input = await textFixture(paragraph("Field notes"));
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input), "/out": "" });
  let stderr = "";
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify(batch), ...flags].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
  return { ...result, stderr, output: new Uint8Array(volume.readFileSync("/out") as Buffer) };
}
it("executes style model batch through CLI with one pure binary publication", async () => {
  const result = await execute(["--output", "-"]);
  expect(result.stderr).toBe(""); expect(result.exitCode).toBe(0);
  expect((await inspectDocumentStyles(result.output, { name: "Channel" }, textContext)).styles[0]?.direct.bold).toBe(true);
});
it("reports model batch dry-run without publishing a package", async () => {
  const result = await execute(["--dry-run", "--json"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(result.output))).toMatchObject({ version: 1, operation: "batch", ok: true, data: { dryRun: true, results: expect.any(Array) }, errors: [] });
});
it("binds only the command VFS capability for immutable image batches without publication", async () => {
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(await textFixture(paragraph("Harbor"))), "/Map.PNG": Buffer.from(rasterPng()), "/out": "" });
  const operations = [
    { operation: "model.image.image.Image.from_file.call", arguments: { imageDescriptor: { path: "Map.PNG", capability: "command" }, context: { vfs: "command" } }, resultHandle: "image" },
    { operation: "model.image.image.Image.filename.get", receiver: { resultHandle: "image" }, arguments: {} }
  ];
  const engine = createDocxInspectionCommandEngine({ limits: textContext.limits });
  const result = await engine.execute({ args: ["batch", "input.docx", "--ops-json", JSON.stringify({ version: 1, operations }), "--json"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { return new Uint8Array(volume.readFileSync(path) as Buffer); }, readStream(path) { return { async *[Symbol.asyncIterator]() { yield new Uint8Array(volume.readFileSync(path) as Buffer); } }; } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { volume.appendFileSync("/out", bytes); } }, stderr: { async write() {} } });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(volume.readFileSync("/out", "utf8") as string)).toMatchObject({ affected: 0, data: { output: [], results: [{ value: { owner: "batch" } }, { value: "Map.PNG" }] } });
});
it("refuses image paths without bounded stream acquisition before calling readFile", async () => {
  const input = await textFixture(paragraph("Harbor"));
  let imageReads = 0;
  const operations = [{ operation: "model.image.image.Image.from_file.call", arguments: { imageDescriptor: { path: "/large.png", capability: "command" } } }];
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({
    args: ["batch", "input.docx", "--ops-json", JSON.stringify({ version: 1, operations }), "--json", "--limit", "embeddedMediaBytes=1"].map(s => new TextEncoder().encode(s)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { if (path === "/input.docx") return input; imageReads++; return rasterPng(); } },
    stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { async write() {} }, stderr: { async write() {} }
  });
  expect(result.exitCode).not.toBe(0);
  expect(imageReads).toBe(0);
});
