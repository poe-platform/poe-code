import type { AdapterContext } from "./types.js";
import { PandocError } from "./errors.js";
import { parseTex, TexCursor, texError, texSource, forbiddenTex } from "./latex-syntax.js";
import type { TexToken } from "./latex-syntax.js";
interface Macro {count: number; body: string; fallback?: string}
// No primitive, structural or built-in command can be replaced by a user macro.
const reserved = new Set([
  ...forbiddenTex, "begin", "end", "input", "include", "newcommand", "renewcommand", "providecommand",
  "documentclass", "title", "author", "date", "maketitle", "section", "subsection", "subsubsection", "chapter", "part", "paragraph", "subparagraph",
  "emph", "textit", "textbf", "texttt", "textsc", "underline", "item", "caption", "label", "ref", "eqref", "pageref", "href", "url", "includegraphics", "multicolumn", "hline", "par", "verb", "footnote",
  "LaTeX", "TeX", "ae", "AE", "oe", "OE", "aa", "AA", "o", "O", "ss", "l", "L", "textendash", "textemdash", "ldots", "textbackslash", "textasciitilde", "textasciicircum", "copyright"
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
 * Expansion is textual parameter substitution followed by the same syntax parser.
 * Includes are eagerly acquired; no output capability is touched here. */
export async function expandTex(tokens: readonly TexToken[], context: AdapterContext, base?: string): Promise<TexToken[]> {
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
        const body = texSource(cursor.group().children);
        for (let i = 0; i < body.length; i++) {
          if (body[i] === "%") {while (i < body.length && body[i] !== "\n") i++; continue;}
          if (body[i] === "\\") {i++; continue;}
          if (body[i] === "#") {
            const n = body[++i];
            if (!n || n < "1" || n > String(count)) texError(context, "Invalid macro parameter");
          }
        }
        if (token.text === "newcommand" && macros.has(name) || token.text === "renewcommand" && !macros.has(name)) texError(context, `Invalid macro redefinition: ${name}`);
        context.charge("macros", 1);
        if (token.text !== "providecommand" || !macros.has(name)) macros.set(name, {count, body, ...(fallbackToken && "children" in fallbackToken ? {fallback: texSource(fallbackToken.children)} : {})});
        // TeX control words consume following whitespace; definitions do not create paragraphs.
        cursor.skip();
      } else if (token.kind === "command" && macros.has(token.text)) {
        if (stack.includes(token.text)) texError(context, `Recursive macro: ${token.text}`, "E_LIMIT");
        context.charge("macros", 1);
        const macro = macros.get(token.text)!;
        const args: string[] = [];
        if (macro.fallback !== undefined) {
          const optional = cursor.optional();
          args.push(optional && "children" in optional ? texSource(optional.children) : macro.fallback);
        }
        while (args.length < macro.count) args.push(texSource(cursor.group().children));
        let source = "";
        for (let i = 0; i < macro.body.length; i++) {
          context.checkpoint();
          if (macro.body[i] === "%") {while (i < macro.body.length && macro.body[i] !== "\n") i++; continue;}
          const c = macro.body[i]!;
          if (!c) break;
          const piece = c === "#" ? args[Number(macro.body[++i]) - 1]! : c === "\\" ? c + (macro.body[++i] ?? "") : c;
          context.charge("expandedBytes", piece.length * 2);
          source += piece;
        }
        for (const t of await expand(parseTex(source, context), macros, [...stack, token.text], includes, base, depth + 1)) out.push(t);
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
        for (const t of await expand(parseTex(text, context), macros, stack, [...includes, identity], identity.slice(0, identity.lastIndexOf("/")), depth + 1)) out.push(t);
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
