import fs from "node:fs/promises";
import path from "node:path";
import { UserError } from "toolcraft";
import { hasOwnErrorCode } from "../error-codes.js";
import type {
  OpenApiDocument,
  OpenApiMediaTypeObject,
  OpenApiOperationObject,
  OpenApiReferenceObject,
  OpenApiRequestBodyObject,
  OpenApiResponseObject,
  OpenApiSchemaObject
} from "../generate.js";
import {
  parseOpenApiDocument,
  readOpenApiSourceText,
  type OpenApiSourceFileSystem
} from "../spec-source.js";

const HTTP_METHOD_NAMES = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export type OnUnmocked = "throw" | "reply404";

export interface MockFixtureEntry {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type MockFetchFixtures = Record<string, MockFixtureEntry> | string;

export interface MockFetchFileSystem extends OpenApiSourceFileSystem {
  readdir?(directory: string): Promise<string[]>;
}

export interface MockFetchOptions {
  spec: OpenApiDocument | string | URL;
  fixtures?: MockFetchFixtures;
  onUnmocked?: OnUnmocked;
  cwd?: string;
  fs?: MockFetchFileSystem;
  fetch?: typeof globalThis.fetch;
}

export interface RequestRecord {
  method: string;
  path: string;
  operationId: string;
  headers: Record<string, string>;
  body: unknown;
  at: Date;
}

export interface MockFetchHandle {
  fetch: typeof globalThis.fetch;
  requests: RequestRecord[];
  reset(): void;
}

interface CompiledOperation {
  method: string;
  pathTemplate: string;
  pathRegex: RegExp;
  pathSpecificity: number;
  operationId: string;
  operation: OpenApiOperationObject;
  defaultStatus: number;
  defaultExample: unknown;
  requestBodySchema: OpenApiSchemaObject | undefined;
  requestBodyRequired: boolean;
  responseSchemas: Map<number, OpenApiSchemaObject>;
}

export async function mockFetch(options: MockFetchOptions): Promise<MockFetchHandle> {
  const document = await resolveSpec(options);
  const operations = compileOperations(document);
  const operationIds = new Set(operations.map((op) => op.operationId));
  const fixtureLoader = await createFixtureLoader(
    options.fixtures,
    options.cwd,
    options.fs,
    operationIds
  );
  const onUnmocked: OnUnmocked = options.onUnmocked ?? "throw";

  const requests: RequestRecord[] = [];

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const requestUrl = parseRequestUrl(input);
    const method = (init?.method ?? getRequestMethod(input) ?? "GET").toUpperCase();
    const headers = collectHeaders(input, init);
    const bodyText = await readRequestBody(input, init);
    const parsedBody = parseRequestBody(bodyText, headers["content-type"]);

    const matchingPath = operations.filter((op) => op.pathRegex.test(requestUrl.pathname));
    if (matchingPath.length === 0) {
      throw new MockFetchError(
        `mockFetch: no operation in the spec matches ${method} ${requestUrl.pathname}.`
      );
    }

    const operation = matchingPath.find((op) => op.method === method);
    if (operation === undefined) {
      const allowed = matchingPath.map((op) => op.method).join(", ");
      throw new MockFetchError(
        `mockFetch: method ${method} not declared for ${requestUrl.pathname} (spec allows ${allowed}).`
      );
    }

    requests.push({
      method,
      path: requestUrl.pathname,
      operationId: operation.operationId,
      headers,
      body: parsedBody,
      at: new Date()
    });

    if (operation.requestBodySchema !== undefined && parsedBody !== undefined) {
      const errors = validateAgainstSchema(parsedBody, operation.requestBodySchema, document, "$");
      if (errors.length > 0) {
        return jsonResponse(422, { errors });
      }
    } else if (operation.requestBodyRequired && parsedBody === undefined) {
      return jsonResponse(422, { errors: ["$: request body is required"] });
    }

    const fixture = await fixtureLoader(operation.operationId);

    if (fixture !== undefined) {
      const status = fixture.status ?? operation.defaultStatus;
      const responseSchema = operation.responseSchemas.get(status);
      if (responseSchema !== undefined && fixture.body !== undefined) {
        const errors = validateAgainstSchema(fixture.body, responseSchema, document, "$response");
        if (errors.length > 0) {
          throw new MockFetchError(
            `mockFetch: response fixture for ${JSON.stringify(operation.operationId)} ` +
              `violates the spec response schema for status ${status}:\n  ${errors.join("\n  ")}`
          );
        }
      }
      return buildResponse(fixture, operation.defaultStatus);
    }

    if (operation.defaultExample !== undefined) {
      return buildResponse({ body: operation.defaultExample }, operation.defaultStatus);
    }

    if (onUnmocked === "reply404") {
      return jsonResponse(404, { error: `unmocked: ${operation.operationId}` });
    }

    throw new MockFetchError(
      `mockFetch: unmocked operation ${JSON.stringify(operation.operationId)}. ` +
        `Add a fixture, an OpenAPI example on the success response, or pass { onUnmocked: "reply404" }.`
    );
  };

