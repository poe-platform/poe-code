import { expect, it } from "vitest";
import { Volume } from "memfs";
import { executeImageInsertionCommand } from "./image-insertion-command.js";
import { parseDocxArguments } from "./command.js";
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
