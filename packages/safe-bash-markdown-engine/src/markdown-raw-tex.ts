import {letter} from "./commonmark-syntax.js";
import type {AdapterContext} from "./types.js";

/** Return source coordinates so working-file readers retain TeX without loading it. */
export async function scanMarkdownRawTex(start: number, at: (position: number) => string | undefined | Promise<string | undefined>, context: AdapterContext): Promise<number | undefined> {
  let end = start + 1;
  if (!letter(await at(end))) return;
  while (letter(await at(end))) {await context.cooperate(); end++;}
  if (await at(end) === "*") end++;
  while (await at(end) === "{" || await at(end) === "[") {
    const opening = await at(end), closing = opening === "{" ? "}" : "]";
    let cursor = end + 1, depth = 1;
    while (depth && await at(cursor) !== undefined) {
      await context.cooperate();
      const unit = await at(cursor++);
      if (unit === "\\") {if (await at(cursor) !== undefined) cursor++; continue;}
      if (unit === opening) {depth++; context.bound("depth", depth);}
      if (unit === closing) depth--;
    }
    if (depth) break;
    end = cursor;
  }
  return end;
}
