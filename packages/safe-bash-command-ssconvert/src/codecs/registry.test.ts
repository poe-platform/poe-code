import { expect, it } from "vitest";
import { createRegistry, sourceServices, type Codec } from "../codecs.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100, outputBytes: 100, cells: 1, sheets: 1, operations: 10 },
  own() {}
};
const read: NonNullable<Codec["read"]> = async () => ({ sheets: [] });
const write: NonNullable<Codec["write"]> = async () => new Uint8Array();
it("uses native plugin Unicode filename folding without accepting longer suffixes", async () => {
  const registry = createRegistry([
    { id: "content-first", description: "fixture", extensions: [], read,
      probePriority: 100, probeContent: () => true },
    { id: "Gnumeric_lotus:lotus", description: "fixture", extensions: [], read,
      probeContent: () => true }
  ]);
  expect((await registry.probe(new Uint8Array([7]), "book.WK1", context))?.id)
    .toBe("Gnumeric_lotus:lotus");
  expect((await registry.probe(new Uint8Array([7]), "book.wK1", context))?.id)
    .toBe("Gnumeric_lotus:lotus");
  expect((await registry.probe(new Uint8Array([7]), "book.wK1x", context))?.id)
    .toBe("content-first");
});
function saver(id: string): Codec {
  return { id, description: "Injected fixture implementation", extensions: [], write };
}

// Independently transcribed source registration sequence and outcomes. These
// expectations are never derived from sourceServices or registry enumeration.
it.each([
  ["xls", ["Gnumeric_Excel:excel_biff8", "Gnumeric_Excel:excel_biff7", "Gnumeric_Excel:excel_dsf"], "Gnumeric_Excel:excel_biff8"],
  ["xlsx", ["Gnumeric_Excel:xlsx", "Gnumeric_Excel:xlsx2"], "Gnumeric_Excel:xlsx2"],
  ["ods", ["Gnumeric_OpenCalc:openoffice", "Gnumeric_OpenCalc:odf"], "Gnumeric_OpenCalc:odf"],
  ["html", ["Gnumeric_html:html32", "Gnumeric_html:html40", "Gnumeric_html:html40frag", "Gnumeric_html:latex", "Gnumeric_html:latex_table", "Gnumeric_html:latex_table_visible", "Gnumeric_html:roff", "Gnumeric_html:xhtml", "Gnumeric_html:xhtml_range"], "Gnumeric_html:xhtml"],
  ["tex", ["Gnumeric_html:latex", "Gnumeric_html:latex_table", "Gnumeric_html:latex_table_visible"], "Gnumeric_html:latex_table_visible"],
  ["xml", ["Gnumeric_XmlIO:sax", "Gnumeric_XmlIO:sax:0"], "Gnumeric_XmlIO:sax:0"]
] as const)("selects the native competing .%s saver", (suffix, ids, expected) => {
  const registry = createRegistry(ids.map(saver));
  expect(registry.select("write", undefined, `/dir.dot/file.${suffix}`)?.id).toBe(expected);
  expect(registry.select("write", ids[0], "different.unknown")?.id).toBe(ids[0]);
  expect(registry.select("write", undefined, `file.${suffix.toUpperCase()}`)).toBeUndefined();
  expect(registry.select("write", undefined, "/dir.dot/file")).toBeUndefined();
});

it("prefers a validated name match over higher-priority content-only match", async () => {
  const calls: string[] = [];
  const codec = (id: string, priority: number, name: boolean, content: boolean): Codec => ({
    id, description: id, extensions: [], probePriority: priority, read,
    probeName() { calls.push(`${id}:name`); return name; },
    probeContent() { calls.push(`${id}:content`); return content; }
  });
  const registry = createRegistry([codec("low", 1, true, true), codec("high", 100, false, true)]);
  expect((await registry.probe(new Uint8Array([1]), "file.xlsx", context))?.id).toBe("low");
  expect(calls).toEqual(["high:name", "low:name", "low:content"]);
});

it("rejects a misleading name then retries content in priority order", async () => {
  const calls: string[] = [];
  const registry = createRegistry([
    { id: "bad", description: "bad", extensions: [], read, probePriority: 100,
      probeName: () => true, probeContent() { calls.push("bad"); return false; } },
    { id: "good", description: "good", extensions: [], read, probePriority: 1,
      probeContent() { calls.push("good"); return true; } }
  ]);
  expect((await registry.probe(new Uint8Array([7]), "file.xlsx", context))?.id).toBe("good");
  expect(calls).toEqual(["bad", "bad", "good"]);
});

it("uses case-insensitive native opener suffixes but requires installed content validation", async () => {
  const registry = createRegistry([{ id: "Gnumeric_Excel:xlsx", description: "fixture", extensions: [], read,
    probeContent: (bytes) => bytes[0] === 7 }]);
  expect((await registry.probe(new Uint8Array([7]), "FILE.XLSX", context))?.id).toBe("Gnumeric_Excel:xlsx");
  expect(await registry.probe(new Uint8Array([1]), "FILE.XLSX", context)).toBeUndefined();
  const noProbe = createRegistry([{ id: "Gnumeric_Excel:xlsx", description: "fixture", extensions: [], read }]);
  expect(await noProbe.probe(new Uint8Array([7]), "file.xlsx", context)).toBeUndefined();
});

