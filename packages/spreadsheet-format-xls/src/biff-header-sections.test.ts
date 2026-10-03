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
