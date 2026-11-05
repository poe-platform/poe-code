import type {SourceRange} from "./retained-source-text.js";
import type {AdapterContext} from "./types.js";

/** Scan at most three title fields, keeping storage-backed inputs as ranges. */
export async function markdownTitleBlock(
  unit: (offset: number) => string | Promise<string>, range: SourceRange, context: AdapterContext,
  field: (name: "title" | "author" | "date", value: SourceRange) => Promise<void>
): Promise<number> {
  let cursor = range.start;
  const trim = async (value: SourceRange) => {
    while (value.start < value.end && !(await unit(value.start)).trim()) {value.start++; await context.cooperate();}
    while (value.end > value.start && !(await unit(value.end - 1)).trim()) {value.end--; await context.cooperate();}
    return value;
  };
  for (const name of ["title", "author", "date"] as const) {
    if (cursor >= range.end || await unit(cursor) !== "%") break;
    const start = ++cursor;
    let end = cursor;
    while (cursor < range.end) {
      const char = await unit(cursor++);
      await context.cooperate();
      if (char !== "\n") {end = cursor; continue;}
      if (name === "date" || cursor >= range.end || ![" ", "\t"].includes(await unit(cursor))) break;
      let next = cursor;
      while (next < range.end && [" ", "\t", "\r"].includes(await unit(next))) {next++; await context.cooperate();}
      if (next === range.end || await unit(next) === "\n") break;
    }
    if (name === "author") {
      let begin = start;
      for (let offset = start; offset <= end; offset++) {
        await context.cooperate();
        if (offset !== end && ![";", "\n"].includes(await unit(offset))) continue;
        const value = await trim({start: begin, end: offset});
        if (value.start < value.end) await field(name, value);
        begin = offset + 1;
      }
    } else {
      const value = await trim({start, end});
      if (value.start < value.end) await field(name, value);
    }
  }
  return cursor;
}
