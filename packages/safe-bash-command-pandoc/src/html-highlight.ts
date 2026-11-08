import {PandocError} from "./errors.js";
import hljs from "highlight.js";
import {parseFragment, type DefaultTreeAdapterMap} from "parse5";
import type {AdapterContext} from "./types.js";

const languages = new Map(hljs.listLanguages().map(name => [hljs.getLanguage(name), name]));
export function codeLanguage(classes: readonly string[]): string | undefined {
  for (const name of classes) {
    const language = languages.get(hljs.getLanguage(name));
    if (language && language !== "plaintext") return language;
  }
  return undefined;
}
const tokenClasses: Record<string, string> = {
  keyword: "kw", built_in: "bu", type: "dt", literal: "cn", number: "dv", operator: "op",
  punctuation: "op", string: "st", regexp: "ss", char: "ch", comment: "co", doctag: "an",
  meta: "pp", symbol: "sy", variable: "va", title: "fu", attr: "at", attribute: "at",
  tag: "kw", name: "kw", selector: "ot", addition: "st", deletion: "st"
};
export const highlightCss = '<style>\npre.sourceCode { overflow: auto; }\ncode.sourceCode > span { display: inline-block; }\ncode span.kw { color: #007020; font-weight: bold; }\ncode span.dt { color: #902000; }\ncode span.dv, code span.cn { color: #40a070; }\ncode span.st, code span.ch, code span.ss { color: #4070a0; }\ncode span.co { color: #60a0b0; font-style: italic; }\ncode span.op { color: #666666; }\ncode span.bu { color: #008000; }\ncode span.fu { color: #06287e; }\ncode span.at { color: #7d9029; }\ncode span.pp { color: #bc7a00; }\npre.numberSource code { counter-reset: source-line; }\npre.numberSource code > span > a:first-child::before { counter-increment: source-line; content: counter(source-line); display: inline-block; width: 3em; padding-right: 1em; text-align: right; color: #aaaaaa; }\n</style>\n';

/** Only generated markup is trusted; token text goes through the writer's escaping. */
export function* highlightCode(source: string, language: string, context: AdapterContext): Generator<{text: string; kind: string}> {
  context.checkpoint(source.length + 1);
  context.charge("retainedBytes", source.length * 2);
  if (source.includes("\0")) throw new PandocError("E_CAPABILITY", context.operation ?? "write", "NUL cannot be represented in HTML", "html5");
  const highlighted = hljs.highlight(source, {language, ignoreIllegals: true}).value.replaceAll("\r", "&#13;");
  context.charge("retainedBytes", highlighted.length * 2);
  const tree = parseFragment(highlighted);
  function* visit(node: DefaultTreeAdapterMap["node"], kind: string): Generator<{text: string; kind: string}> {
    context.checkpoint(); context.charge("references", 1);
    if ("value" in node) {
      // Skylighting classifies JavaScript punctuation as operators as well.
      if (!kind && ["javascript", "typescript"].includes(language)) {
        let text = "";
        for (const char of node.value) {
          context.checkpoint();
          if ("=;+-*/%<>!&|^~?:.,()[]{}".includes(char)) {
            if (text) {yield {text, kind}; text = "";}
            yield {text: char, kind: "op"};
          } else text += char;
        }
        if (text) yield {text, kind};
      } else yield {text: node.value, kind};
    } else if ("childNodes" in node) {
      if ("attrs" in node) {
        const scope = node.attrs.find(attr => attr.name === "class")?.value.split(" ")[0]?.slice(5).split("-")[0];
        kind = tokenClasses[scope ?? ""] ?? kind;
      }
      for (const child of node.childNodes) yield* visit(child, kind);
    }
  }
  yield* visit(tree, "");
}
