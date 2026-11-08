import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { Binary } from "./biff-binary.js";
import { readBiffMetadata } from "./biff-metadata.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 2, operations: 10000 } };
// The unchanged native BIFF reader enables these fields only for word 1.
// Words 2/3/256/65535 are the independently tested negative controls.
it.each([[0, "0"], [1, "1"], [2, "0"], [3, "0"], [256, "0"], [65535, "0"]] as const)(
  "imports print-flag word %i as %s", (word, expected) => {
    for (const revision of [2, 3, 4, 5, 7, 8]) {
      for (const [opcode, field] of [[0x2a, "titles"], [0x2b, "grid"], [0x83, "hcenter"], [0x84, "vcenter"]] as const) {
        const data = new Uint8Array(2); new DataView(data.buffer).setUint16(0, word, true);
        const result = readBiffMetadata([{ opcode, offset: 0, data: new Binary(data) }], revision, 1252, context);
        const print = metadataNode(result.records.find(record => record.kind === "PrintInformation")!.data);
        expect(print!.children.find(node => node.name === field)!.attributes.value, `${revision}/${field}`).toBe(expected);
      }
    }
  }
);
