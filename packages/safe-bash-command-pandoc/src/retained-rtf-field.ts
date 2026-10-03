import {emptyText, type BackedText, type TextRange} from "./backed-text.js";
import {rtfError} from "./rtf-syntax.js";
import type {AdapterContext} from "./types.js";

/** Parse the existing inert HYPERLINK subset from decoded literal text. Only
 * four operand handles and bounded text windows stay resident; even malformed
 * extra operands are scanned for the same quote errors before admission. */
export async function retainedRtfHyperlink(text: BackedText, source: TextRange, context: AdapterContext): Promise<TextRange> {
  let start = -1, end = 0, offset = 0;
  for await (const chunk of text.unicodeChunks(source)) for (const char of chunk) {
    if (char.trim()) {if (start < 0) start = offset; end = offset + char.length;}
    offset += char.length;
  }
  const words: TextRange[] = [];
  let count = 0, state: "between" | "quoted" | "unquoted" = "between", word = emptyText(), buffer = "";
  const flush = async () => {
    if (buffer) {if (count < 4) await text.append(word, await text.from([buffer])); buffer = "";}
  };
  const finish = async () => {
    await flush(); if (count++ < 4) words.push(word); word = emptyText(); state = "between";
  };
  offset = 0; let visited = 0;
  for await (const chunk of text.unicodeChunks(source)) {
    const left = Math.max(0, start - offset), right = Math.min(chunk.length, end - offset); offset += chunk.length;
    if (right <= left) continue;
    for (const char of chunk.slice(left, right)) {
      if (++visited % 256 === 0) await context.cooperate();
      if (state === "between") {
        if (char === " " || char === "\t") continue;
        if (char === '"') {state = "quoted"; continue;}
        state = "unquoted";
      } else if (state === "quoted" && char === '"' || state === "unquoted" && (char === " " || char === "\t")) {
        await finish(); continue;
      }
      if (count < 4) {buffer += char; if (buffer.length >= 4096) await flush();}
    }
  }
  if (state === "quoted") rtfError(context, "Unclosed RTF field quote");
  if (state === "unquoted") await finish();
  const small = async (word: TextRange | undefined, limit: number): Promise<string | undefined> => {
    if (!word || word.units > limit) return undefined;
    let value = ""; for await (const chunk of text.chunks(word)) value += chunk; return value;
  };
  if ((await small(words[0], 9))?.toUpperCase() !== "HYPERLINK") rtfError(context, "Only inert HYPERLINK fields are supported; active fields are never evaluated", "E_CAPABILITY");
  let target: TextRange;
  if (count === 2) target = words[1]!;
  else if (count === 3 && await small(words[1], 2) === "\\l") {
    target = await text.from(["#"]); await text.append(target, words[2]!);
  } else if (count === 4 && await small(words[2], 2) === "\\l") {
    target = words[1]!; await text.append(target, await text.from(["#"])); await text.append(target, words[3]!);
  } else rtfError(context, "Unsupported RTF HYPERLINK instruction", "E_CAPABILITY");
  let prefix = "";
  for await (const chunk of text.unicodeChunks(target)) for (const char of chunk) {
    if (char === ":") {
      if (!["http", "https", "mailto"].includes(prefix.toLowerCase())) rtfError(context, "Unsupported RTF hyperlink scheme", "E_CAPABILITY");
      return target;
    }
    // Once longer than every admitted scheme, keep scanning for a colon while
    // retaining only the bounded prefix that is sufficient for rejection.
    if (prefix.length <= 6) prefix += char;
  }
  return target;
}
