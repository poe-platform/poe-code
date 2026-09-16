import { expect, it } from "vitest";
import { Volume } from "memfs";
import { executeImageInsertionCommand } from "./image-insertion-command.js";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
import { rasterPng } from "../tests/fixtures/raster.js";
import { rasterGif } from "../tests/fixtures/raster.js";
import { staticSvg, svgBinary } from "../tests/fixtures/svg-image.js";
import { inspectDocumentImages } from "./images.js";
import { ResourceLimitError } from "./archive.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";

it("rejects unadmitted file publication before reading media", async () => {
  const fs = Volume.fromJSON({ "/image.jpg": "" }); let reads = 0, writes = 0;
  const request = { cwd: "/", stdin: { async *[Symbol.asyncIterator]() {} }, filesystem: { async readFile(path: string) { reads++; return new Uint8Array(fs.readFileSync(path) as Buffer); } }, stdout: { async write() { writes++; } }, stderr: { async write() {} }, signal: textContext.signal } as unknown as DocxInspectionCommandRequest;
  await expect(executeImageInsertionCommand(parseDocxArguments(["images", "add", "/input.docx", "--file", "/image.jpg", "--paragraph", "1", "--output", "/out.docx"].map(value => new TextEncoder().encode(value))), await textFixture(paragraph("Garden")), undefined, request, textContext)).rejects.toThrow("identity");
  expect(reads).toBe(0); expect(writes).toBe(0);
});
it("rejects unsupported command operation without media reads", async () => {
  const request = { cwd: "/", signal: textContext.signal } as DocxInspectionCommandRequest;
  await expect(executeImageInsertionCommand(parseDocxArguments(["images", "list", "/input.docx"].map(value => new TextEncoder().encode(value))), await textFixture(paragraph("Garden")), undefined, request, textContext)).rejects.toThrow("insertion");
});

it("refuses a media readFile-only capability before acquisition", async () => {
  let reads = 0;
  const request = { cwd: "/work", signal: textContext.signal, stdin: { async *[Symbol.asyncIterator]() {} }, filesystem: { async readFile() { reads++; return rasterPng(); } }, stdout: { async write() {} } } as unknown as DocxInspectionCommandRequest;
  const invocation = parseDocxArguments(["images", "add", "input.docx", "--paragraph", "1", "--file", "pixel.png", "--dry-run"].map(value => new TextEncoder().encode(value)));
  await expect(executeImageInsertionCommand(invocation, await textFixture(paragraph("Garden")), undefined, request, textContext)).rejects.toThrow("stream");
  expect(reads).toBe(0);
});

it("treats an explicit SDK command VFS dash as a literal path rather than stdin", async () => {
  const paths: string[] = []; let stdinReads = 0;
  const request = { cwd: "/work", signal: textContext.signal, stdin: { async *[Symbol.asyncIterator]() { stdinReads++; yield new Uint8Array([0]); } }, filesystem: { readStream(path: string) { paths.push(path); return { async *[Symbol.asyncIterator]() { yield rasterPng(); } }; } }, stdout: { async write() {} } } as unknown as DocxInspectionCommandRequest;
  const invocation = validateDocxInvocation({ operation: "images.add", inputs: ["input.docx"], options: { paragraph: 1, file: { kind: "vfs", path: "-", capability: "command" }, dryRun: true } });
  await expect(executeImageInsertionCommand(invocation, await textFixture(paragraph("Garden")), undefined, request, textContext)).resolves.toBeInstanceOf(Uint8Array);
  expect(paths).toEqual(["/work/-"]); expect(stdinReads).toBe(0);
});