  return {
    fetch: fetchImpl,
    requests,
    reset(): void {
      requests.length = 0;
    }
  };
}

class MockFetchError extends UserError {
  constructor(message: string) {
    super(message);
    this.name = "MockFetchError";
  }
}

async function resolveSpec(options: MockFetchOptions): Promise<OpenApiDocument> {
  const { spec } = options;

  if (typeof spec !== "string" && !(spec instanceof URL)) {
    return spec;
  }

  const sourceText = await readOpenApiSourceText(spec, {
    cwd: options.cwd ?? process.cwd(),
    fetch: options.fetch ?? globalThis.fetch,
    fs: options.fs ?? fs
  });

  return parseOpenApiDocument(sourceText, spec);
}

function compileOperations(document: OpenApiDocument): CompiledOperation[] {
  const paths = document.paths;
  if (paths === undefined) {
    throw new UserError('mockFetch: OpenAPI document must define a top-level "paths" object.');
  }

  const compiled: CompiledOperation[] = [];

  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    if (pathItem === undefined) {
      continue;
    }

    for (const method of HTTP_METHOD_NAMES) {
      const operation = pathItem[method];
      if (operation === undefined) {
        continue;
      }

      const resolvedOperation = resolveOperation(operation, document);
      const operationId =
        resolvedOperation.operationId ?? `${method.toUpperCase()} ${pathTemplate}`;
      const { defaultStatus, defaultExample, responseSchemas } = pickResponseMetadata(
        resolvedOperation,
        document
      );
      const { schema: requestBodySchema, required: requestBodyRequired } = pickRequestBody(
        resolvedOperation,
        document
      );

      compiled.push({
        method: method.toUpperCase(),
        pathTemplate,
        pathRegex: pathTemplateToRegex(pathTemplate),
        pathSpecificity: countPathPlaceholders(pathTemplate),
        operationId,
        operation: resolvedOperation,
        defaultStatus,
        defaultExample,
        requestBodySchema,
        requestBodyRequired,
        responseSchemas
      });
    }
  }

  // Literal paths win over templated paths when both match the same pathname.
  // Sort ascending by placeholder count so concrete operations are matched first.
  compiled.sort((a, b) => a.pathSpecificity - b.pathSpecificity);

  return compiled;
}

function countPathPlaceholders(template: string): number {
  return (template.match(/\{[^}]+\}/g) ?? []).length;
}

function pathTemplateToRegex(template: string): RegExp {
  // Escape regex metacharacters except for "{...}" placeholders, which become non-slash captures.
  const pattern = template.replace(/[.*+?^${}()|[\]\\]/g, (match) =>
    match === "{" || match === "}" ? match : `\\${match}`
  );
  const withParams = pattern.replace(/\{[^}]+\}/g, "[^/]+");
  return new RegExp(`^${withParams}$`);
}

function resolveOperation(
  operation: OpenApiOperationObject | OpenApiReferenceObject,
  document: OpenApiDocument
): OpenApiOperationObject {
  if (isReference(operation)) {
    return resolveReference<OpenApiOperationObject>(operation, document);
  }
  return operation;
}

