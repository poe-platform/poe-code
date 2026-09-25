import { parseXmlSteps, type XmlElement } from "@poe-code/safe-fs/core";
import { decodeDocuments, type Candidate, type NativeDocument, type YamlModule } from "./nodes.js";
import { encodeNative } from "./native-encoder.js";
import { MikeError, type NativeWork } from "./native-work.js";
import { parseTomlDocument } from "./toml.js";
import { YqLedger } from "./accounting.js";
import { Decimal, numberText } from "safe-bash-query-engine/numbers";

export type MikeFormat = "yaml" | "json" | "csv" | "tsv" | "props" | "xml" | "ini" | "toml" | "base64" | "uri" | "shell" | "lua";

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };
function mapping(value: Value): value is { [key: string]: Value } { return value !== null && typeof value === "object" && !Array.isArray(value); }

async function properties(text: string, work: NativeWork): Promise<Value> {
  let nodes = 0;
  const admit = (count: number) => {
    if (count > work.limits.maxParserNodes - nodes) throw new MikeError("yq limit exceeded: maxParserNodes");
    work.node(count);
    nodes += count;
  };
  admit(1);
  const result: { [key: string]: Value } = Object.create(null);
  let offset = 0;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(offset, end).trim();
    offset = end + 1;
    await work.tick(line.length + 1);
    if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("!")) continue;
    let equal = line.indexOf("=");
    if (equal < 0) equal = line.indexOf(":");
    if (equal < 0) throw new MikeError("invalid props entry");
    const key = line.slice(0, equal).trim();
    // A path needs a root plus a key and value node for every component.
    // Check its minimum size before materializing any part of that path.
    let depth = 1;
    work.depth(depth);
    if (1 + 2 * depth > work.limits.maxParserNodes) throw new MikeError("yq limit exceeded: maxParserNodes");
    for (let index = 0; index < key.length; index++) {
      await work.tick();
      if (key[index] !== ".") continue;
      work.depth(++depth);
      if (1 + 2 * depth > work.limits.maxParserNodes) throw new MikeError("yq limit exceeded: maxParserNodes");
    }
    let target = result;
    let start = 0;
    while (true) {
      await work.tick();
      const dot = key.indexOf(".", start);
      const component = key.slice(start, dot < 0 ? key.length : dot);
      if (dot < 0) {
        admit(Object.hasOwn(target, component) ? 1 : 2);
        target[component] = line.slice(equal + 1).trim();
        break;
      }
      if (!mapping(target[component] ?? null)) {
        admit(Object.hasOwn(target, component) ? 1 : 2);
        target[component] = Object.create(null) as Value;
      }
      target = target[component] as { [key: string]: Value };
      start = dot + 1;
    }
  }
  return result;
}

