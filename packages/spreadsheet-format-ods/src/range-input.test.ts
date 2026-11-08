import { expect, it } from "vitest";
import { defaultSsconvertLimits, SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine";
import { probeOdf, readOdf } from "./odf.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" }, limits: defaultSsconvertLimits };

it.each([new Error("range failed"), new SsconvertError("io", "range failed"), null])("preserves retained source failures (%s)", async failure => {
  const source = { size: 100, async read() { throw failure; } };
  await expect(probeOdf(source, context)).rejects.toBe(failure);
  await expect(readOdf(source, context)).rejects.toBe(failure);
});

it("cancels a retained archive read without replacing the cancellation reason", async () => {
  const controller = new AbortController(), failure = new Error("cancelled");
  await expect(readOdf({ size: 100, async read() {
    controller.abort(failure); return new Uint8Array(100);
  } }, { ...context, signal: controller.signal })).rejects.toBe(failure);
});

it.each([["UTF-8", false], ["UTF-8", true], ["UTF-16LE", true], ["UTF-16BE", true]] as const)("decodes %s XML (mimetype: %s) in bounded chunks from a reused range source", async (encoding, includeMime) => {
  const { createZipCodec } = await import("@poe-code/office-package");
  const { vi } = await import("vitest");
  const zip = createZipCodec(), signal = context.signal;
  const limits = { maxArchiveBytes: Infinity, maxEntryBytes: Infinity, maxTotalBytes: Infinity,
    maxMembers: Infinity, maxPathBytes: Infinity, maxDepth: Infinity, maxPaxBytes: Infinity, maxTextBytes: Infinity, chunkSize: 16384 };
  const text = "value😀".repeat(10000);
  const xml = '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Sheet1"><table:table-row><table:table-cell office:value-type="string"><text:p>' + text + '</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>';
  let content = new TextEncoder().encode(xml);
  if (encoding !== "UTF-8") {
    content = new Uint8Array(xml.length * 2 + 2);
    const view = new DataView(content.buffer), little = encoding === "UTF-16LE";
    view.setUint16(0, 0xfeff, little);
    for (let i = 0; i < xml.length; i++) view.setUint16(2 + i * 2, xml.charCodeAt(i), little);
  }
  const entry = await zip.makeZipEntry("content.xml", content, { modified: new Date(0), mode: 0o100644, directory: false, symlink: false, compression: "store" }, limits, signal);
  const mime = await zip.makeZipEntry("mimetype", new TextEncoder().encode("application/vnd.oasis.opendocument.spreadsheet"), { modified: new Date(0), mode: 0o100644, directory: false, symlink: false, compression: "store" }, limits, signal);
  const bytes = await zip.writeZipArchive({ entries: includeMime ? [mime, entry] : [entry], comment: new Uint8Array() }, limits, signal);
  const decode = TextDecoder.prototype.decode;
  let maximum = 0;
  const spy = vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function(this: TextDecoder, input, options) {
    maximum = Math.max(maximum, input?.byteLength ?? 0);
    return decode.call(this, input, options);
  });
  const reused = new Uint8Array(257);
  try {
    const source = { size: bytes.length, async read(position: number, maximum: number) {
      const length = Math.min(maximum, reused.length, bytes.length - position);
      reused.set(bytes.subarray(position, position + length)); return reused.subarray(0, length);
    } };
    expect(await probeOdf(source, context)).toBe(true);
    const workbook = await readOdf(source, context);
    expect(workbook.sheets[0]!.cells[0]!.value).toEqual({ kind: "string", value: text });
    expect(maximum).toBeLessThanOrEqual(16384);
  } finally { spy.mockRestore(); }
});
