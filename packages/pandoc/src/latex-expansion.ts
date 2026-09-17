import type { AdapterContext } from "./types.js";
import { PandocError } from "./errors.js";
import { parseTex, TexCursor, texError, texSource, forbiddenTex } from "./latex-syntax.js";
import type { TexToken } from "./latex-syntax.js";
interface Macro {count: number; body: TexToken[]; fallback?: TexToken[]}
// No primitive, structural or built-in command can be replaced by a user macro.
const reserved = new Set([
  ...forbiddenTex, "begin", "end", "input", "include", "newcommand", "renewcommand", "providecommand",
  "documentclass", "title", "author", "date", "maketitle", "section", "subsection", "subsubsection", "chapter", "part", "paragraph", "subparagraph",
  "emph", "textit", "textbf", "texttt", "textsc", "underline", "item", "caption", "label", "ref", "eqref", "pageref", "href", "url", "includegraphics", "multicolumn", "hline", "par", "verb", "footnote",
  "LaTeX", "TeX", "ae", "AE", "oe", "OE", "aa", "AA", "o", "O", "ss", "l", "L", "textendash", "textemdash", "ldots", "dots", "textbackslash", "textasciitilde", "textasciicircum", "copyright", "pounds", "euro", "textless", "textgreater",
  "c", "v", "u", "H", "r", "newline"
]);
function simpleName(name: string): boolean {return name.length > 0 && name.length <= 64 && [...name].every(c => c >= "a" && c <= "z" || c >= "A" && c <= "Z");}
function includePath(name: string, base: string | undefined, context: AdapterContext): {id: string; identity: string} {
  if (!name || name.startsWith("/") || name.startsWith("~") || name.includes(":") || name.includes("\\") || [...name].some(c => c.charCodeAt(0) < 32) || name.split("/").some(c => c === ".." || !c)) texError(context, "Unsafe include path", "E_CAPABILITY");
  const parts = name.split("/").filter(c => c !== ".");
  let id = parts.join("/");
  if (!id) texError(context, "Empty include path", "E_CAPABILITY");
  if (!parts.at(-1)!.includes(".")) id += ".tex";
  return {id, identity: `${base ?? ""}/${id}`};
}
/** Definitions are lexical, simple newcommand/renewcommand/providecommand only.
 * Expansion substitutes token lists, preserving control-word boundaries.
 * Includes are eagerly acquired; no output capability is touched here. */
