export interface ParameterHeader {
  name: string;
  path: string[];
  type: "string" | "integer" | "boolean";
}

export function encodeHeaderValue(value: string): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.toString("utf8") !== value)
    throw new Error("MCP header value must contain valid Unicode");
  const sentinel = value.startsWith("=?base64?") && value.endsWith("?=");
  const unsafe =
    value.trim() !== value ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code !== 9 && (code < 32 || code > 126);
    });
  return sentinel || unsafe ? `=?base64?${bytes.toString("base64")}?=` : value;
}

export function decodeHeaderValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("=?base64?") && value.endsWith("?=")) {
    const encoded = value.slice(9, -2);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) return undefined;
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return undefined;
    }
  }
  if (
    value.trim() !== value ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code !== 9 && (code < 32 || code > 126);
    })
  )
    return undefined;
  return value;
}

const schemaMaps = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas"
]);
const schemaArrays = new Set(["oneOf", "allOf", "anyOf", "prefixItems"]);
const schemaChildren = new Set([
  "items",
  "additionalProperties",
  "not",
  "contains",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema"
]);
const tokenPunctuation = new Set([
  "!",
  "#",
  "$",
  "%",
  "&",
  "'",
  "*",
  "+",
  "-",
  ".",
  "^",
  "_",
  "`",
  "|",
  "~"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getParameterHeaders(schema: unknown): ParameterHeader[] {
  const headers: ParameterHeader[] = [];
  const names = new Set<string>();
  const ancestors = new Set<object>();
  let nodes = 0;
  const visit = (value: unknown, path: string[], reachable: boolean, depth: number): void => {
    if (++nodes > 10000 || depth > 64)
      throw new Error("MCP header schema traversal limit exceeded");
    if (typeof value === "boolean") return;
    if (!isRecord(value) || ancestors.has(value)) throw new Error("Invalid MCP header schema");
    ancestors.add(value);
    try {
      if (Object.prototype.hasOwnProperty.call(value, "x-mcp-header")) {
        const name = value["x-mcp-header"];
        if (
          !reachable ||
          path.length === 0 ||
          typeof name !== "string" ||
          name.length === 0 ||
          [...name].some((character) => {
            const code = character.charCodeAt(0);
            return (
              !tokenPunctuation.has(character) &&
              !(
                (code >= 48 && code <= 57) ||
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122)
              )
            );
          })
        )
          throw new Error("Invalid x-mcp-header name or property path");
        if (value.type !== "string" && value.type !== "integer" && value.type !== "boolean")
          throw new Error("x-mcp-header requires a string, integer, or boolean property");
        const key = name.toLowerCase();
        if (names.has(key)) throw new Error("Duplicate x-mcp-header name");
        names.add(key);
        headers.push({ name: `Mcp-Param-${name}`, path: [...path], type: value.type });
      }
      for (const [keyword, child] of Object.entries(value)) {
        if (schemaMaps.has(keyword)) {
          if (!isRecord(child)) throw new Error("Invalid schema map");
          for (const [key, nested] of Object.entries(child))
            visit(
              nested,
              keyword === "properties" ? [...path, key] : path,
              reachable && keyword === "properties",
              depth + 1
            );
        } else if (schemaArrays.has(keyword)) {
          if (!Array.isArray(child)) throw new Error("Invalid schema array");
          for (const nested of child) visit(nested, path, false, depth + 1);
        } else if (schemaChildren.has(keyword)) {
          if (Array.isArray(child))
            for (const nested of child) visit(nested, path, false, depth + 1);
          else visit(child, path, false, depth + 1);
        }
      }
    } finally {
      ancestors.delete(value);
    }
  };
  visit(schema, [], true, 0);
  return headers;
}

export function createParameterHeaders(
  definitions: readonly ParameterHeader[],
  argumentsValue: unknown
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const definition of definitions) {
    let value = argumentsValue;
    for (const key of definition.path) {
      value =
        isRecord(value) && Object.prototype.hasOwnProperty.call(value, key)
          ? value[key]
          : undefined;
    }
    if (value === undefined) continue;
    if (
      definition.type === "integer"
        ? !Number.isSafeInteger(value)
        : typeof value !== definition.type
    )
      throw new Error(`Invalid value for ${definition.name}`);
    values[definition.name] = encodeHeaderValue(String(value));
  }
  return values;
}

export function validateParameterHeaders(
  definitions: readonly ParameterHeader[],
  argumentsValue: unknown,
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  let expected: Record<string, string>;
  try {
    expected = createParameterHeaders(definitions, argumentsValue);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid MCP parameter header value";
  }
  for (const definition of definitions) {
    const value = expected[definition.name];
    const actual = headers[definition.name.toLowerCase()];
    if (value === undefined && actual === undefined) continue;
    if (
      value === undefined ||
      actual === undefined ||
      decodeHeaderValue(actual) !== decodeHeaderValue(value)
    )
      return `Header mismatch: ${definition.name} must match the tool argument`;
  }
}
