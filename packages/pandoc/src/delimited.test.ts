import { describe, expect, it, vi } from "vitest";
import { convert, createFormatInspectionCommand, createFormatRegistry, readDocument } from "./index.js";
import type { Block, Cell, ConversionContext, Inline, Row } from "./index.js";

const encode = (text: string) => new TextEncoder().encode(text);
const immediate = async () => {};
const read = (text: string, from = "csv", context: ConversionContext = {}) =>
  readDocument({ bytes: encode(text) }, { from }, { yield: immediate, ...context });
const attr = ["", [], []] as const;
const str = (c: string): Inline => ({ t: "Str", c });
const cell = (c: readonly Inline[] = []): Cell => [attr, "AlignDefault", 1, 1, c.length ? [{ t: "Plain", c }] : []];
const row = (...values: string[]): Row => [attr, values.map((value) => cell(value ? [str(value)] : []))];
function table(head: Row, body: readonly Row[], columns = head[1].length): Block {
  return { t: "Table", c: [attr, [null, []], Array.from({ length: columns }, () => ["AlignDefault", { t: "ColWidthDefault" }]), [attr, [head]], [[attr, 0, [], body]], [attr, []]] };
}

describe("original CSV and TSV document readers", () => {
  it.each(["csv", "tsv"])("registers %s through the SDK and thin inspection adapter", async (from) => {
    expect(createFormatRegistry().infer(`original.${from}`, "read")).toBe(from);
    expect(createFormatRegistry().list("read")).toContain(from);
    expect(createFormatRegistry().list("write")).not.toContain(from);
    const write = vi.fn(async (_bytes: Uint8Array) => {});
    await createFormatInspectionCommand().execute({ args: ["--list-input-formats"], signal: new AbortController().signal, stdout: { write }, stderr: { write: vi.fn() } });
    expect(new TextDecoder().decode(write.mock.calls[0]![0]).split("\n")).toContain(from);
    expect((await read("h\n0012\n=1+1\n+SUM(A1)\n-02\n@name\n1e9\n**literal**", from)).blocks).toEqual([table(row("h"), [row("0012"), row("=1+1"), row("+SUM(A1)"), row("-02"), row("@name"), row("1e9"), row("**literal**")])]);
  });
  it("decodes CSV commas, multiline quotes and doubled escapes", async () => {
    expect((await read('a,b\n"x,y","say ""hi"""\n"x\r\ny",z')).blocks).toEqual([table(row("a", "b"), [[attr, [cell([str("x,y")]), cell([str("say"), { t: "Space" }, str('"hi"')])]], [attr, [cell([str("x"), { t: "LineBreak" }, str("y")]), cell([str("z")])]]])]);
  });
  it("treats TSV quotes, doubled quotes and commas literally, including tabs inside quotes", async () => {
    expect((await read('a\tb\n"x,y"\t"say""hi"\n"x\ty"', "tsv")).blocks).toEqual([table(row("a", "b"), [row('"x,y"', '"say""hi"'), row('"x', 'y"')])]);
  });
  it.each(["csv", "tsv"])("defines empty input and every record termination for %s", async (from) => {
    const delimiter = from === "csv" ? "," : "\t";
    expect((await read("", from)).blocks).toEqual([]);
    expect((await read("\ufeff", from)).blocks).toEqual([]);
    expect((await read("\n", from)).blocks).toEqual([table(row(""), [])]);
    expect((await read("\n\nh\n\nx\n\n", from)).blocks).toEqual([table(row(""), [row(""), row("h"), row(""), row("x"), row("")])]);
    for (const ending of ["", "\n", "\r\n", "\r"]) {
      expect((await read(`h\r\nx${ending}`, from)).blocks).toEqual([table(row("h"), [row("x")])]);
      expect((await read(`h${ending}`, from)).blocks).toEqual([table(row("h"), [])]);
      expect((await read(`a${delimiter}b${delimiter}\nx${delimiter}${delimiter}${ending}`, from)).blocks).toEqual([table(row("a", "b", ""), [row("x", "", "")])]);
    }
    expect((await read(`a${delimiter}b\nx\ny${delimiter}z${delimiter}w`, from)).blocks).toEqual([table(row("a", "b", ""), [row("x", "", ""), row("y", "z", "w")])]);
  });
  it("preserves all spaces and quoted empty cells without interpreting syntax", async () => {
    expect((await read(' a ," b  "\n"",')).blocks).toEqual([table([attr, [cell([{ t: "Space" }, str("a"), { t: "Space" }]), cell([{ t: "Space" }, str("b"), { t: "Space" }, { t: "Space" }])]], [row("", "")])]);
    expect((await read('""')).blocks).toEqual([table(row(""), [])]);
    expect((await read('h\n"x\ty"')).blocks).toEqual([table(row("h"), [row("x\ty")])]);
  });
  it.each([
    ['a,b\n"x,y', "2:5"],
    ['h\nx"y', "2:2"],
    ['h\n"x"y', "2:4"],
    ['h\n"x" ', "2:4"],
    ['h\n "x"', "2:2"],
    ['h\n"x\ny"z', "3:3"],
    ['h\n猫"x', "2:2"]
  ])("rejects malformed CSV %j at its normalized source location", async (text, location) => {
    await expect(read(text)).rejects.toMatchObject({ code: "E_PARSE", operation: "read", format: "csv", location });
    await expect(convert([{ bytes: encode(text) }], { from: "csv", to: "json" }, { yield: immediate })).rejects.toMatchObject({ code: "E_PARSE", operation: "convert", format: "csv", location });
  });
  it.each(["csv", "tsv"])("handles BOM, Unicode and delimiters at every byte split for %s", async (from) => {
    const delimiter = from === "csv" ? "," : "\t";
    const bytes = encode(`\ufeff猫${delimiter}🙂\r\n0012${delimiter}=1+1\r\n`);
    const expected = [table(row("猫", "🙂"), [row("0012", "=1+1")])];
    for (let split = 0; split <= bytes.length; split++) {
      expect((await readDocument({ chunks: [bytes.slice(0, split), bytes.slice(split)] }, { from }, { yield: immediate })).blocks).toEqual(expected);
    }
    expect((await readDocument({ chunks: Array.from(bytes, (byte) => Uint8Array.of(byte)) }, { from }, { yield: immediate })).blocks).toEqual(expected);
  });
  it.each(["csv", "tsv"])("admits field, row, column and rectangular cell ceilings for %s", async (from) => {
    const d = from === "csv" ? "," : "\t";
    for (const [limits, admitted, rejected] of [
      [{ tableFieldText: 2 }, "ab", "abc"],
      [{ tableRows: 2 }, "h\nx", "h\nx\ny"],
      [{ tableColumns: 2 }, `a${d}b`, `a${d}b${d}c`],
      [{ tableCells: 4 }, `a${d}b\nx`, `a\nx${d}y${d}z`]
    ] as const) {
      await expect(read(admitted, from, { limits })).resolves.toBeDefined();
      await expect(read(rejected, from, { limits })).rejects.toMatchObject({ code: "E_LIMIT" });
    }
    await expect(read("\n", from, { limits: { tableRows: 0 } })).rejects.toMatchObject({ code: "E_LIMIT" });
    await expect(read("x", from, { limits: { tableColumns: 0 } })).rejects.toMatchObject({ code: "E_LIMIT" });
    await expect(read("", from, { limits: { tableRows: 0, tableColumns: 0, tableCells: 0 } })).resolves.toMatchObject({ blocks: [] });
  });
  it("preserves independent tables across multiple inputs and keeps XLSX gated", async () => {
    const result = await convert([{ bytes: encode("h\nx") }, { bytes: encode("j\ny") }], { from: "csv", to: "json" }, { yield: immediate });
    expect(result.kind).toBe("text");
    if (result.kind === "text") expect(JSON.parse(result.text).blocks).toHaveLength(2);
    await expect(read("x", "xlsx")).rejects.toMatchObject({ code: "E_CAPABILITY" });
  });
  it("counts decoded field units, including escaped quotes and supplementary Unicode", async () => {
    expect((await read('h\n""""', "csv", { limits: { tableFieldText: 1 } })).blocks).toEqual([table(row("h"), [row('"')])]);
    await expect(read("🙂", "csv", { limits: { tableFieldText: 1 } })).rejects.toMatchObject({ code: "E_LIMIT" });
    await expect(read("🙂", "csv", { limits: { tableFieldText: 2 } })).resolves.toMatchObject({ blocks: [table(row("🙂"), [])] });
    await expect(read('""', "csv", { limits: { tableFieldText: 0 } })).resolves.toMatchObject({ blocks: [table(row(""), [])] });
  });
  it("aggregates cell limits across independent tables without charging padding twice", async () => {
    const inputs = [{ bytes: encode("h\nx") }, { bytes: encode("j\ny") }];
    await expect(convert(inputs, { from: "csv", to: "json" }, { limits: { tableCells: 4 }, yield: immediate })).resolves.toMatchObject({ kind: "text" });
    await expect(convert(inputs, { from: "csv", to: "json" }, { limits: { tableCells: 3 }, yield: immediate })).rejects.toMatchObject({ code: "E_LIMIT" });
  });
  it("handles BOM and multibyte splits inside multiline CSV and escape boundaries", async () => {
    const text = '\ufeffh\r\n"猫\r\n🙂""x"\r\n';
    const bytes = encode(text);
    const expected = [table(row("h"), [[attr, [cell([str("猫"), { t: "LineBreak" }, str('🙂"x')])]]])];
    for (let split = 0; split <= bytes.length; split++) {
      expect((await readDocument({ chunks: [bytes.slice(0, split), bytes.slice(split)] }, { from: "csv" }, { yield: immediate })).blocks).toEqual(expected);
    }
  });
});