it("runs the existing SDK byte inputs with an explicit SVG and GIF fallback", async () => {
  const volume = Volume.fromJSON({ "/out": "" }); let reads = 0;
  const request = { cwd: "/work", signal: textContext.signal, stdin: { async *[Symbol.asyncIterator]() { reads++; yield new Uint8Array(); } }, filesystem: { async readFile() { reads++; throw new Error("Unexpected acquisition"); } }, stdout: { async write(bytes: Uint8Array) { volume.appendFileSync("/out", bytes); } } } as unknown as DocxInspectionCommandRequest;
  const invocation = validateDocxInvocation({ operation: "images.add", inputs: ["input.docx"], options: { paragraph: 1, file: svgBinary(), fallback: { kind: "bytes", base64: Buffer.from(rasterGif()).toString("base64") }, output: "-" } });
  await executeImageInsertionCommand(invocation, await textFixture(paragraph("Garden")), undefined, request, textContext);
  expect(reads).toBe(0); const item = (await inspectDocumentImages(new Uint8Array(volume.readFileSync("/out") as Buffer), { operation: "images.get", image: 1 }, textContext)).item;
  expect(item?.details.mime).toBe("image/gif"); expect(item?.details.alternateParts).toHaveLength(1);
});

it("reserves only the CLI file dash for SVG stdin and streams its explicit fallback", async () => {
  const paths: string[] = []; let stdinReads = 0;
  const request = { cwd: "/work", signal: textContext.signal, stdin: { async *[Symbol.asyncIterator]() { stdinReads++; yield staticSvg; } }, filesystem: { readStream(path: string) { paths.push(path); return { async *[Symbol.asyncIterator]() { yield rasterPng(); } }; } }, stdout: { async write() {} } } as unknown as DocxInspectionCommandRequest;
  const invocation = parseDocxArguments(["images", "add", "input.docx", "--paragraph", "1", "--file", "-", "--fallback", "pixel.png", "--dry-run"].map(value => new TextEncoder().encode(value)));
  await executeImageInsertionCommand(invocation, await textFixture(paragraph("Garden")), undefined, request, textContext);
  expect(paths).toEqual(["/work/pixel.png"]); expect(stdinReads).toBe(1);
});

it("keeps an SDK fallback VFS dash literal while a supplied SVG remains byte-owned", async () => {
  const paths: string[] = []; let stdinReads = 0;
  const request = { cwd: "/work", signal: textContext.signal, stdin: { async *[Symbol.asyncIterator]() { stdinReads++; yield new Uint8Array([0]); } }, filesystem: { readStream(path: string) { paths.push(path); return { async *[Symbol.asyncIterator]() { yield rasterPng(); } }; } }, stdout: { async write() {} } } as unknown as DocxInspectionCommandRequest;
  const invocation = validateDocxInvocation({ operation: "images.add", inputs: ["input.docx"], options: { paragraph: 1, file: svgBinary(), fallback: { kind: "vfs", path: "-", capability: "command" }, dryRun: true } });
  await executeImageInsertionCommand(invocation, await textFixture(paragraph("Garden")), undefined, request, textContext);
  expect(paths).toEqual(["/work/-"]); expect(stdinReads).toBe(0);
});
it("bounds streamed media and closes its producer before any publication", async () => {
  const png = rasterPng(); let closed = 0, writes = 0, fileReads = 0;
  const request = { cwd: "/work", signal: textContext.signal, stdin: { async *[Symbol.asyncIterator]() {} }, filesystem: { async readFile() { fileReads++; return png; }, readStream() { return { async *[Symbol.asyncIterator]() { try { yield png; } finally { closed++; } } }; } }, stdout: { async write() { writes++; } } } as unknown as DocxInspectionCommandRequest;
  const invocation = validateDocxInvocation({ operation: "images.add", inputs: ["input.docx"], options: { paragraph: 1, file: { kind: "vfs", path: "pixel.png", capability: "command" }, output: "-", limit: [{ name: "embeddedMediaBytes", value: png.length - 1 }] } });
  await expect(executeImageInsertionCommand(invocation, await textFixture(paragraph("Garden")), undefined, request, textContext)).rejects.toBeInstanceOf(ResourceLimitError);
  expect(closed).toBe(1); expect(writes).toBe(0); expect(fileReads).toBe(0);
});
