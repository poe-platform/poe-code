import { redactHttpBody } from "./redaction.js";

export interface HttpErrorLike {
  name: string;
  message: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
}

export interface ApiErrorSummary {
  status: number;
  statusText: string;
  requestMethod: string;
  requestUrl: string;
  requestId?: string;
  code?: string;
  message?: string;
  fieldErrors?: Array<{ path: string; message: string }>;
  retryAfter?: string;
  hint?: string;
}

export interface ToolcraftErrorEnvelope {
  kind: "http";
  message: string;
  code?: string;
  requestId?: string;
  http: {
    method: string;
    url: string;
    status: number;
    statusText: string;
  };
  fieldErrors?: Array<{ path: string; message: string }>;
  retryAfter?: string;
  hint?: string;
  reportPath?: string;
}

const REQUEST_ID_FIELDS = ["request_id", "requestId", "id"];
const CODE_FIELDS = ["code", "error_code", "errorCode", "error"];
const MESSAGE_FIELDS = ["message", "detail", "title", "error_description"];

export function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  if (!isPlainObject(error)) {
    return false;
  }

  if (typeof error.name !== "string" || typeof error.message !== "string") {
    return false;
  }

  const request = error.request;
  const response = error.response;

  return (
    isPlainObject(request) &&
    typeof request.method === "string" &&
    typeof request.url === "string" &&
    isStringRecord(request.headers) &&
    isPlainObject(response) &&
    typeof response.status === "number" &&
    typeof response.statusText === "string" &&
    isStringRecord(response.headers) &&
    hasOwnProperty(response, "body")
  );
}

export function summarizeHttpError(error: HttpErrorLike): ApiErrorSummary {
  const body = redactHttpBody(error.response.body);
  const retryAfter = getHeader(error.response.headers, "retry-after");
  const message = extractMessage(body);
  const summary: ApiErrorSummary = {
    status: error.response.status,
    statusText: error.response.statusText,
    requestMethod: error.request.method,
    requestUrl: error.request.url,
    ...(message === undefined ? {} : { message }),
    ...optionalString("requestId", getHeader(error.response.headers, "x-request-id") ?? extractFirstString(body, REQUEST_ID_FIELDS)),
    ...optionalString("code", extractCode(body)),
    ...optionalString("retryAfter", retryAfter),
    ...optionalArray("fieldErrors", extractFieldErrors(body)),
    ...optionalString("hint", createHttpErrorHint(error.response.status, retryAfter))
  };

  return summary;
}

export function createHttpErrorEnvelope(
  error: HttpErrorLike,
  reportPath?: string
): ToolcraftErrorEnvelope {
  const summary = summarizeHttpError(error);
  return {
    kind: "http",
    message: summary.message ?? error.message,
    ...(summary.code === undefined ? {} : { code: summary.code }),
    ...(summary.requestId === undefined ? {} : { requestId: summary.requestId }),
    http: {
      method: summary.requestMethod,
      url: summary.requestUrl,
      status: summary.status,
      statusText: summary.statusText
    },
    ...(summary.fieldErrors === undefined ? {} : { fieldErrors: summary.fieldErrors }),
    ...(summary.retryAfter === undefined ? {} : { retryAfter: summary.retryAfter }),
    ...(summary.hint === undefined ? {} : { hint: summary.hint }),
    ...(reportPath === undefined ? {} : { reportPath })
  };
}

function createHttpErrorHint(status: number, retryAfter: string | undefined): string | undefined {
  if (status === 401 || status === 403) {
    return "Check the configured API credentials and permissions.";
  }

  if ((status === 429 || status === 503) && retryAfter !== undefined) {
    return `Retry after ${retryAfter}.`;
  }

  return undefined;
}

function extractMessage(body: unknown): string | undefined {
  if (!isPlainObject(body)) {
    return undefined;
  }

  const graphqlMessage = extractGraphQlMessage(body);
  if (graphqlMessage !== undefined) {
    return graphqlMessage;
  }

  return extractFirstString(body, MESSAGE_FIELDS);
}

function extractCode(body: unknown): string | undefined {
  if (!isPlainObject(body)) {
    return undefined;
  }

  const graphqlCode = extractGraphQlCode(body);
  if (graphqlCode !== undefined) {
    return graphqlCode;
  }

  return extractFirstString(body, CODE_FIELDS);
}

function extractGraphQlMessage(body: Record<string, unknown>): string | undefined {
  const [first] = Array.isArray(body.errors) ? body.errors : [];
  return isPlainObject(first) && typeof first.message === "string" ? first.message : undefined;
}

function extractGraphQlCode(body: Record<string, unknown>): string | undefined {
  const [first] = Array.isArray(body.errors) ? body.errors : [];
  if (!isPlainObject(first) || !isPlainObject(first.extensions)) {
    return undefined;
  }

  return typeof first.extensions.code === "string" ? first.extensions.code : undefined;
}

function extractFieldErrors(body: unknown): Array<{ path: string; message: string }> | undefined {
  if (!isPlainObject(body)) {
    return undefined;
  }

  const candidates = [body.field_errors, body.fieldErrors, body.errors, body.non_field_errors];
  const flattened = candidates.flatMap((candidate) => flattenFieldErrors(candidate, []));
  return flattened.length === 0 ? undefined : flattened;
}

function flattenFieldErrors(value: unknown, path: string[]): Array<{ path: string; message: string }> {
  if (typeof value === "string") {
    return [{ path: formatPath(path), message: value }];
  }

  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "string")) {
      return value.map((message) => ({ path: formatPath(path), message }));
    }

    return value.flatMap((entry, index) => flattenFieldErrors(entry, [...path, String(index)]));
  }

  if (!isPlainObject(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, nested]) => flattenFieldErrors(nested, [...path, key]));
}

function formatPath(path: string[]): string {
  return path.length === 0 ? "error" : path.join(".");
}

function extractFirstString(
  body: unknown,
  fields: readonly string[]
): string | undefined {
  if (!isPlainObject(body)) {
    return undefined;
  }

  for (const field of fields) {
    const value = body[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function optionalString<Name extends string>(
  name: Name,
  value: string | undefined
): Record<Name, string> | Record<string, never> {
  return value === undefined ? {} : { [name]: value } as Record<Name, string>;
}

function optionalArray<Name extends string, TValue>(
  name: Name,
  value: TValue[] | undefined
): Record<Name, TValue[]> | Record<string, never> {
  return value === undefined ? {} : { [name]: value } as Record<Name, TValue[]>;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}
