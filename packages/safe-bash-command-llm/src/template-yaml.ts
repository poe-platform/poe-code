import { Document, Scalar, YAMLSeq, visit } from "yaml";

function escapedQuoted(value: string): string {
  let text = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"' || char === "\\") text += "\\" + char;
    else if (code === 10) text += "\\n";
    else if (code === 13) text += "\\r";
    else if (code === 9) text += "\\t";
    else if ([0, 7, 8, 11, 12, 27].includes(code)) text += "\\" + ({ 0: "0", 7: "a", 8: "b", 11: "v", 12: "f", 27: "e" }[code]);
    else if (code < 32 || code === 127) text += "\\x" + code.toString(16).toUpperCase().padStart(2, "0");
    else if (code === 133) text += "\\N";
    else if (code === 160) text += "\\_";
    else if (code === 8232) text += "\\L";
    else if (code === 8233) text += "\\P";
    else if (code > 126) text += (code > 65535 ? "\\U" : code > 255 ? "\\u" : "\\x") + code.toString(16).toUpperCase().padStart(code > 65535 ? 8 : code > 255 ? 4 : 2, "0");
    else text += char;
  }
  return text + '"';
}

function unicodeQuoted(value: string, indent: string, initialColumn: number): string {
  const chars = [...value];
  let result = '"', pending = "", column = initialColumn + 1;
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!;
    const encoded = escapedQuoted(char).slice(1, -1);
    const escaped = encoded !== char;
    if (escaped) {
      result += pending + encoded;
      column += pending.length + encoded.length;
      pending = "";
    } else pending += char;
    if (index > 0 && index < chars.length - 1 && (char === " " || escaped) && column + pending.length - (escaped ? 0 : 1) > 80) {
      if (!escaped) pending = pending.slice(0, -1);
      result += pending + "\\\n" + indent;
      column = indent.length;
      pending = "";
      if (!escaped) {
        result += "\\";
        column++;
        pending = char;
      } else if (chars[index + 1] === " ") {
        result += "\\";
        column++;
      }
    }
  }
  return result + pending + '"';
}

export function templateYaml(value: object): string {
  const sorted = Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
  const document = new Document(sorted, { version: "1.1", sortMapEntries: true });
  visit(document, {
    Pair(_key, node) {
      if (node.value instanceof YAMLSeq) {
        const pairStringify = node.toString.bind(node);
        node.toString = (ctx, ...args) => pairStringify(ctx ? { ...ctx, indentStep: ctx.indentStep.slice(0, -2) } : ctx, ...args);
        const sequence = node.value;
        const stringify = sequence.toString.bind(sequence);
        sequence.toString = (ctx, ...args) => stringify(ctx ? { ...ctx, indentStep: "    " } : ctx, ...args);
      }
    },
    Scalar(_key, node) {
      if (typeof node.value === "string" && node.value.includes("\n")) node.type = Scalar.QUOTE_SINGLE;
    },
  });
  document.schema.tags = document.schema.tags.map(tag => {
    if (tag.tag !== "tag:yaml.org,2002:str") return tag;
    const previous = tag.stringify;
    if (!previous) throw new Error("String tag has no serializer");
    return {
      ...tag,
      stringify(item, ...args) {
        const text = String(item.value);
        return [...text].some(char => char.codePointAt(0)! > 126 || (char.codePointAt(0)! < 32 && char !== "\n"))
          ? unicodeQuoted(text, args[0].indent, args[0].indentAtStart ?? args[0].indent.length)
          : previous(item, ...args);
      },
    };
  });
  return document.toString({ indent: 4, lineWidth: 84, blockQuote: false, indentSeq: false, singleQuote: true }) + "\n";
}
