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

function decodeYaml(bytes: Uint8Array): string | undefined {
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8";
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || (c >= 127 && c < 160 && c !== 133) || c === 65534 || c === 65535) return undefined;
  }
  return text;
}

export async function readGhConfig(context: CommandContext, dir: string) {
  let values = new Map<string, string>();
  let source = "";
  let hostSource = "";
  let hostsNode: unknown;
  const hosts: [string, Map<string, string>][] = [];
  for (const name of ["config.yml", "hosts.yml"]) {
    const display = dir.replace(/\/+$/u, "") + "/" + name;
    let bytes: Uint8Array;
    try {
      bytes = await context.fs.readFile(resolvePath(context.cwd, display), { signal: context.signal });
    } catch (error) {
      if (!isFsError(error)) throw error;
      if (error.code === "ENOENT") continue;
      const reason = error.code === "EACCES" ? "permission denied" : error.code === "EISDIR" ? "is a directory" :
        error.code === "ELOOP" ? "too many levels of symbolic links" : error.code === "ENOTDIR" ? "not a directory" : undefined;
      if (!reason) throw error;
      const operation = error.code === "EISDIR" ? "read" : "open";
      return { values, hosts, hostSource, source, error: `${operation} ${display}: ${reason}` };
    }
    const text = decodeYaml(bytes);
    if (text === undefined) return { values, hosts, hostSource, source, error: `invalid config file ${display}: invalid yaml` };
    if (!text) continue;
    const doc = parseDocument(text, { schema: "failsafe", uniqueKeys: false });
    const reason = doc.errors.length ? "invalid yaml" : doc.contents && !isMap(doc.contents) ? "invalid format" : "";
    if (reason) return { values, hosts, hostSource, source, error: `invalid config file ${display}: ${reason}` };
    if (!isMap(doc.contents)) continue;
    if (name === "config.yml") {
      source = text;
      values = scalarValues(doc.contents);
      hostsNode = doc.contents.get("hosts", true);
      if (isMap(hostsNode) && hostsNode.range) {
        const [start, end] = hostsNode.range;
        const indent = " ".repeat(start - (text.lastIndexOf("\n", start - 1) + 1));
        hostSource = hostsNode.flow ? text.slice(start, end) : text.slice(start, end).split("\n").map((line, i) =>
          i && line.startsWith(indent) ? line.slice(indent.length) : line).join("\n");
      }
    } else if (doc.contents.items.length) {
      hostSource = text;
      if (values.has("hosts")) continue;
      hostsNode = doc.contents;
      values.set("hosts", "");
    }
  }
  if (isMap(hostsNode)) for (const { key, value } of hostsNode.items) {
    if (isScalar(key) && typeof key.value === "string") {
      hosts.push([key.value, isMap(value) ? scalarValues(value) : new Map()]);
    }
  }
  return { values, hosts, hostSource, source: values.size ? source : undefined, error: "" };
}

export const defaultConfig = defaultLines.join("\n") + "\n";

function configMap(source: string): YAMLMap {
  const doc = parseDocument(source, { schema: "failsafe", uniqueKeys: false, keepSourceTokens: true });
  if (doc.errors.length || (doc.contents && !isMap(doc.contents))) throw new Error("invalid config file");
  return doc.contents ?? new YAMLMap();
}

export function setConfig(source: string, host: string, key: string, value: string): string {
  const root = configMap(source);
  const updated = setIn(source, root, host ? [host, key] : [key], value);
  if (!host) return updated;
  const user = key === "user" ? value : root.getIn([host, "user"]);
  return typeof user === "string" && user ? setIn(updated, configMap(updated), [host, "users", user, key], value) : updated;
}

// Edit the parsed pair's source span: emitting the whole document moves comments on empty values.
function setIn(source: string, map: YAMLMap, path: string[], value: string): string {
  let i = 0;
  while (i < path.length - 1) {
    const child = map.get(path[i]!, true);
    if (isMap(child)) {
      map = child;
      i++;
    } else if (child === undefined || (isScalar(child) && child.type === Scalar.PLAIN &&
      ["", "~", "null", "Null", "NULL"].includes(String(child.value ?? "")))) break;
    else return source;
  }
  const key = path[i]!;
  const pair = map.items.find(item => isScalar(item.key) && item.key.value === key);
  const flow = !!map.flow;
  const emitted = new Document();
  const node = new Scalar(value || (flow ? "" : null));
  if (flow && value.includes("\n")) node.type = Scalar.QUOTE_DOUBLE;
  if (value && !value.includes("\n")) {
    const plain = parseDocument(value, { customTags: ["timestamp"] });
    if (isScalar(plain.contents) && typeof plain.contents.value !== "string") node.type = Scalar.QUOTE_DOUBLE;
  }
  emitted.setIn([pair ? "x" : key, ...path.slice(i + 1)], node);
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
    const result = before + (flow ? !map.items.length ? "" : before.trimEnd().endsWith(",") ? " " : ", " : at && source[at - 1] !== "\n" ? "\n" : "") + indent + entry
      + (flow ? "" : "\n") + source.slice(at);
    return result.endsWith("\n") ? result : result + "\n";
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
