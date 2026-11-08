import type {AdapterContext} from "./types.js";

/** Scan one citation using source coordinates so the retained reader need not
 * materialize a citation group or identifier in memory. */
export async function scanMarkdownCitation(start: number, at: (position: number) => string | undefined | Promise<string | undefined>, context: AdapterContext, bracketed = true) {
  const boundary = (char: string | undefined) => !!char && (char.toLowerCase() !== char.toUpperCase() || char >= "0" && char <= "9" || char === "_");
  const key = (char: string | undefined) => boundary(char) || !!char && ":.#$%&-+?<>~/".includes(char);
  let pageSpace = -1;
  const page = async (position: number) => {
    if (await at(position) === " " && await at(position - 1) === "." && await at(position - 2) === "p" && (await at(position + 1) ?? "") >= "0" && (await at(position + 1) ?? "") <= "9") pageSpace = position;
  };
  let cursor = start;
  if (!bracketed && await at(cursor) === "-") cursor++;
  while (bracketed && await at(cursor) && !"@[];".includes((await at(cursor))!)) {await context.cooperate(); cursor++;}
  if (await at(cursor) !== "@" || !boundary(await at(cursor + 1))) return;
  if (cursor > start && !" \t\n-".includes((await at(cursor - 1))!)) return;
  const suppressed = await at(cursor - 1) === "-", prefixEnd = cursor - Number(suppressed), idStart = ++cursor;
  while (key(await at(cursor))) {await context.cooperate(); cursor++;}
  // Internal punctuation is allowed; terminal punctuation belongs to the suffix.
  while (cursor > idStart && !boundary(await at(cursor - 1))) cursor--;
  if (cursor === idStart) return;
  const idEnd = cursor;
  if (!bracketed) {
    while ([" ", "\t"].includes(await at(cursor) ?? "")) {await context.cooperate(); cursor++;}
    if (await at(cursor) === "[") {
      const suffixStart = ++cursor;
      while (await at(cursor) && !"[]@;".includes((await at(cursor))!)) {await context.cooperate(); await page(cursor); cursor++;}
      if (await at(cursor) === "]") return {pageSpace, start, prefixEnd, idStart, idEnd, suffixStart, suffixEnd: cursor, end: cursor + 1, suppressed};
    }
    return {pageSpace, start, prefixEnd, idStart, idEnd, suffixStart: idEnd, suffixEnd: idEnd, end: idEnd, suppressed};
  }
  while (await at(cursor) && !"[];".includes((await at(cursor))!)) {
    await context.cooperate();
    await page(cursor);
    if (await at(cursor) === "\\" && await at(cursor + 1)) cursor++;
    cursor++;
  }
  if (await at(cursor) !== "]" && await at(cursor) !== ";") return;
  return {pageSpace, start, prefixEnd, idStart, idEnd, suffixStart: idEnd, suffixEnd: cursor, end: cursor, suppressed};
}
