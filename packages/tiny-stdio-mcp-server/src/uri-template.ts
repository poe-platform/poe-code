export type UriTemplateValue = string | string[] | Record<string, string>;

export interface UriTemplate {
  expand(variables: Record<string, UriTemplateValue>): string;
  match(uri: string): Record<string, string> | null;
}

type Operator = "" | "+" | "#" | "." | "/" | ";" | "?" | "&";

type OperatorOptions = {
  prefix: string;
  separator: string;
  named: boolean;
  ifEmpty: string;
  allowReserved: boolean;
};

type VariableSpec = {
  name: string;
  explode: boolean;
  prefixLength?: number;
};

type LiteralSegment = {
  kind: "literal";
  value: string;
};

type ExpressionSegment = {
  kind: "expression";
  operator: Operator;
  variables: VariableSpec[];
};

type Segment = LiteralSegment | ExpressionSegment;

const operatorOptions: Record<Operator, OperatorOptions> = {
  "": { prefix: "", separator: ",", named: false, ifEmpty: "", allowReserved: false },
  "+": { prefix: "", separator: ",", named: false, ifEmpty: "", allowReserved: true },
  "#": { prefix: "#", separator: ",", named: false, ifEmpty: "", allowReserved: true },
  ".": { prefix: ".", separator: ".", named: false, ifEmpty: "", allowReserved: false },
  "/": { prefix: "/", separator: "/", named: false, ifEmpty: "", allowReserved: false },
  ";": { prefix: ";", separator: ";", named: true, ifEmpty: "", allowReserved: false },
  "?": { prefix: "?", separator: "&", named: true, ifEmpty: "=", allowReserved: false },
  "&": { prefix: "&", separator: "&", named: true, ifEmpty: "=", allowReserved: false }
};

const operators = new Set<Operator>(["", "+", "#", ".", "/", ";", "?", "&"]);
const reservedCharacters = new Set(":/?#[]@!$&'()*+,;=".split(""));

class ParsedUriTemplate implements UriTemplate {
  constructor(private readonly segments: readonly Segment[]) {}

  expand(variables: Record<string, UriTemplateValue>): string {
    return this.segments
      .map((segment) =>
        segment.kind === "literal" ? segment.value : expandExpression(segment, variables)
      )
      .join("");
  }

  match(uri: string): Record<string, string> | null {
    return matchSegments(this.segments, uri, 0, 0, {});
  }
}

export function parseUriTemplate(template: string): UriTemplate {
  if (typeof template !== "string") {
    throw new Error("URI template must be a string.");
  }

  const segments: Segment[] = [];
  let literalStart = 0;
  let index = 0;
  while (index < template.length) {
    const character = template[index];
    if (character === "}") {
      throw syntaxError(template, index, "unmatched closing brace");
    }
    if (character !== "{") {
      index += 1;
      continue;
    }

    if (index > literalStart) {
      segments.push({ kind: "literal", value: template.slice(literalStart, index) });
    }
    const closeIndex = template.indexOf("}", index + 1);
    if (closeIndex === -1) {
      throw syntaxError(template, index, "unclosed expression");
    }
    const expression = template.slice(index + 1, closeIndex);
    if (expression.includes("{")) {
      throw syntaxError(template, index, "nested expression");
    }
    segments.push(parseExpression(template, expression, index));
    index = closeIndex + 1;
    literalStart = index;
  }

  if (literalStart < template.length) {
    segments.push({ kind: "literal", value: template.slice(literalStart) });
  }
  if (segments.length === 0) {
    segments.push({ kind: "literal", value: "" });
  }
  return new ParsedUriTemplate(segments);
}

function parseExpression(template: string, expression: string, offset: number): ExpressionSegment {
  if (expression.length === 0) {
    throw syntaxError(template, offset, "empty expression");
  }

  const first = expression[0] as Operator;
  const operator = operators.has(first) && first !== "" ? first : "";
  const variableList = operator === "" ? expression : expression.slice(1);
  if (variableList.length === 0) {
    throw syntaxError(template, offset, "expression has no variables");
  }
  if (operator === "" && isReservedOperatorCharacter(first)) {
    throw syntaxError(template, offset, `unsupported operator ${first}`);
  }

  const variables = variableList
    .split(",")
    .map((variable) => parseVariableSpec(template, variable, offset));
  return { kind: "expression", operator, variables };
}

