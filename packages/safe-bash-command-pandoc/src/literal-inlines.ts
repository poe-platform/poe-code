import type { Inline } from "./ast-types.js";
import type { AdapterContext } from "./types.js";

/** Preserve literal cell text; whitespace gets AST constructors, never Markdown parsing. */
export async function literalInlines(value: string, context: AdapterContext, nodes = 0): Promise<Inline[]> {
  const inlines: Inline[] = [];
  let start = 0;
  // Spaces and embedded newlines get text constructors, never Markdown parsing.
  for (let offset = 0; offset <= value.length; offset++) {
    context.checkpoint();
    const char = value[offset];
    if (offset === value.length || char === " " || char === "\n") {
      if (offset > start) {
        context.bound("nodes", ++nodes);
        context.charge("references", 1);
        context.charge("retainedBytes", (offset - start) * 2 + 32);
        inlines.push({ t: "Str", c: value.slice(start, offset) });
      }
      if (char === " " || char === "\n") {
        context.bound("nodes", ++nodes);
        context.charge("references", 1);
        context.charge("retainedBytes", 32);
        inlines.push({ t: char === " " ? "Space" : "LineBreak" });
      }
      start = offset + 1;
    }
    if (offset % 256 === 255) await context.cooperate(0);
  }
  return inlines;
}