it("recognizes the native compound .xml.gz name probe before content-only competitors", async () => {
  const registry = createRegistry([
    { id: "high", description: "High fixture", extensions: [], read, probePriority: 100, probeContent: () => true },
    { id: "Gnumeric_XmlIO:sax", description: "XML fixture", extensions: [], read, probeContent: () => true }
  ]);
  expect((await registry.probe(new Uint8Array([7]), "file.XML.GZ", context))?.id).toBe("Gnumeric_XmlIO:sax");
  expect((await registry.probe(new Uint8Array([7]), "/dir.xml.gz/file.gz", context))?.id).toBe("high");
});

it("lists only installed noninteractive services, keeping STF importer and exporter distinct", () => {
  const registry = createRegistry([
    saver("Gnumeric_stf:stf_assistant"), saver("Gnumeric_OpenCalc:openoffice")
  ]);
  expect(registry.list("read").map(service => service.id)).toEqual(["Gnumeric_Excel:excel", "Gnumeric_Excel:excel_enc", "Gnumeric_Excel:excel_xml", "Gnumeric_Excel:xlsx", "Gnumeric_OpenCalc:openoffice", "Gnumeric_QPro:qpro", "Gnumeric_XmlIO:sax", "Gnumeric_applix:applix", "Gnumeric_dif:dif", "Gnumeric_html:html", "Gnumeric_lotus:lotus", "Gnumeric_mps:mps", "Gnumeric_oleo:oleo", "Gnumeric_paradox:paradox", "Gnumeric_plan_perfect:pln", "Gnumeric_psiconv:psiconv", "Gnumeric_sc:sc", "Gnumeric_stf:stf_csvtab", "Gnumeric_sylk:sylk", "Gnumeric_xbase:xbase"]);
  expect(registry.list("write").map((service) => service.id)).toEqual(["Gnumeric_Excel:excel_biff7", "Gnumeric_Excel:excel_biff8", "Gnumeric_Excel:excel_dsf", "Gnumeric_Excel:xlsx", "Gnumeric_Excel:xlsx2", "Gnumeric_GnomeGlossary:po", "Gnumeric_OpenCalc:odf", "Gnumeric_OpenCalc:openoffice", "Gnumeric_XmlIO:sax", "Gnumeric_XmlIO:sax:0", "Gnumeric_dif:dif", "Gnumeric_glpk:glpk", "Gnumeric_html:html32", "Gnumeric_html:html40", "Gnumeric_html:html40frag", "Gnumeric_html:latex", "Gnumeric_html:latex_table", "Gnumeric_html:latex_table_visible", "Gnumeric_html:roff", "Gnumeric_html:xhtml", "Gnumeric_html:xhtml_range", "Gnumeric_lpsolve:lpsolve", "Gnumeric_paradox:paradox", "Gnumeric_pdf:pdf_assistant", "Gnumeric_stf:stf_assistant", "Gnumeric_stf:stf_csv", "Gnumeric_sylk:sylk"]);
  expect(registry.coverage().filter((service) => service.installed)).toHaveLength(48);
  expect(createRegistry([]).list("write").map(service => service.id)).toEqual(["Gnumeric_Excel:excel_biff7", "Gnumeric_Excel:excel_biff8", "Gnumeric_Excel:excel_dsf", "Gnumeric_Excel:xlsx", "Gnumeric_Excel:xlsx2", "Gnumeric_GnomeGlossary:po", "Gnumeric_OpenCalc:odf", "Gnumeric_OpenCalc:openoffice", "Gnumeric_XmlIO:sax", "Gnumeric_XmlIO:sax:0", "Gnumeric_dif:dif", "Gnumeric_glpk:glpk", "Gnumeric_html:html32", "Gnumeric_html:html40", "Gnumeric_html:html40frag", "Gnumeric_html:latex", "Gnumeric_html:latex_table", "Gnumeric_html:latex_table_visible", "Gnumeric_html:roff", "Gnumeric_html:xhtml", "Gnumeric_html:xhtml_range", "Gnumeric_lpsolve:lpsolve", "Gnumeric_paradox:paradox", "Gnumeric_pdf:pdf_assistant", "Gnumeric_stf:stf_assistant", "Gnumeric_stf:stf_csv", "Gnumeric_sylk:sylk"]);
  expect(sourceServices).toHaveLength(48);
  expect(createRegistry([]).coverage().filter(service => service.installed).map(service => [service.id, service.direction]))
    .toEqual([["Gnumeric_applix:applix", "read"], ["Gnumeric_dif:dif", "read"], ["Gnumeric_dif:dif", "write"],
      ["Gnumeric_Excel:excel", "read"], ["Gnumeric_Excel:excel_biff8", "write"], ["Gnumeric_Excel:excel_biff7", "write"], ["Gnumeric_Excel:excel_dsf", "write"], ["Gnumeric_Excel:excel_xml", "read"], ["Gnumeric_Excel:xlsx", "read"], ["Gnumeric_Excel:xlsx", "write"], ["Gnumeric_Excel:xlsx2", "write"], ["Gnumeric_Excel:excel_enc", "read"], ["Gnumeric_glpk:glpk", "write"], ["Gnumeric_GnomeGlossary:po", "write"], ["Gnumeric_html:html", "read"], ["Gnumeric_html:html32", "write"], ["Gnumeric_html:html40", "write"], ["Gnumeric_html:html40frag", "write"], ["Gnumeric_html:xhtml", "write"], ["Gnumeric_html:xhtml_range", "write"], ["Gnumeric_html:latex", "write"], ["Gnumeric_html:latex_table", "write"], ["Gnumeric_html:latex_table_visible", "write"], ["Gnumeric_html:roff", "write"], ["Gnumeric_lotus:lotus", "read"], ["Gnumeric_lpsolve:lpsolve", "write"], ["Gnumeric_mps:mps", "read"], ["Gnumeric_oleo:oleo", "read"], ["Gnumeric_OpenCalc:openoffice", "read"], ["Gnumeric_OpenCalc:openoffice", "write"], ["Gnumeric_OpenCalc:odf", "write"], ["Gnumeric_paradox:paradox", "read"], ["Gnumeric_paradox:paradox", "write"], ["Gnumeric_pdf:pdf_assistant", "write"], ["Gnumeric_plan_perfect:pln", "read"], ["Gnumeric_psiconv:psiconv", "read"], ["Gnumeric_QPro:qpro", "read"], ["Gnumeric_sc:sc", "read"], ["Gnumeric_stf:stf_csvtab", "read"], ["Gnumeric_stf:stf_assistant", "read"],
      ["Gnumeric_stf:stf_assistant", "write"], ["Gnumeric_stf:stf_csv", "write"],
      ["Gnumeric_sylk:sylk", "read"], ["Gnumeric_sylk:sylk", "write"],
      ["Gnumeric_xbase:xbase", "read"], ["Gnumeric_XmlIO:sax", "read"], ["Gnumeric_XmlIO:sax", "write"], ["Gnumeric_XmlIO:sax:0", "write"]]);
});

