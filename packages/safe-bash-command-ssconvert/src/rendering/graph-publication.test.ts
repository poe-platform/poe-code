import { expect, it } from "vitest";
import { createEngine, type FileOutput, type RenderingCapability } from "../index.js";
import { FileWriteError } from "../io-errors.js";
import { ImageExportError } from "./images/formats.js";
function fixture(rendering: RenderingCapability, openOutput: (uri: string) => Promise<FileOutput>) {
  return createEngine({
    codecs: [{ id: "original", description: "Original", extensions: [], probeContent: () => true, async read() { return { sheets: [{ id: "a", name: "One", cells: [] }, { id: "b", name: "Two", cells: [] }] }; } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10, outputBytes: 1000, cells: 10, sheets: 2, operations: 100 },
    filesystem: { async read() { return [new Uint8Array([1])]; }, async write() { throw new Error("unexpected write"); }, openOutput }, rendering
  });
}
const request = { input: { kind: "resource" as const, uri: "/original" }, destination: { kind: "resource" as const, uri: "/graph-%n" }, graphs: true };
it("admits output before rendering and continues same-sheet acquisition failures", async () => {
  const events: string[] = [];
  const engine = fixture({ async *exportGraphs() {
    for (const [index, sheet] of ["a", "a", "b"].entries()) yield { uri: "/wrong", sheet, mediaType: "image/png", async render() { events.push(`render:${index}`); return new Uint8Array([index]); } };
  } }, async uri => {
    events.push(`open:${uri}`);
    if (uri.endsWith("0")) throw new FileWriteError(uri, "denied");
    return { async write() { events.push("write"); }, async close() { events.push("close"); }, async abort() { events.push("abort"); } };
  });
  expect(await engine.convert(request, { signal: new AbortController().signal })).toMatchObject({ exitCode: 1 });
  expect(events).toEqual(["open:file:///graph-0", "open:file:///graph-1", "render:1", "write", "close"]);
});
it("closes unsupported targets before diagnosing them instead of removing the output", async () => {
  const events: string[] = [];
  const engine = fixture({ async *exportGraphs() {
    yield { uri: "/wrong", sheet: "a", mediaType: "application/octet-stream", async render() { events.push("render"); throw new ImageExportError("Unknown image format"); } };
  } }, async () => ({ async write() { events.push("write"); }, async close() { events.push("close"); }, async abort() { events.push("abort"); } }));
  expect(await engine.convert(request, { signal: new AbortController().signal, async diagnostic() { events.push("diagnostic"); } })).toMatchObject({ exitCode: 1, artifacts: [] });
  expect(events).toEqual(["render", "close", "diagnostic"]);
});
it("cancellation after output acquisition prevents render admission and aborts ownership", async () => {
  const controller = new AbortController(); const reason = new Error("cancelled");
  const events: string[] = [];
  const engine = fixture({ async *exportGraphs() {
    yield { uri: "/wrong", sheet: "a", mediaType: "image/png", async render() { events.push("render"); return new Uint8Array(); } };
  } }, async () => { controller.abort(reason); return { async write() { events.push("write"); }, async close() { events.push("close"); }, async abort() { events.push("abort"); } }; });
  await expect(engine.convert(request, { signal: controller.signal })).rejects.toBe(reason);
  expect(events).toEqual(["abort"]);
});
it("aborts failed fatal rendering instead of publishing an empty placeholder", async () => {
  const reason = new Error("scene failure"); const events: string[] = [];
  const engine = fixture({ async *exportGraphs() {
    yield { uri: "/wrong", sheet: "a", mediaType: "image/png", async render() { throw reason; } };
  } }, async () => ({ async write() { events.push("write"); }, async close() { events.push("close"); }, async abort() { events.push("abort"); } }));
  await expect(engine.convert(request, { signal: new AbortController().signal })).rejects.toBe(reason);
  expect(events).toEqual(["abort"]);
});
it("classifies non-regular VFS targets as recoverable graph acquisition failures", async () => {
  const { createVfsOutput } = await import("../io/publication.js");
  const { Volume } = await import("memfs");
  const volume = new Volume(); volume.mkdirSync("/directory");
  const output = createVfsOutput({ capabilities: {}, async lstat(path) {
    const stat = volume.lstatSync(path); return { type: stat.isDirectory() ? "directory" : "file", mode: stat.mode };
  }, async access() {}, async writeFile() { throw new Error("unexpected write"); }, async rename() { throw new Error("unexpected rename"); } }, async () => { throw new Error("unexpected write"); });
  await expect(output("/directory", { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 10, outputBytes: 1000, cells: 10, sheets: 2, operations: 100 } })).rejects.toBeInstanceOf(FileWriteError);
  expect(volume.statSync("/directory").isDirectory()).toBe(true);
});
it("does not enter the next sheet's geometry producer after a failed sheet save", async () => {
  const { createImageRendering } = await import("./images/index.js");
  const { readGnumeric } = await import("../codecs/gnumeric.js");
  const visits: string[] = [];
  const graph = '<g:SheetObjectGraph AnchorMode="2" ObjectBound="A1:A1" ObjectOffset="0 0 71 35"><GogObject type="GogGraph"/></g:SheetObjectGraph>';
  const source = `<g:Workbook xmlns:g="http://www.gnumeric.org/v10.dtd"><g:Sheets>${["One", "Two"].map(name => `<g:Sheet><g:Name>${name}</g:Name><g:Objects>${graph}</g:Objects><g:Cells/></g:Sheet>`).join("")}</g:Sheets></g:Workbook>`;
  const engine = createEngine({
    codecs: [{ id: "original", description: "Original", extensions: [], probeContent: () => true, async read(bytes, context) { return readGnumeric(bytes, context); } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 },
    filesystem: { async read() { return [new TextEncoder().encode(source)]; }, async write() { throw new Error("unexpected write"); }, async openOutput(uri) { throw new FileWriteError(uri, "denied"); } },
    rendering: createImageRendering({ metrics(sheet) {
      visits.push(sheet.name);
      if (sheet.name === "Two") throw new Error("entered failed sheet successor");
      return { column(index) { return { start: index * 48, size: 48 }; }, row(index) { return { start: index * 12.75, size: 12.75 }; } };
    } })
  });
  expect(await engine.convert(request, { signal: new AbortController().signal })).toMatchObject({ exitCode: 1 });
  expect(visits).toEqual(["One"]);
});
