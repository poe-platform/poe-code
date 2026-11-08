import type { Block, Inline, MetaValue } from "./ast-types.js";
import type { Document } from "./types.js";
import { AstError } from "./errors.js";
import { tableGeometry } from "./tables.js";
export { AstError } from "./errors.js";

export interface AstLimits {
  readonly depth: number;
  readonly nodes: number;
  readonly text: number;
  readonly attributes: number;
  readonly tableCells: number;
  readonly references: number;
  readonly resourceBytes: number;
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
  return v as Record<string, unknown>;
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
  Table: tableShape
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
function* normalization(
  value: unknown,
  options: Partial<AstLimits>,
  reserve: (key: keyof AstLimits, units: number) => void,
  cooperate?: (units: number) => Promise<void> | void
): Generator<Promise<void> | void, Document> {
  const ceilings = {
    depth: Infinity,
    nodes: Infinity,
    text: Infinity,
    attributes: Infinity,
    tableCells: Infinity,
    references: Infinity,
    resourceBytes: Infinity
  };
  const limits: AstLimits = { ...ceilings, ...options };
  for (const [k, n] of Object.entries(limits))
    if (
      !Object.hasOwn(ceilings, k) ||
      (n !== Infinity && !Number.isSafeInteger(n)) ||
      n < 0
    )
      fail(`$.limits.${k}`);
  let nodes = 0,
    text = 0,
    attributes = 0,
    cells = 0,
    references = 0,
    resourceBytes = 0,
    hasTable = false;
  const active = new Set<object>();
  const bound = (n: number, ceiling: number, p: string): void => {
    if (!Number.isSafeInteger(n) || n > ceiling) throw new AstError("E_LIMIT", p, "AST budget exceeded");
  };
  function checkStringBody(v: string, p: string, depth: number): void {
    bound(depth, limits.depth, p);
    bound(++nodes, limits.nodes, p);
    reserve("nodes", 1);
    bound((text += v.length), limits.text, p);
    reserve("text", v.length);
  }
  type Frame =
    | { kind: "node"; v: unknown; p: string; depth: number }
    | { kind: "arr"; v: unknown[]; elemValues: unknown[]; idx: number; p: string; depth: number }
    | { kind: "obj"; v: Record<string, unknown>; keys: string[]; idx: number; p: string; depth: number };
  const stack: Frame[] = [{ kind: "node", v: value, p: "$", depth: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.kind === "arr") {
      if (frame.idx < frame.elemValues.length) {
        const i = frame.idx++;
        stack.push({ kind: "node", v: frame.elemValues[i], p: `${frame.p}[${i}]`, depth: frame.depth + 1 });
      } else {
        stack.pop();
        if (Object.keys(frame.v).length !== frame.v.length) fail(frame.p);
        active.delete(frame.v);
      }
      continue;
    }
    if (frame.kind === "obj") {
      if (frame.idx < frame.keys.length) {
        const k = frame.keys[frame.idx++]!;
        checkStringBody(k, frame.p, frame.depth + 1);
        if (cooperate) { const c = cooperate(1); if (c) yield c; }
        for (let i = 0; i < k.length; i++) {
          if (i % 256 === 0 && cooperate) { const c = cooperate(1); if (c) yield c; }
          const ch = k.charCodeAt(i);
          if (ch >= 0xd800 && ch <= 0xdbff) {
            const next = k.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail(frame.p, "Invalid Unicode");
          } else if (ch >= 0xdc00 && ch <= 0xdfff) fail(frame.p, "Invalid Unicode");
        }
        if (!Object.hasOwn(frame.v, k)) fail(frame.p);
        const d = Object.getOwnPropertyDescriptor(frame.v, k);
        if (!d || !d.enumerable || !("value" in d) || ["__proto__", "constructor", "prototype"].includes(k))
          fail(`${frame.p}.${k}`);
        if (k === "t" && d.value === "Table") hasTable = true;
        stack.push({ kind: "node", v: d.value, p: `${frame.p}.${k}`, depth: frame.depth + 1 });
      } else {
        stack.pop();
        if (Object.getOwnPropertySymbols(frame.v).length) fail(frame.p);
        active.delete(frame.v);
      }
      continue;
    }
    stack.pop();
    const { v, p, depth } = frame;
    if (typeof v === "string") {
      checkStringBody(v, p, depth);
      if (cooperate) { const c = cooperate(1); if (c) yield c; }
      for (let i = 0; i < v.length; i++) {
        if (i % 256 === 0 && cooperate) { const c = cooperate(1); if (c) yield c; }
        const ch = v.charCodeAt(i);
        if (ch >= 0xd800 && ch <= 0xdbff) {
          const next = v.charCodeAt(++i);
          if (!(next >= 0xdc00 && next <= 0xdfff)) fail(p, "Invalid Unicode");
        } else if (ch >= 0xdc00 && ch <= 0xdfff) fail(p, "Invalid Unicode");
      }
      continue;
    }
    bound(depth, limits.depth, p);
    bound(++nodes, limits.nodes, p);
    reserve("nodes", 1);
    if (cooperate) { const c = cooperate(1); if (c) yield c; }
    if (v === null || typeof v === "boolean") continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail(p);
      continue;
    }
    if (typeof v !== "object" || active.has(v)) fail(p, "Non-JSON or cyclic input");
    if (v instanceof Uint8Array && p.startsWith("$.resources[") && p.endsWith(".bytes")) {
      bound((resourceBytes += v.byteLength), limits.resourceBytes, p);
      reserve("resourceBytes", v.byteLength);
      continue;
    }
    active.add(v);
    if (Array.isArray(v)) {
      bound(nodes + v.length, limits.nodes, p);
      if (Object.getOwnPropertySymbols(v).length) fail(p);
      const elemValues = new Array<unknown>(v.length);
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, i);
        if (!d || !("value" in d)) fail(`${p}[${i}]`, "Accessor or sparse array");
        elemValues[i] = d.value;
        if (cooperate) { const c = cooperate(1); if (c) yield c; }
      }
      if (
        v.length === 3 &&
        typeof elemValues[0] === "string" &&
        Array.isArray(elemValues[1]) &&
        Array.isArray(elemValues[2])
      ) {
        const count = 1 + elemValues[1].length + elemValues[2].length;
        bound((attributes += count), limits.attributes, p);
        reserve("attributes", count);
      }
      if (v.length === 5 && Array.isArray(elemValues[0]) && typeof elemValues[1] === "string") {
        if (
          typeof elemValues[2] !== "number" ||
          typeof elemValues[3] !== "number" ||
          !Number.isSafeInteger(elemValues[2]) ||
          !Number.isSafeInteger(elemValues[3]) ||
          elemValues[2] < 1 ||
          elemValues[3] < 1
        )
          fail(p, "Invalid spans");
        bound((cells += elemValues[2] * elemValues[3]), limits.tableCells, p);
        reserve("tableCells", elemValues[2] * elemValues[3]);
        bound((references += elemValues[2] * elemValues[3]), limits.references, p);
        reserve("references", elemValues[2] * elemValues[3]);
      }
      stack.push({ kind: "arr", v, elemValues, idx: 0, p, depth });
    } else {
      const keys = Object.getOwnPropertyNames(v);
      stack.push({ kind: "obj", v: v as Record<string, unknown>, keys, idx: 0, p, depth });
    }
  }
  validateDocument(value);
  function* geometry(v: unknown, p: string): Generator<Promise<void> | void> {
    if (v === null || typeof v !== "object" || v instanceof Uint8Array) return;
    if (cooperate) { const c = cooperate(1); if (c) yield c; }
    if ("t" in v && v.t === "Table") {
      const content = (v as Extract<Block, { t: "Table" }>).c;
      for (const _ of tableGeometry(content, `${p}.c`)) {
        if (cooperate) { const c = cooperate(1); if (c) yield c; }
      }
    }
    if (Array.isArray(v)) {
      for (const [index, child] of v.entries()) yield* geometry(child, `${p}[${index}]`);
    } else {
      for (const [key, child] of Object.entries(v)) yield* geometry(child, `${p}.${key}`);
    }
  }
  if (hasTable) yield* geometry(value, "$");
  return structuredClone(value);
}

/** Identity normalization retains a bounded owned AST by design. */
export function normalizeDocument(value: unknown, options: Partial<AstLimits> = {}): Document {
  const steps = normalization(value, options, () => {});
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export async function normalizeDocumentCooperatively(
  value: unknown,
  options: Partial<AstLimits>,
  cooperate: (units: number) => Promise<void> | void,
  reserve: (key: keyof AstLimits, units: number) => void = () => {}
): Promise<Document> {
  const steps = normalization(value, options, reserve, cooperate);
  let step = steps.next();
  while (!step.done) {
    if (step.value) await step.value;
    step = steps.next();
  }
  return step.value;
}
