import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import type { CapabilityContext } from "../contracts.js";
import { createRegistry } from "./registry.js";
import type { Codec } from "./types.js";

const read: NonNullable<Codec["read"]> = async () => ({ sheets: [] });
const write: NonNullable<Codec["write"]> = async () => new Uint8Array();
function context(signal = new AbortController().signal): CapabilityContext {
  return {
    signal,
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 1024, outputBytes: 1024, cells: 100, sheets: 10, operations: 100 },
    own() {}
  };
}
function opener(id: string, overrides: Partial<Codec> = {}): Codec {
  return { id, description: id, extensions: [], read, ...overrides };
}

it("preserves cancellation even when no opener is installed", async () => {
  const controller = new AbortController();
  const reason = { cancellation: "empty-registry" };
  controller.abort(reason);
  await expect(createRegistry([]).probe(new Uint8Array(), "a.xls", context(controller.signal)))
    .rejects.toBe(reason);
});

it("runs the entire name pass before falling back to higher-priority content probes", async () => {
  const calls: string[] = [];
  const registry = createRegistry([
    opener("high", { probePriority: 100, probeName: () => { calls.push("high:name"); return false; },
      probeContent: () => { calls.push("high:content"); return true; } }),
    opener("low", { probePriority: 1, probeName: () => { calls.push("low:name"); return true; },
      probeContent: () => { calls.push("low:content"); return true; } })
  ]);
  expect((await registry.probe(new Uint8Array([1]), "a.ods", context()))?.id).toBe("low");
  expect(calls).toEqual(["high:name", "low:name", "low:content"]);
});

it("orders content-only probes by descending priority with stable registration ties", async () => {
  const calls: string[] = [];
  const registry = createRegistry([
    opener("low", { probePriority: 1, probeContent: () => { calls.push("low"); return true; } }),
    opener("first", { probePriority: 100, probeContent: () => { calls.push("first"); return false; } }),
    opener("second", { probePriority: 100, probeContent: () => { calls.push("second"); return true; } })
  ]);
  expect((await registry.probe(new Uint8Array([1]), undefined, context()))?.id).toBe("second");
  expect(calls).toEqual(["first", "second"]);
});

it("does not cache a failed name-pass content observation", async () => {
  let calls = 0;
  const registry = createRegistry([opener("retry", { probeName: () => true, probeContent: () => ++calls === 2 })]);
  expect((await registry.probe(new Uint8Array([1]), "a.xls", context()))?.id).toBe("retry");
  expect(calls).toBe(2);
});

it("gives every content callback owned bytes, including cross-realm input", async () => {
  const bytes = runInNewContext("new Uint8Array([7, 8])") as Uint8Array;
  const seen: number[][] = [];
  const registry = createRegistry([
    opener("mutating", { probePriority: 100, probeContent: (input) => {
      seen.push([...input]); input.fill(0); return false;
    } }),
    opener("observing", { probePriority: 1, probeContent: (input) => {
      seen.push([...input]); return input[0] === 7;
    } })
  ]);
  expect((await registry.probe(bytes, undefined, context()))?.id).toBe("observing");
  expect(seen).toEqual([[7, 8], [7, 8]]);
  expect([...bytes]).toEqual([7, 8]);
});

it("preserves cancellation after an asynchronous positive callback", async () => {
  const controller = new AbortController();
  const reason = { cancellation: "callback" };
  const registry = createRegistry([opener("async", { probeContent: async () => {
    await Promise.resolve(); controller.abort(reason); return true;
  } })]);
  await expect(registry.probe(new Uint8Array([1]), undefined, context(controller.signal))).rejects.toBe(reason);
});

it("requires implemented content probes for installed source content-probing importers", async () => {
  const registry = createRegistry([opener("Gnumeric_Excel:xlsx", { probeName: () => true })]);
  expect(await registry.probe(new Uint8Array([1]), "a.xlsx", context())).toBeUndefined();
  expect(registry.select("read", "Gnumeric_Excel:xlsx")?.id).toBe("Gnumeric_Excel:xlsx");
});

it("uses declarative XML compound suffixes in the name pass without guessing compressed extensions", async () => {
  const registry = createRegistry([
    opener("content-first", { probePriority: 100, probeName: () => false, probeContent: () => true }),
    opener("Gnumeric_XmlIO:sax", { probeContent: () => true })
  ]);
  expect((await registry.probe(new Uint8Array([1]), "/dir.with.dots/book.xml.gz", context()))?.id)
    .toBe("Gnumeric_XmlIO:sax");
  expect((await registry.probe(new Uint8Array([1]), "/dir.with.dots/book.gnumeric.gz", context()))?.id)
    .toBe("content-first");
  expect((await registry.probe(new Uint8Array([1]), "/book.xml.gz/unrelated", context()))?.id)
    .toBe("content-first");
});

