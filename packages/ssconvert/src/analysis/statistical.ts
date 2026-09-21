import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { ToolTestOptions } from "../solver.js";
import { DEFAULT_SHEET_SIZE, formatA1, type Cell, type CellRange, type FormulaGroup, type UnsupportedRecord, type Workbook } from "../workbook.js";
import { quoteNativeSheet } from "../formulas/serialization.js";
import { recalculateWithDiagnostics } from "../formulas/diagnostics.js";
import { analysisUtility, kaplanMeierChart } from "./utilities.js";
import { doubleDiagnostic } from "./protocol.js";

/** value.c emits formula constants with 17 significant binary64 digits. */
function analysisFloat(value: number): string {
  const [mantissa, power] = value.toExponential(16).split("e");
  const exponent = Number(power);
  let text = exponent >= -4 && exponent < 17 ? value.toFixed(Math.max(0, 16 - exponent)) : mantissa!;
  if (text.includes(".")) {
    while (text.endsWith("0")) text = text.slice(0, -1);
    if (text.endsWith(".")) text = text.slice(0, -1);
  }
  return exponent >= -4 && exponent < 17 ? text : `${text}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/** Formula output preserves links to the input; calculation uses the SDK evaluator. */
export async function statisticalAnalysis(book: Workbook, tool: string, options: ToolTestOptions, context: CapabilityContext): Promise<Workbook> {
  const p = options.properties;
  const source = book.sheets.find(sheet => sheet.id === options.sheet);
  if (!source) throw new SsconvertError("invalid-request", "Analysis tool failed");
  const size = source.size ?? DEFAULT_SHEET_SIZE;
  const cells: Cell[] = [];
  const formulaGroups: FormulaGroup[] = [];
  const merges: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] = [];
  let anovaValidityRow: number | undefined;
  let anovaErrorRow: number | undefined;
  const occupied = [...book.sheets, ...book.detachedSheets ?? []].reduce((n, sheet) => n + sheet.cells.length, 0);
  if (book.sheets.length + (book.detachedSheets?.length ?? 0) >= context.limits.sheets)
    throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
  let operations = 0;
  const add = (cell: Cell) => {
    context.signal.throwIfAborted();
    if (++operations > context.limits.operations || cells.length >= context.limits.cells - occupied)
      throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
    if (cell.row < size.rows && cell.column < size.columns) cells.push(cell);
  };
  const text = (row: number, column: number, value: string, italic = true) => add({ row, column, value: { kind: "string", value }, ...(italic ? { style: { italic: true } } : {}) });
  const formula = (row: number, column: number, expression: string, italic = false) => add({ row, column, value: { kind: "blank" }, formula: `=${expression}`, formulaDirty: true, ...(italic ? { style: { italic: true } } : {}) });
  const arrayFormula = (row: number, column: number, expression: string, height = 1, width = 1) => {
    const id = `analysis-${row}-${column}`;
    for (let r = row; r < row + height; r++) for (let c = column; c < column + width; c++)
      add({ row: r, column: c, value: { kind: "blank" }, ...(r === row && c === column ? { formula: `=${expression}`, formulaDirty: true } : {}), formulaGroup: id });
    formulaGroups.push({ id, kind: "array", expression: `=${expression}`, range: { startRow: row, endRow: row + height - 1, startColumn: column, endColumn: column + width - 1 } });
  };
  const number = (row: number, column: number, value: number) => add({ row, column, value: { kind: "number", value } });
  const ref = (range: CellRange, outputRow?: number, outputColumn?: number) => {
    if (range.endSheet !== undefined && range.endSheet !== range.sheet)
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: analysis sheet span");
    const sheet = book.sheets.find(sheet => sheet.id === range.sheet);
    if (!sheet) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const absolute = (row: number, column: number, rowRelative = false, columnRelative = false) => {
      const address = formatA1(row + (rowRelative ? outputRow ?? 0 : 0), column + (columnRelative ? outputColumn ?? 0 : 0), sheet.size);
      let split = 0;
      while (split < address.length && address[split]! >= "A" && address[split]! <= "Z") split++;
      return `${columnRelative ? "" : "$"}${address.slice(0, split)}${rowRelative ? "" : "$"}${address.slice(split)}`;
    };
    return quoteNativeSheet(sheet.name) + "!" + absolute(range.startRow, range.startColumn, outputRow !== undefined && range.startRowRelative, outputRow !== undefined && range.startColumnRelative) +
      (range.startRow === range.endRow && range.startColumn === range.endColumn ? "" : ":" + absolute(range.endRow, range.endColumn, outputRow !== undefined && range.endRowRelative, outputRow !== undefined && range.endColumnRelative));
  };
  const rowGroups = p["group-by"] === 0;
  const groups = (input: CellRange | undefined): CellRange[] => {
    if (!input) return [];
    const count = p["group-by"] === 0 ? input.endRow - input.startRow + 1 : p["group-by"] === 1 ? input.endColumn - input.startColumn + 1 : 1;
    if (count > context.limits.operations || count > context.limits.cells)
      throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
    return Array.from({ length: count }, (_, i) => ({ ...input, ...(p["group-by"] === 0
      ? { startRow: input.startRow + i, endRow: input.startRow + i }
      : p["group-by"] === 1 ? { startColumn: input.startColumn + i, endColumn: input.startColumn + i } : {}) }));
  };
  const window = (range: CellRange): CellRange => {
    if (!p.labels) return range;
    const start = (rowGroups ? range.startColumn : range.startRow) + 1;
    const end = rowGroups ? range.endColumn : range.endRow;
    return { ...range, ...(rowGroups ? { startColumn: Math.min(start, end), endColumn: Math.max(start, end) }
      : { startRow: Math.min(start, end), endRow: Math.max(start, end) }) };
  };
  const label = (range: CellRange, row: number, column: number, i: number) => {
    if (p.labels) formula(row, column, ref({ ...range, endRow: range.startRow, endColumn: range.startColumn }), true);
    else text(row, column, `${["Row", "Column", "Area", "Bin"][Number(p["group-by"])] ?? "Area"} ${i}`);
  };
  const inputs = groups(options.data);
  const ranges = inputs.map(range => ref(window(range)));
  const length = (range: CellRange) => (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
  const indexLabel = (range: CellRange, row: number, column: number, i: number) => {
    if (p.labels) formula(row, column, `index(${ref(range)})`, true);
    else text(row, column, `${rowGroups ? "Row" : p["group-by"] === 1 ? "Column" : "Area"} ${i}`);
  };
  if (tool === "advanced-filter" || tool === "fill-series") {
    await analysisUtility(book, tool, options, context, add, merges);
  } else if (tool === "kaplan-meier") {
    if (!options.x || "kind" in options.x) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const rows = options.x.endRow - options.x.startRow + 1, probability = p.censored ? 4 : 3, error = probability + 1;
    text(0, 0, "Kaplan-Meier");
    ["Time", "At Risk", "Deaths", ...(p.censored ? ["Censures"] : []), "Probability", ...(p["std-err"] ? ["Standard Error"] : [])].forEach((value, column) => text(1, column, value));
    const censor = (row: number, column: number) => {
      const y = options.y && !("kind" in options.y) ? ref(options.y, row, column) : "#REF!";
      return p["censor-mark"] === p["censor-mark-to"] ? `if(${y}=${p["censor-mark"]},1,0)` : `if(${y}>=${p["censor-mark"]},1,0)*if(${y}<=${p["censor-mark-to"]},1,0)`;
    };
    number(2, 0, 0);
    for (let r = 2; r < rows + 2; r++) {
      const time = formatA1(r, 0, size), risk = formatA1(r, 1, size), deaths = formatA1(r, 2, size), prob = formatA1(r, probability, size);
      if (r > 2) {
        const x = ref(options.x, r, 0);
        const small = `small(if(${x}>${formatA1(r - 1, 0, size)},${x},"N/A"),1)`;
        arrayFormula(r, 0, `if(iserror(${small}),"",${small})`);
      }
      arrayFormula(r, 1, `if(${time}="","",sum(if(${ref(options.x, r, 1)}<${time},0,1)*1))`);
      const deathCount = `if(${ref(options.x, r, 2)}=${time},1,0)`;
      arrayFormula(r, 2, `if(${risk}="","",sum(1*${p.censored ? `(${deathCount}*(1-${censor(r, 2)}))` : deathCount}))`);
      if (p.censored) arrayFormula(r, 3, `if(${deaths}="","",sum(1*(if(${ref(options.x, r, 3)}=${time},1,0)*${censor(r, 3)})))`);
      if (r === 2) formula(r, probability, `(${risk}-${deaths})/${risk}`);
      else arrayFormula(r, probability, `if(${deaths}="","",(${risk}-${deaths})/${risk}*${formatA1(r - 1, probability, size)})`);
      if (p["std-err"]) formula(r, error, `if(${prob}="","",${prob}*sqrt((1-${prob})/${risk}))`);
    }
    if (p.median) {
      const column = error + (p["std-err"] ? 2 : 1), times = `A3:A${rows + 2}`, probs = `${formatA1(2, probability, size)}:${formatA1(rows + 1, probability, size)}`;
      text(1, column, "Median");
      const masked = `if(${probs}>0.5,"NA",1)*${times}`;
      arrayFormula(1, column + 1, `min(if(iserror(${masked}),"NA",${masked}))`);
    }
    if (p["logrank-test"]) {
      const column = error + (p["std-err"] ? 2 : 1), offset = p.median ? 5 : 0;
      ["Log-Rank Test", "Statistic", "Degrees of Freedom", "p-Value"].forEach((value, i) => text(offset + i, column, value));
      // run_tool_test cannot populate the GUI group list: one group, zero df.
      const deathRange = `C3:C${rows + 2}`, riskRange = `B3:B${rows + 2}`;
      const expected = `(0+${deathRange})*${riskRange}/(0+${riskRange})`, total = `sum(if(iserror(${expected}),0,${expected}))`;
      arrayFormula(offset + 1, column + 1, `0+(sum(${deathRange})-${total})^2/${total}`);
      number(offset + 2, column + 1, 0); formula(offset + 3, column + 1, `chidist(${formatA1(offset + 1, column + 1, size)},${formatA1(offset + 2, column + 1, size)})`);
    }
  } else if (["t-test-paired", "t-test-equal-variances", "t-test-unequal-variances", "f-test", "z-test"].includes(tool)) {
    const pair = [options.x, options.y].map((input, i) => {
      if (!input || "kind" in input) return "#REF!";
      if (p.labels) formula(0, i + 1, ref({ ...input, endRow: input.startRow, endColumn: input.startColumn }), true);
      else text(0, i + 1, `Variable ${i + 1}`);
      return ref(p.labels ? { ...input, ...(input.endColumn - input.startColumn < input.endRow - input.startRow
        ? { startRow: input.startRow + 1 } : { startColumn: input.startColumn + 1 }) } : input);
    });
    const x = pair[0]!, y = pair[1]!, alpha = analysisFloat(Number(p.alpha));
    text(0, 0, tool === "f-test" ? "F-Test" : "");
    [x, y].forEach((r, i) => {
      const input = i ? options.y : options.x;
      const meanRange = tool === "z-test" && input && !("kind" in input) ? ref(input, 1, i + 1) : r;
      const countRange = tool === "z-test" && input && !("kind" in input) ? ref(input, 3, i + 1) : r;
      formula(1, i + 1, `average(${meanRange})`); formula(3, i + 1, `count(${countRange})`);
      if (tool === "z-test") number(2, i + 1, Number(p[i ? "var2" : "var1"]));
      else formula(2, i + 1, `var(${r})`);
    });
    let names: string[];
    if (tool === "f-test") {
      names = ["Mean", "Variance", "Observations", "df", "F", "P (F<=f) right-tail", "F Critical right-tail", "P (f<=F) left-tail", "F Critical left-tail", "P two-tail", "F Critical two-tail"];
      formula(4, 1, "B4-1"); formula(4, 2, "C4-1"); formula(5, 1, "B3/C3");
      formula(6, 1, "fdist(B6,B5,C5)"); formula(7, 1, `finv(${alpha},B5,C5)`);
      formula(8, 1, "1-B7"); formula(9, 1, `finv(${analysisFloat(1 - Number(p.alpha))},B5,C5)`);
      formula(10, 1, "2*min(B7,B9)"); formula(11, 1, `finv(${analysisFloat(1 - Number(p.alpha) / 2)},B5,C5)`);
      formula(11, 2, `finv(${analysisFloat(Number(p.alpha) / 2)},B5,C5)`);
    } else if (tool === "z-test") {
      names = ["Mean", "Known Variance", "Observations", "Hypothesized Mean Difference", "Observed Mean Difference", "z", "P (Z<=z) one-tail", "z Critical one-tail", "P (Z<=z) two-tail", "z Critical two-tail"];
      number(4, 1, Number(p["mean-diff"])); formula(5, 1, "B2-C2"); formula(6, 1, "(B6-B5)/sqrt(B3/B4+C3/C4)");
      formula(7, 1, "1-normsdist(abs(B7))"); formula(8, 1, `-normsinv(${alpha})`);
      formula(9, 1, "2*normsdist(-abs(B7))"); formula(10, 1, `-normsinv(${alpha}/2)`);
    } else {
      const paired = tool === "t-test-paired", equal = tool === "t-test-equal-variances";
      names = ["Mean", "Variance", "Observations", ...(paired ? ["Pearson Correlation"] : equal ? ["Pooled Variance"] : []), "Hypothesized Mean Difference", "Observed Mean Difference", ...(paired ? ["Variance of the Differences"] : []), "df", "t Stat", "P (T<=t) one-tail", "t Critical one-tail", "P (T<=t) two-tail", "t Critical two-tail"];
      const hypothesis = paired || equal ? 5 : 4, df = paired ? 8 : equal ? 7 : 6, stat = df + 1;
      number(hypothesis, 1, Number(p["mean-diff"]));
      if (paired) {
        formula(4, 1, `correl(${x},${y})`);
        const valid = `if(isnumber(${x}),1,0)*if(isnumber(${y}),1,0)`, differences = `if(isodd(${valid}),${x}-${y},"NA")`;
        arrayFormula(6, 1, `average(${differences})`); arrayFormula(7, 1, `var(${differences})`); arrayFormula(df, 1, `sum(${valid})-1`);
        formula(stat, 1, "(B7-B6)/(B8/(B9+1))^0.5");
      } else if (equal) {
        formula(4, 1, "((B4-1)*B3+(C4-1)*C3)/(B4-1+(C4-1))");
        formula(6, 1, "B2-C2"); formula(df, 1, "B4+C4-2"); formula(stat, 1, "(B7-B6)/(B5/B4+B5/C4)^0.5");
      } else {
        formula(5, 1, "B2-C2"); formula(df, 1, "(B3/B4+C3/C4)^2/((B3/B4)^2/(B4-1)+(C3/C4)^2/(C4-1))");
        formula(stat, 1, "(B6-B5)/(B3/B4+C3/C4)^0.5");
      }
      const d = formatA1(df, 1, size), t = formatA1(stat, 1, size);
      formula(stat + 1, 1, `tdist(abs(${t}),${d},1)`); formula(stat + 2, 1, `tinv(2*${alpha},${d})`);
      formula(stat + 3, 1, `tdist(abs(${t}),${d},2)`); formula(stat + 4, 1, `tinv(${alpha},${d})`);
    }
    names.forEach((value, i) => text(i + 1, 0, value));
  } else if (["sign-test-two-samples", "wilcoxon-signed-rank-test", "wilcoxon-signed-rank-test-two-samples", "wilcoxon-mann-whitney"].includes(tool)) {
    const paired = tool !== "wilcoxon-signed-rank-test";
    const pairAreas: CellRange[] = [];
    const pair = paired ? [options.x, options.y].map((input, i) => {
      if (!input || "kind" in input) return "#REF!";
      const row = tool === "wilcoxon-mann-whitney" ? 1 : 0;
      if (p.labels) formula(row, i + 1, ref({ ...input, endRow: input.startRow, endColumn: input.startColumn }), true);
      else text(row, i + 1, `Variable ${i + 1}`);
      const area = p.labels ? { ...input, ...(input.endColumn - input.startColumn < input.endRow - input.startRow ? { startRow: input.startRow + 1 } : { startColumn: input.startColumn + 1 }) } : input;
      pairAreas.push(area);
      return ref(area);
    }) : [];
    if (tool === "wilcoxon-mann-whitney") {
      text(0, 0, "Wilcoxon-Mann-Whitney Test"); text(1, 3, "Total");
      merges.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 3 });
      ["Rank-Sum", "N", "U", "Ties", "Statistic", "U-Statistic", "p-Value"].forEach((value, i) => text(i + 2, 0, value));
      let total = `array(${pair.join(",")})`;
      const [a, b] = pairAreas;
      if (a && b && a.sheet === b.sheet) {
        if (a.startRow === b.startRow && a.endRow === b.endRow && (a.endColumn + 1 === b.startColumn || b.endColumn + 1 === a.startColumn))
          total = ref({ ...a, startColumn: Math.min(a.startColumn, b.startColumn), endColumn: Math.max(a.endColumn, b.endColumn) });
        else if (a.startColumn === b.startColumn && a.endColumn === b.endColumn && (a.endRow + 1 === b.startRow || b.endRow + 1 === a.startRow))
          total = ref({ ...a, startRow: Math.min(a.startRow, b.startRow), endRow: Math.max(a.endRow, b.endRow) });
      }
      pair.forEach((r, i) => { const c = i + 1, at = (row: number) => formatA1(row, c, size);
        arrayFormula(2, c, `sum(if(isblank(${r}),0,rank.avg(${r},${total},1)))`);
        formula(3, c, `count(${r})`); formula(4, c, `${at(2)}-${at(3)}*(${at(3)}+1)/2`);
      });
      formula(2, 3, `count(${total})*(count(${total})+1)/2`); formula(3, 3, `count(${total})`); formula(4, 3, "B4*C4");
      arrayFormula(5, 1, `sum(rank.avg(${total},${total})-rank(${total},${total}))`);
      formula(6, 1, "min(B3,C3)"); formula(7, 1, "min(B5,C5)");
      formula(8, 1, "2*normdist(B8,B4*C4/2,sqrt(B4*C4*(B4+C4+1)/12),TRUE)");
    } else if (tool === "sign-test-two-samples") {
      ["Sign Test", "Median", "Predicted Difference", "Test Statistic", "N", "α", "P(T≤t) one-tailed", "P(T≤t) two-tailed"].forEach((value, row) => text(row, 0, value));
      const x = pair[0]!, y = pair[1]!, diff = `${x}-${y}`, nx = `if(isnumber(${x}),1,0)`, ny = `if(isnumber(${y}),1,0)`;
      pair.forEach((r, i) => formula(1, i + 1, `median(${r})`)); number(2, 1, Number(p.median)); number(5, 1, Number(p.alpha));
      const count = (op: string, valid: string) => `sum(${nx}*(${valid}*iferror(if(${diff}${op}B3,1,0),0)))`;
      arrayFormula(3, 1, `min(${count("<", nx)},${count(">", nx)})`);
      arrayFormula(4, 1, count("<>", ny));
      arrayFormula(6, 1, "min(binomdist(B4,B5,0.5,TRUE),1-binomdist(B4,B5,0.5,TRUE))"); arrayFormula(7, 1, "2*B7");
    } else {
      const offset = paired ? 1 : 0;
      ["Wilcoxon Signed Rank Test", "Median", ...(paired ? ["Observed Median Difference", "Predicted Median Difference"] : ["Predicted Median"]), "N", "S−", "S+", "Test Statistic", "α", "P(T≤t) one-tailed", "P(T≤t) two-tailed"].forEach((value, row) => text(row, 0, value));
      const samples = paired ? [pair[0]!] : ranges;
      samples.forEach((r, i) => {
        const c = i + 1, at = (row: number) => formatA1(row, c, size), hypothesis = at(2 + offset);
        if (!paired) label(inputs[i]!, 0, c, c);
        const valid = `if(isnumber(${r}),1,0)${paired ? `*if(isnumber(${pair[1]}),1,0)` : ""}`, diff = paired ? `${r}-${pair[1]}` : r;
        if (paired) {
          arrayFormula(1, 1, `median(if(${valid}=1,${r},""))`); arrayFormula(1, 2, `median(if(${valid}=1,${pair[1]},""))`);
          arrayFormula(2, 1, `median(if(${valid}=1,${diff},""))`);
        } else formula(1, c, `median(${r})`);
        if (i === 0) { number(2 + offset, c, Number(p.median)); number(7 + offset, c, Number(p.alpha)); }
        else { formula(2, c, formatA1(2, c - 1, size)); formula(7, c, formatA1(7, c - 1, size)); }
        arrayFormula(3 + offset, c, `sum(${valid}*iferror(if(${diff}<>${hypothesis},1,0),0))`);
        const absolute = `abs(${diff}-${hypothesis})`, big = `max(${absolute})+1`;
        const rankData = paired ? `if(isnumber(${r}),if(isnumber(${pair[1]}),if(${diff}=${hypothesis},${big},${absolute}),${big}),${big})`
          : `if(isnumber(${r}),if(${r}=${hypothesis},${big},${absolute}),${big})`;
        arrayFormula(4 + offset, c, `sum(${valid}*if(${diff}<${hypothesis},rank.avg(-(${diff}-${hypothesis}),${rankData},1),0))`);
        const n = at(3 + offset), negative = at(4 + offset), statistic = at(6 + offset);
        formula(5 + offset, c, `${n}*(${n}+1)/2-${negative}`); formula(6 + offset, c, `min(${at(5 + offset)},${negative})`);
        formula(8 + offset, c, `if(${n}<12,#N/A,normdist(${statistic}+0.5,${n}*(${n}+1)/4,sqrt(${n}*(${n}+1)/4*(2*${n}+1)/6),TRUE))`);
        if (paired) arrayFormula(9 + offset, c, `2*${at(8 + offset)}`);
        else formula(9 + offset, c, `2*${at(8 + offset)}`);
      });
    }
  } else if (tool === "one-mean-test") {
    ["Student-t Test", "N", "Observed Mean", "Hypothesized Mean", "Observed Variance", "Test Statistic", "df", "α", "P(T≤t) one-tailed", "P(T≤t) two-tailed"].forEach((value, row) => text(row, 0, value));
    inputs.forEach((input, i) => {
      const c = i + 1, at = (row: number) => formatA1(row, c, size);
      label(input, 0, c, c);
      if (i === 0) { number(3, c, Number(p.mean)); number(7, c, Number(p.alpha)); }
      else { formula(3, c, formatA1(3, c - 1, size)); formula(7, c, formatA1(7, c - 1, size)); }
      formula(1, c, `count(${ranges[i]})`);
      arrayFormula(2, c, `average(iferror(${ranges[i]},""))`);
      arrayFormula(4, c, `var(iferror(${ranges[i]},""))`);
      arrayFormula(5, c, `(${at(2)}-${at(3)})/sqrt(${at(4)}/${at(1)})`);
      formula(6, c, `${at(1)}-1`);
      formula(8, c, `tdist(abs(${at(5)}),${at(6)},1)`);
      formula(9, c, `tdist(abs(${at(5)}),${at(6)},2)`);
    });
  } else if (tool === "sign-test") {
    ["Sign Test", "Median", "Predicted Median", "Test Statistic", "N", "α", "P(T≤t) one-tailed", "P(T≤t) two-tailed"].forEach((value, row) => text(row, 0, value));
    inputs.forEach((input, i) => {
      const c = i + 1, at = (row: number) => formatA1(row, c, size), r = ranges[i];
      label(input, 0, c, c); formula(1, c, `median(${r})`);
      if (i === 0) { number(2, c, Number(p.median)); number(5, c, Number(p.alpha)); }
      else { formula(2, c, formatA1(2, c - 1, size)); formula(5, c, formatA1(5, c - 1, size)); }
      const count = (op: string, row: number) => `sum(if(isnumber(${r}),1,0)*iferror(if(${r}${op}${at(row)},1,0),0))`;
      arrayFormula(3, c, `min(${count("<", 2)},${count(">", 2)})`);
      arrayFormula(4, c, count("<>", 2));
      arrayFormula(6, c, `binomdist(${at(3)},${at(4)},0.5,TRUE)`);
      arrayFormula(7, c, `2*${at(6)}`);
    });
  } else if (tool === "chi-squared-test") {
    if (!options.data) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const range = { ...options.data, startRow: options.data.startRow + (p.labels ? 1 : 0), startColumn: options.data.startColumn + (p.labels ? 1 : 0) };
    const rows = range.endRow - range.startRow, columns = range.endColumn - range.startColumn;
    if (rows < 1 || columns < 1) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const r = ref(range), expected = `mmult(mmult(${r},transpose(column(${r})/column(${r}))),mmult(transpose(row(${r})/row(${r})),${r}))/sum(${r})`;
    formula(0, 0, `min(${expected})`, true);
    merges.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
    ["Test Statistic", "Degrees of Freedom", "p-Value", "Critical Value"].forEach((value, i) => text(i + 1, 0, value));
    arrayFormula(1, 1, `sum((${r}-${expected})^2/(${expected}))`);
    number(2, 1, rows * columns); formula(3, 1, "chidist(B2,B3)"); formula(4, 1, `chiinv(${analysisFloat(Number(p.alpha))},B3)`);
  } else if (tool === "auto-expression") {
    if (!p.function) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const name = String(p.function).toLowerCase();
    inputs.forEach((input, i) => formula(p.below ? 0 : i, p.below ? i : 0, `${name}(${ref(input)})`));
    if (p.multiple && ranges.length) formula(p.below ? 0 : ranges.length, p.below ? ranges.length : 0,
      `${name}(A1:${formatA1(p.below ? 0 : ranges.length - 1, p.below ? ranges.length - 1 : 0, size)})`);
  } else if (tool === "fourier-analysis") {
    text(0, 0, p.inverse ? "Inverse Fourier Transform" : "Fourier Transform");
    merges.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
    inputs.forEach((input, i) => {
      const column = i * 2;
      label(input, 1, column, i + 1);
      text(2, column, "Real"); text(2, column + 1, "Imaginary");
      merges.push({ startRow: 1, endRow: 1, startColumn: column, endColumn: column + 1 });
      const n = length(window(input));
      let rows = 1;
      while (rows < n) rows *= 2;
      if (rows > context.limits.cells / 2 || rows > context.limits.operations)
        throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
      arrayFormula(3, column, `fourier(${ranges[i]},${p.inverse ? "TRUE" : "FALSE"},TRUE)`, rows, 2);
    });
  } else if (tool === "sampling") {
    const count = Number(p.number), rows = Number(p.size);
    if (count * (rows + 1) * inputs.length > context.limits.cells - occupied || count * (rows + 1) * inputs.length > context.limits.operations)
      throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
    inputs.forEach((input, i) => {
      const range = Number(p["group-by"]) > 1 ? input : window(input);
      const samplingRange = ref(range), height = range.endRow - range.startRow + 1, width = range.endColumn - range.startColumn + 1;
      for (let c = 0; c < count; c++) {
        const column = i * count + c;
        indexLabel(input, 0, column, i + 1);
        for (let row = 0; row < rows; row++) {
          if (!p.periodic) formula(row + 1, column, `randdiscrete(${samplingRange})`);
          else {
            // Released sampling increments a guint and stores INDEX coordinates as gint.
            const offset = ((Number(p.offset) || Number(p.period)) + Math.imul(row, Number(p.period)) + (p.labels && Number(p["group-by"]) > 1 ? 1 : 0)) >>> 0;
            const rowMajor = Boolean(p["row-major"]) !== (c % 2 === 1);
            const quotient = (Math.trunc(((offset - 1) >>> 0) / (rowMajor ? width : height)) + 1) | 0;
            const remainder = (offset - Math.imul(quotient - 1, rowMajor ? width : height)) | 0;
            const y = rowMajor ? quotient : remainder;
            const x = rowMajor ? remainder : quotient;
            formula(row + 1, column, `index(${samplingRange},${y},${x})`);
          }
        }
      }
    });
  } else if (tool === "ranking") {
    text(0, 0, "Ranks & Percentiles");
    merges.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
    inputs.forEach((input, i) => {
      const column = i * 4, range = ranges[i]!, rows = length(window(input));
      text(1, column, "Point"); label(input, 1, column + 1, i + 1);
      text(1, column + 2, "Rank"); text(1, column + 3, "Percentile Rank");
      const address = formatA1(0, column + 1, size).slice(0, -1);
      const large = `large(${range},row()-row($${address}$3)+1)`;
      arrayFormula(2, column + 1, large, rows);
      arrayFormula(2, column, `match(${large},${range},0)`, rows);
      for (let row = 2; row < rows + 2; row++) {
        const value = formatA1(row, column + 1, size);
        formula(row, column + 2, p["av-ties"] ? `(rank(${value},${range})-rank(${value},${range},1)+(count(${range})+1))/2` : `rank(${value},${range})`);
        formula(row, column + 3, `percentrank(${range},${value},10)`);
      }
    });
  } else if (tool === "normality-test") {
    if (p.graph) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: normality graph");
    const names = ["Anderson-Darling Test", "Cramér-von Mises Test", "Lilliefors (Kolmogorov-Smirnov) Test", "Shapiro-Francia Test"];
    const functions = ["adtest", "cvmtest", "lkstest", "sftest"];
    text(0, 0, names[Number(p.type)]!);
    ["Alpha", "p-Value", "Statistic", "N", "Conclusion"].forEach((name, row) => text(row + 1, 0, name));
    inputs.forEach((input, i) => {
      const column = i + 1;
      label(input, 0, column, column);
      if (!i) number(1, column, Number(p.alpha)); else formula(1, column, "B2");
      arrayFormula(2, column, `${functions[Number(p.type)]}(${ranges[i]})`, 3);
      formula(5, column, `if(${formatA1(1, column, size)}>=${formatA1(2, column, size)},"Not normal","Possibly normal")`);
    });
  } else if (tool === "frequency-tables") {
    if (p.predetermined || p.chart) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: frequency bins or chart");
    text(0, 0, "Frequency Table"); text(1, 0, "Category");
    inputs.forEach((input, i) => {
      const column = i + 1, range = ranges[i]!;
      indexLabel(input, 1, column, column);
      for (let row = 2; row < Number(p.n) + 2; row++) {
        const category = formatA1(row, 0, size);
        const condition = p.exact ? `exact(${range},${category})` : `${range}=${category}`;
        arrayFormula(row, column, `sum(if(${condition},1,0))${p.percentage ? `/(rows(${range})*columns(${range}))` : ""}`);
      }
    });
  } else if (tool === "histogram") {
    if (!ranges.length) throw new SsconvertError("invalid-request", "Analysis tool failed");
    if (p.predetermined || p.chart) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: histogram bins or chart");
    text(0, 0, "Histogram");
    const n = Number(p.n), bits = Number(p["bin-type"]), toColumn = p.cumulative ? 0 : 1;
    const start = bits & 4 ? 2 : 1, end = n + (bits & 4 ? 1 : 0) + (bits & 2 ? 1 : 0);
    const absolute = (row: number) => `$${toColumn ? "B" : "A"}$${row + 1}`;
    if (bits & 4) number(1, toColumn, -Number.MAX_VALUE);
    if (n > 1) {
      if (p["min-given"]) number(start, toColumn, Number(p.min)); else formula(start, toColumn, `min(${ranges[0]})`);
    }
    if (p["max-given"]) number(start + n - 1, toColumn, Number(p.max)); else formula(start + n - 1, toColumn, `max(${ranges[0]})`);
    for (let i = 1; i < n - 1; i++) formula(start + i, toColumn, `${absolute(start)}+${i}*((${absolute(start + n - 1)}-${absolute(start)})/${n - 1})`);
    if (bits & 2) number(end, toColumn, Number.MAX_VALUE);
    if (!p.cumulative) for (let row = 2; row <= end; row++) formula(row, 0, `B${row}`);
    inputs.forEach((input, i) => {
      const column = toColumn + i + 1, range = ranges[i]!;
      indexLabel(input, 1, column, i + 1);
      for (let row = 2; row <= end; row++) {
        const upper = bits & 2 && row === end ? "1" : `if(${range}${bits & 1 ? ">=" : ">"}${formatA1(row, toColumn, size)},0,1)`;
        const lower = bits & 4 && row === 2 ? "1" : `if(${range}${bits & 1 ? "<" : "<="}A${row + 1},0,1)`;
        const valid = p["only-numbers"] ? `if(isnumber(${range}),1,0)` : `if(isblank(${range}),0,1)`;
        arrayFormula(row, column, `sum(${p.cumulative ? upper : `${lower}*${upper}`}*${valid})${p.percentage ? `/${p["only-numbers"] ? "count" : "counta"}(${range})` : ""}`);
      }
    });
  } else if (tool === "exponential-smoothing") {
    if (p["show-graph"])
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: exponential smoothing variant");
    const mode = Number(p["es-type"]);
    if (mode === 3 || mode === 4) {
      const period = Number(p["s-period"]), origin = 2 + period, multiply = mode === 4;
      const at = (row: number, column: number, absolute = false) => {
        const address = formatA1(row, column, size);
        if (!absolute) return address;
        const letters = formatA1(0, column, size).slice(0, -1);
        return `$${letters}$${row + 1}`;
      };
      const maximum = Math.max(1, ...inputs.map(input => p["group-by"] === 2 ? length(input) : p["group-by"] === 1 ? input.endRow - input.startRow + 1 : input.endColumn - input.startColumn + 1)) - (p.labels ? 1 : 0);
      if (period + maximum > context.limits.cells || period + maximum > context.limits.operations)
        throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
      text(0, 0, "Exponential Smoothing");
      for (const [column, key] of [[2,"damp-fact"],[3,"g-damp-fact"],[4,"s-damp-fact"]] as const) formula(0, column, analysisFloat(Number(p[key])));
      text(2, 0, "Time");
      for (let time = 1 - period; time <= maximum; time++) number(origin + time, 0, time);
      inputs.forEach((input, i) => {
        const column = 1 + i * (p["std-error-flag"] ? 5 : 4), range = ranges[i]!, data = window(input);
        const height = rowGroups ? data.endColumn - data.startColumn + 1 : data.endRow - data.startRow + 1;
        indexLabel(input, 2, column, i + 1);
        ["Level", "Trend", "Seasonal Adjustment"].forEach((name, c) => text(2, column + c + 1, name));
        const fullData = `${at(origin + 1,column,true)}:${at(origin + height,column,true)}`;
        const timeData = `${at(origin + 1,0,true)}:${at(origin + height,0,true)}`;
        const starting = Math.min(4 * period, height);
        const fitData = multiply ? `offset(${fullData},0,0,${starting},1)` : fullData;
        formula(origin, column + 1, `index(linest(${fitData}),1,2)`);
        formula(origin, column + 2, `index(linest(${fitData}),1,1)`);
        const intercept = at(origin,column + 1,true), slope = at(origin,column + 2,true);
        const trendTimes = multiply ? `offset(${timeData},0,0,${starting},1)` : timeData;
        const estimate = (phase: string) => `average(if(mod(row(${fitData})-${phase},${period})=0,${fitData}${multiply ? "/" : "-"}(${intercept}+${trendTimes}*${slope}),"NA"))`;
        const denominator = multiply ? `average(${Array.from({ length: period }, (_, phase) => estimate(String(phase))).reverse().join(",")})` : "";
        for (let time = 0; time > -period; time--) arrayFormula(origin + time,column + 3, `${estimate("row()")}${multiply ? `/${denominator}` : ""}`);
        for (let time = 1; time <= maximum; time++) {
          const row = origin + time;
          formula(row,column,`index(${range},${rowGroups ? "1" : at(row,0)},${rowGroups ? at(row,0) : "1"})`);
          formula(row,column + 1,`$C$1*(${at(row,column)}${multiply ? "/" : "-"}${at(row - period,column + 3)})+(1-$C$1)*(${at(row - 1,column + 1)}+${at(row - 1,column + 2)})`);
          formula(row,column + 2,`$D$1*(${at(row,column + 1)}-${at(row - 1,column + 1)})+(1-$D$1)*${at(row - 1,column + 2)}`);
          formula(row,column + 3,`$E$1*(${at(row,column)}${multiply ? "/" : "-"}${at(row,column + 1)})+(1-$E$1)*${at(row - period,column + 3)}`);
        }
        if (p["std-error-flag"]) {
          text(2,column + 4,"Standard Error");
          for (let time = 1; time <= height; time++) {
            const row = origin + time, n = time - Number(p.df);
            if (time <= 1 || n <= 0) add({row,column:column + 4,value:{kind:"error",value:"#N/A"}});
            else {
              const observations = `${at(origin + 1,column)}:${at(row,column)}`;
              const seasons = `${at(origin + 1 - period,column + 3)}:${at(row - period,column + 3)}`;
              const previous = `(${at(origin,column + 2)}:${at(row - 1,column + 2)}+${at(origin,column + 1)}:${at(row - 1,column + 1)})`;
              if (multiply) {
                const prediction = `${previous}*${seasons}`;
                arrayFormula(row,column + 4,`sqrt(sumsq((${observations}-${prediction})/(${prediction}))/${n})`);
              } else formula(row,column + 4,`sqrt(sumxmy2(${observations},${seasons}+${previous})/${n})`);
            }
          }
        }
      });
    } else {
    text(0, 0, "Exponential Smoothing"); formula(1, 0, analysisFloat(Number(p["damp-fact"])));
    const current = mode === 1 || mode === 2;
    const holt = mode === 2;
    if (holt) formula(1, 1, analysisFloat(Number(p["g-damp-fact"])));
    inputs.forEach((input, i) => {
      const column = i * ((holt ? 2 : 1) + (p["std-error-flag"] ? 1 : 0)), range = ranges[i]!, data = window(input);
      const height = rowGroups ? data.endColumn - data.startColumn + 1 : data.endRow - data.startRow + 1;
      indexLabel(input, 2, column, i + 1);
      const initialization = `offset(${range},0,0,${rowGroups ? 1 : 5},${rowGroups ? 5 : 1})`;
      formula(3, column, holt ? `index(linest(${initialization}),1,2)` : current ? `average(${initialization})` : `index(${range})`);
      if (holt) formula(3, column + 1, `index(linest(${initialization}),1,1)`);
      const count = height + (current ? 1 : 0);
      for (let row = 4; row < count + 3; row++) {
        const move = row - 3;
        const previous = formatA1(row - 1,column,size);
        formula(row, column, `$A$2*index(${range},${rowGroups ? 1 : move},${rowGroups ? move : 1})+(1-$A$2)*${holt ? `(${previous}+${formatA1(row - 1,column + 1,size)})` : previous}`);
        if (holt) formula(row,column + 1,`$B$2*(${formatA1(row,column,size)}-${previous})+(1-$B$2)*${formatA1(row - 1,column + 1,size)}`);
      }
      if (p["std-error-flag"]) {
        const errorColumn = column + (holt ? 2 : 1);
        text(2, errorColumn, "Standard Error");
        for (let row = 3; row < count + 3; row++) {
          const n = row - 3, denominator = n - Number(p.df);
          if (n < 1 || denominator <= 0) add({ row, column: errorColumn, value: { kind: "error", value: "#N/A" } });
          else {
            const move = current ? 0 : 1;
            const from = current ? 3 : 4, to = current ? row - 1 : row;
            const first = formatA1(from,column,size), last = formatA1(to,column,size);
            const level = first === last ? first : `${first}:${last}`;
            const trendFirst = formatA1(from,column + 1,size), trendLast = formatA1(to,column + 1,size);
            const trend = trendFirst === trendLast ? trendFirst : `${trendFirst}:${trendLast}`;
            formula(row, errorColumn, `sqrt(sumxmy2(offset(${range},${rowGroups ? 0 : move},${rowGroups ? move : 0},${rowGroups ? 1 : n},${rowGroups ? n : 1}),${level}${holt ? `+${trend}` : ""})/${denominator})`);
          }
        }
      }
    });
    }
  } else if (tool === "correlation" || tool === "covariance") {
    text(0, 0, tool === "correlation" ? "Correlations" : "Covariances");
    inputs.forEach((range, i) => { label(range, 0, i + 1, i + 1); label(range, i + 1, 0, i + 1); });
    ranges.forEach((a, column) => ranges.forEach((b, row) => {
      if (row >= column) formula(row + 1, column + 1, `${tool === "correlation" ? "correl" : "covar"}(${a},${b})`);
    }));
  } else if (tool === "descriptive-statistics") {
    let offset = 0;
    const headers = () => inputs.forEach((range, i) => label(range, offset, i + 1, i + 1));
    if (p["do-summary-statistics"]) {
      headers();
      const labels = ["Mean", "Standard Error", "Median", "Mode", "Standard Deviation", "Sample Variance", "Kurtosis", "Skewness", "Range", "Minimum", "Maximum", "Sum", "Count"];
      labels.forEach((value, i) => text(i + 1, 0, value));
      ranges.forEach((range, column) => {
        const expressions = [`average(${range})`, `sqrt(var(${range})/count(${range}))`, `${p["use-ssmedian"] ? "ssmedian" : "median"}(${range})`, `mode(${range})`, `stdev(${range})`, `var(${range})`, `kurt(${range})`, `skew(${range})`, `max(${range})-min(${range})`, `min(${range})`, `max(${range})`, `sum(${range})`, `count(${range})`];
        expressions.forEach((expression, row) => formula(row + 1, column + 1, expression));
      });
      offset += 16;
    }
    if (p["do-confidence-level"]) {
      headers();
      text(offset + 1, 0, `${Number(p["confidence-level"]) * 100}% CI for the Mean from`);
      text(offset + 2, 0, "to");
      ranges.forEach((range, column) => {
        const margin = `tinv(${1 - Number(p["confidence-level"])},count(${range})-1)*sqrt(var(${range})/count(${range}))`;
        formula(offset + 1, column + 1, `average(${range})-${margin}`);
        formula(offset + 2, column + 1, `average(${range})+${margin}`);
      });
      offset += 4;
    }
    for (const [flag, name, functionName, k] of [["do-kth-largest", "Largest", "large", p["k-largest"]], ["do-kth-smallest", "Smallest", "small", p["k-smallest"]]] as const) {
      if (!p[flag]) continue;
      headers(); text(offset + 1, 0, `${name} (${k})`);
      ranges.forEach((range, column) => formula(offset + 1, column + 1, `${functionName}(${range},${k})`));
      offset += 4;
    }
  } else if (tool === "anova") {
    text(0, 0, "Anova: Single Factor"); text(2, 0, "SUMMARY");
    ["Groups", "Count", "Sum", "Average", "Variance"].forEach((value, column) => text(3, column, value));
    inputs.forEach((range, i) => {
      label(range, i + 4, 0, i + 1);
      ["count", "sum", "average", "var"].forEach((fn, column) => formula(i + 4, column + 1, `${fn}(${ranges[i]})`));
    });
    const offset = inputs.length + 6;
    text(offset, 0, "ANOVA");
    ["Source of Variation", "SS", "df", "MS", "F", "P-value", "F critical"].forEach((value, column) => text(offset + 1, column, value));
    ["Between Groups", "Within Groups", "Total"].forEach((value, row) => text(offset + 2 + row, 0, value));
    const count = `sum(${ranges.map(range => `count(${range})`).join(",")})`;
    const within = ranges.length ? `sum(${ranges.map(range => `devsq(${range})`).join(",")})` : "0";
    const total = ranges.length ? `devsq(${ranges.join(",")})` : "0";
    const between = `${formatA1(offset + 4, 1, size)}-${formatA1(offset + 3, 1, size)}`;
    formula(offset + 2, 1, between); formula(offset + 3, 1, within); formula(offset + 4, 1, total);
    number(offset + 2, 2, ranges.length - 1); formula(offset + 3, 2, `sum(${ranges.map(range => `count(${range})-1`).join(",")})`); formula(offset + 4, 2, `${count}-1`);
    const at = (row: number, column: number) => formatA1(row, column, size);
    for (const row of [offset + 2, offset + 3]) formula(row, 3, `${at(row, 1)}/${at(row, 2)}`);
    formula(offset + 2, 4, `${at(offset + 2, 3)}/${at(offset + 3, 3)}`);
    formula(offset + 2, 5, `fdist(${at(offset + 2, 4)},${at(offset + 2, 2)},${at(offset + 3, 2)})`);
    formula(offset + 2, 6, `finv(${analysisFloat(Number(p.alpha))},${at(offset + 2, 2)},${at(offset + 3, 2)})`);
  } else if (tool === "principal-components") {
    const n = ranges.length;
    if (!n) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const at = (row: number, column: number) => formatA1(row, column, size);
    const first = window(inputs[0]!);
    const points = (first.endRow - first.startRow + 1) * (first.endColumn - first.startColumn + 1);
    formula(0, 0, `if(and(${ranges.map((_, i) => `${points}=${at(3 + n, i + 1)}`).reverse().join(",")}),1,-1)`);
    text(1, 0, "Covariances");
    inputs.forEach((range, i) => { label(range, 1, i + 1, i + 1); label(range, i + 2, 0, i + 1); label(range, 10 + 2 * n + i, 0, i + 1); });
    ranges.forEach((a, column) => ranges.forEach((b, row) => formula(row + 2, column + 1, `covar(${a},${b})`)));
    ["Count", "Mean", "Variance"].forEach((value, row) => text(3 + n + row, 0, value));
    text(7 + n, 0, "Eigenvalues"); text(8 + n, 0, "Eigenvectors"); text(11 + 3 * n, 0, "Percent of Trace");
    const matrix = `${at(2, 1)}:${at(n + 1, n)}`;
    const eigen = `eigen(${at(3 + n, 1)}/(${at(3 + n, 1)}-1)*${matrix})`;
    arrayFormula(7 + n, 1, eigen, n + 1, n);
    arrayFormula(10 + 2 * n, 1, `mmult(mmult(sqrt(1/${at(5 + n, 1)}:${at(5 + n, n)})*munit(${n}),${at(8 + n, 1)}:${at(7 + 2 * n, n)}),sqrt(${at(7 + n, 1)}:${at(7 + n, n)})*munit(${n}))`, n, n);
    merges.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 });
    ranges.forEach((range, i) => {
      ["count", "average", "var"].forEach((fn, row) => formula(3 + n + row, i + 1, `${fn}(${range})`));
      text(9 + 2 * n, i + 1, `ξ${i + 1}`);
      formula(11 + 3 * n, i + 1, `${at(7 + n, i + 1)}/sum($B$${8 + n}:$${at(0, n).slice(0, -1)}$${8 + n})`);
    });
  } else if (tool === "regression") {
    const x = options.x, y = options.y;
    if (!x || !y) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const variables = "kind" in x ? [] : groups(x);
    const dimension = variables.length;
    const xr = "kind" in x ? x.value : ref(window(x)), yr = "kind" in y ? y.value : ref(window(y));
    const variableLabel = (range: CellRange | { readonly kind: "error"; readonly value: "#REF!" }, row: number, column: number) => {
      if ("kind" in range) formula(row, column, range.value, true);
      else if (p.labels) formula(row, column, `index(${ref(range)})`, true);
      else formula(row, column, `concatenate("${rowGroups ? "Row" : "Column"}"," ",cell("${rowGroups ? "row" : "col"}",${ref(range)}))`, true);
    };
    const intercept = p.intercept ? "TRUE" : "FALSE";
    const linest = (dependent: string, independent: string, row: number, column: number) => `index(linest(${dependent},${independent},${intercept},TRUE),${row},${column})`;
    const at = (row: number, column: number) => formatA1(row, column, size);
    if (!p["multiple-regression"]) {
      text(0, 0, "SUMMARY OUTPUT"); text(0, 2, p["multiple-y"] ? "Independent Variable" : "Response Variable");
      if ("kind" in y) formula(0, 3, y.value, true);
      else if (p.labels) formula(0, 3, ref({ ...y, endRow: y.startRow, endColumn: y.startColumn }, 0, 3), true);
      else formula(0, 3, `concatenate("${rowGroups ? "Row" : "Column"}"," ",cell("${rowGroups ? "row" : "col"}",${ref(y, 0, 3)}))`, true);
      text(0, 4, "Observations"); formula(0, 5, `rows(${yr})*columns(${yr})`);
      [p["multiple-y"] ? "Response Variable" : "Independent Variable", "R^2", "Slope", "Intercept", "F", "Significance of F"].forEach((value, column) => text(2, column, value));
      variables.forEach((range, i) => {
        const r = i + 3;
        const model = (column: number) => {
          const fixed = "kind" in y ? y.value : ref(window(y), r, column), series = ref(window(range));
          return p["multiple-y"] ? `linest(${series},${fixed},${intercept},TRUE)` : `linest(${fixed},${series},${intercept},TRUE)`;
        };
        label(range, r, 0, (rowGroups ? range.startRow : range.startColumn) + 1);
        arrayFormula(r, 1, `index(${model(1)},3,1)`);
        arrayFormula(r, 2, model(2), 1, 2);
        arrayFormula(r, 4, `index(${model(4)},4,1)`);
        formula(r, 5, `fdist(${at(r, 4)},1,F1-2)`);
      });
    } else {
      ["SUMMARY OUTPUT", "", "Regression Statistics", "Multiple R", "R^2", "Standard Error", "Adjusted R^2", "Observations", "", "ANOVA", "", "Regression", "Residual", "Total", "", "", "Intercept"].forEach((value, row) => text(row, 0, value));
      merges.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }, { startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 });
      text(0, 2, "Response Variable"); variableLabel(y, 0, 3);
      ["df", "SS", "MS", "F", "Significance of F"].forEach((value, column) => text(10, column + 1, value));
      ["Coefficients", "Standard Error", "t-Statistics", "p-Value"].forEach((value, column) => text(15, column + 1, value));
      number(15, 5, 1 - Number(p.alpha)); formula(15, 6, "F16");
      arrayFormula(4, 1, linest(yr, xr, 3, 1));
      if (p.intercept) formula(3, 1, "sqrt(B5)");
      else formula(3, 1, `sqrt(index(linest(${yr},${xr},TRUE,TRUE),3,1))`);
      arrayFormula(5, 1, linest(yr, xr, 3, 2));
      formula(7, 1, `sum(B14,${p.intercept ? 1 : 0})`);
      formula(6, 1, `1-(B8-1)/(B8-${dimension + (p.intercept ? 1 : 0)})*(1-B5)`);
      number(11, 1, dimension); arrayFormula(12, 1, linest(yr, xr, 4, 2)); formula(13, 1, "B12+B13");
      arrayFormula(11, 2, linest(yr, xr, 5, 1)); arrayFormula(12, 2, linest(yr, xr, 5, 2)); formula(13, 2, "C12+C13");
      formula(11, 3, "C12/B12"); formula(12, 3, "C13/B13"); arrayFormula(11, 4, linest(yr, xr, 4, 1)); formula(11, 5, "fdist(E12,B12,B13)");
      for (let i = 0; i <= dimension; i++) {
        const r = i + 16, index = i === 0 ? dimension + 1 : dimension - i + 1;
        if (i === 0 && !p.intercept) {
          number(r, 1, 0);
          for (let column = 2; column <= 6; column++) add({ row: r, column, value: { kind: "error", value: "#N/A" } });
          continue;
        }
        if (i) {
          if (p.labels) label(variables[i - 1]!, r, 0, i);
          else formula(r, 0, `concatenate("${rowGroups ? "Row" : "Column"}"," ",cell("${rowGroups ? "row" : "col"}",offset(${xr},${rowGroups ? i - 1 : 0},${rowGroups ? 0 : i - 1})))`, true);
        }
        arrayFormula(r, 1, linest(yr, xr, 1, index)); arrayFormula(r, 2, linest(yr, xr, 2, index));
        formula(r, 3, `${at(r, 1)}/${at(r, 2)}`); formula(r, 4, `tdist(abs(${at(r, 3)}),$B$13,2)`);
        formula(r, 5, `${at(r, 1)}-${at(r, 2)}*tinv(1-$F$16,$B$13)`); formula(r, 6, `${at(r, 1)}+${at(r, 2)}*tinv(1-$F$16,$B$13)`);
      }
      if (p.residual && dimension === 0) {
        // Released zero-width residual arrays overwrite these header positions.
        text(18, 3, "Residual"); text(18, 5, "Internally studentized"); text(18, 6, "Externally studentized"); text(18, 7, "p-Value");
        for (const [row, column] of [[18,0],[18,1],[18,2],[18,4],[19,0],[19,1],[19,2],[19,4]]) formula(row!, column!, "#REF!");
      } else if (p.residual) {
        const offset = 18 + dimension;
        text(offset, 0, "Constant");
        arrayFormula(offset, 1, `transpose(${at(17, 0)}${dimension > 1 ? ":" + at(16 + dimension, 0) : ""})`, 1, dimension);
        ["Prediction", "", "Residual", "Leverages", "Internally studentized", "Externally studentized", "p-Value"].forEach((value, i) => { if (value) text(offset, dimension + 1 + i, value); });
        formula(offset, dimension + 2, "D1", true);
        const observations = "kind" in x ? 0 : rowGroups ? window(x).endColumn - window(x).startColumn + 1 : window(x).endRow - window(x).startRow + 1;
        if (observations > context.limits.operations) throw new SsconvertError("resource-limit", "ssconvert analysis output exceeds workbook limits");
        arrayFormula(offset + 1, 1, rowGroups ? `transpose(${xr})` : xr, observations, dimension);
        arrayFormula(offset + 1, dimension + 2, rowGroups ? `transpose(${yr})` : yr, observations);
        const absolute = (row: number, column: number) => `$${at(row, column).split(String(row + 1))[0]}$${row + 1}`;
        arrayFormula(offset + 1, dimension + 4, `leverage(${absolute(offset + 1, p.intercept ? 0 : 1)}:${absolute(offset + observations, dimension)})`, observations);
        for (let i = 0; i < observations; i++) {
          const r = offset + 1 + i;
          formula(r, 0, "1");
          formula(r, dimension + 1, `sumproduct($B$17:${absolute(16 + dimension, 1)},transpose(${at(r, 0)}:${at(r, dimension)}))`);
          formula(r, dimension + 3, `${at(r, dimension + 2)}-${at(r, dimension + 1)}`);
          const residual = at(r, dimension + 3), leverage = at(r, dimension + 4);
          add({ row: r, column: dimension + 5, value: { kind: "blank" }, formula: `=${residual}/sqrt($D$13*(1-${leverage}))`, formulaDirty: true, format: "0.0000" });
          add({ row: r, column: dimension + 6, value: { kind: "blank" }, formula: `=${residual}/sqrt(($C$13-${residual}^2)/($B$13-1)*(1-${leverage}))`, formulaDirty: true, format: "0.0000" });
          add({ row: r, column: dimension + 7, value: { kind: "blank" }, formula: `=tdist(abs(${at(r, dimension + 6)}),$B$13-1,2)`, formulaDirty: true, format: "0.00%" });
        }
      }
    }
  } else if (tool === "anova2") {
    if (!options.data) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const input = options.data;
    const range = { ...input, startRow: input.startRow + (p.labels ? 1 : 0), startColumn: input.startColumn + (p.labels ? 1 : 0) };
    const height = range.endRow - range.startRow + 1, width = range.endColumn - range.startColumn + 1;
    if (height < 2 || width < 2) throw new SsconvertError("invalid-request", "Analysis tool failed");
    const at = (row: number, column: number) => formatA1(row, column, size);
    // Unlike GenericAnalysisTool, this handler retains relative range axes.
    const nativeInput = (row: number, column: number) => {
      const axis = (r: number, c: number, rr: boolean | undefined, cr: boolean | undefined) => {
        const address = formatA1(r + (rr ? row : 0), c + (cr ? column : 0), size);
        let split = 0;
        while (split < address.length && address[split]! >= "A" && address[split]! <= "Z") split++;
        return (cr ? "" : "$") + address.slice(0, split) + (rr ? "" : "$") + address.slice(split);
      };
      const sheet = book.sheets.find(sheet => sheet.id === input.sheet)!;
      return quoteNativeSheet(sheet.name) + "!" + axis(input.startRow, input.startColumn, input.startRowRelative, input.startColumnRelative) + ":" +
        axis(input.endRow, input.endColumn, input.endRowRelative, input.endColumnRelative);
    };
    const nativeRegion = (row: number, column: number) => p.labels ? `offset(${nativeInput(row, column)},1,1,${height},${width})` : nativeInput(row, column);
    const replication = Number(p.replication);
    if (replication > 1) {
      if (height % replication !== 0) throw new SsconvertError("invalid-request", "Analysis tool failed");
      const levels = height / replication;
      text(0, 0, "ANOVA: Two-Factor Fixed Effects With Replication"); text(2, 0, "Summary");
      for (let j = 0; j < width; j++) {
        if (p.labels) formula(2, j + 1, ref({ ...input, startRow: input.startRow, endRow: input.startRow, startColumn: range.startColumn + j, endColumn: range.startColumn + j }), true);
        else text(2, j + 1, `B, Level ${j + 1}`);
      }
      text(2, width + 1, "Subtotal");
      const blocks: string[] = [], columns: string[] = [], intersections: string[] = [];
      const summary = (r: number, c: number, rowOffset: number, columnOffset: number, rowCount: number, columnCount: number) => ["count", "sum", "average", "var"].forEach((fn, k) => formula(r + 1 + k, c,
        `${fn}(offset(${nativeInput(r + 1 + k, c)},${rowOffset},${columnOffset},${rowCount},${columnCount}))`));
      for (let i = 0; i < levels; i++) {
        const r = 3 + i * 6;
        const block = { ...range, startRow: range.startRow + i * replication, endRow: range.startRow + (i + 1) * replication - 1 };
        blocks.push(ref(block));
        if (p.labels) formula(r, 0, ref({ ...block, endRow: block.startRow, startColumn: input.startColumn, endColumn: input.startColumn }), true);
        else text(r, 0, `A, Level ${i + 1}`);
        ["Count", "Sum", "Average", "Variance"].forEach((value, k) => text(r + 1 + k, 0, value));
        for (let j = 0; j < width; j++) {
          const expression = ref({ ...block, startColumn: range.startColumn + j, endColumn: range.startColumn + j });
          intersections.push(expression); summary(r, j + 1, i * replication + (p.labels ? 1 : 0), j + (p.labels ? 1 : 0), replication, 1);
        }
        summary(r, width + 1, i * replication + (p.labels ? 1 : 0), p.labels ? 1 : 0, replication, width);
      }
      const subtotal = 3 + levels * 6;
      text(subtotal, 0, "Subtotal"); text(subtotal, width + 1, "Total");
      ["Count", "Sum", "Average", "Variance"].forEach((value, k) => text(subtotal + 1 + k, 0, value));
      for (let j = 0; j < width; j++) {
        const expression = ref({ ...range, startColumn: range.startColumn + j, endColumn: range.startColumn + j });
        columns.push(expression); summary(subtotal, j + 1, p.labels ? 1 : 0, j + (p.labels ? 1 : 0), height, 1);
      }
      ["count", "sum", "average", "var"].forEach((fn, k) => formula(subtotal + 1 + k, width + 1, `${fn}(${nativeRegion(subtotal + 1 + k, width + 1)})`));
      const offset = subtotal + 7;
      anovaValidityRow = offset; anovaErrorRow = offset + 5;
      formula(offset, 0, `if(count(${nativeRegion(offset, 0)})=${height * width},1,-1)`);
      ["Source of Variation", "SS", "df", "MS", "F", "P-value", "F critical"].forEach((value, column) => text(offset + 1, column, value));
      ["Factor A", "Factor B", "Interaction", "Error", "Total"].forEach((value, row) => text(offset + 2 + row, 0, value));
      const factorial = (r: number, mode: "a" | "b" | "ab") => {
        const base = nativeRegion(r, 1);
        const parts: string[] = [];
        if (mode !== "b") for (let i = levels - 1; i >= 0; i--) {
          if (mode === "a") parts.push(`sum(offset(${base},${i * replication},0,${replication},${width}))`);
          else for (let j = width - 1; j >= 0; j--) parts.push(`sum(offset(${base},${i * replication},${j},${replication},1))`);
        }
        else for (let j = width - 1; j >= 0; j--) parts.push(`sum(offset(${base},0,${j},${height},1))`);
        const divisor = mode === "a" ? width * replication : mode === "b" ? height : replication;
        return `sumsq(${parts.join(",")})/${divisor}`;
      };
      const correction = (r: number) => `sum(${nativeRegion(r, 1)})^2/count(${nativeRegion(r, 1)})`;
      formula(offset + 2, 1, `${factorial(offset + 2, "a")}-${correction(offset + 2)}`);
      formula(offset + 3, 1, `${factorial(offset + 3, "b")}-${correction(offset + 3)}`);
      formula(offset + 4, 1, `${factorial(offset + 4, "ab")}-${factorial(offset + 4, "a")}-${factorial(offset + 4, "b")}+${correction(offset + 4)}`);
      formula(offset + 5, 1, `sumsq(${nativeRegion(offset + 5, 1)})-${factorial(offset + 5, "ab")}`);
      formula(offset + 6, 1, `sum(${at(offset + 2, 1)}:${at(offset + 5, 1)})`);
      [levels - 1, width - 1, (levels - 1) * (width - 1), levels * width * (replication - 1), height * width - 1].forEach((value, i) => number(offset + 2 + i, 2, value));
      for (let i = 0; i < 4; i++) {
        const r = offset + 2 + i;
        formula(r, 3, `${at(r, 1)}/${at(r, 2)}`);
        if (i < 3) {
          formula(r, 4, `${at(r, 3)}/${at(offset + 5, 3)}`);
          formula(r, 5, `fdist(${at(r, 4)},${at(r, 2)},${at(offset + 5, 2)})`);
          formula(r, 6, `finv(${analysisFloat(Number(p.alpha))},${at(r, 2)},${at(offset + 5, 2)})`);
        }
      }
    } else {
    text(0, 0, "ANOVA: Two-Factor Without Replication");
    ["Summary", "Count", "Sum", "Average", "Variance"].forEach((value, column) => text(2, column, value));
    const rows: string[] = [], columns: string[] = [];
    for (let i = 0; i < height + width; i++) {
      const isRow = i < height, index = isRow ? i : i - height;
      const r = 3 + i + (isRow ? 0 : 1);
      const series = { ...range, ...(isRow ? { startRow: range.startRow + index, endRow: range.startRow + index } : { startColumn: range.startColumn + index, endColumn: range.startColumn + index }) };
      const expression = ref(series);
      (isRow ? rows : columns).push(expression);
      if (p.labels) formula(r, 0, ref({ ...series, ...(isRow ? { startColumn: input.startColumn, endColumn: input.startColumn } : { startRow: input.startRow, endRow: input.startRow }) }), true);
      else text(r, 0, `${isRow ? "Row" : "Column"} ${index + 1}`);
      ["count", "sum", "average", "var"].forEach((fn, column) => {
        const base = nativeInput(r, column + 1);
        const offset = isRow ? p.labels ? `${index + 1},1,1,${width}` : `${index},0,1`
          : `${p.labels ? 1 : 0},${index + (p.labels ? 1 : 0)},${height},1`;
        formula(r, column + 1, `${fn}(offset(${base},${offset}))`);
      });
    }
    const offset = height + width + 6;
    anovaValidityRow = offset; anovaErrorRow = offset + 4;
    formula(offset, 0, `if(count(${nativeRegion(offset, 0)})=${height * width},1,-1)`);
    ["Source of Variation", "SS", "df", "MS", "F", "P-value", "F critical"].forEach((value, column) => text(offset + 1, column, value));
    ["Rows", "Columns", "Error", "Total"].forEach((value, row) => text(offset + 2 + row, 0, value));
    const factor = (r: number, rows: boolean) => {
      const base = nativeRegion(r, 1), count = rows ? height : width;
      return `sumsq(${Array.from({ length: count }, (_, i) => count - i - 1).map(i =>
        `sum(offset(${base},${rows ? i : 0},${rows ? 0 : i},${rows ? 1 : height},${rows ? width : 1}))`).join(",")})/${rows ? width : height}`;
    };
    const correction = (r: number) => `sum(${nativeRegion(r, 1)})^2/count(${nativeRegion(r, 1)})`;
    formula(offset + 2, 1, `${factor(offset + 2, true)}-${correction(offset + 2)}`);
    formula(offset + 3, 1, `${factor(offset + 3, false)}-${correction(offset + 3)}`);
    formula(offset + 4, 1, `sumsq(${nativeRegion(offset + 4, 1)})+${correction(offset + 4)}-(${factor(offset + 4, true)}+${factor(offset + 4, false)})`);
    formula(offset + 5, 1, `sum(${at(offset + 2, 1)}:${at(offset + 4, 1)})`);
    number(offset + 2, 2, height - 1); number(offset + 3, 2, width - 1);
    formula(offset + 4, 2, `${at(offset + 3, 2)}*${at(offset + 2, 2)}`);
    formula(offset + 5, 2, `sum(${at(offset + 2, 2)}:${at(offset + 4, 2)})`);
    for (let i = 0; i < 3; i++) {
      const r = offset + 2 + i;
      formula(r, 3, `${at(r, 1)}/${at(r, 2)}`);
      if (i < 2) {
        formula(r, 4, `${at(r, 3)}/${at(offset + 4, 3)}`);
        formula(r, 5, `fdist(${at(r, 4)},${at(r, 2)},${at(offset + 4, 2)})`);
        formula(r, 6, `finv(${analysisFloat(Number(p.alpha))},${at(r, 2)},${at(offset + 4, 2)})`);
      }
    }
    }
  } else throw new SsconvertError("unsupported-feature", `Unsupported ssconvert analysis tool: ${tool}`);
  let id = options.outputSheetName;
  while ([...book.sheets, ...book.detachedSheets ?? []].some(sheet => sheet.id === id)) id += "_";
  if (anovaValidityRow !== undefined) merges.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 4 },
    { startRow: anovaValidityRow, endRow: anovaValidityRow, startColumn: 0, endColumn: 6 });
  const formatted = cells.map(cell => {
    if (tool === "kaplan-meier" && cell.row >= 2 && options.x && !("kind" in options.x) && cell.row <= options.x.endRow - options.x.startRow + 2) {
      const probability = p.censored ? 4 : 3;
      if (cell.column === probability) return { ...cell, format: "0.00%" };
      if (p["std-err"] && cell.column === probability + 1) return { ...cell, format: "0.0000" };
    }
    if (tool === "chi-squared-test" && cell.row === 0 && cell.column === 0) {
      const title = p.independence ? "Independence" : "Homogeneity";
      return { ...cell, format: `[>=5]"Test of ${title}";[<5][Red]"Invalid Test of ${title}"`,
        style: { italic: true, horizontalAlignment: "center", verticalAlignment: "bottom" } };
    }
    if (anovaValidityRow !== undefined) {
      if (cell.row === anovaValidityRow && cell.column === 0) return { ...cell, format: '"ANOVA";[Red]"Invalid ANOVA: Missing Observations"', style: { italic: true, horizontalAlignment: "left", verticalAlignment: "bottom" } };
      if (cell.row === anovaValidityRow + 1 || cell.row === anovaErrorRow) {
        const namespace = "http://www.gnumeric.org/v10.dtd";
        return { ...cell, style: { ...cell.style, ...(cell.row === anovaValidityRow + 1 ? { italic: true } : {}), gnumeric: {
          name: "Style", namespace, attributes: [], children: [{ name: "StyleBorder", namespace, attributes: [], children: [{ name: "Bottom", namespace,
            attributes: [{ name: "Style", namespace: "", value: "1" }, { name: "Color", namespace: "", value: "0:0:0" }], children: [] }] }]
        } } };
      }
    }
    if (tool === "regression" && p["multiple-regression"]) {
      if (cell.row === 15 && cell.column >= 5) return { ...cell, format: cell.column === 5 ? '"Lower" 0%' : '"Upper" 0%', style: { italic: true, horizontalAlignment: cell.column === 5 ? "left" : "right", verticalAlignment: "top" } };
      const dimension = options.x && !("kind" in options.x) ? (rowGroups ? options.x.endRow - options.x.startRow : options.x.endColumn - options.x.startColumn) + 1 : 0;
      if (p.residual && cell.row === 18 + dimension) return { ...cell, style: { ...cell.style, italic: true } };
    }
    if (tool === "principal-components") {
      if (cell.row === 0 && cell.column === 0) return { ...cell, format: '"Principal Components Analysis";[Red]"Principal Components Analysis is invalid."', style: { italic: true, bold: true, horizontalAlignment: "left", verticalAlignment: "bottom" } };
      if (cell.row === 11 + 3 * ranges.length && cell.column > 0) return { ...cell, format: "0.00%" };
    }
    if (tool === "ranking" && cell.row >= 2 && cell.column % 4 === 3) return { ...cell, format: "0%" };
    if (tool === "frequency-tables" && p.percentage && cell.row >= 2 && cell.column > 0) return { ...cell, format: "0.0%" };
    if (tool === "exponential-smoothing" && cell.row === 1 && cell.column === 0) return { ...cell, format: '"α =" * 0.000' };
    if (tool === "exponential-smoothing" && Number(p["es-type"]) === 2 && cell.row === 1 && cell.column === 1) return { ...cell, format: '"γ =" * 0.000' };
    if (tool === "exponential-smoothing" && [3,4].includes(Number(p["es-type"])) && cell.row === 0 && cell.column >= 2 && cell.column <= 4) return { ...cell, format: `"${["α","γ","δ"][cell.column - 2]} =" * 0.000` };
    if (tool === "histogram") {
      const bits = Number(p["bin-type"]), toColumn = p.cumulative ? 0 : 1;
      const end = Number(p.n) + (bits & 4 ? 1 : 0) + (bits & 2 ? 1 : 0);
      if (cell.column === toColumn && cell.row === 1) return { ...cell, format: '"";""' };
      if (cell.column === toColumn && cell.row >= 2) return { ...cell, format: bits & 2 && cell.row === end ? '"to" * "∞"' : bits & 1 ? '"to below" * General' : '"up to" * General' };
      if (!p.cumulative && cell.column === 0 && cell.row >= 2) return { ...cell, format: bits & 4 && cell.row === 2 ? '"from" * "−∞";"from" * "−∞"' : bits & 1 ? '"from" * General' : '"above" * General' };
      if (p.percentage && cell.column > toColumn && cell.row >= 2) return { ...cell, format: "0.0%" };
    }
    return cell;
  });
  const chartRecords = tool === "kaplan-meier" && p.chart && options.x && !("kind" in options.x)
    ? [kaplanMeierChart(options.outputSheetName, options.x.endRow - options.x.startRow + 1, p.censored ? 4 : 3, Boolean(p.censored && p.ticks), size, context)] : [];
  const comments: UnsupportedRecord[] = [];
  const comment = (row: number, column: number, text: string) => {
    context.signal.throwIfAborted();
    if (row < size.rows && column < size.columns) comments.push({ source: "Gnumeric_XmlIO:sax", kind: "CellComment", disposition: "retained", data: {
      ObjectBound: formatA1(row, column, size), ObjectOffset: "1 0 1 0", Direction: "17", Print: "1", Text: text,
    } });
  };
  if (tool === "chi-squared-test") comment(4, 0, `α = ${doubleDiagnostic(Number(p.alpha), "", 2)}`);
  if (tool === "wilcoxon-signed-rank-test" || tool === "wilcoxon-signed-rank-test-two-samples") {
    const paired = tool === "wilcoxon-signed-rank-test-two-samples";
    for (let c = 1; c <= (paired ? 1 : ranges.length); c++) comment(paired ? 9 : 8, c,
      "This p-value is calculated by a normal approximation.\nIt is only valid if the sample size is at least 12.");
  }
  if (tool === "wilcoxon-mann-whitney") comment(8, 1,
    "This p-value is calculated using a\nnormal approximation, so it is\nonly valid for large samples of\nat least 15 observations in each\npopulation, and few if any ties.");
  const records = [...chartRecords, ...comments];
  let result: Workbook = { ...book, activeSheet: id, sheets: [...book.sheets, { id, name: options.outputSheetName, size, cells: formatted, ...(formulaGroups.length ? { formulaGroups } : {}), ...(merges.length ? { merges } : {}), ...(records.length ? { unsupportedRecords: records } : {}) }] };
  if (!options.putFormulas) {
    result = await recalculateWithDiagnostics(result, context, true);
    result = { ...result, sheets: result.sheets.map(sheet => sheet.id !== id ? sheet : { ...sheet, formulaGroups: [], cells: sheet.cells.map(cell => {
      const { formula: ignoredFormula, formulaDirty: ignoredDirty, cachedResult: ignoredCache, formulaGroup: ignoredGroup, ...value } = cell;
      return value;
    }) }) };
  }
  context.signal.throwIfAborted();
  return result;
}
