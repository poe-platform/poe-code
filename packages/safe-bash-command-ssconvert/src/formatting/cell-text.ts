import { SsconvertError, type CapabilityContext } from "../contracts.js";
import type { Cell, CellValue, Workbook } from "../workbook.js";
import { cellValueFormat } from "../workbook/value-format.js";
import type { FormattingCapability, FormatOptions, TextFormatMode } from "../formatting.js";
import { formatText, type FormatHost } from "./number-format.js";
import { parseFormatSections, selectFormatSection } from "./sections.js";
import { scanFormat } from "./numeric.js";
import { formattingLocale, localizedValueText } from "./locale.js";

function checkedText(text: string, context: CapabilityContext): string {
  context.signal.throwIfAborted();
  if (text.length > context.limits.outputBytes || new TextEncoder().encode(text).length > context.limits.outputBytes)
    throw new SsconvertError("resource-limit", "ssconvert formatting text limit exceeded");
  return text;
}
function admitPattern(pattern: string, context: CapabilityContext): void {
  const maximum = context.limits.workbookTextBytes ?? context.limits.inputBytes;
  if (pattern.length > maximum || new TextEncoder().encode(pattern).length > maximum)
    throw new SsconvertError("resource-limit", "ssconvert formatting pattern limit exceeded");
}
function formatHost(context: CapabilityContext, options: FormatOptions): FormatHost {
  let work = 0;
  return { context, locale: formattingLocale(context.environment.locale), book: options.dateSystem === undefined ? {} : { dateSystem: options.dateSystem },
    ...(options.unicodeMinus === undefined ? {} : { unicodeMinus: options.unicodeMinus }),
    tick() {
      context.signal.throwIfAborted();
      if (++work > (context.limits.workbookWork ?? context.limits.inputBytes))
        throw new SsconvertError("resource-limit", "ssconvert formatting work limit exceeded");
    } };
}

/** Stateless, explicit-locale, unlimited-width GOffice string formatter. */
export function createFormattingCapability(): FormattingCapability {
  return Object.freeze({ async format(value: CellValue, pattern: string, context: CapabilityContext, options: FormatOptions = {}) {
    context.signal.throwIfAborted();
    admitPattern(pattern, context);
    const result = formatText(value, pattern, formatHost(context, options));
    return checkedText(result.kind === "error" && options.unicodeMinus ? "" : localizedValueText(result, formattingLocale(context.environment.locale)), context);
  } });
}
const formatting = createFormattingCapability();

/** Text-export selection follows stf-export.c without altering any cell metadata. */
export async function renderCellText(cell: Cell, book: Workbook, context: CapabilityContext, mode: TextFormatMode = "automatic"): Promise<string> {
  context.signal.throwIfAborted();
  const value = cell.cachedResult ?? cell.value;
  if (mode === "raw") return checkedText(localizedValueText(value, formattingLocale(context.environment.locale)), context);
  if (mode === "preserve" && cell.displayedText !== undefined) return checkedText(cell.displayedText, context);
  const options: FormatOptions = { ...(book.dateSystem === undefined ? {} : { dateSystem: book.dateSystem }), unicodeMinus: mode === "preserve" };
  const capability = context.formatting ?? formatting;
  const cellPattern = cell.format !== undefined && cell.format !== "General" ? cell.format :
    cellValueFormat(cell) ?? "General";
  if (mode === "preserve") return checkedText(await capability.format(value, cellPattern, context, options), context);
  if (value.kind !== "number") return checkedText(localizedValueText(value, formattingLocale(context.environment.locale)), context);
  admitPattern(cellPattern, context);
  const host = formatHost(context, options);
  const section = selectFormatSection(parseFormatSections(cellPattern, host), value.value).section;
  const tokens = scanFormat(section.pattern, host).filter(token => !token.literal).map(token => token.text.toLowerCase()).join("");
  const elapsed = tokens.includes("[h") || tokens.includes("[m") || tokens.includes("[s");
  const isTime = elapsed || tokens.includes("h") || tokens.includes("s") || tokens.includes("am/pm") || tokens.includes("a/p");
  const isDate = tokens.includes("y") || tokens.includes("d") || tokens.includes("m") && !isTime;
  if (!isDate && !isTime) return checkedText(await capability.format(value, "General", context, options), context);
  // The phantom 1900-02-29 and out-of-range dates cannot be automatically coerced.
  const validity = formatText(value, "yyyy", host);
  if (validity.kind === "error") return checkedText(localizedValueText(value, formattingLocale(context.environment.locale)), context);
  const roundedSerial = Math.round(value.value), seconds = 86400 * Math.abs(value.value - roundedSerial);
  const needsDate = !elapsed && (isDate || Math.abs(value.value) >= 1);
  const needsTime = isTime || Math.abs(value.value - roundedSerial) > 1e-9;
  const needsFraction = needsTime && Math.abs(seconds - Math.round(seconds)) >= .0005;
  let pattern = needsDate ? "yyyy/mm/dd" : "";
  if (needsTime) pattern += (needsDate ? " " : "") + (elapsed ? "[h]:mm:ss" : "hh:mm:ss") + (needsFraction ? ".000" : "");
  return checkedText(await capability.format(value, pattern, context, options), context);
}
