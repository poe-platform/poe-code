import type { Block, Inline, MetaValue, Row } from "./ast-types.js";
import type { Document } from "./types.js";

export interface AstLimits {
  readonly depth: number;
  readonly nodes: number;
  readonly text: number;
  readonly attributes: number;
  readonly tableCells: number;
  readonly resourceBytes: number;
}
export class AstError extends Error {
  constructor(
    readonly code: "E_AST" | "E_LIMIT",
    readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`);
  }
}
type Check = (value: unknown, path: string) => void;
function fail(path: string, message = "Invalid shape"): never {
  throw new AstError("E_AST", path, message);
}
const str: Check = (v, p) => {
  if (typeof v !== "string") fail(p);
};
const integer: Check = (v, p) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) fail(p);
};
const positive: Check = (v, p) => {
  integer(v, p);
  if (typeof v !== "number" || v < 1) fail(p, "Invalid span or level");
};
const choice =
  (...values: readonly string[]): Check =>
  (v, p) => {
    if (typeof v !== "string" || !values.includes(v)) fail(p);
  };
const array =
  (check: Check): Check =>
  (v, p) => {
    if (!Array.isArray(v)) fail(p);
    else v.forEach((x: unknown, i: number) => check(x, `${p}[${i}]`));
  };
const tuple =
  (...checks: readonly Check[]): Check =>
  (v, p) => {
    if (!Array.isArray(v) || v.length !== checks.length) fail(p);
    else checks.forEach((check, i) => check(v[i], `${p}[${i}]`));
  };
function record(v: unknown, p: string): Record<string, unknown> {
  if (
    v === null ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null)
  )
    fail(p);
  // Narrow through own descriptors; no getters are executed.
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(v)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      fail(`${p}.${key}`, "Dangerous key");
    const descriptor = Object.getOwnPropertyDescriptor(v, key);
    if (!descriptor || !("value" in descriptor)) fail(`${p}.${key}`, "Accessor");
    result[key] = descriptor.value;
  }
  return result;
}
const attr = tuple(str, array(str), array(tuple(str, str)));
const align = choice("AlignLeft", "AlignRight", "AlignCenter", "AlignDefault");
function tagged(shapes: Readonly<Record<string, Check | null>>): Check {
  return (v, p) => {
    const r = record(v, p);
    if (typeof r.t !== "string" || !Object.hasOwn(shapes, r.t)) fail(`${p}.t`, "Unknown tag");
    const check = shapes[r.t];
    if (
      Object.keys(r).some((k) => k !== "t" && k !== "c") ||
      (check === null ? Object.hasOwn(r, "c") : !Object.hasOwn(r, "c"))
    )
      fail(p);
    if (check) check(r.c, `${p}.c`);
  };
}
const inlines: Check = (v, p) => array(inline)(v, p);
const blocks: Check = (v, p) => array(block)(v, p);
const caption = tuple((v, p) => {
  if (v !== null) inlines(v, p);
}, blocks);
const cell = tuple(attr, align, positive, positive, blocks);
const row = tuple(attr, array(cell));
const head = tuple(attr, array(row));
const finite: Check = (v, p) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1) fail(p);
};
const citation: Check = (v, p) => {
  const r = record(v, p);
  const checks: Record<string, Check> = {
    citationId: str,
    citationPrefix: inlines,
    citationSuffix: inlines,
    citationMode: choice("AuthorInText", "SuppressAuthor", "NormalCitation"),
    citationNoteNum: integer,
    citationHash: integer
  };
  if (Object.keys(r).length !== 6) fail(p);
  for (const [k, check] of Object.entries(checks)) check(r[k], `${p}.${k}`);
};
const inline: Check = tagged({
  Str: str,
  Space: null,
  SoftBreak: null,
  LineBreak: null,
  Emph: inlines,
  Underline: inlines,
  Strong: inlines,
  Strikeout: inlines,
  Superscript: inlines,
  Subscript: inlines,
  SmallCaps: inlines,
  Quoted: tuple(choice("SingleQuote", "DoubleQuote"), inlines),
  Cite: tuple(array(citation), inlines),
  Code: tuple(attr, str),
  Math: tuple(choice("InlineMath", "DisplayMath"), str),
  RawInline: tuple(str, str),
  Link: tuple(attr, inlines, tuple(str, str)),
  Image: tuple(attr, inlines, tuple(str, str)),
  Note: blocks,
  Span: tuple(attr, inlines)
} satisfies Record<Inline["t"], Check | null>);
const tableShape = tuple(
  attr,
  caption,
  array(tuple(align, tagged({ ColWidthDefault: null, ColWidth: finite }))),
  head,
  array(tuple(attr, integer, array(row), array(row))),
  head
);
function assertTable(v: unknown, p: string): asserts v is Extract<Block, { t: "Table" }>["c"] {
  tableShape(v, p);
}
const table: Check = (v, p) => {
  assertTable(v, p);
  const columns = v[2].length;
  const section = (rows: readonly Row[], path: string): void => {
    // Sparse occupancy; never allocate the row-by-column rectangular grid.
    const occupied = new Map<number, number>();
    rows.forEach((r, i) => {
      let column = 0;
      for (const [index, cell] of r[1].entries()) {
        while ((occupied.get(column) ?? 0) > i) column++;
        const pathCell = `${path}[${i}][1][${index}]`;
        if (cell[2] > rows.length - i || cell[3] > columns - column)
          fail(pathCell, "Span exceeds table section");
        for (let offset = 0; offset < cell[3]; offset++) {
          if ((occupied.get(column + offset) ?? 0) > i) fail(pathCell, "Overlapping spans");
          occupied.set(column + offset, i + cell[2]);
        }
        column += cell[3];
      }
    });
  };
  section(v[3][1], `${p}[3][1]`);
  v[4].forEach((body, i) => {
    if (body[1] < 0 || body[1] > columns) fail(`${p}[4][${i}][1]`, "Invalid row head columns");
    section(body[2], `${p}[4][${i}][2]`);
    section(body[3], `${p}[4][${i}][3]`);
  });
  section(v[5][1], `${p}[5][1]`);
};
const block: Check = tagged({
  Plain: inlines,
  Para: inlines,
  LineBlock: array(inlines),
  CodeBlock: tuple(attr, str),
  RawBlock: tuple(str, str),
  BlockQuote: blocks,
  OrderedList: tuple(
    tuple(
      integer,
      choice(
        "DefaultStyle",
        "Example",
        "Decimal",
        "LowerRoman",
        "UpperRoman",
        "LowerAlpha",
        "UpperAlpha"
      ),
      choice("DefaultDelim", "Period", "OneParen", "TwoParens")
    ),
    array(blocks)
  ),
  BulletList: array(blocks),
  DefinitionList: array(tuple(inlines, array(blocks))),
  Header: tuple(positive, attr, inlines),
  HorizontalRule: null,
  Div: tuple(attr, blocks),
  Figure: tuple(attr, caption, blocks),
  Table: table
} satisfies Record<Block["t"], Check | null>);
const metadata: Check = (v, p) => {
  for (const [k, x] of Object.entries(record(v, p))) meta(x, `${p}.${k}`);
};
const meta: Check = tagged({
  MetaMap: metadata,
  MetaList: (v, p) => array(meta)(v, p),
  MetaBool: (v, p) => {
    if (typeof v !== "boolean") fail(p);
  },
  MetaString: str,
  MetaInlines: inlines,
  MetaBlocks: blocks
} satisfies Record<MetaValue["t"], Check | null>);

function validateDocument(value: unknown): asserts value is Document {
  const r = record(value, "$");
  if (
    Object.keys(r).some(
      (k) => !["blocks", "metadata", "resources", "language", "direction"].includes(k)
    )
  )
    fail("$");
  blocks(r.blocks, "$.blocks");
  metadata(r.metadata, "$.metadata");
  if (Object.hasOwn(r, "language")) str(r.language, "$.language");
  if (Object.hasOwn(r, "direction")) choice("ltr", "rtl", "auto")(r.direction, "$.direction");
  array((v, p) => {
    const resource = record(v, p);
    if (Object.keys(resource).length !== 2 || !(resource.bytes instanceof Uint8Array)) fail(p);
    str(resource.id, `${p}.id`);
  })(r.resources, "$.resources");
}
/** Identity normalization: owned data, identical constructors, order, fields and text. */
export function normalizeDocument(value: unknown, options: Partial<AstLimits> = {}): Document {
  const ceilings = {
    depth: 128,
    nodes: 100_000,
    text: 32 * 1024 * 1024,
    attributes: 100_000,
    tableCells: 100_000,
    resourceBytes: 64 * 1024 * 1024
  };
  const limits: AstLimits = { ...ceilings, ...options };
  for (const [k, n] of Object.entries(limits))
    if (
      !Object.hasOwn(ceilings, k) ||
      !Number.isSafeInteger(n) ||
      n < 0 ||
      n > Object.getOwnPropertyDescriptor(ceilings, k)?.value
    )
      fail(`$.limits.${k}`);
  let nodes = 0,
    text = 0,
    attributes = 0,
    cells = 0,
    resourceBytes = 0;
  const active = new Set<object>();
  const bound = (n: number, ceiling: number, p: string): void => {
    if (n > ceiling) throw new AstError("E_LIMIT", p, "AST budget exceeded");
  };
  const visit = (v: unknown, p: string, depth: number): void => {
    bound(depth, limits.depth, p);
    bound(++nodes, limits.nodes, p);
    if (typeof v === "string") {
      bound((text += v.length), limits.text, p);
      for (let i = 0; i < v.length; i++) {
        const c = v.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = v.charCodeAt(++i);
          if (!(next >= 0xdc00 && next <= 0xdfff)) fail(p, "Invalid Unicode");
        } else if (c >= 0xdc00 && c <= 0xdfff) fail(p, "Invalid Unicode");
      }
      return;
    }
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail(p);
      return;
    }
    if (typeof v !== "object" || active.has(v)) fail(p, "Non-JSON or cyclic input");
    if (v instanceof Uint8Array && p.startsWith("$.resources[") && p.endsWith(".bytes")) {
      bound((resourceBytes += v.byteLength), limits.resourceBytes, p);
      return;
    }
    active.add(v);
    if (Array.isArray(v)) {
      bound(nodes + v.length, limits.nodes, p);
      if (Object.getOwnPropertySymbols(v).length) fail(p);
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !("value" in d)) fail(`${p}[${i}]`, "Accessor or sparse array");
      }
      // Attribute triples and modern cell tuples have unambiguous structural arity.
      if (v.length === 3 && typeof v[0] === "string" && Array.isArray(v[1]) && Array.isArray(v[2]))
        bound((attributes += 1 + v[1].length + v[2].length), limits.attributes, p);
      if (v.length === 5 && Array.isArray(v[0]) && typeof v[1] === "string") {
        if (
          typeof v[2] !== "number" ||
          typeof v[3] !== "number" ||
          !Number.isSafeInteger(v[2]) ||
          !Number.isSafeInteger(v[3]) ||
          v[2] < 1 ||
          v[3] < 1
        )
          fail(p, "Invalid spans");
        bound((cells += v[2] * v[3]), limits.tableCells, p);
      }
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !("value" in d)) fail(`${p}[${i}]`);
        visit(d.value, `${p}[${i}]`, depth + 1);
      }
      if (Object.keys(v).length !== v.length) fail(p);
    } else {
      // Inspect before allocating an owned result or running constructor validation.
      for (const k in v) {
        visit(k, p, depth + 1);
        if (!Object.hasOwn(v, k)) fail(p);
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (!d || !("value" in d) || ["__proto__", "constructor", "prototype"].includes(k))
          fail(`${p}.${k}`);
        visit(d.value, `${p}.${k}`, depth + 1);
      }
      if (Object.getOwnPropertySymbols(v).length) fail(p);
    }
    active.delete(v);
  };
  visit(value, "$", 0);
  validateDocument(value);
  return structuredClone(value);
}
