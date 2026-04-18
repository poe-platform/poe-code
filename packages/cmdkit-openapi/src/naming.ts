import { UserError } from "@poe-code/cmdkit";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

const DEFAULT_VERBS_BY_METHOD = {
  delete: {
    collection: "delete",
    resource: "delete"
  },
  get: {
    collection: "list",
    resource: "view"
  }
} as const satisfies Partial<Record<HttpMethod, { collection: string; resource: string }>>;

export function deriveNoun(operation: { tags?: string[] }, operationId: string): string {
  const noun = operation.tags?.[0];

  if (typeof noun !== "string" || noun.length === 0) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define tags[0] to derive a command noun.`
    );
  }

  return toKebabCase(noun);
}

export function deriveVerb(
  method: HttpMethod,
  path: string,
  operation: { operationId?: string },
  operationId: string
): string {
  const segments = splitPathSegments(path);
  const actionsIndex = segments.indexOf("actions");
  const action = actionsIndex >= 0 ? segments[actionsIndex + 1] : undefined;

  if (action !== undefined) {
    return toKebabCase(action);
  }

  const defaults = DEFAULT_VERBS_BY_METHOD[method];
  if (defaults !== undefined) {
    const lastSegment = segments.at(-1);
    return isPathTemplateSegment(lastSegment) ? defaults.resource : defaults.collection;
  }

  if (operation.operationId !== undefined) {
    return toKebabCase(operation.operationId);
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} is missing an operationId, so cmdkit-openapi cannot derive a stable command verb.`
  );
}

export function normalizeParamName(name: string): string {
  return toCamelCase(name);
}

export function toPascalCase(value: string): string {
  const camel = toCamelCase(value);
  return camel.length === 0 ? camel : `${camel[0]?.toUpperCase() ?? ""}${camel.slice(1)}`;
}

export function toCamelCase(value: string): string {
  return splitWords(value)
    .map((word, index) => (index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
    .join("");
}

export function toKebabCase(value: string): string {
  return splitWords(value).join("-");
}

export function splitWords(value: string): string[] {
  const normalized = value.replaceAll("-", " ").replaceAll("_", " ").replaceAll(".", " ");
  return normalized
    .split(" ")
    .flatMap(splitCamelCaseWord)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

export function toMcpPrefix(name: string): string {
  return name.replaceAll("-", "_");
}

function splitPathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function isPathTemplateSegment(segment: string | undefined): boolean {
  return segment !== undefined && segment.startsWith("{") && segment.endsWith("}");
}

function splitCamelCaseWord(value: string): string[] {
  if (value.length === 0) {
    return [];
  }

  const words = [value[0] ?? ""];

  for (let index = 1; index < value.length; index += 1) {
    const character = value[index] ?? "";
    const previous = value[index - 1] ?? "";
    const next = value[index + 1];

    if (shouldStartNewWord(previous, character, next)) {
      words.push(character);
      continue;
    }

    const currentWord = words.at(-1) ?? "";
    words[words.length - 1] = `${currentWord}${character}`;
  }

  return words;
}

function shouldStartNewWord(previous: string, character: string, next: string | undefined): boolean {
  if (!isUppercaseLetter(character)) {
    return false;
  }

  if (isLowercaseLetter(previous)) {
    return true;
  }

  return isUppercaseLetter(previous) && next !== undefined && isLowercaseLetter(next);
}

function isLowercaseLetter(character: string): boolean {
  return character >= "a" && character <= "z";
}

function isUppercaseLetter(character: string): boolean {
  return character >= "A" && character <= "Z";
}
