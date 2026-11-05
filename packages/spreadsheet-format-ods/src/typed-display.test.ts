import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { renderCellText } from "@poe-code/spreadsheet-engine/formatting";
import { readOdf } from "./odf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, limits: defaultSsconvertLimits };
const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 10, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };

it.each([false, true])("preserves typed date/time display with General and explicit styles (legacy: %s)", async legacy => {
  const namespace = (name: string) => legacy ? `http://openoffice.org/2000/${name}` : `urn:oasis:names:tc:opendocument:xmlns:${name}:1.0`;
  const prefix = legacy ? "table" : "office";
  const cell = (type: string, value: string, style = "General") =>
    `<table:table-cell table:style-name="${style}" table:number-columns-repeated="2" ${prefix}:value-type="${type}" ${prefix}:${type}-value="${value}"/>`;
  const body = `<table:table table:name="Dates"><table:table-row>${
    cell("date", "2024-02-29") + cell("time", "PT013H45M22S") +
    cell("date", "2024-02-29T13:45:22", "missing") + cell("time", "PT013H45M22S", "Explicit")
  }</table:table-row></table:table>`;
  const xml = `<office:document-content xmlns:office="${namespace("office")}" xmlns:table="${namespace("table")}" xmlns:style="${namespace("style")}" xmlns:number="${namespace("datastyle")}">
    <office:automatic-styles>
      <number:number-style style:name="general"/>
      <number:time-style style:name="explicit"><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/></number:time-style>
      <style:style style:name="General" style:family="table-cell" style:data-style-name="general"/>
      <style:style style:name="Explicit" style:family="table-cell" style:data-style-name="explicit"/>
    </office:automatic-styles>
    <office:body>${legacy ? body : `<office:spreadsheet>${body}</office:spreadsheet>`}</office:body>
  </office:document-content>`;
  const codec = createZipCodec();
  const entry = await codec.makeZipEntry("content.xml", new TextEncoder().encode(xml),
    { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, limits, context.signal);
  const bytes = await codec.writeZipArchive({ entries: [entry], comment: new Uint8Array() }, limits, context.signal);
  const book = await readOdf(bytes, context);
  const cells = book.sheets[0]!.cells;
  expect(await Promise.all(cells.map(cell => renderCellText(cell, book, context)))).toEqual([
    "2024/02/29", "2024/02/29", "13:45:22", "13:45:22",
    "2024/02/29 13:45:22", "2024/02/29 13:45:22", "13:45:22", "13:45:22"
  ]);
  expect(await renderCellText(cells[6]!, book, context, "preserve")).toBe("13:45");
  expect(cells[0]!.value).toMatchObject({ kind: "number", value: 45351 });
  expect(cells[2]!.value).toMatchObject({ kind: "number", value: 49522 / 86400 });
});
