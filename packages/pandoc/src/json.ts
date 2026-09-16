import { visit } from "jsonc-parser";
import { PandocError } from "./errors.js";
import type { AdapterContext, Document, ReaderCapability, WriterCapability } from "./types.js";

const apiVersion = [1, 23, 1, 2] as const;
function fail(operation: "read" | "write", path: string, message: string): never {
  throw new PandocError("E_AST", operation, message, "json", path);
}
function record(
  value: unknown,
  operation: "read" | "write",
  path: string
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(operation, path, "Expected object");
  return value as Record<string, unknown>;
}
function tuple(
  value: unknown,
  length: number,
  operation: "read" | "write",
  path: string
): unknown[] {
  if (!Array.isArray(value) || value.length !== length)
    fail(operation, path, "Invalid tuple arity");
  return value;
}
function list(value: unknown, operation: "read" | "write", path: string): unknown[] {
  if (!Array.isArray(value)) fail(operation, path, "Expected array");
  return value;
}

/** Reject integer-valued tokens rounded by binary64 before constructor validation. */
function exactInteger(token: string, value: number): boolean {
  const lower = token.toLowerCase();
  const [mantissa = "", exponent = "0"] = lower.split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  const scale = Number(exponent) - fraction.length;
  // Bound BigInt allocation; the input string has already passed the input budget.
  if (digits.length > 1024 || Math.abs(scale) > 1024) return false;
  const coefficient = BigInt(digits);
  const divisor = 10n ** BigInt(Math.abs(scale));
  return scale >= 0
    ? coefficient * divisor === BigInt(value)
    : coefficient % divisor === 0n && coefficient / divisor === BigInt(value);
}

function parse(text: string, context: AdapterContext): unknown {
  const keys: (Set<string> | null)[] = [];
  let nodes = 0;
  const node = (): void => {
    context.checkpoint();
    context.bound("nodes", ++nodes);
    context.bound("depth", keys.length);
  };
  visit(
    text,
    {
      onObjectBegin: () => {
        node();
        keys.push(new Set());
      },
      onObjectProperty: (key, offset) => {
        node();
        const current = keys.at(-1);
        if (current?.has(key)) fail("read", `$@${offset}`, `Duplicate object key: ${key}`);
        current?.add(key);
      },
      onObjectEnd: () => {
        keys.pop();
      },
      onArrayBegin: () => {
        node();
        keys.push(null);
      },
      onArrayEnd: () => {
        keys.pop();
      },
      onLiteralValue: (value, offset, length) => {
        node();
        if (
          typeof value === "number" &&
          (!Number.isFinite(value) ||
            (Number.isInteger(value) &&
              (!Number.isSafeInteger(value) ||
                !exactInteger(text.slice(offset, offset + length), value))))
        )
          fail("read", `$@${offset}`, "Number exceeds exact integer range or is rounded");
      },
      onError: (_error, offset) => {
        fail("read", `$@${offset}`, "Invalid JSON syntax");
      }
    },
    { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false }
  );
  return JSON.parse(text) as unknown;
}