it("keeps installed availability directional and source coverage distinct from listings", () => {
  const registry = createRegistry([opener("Gnumeric_OpenCalc:openoffice")]);
  expect(registry.list("read").map((entry) => entry.id)).toEqual(["Gnumeric_Excel:excel", "Gnumeric_Excel:excel_enc", "Gnumeric_Excel:excel_xml", "Gnumeric_Excel:xlsx", "Gnumeric_OpenCalc:openoffice", "Gnumeric_QPro:qpro", "Gnumeric_XmlIO:sax", "Gnumeric_applix:applix", "Gnumeric_dif:dif", "Gnumeric_html:html", "Gnumeric_lotus:lotus", "Gnumeric_mps:mps", "Gnumeric_oleo:oleo", "Gnumeric_paradox:paradox", "Gnumeric_plan_perfect:pln", "Gnumeric_psiconv:psiconv", "Gnumeric_sc:sc", "Gnumeric_stf:stf_csvtab", "Gnumeric_sylk:sylk", "Gnumeric_xbase:xbase"]);
  expect(registry.list("write").map(entry => entry.id)).toEqual(["Gnumeric_Excel:excel_biff7", "Gnumeric_Excel:excel_biff8", "Gnumeric_Excel:excel_dsf", "Gnumeric_Excel:xlsx", "Gnumeric_Excel:xlsx2", "Gnumeric_GnomeGlossary:po", "Gnumeric_OpenCalc:odf", "Gnumeric_OpenCalc:openoffice", "Gnumeric_XmlIO:sax", "Gnumeric_XmlIO:sax:0", "Gnumeric_dif:dif", "Gnumeric_glpk:glpk", "Gnumeric_html:html32", "Gnumeric_html:html40", "Gnumeric_html:html40frag", "Gnumeric_html:latex", "Gnumeric_html:latex_table", "Gnumeric_html:latex_table_visible", "Gnumeric_html:roff", "Gnumeric_html:xhtml", "Gnumeric_html:xhtml_range", "Gnumeric_lpsolve:lpsolve", "Gnumeric_paradox:paradox", "Gnumeric_pdf:pdf_assistant", "Gnumeric_stf:stf_assistant", "Gnumeric_stf:stf_csv", "Gnumeric_sylk:sylk"]);
  expect(registry.coverage().filter((entry) => entry.installed).map(({ id, direction }) => ({ id, direction })))
    .toEqual([{ id: "Gnumeric_applix:applix", direction: "read" }, { id: "Gnumeric_dif:dif", direction: "read" }, { id: "Gnumeric_dif:dif", direction: "write" },
      { id: "Gnumeric_Excel:excel", direction: "read" }, { id: "Gnumeric_Excel:excel_biff8", direction: "write" }, { id: "Gnumeric_Excel:excel_biff7", direction: "write" }, { id: "Gnumeric_Excel:excel_dsf", direction: "write" }, { id: "Gnumeric_Excel:excel_xml", direction: "read" }, { id: "Gnumeric_Excel:xlsx", direction: "read" }, { id: "Gnumeric_Excel:xlsx", direction: "write" }, { id: "Gnumeric_Excel:xlsx2", direction: "write" }, { id: "Gnumeric_Excel:excel_enc", direction: "read" }, { id: "Gnumeric_glpk:glpk", direction: "write" }, { id: "Gnumeric_GnomeGlossary:po", direction: "write" }, { id: "Gnumeric_html:html", direction: "read" }, { id: "Gnumeric_html:html32", direction: "write" }, { id: "Gnumeric_html:html40", direction: "write" }, { id: "Gnumeric_html:html40frag", direction: "write" }, { id: "Gnumeric_html:xhtml", direction: "write" }, { id: "Gnumeric_html:xhtml_range", direction: "write" }, { id: "Gnumeric_html:latex", direction: "write" }, { id: "Gnumeric_html:latex_table", direction: "write" }, { id: "Gnumeric_html:latex_table_visible", direction: "write" }, { id: "Gnumeric_html:roff", direction: "write" }, { id: "Gnumeric_lotus:lotus", direction: "read" }, { id: "Gnumeric_lpsolve:lpsolve", direction: "write" }, { id: "Gnumeric_mps:mps", direction: "read" }, { id: "Gnumeric_oleo:oleo", direction: "read" }, { id: "Gnumeric_OpenCalc:openoffice", direction: "read" }, { id: "Gnumeric_OpenCalc:openoffice", direction: "write" }, { id: "Gnumeric_OpenCalc:odf", direction: "write" }, { id: "Gnumeric_paradox:paradox", direction: "read" }, { id: "Gnumeric_paradox:paradox", direction: "write" }, { id: "Gnumeric_pdf:pdf_assistant", direction: "write" }, { id: "Gnumeric_plan_perfect:pln", direction: "read" }, { id: "Gnumeric_psiconv:psiconv", direction: "read" }, { id: "Gnumeric_QPro:qpro", direction: "read" }, { id: "Gnumeric_sc:sc", direction: "read" },
      { id: "Gnumeric_stf:stf_csvtab", direction: "read" }, { id: "Gnumeric_stf:stf_assistant", direction: "read" },
      { id: "Gnumeric_stf:stf_assistant", direction: "write" }, { id: "Gnumeric_stf:stf_csv", direction: "write" },
      { id: "Gnumeric_sylk:sylk", direction: "read" }, { id: "Gnumeric_sylk:sylk", direction: "write" },
      { id: "Gnumeric_xbase:xbase", direction: "read" }, { id: "Gnumeric_XmlIO:sax", direction: "read" }, { id: "Gnumeric_XmlIO:sax", direction: "write" }, { id: "Gnumeric_XmlIO:sax:0", direction: "write" }]);
  expect(registry.coverage().find((entry) => entry.id === "Gnumeric_Excel:xlsx" && entry.direction === "read")?.installed).toBe(true);
  expect(registry.coverage().find((entry) => entry.id === "Gnumeric_Excel:xlsx" && entry.direction === "write")?.installed).toBe(true);
});

