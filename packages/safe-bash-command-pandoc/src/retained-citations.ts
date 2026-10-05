import type {AdapterContext} from "safe-bash-markdown-engine/types";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";
import type {RetainedRtfAst, RtfValue} from "./retained-rtf-ast.js";

/** Match the resident citation upgrade without collecting a Str, citation group,
 * identifier, suffix or traversal stack in JavaScript memory. */
export async function upgradeRetainedCitations(root: RtfValue, ast: RetainedRtfAst, source: RetainedSourceText, context: AdapterContext): Promise<void> {
  const key = (char: string) => !!char && (char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char >= "0" && char <= "9" || "_:.#$%&-+?<>~/".includes(char));
  const literal = async (range: SourceRange) => ast.string(await ast.text.from(source.chunks(range)));
  const str = async (range: SourceRange) => ast.tag("Str", await literal(range));
  const affix = async (range: SourceRange) => {
    const result = await ast.array(), trimmed = await source.trim(range);
    if (trimmed.end > trimmed.start) await ast.push(result, await str(trimmed)); return result;
  };
  const groupEnd = async (start: number, end: number) => {
    let cursor = start;
    for (;;) {
      while (cursor < end && !["[", "]", "@"].includes(await source.unit(cursor))) {cursor++; await context.cooperate();}
      if (cursor >= end || await source.unit(cursor) !== "@" || !key(await source.unit(cursor + 1))) return -1;
      cursor += 2;
      while (cursor < end && key(await source.unit(cursor))) {cursor++; await context.cooperate();}
      while (cursor < end && !["[", "]", ";"].includes(await source.unit(cursor))) {cursor++; await context.cooperate();}
      if (cursor >= end || await source.unit(cursor) === "[") return -1;
      if (await source.unit(cursor) === "]") return cursor;
      cursor++;
    }
  };
  const citations = async (range: SourceRange) => {
    const result = await ast.array(); let start = range.start;
    while (start < range.end) {
      let end = await source.find({start, end: range.end}, ";"); if (end < 0) end = range.end;
      const item = await source.trim({start, end}); let at = item.start;
      while (at < item.end) {
        if (await source.unit(at) === "@" && key(await source.unit(at + 1))) break;
        at++; await context.cooperate();
      }
      if (at < item.end) {
        let stop = at + 1; while (stop < item.end && key(await source.unit(stop))) {stop++; await context.cooperate();}
        const suppressed = at > item.start && await source.unit(at - 1) === "-";
        let suffix = stop;
        if (await source.unit(suffix) === ",") {suffix++; while (suffix < item.end && !(await source.unit(suffix)).trim()) {suffix++; await context.cooperate();}}
        const citation = await ast.object();
        for (const [name, value] of [
          ["citationId", await literal({start: at + 1, end: stop})],
          ["citationPrefix", await affix({start: item.start, end: at - Number(suppressed)})],
          ["citationSuffix", await affix({start: suffix, end: item.end})],
          ["citationMode", await ast.tag(suppressed ? "SuppressAuthor" : "NormalCitation")],
          ["citationNoteNum", await ast.value(0)], ["citationHash", await ast.value(0)]
        ] as const) await ast.push(citation, await ast.value([name, value]));
        await ast.push(result, citation);
      }
      start = end + 1;
    }
    return result;
  };
  const rewrite = async (array: RtfValue) => {
    const result = await ast.array();
    for await (const node of ast.children(array)) {
      if (await ast.name(node) !== "Str") {await ast.push(result, node); continue;}
      const range = await source.append(ast.text.chunks(await ast.range((await ast.content(node))!)));
      // The original transform gates the entire Str on these two markers.
      if (await source.find(range, "[@") < 0 && await source.find(range, "[-@") < 0) {await ast.push(result, node); continue;}
      let pending = range.start, cursor = range.start;
      while (cursor < range.end) {
        const start = await source.find({start: cursor, end: range.end}, "["); if (start < 0) break;
        const end = await groupEnd(start + 1, range.end);
        if (end < 0) {cursor = start + 1; continue;}
        if (start > pending) await ast.push(result, await str({start: pending, end: start}));
        await ast.push(result, await ast.tag("Cite", await ast.value([await citations({start: start + 1, end}), [await str({start, end: end + 1})]])));
        pending = cursor = end + 1;
      }
      if (pending === range.start) await ast.push(result, node);
      else if (pending < range.end) await ast.push(result, await str({start: pending, end: range.end}));
    }
    return result;
  };
  const inlines = async (array: RtfValue) => {
    const result = await rewrite(array);
    await ast.walk(result, async (value, depth, leaving) => {
      if (leaving) return false;
      if (await ast.kind(value) === "array") return;
      const name = await ast.name(value), content = await ast.content(value);
      if (name && ["Emph", "Strong", "Strikeout", "Superscript", "Subscript", "SmallCaps", "Underline"].includes(name)) {
        await ast.replaceTag(value, name, await rewrite(content!)); return;
      }
      if (name === "Span") {
        const children = await rewrite((await ast.at(content!, 1))!); await ast.set(content!, 1, children); return {descend: children};
      }
      return false;
    });
    return result;
  };
  await ast.walk(root, async (value, depth, leaving) => {
    if (leaving) return false;
    if (await ast.kind(value) === "array") return;
    const name = await ast.name(value), content = await ast.content(value);
    if (name === "Para" || name === "Plain") {await ast.replaceTag(value, name, await inlines(content!)); return false;}
    if (name === "Header") {await ast.set(content!, 2, await inlines((await ast.at(content!, 2))!)); return false;}
    if (name === "BlockQuote" || name === "BulletList") return;
    if (name === "Div" || name === "OrderedList") return {descend: (await ast.at(content!, 1))!};
    return false;
  });
}
