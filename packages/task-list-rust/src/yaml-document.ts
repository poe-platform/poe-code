import { native } from "./native.js";
import { parseDocument as parseValueDocument, stringify } from "./yaml.js";

type Syntax = ReturnType<typeof native.taskYamlSpans>["nodes"][number];
class Scalar {
  constructor(readonly value: unknown) {}
}
type Node = YAMLMap | Scalar;
interface Pair {
  key: Scalar;
  value: Node;
  source?: { start: number; end: number; valueStart: number; original: Node };
}
interface Layout {
  source: string;
  syntax: Syntax;
  original: readonly Pair[];
  start: number;
  end: number;
}
function unwrap(node: Node): unknown {
  return node instanceof YAMLMap ? node.toJS() : node.value;
}
function keyName(pair: Pair): string {
  return String(pair.key.value);
}
export class YAMLMap {
  items: Pair[] = [];
  layout?: Layout;
  base?: Record<string, unknown>;
  get(key: string): unknown {
    const node = this.items.find((pair) => pair.key.value === key)?.value;
    return node instanceof Scalar ? node.value : node;
  }
  toJS(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const originalKeys = new Set(this.layout?.original.map(keyName));
    for (const [key, value] of Object.entries(this.base ?? {}))
      if (!originalKeys.has(key))
        Object.defineProperty(result, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true
        });
    for (const pair of this.items) {
      const key = keyName(pair);
      if (
        pair.source &&
        this.base &&
        !Object.hasOwn(this.base, key) &&
        pair.value === pair.source.original
      )
        continue;
      Object.defineProperty(result, key, {
        value: unwrap(pair.value),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return result;
  }
}
export function isMap(value: unknown): value is YAMLMap {
  return value instanceof YAMLMap;
}
function lineStart(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}
function indentation(source: string, offset: number): number {
  const start = lineStart(source, offset);
  let cursor = start;
  while (source[cursor] === " ") cursor++;
  return cursor - start;
}
function pairStart(source: string, offset: number, lower: number): number {
  let start = lineStart(source, offset);
  const indent = indentation(source, offset);
  while (start > lower) {
    const previousEnd = start - 1,
      previousStart = lineStart(source, previousEnd),
      line = source.slice(previousStart, previousEnd).trimEnd();
    if (
      line.trim().length === 0 ||
      (indentation(source, previousStart) >= indent && line.trimStart().startsWith("#"))
    )
      start = previousStart;
    else break;
  }
  return Math.max(start, lower);
}
function fresh(value: unknown): Node {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value instanceof Date ||
    value instanceof Map
  )
    return new Scalar(value);
  const map = new YAMLMap();
  for (const [key, entry] of Object.entries(value))
    map.items.push({ key: new Scalar(key), value: fresh(entry) });
  return map;
}
function scalarKey(syntax: Syntax): unknown {
  if (!syntax.scalar) return syntax.text;
  const temporal = syntax.scalar.temporals[0];
  if (temporal) return temporal[1] === "symbol" ? Symbol(temporal[2]) : new Date(temporal[1]);
  return syntax.scalar.value;
}
function fromSyntax(value: unknown, index: number, source: string, nodes: Syntax[]): Node {
  const syntax = nodes[index];
  if (
    syntax.kind !== "mapping" ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return new Scalar(value);
  const map = new YAMLMap(),
    record = value as Record<string, unknown>;
  map.base = record;
  const starts = syntax.children
    .filter((_, i) => i % 2 === 0)
    .map((i) => pairStart(source, nodes[i].start, 0));
  for (let i = 0; i < syntax.children.length; i += 2) {
    const key = nodes[syntax.children[i]],
      valueIndex = syntax.children[i + 1];
    if (valueIndex === undefined || key.kind !== "scalar")
      throw Error("YAML editing requires scalar mapping keys.");
    const keyValue = scalarKey(key);
    const child = fromSyntax(record[String(keyValue)], valueIndex, source, nodes),
      position = i / 2;
    map.items.push({
      key: new Scalar(keyValue),
      value: child,
      source: {
        start: starts[position],
        end: starts[position + 1] ?? syntax.end,
        valueStart: nodes[valueIndex].start,
        original: child
      }
    });
  }
  map.layout = {
    source,
    syntax,
    original: [...map.items],
    start: starts[0] ?? lineStart(source, syntax.start),
    end: syntax.end
  };
  return map;
}
function changed(node: Node): boolean {
  if (node instanceof Scalar) return false;
  const original = node.layout?.original;
  return (
    !original ||
    original.length !== node.items.length ||
    node.items.some(
      (pair, i) =>
        pair !== original[i] || pair.value !== pair.source?.original || changed(pair.value)
    )
  );
}
function indentLines(value: string, indent: number): string {
  return value
    .split("\n")
    .map((line, i, lines) =>
      i === lines.length - 1 && line === "" ? "" : " ".repeat(indent) + line
    )
    .join("\n");
}
function inlineComment(line: string): string {
  let quote = "",
    escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (quote === "'" && line[i + 1] === "'") {
          i++;
          continue;
        }
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
      let start = i;
      while (start > 0 && (line[start - 1] === " " || line[start - 1] === "\t")) start--;
      return line.slice(start);
    }
  }
  return "";
}
function renderExistingPair(pair: Pair, source: string, indent: number, map?: YAMLMap): string {
  const layout = pair.source!;
  if (pair.value === layout.original && !changed(pair.value))
    return source.slice(layout.start, layout.end);
  if (map?.layout && !map.layout.syntax.flow) {
    const prefix = source.slice(layout.start, map.layout.start);
    return prefix + renderMap(map, indent + 2);
  }
  const raw = source.slice(layout.start, layout.end),
    newline = raw.indexOf("\n"),
    firstLine = newline === -1 ? raw : raw.slice(0, newline);
  const comment = inlineComment(firstLine);
  if (
    map?.layout?.syntax.flow &&
    source.slice(map.layout.syntax.start, map.layout.syntax.end).includes("#")
  )
    throw Error("Editing flow mappings with comments is not supported yet.");
  const nextValue = unwrap(pair.value),
    quote = source[layout.valueStart];
  let content: string;
  if (
    typeof nextValue === "string" &&
    (quote === "'" || quote === '"') &&
    !nextValue.includes("\n") &&
    !nextValue.includes("\r")
  ) {
    const encoded =
      quote === "'" ? "'" + nextValue.split("'").join("''") + "'" : JSON.stringify(nextValue);
    content = source.slice(layout.start, layout.valueStart) + encoded + "\n";
  } else content = indentLines(stringify({ [keyName(pair)]: nextValue }), indent);
  const end = content.indexOf("\n");
  return comment ? content.slice(0, end) + comment + content.slice(end) : content;
}
function renderMap(map: YAMLMap, indent: number): string {
  const layout = map.layout;
  if (layout?.syntax.flow) {
    if (!changed(map)) return layout.source.slice(layout.syntax.start, layout.syntax.end);
    const raw = layout.source.slice(layout.syntax.start, layout.syntax.end);
    if (raw.includes("#")) throw Error("Editing flow mappings with comments is not supported yet.");
    return indentLines(stringify(map.toJS()), indent);
  }
  if (!layout) return indentLines(stringify(map.toJS()), indent);
  if (map.items.length === 0) return indentLines(stringify({}), indent);
  indent = indentation(layout.source, layout.syntax.start);
  return map.items
    .map((pair) =>
      pair.source
        ? renderExistingPair(
            pair,
            layout.source,
            indent,
            pair.value instanceof YAMLMap ? pair.value : undefined
          )
        : indentLines(stringify({ [keyName(pair)]: unwrap(pair.value) }), indent)
    )
    .join("");
}
export class Document {
  readonly errors: Error[];
  private root: Node;
  constructor(readonly source: string) {
    const parsed = parseValueDocument(source);
    this.errors = parsed.errors;
    this.root = new Scalar(undefined);
    if (this.errors.length) return;
    try {
      const syntax = native.taskYamlSpans(source);
      this.root = fromSyntax(parsed.toJS(), syntax.root, source, syntax.nodes);
    } catch (error) {
      this.errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  get(key: string): unknown {
    return this.root instanceof YAMLMap ? this.root.get(key) : undefined;
  }
  toJS(): unknown {
    return unwrap(this.root);
  }
  setIn(path: readonly string[], value: unknown): void {
    if (path.length === 0) {
      this.root = fresh(value);
      return;
    }
    if (!(this.root instanceof YAMLMap)) this.root = new YAMLMap();
    let map = this.root;
    for (const key of path.slice(0, -1)) {
      let pair = map.items.find((pair) => pair.key.value === key);
      if (!pair) {
        pair = { key: new Scalar(key), value: new YAMLMap() };
        map.items.push(pair);
      }
      if (!(pair.value instanceof YAMLMap)) pair.value = new YAMLMap();
      map = pair.value;
    }
    const key = path.at(-1)!,
      pair = map.items.find((pair) => pair.key.value === key);
    if (pair) pair.value = fresh(value);
    else map.items.push({ key: new Scalar(key), value: fresh(value) });
  }
  deleteIn(path: readonly string[]): boolean {
    let map = this.root;
    if (!(map instanceof YAMLMap)) return false;
    for (const key of path.slice(0, -1)) {
      const next: unknown = map.get(key);
      if (!(next instanceof YAMLMap)) return false;
      map = next;
    }
    const index = map.items.findIndex((pair) => pair.key.value === path.at(-1));
    if (index < 0) return false;
    map.items.splice(index, 1);
    return true;
  }
  toString(): string {
    if (this.errors.length) throw this.errors[0];
    if (!(this.root instanceof YAMLMap)) return stringify(unwrap(this.root));
    if (!changed(this.root)) return this.source.endsWith("\n") ? this.source : this.source + "\n";
    const layout = this.root.layout;
    return (
      (layout ? this.source.slice(0, layout.start) : "") +
      renderMap(this.root, 0) +
      (layout ? this.source.slice(layout.end) : "")
    );
  }
}
export function parseDocument(source: string, _options?: unknown): Document {
  return new Document(source);
}