/** Contextual conversion only: text and metadata keys never become constructors. */
async function translate(
  value: unknown,
  operation: "read" | "write",
  context: AdapterContext,
  path: string
): Promise<unknown> {
  await context.cooperate();
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const [i, child] of value.entries())
      result.push(await translate(child, operation, context, `${path}[${i}]`));
    return result;
  }
  const source = record(value, operation, path);
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(source))
    result[key] = await translate(child, operation, context, `${path}.${key}`);
  const enumValue = (v: unknown, p: string): unknown => {
    if (operation === "write") {
      if (typeof v !== "string") fail(operation, p, "Expected enum string");
      return { t: v };
    }
    const r = record(v, operation, p);
    if (Object.keys(r).length !== 1 || typeof r.t !== "string")
      fail(operation, p, "Invalid enum arity");
    return r.t;
  };
  if (result.t === "Quoted" || result.t === "Math") {
    const c = tuple(result.c, 2, operation, `${path}.c`);
    c[0] = enumValue(c[0], `${path}.c[0]`);
  } else if (result.t === "Cite") {
    const c = tuple(result.c, 2, operation, `${path}.c`);
    for (const [i, citation] of list(c[0], operation, `${path}.c[0]`).entries()) {
      const r = record(citation, operation, `${path}.c[0][${i}]`);
      r.citationMode = enumValue(r.citationMode, `${path}.c[0][${i}].citationMode`);
    }
  } else if (result.t === "OrderedList") {
    const c = tuple(result.c, 2, operation, `${path}.c`);
    const attrs = tuple(c[0], 3, operation, `${path}.c[0]`);
    attrs[1] = enumValue(attrs[1], `${path}.c[0][1]`);
    attrs[2] = enumValue(attrs[2], `${path}.c[0][2]`);
  } else if (result.t === "Table") {
    const c = tuple(result.c, 6, operation, `${path}.c`);
    for (const [i, spec] of list(c[2], operation, `${path}.c[2]`).entries()) {
      const s = tuple(spec, 2, operation, `${path}.c[2][${i}]`);
      s[0] = enumValue(s[0], `${path}.c[2][${i}][0]`);
    }
    const rows = (value: unknown, p: string): void => {
      for (const [i, row] of list(value, operation, p).entries()) {
        const r = tuple(row, 2, operation, `${p}[${i}]`);
        for (const [j, cell] of list(r[1], operation, `${p}[${i}][1]`).entries()) {
          const cellPath = `${p}[${i}][1][${j}]`;
          const cellTuple = tuple(cell, 5, operation, cellPath);
          cellTuple[1] = enumValue(cellTuple[1], `${cellPath}[1]`);
        }
      }
    };
    rows(tuple(c[3], 2, operation, `${path}.c[3]`)[1], `${path}.c[3][1]`);
    for (const [i, body] of list(c[4], operation, `${path}.c[4]`).entries()) {
      const b = tuple(body, 4, operation, `${path}.c[4][${i}]`);
      rows(b[2], `${path}.c[4][${i}][2]`);
      rows(b[3], `${path}.c[4][${i}][3]`);
    }
    rows(tuple(c[5], 2, operation, `${path}.c[5]`)[1], `${path}.c[5][1]`);
  }
  return result;
}

export const jsonReader: ReaderCapability = {
  format: "json",
  async read(input, context) {
    const root = record(parse(input.text ?? "", context), "read", "$");
    if (
      Object.keys(root).length !== 3 ||
      !Object.hasOwn(root, "meta") ||
      !Object.hasOwn(root, "blocks")
    )
      fail("read", "$", "Expected pandoc-api-version, meta and blocks only");
    const version = tuple(root["pandoc-api-version"], 4, "read", "$.pandoc-api-version");
    if (version.some((v, i) => v !== apiVersion[i]))
      fail("read", "$.pandoc-api-version", "Unsupported API version; expected [1,23,1,2]");
    return {
      blocks: (await translate(root.blocks, "read", context, "$.blocks")) as Document["blocks"],
      metadata: (await translate(root.meta, "read", context, "$.meta")) as Document["metadata"],
      resources: []
    };
  }
};
export const jsonWriter: WriterCapability = {
  format: "json",
  math: "source",
  async write(document, context) {
    if (
      document.resources.length ||
      Object.hasOwn(document, "language") ||
      Object.hasOwn(document, "direction")
    )
      throw new PandocError(
        "E_CAPABILITY",
        "write",
        "Pandoc JSON cannot represent resources, language or direction document fields",
        "json",
        "$"
      );
    const root = {
      "pandoc-api-version": apiVersion,
      meta: await translate(document.metadata, "write", context, "$.meta"),
      blocks: await translate(document.blocks, "write", context, "$.blocks")
    };
    return { kind: "text", text: JSON.stringify(root) + "\n" };
  }
};
