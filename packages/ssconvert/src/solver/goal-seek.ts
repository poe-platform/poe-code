import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { getCell, updateWorkbook, type Workbook, type CellRange, type CellValue } from "../workbook.js";
import { recalculateWorkbook } from "../formulas/evaluator.js";
import { FinancialGoalSeek } from "../formulas/functions/financial-goal-seek.js";

/** value_get_as_float: raw C-locale numeric prefixes, not display-format parsing. */
function asFloat(value?: CellValue): number {
  if (value?.kind === "number") return value.value;
  if (value?.kind === "boolean") return Number(value.value);
  if (value?.kind !== "string") return 0;
  let start = 0;
  while (start < value.value.length && " \t\n\r\v\f".includes(value.value[start]!)) start++;
  const text = value.value.slice(start), lower = text.toLowerCase();
  const unsigned = lower[0] === "+" || lower[0] === "-" ? lower.slice(1) : lower;
  if (unsigned.startsWith("inf")) return lower[0] === "-" ? -Infinity : Infinity;
  if (unsigned.startsWith("nan")) return NaN;
  return text[0] !== undefined && "+-.0123456789".includes(text[0]) ? Number.parseFloat(text) || 0 : 0;
}

/** Saved normal variate belongs to one conversion invocation, never a realm global. */
export interface GoalSeekState { normal?: number }

/** dialog_goal_seek(NULL, active_sheet)'s five-cell test hook. */
export async function goalSeekRange(book: Workbook, range: CellRange, context: CapabilityContext,
  state: GoalSeekState = {}): Promise<Workbook> {
  context.signal.throwIfAborted();
  const active = book.sheets.find(s => s.id === book.activeSheet) ?? book.sheets[0]!;
  const assertion = range.sheet !== active.id ? "start_sheet == sheet" :
    range.startRow !== range.endRow ? "range->start.row == range->end.row" :
    range.startColumn + 4 !== range.endColumn ? "range->start.col + 4 == range->end.col" : undefined;
  if (assertion) {
    await context.diagnostic?.({ code: "goal-seek-range", severity: "warning",
      message: `${range.sheet !== active.id ? "dialog_goal_seek" : "dialog_goal_seek_test"}: assertion '${assertion}' failed` });
    return book;
  }
  const row = range.startRow, column = range.startColumn;
  const value = (offset: number) => getCell(active, row, column + offset)?.value;
  const target = asFloat(value(2));
  const minimum = !value(3) || value(3)!.kind === "blank" ? -1e24 : asFloat(value(3));
  const maximum = !value(4) || value(4)!.kind === "blank" ? 1e24 : asFloat(value(4));
  const old = value(1), hadOld = old && old.kind !== "blank" && old.kind !== "error", oldX = asFloat(old);
  // Fetching the strip creates empty cells even when the search subsequently fails.
  book = updateWorkbook(book, Array.from({ length: 5 }, (_, offset) => ({
    ...(getCell(active, row, column + offset) ?? { row, column: column + offset, value: { kind: "blank" as const } }), sheet: active.id
  })), context.limits);
  let work = 0;
  const tick = () => {
    context.signal.throwIfAborted();
    if (++work > (context.limits.workbookWork ?? context.limits.cells * 32 + context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
  };
  const write = (v: CellValue) => {
    // value_new_float canonicalizes zero and turns nonfinite values into #NUM!.
    if (v.kind === "number") v = Number.isFinite(v.value)
      ? { kind: "number", value: v.value === 0 ? 0 : v.value }
      : { kind: "error", value: "#NUM!" };
    const previous = getCell(book.sheets.find(s => s.id === active.id)!, row, column + 1)!;
    const { formula: ignoredFormula, cachedResult: ignoredCache, displayedText: ignoredDisplay, formulaDirty: ignoredDirty, ...retained } = previous;
    book = updateWorkbook(book, [{ ...retained, sheet: active.id, value: v }], context.limits);
  };
  const search = new FinancialGoalSeek(x => {
    write({ kind: "number", value: x });
    book = recalculateWorkbook(book, context, false, undefined, {
      changed: { sheet: active.id, row, column: column + 1 }, target: { sheet: active.id, row, column }, tick
    });
    const result = getCell(book.sheets.find(s => s.id === active.id)!, row, column)!.value;
    return result.kind === "number" && Number.isFinite(result.value - target) ? result.value - target : NaN;
  }, { tick }, minimum, maximum);
  let success = search.newton(hadOld && oldX >= minimum && oldX <= maximum ? oldX : (minimum + maximum) / 2);
  const uniform = () => {
    tick();
    if (!context.random) throw new SsconvertError("capability-denied", "ssconvert goal seek requires an explicit random source");
    const x = context.random.next();
    if (!Number.isFinite(x) || x < 0 || x >= 1) throw new SsconvertError("invalid-request", "Invalid random value");
    return x;
  };
  const normal = () => {
    if (state.normal !== undefined) { const n = state.normal; delete state.normal; return n; }
    let u: number, v: number, r: number;
    do { u = 2 * uniform() - 1; v = 2 * uniform() - 1; r = u * u + v * v; } while (r > 1 || r === 0);
    const scale = Math.sqrt(-2 * Math.log(r) / r); state.normal = v * scale; return u * scale;
  };
  if (!success && !search.bracketed && !(minimum > maximum))
    for (let i = 0; i < 100 && !search.bracketed && !success; i++) success = search.point(minimum + (maximum - minimum) * uniform());
  for (const [mu, points] of [[(minimum + maximum) / 2, 30], [minimum, 20], [maximum, 20]] as const) {
    if (success || search.bracketed) break;
    let sigma = Math.min(maximum - minimum, 1e6);
    for (let i = 0; i < 5 && !success; i++) {
      sigma /= 10;
      if (sigma <= 0 || mu < minimum || mu > maximum) continue;
      for (let j = 0; j < points && !success && !search.bracketed; j++) success = search.point(mu + sigma * normal());
    }
  }
  if (!success && !search.bracketed) for (let i = 1; i <= 10 && !success; i++) success = search.newton(minimum + (maximum - minimum) / 11 * i);
  if (!success) success = search.bisect();
  write(success ? { kind: "number", value: search.root } : { kind: "error", value: "#VALUE!" });
  book = recalculateWorkbook(book, context, false, undefined, {
    changed: { sheet: active.id, row, column: column + 1 }, target: null, tick
  });
  return book;
}
