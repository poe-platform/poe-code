import { expect, it } from "vitest";
import { Volume } from "memfs";
import { paragraph, textFixture, textContext } from "../tests/fixtures/text.js";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { openDocumentLocations } from "./locations.js";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
import { DocumentIo } from "./io.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { CancellationError, ResourceLimitError } from "./archive.js";
import { encodeLocation } from "./location-token.js";

it("reads empty physical equation inventory with global properties without mutation", async () => {
  const input = await textFixture(paragraph("Original passage")), volume = Volume.fromJSON({ "/input.docx": Buffer.from(input) });
  let stdout = "", stderr = "", reads = 0;
  const result = await createDocxInspectionCommandEngine({ limits: textContext.limits }).execute({ args: ["equations", "list", "input.docx", "--json"].map(value => new TextEncoder().encode(value)), cwd: "/", signal: textContext.signal,
    filesystem: { async readFile(path) { reads++; return new Uint8Array(volume.readFileSync(path) as Buffer); } }, stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode, stderr).toBe(0); expect(reads).toBe(1);
  expect(JSON.parse(stdout)).toMatchObject({ operation: "equations.list", ok: true, data: { items: [], globalProperties: [] }, affected: 0, locations: [] });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});

it.each(["limit", "cancel", "source"])("closes a failed fragment producer before any publication (%s)", async profile => {
  const { executeEquationsCommand } = await import("./equations-command.js");
  const input = await textFixture(paragraph("Original passage")), locations = await openDocumentLocations(input, textContext);
  const controller = new AbortController(), context = { ...textContext, signal: controller.signal };
  const invocation = validateDocxInvocation({ operation: "equations.add", inputs: ["input.docx"], options: { select: locations.at("paragraph", 1).token, file: { kind: "vfs", path: "fragment.xml", capability: "command" }, output: "-" } });
  let closed = 0, writes = 0;
  const request: DocxInspectionCommandRequest = { args: [], cwd: "/", signal: controller.signal, stdin: { async *[Symbol.asyncIterator]() {} }, filesystem: { async readFile() { throw new Error("Unexpected readFile"); }, readStream() { return { async *[Symbol.asyncIterator]() { try {
    if (profile === "source") throw new Error("Original producer failure");
    if (profile === "cancel") controller.abort(new Error("Original cancellation"));
    yield new Uint8Array(profile === "limit" ? textContext.limits.maxEntryBytes + 1 : 1);
  } finally { closed++; } } }; } }, stdout: { async write() { writes++; } }, stderr: { async write() {} } };
  const io = new DocumentIo(context);
  try {
    const operation = executeEquationsCommand(invocation, input, undefined, request, context, io);
    if (profile === "limit") await expect(operation).rejects.toBeInstanceOf(ResourceLimitError);
    else if (profile === "cancel") await expect(operation).rejects.toBeInstanceOf(CancellationError);
    else await expect(operation).rejects.toMatchObject({ code: "source-failure" });
    expect(closed).toBe(1); expect(writes).toBe(0);
  } finally { await io.cleanup(); }
});

it("does not open a fragment for a stale host token", async () => {
  const { executeEquationsCommand } = await import("./equations-command.js");
  const input = await textFixture(paragraph("Original passage"));
  const select = encodeLocation({ version: 1, sourceSha256: "a".repeat(64), generation: 0, part: "/word/document.xml", story: "body", path: [0, 0], range: null });
  const invocation = validateDocxInvocation({ operation: "equations.add", inputs: ["input.docx"], options: { select, file: { kind: "vfs", path: "fragment.xml", capability: "command" }, dryRun: true } });
  let reads = 0;
  const request: DocxInspectionCommandRequest = { args: [], cwd: "/", signal: textContext.signal, stdin: { async *[Symbol.asyncIterator]() {} }, filesystem: { async readFile() { reads++; throw new Error("Unexpected fragment acquisition"); }, readStream() { reads++; throw new Error("Unexpected fragment acquisition"); } }, stdout: { async write() {} }, stderr: { async write() {} } };
  const io = new DocumentIo(textContext);
  try { await expect(executeEquationsCommand(invocation, input, undefined, request, textContext, io)).rejects.toMatchObject({ code: "stale-selection" }); expect(reads).toBe(0); }
  finally { await io.cleanup(); }
});

it("refuses a fragment path without bounded streaming authority before fragment reads", async () => {
  const { executeEquationsCommand } = await import("./equations-command.js");
  const input = await textFixture(paragraph("Original passage"));
  const document = await openDocumentLocations(input, textContext), select = document.at("paragraph", 1).token;
  const invocation = parseDocxArguments(["equations", "add", "input.docx", "--select", select, "--file", "fragment.xml", "--dry-run"].map(value => new TextEncoder().encode(value)));
  let reads = 0;
  const request: DocxInspectionCommandRequest = { args: [], cwd: "/", signal: textContext.signal, stdin: { async *[Symbol.asyncIterator]() {} }, filesystem: { async readFile() { reads++; return new TextEncoder().encode('<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"/>'); } }, stdout: { async write() {} }, stderr: { async write() {} } };
  const io = new DocumentIo(textContext);
  try {
    await expect(executeEquationsCommand(invocation, input, undefined, request, textContext, io)).rejects.toMatchObject({ code: "unsupported-profile" });
    expect(reads).toBe(0);
  } finally { await io.cleanup(); }
});
