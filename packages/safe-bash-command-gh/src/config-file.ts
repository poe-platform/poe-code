import { isFsError, resolvePath } from "@poe-code/safe-fs/core";
import type { CommandContext } from "safe-bash-contracts";
import { Document, isAlias, isMap, isScalar, parseDocument, Scalar, YAMLMap } from "yaml";
import defaultLines from "./config-defaults.json" with { type: "json" };

function scalarValues(map: YAMLMap) {
  const values = new Map<string, string>();
  for (const { key, value } of map.items) {
    if (isScalar(key) && typeof key.value === "string" && !values.has(key.value)) {
      values.set(key.value, isScalar(value) ? String(value.value ?? "") : isAlias(value) ? value.source : "");
    }
  }
  return values;
}

export async function readGhConfig(context: CommandContext, dir: string) {
  let values = new Map<string, string>();
  let source = "";
  let hostsNode: unknown;
  const hosts: [string, Map<string, string>][] = [];
  for (const name of ["config.yml", "hosts.yml"]) {
    const display = dir.replace(/\/+$/u, "") + "/" + name;
    let text: string;
    try {
      text = new TextDecoder().decode(await context.fs.readFile(resolvePath(context.cwd, display), { signal: context.signal }));
    } catch (error) {
      if (!isFsError(error) || error.code !== "ENOENT") throw error;
      continue;
    }
    if (!text) continue;
    const doc = parseDocument(text, { schema: "failsafe", uniqueKeys: false });
    const reason = doc.errors.length ? "invalid yaml" : doc.contents && !isMap(doc.contents) ? "invalid format" : "";
    if (reason) return { values, hosts, source, error: `invalid config file ${display}: ${reason}` };
    if (!isMap(doc.contents)) continue;
    if (name === "config.yml") {
      source = text;
      values = scalarValues(doc.contents);
      hostsNode = doc.contents.get("hosts", true);
    } else if (!values.has("hosts") && doc.contents.items.length) {
      hostsNode = doc.contents;
      values.set("hosts", "");
    }
  }
  if (isMap(hostsNode)) for (const { key, value } of hostsNode.items) {
    if (isScalar(key) && typeof key.value === "string") {
      hosts.push([key.value, isMap(value) ? scalarValues(value) : new Map()]);
    }
  }
  return { values, hosts, source: values.size ? source : undefined, error: "" };
}

// Edit the parsed pair's source span: emitting the whole document moves comments on empty values.
export function setGlobalConfig(original: string | undefined, key: string, value: string): string {
  const source = original ?? defaultLines.join("\n") + "\n";
  const doc = parseDocument(source, { schema: "failsafe", uniqueKeys: false, keepSourceTokens: true });
  if (doc.errors.length || (doc.contents && !isMap(doc.contents))) throw new Error("invalid config file");
  const map = doc.contents ?? new YAMLMap();
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
    if (!map.range) return entry + "\n";
    const at = map.range[1] - (flow ? 1 : 0);
    const before = source.slice(0, at);
    return before + (flow ? !map.items.length ? "" : before.trimEnd().endsWith(",") ? " " : ", " : at && source[at - 1] !== "\n" ? "\n" : "") + indent + entry
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
