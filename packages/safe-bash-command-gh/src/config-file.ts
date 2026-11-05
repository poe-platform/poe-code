import { isFsError } from "@poe-code/safe-fs/core";
import type { CommandContext } from "safe-bash-contracts";
import { Document, isAlias, isMap, isScalar, parseDocument, Scalar, type YAMLMap } from "yaml";
import defaultLines from "./config-defaults.json" with { type: "json" };

export async function readGlobalConfig(context: CommandContext, path: string) {
  const values = new Map<string, string>();
  let source = "";
  try {
    source = new TextDecoder().decode(await context.fs.readFile(path, { signal: context.signal }));
  } catch (error) {
    if (!isFsError(error) || error.code !== "ENOENT") throw error;
  }
  if (!source) return { values, source, reason: "" };
  const doc = parseDocument(source, { schema: "failsafe", uniqueKeys: false });
  const reason = doc.errors.length ? "invalid yaml" : doc.contents && !isMap(doc.contents) ? "invalid format" : "";
  if (isMap(doc.contents)) for (const { key, value } of doc.contents.items) {
    if (isScalar(key) && typeof key.value === "string" && !values.has(key.value)) {
      values.set(key.value, isScalar(value) ? String(value.value ?? "") : isAlias(value) ? value.source : "");
    }
  }
  return { source, values, reason };
}

// Edit the parsed pair's source span: emitting the whole document moves comments on empty values.
export function setGlobalConfig(source: string, key: string, value: string): string {
  let doc = parseDocument(source, { schema: "failsafe", uniqueKeys: false, keepSourceTokens: true });
  if (!doc.contents || (isMap(doc.contents) && !doc.contents.items.length)) {
    source = defaultLines.join("\n") + "\n";
    doc = parseDocument(source, { schema: "failsafe", keepSourceTokens: true });
  }
  if (doc.errors.length || !isMap(doc.contents)) throw new Error("invalid config file");
  const map = doc.contents as YAMLMap;
  const pair = map.items.find(item => isScalar(item.key) && item.key.value === key);
  const flow = !!map.flow;
  const emitted = new Document();
  const node = new Scalar(value || (flow ? "" : null));
  if (flow && value.includes("\n")) node.type = Scalar.QUOTE_DOUBLE;
  if (value && !value.includes("\n")) {
    const plain = parseDocument(value, { customTags: ["timestamp"] });
    if (isScalar(plain.contents) && typeof plain.contents.value !== "string") node.type = Scalar.QUOTE_DOUBLE;
  }
  emitted.set(pair ? "x" : key, node);
  const rendered = emitted.toString({ indent: 4, lineWidth: 0, singleQuote: true, collectionStyle: flow ? "flow" : "block", flowCollectionPadding: false });
  let entry = flow ? rendered.slice(1, -2) : rendered.slice(0, -1);
  if (!value && !flow) entry = entry.slice(0, entry.lastIndexOf(":") + 1);
  const indent = map.srcToken?.type === "block-map" ? " ".repeat(map.srcToken.indent) : "";
  if (indent) entry = entry.split("\n").map((line, i) => i && line ? indent + line : line).join("\n");
  let field = entry.slice(2);
  if (!pair) {
    const at = map.range![1] - (flow ? 1 : 0);
    const before = source.slice(0, at);
    return before + (flow ? before.trimEnd().endsWith(",") ? " " : ", " : at && source[at - 1] !== "\n" ? "\n" : "") + indent + entry
      + (flow ? "" : "\n") + source.slice(at);
  }
  const sep = pair.srcToken?.sep?.find(t => t.type === "map-value-ind");
  const start = sep ? sep.offset + 1 : (pair.key as Scalar).range![1];
  const range = (pair.value as Scalar | null)?.range;
  let end = range?.[1] ?? start;
  if (!flow) {
    // A collection or block scalar includes its final line break in the value span.
    if (end > start && source[end - 1] === "\n") end--;
    else {
      while (source[end] === " " || source[end] === "\t") end++;
      if (source[end] === "#") {
        const commentAt = end;
        while (end < source.length && source[end] !== "\n") end++;
        if (range?.[0] === range?.[1]) {
          const at = field.includes("\n") ? field.indexOf("\n") : field.length;
          field = field.slice(0, at) + " " + source.slice(commentAt, end) + field.slice(at);
        }
      }
    }
  }
  const result = source.slice(0, start) + (sep ? "" : ":") + field + source.slice(end);
  return result.endsWith("\n") ? result : result + "\n";
}
