import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { Binary } from "./biff-binary.js";
import { biffNode, readBiffMetadata } from "./biff-metadata.js";
import { createBiffWriter, readBiff } from "./biff.js";
import type { Workbook } from "@poe-code/spreadsheet-ast";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
it.each([
  ["x&P!", { Left: "x&[PAGE]!", Middle: "", Right: "" }],
  ["&La&Lb&P ", { Left: "b&[PAGE] ", Middle: "", Right: "" }],
  ["prefix&Cmid&Llast", { Left: "last", Middle: "mid", Right: "" }],
  ["&Cone&Lleft&Ctwo", { Left: "left", Middle: "two", Right: "" }],
  ["&Lone&L", { Left: "", Middle: "", Right: "" }],
  ["&L&&L&C&P&N&Rright", { Left: "&L", Middle: "&[PAGE]&[PAGES]", Right: "right" }],
  ["a\0bc", { Left: "a", Middle: "", Right: "" }],
  ["&Ctail\0&P", { Left: "", Middle: "tail", Right: "" }],
  ["a&\0bc", { Left: "a", Middle: "", Right: "" }],
  ["a&Bc", { Left: "ac", Middle: "", Right: "" }],
  ["&Bbold&B&", { Left: "bold", Middle: "", Right: "" }],
  ["&P&N&D&T&F&A&Z", { Left: "&[PAGE]&[PAGES]&[DATE]&[TIME]&[FILE]&[TAB]&[PATH]", Middle: "", Right: "" }],
  ["&b&Q&0tail", { Left: "tail", Middle: "", Right: "" }],
  ["", { Left: "", Middle: "", Right: "" }]
] as const)("preserves native header/footer sections in %s", (text, expected) => {
  for (const revision of [2, 3, 4, 5, 7, 8]) {
    for (const [opcode, field] of [[0x14, "Header"], [0x15, "Footer"]] as const) {
      const prefix = revision >= 8 ? [text.length, 0, 0] : [text.length];
      const data = new Binary(new Uint8Array([...prefix, ...new TextEncoder().encode(text)]));
      const result = readBiffMetadata([{ opcode, offset: 0, data }], revision, 1252, context);
      const print = metadataNode(result.records.find(record => record.kind === "PrintInformation")!.data)!;
      expect(print.children.find(node => node.name === field)!.attributes, `${revision}/${field}`).toEqual(expected);
    }
  }
});

it.each([7, 8] as const)("keeps default and explicit center alignment in BIFF%i exports", async revision => {
  for (const title of [undefined, "Title &[PAGE]"]) {
    const book: Workbook = { sheets: [{ id: "s", name: "Data", cells: [], ...(title === undefined ? {} : {
      unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
        data: biffNode("PrintInformation", {}, "", [biffNode("Header", { Left: "", Middle: title, Right: "" })]) }]
    }) }] };
    const result = await readBiff(await createBiffWriter(revision)(book, [], context), context);
    const print = metadataNode(result.sheets[0]!.unsupportedRecords!.find(record => record.kind === "PrintInformation")!.data)!;
    expect(print.children.find(node => node.name === "Header")!.attributes).toEqual({ Left: "", Middle: title ?? "&[TAB]", Right: "" });
    expect(print.children.find(node => node.name === "Footer")!.attributes).toEqual({ Left: "", Middle: "Page &[PAGE]", Right: "" });
  }
});

it("keeps native centered defaults when header and footer records are absent", () => {
  for (const revision of [2, 3, 4, 5, 7, 8]) {
    const result = readBiffMetadata([{ opcode: 0x2b, offset: 0, data: new Binary(new Uint8Array([0, 0])) }], revision, 1252, context);
    const print = metadataNode(result.records.find(record => record.kind === "PrintInformation")!.data)!;
    expect(print.children.find(node => node.name === "Header")!.attributes).toEqual({ Left: "", Middle: "&[TAB]", Right: "" });
    expect(print.children.find(node => node.name === "Footer")!.attributes).toEqual({ Left: "", Middle: "Page &[PAGE]", Right: "" });
  }
});

it.each([7, 8] as const)("preserves imported header tokens without false loss warnings in BIFF%i", async revision => {
  const {biffString} = await import("./biff-write.js");
  for (const text of ["&A", "Page &P", "&Bbold&B", "&Lone&Ltwo"]) {
    const raw = biffString(text, revision, context, revision === 8 ? 2 : 1);
    const records = [0x14, 0x15].map(opcode => ({opcode, offset: 0, data: new Binary(raw)}));
    const imported = readBiffMetadata(records, revision, 1252, context);
    const retained = records.map(({opcode}) => ({source: "biff" as const, kind: opcode === 0x14 ? "HEADER" : "FOOTER",
      disposition: "retained" as const, data: {opcode, bytes: Array.from(raw, byte => byte.toString(16).padStart(2, "0")).join("")}}));
    const book: Workbook = {sheets: [{id: "s", name: "Data", cells: [], view: {printHeader: text, printFooter: text},
      unsupportedRecords: [...retained, ...imported.records]}]};
    const warnings: string[] = [];
    const result = await readBiff(await createBiffWriter(revision)(book, [], {...context, async diagnostic(d) {warnings.push(d.message);}}), context);
    expect(result.sheets[0]!.view?.printHeader).toBe(text);
    expect(result.sheets[0]!.view?.printFooter).toBe(text);
    expect(warnings).toEqual([]);
    const edited: Workbook = {sheets: [{...book.sheets[0]!, unsupportedRecords: [...retained, {source: "Gnumeric_XmlIO:sax", kind: "PrintInformation", disposition: "retained",
      data: biffNode("PrintInformation", {}, "", [biffNode("Header", {Left: "Changed", Middle: "", Right: ""})])}]}]};
    const changed = await readBiff(await createBiffWriter(revision)(edited, [], context), context);
    expect(changed.sheets[0]!.view?.printHeader).toBe("&LChanged");
  }
});