async function table(text: string, delimiter: string, yaml: YamlModule, work: NativeWork): Promise<Value> {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const cell = () => { if (Buffer.byteLength(field) > work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes"); row.push(field); field = ""; closed = false; };
  for (let index = 0; index < text.length; index++) {
    await work.tick();
    const char = text[index]!;
    if (quoted) {
      if (char === '"') { if (text[index + 1] === '"') { field += '"'; index++; } else { quoted = false; closed = true; } }
      else field += char;
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (char === delimiter) cell();
    else if (char === "\n" || char === "\r") { cell(); rows.push(row); row = []; if (char === "\r" && text[index + 1] === "\n") index++; }
    else { if (closed || char === '"') throw new MikeError("invalid delimited input"); field += char; }
    if (rows.length + row.length > work.limits.maxParserNodes) throw new MikeError("yq limit exceeded: maxParserNodes");
  }
  if (quoted) throw new MikeError("unterminated quoted field");
  if (field || row.length || closed) { cell(); rows.push(row); }
  const headers = rows.shift() ?? [];
  const result: Value[] = [];
  for (const cells of rows) {
    await work.tick();
    if (cells.length !== headers.length) throw new MikeError("wrong number of fields");
    const item: { [key: string]: Value } = Object.create(null);
    for (let index = 0; index < cells.length; index++) {
      const parsed = yaml.parseDocument(cells[index]!, { schema: "core" });
      item[headers[index]!] = !parsed.errors.length && yaml.isScalar(parsed.contents) && typeof parsed.contents.value !== "string" ? parsed.contents.value as Value : cells[index]!;
    }
    result.push(item);
  }
  return result;
}

async function xmlValue(element: XmlElement, work: NativeWork, depth = 0): Promise<Value> {
  await work.tick(); work.depth(depth);
  const result: { [key: string]: Value } = Object.create(null);
  for (const attribute of element.attributes) result[`+@${attribute.name}`] = attribute.value;
  for (const child of element.children) {
    const value = await xmlValue(child, work, depth + 1);
    if (Object.hasOwn(result, child.name)) { const previous = result[child.name]!; result[child.name] = Array.isArray(previous) ? [...previous, value] : [previous, value]; }
    else result[child.name] = value;
  }
  const text = element.text.trim();
  if (!Object.keys(result).length) return text;
  if (text) result["+content"] = text;
  return result;
}

export async function decodeFormat(text: string, filename: string, fileIndex: number, format: MikeFormat, yaml: YamlModule, work: NativeWork, accept: (document: NativeDocument) => Promise<void>): Promise<void> {
  if (format === "yaml" || format === "json") { await decodeDocuments(text, filename, fileIndex, format, yaml, work, accept); return; }
  if (Buffer.byteLength(text) > work.limits.maxDocumentBytes) throw new MikeError("yq limit exceeded: maxDocumentBytes");
  let value: Value;
  try {
    if (format === "csv" || format === "tsv") value = await table(text, format === "csv" ? "," : "\t", yaml, work);
    else if (format === "base64") {
      const clean = text.split("\n").join("").split("\r").join("");
      const data = Buffer.from(clean, "base64");
      if (data.toString("base64") !== clean) throw new MikeError("invalid base64 input");
      value = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } else if (format === "uri") value = decodeURIComponent(text.split("+").join(" "));
    else if (format === "xml") {
      const parser = parseXmlSteps(text, { maxDepth: work.limits.maxDepth, maxNodes: work.limits.maxParserNodes, maxTextLength: work.limits.maxScalarBytes });
      let step = parser.next();
      while (!step.done) { await work.tick(step.value); step = parser.next(); }
      value = { [step.value.name]: await xmlValue(step.value, work) };
    } else if (format === "toml") {
      const parsed = await parseTomlDocument(text, { charge: units => work.tick(units), assertOpen: () => work.assertOpen() }, new YqLedger(), Buffer.byteLength(text));
      const convert = (item: unknown): Value => {
        if (item instanceof Decimal) return Number(numberText(item));
        if (Array.isArray(item)) return item.map(convert);
        if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, convert(child)]));
        return item as Value;
      };
      value = convert(parsed);
    } else if (format === "props") value = await properties(text, work);
    else if (format === "ini") {
      value = Object.create(null) as { [key: string]: Value };
      let section = value;
      for (const source of text.split("\n")) {
        await work.tick(source.length + 1);
        const line = source.trim();
        if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("!")) continue;
        if (line.startsWith("[") && line.endsWith("]")) { const name = line.slice(1, -1); section = Object.create(null) as { [key: string]: Value }; value[name] = section; continue; }
        let equal = line.indexOf("="); if (equal < 0) equal = line.indexOf(":");
        if (equal < 0) throw new MikeError(`invalid ${format} entry`);
        section[line.slice(0, equal).trim()] = line.slice(equal + 1).trim();
      }
    } else throw new MikeError(`format '${format}' does not support decoding`);
  } catch (error) { if (error instanceof MikeError) throw error; throw new MikeError(`bad ${format} input: ${error instanceof Error ? error.message : String(error)}`); }
  // Use the native node admission path so every codec shares its quotas.
  await decodeDocuments(JSON.stringify(value), filename, fileIndex, "json", yaml, work, accept);
}

