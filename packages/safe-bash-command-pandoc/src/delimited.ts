import type { Block, ColSpec, Row } from "./ast-types.js";
import { literalInlines } from "./literal-inlines.js";
import {DelimitedParser} from "./delimited-parser.js";
import type { ReaderCapability } from "./types.js";

/** Document readers share table admission; TSV deliberately has no quote syntax. */
export const readDelimited: ReaderCapability["read"] = async (input, context, selection) => {
  const format = selection?.descriptor.name === "tsv" ? "tsv" : "csv";
  const text = input.text ?? "";
  if (!text) return { blocks: [], metadata: {}, resources: [] };
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  const parser = new DelimitedParser(format, context, {
    async text(text) {field += text;},
    async field() {fields.push(field); field = "";},
    async record() {records.push(fields); fields = [];}
  });
  await parser.accept(text);
  await parser.finish();
  const width = parser.width;

  const rows: Row[] = [];
  let nodes = 1; // Table
  for (const record of records) {
    const cells: Row[1][number][] = [];
    for (let index = 0; index < width; index++) {
      await context.cooperate();
      context.charge("references", 1);
      context.charge("retainedBytes", 128);
      const value = record[index] ?? "";
      const inlines = await literalInlines(value, context, nodes);
      nodes += inlines.length;
      const blocks: Block[] = [];
      if (inlines.length) {
        context.bound("nodes", ++nodes);
        blocks.push({ t: "Plain", c: inlines });
      }
      cells.push([["", [], []], "AlignDefault", 1, 1, blocks]);
    }
    context.charge("references", 1);
    rows.push([["", [], []], cells]);
  }
  context.charge("references", width);
  context.charge("retainedBytes", width * 64);
  const specs: ColSpec[] = Array.from({ length: width }, () => ["AlignDefault", { t: "ColWidthDefault" }]);
  const head = rows.shift()!;
  return {
    blocks: [{ t: "Table", c: [["", [], []], [null, []], specs, [["", [], []], [head]], [[["", [], []], 0, [], rows]], [["", [], []], []]] }],
    metadata: {},
    resources: []
  };
};
