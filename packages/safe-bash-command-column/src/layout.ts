import { cell, widthOf, type Cell } from "./display.js";
import type { ColumnBudget } from "./internal.js";
import { usage, type ParsedOptions } from "./options.js";
import { jsonOutput, tableOutput } from "./table.js";

async function selected(list: string, count: number, names: readonly string[], budget: ColumnBudget, flags?: readonly Set<string>[], named?: readonly boolean[], groups = true): Promise<number[]> {
  if (!list) return [];
  { const w = budget.work(count + names.length); if (w) await w; }
  if (groups && list === "0") return Array.from({ length: count }, (_, index) => index);
  const nameIndices = new Map<string, number>();
  for (let index = 0; index < names.length; index++) if (!nameIndices.has(names[index]!)) nameIndices.set(names[index]!, index);
  let lastVisible = count - 1;
  while (lastVisible >= 0 && flags?.[lastVisible]?.has("hide")) lastVisible--;
  const result = new Set<number>();
  const resolve = (value: string): number => {
    let index: number;
    if (value === "-1") {
      index = lastVisible;
    }
    else if (value && Array.from(value).every(character => character >= "0" && character <= "9")) index = Number(value) - 1;
    else index = nameIndices.get(value) ?? -1;
    if (index < 0 || index >= count) usage(`undefined column name '${value}'`);
    return index;
  };
  for (const value of list.split(",")) {
    { const s = budget.step(); if (s) await s; }
    if (groups && value === "-") {
      { const w = budget.work(count); if (w) await w; }
      for (let index = 0; index < count; index++) if (!(named?.[index] ?? index < names.length)) result.add(index);
    } else {
      const dash = value.indexOf("-", 1);
      if (groups && dash >= 0 && [value.slice(0, dash), value.slice(dash + 1)].every(part => part && Array.from(part).every(character => character >= "0" && character <= "9"))) {
        const first = resolve(value.slice(0, dash)), last = resolve(value.slice(dash + 1));
        await budget.work(Math.max(0, last - first + 1));
        for (let index = first; index <= last; index++) result.add(index);
      } else result.add(resolve(value));
    }
  }
  return [...result];
}

