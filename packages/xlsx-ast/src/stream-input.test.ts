import { expect, it, vi } from "vitest";
import { createZipCodec } from "@poe-code/office-package";
import { defaultSsconvertLimits, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { readXlsx } from "./xlsx.js";
import { readCachedXlsx } from "./cached.js";

const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity,
  maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity,
  maxTextBytes: Infinity, chunkSize: 16384 };
const value = 'value😀é'.repeat(5000);
async function fixture(encoding = 'UTF-8') {
  const codec = createZipCodec(), signal = new AbortController().signal;
  const parts = {
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="book" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Data" r:id="data"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="data" Type="${rel}/worksheet" Target="worksheets/data.xml"/></Relationships>`,
    'xl/worksheets/data.xml': `<worksheet xmlns="${ns}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${value}</t></is></c></row></sheetData></worksheet>`
  };
  const entries = [];
  for (const [name, xml] of Object.entries(parts)) {
    let bytes = new TextEncoder().encode(xml);
    if (encoding !== 'UTF-8') {
      bytes = new Uint8Array(2 + xml.length * 2);
      const view = new DataView(bytes.buffer), little = encoding === 'UTF-16LE';
      view.setUint16(0, 0xfeff, little);
      for (let i = 0; i < xml.length; i++) view.setUint16(2 + i * 2, xml.charCodeAt(i), little);
    }
    entries.push(await codec.makeZipEntry(name, bytes, { modified: new Date(0), mode: 0o100644, directory: false, symlink: false, compression: 'store' }, limits, signal));
  }
  return { codec, signal, archive: { entries, comment: new Uint8Array() } };
}
it.each(['UTF-8', 'UTF-16LE', 'UTF-16BE'])('reads %s XML through bounded decoder calls and borrowed ranges', async encoding => {
  const input = await fixture(encoding);
  const bytes = await input.codec.writeZipArchive(input.archive, limits, input.signal);
  const context: CapabilityContext = { signal: input.signal, own() {}, limits: defaultSsconvertLimits,
    environment: { env: {}, locale: 'C', timezone: 'UTC' } };
  const decode = TextDecoder.prototype.decode; let maximum = 0;
  const spy = vi.spyOn(TextDecoder.prototype, 'decode').mockImplementation(function(this: TextDecoder, input, options) {
    maximum = Math.max(maximum, input?.byteLength ?? 0); return decode.call(this, input, options);
  });
  const reused = new Uint8Array(257);
  try {
    const book = await readXlsx({ size: bytes.length, async read(position, maximum) {
      const length = Math.min(maximum, reused.length, bytes.length - position);
      reused.set(bytes.subarray(position, position + length)); return reused.subarray(0, length);
    } }, context);
    expect(book.sheets[0]!.cells[0]!.value).toEqual({ kind: 'string', value });
    expect(maximum).toBeLessThanOrEqual(16384);
  } finally { spy.mockRestore(); }
});
it('starts cached-value XML parsing before the worksheet is fully decoded', async () => {
  const input = await fixture();
  const decode = input.codec.decodeZipEntry.bind(input.codec);
  let sheet = false, finished = false, earlyNode = false;
  vi.spyOn(input.codec, 'decodeZipEntry').mockImplementation(async function* (entry, limits, signal) {
    sheet = entry.name === 'xl/worksheets/data.xml'; finished = false;
    try { yield* decode(entry, limits, signal); finished = true; }
    finally { sheet = false; }
  });
  const result = await readCachedXlsx({ ...input, limits, maxXmlNodes: Infinity, work() {}, retain(bytes) {
    if (sheet && !finished && bytes === 256) earlyNode = true;
  } });
  expect(result.sheets[0]!.cells[0]!.value).toBe(value);
  expect(earlyNode).toBe(true);
});

it.each(['source', 'cancel', 'admission'])('closes an in-progress cached XML producer after %s failure', async mode => {
  const input = await fixture(), controller = new AbortController();
  const failure = { reason: mode };
  const decode = input.codec.decodeZipEntry.bind(input.codec);
  let sheet = false, closed = false, pulls = 0;
  vi.spyOn(input.codec, 'decodeZipEntry').mockImplementation(async function* (entry, limits, signal) {
    sheet = entry.name === 'xl/worksheets/data.xml';
    try {
      for await (const bytes of decode(entry, limits, signal)) {
        if (sheet) pulls++;
        yield bytes;
        if (sheet && mode === 'source') throw failure;
      }
    } finally { if (sheet) closed = true; sheet = false; }
  });
  await expect(readCachedXlsx({ ...input, signal: controller.signal, limits, maxXmlNodes: Infinity, work() {}, retain(bytes) {
    if (sheet && bytes === 256) {
      if (mode === 'cancel') controller.abort(failure);
      if (mode === 'admission') throw failure;
    }
  } })).rejects.toBe(failure);
  expect(pulls).toBe(1); expect(closed).toBe(true);
});
