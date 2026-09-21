import { numericText } from "../formulas/values.js";
import { SsconvertError } from "../contracts.js";
import type { FormatHost } from "./number-format.js";

export interface FormatSection {
  readonly pattern: string;
  readonly color?: string;
  readonly condition?: { readonly operator: string; readonly value: number };
}
export class FormatSyntaxError extends Error {}

/** Scan XL syntax without interpreting characters inside quotes or escapes. */
export function parseFormatSections(pattern: string, host: FormatHost): readonly FormatSection[] {
  const sections: FormatSection[] = [];
  let output = "", quoted = false, color: string | undefined;
  let condition: FormatSection["condition"];
  const finish = () => {
    sections.push({ pattern: output, ...(color === undefined ? {} : { color }),
      ...(condition === undefined ? {} : { condition }) });
    output = ""; color = undefined; condition = undefined;
  };
  for (let index = 0; index < pattern.length; index++) {
    host.tick(); const c = pattern[index]!;
    if (c === "\\" && !quoted) { output += c + (pattern[++index] ?? ""); continue; }
    if (c === '"') { quoted = !quoted; output += c; continue; }
    if (quoted) { output += c; continue; }
    if (c === ";") { finish(); continue; }
    if (c === "_" || c === "*") {
      if (++index >= pattern.length) throw new FormatSyntaxError("Incomplete spacing token");
      // Unlimited-width string output has no fill repetitions. Underscore
      // reserves one character; exact font-width layout is a separate concern.
      if (c === "_") output += '" "';
      continue;
    }
    if (c !== "[") { output += c; continue; }
    let end = index + 1;
    while (end < pattern.length && pattern[end] !== "]") { host.tick(); end++; }
    if (end === pattern.length) throw new FormatSyntaxError("Unclosed format tag");
    const tag = pattern.slice(index + 1, end), lower = tag.toLowerCase();
    if (["black", "blue", "cyan", "green", "magenta", "red", "white", "yellow"].includes(lower)
      || lower.startsWith("color") && Number.isInteger(Number(lower.slice(5))) && Number(lower.slice(5)) >= 1 && Number(lower.slice(5)) <= 56) color = tag;
    else if ("<=>".includes(tag[0] ?? "\0")) {
      const operator = ["<=", ">=", "<>"].includes(tag.slice(0, 2)) ? tag.slice(0, 2) : tag[0]!;
      const value = numericText(tag.slice(operator.length));
      if (value === undefined || condition) throw new FormatSyntaxError("Invalid format condition");
      condition = { operator, value };
    } else if (tag.startsWith("$")) {
      const dash = tag.lastIndexOf("-"), currency = tag.slice(1, dash < 0 ? tag.length : dash);
      // GOffice's currency/LCID tag emits the symbol under the explicit
      // invocation locale. It does not select an ambient Intl locale.
      output += '"' + currency + '"';
    } else if (lower && "hms".includes(lower[0]!) && Array.from(lower).every(c => c === lower[0])) output += "[" + lower + "]";
    else throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: format tag [${tag}]`);
    index = end;
  }
  if (quoted || sections.length >= 4) throw new FormatSyntaxError("Invalid format sections");
  finish(); return sections;
}

export function selectFormatSection(sections: readonly FormatSection[], value: number): { section: FormatSection; magnitude: boolean } {
  if (sections.some(section => section.condition)) {
    const noZeroFormat = sections.length <= 2 || sections[2]?.condition !== undefined;
    const negativeExplicit = sections.length >= 2 && sections[1]?.condition !== undefined;
    let magnitude = false, lastImplicit: FormatSection | undefined, previousImplicit = false;
    for (const [index, section] of sections.slice(0, 3).entries()) {
      const implicit = section.condition === undefined;
      if (!implicit) {
        if (previousImplicit) magnitude = false;
        lastImplicit = undefined;
      } else lastImplicit = section;
      previousImplicit = implicit;
      const condition = section.condition ?? {
        operator: index === 0 ? noZeroFormat && !negativeExplicit ? ">=" : ">" : index === 1 ? noZeroFormat ? "any" : "<" : "=",
        value: 0
      };
      const threshold = condition.value;
      const matches: Readonly<Record<string, boolean>> = { "<": value < threshold, "<=": value <= threshold,
        ">": value > threshold, ">=": value >= threshold, "=": value === threshold, "<>": value !== threshold, any: true };
      const trueInhibits = condition.operator === "<" ? threshold <= 0 : ["<=", "="].includes(condition.operator) && threshold < 0;
      let falseInhibits = [">", ">="].includes(condition.operator) ? threshold <= 0 : condition.operator === "<>" && threshold < 0;
      // With two numeric sections GOffice extends a negative first condition's
      // sign suppression to its implicit fallback.
      if (index === 0 && noZeroFormat && sections[1]?.condition === undefined && trueInhibits) falseInhibits = true;
      if (matches[condition.operator]) return { section, magnitude: magnitude || trueInhibits };
      magnitude ||= falseInhibits;
    }
    return { section: lastImplicit ?? { pattern: "General" }, magnitude: false };
  }
  const index = value < 0 && sections.length > 1 ? 1 : value === 0 && sections.length > 2 ? 2 : 0;
  return { section: sections[index]!, magnitude: index === 1 };
}