export async function encodeFormat(candidate: Candidate, format: MikeFormat, yaml: YamlModule, work: NativeWork): Promise<string> {
  const encoded = await encodeNative(candidate, { format: "json", indent: 0, unwrap: false, compactSequence: false }, yaml, work);
  const value = JSON.parse(encoded) as Value;
  const chunks: string[] = [];
  let size = 0;
  const append = (text: string) => { const bytes = Buffer.byteLength(text); if (bytes > work.limits.maxOutputBytes - size) throw new MikeError("yq limit exceeded: maxOutputBytes"); size += bytes; chunks.push(text); };
  const primitive = (item: Value) => item === null ? "" : typeof item === "object" ? JSON.stringify(item) : String(item);
  if (format === "base64" || format === "uri") {
    if (typeof value !== "string") throw new MikeError(`${format} encoding requires a string`);
    append(format === "base64" ? Buffer.from(value).toString("base64") : encodeURIComponent(value).split("%20").join("+").split("!").join("%21").split("'").join("%27").split("(").join("%28").split(")").join("%29").split("*").join("%2A"));
  } else if (format === "csv" || format === "tsv") {
    if (!Array.isArray(value)) throw new MikeError("CSV/TSV encoding requires an array");
    const delimiter = format === "csv" ? "," : "\t";
    const headers = mapping(value[0] ?? null) ? Object.keys(value[0] as object) : undefined;
    const row = (cells: Value[]) => { append(cells.map(item => { const text = primitive(item); return text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r") ? '"' + text.split('"').join('""') + '"' : text; }).join(delimiter) + "\n"); };
    if (headers) row(headers);
    for (const item of value) { await work.tick(); if (headers && mapping(item)) row(headers.map(key => item[key] ?? null)); else if (Array.isArray(item)) row(item); else throw new MikeError("CSV/TSV rows must be arrays or maps"); }
  } else if (format === "lua") {
    const write = async (item: Value, depth: number): Promise<void> => {
      await work.tick(); work.depth(depth);
      if (item === null) { append("nil"); return; }
      if (typeof item !== "object") { append(JSON.stringify(item)); return; }
      append("{\n");
      for (const [key, child] of Object.entries(item)) { append("\t".repeat(depth + 1)); if (!Array.isArray(item)) append(`[${JSON.stringify(key)}] = `); await write(child, depth + 1); append(";\n"); }
      append("\t".repeat(depth) + "}");
    };
    append("return "); await write(value, 0); append(";\n");
  } else if (format === "xml") {
    const escape = (text: string) => text.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;").split('"').join("&quot;");
    const write = async (name: string, item: Value, depth: number): Promise<void> => {
      await work.tick(); work.depth(depth);
      if (!name || Array.from(name).some(char => " <>/\t\r\n=\"'".includes(char))) throw new MikeError("invalid XML element name");
      if (Array.isArray(item)) { for (const child of item) await write(name, child, depth); return; }
      append(`<${name}`);
      if (mapping(item)) for (const [key, child] of Object.entries(item)) if (key.startsWith("+@")) append(` ${key.slice(2)}="${escape(primitive(child))}"`);
      append(">");
      if (mapping(item)) {
        const children = Object.entries(item).filter(([key]) => !key.startsWith("+@") && key !== "+content");
        if (children.length) append("\n");
        for (const [key, child] of children) { append(" ".repeat((depth + 1) * 2)); await write(key, child, depth + 1); }
        if (item["+content"] !== undefined) append(escape(primitive(item["+content"])));
        if (children.length) append(" ".repeat(depth * 2));
      } else append(escape(primitive(item)));
      append(`</${name}>\n`);
    };
    if (!mapping(value)) throw new MikeError("XML encoding requires a map");
    for (const [key, item] of Object.entries(value)) await write(key, item, 0);
  } else {
    if (!mapping(value)) throw new MikeError(`${format} encoding requires a map`);
    const flattened: [string, Value][] = [];
    const flatten = async (item: Value, path: string[], depth: number): Promise<void> => {
      await work.tick(); work.depth(depth);
      if (item !== null && typeof item === "object") { for (const [key, child] of Object.entries(item)) await flatten(child, [...path, key], depth + 1); }
      else flattened.push([path.join(format === "shell" ? "_" : "."), item]);
    };
    if (format === "toml" || format === "ini") {
      const tomlKey = (key: string) => key && Array.from(key).every(char => char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char >= "0" && char <= "9" || "_-".includes(char)) ? key : JSON.stringify(key);
      const tomlValue = async (item: Value, depth: number): Promise<string> => {
        await work.tick(); work.depth(depth);
        if (item === null) throw new MikeError("TOML cannot encode null");
        if (Array.isArray(item)) {
          const items: string[] = [];
          for (const child of item) items.push(await tomlValue(child, depth + 1));
          return `[${items.join(", ")}]`;
        }
        if (mapping(item)) {
          const entries: string[] = [];
          for (const [key, child] of Object.entries(item)) entries.push(`${tomlKey(key)} = ${await tomlValue(child, depth + 1)}`);
          return `{ ${entries.join(", ")} }`;
        }
        return JSON.stringify(item);
      };
      const write = async (item: { [key: string]: Value }, path: string[], depth: number): Promise<void> => {
        await work.tick(); work.depth(depth);
        const leaves = Object.entries(item).filter(([, child]) => !mapping(child));
        const width = Math.max(0, ...leaves.map(([key]) => key.length));
        if (path.length) append(`[${path.map(key => format === "toml" ? tomlKey(key) : key).join(".")}]\n`);
        for (const [key, child] of leaves) append(`${format === "toml" ? tomlKey(key) : key}${format === "ini" ? " ".repeat(width - key.length) : ""} = ${format === "toml" ? await tomlValue(child, depth + 1) : primitive(child)}\n`);
        for (const [key, child] of Object.entries(item)) if (mapping(child)) { append("\n"); await write(child, [...path, key], depth + 1); }
      };
      await write(value, [], 0);
    } else {
      await flatten(value, [], 0);
      for (const [key, item] of flattened) {
        if (format === "shell") {
          if (!key || Array.from(key).some((char, index) => !(char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char === "_" || index > 0 && char >= "0" && char <= "9"))) throw new MikeError("invalid shell variable name");
          const text = primitive(item);
          const safe = text && Array.from(text).every(char => char >= "a" && char <= "z" || char >= "A" && char <= "Z" || char >= "0" && char <= "9" || "_./-".includes(char));
          append(`${key}=${safe ? text : "'" + text.split("'").join("'\\''") + "'"}\n`);
        } else append(`${key} = ${primitive(item)}\n`);
      }
    }
  }
  return chunks.join("");
}