it("preserves probe bytes across hostile mutation and cancellation reason identity", async () => {
  const controller = new AbortController();
  const reason = { cancellation: true };
  const bytes = new Uint8Array([7]);
  const registry = createRegistry([
    { id: "mutator", description: "mutator", extensions: [], read, probePriority: 100,
      probeContent(input) { input[0] = 0; return false; } },
    { id: "accept", description: "accept", extensions: [], read, probePriority: 1,
      probeContent: (input) => input[0] === 7 }
  ]);
  expect((await registry.probe(bytes, undefined, context))?.id).toBe("accept");
  expect(bytes[0]).toBe(7);
  const cancelled = createRegistry([{ id: "cancel", description: "cancel", extensions: [], read,
    probeContent() { controller.abort(reason); return true; } }]);
  await expect(cancelled.probe(bytes, undefined, { ...context, signal: controller.signal })).rejects.toBe(reason);
});

it("rejects duplicate implementations within a direction", () => {
  expect(() => createRegistry([saver("same"), saver("same")])).toThrow("Duplicate or empty codec ID: same");
});

it("retains source filename for empty-file probing through the public registry", async () => {
  expect((await createRegistry([]).probe(new Uint8Array(), "empty.CSV", context))?.id).toBe("Gnumeric_stf:stf_csvtab");
  expect(await createRegistry([]).probe(new Uint8Array(), "empty.bin", context)).toBeUndefined();
});

it("admits direct discovery bytes against the injected budget before copying or probing", async () => {
  let calls = 0;
  const registry = createRegistry([{ id: "fixture", description: "fixture", extensions: [], read,
    probeContent() { calls++; return true; } }]);
  await expect(registry.probe(new Uint8Array([1, 2]), undefined,
    { ...context, limits: { ...context.limits, inputBytes: 1 } })).rejects.toMatchObject({
    code: "resource-limit", message: "ssconvert input bytes limit exceeded"
  });
  expect(calls).toBe(0);
});

it("owns direct caller bytes before awaiting a probe", async () => {
  const bytes = new Uint8Array([7]);
  const registry = createRegistry([
    { id: "first", description: "first", extensions: [], read, probePriority: 100, probeContent: async () => false },
    { id: "second", description: "second", extensions: [], read, probePriority: 1, probeContent: (input) => input[0] === 7 }
  ]);
  const discovery = registry.probe(bytes, undefined, context);
  bytes[0] = 0;
  expect((await discovery)?.id).toBe("second");
});
