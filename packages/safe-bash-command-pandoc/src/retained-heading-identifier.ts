import {emptyText} from "./backed-text.js";
import type {RetainedRtfAst, RtfValue} from "./retained-rtf-ast.js";

/** Extract heading text without notes, raw markup, or link/format attributes. */
export async function retainedHeadingIdentifier(ast: RetainedRtfAst, inlines: RtfValue, gfm = false) {
  const text = emptyText();
  await ast.walk(inlines, async (value, _depth, leaving) => {
    if (leaving) return;
    const name = await ast.name(value), content = await ast.content(value);
    if (name === "Note" || name === "RawInline") return false;
    if (name === "Space" || name === "SoftBreak" || name === "LineBreak") {
      await ast.text.append(text, await ast.text.from([" "])); return false;
    }
    if (name === "Str" || name === "Code" || name === "Math") {
      const source = name === "Str" ? content! : (await ast.at(content!, 1))!;
      await ast.text.append(text, await ast.text.from(ast.text.chunks(await ast.range(source))));
      return false;
    }
    if (name === "Link" || name === "Image" || name === "Span" || name === "Quoted" || name === "Cite") {
      return {descend: (await ast.at(content!, 1))!};
    }
  });
  const lower = await ast.text.lower(text);
  let started = false;
  const id = await ast.text.from((async function* () {
    for await (const chunk of ast.text.unicodeChunks(lower)) {
      let output = "";
      for (const char of chunk) {
        if (!gfm && !started) {if (!/\p{L}/u.test(char)) continue; started = true;}
        if (/^[\p{L}\p{N}_-]$/u.test(char) || (gfm ? /\p{M}/u.test(char) : char === ".")) output += char;
        else if (char === " " || char === "\n") output += "-";
      }
      if (output) yield output;
    }
  })());
  return gfm || id.units ? id : ast.text.from(["section"]);
}
