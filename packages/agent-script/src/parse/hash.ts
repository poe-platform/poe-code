import { parse, parseModule, type Module, type ParseResult } from "./parser.js";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const IGNORED_KEYS = new Set(["nodeId", "raw", "span"]);

export function hashSource(source: string): string {
  try {
    return hashParsedAst(parse(source));
  } catch {
    return hashParsedAst(parseModule(source));
  }
}

export function hashParsedAst(ast: Module | ParseResult): string {
  let hash = FNV_OFFSET_BASIS;

  visit(ast);

  return hash.toString(16).padStart(8, "0");

  function visit(value: unknown): void {
    if (value === null) {
      write("null");
      return;
    }

    if (value === undefined) {
      write("undefined");
      return;
    }

    if (Array.isArray(value)) {
      write("[");
      for (const entry of value) {
        visit(entry);
        write(",");
      }
      write("]");
      return;
    }

    switch (typeof value) {
      case "boolean":
        write(value ? "true" : "false");
        return;
      case "number":
        write(Object.is(value, -0) ? "-0" : String(value));
        return;
      case "string":
        write(JSON.stringify(value));
        return;
      case "object": {
        const keys = Object.keys(value)
          .filter((key) => !IGNORED_KEYS.has(key))
          .sort();

        write("{");
        for (const key of keys) {
          write(JSON.stringify(key));
          write(":");
          visit((value as Record<string, unknown>)[key]);
          write(",");
        }
        write("}");
        return;
      }
      default:
        throw new TypeError(`Unsupported AST value type: ${typeof value}`);
    }
  }

  function write(chunk: string): void {
    for (let index = 0; index < chunk.length; index += 1) {
      hash ^= chunk.charCodeAt(index);
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
  }
}
