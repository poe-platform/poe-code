import type { Inline } from "./ast-types.js";
import type { AdapterContext } from "./types.js";
import { nameOf, rstAttr, rstError } from "./rst-syntax.js";
import type { RstLine } from "./rst-syntax.js";
export interface RstInlineHost {
  readonly context: AdapterContext;
  link(name: string | undefined, label: readonly Inline[], at: RstLine): Inline;
  substitution(name: string, at: RstLine, stack: readonly string[], depth: number): readonly Inline[];
  note(name: string, at: RstLine, stack: readonly string[], depth: number): Inline;
  embeddedTarget(name: string, label: readonly Inline[], at: RstLine): Inline;
  addTarget(name: string, value: string, indirect: boolean, at: RstLine): void;
  raw(source: string, at: RstLine): Inline;
}
const roleTags: Readonly<Record<string, "Emph" | "Strong" | "Superscript" | "Subscript">> = {emphasis: "Emph", strong: "Strong", superscript: "Superscript", sup: "Superscript", subscript: "Subscript", sub: "Subscript"};
function append(out: Inline[], node: Inline): void {
  const last = out.at(-1);
  if (node.t === "Str" && last?.t === "Str") out[out.length - 1] = {t: "Str", c: last.c + node.c};
  else out.push(node);
}
const whitespace = (c: string | undefined) => c === " " || c === "\n" || c === "\t";
const startBoundary = (s: string, i: number) => i === 0 || whitespace(s[i - 1]) || "([{<'\"/:,-".includes(s[i - 1]!);
const endBoundary = (s: string, i: number) => i === s.length || whitespace(s[i]) || ".,;:!?)]}>'\"/\\".includes(s[i]!);
function closing(s: string, token: string, from: number): number {
  let i = from;
  while ((i = s.indexOf(token, i)) >= 0) {
    if (s[i - 1] !== "\\" && !whitespace(s[i - 1]) && endBoundary(s, i + token.length)) return i;
    i += token.length;
  }
  return -1;
}
export function rstInlines(text: string, at: RstLine, host: RstInlineHost, stack: readonly string[] = [], depth = 0): Inline[] {
  const context = host.context;
  context.bound("depth", depth);
  context.charge("retainedBytes", text.length * 2);
  const out: Inline[] = [];
  let i = 0;
  const locate = (offset: number): RstLine => {
    const prefix = text.slice(0, offset), last = prefix.lastIndexOf("\n");
    return {...at, line: at.line + prefix.split("\n").length - 1, column: at.column + (last < 0 ? offset : offset - last - 1)};
  };
  const recurse = (s: string, start: number) => rstInlines(s, locate(start), host, stack, depth + 1);
  const role = (name: string, value: string, source: string, pos: number): Inline => {
    const tag = roleTags[name];
    if (tag) return {t: tag, c: recurse(value, pos)};
    if (["literal", "code"].includes(name)) return {t: "Code", c: [rstAttr(), value]};
    if (name === "math") return {t: "Math", c: ["InlineMath", value]};
    if (["title-reference", "title", "t"].includes(name)) return {t: "Span", c: [["", ["title-ref"], []], recurse(value, pos)]};
    return host.raw(source, locate(i));
  };
  while (i < text.length) {
    context.checkpoint();
    const c = text[i]!;
    if (c === "\\" && i + 1 < text.length) {if (!whitespace(text[i + 1])) append(out, {t: "Str", c: text[i + 1]!}); i += 2; continue;}
    if (whitespace(c)) {append(out, {t: c === "\n" ? "SoftBreak" : "Space"}); i++; while (text[i] === " " || text[i] === "\t") i++; continue;}
    if (startBoundary(text, i)) {
      if (text.startsWith("_`", i)) {
        const end = text.indexOf("`", i + 2);
        if (end < 0) rstError(context, locate(i), "Unclosed inline target");
        const name = text.slice(i + 2, end);
        append(out, host.embeddedTarget(name, recurse(name, i + 2), locate(i)));
        i = end + 1; continue;
      }
      if (c === "*" || text.startsWith("``", i)) {
        const token = text.startsWith("``", i) ? "``" : text.startsWith("**", i) ? "**" : "*";
        const end = closing(text, token, i + token.length);
        if (end > i + token.length && !whitespace(text[i + token.length])) {
          const value = text.slice(i + token.length, end);
          append(out, token === "``" ? {t: "Code", c: [rstAttr(), value]} : {t: token === "**" ? "Strong" : "Emph", c: recurse(value, i + token.length)});
          i = end + token.length; continue;
        }
      }
      if (c === "|") {
        const end = text.indexOf("|", i + 1);
        if (end > i + 1 && endBoundary(text, end + 1)) {
          for (const node of host.substitution(text.slice(i + 1, end), locate(i), stack, depth + 1)) append(out, node);
          i = end + 1; continue;
        }
      }
      if (c === "[") {
        const end = text.indexOf("]_", i + 1);
        if (end > i + 1 && endBoundary(text, end + 2)) {append(out, host.note(text.slice(i + 1, end), locate(i), stack, depth + 1)); i = end + 2; continue;}
      }
      let tick = i, prefix: string | undefined;
      if (c === ":") {
        const end = text.indexOf(":`", i + 1);
        if (end > i + 1 && ![...text.slice(i + 1, end)].some(whitespace)) {prefix = text.slice(i + 1, end); tick = end + 1;}
      }
      if (text[tick] === "`" && text[tick + 1] !== "`") {
        let end = tick + 1;
        while ((end = text.indexOf("`", end)) >= 0 && text[end - 1] === "\\") end++;
        if (end < 0) rstError(context, locate(tick), "Unclosed interpreted text");
        const value = text.slice(tick + 1, end);
        let next = end + 1, suffix: string | undefined;
        if (text[next] === ":") {const stop = text.indexOf(":", next + 1); if (stop > next + 1) {suffix = text.slice(next + 1, stop); next = stop + 1;}}
        if (prefix && suffix) rstError(context, locate(i), "Interpreted text has both prefix and suffix roles");
        if (prefix || suffix) append(out, role(prefix ?? suffix!, value, text.slice(i, next), tick + 1));
        else if (text[next] === "_") {
          const anonymous = text[next + 1] === "_"; next += anonymous ? 2 : 1;
          const open = value.lastIndexOf(" <");
          if (open >= 0 && value.endsWith(">")) {
            const target = value.slice(open + 2, -1);
            const label = recurse(value.slice(0, open), tick + 1);
            const indirect = target.endsWith("_") && !target.includes("://");
            if (!anonymous) host.addTarget(value.slice(0, open), indirect ? target.slice(0, -1) : target, indirect, locate(i));
            append(out, indirect ? host.link(nameOf(target.slice(0, -1)), label, locate(i)) : {t: "Link", c: [rstAttr(), label, [target, ""]]});
          } else append(out, host.link(anonymous ? undefined : nameOf(value), recurse(value, tick + 1), locate(i)));
        } else append(out, role("title-reference", value, text.slice(i, next), tick + 1));
        i = next; continue;
      }
      // Simple references and standalone URIs are scanned as words, never regexes.
      let end = i;
      while (end < text.length && !whitespace(text[end])) end++;
      let stop = end;
      while (stop > i && ".,;!?)]}".includes(text[stop - 1]!)) stop--;
      const word = text.slice(i, stop);
      if (word.startsWith("https://") || word.startsWith("http://") || word.startsWith("mailto:")) {
        append(out, {t: "Link", c: [rstAttr(), [{t: "Str", c: word}], [word, ""]]}); i = stop; continue;
      }
      if (word.endsWith("_") && word.length > 1 && [...word.slice(0, -1)].every(c => c === "_" || c === "-" || c === "." || c.charCodeAt(0) > 127 || c >= "0" && c <= "9" || c.toLowerCase() >= "a" && c.toLowerCase() <= "z")) {
        const anonymous = word.endsWith("__"), label = word.slice(0, anonymous ? -2 : -1);
        append(out, host.link(anonymous ? undefined : nameOf(label), [{t: "Str", c: label}], locate(i))); i = stop; continue;
      }
    }
    append(out, {t: "Str", c}); i++;
  }
  return out;
}
