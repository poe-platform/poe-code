import { UserError } from "toolcraft";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

type MethodDefaults = {
  collection: string;
  resource: string;
  confirm?: true;
  genericVerbs?: readonly string[];
  preferOperationIdWhenPathTailIsGeneric?: true;
};

export const METHOD_DEFAULTS: Partial<Record<HttpMethod, MethodDefaults>> = {
  delete: {
    collection: "delete",
    resource: "delete",
    confirm: true
  },
  get: {
    collection: "list",
    resource: "view",
    genericVerbs: ["get", "list", "view"],
    preferOperationIdWhenPathTailIsGeneric: true
  },
  head: { collection: "check", resource: "check" },
  options: { collection: "options", resource: "options" }
};

export function deriveNoun(
  operation: { tags?: string[] },
  path: string,
  operationId: string
): string {
  const noun = operation.tags?.[0];

  if (typeof noun !== "string" || noun.length === 0) {
    return normalizeNoun(deriveNounFromPath(path) ?? operationId);
  }

  return normalizeNoun(noun);
}

export function normalizeNoun(value: string): string {
  return toKebabCase(
    [...value].map((character) => (isNounWordCharacter(character) ? character : " ")).join("")
  );
}

export function deriveVerb(
  method: HttpMethod,
  path: string,
  operation: { operationId?: string },
  operationId: string,
  noun: string
): string {
  const segments = splitPathSegments(path);
  const defaults = METHOD_DEFAULTS[method];
  if (defaults !== undefined) {
    const lastSegment = segments.at(-1);

    if (isPathTemplateSegment(lastSegment)) {
      return defaults.resource;
    }

    if (defaults.preferOperationIdWhenPathTailIsGeneric === true) {
      const derived = deriveVerbFromOperationId(method, operation.operationId, noun, defaults);
      const pathTail = lastSegment === undefined ? undefined : toKebabCase(lastSegment);

      if (derived !== undefined) {
        if (pathTail === undefined || derived !== pathTail) {
          return derived;
        }

        if (!operationIdStartsWithCollectionVerb(method, operation.operationId, noun, defaults)) {
          return pathTail;
        }
      }
    }

    return defaults.collection;
  }

  const derived = deriveVerbFromOperationId(method, operation.operationId, noun);

  if (derived !== undefined) {
    return derived;
  }

  const fallback = deriveVerbFromPath(method, segments, noun);
  if (fallback !== undefined) {
    return fallback;
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} is missing an operationId, so toolcraft-openapi cannot derive a stable command verb.`
  );
}

function deriveVerbFromPath(
  method: HttpMethod,
  segments: string[],
  noun: string
): string | undefined {
  const action = method === "post" ? "create" : method === "put" || method === "patch" ? "update" : undefined;
  if (action === undefined) {
    return undefined;
  }

  const staticSegments = segments
    .filter((segment) => !isPathTemplateSegment(segment) && segment !== "api" && !isVersionWord(segment))
    .map((segment) => toKebabCase(segment));
  const nounIndex = staticSegments.indexOf(noun);
  const qualifiers = nounIndex === -1 ? staticSegments.slice(1) : staticSegments.slice(nounIndex + 1);

  return qualifiers.length === 0 ? action : `${action}-${qualifiers.join("-")}`;
}

export function deriveDisambiguatedVerb(operationId: string, noun: string): string {
  const words = trimLeadingWords(splitWords(operationId).filter((word) => !isVersionWord(word)), splitWords(noun));
  const withoutGenericVerb = stripLeadingGenericVerb(words, ["create", "delete", "get", "list", "patch", "post", "put", "remove", "update", "view"]);
  const candidate = withoutGenericVerb.length === 0 ? words : withoutGenericVerb;

  return candidate.map(normalizeNoun).filter((word) => word.length > 0).join("-");
}

export function derivePathDisambiguatedVerb(
  method: HttpMethod,
  path: string,
  noun: string,
  verb: string,
  includeTemplateQualifiers = false,
  includeParentQualifiers = false
): string {
  const segments = splitPathSegments(path);
  const nounIndex = segments.findIndex((segment) => toKebabCase(segment) === noun);
  const relevantSegments =
    includeParentQualifiers || nounIndex === -1 ? segments : segments.slice(nounIndex + 1);
  const staticQualifiers = relevantSegments
    .flatMap(readStaticPathSegmentWords)
    .filter((word) => word !== "api" && !isVersionWord(word));
  const templateQualifiers = relevantSegments.flatMap(readPathTemplateWords);
  const qualifiers = includeTemplateQualifiers
    ? [...staticQualifiers, ...templateQualifiers]
    : staticQualifiers.length > 0
      ? staticQualifiers
      : templateQualifiers;

  if (qualifiers.length === 0) {
    return verb;
  }

  const defaultVerb =
    METHOD_DEFAULTS[method]?.resource ??
    METHOD_DEFAULTS[method]?.collection ??
    (method === "post" ? "create" : method === "put" || method === "patch" ? "update" : verb);
  return `${defaultVerb}-${qualifiers.join("-")}`;
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

export function toCliFlag(value: string): string {
  return toKebabCase(value);
}

export function splitWords(value: string): string[] {
  const normalized = value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replaceAll("/", " ");
  return normalized
    .split(" ")
    .flatMap(splitCamelCaseWord)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

export function toMcpPrefix(name: string): string {
  return name.replaceAll("-", "_");
}

export function isIdentifierName(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/u.test(value);
}

function splitPathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function deriveNounFromPath(path: string): string | undefined {
  return splitPathSegments(path)
    .find((segment) => !isPathTemplateSegment(segment) && segment !== "api" && !isVersionWord(segment))
    ?.split("/")
    .map((segment) => toKebabCase(segment))
    .find((segment) => segment.length > 0);
}

function isNounWordCharacter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9") ||
    character === "-" ||
    character === "_"
  );
}

function isPathTemplateSegment(segment: string | undefined): boolean {
  return segment !== undefined && segment.startsWith("{") && segment.endsWith("}");
}

function readStaticPathSegmentWords(segment: string): string[] {
  let depth = 0;
  let staticText = "";

  for (const character of segment) {
    if (character === "{") {
      depth += 1;
      staticText += " ";
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
      staticText += " ";
      continue;
    }

    staticText += depth === 0 ? character : " ";
  }

  return splitWords(staticText.replaceAll(":", " "));
}

function readPathTemplateWords(segment: string): string[] {
  let depth = 0;
  let templateText = "";

  for (const character of segment) {
    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
      templateText += " ";
      continue;
    }

    templateText += depth > 0 ? character : " ";
  }

  return splitWords(templateText.replaceAll(":", " "));
}

function deriveVerbFromOperationId(
  method: HttpMethod,
  operationId: string | undefined,
  noun: string,
  defaults?: Pick<MethodDefaults, "genericVerbs">
): string | undefined {
  const words = normalizeOperationIdWords(method, operationId, noun);

  if (words === undefined) {
    return undefined;
  }

  const verbWords = stripLeadingGenericVerb(words, defaults?.genericVerbs);

  return verbWords.length === 0 ? undefined : verbWords.join("-");
}

function operationIdStartsWithCollectionVerb(
  method: HttpMethod,
  operationId: string | undefined,
  noun: string,
  defaults: Pick<MethodDefaults, "collection">
): boolean {
  const words = normalizeOperationIdWords(method, operationId, noun);
  return words?.[0] === defaults.collection;
}

function normalizeOperationIdWords(
  method: HttpMethod,
  operationId: string | undefined,
  noun: string
): string[] | undefined {
  if (operationId === undefined) {
    return undefined;
  }

  const nounWords = splitWords(noun);
  return dedupeAdjacentWords(
    trimTrailingNounUnlessItConsumesAll(
      trimTrailingMethod(
        trimLeadingWords(splitWords(operationId).filter((word) => !isVersionWord(word)), nounWords),
        method
      ),
      nounWords
    )
  );
}

function stripLeadingGenericVerb(
  words: string[],
  genericVerbs: readonly string[] | undefined
): string[] {
  if (genericVerbs === undefined || words.length <= 1 || !genericVerbs.includes(words[0] ?? "")) {
    return words;
  }

  let start = 1;
  while (start < words.length - 1 && words[start] === words[0]) {
    start += 1;
  }

  return words.slice(start);
}

function trimTrailingNounUnlessItConsumesAll(words: string[], nounWords: string[]): string[] {
  const withoutTrailingNoun = trimTrailingWords(words, nounWords);
  return withoutTrailingNoun.length === 0 ? words : withoutTrailingNoun;
}

function trimLeadingWords(words: string[], prefix: string[]): string[] {
  if (prefix.length === 0 || prefix.length > words.length) {
    return words;
  }

  for (let index = 0; index < prefix.length; index += 1) {
    if (words[index] !== prefix[index]) {
      return words;
    }
  }

  return words.slice(prefix.length);
}

function trimTrailingWords(words: string[], suffix: string[]): string[] {
  if (suffix.length === 0 || suffix.length >= words.length) {
    return words;
  }

  const start = words.length - suffix.length;

  for (let index = 0; index < suffix.length; index += 1) {
    if (words[start + index] !== suffix[index]) {
      return words;
    }
  }

  return words.slice(0, start);
}

function trimTrailingMethod(words: string[], method: HttpMethod): string[] {
  return words.at(-1) === method ? words.slice(0, -1) : words;
}

function dedupeAdjacentWords(words: string[]): string[] {
  if (words.length === 0) {
    return [];
  }

  const deduped = [words[0] ?? ""];

  for (let index = 1; index < words.length; index += 1) {
    const word = words[index] ?? "";

    if (word !== deduped.at(-1)) {
      deduped.push(word);
    }
  }

  return deduped;
}

function isVersionWord(word: string): boolean {
  if (!word.startsWith("v") || word.length < 2) {
    return false;
  }

  for (const character of word.slice(1)) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  return true;
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
