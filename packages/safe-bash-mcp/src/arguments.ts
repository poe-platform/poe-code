import type { Tool } from "tiny-mcp-client";
import {
  compileJsonSchema,
  formatIssues,
  projectJsonSchemaProperties,
  type CompileJsonSchemaOptions,
  type JsonSchemaProperty
} from "toolcraft-schema";
import { parseArgumentJson } from "./json-input.js";

export interface ToolParameter {
  readonly name: string;
  readonly flag: string;
  readonly required: boolean;
  readonly schemas: readonly unknown[];
  readonly description?: string;
}
export interface ToolArgumentParseOptions {
  readonly yes?: boolean;
  readonly maxInputBytes?: number;
}
export interface ToolArgumentParser {
  readonly toolName: string;
  readonly parameters: readonly ToolParameter[];
  parse(args: readonly string[], options?: ToolArgumentParseOptions): Record<string, unknown>;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flagStem(name: string): string {
  let result = "";
  let previous = "";
  for (const char of name) {
    const lower = char >= "a" && char <= "z";
    const upper = char >= "A" && char <= "Z";
    const digit = char >= "0" && char <= "9";
    if (upper && previous && ((previous >= "a" && previous <= "z") || (previous >= "0" && previous <= "9")))
      result += "-";
    if (lower || upper || digit) result += char.toLowerCase();
    else if (result && !result.endsWith("-")) result += "-";
    previous = char;
  }
  return (result.endsWith("-") ? result.slice(0, -1) : result) || "arg";
}

function stringLike(schemas: readonly unknown[]): boolean {
  return schemas.some(schema => object(schema) && (
    schema.type === "string" || (Array.isArray(schema.type) && schema.type.includes("string")) ||
    typeof schema.const === "string" || (Array.isArray(schema.enum) && schema.enum.some(value => typeof value === "string"))
  ));
}

interface ValueToken { readonly raw: string; readonly typed: boolean }

function parameterValue(property: JsonSchemaProperty, tokens: readonly ValueToken[]): unknown {
  const decoded = tokens.map(token => {
    try { return { parsed: true, value: parseArgumentJson(token.raw) }; }
    catch (cause) {
      if (token.typed) throw new Error(`Invalid JSON for parameter '${property.name}'`, { cause });
      return { parsed: false, value: token.raw };
    }
  });
  const raw = tokens.map((token, index) => token.typed ? decoded[index].value : token.raw);
  const parsed = decoded.map(value => value.value);
  const candidates: unknown[] = [];
  if (tokens.length === 1) {
    if (!tokens[0].typed && stringLike(property.schemas)) candidates.push(raw[0]);
    if (decoded[0].parsed) candidates.push(parsed[0]);
    if (!tokens[0].typed) {
      if (decoded[0].parsed && typeof parsed[0] === "string") candidates.push(parsed);
      if (!decoded[0].parsed) {
        try { candidates.push(parseArgumentJson(`[${tokens[0].raw}]`)); }
        catch { /* Bare string array elements remain literal, including commas. */ }
      }
      candidates.push(raw[0], raw, parsed);
    }
  } else {
    if (parsed.some(Array.isArray)) candidates.push(parsed, parsed.flatMap(value => Array.isArray(value) ? value : [value]));
    candidates.push(raw, parsed, parsed.flatMap(value => Array.isArray(value) ? value : [value]));
  }
  for (const candidate of candidates) if (property.validate(candidate).ok) return candidate;
  throw new Error(`Invalid value for parameter '${property.name}'`);
}

/** Compile a tool's complete JSON Schema plus stable, collision-safe flag metadata. */
export function compileToolArguments(tool: Tool, options: CompileJsonSchemaOptions = {}): ToolArgumentParser {
  const toolName = tool.name;
  const schema = structuredClone(tool.inputSchema);
  const snapshotOptions = {
    ...options,
    ...(options.registry === undefined ? {} : { registry: structuredClone(options.registry) }),
    ...(options.formats === undefined ? {} : { formats: { ...options.formats } })
  };
  const validator = compileJsonSchema(schema, snapshotOptions);
  const properties = projectJsonSchemaProperties(schema, snapshotOptions);
  const names = new Map(properties.map(property => [property.name, property]));
  const natural = new Set(properties.map(property => flagStem(property.name)));
  const used = new Set(["raw", "yes", "help", "schema"]);
  const flags = new Map<string, JsonSchemaProperty>();
  const parameters = properties.map(property => {
    const stem = flagStem(property.name);
    let flag = stem;
    for (let suffix = 2; used.has(flag) || (flag !== stem && natural.has(flag)); suffix++) flag = `${stem}-${suffix}`;
    used.add(flag);
    flags.set(flag, property);
    const description = property.schemas.find(schema => object(schema) && typeof schema.description === "string");
    return {
      name: property.name, flag: `--${flag}`, required: property.required,
      schemas: structuredClone(property.schemas),
      ...(object(description) ? { description: description.description as string } : {})
    };
  });
  return {
    toolName,
    parameters,
    parse(args, parseOptions = {}) {
      const maxBytes = parseOptions.maxInputBytes ?? 1024 * 1024;
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("maxInputBytes must be a positive safe integer");
      let bytes = 0;
      for (const arg of args) {
        bytes += Buffer.byteLength(arg, "utf8");
        if (bytes > maxBytes) throw new Error("MCP argument byte limit exceeded");
      }
      const values = new Map<string, ValueToken[]>();
      let rawInput: Record<string, unknown> | undefined;
      let yes = parseOptions.yes === true;
      for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === "--yes") { yes = true; continue; }
        const equal = arg.indexOf("=");
        const long = arg.startsWith("--");
        const colon = long ? -1 : arg.indexOf(":");
        const separator = equal < 0 ? colon : colon >= 0 && colon < equal ? colon : equal;
        const key = long ? arg.slice(2, equal < 0 ? undefined : equal) : separator < 0 ? arg : arg.slice(0, separator);
        const typed = !long && separator === colon && arg[colon + 1] === "=";
        let value = long && equal >= 0 ? arg.slice(equal + 1)
          : !long && separator >= 0 ? arg.slice(separator + (typed ? 2 : 1)) : undefined;
        if (long && key === "raw") {
          if (rawInput !== undefined) throw new Error("--raw can only be supplied once");
          value ??= args[++index];
          if (value === undefined) throw new Error("--raw requires a JSON object");
          const parsed: unknown = parseArgumentJson(value);
          if (!object(parsed)) throw new Error("--raw requires a JSON object");
          rawInput = parsed;
          continue;
        }
        const property = long ? flags.get(key) : names.get(key);
        if (!property || (!long && separator < 0)) throw new Error(`Unknown MCP argument '${arg}'`);
        let implicitBoolean = false;
        if (value === undefined) {
          const next = args[index + 1];
          if (next === undefined || next.startsWith("--")) {
            if (!property.validate(true).ok) throw new Error(`Missing value for ${arg}`);
            value = "true";
            implicitBoolean = true;
          } else { value = next; index++; }
        }
        const tokens = values.get(property.name) ?? [];
        tokens.push({ raw: value, typed: typed || implicitBoolean });
        values.set(property.name, tokens);
      }
      if (rawInput !== undefined && values.size) throw new Error("--raw cannot be combined with named tool arguments");
      const result: Record<string, unknown> = Object.create(null);
      if (rawInput !== undefined) for (const [name, value] of Object.entries(rawInput)) result[name] = value;
      else for (const [name, tokens] of values) result[name] = parameterValue(names.get(name)!, tokens);
      if (yes) {
        for (const property of properties) {
          if (Object.hasOwn(result, property.name)) continue;
          const defaults = property.schemas.filter(schema => object(schema) && Object.hasOwn(schema, "default")) as Record<string, unknown>[];
          if (defaults.length === 1) result[property.name] = structuredClone(defaults[0].default);
        }
      }
      const validation = validator.validate(result);
      if (!validation.ok) throw new Error(`Invalid arguments for '${toolName}': ${formatIssues(validation.issues)}`);
      return result;
    }
  };
}
