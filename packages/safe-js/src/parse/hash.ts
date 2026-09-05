import { parse, parseModule, type FunctionNode, type Module, type ParseResult } from "./parser.js";
import { SandboxError, type CompileOwner } from "../interp/budget.js";
import { functionSources, type FunctionSource } from "./function-source.js";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const IGNORED_KEYS = new Set(["nodeId", "raw", "span"]);

export function hashSource(
  source: string,
  owner?: CompileOwner,
  includeFunctionSource = true
): string {
  try {
    return hashParsedAst(parse(source, "<input>", owner), includeFunctionSource);
  } catch (error) {
    if (error instanceof SandboxError) throw error;
    return hashParsedAst(parseModule(source, "<input>", owner), includeFunctionSource);
  }
}

export function hashParsedAst(ast: Module | ParseResult, includeFunctionSource = true): string {
  let hash = FNV_OFFSET_BASIS;

  visit(ast);

  return hash.toString(16).padStart(8, "0");

  function visit(
    value: unknown,
    includeTemplateRaw = false,
    enclosingSource?: FunctionSource
  ): void {
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
        visit(entry, includeTemplateRaw, enclosingSource);
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
        const record = value as Record<string, unknown>;
        const source = includeFunctionSource
          ? functionSources.get(value as FunctionNode)
          : undefined;
        if (
          source !== undefined &&
          !(
            enclosingSource !== undefined &&
            source.text === enclosingSource.text &&
            source.start >= enclosingSource.start &&
            source.end <= enclosingSource.end
          )
        ) {
          write("function-source:");
          write(String(source.end - source.start));
          write(":");
          write(source.text, source.start, source.end);
        }
        const keys = Object.keys(value)
          .filter((key) => shouldHashKey(record, key, includeTemplateRaw))
          .sort();

        write("{");
        for (const key of keys) {
          write(JSON.stringify(key));
          write(":");
          visit(
            record[key],
            shouldIncludeTemplateRaw(record, key, includeTemplateRaw),
            source ?? enclosingSource
          );
          write(",");
        }
        write("}");
        return;
      }
      default:
        throw new TypeError(`Unsupported AST value type: ${typeof value}`);
    }
  }

  function write(chunk: string, start = 0, end = chunk.length): void {
    for (let index = start; index < end; index += 1) {
      hash ^= chunk.charCodeAt(index);
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
  }
}

function shouldHashKey(
  record: Record<string, unknown>,
  key: string,
  includeTemplateRaw: boolean
): boolean {
  if (key !== "raw") {
    return !IGNORED_KEYS.has(key);
  }

  return includeTemplateRaw || record.type === "RegexLiteral";
}

function shouldIncludeTemplateRaw(
  record: Record<string, unknown>,
  key: string,
  includeTemplateRaw: boolean
): boolean {
  if (record.type === "TaggedTemplateExpression" && key === "quasi") {
    return true;
  }

  if (includeTemplateRaw && record.type === "TemplateLiteral" && key === "quasis") {
    return true;
  }

  if (includeTemplateRaw && record.type === "TemplateElement" && key === "value") {
    return true;
  }

  return false;
}