function pickResponseMetadata(
  operation: OpenApiOperationObject,
  document: OpenApiDocument
): {
  defaultStatus: number;
  defaultExample: unknown;
  responseSchemas: Map<number, OpenApiSchemaObject>;
} {
  const responses = operation.responses ?? {};
  const responseSchemas = new Map<number, OpenApiSchemaObject>();

  for (const [code, response] of Object.entries(responses)) {
    const status = parseInt(code, 10);
    if (!Number.isFinite(status) || response === undefined) {
      continue;
    }
    const resolved = isReference(response)
      ? resolveReference<OpenApiResponseObject>(response, document)
      : response;
    const schema = extractResponseSchema(resolved, document);
    if (schema !== undefined) {
      responseSchemas.set(status, schema);
    }
  }

  const successCodes = Object.keys(responses)
    .map((code) => parseInt(code, 10))
    .filter((code) => Number.isFinite(code) && code >= 200 && code < 300)
    .sort((a, b) => a - b);

  if (successCodes.length === 0) {
    return { defaultStatus: 200, defaultExample: undefined, responseSchemas };
  }

  const status = successCodes[0]!;
  const response = responses[String(status)];
  const resolvedResponse =
    response !== undefined && isReference(response)
      ? resolveReference<OpenApiResponseObject>(response, document)
      : (response as OpenApiResponseObject | undefined);

  return {
    defaultStatus: status,
    defaultExample: extractExample(resolvedResponse, document),
    responseSchemas
  };
}

function extractResponseSchema(
  response: OpenApiResponseObject | undefined,
  document: OpenApiDocument
): OpenApiSchemaObject | undefined {
  if (response === undefined) {
    return undefined;
  }
  const media = pickJsonMediaType(response.content);
  if (media === undefined || media.schema === undefined) {
    return undefined;
  }
  return isReference(media.schema)
    ? resolveReference<OpenApiSchemaObject>(media.schema, document)
    : media.schema;
}

function pickRequestBody(
  operation: OpenApiOperationObject,
  document: OpenApiDocument
): { schema: OpenApiSchemaObject | undefined; required: boolean } {
  const raw = operation.requestBody;
  if (raw === undefined) {
    return { schema: undefined, required: false };
  }

  const resolved = isReference(raw)
    ? resolveReference<OpenApiRequestBodyObject>(raw, document)
    : raw;

  const media = pickJsonMediaType(resolved.content);
  if (media === undefined) {
    return { schema: undefined, required: resolved.required === true };
  }

  if (media.schema === undefined) {
    return { schema: undefined, required: resolved.required === true };
  }

  const schema = isReference(media.schema)
    ? resolveReference<OpenApiSchemaObject>(media.schema, document)
    : media.schema;

  return { schema, required: resolved.required === true };
}

function extractExample(
  response: OpenApiResponseObject | undefined,
  document: OpenApiDocument
): unknown {
  if (response === undefined) {
    return undefined;
  }

  const media = pickJsonMediaType(response.content) as
    | (OpenApiMediaTypeObject & {
        example?: unknown;
        examples?: Record<string, { value?: unknown } | undefined>;
      })
    | undefined;

  if (media === undefined) {
    return undefined;
  }

  if (media.example !== undefined) {
    return media.example;
  }

  if (media.examples !== undefined) {
    for (const value of Object.values(media.examples)) {
      if (value !== undefined && Object.prototype.hasOwnProperty.call(value, "value")) {
        return value.value;
      }
    }
  }

  if (media.schema !== undefined) {
    const schema = isReference(media.schema)
      ? resolveReference<OpenApiSchemaObject>(media.schema, document)
      : media.schema;
    const schemaExample = (schema as OpenApiSchemaObject & { example?: unknown }).example;
    if (schemaExample !== undefined) {
      return schemaExample;
    }
  }

  return undefined;
}

function pickJsonMediaType(
  content: Record<string, OpenApiMediaTypeObject | undefined> | undefined
): OpenApiMediaTypeObject | undefined {
  if (content === undefined) {
    return undefined;
  }

  for (const [type, media] of Object.entries(content)) {
    if (media !== undefined && (type === "*/*" || /application\/json|\+json/i.test(type))) {
      return media;
    }
  }

  return undefined;
}

function isReference(value: unknown): value is OpenApiReferenceObject {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, "$ref") &&
    typeof (value as { $ref?: unknown }).$ref === "string"
  );
}

