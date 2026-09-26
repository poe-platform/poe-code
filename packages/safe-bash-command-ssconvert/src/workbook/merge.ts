import { SsconvertError, type CapabilityContext, type RuntimeLimits } from "../contracts.js";
import { DEFAULT_SHEET_SIZE, snapshotWorkbook, type Workbook } from "../workbook.js";
import { foldSheetName } from "./case-fold.js";
import { remapWorkbookSheets } from "../formulas/workbook.js";
import { converterLocale } from "../locale/runtime.js";

/** Append sheets to the fresh destination without importing source workbook settings. */
export function mergeWorkbookSheets(target: Workbook, incoming: Workbook, limits: RuntimeLimits, context?: CapabilityContext): Workbook {
  context?.signal.throwIfAborted();
  let work = 0;
  const maximumWork = limits.workbookWork ?? limits.inputBytes + limits.cells * 32;
  const charge = () => {
    context?.signal.throwIfAborted();
    if (++work > maximumWork)
      throw new SsconvertError("resource-limit", "ssconvert workbook work limit exceeded");
  };
  if (incoming.detachedSheets?.length)
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: merge reference records");
  const count = target.sheets.length + incoming.sheets.length;
  let cells = 0;
  for (const book of [target, incoming]) for (const sheet of book.sheets) cells += sheet.cells.length;
  if (count > limits.sheets || cells > limits.cells)
    throw new SsconvertError("resource-limit", "ssconvert workbook storage limit exceeded");
  const names = new Set(target.sheets.map((sheet) => foldSheetName(sheet.name)));
  const ids = new Set(target.sheets.map((sheet) => sheet.id));
  const workbookNames = (incoming.names ?? []).filter(name => name.sheet === undefined)
    .sort((a, b) => {
      charge();
      const left = Array.from(foldSheetName(a.name).normalize("NFKC"), character => character.codePointAt(0)!);
      const right = Array.from(foldSheetName(b.name).normalize("NFKC"), character => character.codePointAt(0)!);
      for (let index = 0; index < Math.min(left.length, right.length); index++)
        if (left[index] !== right[index]) return left[index]! - right[index]!;
      return left.length - right.length;
    });
  for (const name of workbookNames)
    if (target.names?.some(other => { charge(); return other.sheet === undefined && other.name === name.name; })) {
      const spelling = context && converterLocale(context.environment) === "C"
        ? Array.from(name.name, character => character.codePointAt(0)! < 128 ? character : "?").join("") : name.name;
      throw new SsconvertError("invalid-request", `Name conflict during merge: '${spelling}' appears twice at workbook scope.`);
    }
  const appended = incoming.sheets.map((sheet) => {
    let name = sheet.name, id = sheet.id;
    if (names.has(foldSheetName(name))) {
      // workbook_sheet_name_strip_number defaults to 1, then free-name increments.
      let base = name, counter = 1;
      const open = name.lastIndexOf("(");
      const digits = name.slice(open + 1, -1);
      // Native strtoul also accepts the empty suffix as zero: its end pointer
      // already equals the closing parenthesis, which is the only conversion check.
      if (open >= 0 && name.endsWith(")") && Array.from(digits).every((digit) => digit >= "0" && digit <= "9")) {
        const parsed = Number(digits);
        if (Number.isSafeInteger(parsed) && parsed <= 4294967295) { base = name.slice(0, open); counter = parsed; }
      }
      do {
        charge();
        counter = (counter + 1) % 4294967296;
        name = `${base}(${counter})`;
      } while (names.has(foldSheetName(name)));
    }
    names.add(foldSheetName(name));
    let suffix = 0;
    while (ids.has(id)) { charge(); id = `${sheet.id}(${++suffix})`; }
    ids.add(id);
    return { ...sheet, id, name };
  });
  const rehomed = remapWorkbookSheets(incoming, new Map(incoming.sheets.map((sheet, index) => [sheet.id, { id: appended[index]!.id, name: appended[index]!.name }])),
    context ?? { limits, signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });
  const sheets = [...target.sheets, ...rehomed.sheets];
  const size = { rows: DEFAULT_SHEET_SIZE.rows, columns: DEFAULT_SHEET_SIZE.columns };
  for (const sheet of sheets) {
    size.rows = Math.max(size.rows, sheet.size?.rows ?? DEFAULT_SHEET_SIZE.rows);
    size.columns = Math.max(size.columns, sheet.size?.columns ?? DEFAULT_SHEET_SIZE.columns);
  }
  return snapshotWorkbook({ ...target, sheets: sheets.map((sheet) => ({ ...sheet, size })),
    ...(target.names?.length || rehomed.names?.length ? { names: [...target.names ?? [], ...rehomed.names ?? []] } : {}),
    ...(target.dependencies?.length || rehomed.dependencies?.length ? { dependencies: [...target.dependencies ?? [], ...rehomed.dependencies ?? []] } : {}),
    ...(sheets[0] === undefined ? {} : { activeSheet: sheets[0].id }) }, limits);
}