it("separates the interactive STF importer from its noninteractive saver", async () => {
  const registry = createRegistry([
    { id: "Gnumeric_stf:stf_assistant", description: "saver", extensions: [], write }
  ]);
  expect(registry.list("read").map(entry => entry.id)).toEqual(["Gnumeric_Excel:excel", "Gnumeric_Excel:excel_enc", "Gnumeric_Excel:excel_xml", "Gnumeric_Excel:xlsx", "Gnumeric_OpenCalc:openoffice", "Gnumeric_QPro:qpro", "Gnumeric_XmlIO:sax", "Gnumeric_applix:applix", "Gnumeric_dif:dif", "Gnumeric_html:html", "Gnumeric_lotus:lotus", "Gnumeric_mps:mps", "Gnumeric_oleo:oleo", "Gnumeric_paradox:paradox", "Gnumeric_plan_perfect:pln", "Gnumeric_psiconv:psiconv", "Gnumeric_sc:sc", "Gnumeric_stf:stf_csvtab", "Gnumeric_sylk:sylk", "Gnumeric_xbase:xbase"]);
  expect(registry.list("write").map((entry) => entry.id)).toEqual(["Gnumeric_Excel:excel_biff7", "Gnumeric_Excel:excel_biff8", "Gnumeric_Excel:excel_dsf", "Gnumeric_Excel:xlsx", "Gnumeric_Excel:xlsx2", "Gnumeric_GnomeGlossary:po", "Gnumeric_OpenCalc:odf", "Gnumeric_OpenCalc:openoffice", "Gnumeric_XmlIO:sax", "Gnumeric_XmlIO:sax:0", "Gnumeric_dif:dif", "Gnumeric_glpk:glpk", "Gnumeric_html:html32", "Gnumeric_html:html40", "Gnumeric_html:html40frag", "Gnumeric_html:latex", "Gnumeric_html:latex_table", "Gnumeric_html:latex_table_visible", "Gnumeric_html:roff", "Gnumeric_html:xhtml", "Gnumeric_html:xhtml_range", "Gnumeric_lpsolve:lpsolve", "Gnumeric_paradox:paradox", "Gnumeric_pdf:pdf_assistant", "Gnumeric_stf:stf_assistant", "Gnumeric_stf:stf_csv", "Gnumeric_sylk:sylk"]);
  expect(await registry.probe(new Uint8Array([1]), "a.txt", context())).toBeUndefined();
});

it("owns and freezes installed extension metadata rather than retaining host arrays", () => {
  const extensions = ["csv"];
  const supplied = { id: "custom", description: "Custom", extensions, write };
  const registry = createRegistry([supplied]);
  extensions[0] = "xlsx";
  supplied.description = "Changed";
  expect(registry.select("write", undefined, "a.csv")?.id).toBe("custom");
  expect(registry.select("write", undefined, "a.xlsx")?.id).toBe("Gnumeric_Excel:xlsx2");
  const list = registry.list("write");
  const custom = list.find(entry => entry.id === "custom");
  expect(custom?.description).toBe("Custom");
  expect(Object.isFrozen(list)).toBe(true);
  expect(Object.isFrozen(custom)).toBe(true);
  expect(Object.isFrozen(custom?.extensions)).toBe(true);
});