export async function expandTex(tokens: readonly TexToken[], context: AdapterContext, base?: string): Promise<TexToken[]> {
  async function sourceOf(tokens: readonly TexToken[], following = ""): Promise<string> {
    let source = "";
    for (let i = 0; i < tokens.length; i++) {
      await context.cooperate();
      const token = tokens[i]!;
      const next = tokens[i + 1]?.raw[0] ?? following;
      const last = token.text.at(-1) ?? "";
      const boundary = token.kind === "command" && (last >= "a" && last <= "z" || last >= "A" && last <= "Z") && (next >= "a" && next <= "z" || next >= "A" && next <= "Z");
      context.charge("retainedBytes", token.raw.length * 2 + (boundary ? 4 : 0));
      source += token.raw + (boundary ? "{}" : "");
    }
    return source;
  }
  async function substitute(tokens: readonly TexToken[], count: number, args?: readonly TexToken[][], depth = 0): Promise<TexToken[]> {
    context.bound("depth", depth);
    const out: TexToken[] = [];
    const push = async (token: TexToken) => {
      for (let i = 0; i < token.raw.length; i++) {
        await context.cooperate();
        if (args) context.charge("expandedBytes", 2);
      }
      if (args) {
        context.charge("nodes", 1);
        context.charge("references", 1);
        context.charge("retainedBytes", 32);
      }
      out.push(token);
    };
    for (let i = 0; i < tokens.length; i++) {
      await context.cooperate();
      const token = tokens[i]!;
      if (token.kind === "text" && token.text === "#") {
        const parameter = tokens[++i];
        const digit = parameter?.text[0];
        if (parameter?.kind !== "text" || !digit || digit < "1" || digit > String(count)) texError(context, "Invalid macro parameter");
        if (args) for (const argument of args[Number(digit) - 1]!) await push(argument);
        const remainder = parameter.text.slice(1);
        if (remainder) await push({...parameter, text: remainder, raw: remainder});
      } else if ("children" in token && !token.text.startsWith("verbatim")) {
        const children = await substitute(token.children, count, args, depth + 1);
        const opening = token.kind === "environment" ? token.opening! : token.kind === "group" ? "{" : "[";
        const closing = token.kind === "environment" ? token.closing! : token.kind === "group" ? "}" : "]";
        await push({...token, children, raw: opening + await sourceOf(children) + closing});
      } else if (token.kind === "math" && token.text.includes("#")) {
        // Math remains source, but parameter substitution must preserve lexical boundaries.
        let text = "";
        for (let j = 0; j < token.text.length; j++) {
          await context.cooperate();
          const c = token.text[j]!;
          if (c === "\\") {
            if (args) context.charge("expandedBytes", 4);
            text += c + (token.text[++j] ?? ""); continue;
          }
          if (c === "%") {
            while (j < token.text.length && token.text[j] !== "\n") {await context.cooperate(); if (args) context.charge("expandedBytes", 2); text += token.text[j++];}
            if (j < token.text.length) text += "\n";
            continue;
          }
          if (c !== "#") {if (args) context.charge("expandedBytes", 2); text += c; continue;}
          const digit = token.text[++j];
          if (!digit || digit < "1" || digit > String(count)) texError(context, "Invalid macro parameter");
          const replacement = args ? await sourceOf(args[Number(digit) - 1]!, token.text[j + 1] ?? "") : "#" + digit;
          if (args) context.charge("expandedBytes", replacement.length * 2);
          text += replacement;
        }
        const start = token.raw.indexOf(token.text);
        const raw = token.raw.slice(0, start) + text + token.raw.slice(start + token.text.length);
        if (args) {
          const parsed = await parseTex(raw, context);
          if (parsed.length !== 1 || parsed[0]?.kind !== "math") texError(context, "Macro interpolation changed math delimiters");
          await push(parsed[0]);
        } else await push(token);
      } else await push(token);
    }
    return out;
  }
  async function expand(tokens: readonly TexToken[], macros: Map<string, Macro>, stack: readonly string[], includes: readonly string[], base: string | undefined, depth: number): Promise<TexToken[]> {
    context.bound("depth", depth);
    const out: TexToken[] = [];
    const cursor = new TexCursor(tokens, context);
    while (cursor.index < tokens.length) {
      await context.cooperate();
      const token = tokens[cursor.index++]!;
      if (token.kind === "command" && ["newcommand", "renewcommand", "providecommand"].includes(token.text)) {
        const nameTokens = cursor.group().children;
        if (nameTokens.length !== 1 || nameTokens[0]?.kind !== "command" || !simpleName(nameTokens[0].text)) texError(context, "Macro name must be one simple control word");
        const name = nameTokens[0]!.text;
        if (reserved.has(name)) texError(context, `Cannot redefine built-in command: ${name}`, "E_CAPABILITY");
        const countToken = cursor.optional();
        const countText = countToken && "children" in countToken ? texSource(countToken.children).trim() : "0";
        if (countText.length !== 1 || countText < "0" || countText > "9") texError(context, "Macro argument count must be 0..9");
        const count = Number(countText);
        const fallbackToken = cursor.optional();
        if (fallbackToken && !count) texError(context, "Optional macro default requires an argument");
        const body = cursor.group().children;
        await substitute(body, count);
        if (token.text === "newcommand" && macros.has(name) || token.text === "renewcommand" && !macros.has(name)) texError(context, `Invalid macro redefinition: ${name}`);
        context.charge("macros", 1);
        if (token.text !== "providecommand" || !macros.has(name)) macros.set(name, {count, body, ...(fallbackToken && "children" in fallbackToken ? {fallback: fallbackToken.children} : {})});
        // TeX control words consume following whitespace; definitions do not create paragraphs.
        cursor.skip();
      } else if (token.kind === "command" && macros.has(token.text)) {
        if (stack.includes(token.text)) texError(context, `Recursive macro: ${token.text}`, "E_LIMIT");
        context.charge("macros", 1);
        const macro = macros.get(token.text)!;
        const args: TexToken[][] = [];
        if (macro.fallback !== undefined) {
          const optional = cursor.optional();
          args.push(optional && "children" in optional ? optional.children : macro.fallback);
        }
        while (args.length < macro.count) args.push(cursor.group().children);
        const substituted = await substitute(macro.body, macro.count, args);
        for (const t of await expand(substituted, macros, [...stack, token.text], includes, base, depth + 1)) out.push(t);
      } else if (token.kind === "command" && (token.text === "input" || token.text === "include")) {
        const name = texSource(cursor.group().children).trim();
        const {id, identity} = includePath(name, base, context);
        if (!context.resources) texError(context, "Includes require an injected resource capability", "E_CAPABILITY");
        if (includes.includes(identity)) texError(context, `Include cycle: ${identity}`, "E_LIMIT");
        context.charge("includes", 1);
        context.bound("depth", depth + 1);
        let bytes: Uint8Array;
        try {bytes = await context.resources.resolve(id, base, context.signal);}
        catch (error) {context.checkpoint(0); if (error instanceof PandocError) throw error; return texError(context, `Cannot resolve include: ${identity}`, "E_RESOURCE");}
        context.checkpoint(0);
        const text = await context.decodeUtf8([bytes]);
        for (const t of await expand(await parseTex(text, context), macros, stack, [...includes, identity], identity.slice(0, identity.lastIndexOf("/")), depth + 1)) out.push(t);
      } else if ("children" in token) {
        // Macro definitions are local to groups/environments. Document scope is shared.
        const scope = token.kind === "environment" && token.text === "document" ? macros : new Map(macros);
        out.push({...token, children: await expand(token.children, scope, stack, includes, base, depth + 1)});
      } else out.push(token);
    }
    return out;
  }
  return expand(tokens, new Map(), [], [], base, 0);
}