function resolveReference<T>(reference: OpenApiReferenceObject, document: OpenApiDocument): T {
  const ref = reference.$ref;
  if (!ref.startsWith("#/")) {
    throw new UserError(`mockFetch: only local $ref values are supported, got ${JSON.stringify(ref)}.`);
  }

  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = document;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      throw new UserError(`mockFetch: failed to resolve $ref ${JSON.stringify(ref)}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new UserError(`mockFetch: failed to resolve $ref ${JSON.stringify(ref)}.`);
    }
    current = (current as Record<string, unknown>)[segment];
  }

  if (current === undefined) {
    throw new UserError(`mockFetch: failed to resolve $ref ${JSON.stringify(ref)}.`);
  }

  return current as T;
}

function validateAgainstSchema(
  value: unknown,
  schema: OpenApiSchemaObject | OpenApiReferenceObject,
  document: OpenApiDocument,
  pointer: string
): string[] {
  const resolved = isReference(schema)
    ? resolveReference<OpenApiSchemaObject>(schema, document)
    : schema;

  if (resolved.anyOf !== undefined) {
    return resolved.anyOf.some(
      (branch) => validateAgainstSchema(value, branch, document, pointer).length === 0
    )
      ? []
      : [`${pointer}: did not match any anyOf branch`];
  }

  if (resolved.oneOf !== undefined) {
    const matches = resolved.oneOf.filter(
      (branch) => validateAgainstSchema(value, branch, document, pointer).length === 0
    );
    return matches.length === 1 ? [] : [`${pointer}: matched ${matches.length} oneOf branches`];
  }

  const errors: string[] = [];

  if (resolved.allOf !== undefined) {
    for (const branch of resolved.allOf) {
      errors.push(...validateAgainstSchema(value, branch, document, pointer));
    }
  }

  const types = normalizeTypes(resolved);

  if (types.length > 0 && !types.some((type) => matchesPrimitiveType(value, type))) {
    errors.push(`${pointer}: expected ${types.join(" or ")}, got ${describeValue(value)}`);
    return errors;
  }

  if (types.includes("object") && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;

    for (const required of resolved.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(objectValue, required)) {
        errors.push(`${pointer}/${required}: required`);
      }
    }
    if (resolved.properties !== undefined) {
      for (const [key, propValue] of Object.entries(objectValue)) {
        const propSchema = resolved.properties[key];
        if (propSchema !== undefined) {
          errors.push(...validateAgainstSchema(propValue, propSchema, document, `${pointer}/${key}`));
        } else if (resolved.additionalProperties === false) {
          errors.push(`${pointer}/${key}: additional property not allowed`);
        }
      }
    } else if (resolved.additionalProperties === false && Object.keys(objectValue).length > 0) {
      for (const key of Object.keys(objectValue)) {
        errors.push(`${pointer}/${key}: additional property not allowed`);
      }
    }
  }

  if (types.includes("array") && Array.isArray(value) && resolved.items !== undefined) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateAgainstSchema(value[i], resolved.items, document, `${pointer}/${i}`));
    }
  }

  if (resolved.enum !== undefined && !resolved.enum.includes(value as never)) {
    errors.push(`${pointer}: not in enum`);
  }

  return errors;
}

function normalizeTypes(schema: OpenApiSchemaObject): string[] {
  const type = schema.type;
  if (type === undefined) {
    return [];
  }
  const list = Array.isArray(type) ? type.slice() : [type as string];
  if (schema.nullable === true && !list.includes("null")) {
    list.push("null");
  }
  return list;
}

function matchesPrimitiveType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function parseRequestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function getRequestMethod(input: RequestInfo | URL): string | undefined {
  if (typeof input === "string" || input instanceof URL) {
    return undefined;
  }
  return input.method;
}

function collectHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  const initHeaders = init?.headers;
  const requestHeaders =
    typeof input !== "string" && !(input instanceof URL) ? input.headers : undefined;

  appendHeaders(headers, requestHeaders);
  appendHeaders(headers, initHeaders);
  if (init?.body instanceof FormData && headers["content-type"] === undefined) {
    appendHeaders(headers, new Request("https://mock.invalid", { method: "POST", body: init.body }).headers);
  }

  return headers;
}

function appendHeaders(target: Record<string, string>, source: HeadersInit | undefined): void {
  if (source === undefined) {
    return;
  }

  if (source instanceof Headers) {
    source.forEach((value, key) => {
      setHeader(target, key, value);
    });
    return;
  }

  if (Array.isArray(source)) {
    for (const [key, value] of source) {
      setHeader(target, key, value);
    }
    return;
  }

  for (const [key, value] of Object.entries(source)) {
    setHeader(target, key, String(value));
  }
}

function setHeader(target: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(target, key.toLowerCase(), {
    enumerable: true,
    configurable: true,
    writable: true,
    value
  });
}

async function readRequestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<string | undefined> {
  if (init?.body !== undefined && init.body !== null) {
    return typeof init.body === "string" ? init.body : await new Response(init.body as BodyInit).text();
  }

  if (typeof input !== "string" && !(input instanceof URL)) {
    return await input.clone().text();
  }

  return undefined;
}

function parseRequestBody(text: string | undefined, contentType: string | undefined): unknown {
  if (text === undefined || text.length === 0) {
    return undefined;
  }

  if (contentType?.toLowerCase().includes("application/x-www-form-urlencoded") === true) {
    const body: Record<string, string | string[]> = {};
    for (const [key, value] of new URLSearchParams(text)) {
      const existing = body[key];
      body[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
    }
    return body;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildResponse(fixture: MockFixtureEntry, defaultStatus: number): Response {
  const status = fixture.status ?? defaultStatus;
  const headers = new Headers(fixture.headers ?? { "content-type": "application/json" });
  const contentType = headers.get("content-type")?.toLowerCase();
  const body =
    fixture.body === undefined || fixture.body === null
      ? null
      : contentType?.includes("json") === true
        ? JSON.stringify(fixture.body)
        : String(fixture.body);

  return new Response(body, { status, headers });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

type FixtureLoader = (operationId: string) => Promise<MockFixtureEntry | undefined>;

async function createFixtureLoader(
  fixtures: MockFetchFixtures | undefined,
  cwd: string | undefined,
  injectedFs: MockFetchFileSystem | undefined,
  operationIds: Set<string>
): Promise<FixtureLoader> {
  if (fixtures === undefined) {
    return async () => undefined;
  }

  if (typeof fixtures !== "string") {
    rejectUnknownFixtureKeys(Object.keys(fixtures), operationIds, "fixture key");
    const map = fixtures;
    return async (operationId) => map[operationId];
  }

  const directory = path.resolve(cwd ?? process.cwd(), fixtures);
  const fileSystem = injectedFs ?? fs;
  const readdir = fileSystem.readdir?.bind(fileSystem);
  if (readdir === undefined) {
    throw new UserError(
      "mockFetch: directory fixtures require an fs implementation that exposes readdir."
    );
  }

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (isNotFoundError(error)) {
      return async () => undefined;
    }
    throw error;
  }

  const fixtureFiles = entries.filter((entry) => entry.endsWith(".json"));
  const operationIdsFromFiles = fixtureFiles.map((entry) => entry.slice(0, -".json".length));
  rejectUnknownFixtureKeys(operationIdsFromFiles, operationIds, "fixture file");

  const cache = new Map<string, MockFixtureEntry>();
  for (const entry of fixtureFiles) {
    const operationId = entry.slice(0, -".json".length);
    const filePath = path.join(directory, entry);
    const contents = await fileSystem.readFile(filePath, "utf8");
    cache.set(operationId, JSON.parse(contents) as MockFixtureEntry);
  }

  return async (operationId) => cache.get(operationId);
}

function rejectUnknownFixtureKeys(
  candidates: readonly string[],
  operationIds: Set<string>,
  label: string
): void {
  const unknown = candidates.filter((key) => !operationIds.has(key));
  if (unknown.length === 0) {
    return;
  }
  const sorted = [...operationIds].sort();
  throw new UserError(
    `mockFetch: ${unknown.length === 1 ? label : `${label}s`} ${formatList(unknown)} ` +
      `${unknown.length === 1 ? "is" : "are"} not declared in the spec. ` +
      `Known operationIds: ${sorted.length === 0 ? "(none)" : formatList(sorted)}.`
  );
}

function formatList(values: readonly string[]): string {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT") || hasOwnErrorCode(error, "ENOTDIR");
}

export type { OpenApiSourceFileSystem };
