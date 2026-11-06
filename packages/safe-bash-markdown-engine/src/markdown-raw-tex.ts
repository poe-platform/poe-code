import {letter} from "./commonmark-syntax.js";
import type {AdapterContext} from "./types.js";

/** Return source coordinates so working-file readers retain TeX without loading it. */
export async function scanMarkdownRawTex(start: number, at: (position: number) => string | undefined | Promise<string | undefined>, context: AdapterContext): Promise<number | undefined> {
  const matches = async (position: number, text: string) => {
    for (let i = 0; i < text.length; i++) if (await at(position + i) !== text[i]) return false;
    return true;
  };
  let end = start + 1;
  if (!letter(await at(end))) return;
  while (letter(await at(end))) {await context.cooperate(); end++;}
  if (await at(end) === "*") end++;
  const environment = await matches(start, "\\begin{");
  const nameStart = end + 1;
  let nameEnd = nameStart;
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
    if (end + 1 === nameStart) nameEnd = cursor - 1;
    end = cursor;
  }
  if (environment && nameEnd > nameStart) {
    let depth = 1;
    for (let cursor = end; await at(cursor) !== undefined; cursor++) {
      await context.cooperate();
      if (await at(cursor) === "%") {
        while (await at(cursor) !== undefined && await at(cursor) !== "\n") {await context.cooperate(); cursor++;}
      }
      if (await at(cursor) !== "\\") continue;
      const opening = await matches(cursor, "\\begin{"), closing = await matches(cursor, "\\end{");
      if (!opening && !closing) {cursor++; continue;}
      let position = cursor + (opening ? 7 : 5), name = nameStart;
      while (name < nameEnd && await at(position) === await at(name)) {await context.cooperate(); position++; name++;}
      if (name !== nameEnd || await at(position) !== "}") continue;
      depth += opening ? 1 : -1;
      context.bound("depth", depth);
      if (!depth) return position + 1;
      cursor = position;
    }
  }
  return end;
}
