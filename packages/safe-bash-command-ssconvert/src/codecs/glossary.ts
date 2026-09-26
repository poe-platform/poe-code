import type { Codec } from "./types.js";
import { SsconvertError } from "../contracts.js";
import { documentOutput, documentSheet } from "./document-export.js";
import { localizedValueText, formattingLocale } from "../formatting/locale.js";

/** Entry construction from plugins/gnome-glossary/gnome_glossary.py (1.12.61).
 * The legacy plugin does not escape PO literals or transcode to its CHARSET marker.
 * Its Python runtime is unavailable in the captured native profile.
 */
export const writeGlossary: NonNullable<Codec["write"]> = async (book, _options, context) => {
  const out = documentOutput(context, "glossary");
  if (book.sheets.length > context.limits.sheets) throw new SsconvertError("resource-limit", "ssconvert document sheets limit exceeded");
  const locale = formattingLocale(context.environment.locale);
  let glossary: ReturnType<typeof documentSheet> | undefined;
  for (const sheet of book.sheets) {
    out.tick(); const candidate = documentSheet(sheet, context, out.tick, false);
    const cell = candidate.cells.get("0:0");
    if (cell && localizedValueText(cell.cachedResult ?? cell.value, locale) === "Term") { glossary = candidate; break; }
  }
  if (!glossary) throw new SsconvertError("invalid-request", "Could not find Gnome Glossary sheet");
  if (!context.clock) throw new SsconvertError("capability-denied", "ssconvert glossary requires an injected clock");
  const filename = (context.outputFilename ?? "").split("/").at(-1) ?? "";
  const dot = filename.lastIndexOf("."); const lang = dot > 0 ? filename.slice(0, dot) : filename;
  const valueAt = (row: number, column: number) => { out.tick(); const cell = glossary!.cells.get(`${row}:${column}`); return cell ? localizedValueText(cell.cachedResult ?? cell.value, locale) : ""; };
  let languageColumn = Math.max(2, glossary.extent.endColumn + 1);
  for (let col = 2; col <= glossary.extent.endColumn; col++) if (valueAt(0, col).toLowerCase() === lang) { languageColumn = col; break; }
  const time = context.clock.now(); context.signal.throwIfAborted();
  if (!Number.isFinite(time)) throw new SsconvertError("invalid-request", "Invalid ssconvert glossary clock");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: context.environment.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" }).formatToParts(time);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}${part("timeZoneName")}`;
  out.put('# SOME DESCRIPTIVE TITLE.\n# Copyright (C) YEAR Free Software Foundation, Inc.\n# FIRST AUTHOR <EMAIL@ADDRESS>, YEAR.\n#\n#, fuzzy\nmsgid ""\nmsgstr ""\n"Project-Id-Version: Gnome Glossary\\n"\n');
  out.put(`"POT-Creation-Date: ${date}\\n"\n`);
  out.put('"PO-Revision-Date: YEAR-MO-DA HO:MI+ZONE\\n"\n"Last-Translator: FULL NAME <EMAIL@ADDRESS>\\n"\n');
  out.put(`"Language-Team: LANGUAGE <${lang}@li.org>\\n"\n`);
  out.put('"MIME-Version: 1.0\\n"\n"Content-Type: text/plain; charset=CHARSET\\n"\n"Content-Transfer-Encoding: ENCODING\\n"\n');
  const entries: { term: string; definitions: string[]; translation: string }[] = [];
  for (let row = 1; row <= glossary.extent.endRow; row++) {
    const term = valueAt(row, 0), definition = valueAt(row, 1), translation = valueAt(row, languageColumn);
    if (term) entries.push({ term, definitions: definition.split("\n"), translation });
    else if (definition) {
      const previous = entries.at(-1);
      if (!previous) throw new SsconvertError("invalid-request", "Gnome Glossary definition has no preceding term");
      previous.definitions.push(...definition.split("\n"));
    }
  }
  for (const entry of entries) {
    out.put("\n"); for (const definition of entry.definitions) out.put(`#. ${definition}\n`);
    out.put(`msgid "${entry.term}"\nmsgstr "${entry.translation}"\n`);
  }
  return out.finish();
};
