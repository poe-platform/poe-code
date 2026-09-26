import type { Block, ColSpec, Inline, Row } from "./ast-types.js";
import { PandocError } from "./errors.js";
import type { ReaderCapability } from "./types.js";

/** Document readers share table admission; TSV deliberately has no quote syntax. */
export const readDelimited: ReaderCapability["read"] = async (input, context, selection) => {
  const format = selection?.descriptor.name === "tsv" ? "tsv" : "csv";
  const text = input.text ?? "";
  if (!text) return { blocks: [], metadata: {}, resources: [] };
  const delimiter = format === "csv" ? "," : "\t";
  const records: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let active = false;
  let width = 0;
  let line = 1;
  let column = 1;
  let work = 0;
  const fail = (message: string): never => {
    throw new PandocError("E_PARSE", "read", message, format, `${line}:${column}`);
  };
  const append = (char: string): void => {
    context.bound("tableFieldText", field.length + char.length);
    context.charge("retainedBytes", char.length * 2);
    field += char;
  };
  const endField = (): void => {
    context.bound("tableColumns", fields.length + 1);
    context.charge("references", 1);
    fields.push(field);
    field = "";
    state = "start";
  };
  const endRecord = (): void => {
    context.bound("tableRows", records.length + 1);
    endField();
    width = Math.max(width, fields.length);
    // Include padding before retaining or allocating any rectangular AST rows.
    context.bound("tableCells", (records.length + 1) * width);
    context.charge("references", 1);
    records.push(fields);
    fields = [];
    active = false;
  };
  for (const char of text) {
    context.checkpoint();
    context.bound("tableRows", records.length + 1);
    context.bound("tableColumns", fields.length + 1);
    active = true;
    if (state === "quoted") {
      if (char === '"') state = "closed";
      else append(char);
    } else if (state === "closed" && char === '"') {
      append('"');
      state = "quoted";
    } else if (char === delimiter) {
      context.bound("tableColumns", fields.length + 2);
      context.bound("tableCells", (records.length + 1) * Math.max(width, fields.length + 2));
      endField();
    } else if (char === "\n") {
      endRecord();
    } else if (format === "csv" && char === '"' && state === "start") {
      state = "quoted";
    } else {
      if (format === "csv" && (char === '"' || state === "closed"))
        fail("CSV quotes must enclose the entire field");
      append(char);
      state = "plain";
    }
    if (char === "\n") { line++; column = 1; }
    else column++;
    if (++work % 256 === 0) await context.cooperate(0);
  }
  if (state === "quoted") fail("Unterminated quoted CSV field");
  if (active) endRecord();

  const rows: Row[] = [];
  let nodes = 1; // Table
  for (const record of records) {
    const cells: Row[1][number][] = [];
    for (let index = 0; index < width; index++) {
      await context.cooperate();
      context.charge("references", 1);
      context.charge("retainedBytes", 128);
      const value = record[index] ?? "";
      const inlines: Inline[] = [];
      let start = 0;
      // Spaces and embedded newlines get text constructors, never Markdown parsing.
      for (let offset = 0; offset <= value.length; offset++) {
        context.checkpoint();
        const char = value[offset];
        if (offset === value.length || char === " " || char === "\n") {
          if (offset > start) {
            context.bound("nodes", ++nodes);
            context.charge("references", 1);
            context.charge("retainedBytes", (offset - start) * 2 + 32);
            inlines.push({ t: "Str", c: value.slice(start, offset) });
          }
          if (char === " " || char === "\n") {
            context.bound("nodes", ++nodes);
            context.charge("references", 1);
            context.charge("retainedBytes", 32);
            inlines.push({ t: char === " " ? "Space" : "LineBreak" });
          }
          start = offset + 1;
        }
        if (offset % 256 === 255) await context.cooperate(0);
      }
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