function parseVariableSpec(template: string, source: string, offset: number): VariableSpec {
  if (source.length === 0) {
    throw syntaxError(template, offset, "empty variable specification");
  }

  const explode = source.endsWith("*");
  const withoutExplode = explode ? source.slice(0, -1) : source;
  const colonIndex = withoutExplode.indexOf(":");
  if (explode && colonIndex !== -1) {
    throw syntaxError(template, offset, "explode and prefix modifiers cannot be combined");
  }

  const name = colonIndex === -1 ? withoutExplode : withoutExplode.slice(0, colonIndex);
  if (!isValidVariableName(name)) {
    throw syntaxError(template, offset, `invalid variable name ${name}`);
  }

  if (colonIndex === -1) {
    return { name, explode };
  }
  const prefixSource = withoutExplode.slice(colonIndex + 1);
  if (!isValidPrefix(prefixSource)) {
    throw syntaxError(template, offset, `invalid prefix modifier ${prefixSource}`);
  }
  return { name, explode: false, prefixLength: Number(prefixSource) };
}

function isValidVariableName(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  let componentLength = 0;
  for (let index = 0; index < name.length; index += 1) {
    const character = name[index];
    if (character === ".") {
      if (componentLength === 0) return false;
      componentLength = 0;
      continue;
    }
    if (character === "%") {
      if (!isHex(name[index + 1]) || !isHex(name[index + 2])) return false;
      index += 2;
      componentLength += 1;
      continue;
    }
    if (!isVariableCharacter(character)) return false;
    componentLength += 1;
  }
  return componentLength > 0;
}

function isValidPrefix(value: string): boolean {
  if (value.length === 0 || value.length > 4 || value[0] === "0") {
    return false;
  }
  return [...value].every((character) => character >= "0" && character <= "9");
}

function isReservedOperatorCharacter(character: string): boolean {
  return "=,!@|".includes(character);
}

function isVariableCharacter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9") ||
    character === "_"
  );
}

function isHex(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= "0" && character <= "9") ||
      (character >= "a" && character <= "f") ||
      (character >= "A" && character <= "F"))
  );
}

function syntaxError(template: string, index: number, detail: string): Error {
  return new Error(`Invalid URI template at ${index}: ${detail} (${template})`);
}

function expandExpression(
  expression: ExpressionSegment,
  variables: Record<string, UriTemplateValue>
): string {
  const options = operatorOptions[expression.operator];
  const parts: string[] = [];
  for (const variable of expression.variables) {
    const value = (variables as Record<string, unknown>)[variable.name];
    if (value === undefined || value === null) {
      continue;
    }
    parts.push(...expandVariable(variable, value, options));
  }
  return parts.length === 0 ? "" : `${options.prefix}${parts.join(options.separator)}`;
}

function expandVariable(
  variable: VariableSpec,
  value: unknown,
  options: OperatorOptions
): string[] {
  if (Array.isArray(value)) {
    if (variable.prefixLength !== undefined) {
      throw new Error(`Prefix modifier requires a scalar value: ${variable.name}`);
    }
    return expandList(variable, value, options);
  }
  if (isRecord(value)) {
    if (variable.prefixLength !== undefined) {
      throw new Error(`Prefix modifier requires a scalar value: ${variable.name}`);
    }
    return expandAssociative(variable, value, options);
  }

  const original = String(value);
  const scalar =
    variable.prefixLength === undefined
      ? original
      : [...original].slice(0, variable.prefixLength).join("");
  const encoded = encodeValue(scalar, options.allowReserved);
  return [namedValue(variable.name, encoded, options)];
}

function expandList(variable: VariableSpec, value: unknown[], options: OperatorOptions): string[] {
  if (value.length === 0) {
    return [];
  }
  const encoded = value.map((item) => encodeValue(String(item), options.allowReserved));
  if (!variable.explode) {
    return [namedValue(variable.name, encoded.join(","), options)];
  }
  if (!options.named) {
    return encoded;
  }
  return encoded.map((item) => namedValue(variable.name, item, options));
}

function expandAssociative(
  variable: VariableSpec,
  value: Record<string, unknown>,
  options: OperatorOptions
): string[] {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [];
  }
  const encoded = entries.map(([key, item]) => [
    encodeValue(key, options.allowReserved),
    encodeValue(String(item), options.allowReserved)
  ]);
  if (!variable.explode) {
    return [namedValue(variable.name, encoded.flat().join(","), options)];
  }
  return encoded.map(([key, item]) => `${key}=${item}`);
}

function namedValue(name: string, value: string, options: OperatorOptions): string {
  if (!options.named) {
    return value;
  }
  const encodedName = encodeValue(name, true);
  if (value.length === 0) {
    return `${encodedName}${options.ifEmpty}`;
  }
  return `${encodedName}=${value}`;
}

