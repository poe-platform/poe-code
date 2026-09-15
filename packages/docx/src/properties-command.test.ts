import { expect, it, vi } from "vitest";
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { Volume } from "memfs";
import { createFsFromVolume } from "memfs";
import { validateDocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
function request() { const fs = createFsFromVolume(Volume.fromJSON({ "/work/input": "" })); return { args: [], signal: textContext.signal, cwd: "/work", filesystem: fs.promises, stdin: { async *[Symbol.asyncIterator]() {} }, stdout: { write: vi.fn() }, stderr: { write: vi.fn() } } as unknown as DocxInspectionCommandRequest; }
it("returns the exact empty resource envelope without edit effects", async () => {
  const { executePropertiesCommand } = await import("./properties-command.js"), req = request(), invocation = validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { json: true } });
  const output = await executePropertiesCommand(invocation, await textFixture("<w:p/>"), undefined, req, textContext);
  expect(JSON.parse(new TextDecoder().decode(output))).toEqual({ version: 1, operation: "properties.list", ok: true, data: { items: [] }, warnings: [], errors: [], affected: 0, locations: [] });
});
it("requires admitted file identity before property file publication", async () => {
  const { executePropertiesCommand } = await import("./properties-command.js"), invocation = validateDocxInvocation({ operation: "properties.set", inputs: ["input"], options: { name: "title", value: "Ledger", output: "result" } });
  await expect(executePropertiesCommand(invocation, await textFixture("<w:p/>"), undefined, request(), textContext)).rejects.toMatchObject({ code: "unsupported-publication" });
});
it("publishes pure binary through the admitted sink and returns no text payload", async () => {
  const { executePropertiesCommand } = await import("./properties-command.js"), invocation = validateDocxInvocation({ operation: "properties.set", inputs: ["-"], options: { name: "title", value: "Ledger", output: "-" } }), req = request();
  const output = await executePropertiesCommand(invocation, await textFixture("<w:p/>"), undefined, req, textContext);
  expect(output).toEqual(new Uint8Array()); expect(req.stdout.write).toHaveBeenCalledWith(expect.any(Uint8Array), expect.any(AbortSignal));
});
async function opaqueFixture() {
  const { readArchive } = await import("./archive.js"), { writeArchive } = await import("./archive-write.js"), archive = await readArchive(await textFixture("<w:p/>"), textContext), encode = (text: string) => new TextEncoder().encode(text);
  const members = [...archive.members.map(member => member.name !== "[Content_Types].xml" ? member : { ...member, bytes: encode(new TextDecoder().decode(member.bytes).replace("</Types>", '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>')) }), { name: "docProps/custom.xml", bytes: encode('<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="Opaque" pid="2" fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}"><vt:vector/></property></Properties>'), directory: false, modified: new Date("1980-01-01T00:00:00Z") }];
  const fs = Volume.fromJSON({ "/input": "" }); await writeArchive({ ...archive, members }, { async write(bytes) { fs.appendFileSync("/input", bytes); } }, { order: "input", compression: "store" }, textContext); return new Uint8Array(fs.readFileSync("/input") as Buffer);
}
it("awaits bounded property diagnostics and refuses inventory output on sink failure", async () => {
  const { executePropertiesCommand } = await import("./properties-command.js"), req = request(), invocation = validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { json: true } });
  vi.mocked(req.stderr.write).mockRejectedValue(new Error("Sink unavailable"));
  await expect(executePropertiesCommand(invocation, await opaqueFixture(), undefined, req, textContext)).rejects.toMatchObject({ code: "sink-failure" }); expect(req.stdout.write).not.toHaveBeenCalled();
});
it("admits diagnostic budgets before property warning transport", async () => {
  const { executePropertiesCommand } = await import("./properties-command.js"), req = request(), invocation = validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { json: true, limit: [{ name: "diagnosticBytes", value: 1 }] } });
  await expect(executePropertiesCommand(invocation, await opaqueFixture(), undefined, req, textContext)).rejects.toMatchObject({ code: "limit-exceeded" }); expect(req.stderr.write).not.toHaveBeenCalled();
});
it("admits the JSON newline before serializing a property envelope", async () => {
  const { executePropertiesCommand } = await import("./properties-command.js"), bytes = await textFixture("<w:p/>"), req = request();
  const first = await executePropertiesCommand(validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { json: true } }), bytes, undefined, req, textContext);
  const invocation = validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { json: true, limit: [{ name: "serializedOutput", value: first.length - 1 }] } });
  const original = JSON.stringify; let serialized = false;
  const spy = vi.spyOn(JSON, "stringify").mockImplementation((value, ...args) => { if (value?.operation === "properties.list" && value?.ok) serialized = true; return original(value, ...args); });
  try { await expect(executePropertiesCommand(invocation, bytes, undefined, req, textContext)).rejects.toMatchObject({ code: "limit-exceeded" }); expect(serialized).toBe(false); } finally { spy.mockRestore(); }
});
it("bounds only the chosen human output rather than an un-emitted JSON envelope", async () => {
  const { executePropertiesCommand } = await import("./properties-command.js"), req = request(), invocation = validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { limit: [{ name: "serializedOutput", value: 14 }] } });
  expect(new TextDecoder().decode(await executePropertiesCommand(invocation, await textFixture("<w:p/>"), undefined, req, textContext))).toBe("Properties: 0\n");
});
it("does not format human fields for JSON output", async () => {
  const terminal = await import("toolcraft-design/escape-terminal-text"), spy = vi.spyOn(terminal, "escapeTerminalText"), { executePropertiesCommand } = await import("./properties-command.js");
  try { await executePropertiesCommand(validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { json: true } }), await opaqueFixture(), undefined, request(), textContext); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
});
it("refuses an undersized human response before formatting full fields", async () => {
  const terminal = await import("toolcraft-design/escape-terminal-text"), spy = vi.spyOn(terminal, "escapeTerminalText"), { executePropertiesCommand } = await import("./properties-command.js");
  try { await expect(executePropertiesCommand(validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { limit: [{ name: "serializedOutput", value: 1 }] } }), await opaqueFixture(), undefined, request(), textContext)).rejects.toMatchObject({ code: "limit-exceeded" }); expect(spy).not.toHaveBeenCalled(); } finally { spy.mockRestore(); }
});
it("admits warning bytes before joining diagnostic output", async () => {
  const { executePropertiesCommand } = await import("./properties-command.js"), bytes = await opaqueFixture(), req = request(), original = Array.prototype.join; let joined = false;
  const spy = vi.spyOn(Array.prototype, "join").mockImplementation(function(this: unknown[], separator?: string) { if (this.some(value => typeof value === "string" && value.startsWith("docx: "))) joined = true; return original.call(this, separator); });
  try { await expect(executePropertiesCommand(validateDocxInvocation({ operation: "properties.list", inputs: ["-"], options: { limit: [{ name: "diagnosticBytes", value: 1 }] } }), bytes, undefined, req, textContext)).rejects.toMatchObject({ code: "limit-exceeded" }); expect(joined).toBe(false); } finally { spy.mockRestore(); }
});