async function fitWidths(rows: readonly Cell[][], columns: readonly number[], widths: number[], minimum: readonly number[], flags: readonly Set<string>[], options: ParsedOptions, budget: ColumnBudget): Promise<void> {
  const separatorWidth = (await cell(options.outputSeparator, budget)).width;
  let total = separatorWidth * Math.max(0, columns.length - 1);
  const statistics = new Map<number, { average: number; deviation: number; maximum: number }>();
  for (const index of columns) {
    total += widths[index]!;
    let sum = 0, maximum = 0;
    for (const row of rows) { { const s = budget.step(); if (s) await s; } const width = row[index]?.width ?? 0; sum += width; maximum = Math.max(maximum, width); }
    const average = Math.floor(sum / rows.length);
    let squareSum = 0;
    for (const row of rows) { { const s = budget.step(); if (s) await s; } squareSum += ((row[index]?.width ?? 0) - average) ** 2; }
    const deviation = rows.length > 1 ? Math.sqrt(squareSum / (rows.length - 1)) : 0;
    statistics.set(index, { average, deviation, maximum });
  }
  const sorted = [...columns].sort((first, second) => {
    const a = statistics.get(first)!, b = statistics.get(second)!;
    return a.average + 3 * a.deviation - b.average - 3 * b.deviation;
  }).reverse();
  const minima = [...minimum];
  if (options.maxout) {
    let minTotal = columns.reduce((sum, index) => sum + minima[index]!, separatorWidth * (columns.length - 1));
    for (const index of columns) if (minTotal > options.width && minima[index]! > 0) { minima[index]!--; minTotal--; }
  }
  for (let stage = 0; total > options.width && stage <= 6;) {
    const before = total;
    for (let position = 0; position < sorted.length && total > options.width; position++) {
      { const s = budget.step(); if (s) await s; }
      const index = sorted[position]!, width = widths[index]!, min = minima[index]!;
      if (!width || width <= min) continue;
      const stat = statistics.get(index)!, extreme = flags[index]!.has("noextreme");
      const trunc = flags[index]!.has("truncate") || flags[index]!.has("wrap");
      if (stage === 0 && (position !== 0 || !trunc && !extreme)) continue;
      if (stage === 1 && (!extreme || stat.deviation < stat.average / 2)) continue;
      if (stage === 2 && !extreme) continue;
      if (stage <= 2 && stat.deviation < 1) continue;
      if (stage === 3 || stage === 4) continue;
      if (stage === 5 && (!(trunc || extreme) || stat.deviation < stat.average / 2.2)) continue;
      if (stage === 6 && !trunc && !extreme) continue;
      const reduction = stage <= 2
        ? Math.min(total - options.width, Math.max(0, width - Math.max(min, Math.floor(stat.average + stat.deviation))))
        : Math.min(width - min, position === 0 ? 3 : 1);
      // util-linux's unsigned width subtraction treats an oversized statistical target as a request to remove the overflow.
      const amount = stage <= 2 && Math.floor(stat.average + stat.deviation) > width
        ? Math.min(width, total - options.width) : reduction;
      widths[index] = width - amount;
      if (amount && !widths[index]) flags[index]!.add("hide");
      total -= amount;
    }
    if (total === before) stage++;
  }
  if (total < options.width) {
    for (const index of sorted) {
      { const s = budget.step(); if (s) await s; }
      if (!flags[index]!.has("noextreme") || !widths[index]) continue;
      const maximum = statistics.get(index)!.maximum;
      const add = maximum ? Math.min(options.width - total, maximum - widths[index]!) : options.width - total;
      widths[index]! += add;
      total += add;
      if (total === options.width) break;
    }
    if (options.maxout && total < options.width) {
      const extra = options.width - total, each = Math.floor(extra / sorted.length), remainder = extra % sorted.length;
      for (let position = 0; position < sorted.length; position++) widths[sorted[position]!]! += each + (position < remainder ? 1 : 0);
    } else if (total < options.width) {
      const last = columns.at(-1)!;
      if (!flags[last]!.has("right")) widths[last]! += options.width - total;
    }
  }
}

async function fragments(entry: Cell | undefined, width: number, wrap: boolean, truncate: boolean, budget: ColumnBudget): Promise<Cell[]> {
  if (!entry || entry.width <= width || !wrap && !truncate) return entry ? [entry] : [];
  const result: Cell[] = [];
  let start = 0, offset = 0, used = 0;
  for (const character of entry.text) {
    { const s = budget.step(); if (s) await s; }
    const size = widthOf(character.codePointAt(0)!);
    if (used + size > width && offset > start) {
      result.push({ text: entry.text.slice(start, offset), width: used });
      if (truncate) return result;
      start = offset; used = 0;
    }
    if (truncate && used + size > width) break;
    used += size; offset += character.length;
  }
  if (offset > start) result.push({ text: entry.text.slice(start, offset), width: used });
  return result;
}