function encodeValue(value: string, allowReserved: boolean): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (allowReserved && character === "%" && isHex(value[index + 1]) && isHex(value[index + 2])) {
      result += value.slice(index, index + 3);
      index += 2;
      continue;
    }
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;
    const scalar = String.fromCodePoint(codePoint);
    if (scalar.length === 2) index += 1;
    if (isUnreserved(scalar) || (allowReserved && reservedCharacters.has(scalar))) {
      result += scalar;
      continue;
    }
    for (const byte of new TextEncoder().encode(scalar)) {
      result += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return result;
}

function isUnreserved(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9") ||
    "-._~".includes(character)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchSegments(
  segments: readonly Segment[],
  uri: string,
  segmentIndex: number,
  uriIndex: number,
  captures: Record<string, string>
): Record<string, string> | null {
  if (segmentIndex === segments.length) {
    return uriIndex === uri.length ? captures : null;
  }

  const segment = segments[segmentIndex];
  if (segment.kind === "literal") {
    return uri.startsWith(segment.value, uriIndex)
      ? matchSegments(segments, uri, segmentIndex + 1, uriIndex + segment.value.length, captures)
      : null;
  }

  for (const endIndex of candidateExpressionEnds(segments, uri, segmentIndex, uriIndex)) {
    const expressionCaptures = matchExpression(segment, uri.slice(uriIndex, endIndex));
    if (expressionCaptures === null) continue;
    const result = matchSegments(segments, uri, segmentIndex + 1, endIndex, {
      ...captures,
      ...expressionCaptures
    });
    if (result !== null) return result;
  }
  return null;
}

function candidateExpressionEnds(
  segments: readonly Segment[],
  uri: string,
  segmentIndex: number,
  uriIndex: number
): number[] {
  const next = segments[segmentIndex + 1];
  if (next === undefined) {
    return [uri.length];
  }
  const boundary = next.kind === "literal" ? next.value : operatorOptions[next.operator].prefix;
  if (boundary.length === 0) {
    return descendingRange(uriIndex, uri.length);
  }

  const indices: number[] = [];
  let searchIndex = uri.length;
  while (searchIndex >= uriIndex) {
    const found = uri.lastIndexOf(boundary, searchIndex);
    if (found < uriIndex) break;
    indices.push(found);
    searchIndex = found - 1;
  }
  return indices;
}

function descendingRange(start: number, end: number): number[] {
  const values: number[] = [];
  for (let value = end; value >= start; value -= 1) values.push(value);
  return values;
}

function matchExpression(
  expression: ExpressionSegment,
  expansion: string
): Record<string, string> | null {
  const options = operatorOptions[expression.operator];
  if (expansion.length === 0) {
    return {};
  }
  if (options.prefix.length > 0 && !expansion.startsWith(options.prefix)) {
    return null;
  }
  const body = options.prefix.length === 0 ? expansion : expansion.slice(options.prefix.length);
  if (options.named) {
    return matchNamedExpression(expression.variables, body, options.separator);
  }
  return matchPositionalExpression(expression.variables, body, options.separator);
}

function matchNamedExpression(
  variables: readonly VariableSpec[],
  body: string,
  separator: string
): Record<string, string> {
  const captures: Record<string, string> = {};
  const fields = body.length === 0 ? [] : body.split(separator);
  for (const variable of variables) {
    const encodedName = encodeValue(variable.name, true);
    const values: string[] = [];
    for (const field of fields) {
      const equalsIndex = field.indexOf("=");
      const key = equalsIndex === -1 ? field : field.slice(0, equalsIndex);
      if (key === encodedName) {
        values.push(equalsIndex === -1 ? "" : field.slice(equalsIndex + 1));
      }
    }
    if (values.length > 0) {
      captures[variable.name] = decodeValue(values.join(variable.explode ? "," : ""));
    } else if (variable.explode && variables.length === 1 && body.length > 0) {
      captures[variable.name] = decodeValue(body);
    }
  }
  return captures;
}

function matchPositionalExpression(
  variables: readonly VariableSpec[],
  body: string,
  separator: string
): Record<string, string> {
  if (variables.length === 1) {
    return { [variables[0].name]: decodeValue(body) };
  }
  const captures: Record<string, string> = {};
  const fields = body.split(separator);
  for (let index = 0; index < variables.length && index < fields.length; index += 1) {
    captures[variables[index].name] = decodeValue(
      index === variables.length - 1 ? fields.slice(index).join(separator) : fields[index]
    );
  }
  return captures;
}

function decodeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
