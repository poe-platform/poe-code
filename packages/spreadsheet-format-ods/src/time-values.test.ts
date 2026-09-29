import { expect, it } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { readOdf } from "./odf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, limits: defaultSsconvertLimits };
const limits = { maxArchiveBytes: 100000, maxEntryBytes: 100000, maxTotalBytes: 100000,
  maxMembers: 10, maxPathBytes: 1024, maxDepth: 32, maxPaxBytes: 10000, maxTextBytes: 100000, chunkSize: 4096 };

async function timeCell(value: string, legacy: boolean) {
  const office = legacy ? "http://openoffice.org/2000/office" : "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
  const table = legacy ? "http://openoffice.org/2000/table" : "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
  const text = legacy ? "http://openoffice.org/2000/text" : "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
  const prefix = legacy ? "table" : "office";
  const body = `<table:table table:name="Times"><table:table-row><table:table-cell ${prefix}:value-type="time" ${prefix}:time-value="${value}"><text:p>fallback text</text:p></table:table-cell></table:table-row></table:table>`;
  const xml = `<office:document-content xmlns:office="${office}" xmlns:table="${table}" xmlns:text="${text}"><office:body>${legacy ? body : `<office:spreadsheet>${body}</office:spreadsheet>`}</office:body></office:document-content>`;
  const codec = createZipCodec();
  const entries = [];
  for (const [name, source] of Object.entries({ mimetype: legacy ? "application/vnd.sun.xml.calc" : "application/vnd.oasis.opendocument.spreadsheet", "content.xml": xml })) {
    entries.push(await codec.makeZipEntry(name, new TextEncoder().encode(source), { modified: new Date("2000-01-01Z"), mode: 0o644, directory: false, symlink: false, compression: "deflate" }, limits, context.signal));
  }
  const bytes = await codec.writeZipArchive({ entries, comment: new Uint8Array() }, limits, context.signal);
  return (await readOdf(bytes, context)).sheets[0]!.cells[0]!.value;
}

for (const legacy of [false, true]) {
  it.each([
    ["PT01H02M03.5S", (3600 + 120 + 3.5) / 86400],
    ["PT00H00M00.125S", 0.125 / 86400],
    ["PT25H00M00.5S", (25 * 3600 + 0.5) / 86400],
    ["PT25H00M00S", 25 / 24]
  ] as const)(`imports ${legacy ? "legacy" : "ODF"} time %s as a numeric serial`, async (source, value) => {
    expect(await timeCell(source, legacy)).toEqual({ kind: "number", value });
  });

  it.each(["PT01.5H00M00S", "PT00H00.5M00S", "PT00H00MNaNS", "PT00H00MInfinityS", "PT00H00M-0.5S"])(
    `retains fallback text for invalid ${legacy ? "legacy" : "ODF"} time components: %s`, async source => {
      expect(await timeCell(source, legacy)).toEqual({ kind: "string", value: "fallback text" });
    });
}