export async function configuredTable(rows: readonly Cell[][], naturalWidths: readonly number[], options: ParsedOptions, budget: ColumnBudget, remainingCells: number): Promise<void> {
  if (!rows.length) return;
  const count = Math.max(naturalWidths.length, options.names.length);
  { const w = budget.work(count); if (w) await w; }
  const flags = Array.from({ length: count }, () => new Set<string>());
  const named = Array.from({ length: count }, (_, index) => options.definitions.length ? options.definitions[index]?.named ?? false : index < options.names.length);
  for (let index = 0; index < options.definitions.length; index++) {
    for (const flag of options.definitions[index]!.flags) flags[index]!.add(flag === "trunc" ? "truncate" : flag);
  }
  for (const [flag, list] of Object.entries(options.selectors)) {
    for (const index of await selected(list, count, options.names, budget, flags, named)) flags[index]!.add(flag);
  }
  if (!options.selectors.noextreme) {
    for (let index = count - 1; index >= 0; index--) if (!flags[index]!.has("hide")) { flags[index]!.add("noextreme"); break; }
  }
  const ordered = await selected(options.order, count, options.names, budget, flags, named, false);
  const included = new Set(ordered);
  for (let index = 0; index < count; index++) if (!included.has(index)) ordered.push(index);
  const columns = ordered.filter(index => !flags[index]!.has("hide"));
  if (options.json) {
    await jsonOutput(rows, options.names, options.tableName, budget, columns);
    return;
  }
  if (!columns.length) {
    if (options.names.length && !options.noHeadings) await budget.text("\n");
    for (let index = 0; index < rows.length; index++) await budget.text("\n");
    return;
  }
  budget.check(options.names.length, remainingCells, "cells");
  const headings: Cell[] = [];
  const widths = [...naturalWidths];
  const minimum: number[] = Array.from({ length: count }, (_, index) => naturalWidths[index] ? 1 : 0);
  for (let index = 0; index < options.names.length; index++) {
    const heading = await cell(options.names[index]!, budget);
    headings.push(heading);
    widths[index] = flags[index]!.has("strictwidth") ? widths[index] ?? 0 : Math.max(widths[index] ?? 0, heading.width);
    minimum[index] = Math.max(1, heading.width);
  }
  const simple = !options.order && !options.maxout && !options.headerRepeat && Object.values(options.selectors).every(value => !value) && !options.definitions.some(definition => definition.flags.length);
  if (simple) {
    await tableOutput(options.noHeadings || !headings.length ? rows : [headings, ...rows], widths, options.outputSeparator, budget);
    return;
  }
  await fitWidths(rows, columns, widths, minimum, flags, options, budget);
  for (let position = columns.length - 1; position >= 0; position--) if (flags[columns[position]!]!.has("hide")) columns.splice(position, 1);
  const separatorWidth = (await cell(options.outputSeparator, budget)).width;
  let lines = 0, nextHeader = 0;
  const emit = async (row: readonly Cell[]): Promise<void> => {
    { const w = budget.work(columns.length); if (w) await w; }
    const pieces: Cell[][] = [];
    let height = 1;
    for (const index of columns) {
      const wrap = flags[index]!.has("wrap");
      const parts = await fragments(row[index], widths[index]!, wrap && row !== headings, flags[index]!.has("truncate") || wrap && row === headings, budget);
      pieces.push(parts); height = Math.max(height, parts.length);
    }
    for (let line = 0; line < height; line++) {
      let indent = 0;
      for (let position = 0; position < columns.length; position++) {
        { const s = budget.step(); if (s) await s; }
        const index = columns[position]!, entry = pieces[position]![line];
        const width = widths[index] ?? 0, right = flags[index]!.has("right"), last = position + 1 === columns.length;
        const gap = Math.max(0, width - (entry?.width ?? 0));
        if (right && entry?.text) await budget.padding(gap);
        if (entry) await budget.text(entry.text);
        if (!last || options.maxout) {
          if (!right || !entry?.text) await budget.padding(gap);
          if (!right && (entry?.width ?? 0) > width) {
            await budget.text("\n"); lines++;
            await budget.padding(indent + width + (last ? 0 : separatorWidth));
          } else if (!last) await budget.text(options.outputSeparator);
        }
        indent += width + separatorWidth;
      }
      await budget.text("\n"); lines++;
    }
  };
  const header = async (): Promise<void> => { await emit(headings); nextHeader = lines + 24; };
  if (headings.length && !options.noHeadings) await header();
  for (let index = 0; index < rows.length; index++) {
    await emit(rows[index]!);
    if (options.headerRepeat && headings.length && !options.noHeadings && index + 1 < rows.length && lines >= nextHeader) await header();
  }
}
