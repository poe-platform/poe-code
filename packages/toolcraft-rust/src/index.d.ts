import type { CallToolResult } from "tiny-stdio-mcp-server-rust";
export { createManagedStream } from "./stream.js";
export { S, toJsonSchema, withStandardSchema } from "./schema.js";
export type {
  AnySchema,
  ArraySchema,
  BooleanSchema,
  CliMissingParameterChoice,
  CliMissingParameterContext,
  CliMissingParameterResolution,
  CliOutputMode,
  CliSchemaOptions,
  EnumSchema,
  JsonSchema,
  JsonSchemaDocument,
  JsonSchemaDocumentOptions,
  JsonSchemaOptions,
  Input,
  Output,
  StandardSchema,
  Standardized,
  StandardIssue,
  StandardResult,
  StandardJsonSchemaOptions,
  JsonValue,
  JsonValueSchema,
  NumberSchema,
  ObjectSchema,
  OneOfSchema,
  OptionalSchema,
  RecordSchema,
  SchemaBase,
  Static,
  StringSchema,
  UnionSchema,
  ValidationIssue,
  ValidationOptions,
  ValidationResult
} from "./schema.js";

export declare function asMCPResult<TResult extends CallToolResult>(result: TResult): TResult;

export declare function suggest(
  input: string,
  candidates: readonly string[],
  opts?: { max?: number; threshold?: number }
): string[];

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug" | "trace";

export interface DiagnosticLogEvent {
  level: Exclude<LogLevel, "silent">;
  message: string;
  category?: "runtime" | "http" | "auth" | "retry" | "progress";
  data?: Record<string, unknown>;
}

export interface RuntimeLogger {
  level: LogLevel;
  emit(event: DiagnosticLogEvent): void;
}

export type RuntimeLoggerInput = RuntimeLogger | ((event: DiagnosticLogEvent) => void);

export declare function isLogLevel(value: string): value is LogLevel;

export declare function shouldEmitDiagnostic(
  eventLevel: LogLevel,
  configuredLevel: LogLevel
): boolean;

export declare function createRuntimeLogger(options?: {
  level?: LogLevel;
  logger?: RuntimeLoggerInput;
}): RuntimeLogger;

export declare class UserError extends Error {
  constructor(message: string, options?: ErrorOptions);
}

export declare function isUserError(error: unknown): error is Error;

export declare class ToolcraftBugError extends Error {
  constructor(message: string);
}

export interface HttpErrorRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface HttpErrorResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
}

export declare class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly code?: string;
  readonly requestId?: string;
  readonly request: HttpErrorRequest;
  readonly response: HttpErrorResponse;
  get body(): unknown;
  constructor(args: {
    request: HttpErrorRequest;
    response: HttpErrorResponse;
    code?: string;
    requestId?: string;
    message?: string;
  });
}

export declare class ClientError extends HttpError {}

export declare class BadRequestError extends ClientError {}

export declare class AuthenticationError extends ClientError {}

export declare class PermissionDeniedError extends ClientError {}

export declare class NotFoundError extends ClientError {}

export declare class ConflictError extends ClientError {}

export declare class UnprocessableEntityError extends ClientError {}

export declare class RateLimitError extends ClientError {}

export declare class ServerError extends HttpError {}

export declare class InternalServerError extends ServerError {}

export declare class ServiceUnavailableError extends ServerError {}

export declare function createHttpError(args: {
  request: HttpErrorRequest;
  response: HttpErrorResponse;
  code?: string;
  requestId?: string;
  message?: string;
}): HttpError;

export * from "./definitions.js";

export declare function isSensitiveName(name: string): boolean;
export declare function redactHttpBody(body: unknown): unknown;

export interface PackageMetadata {
  name?: string;
  path: string;
  version?: string;
}
export declare function findPackageMetadata(from: string | URL): PackageMetadata | undefined;
export declare function packageMetadata(from?: string | URL): PackageMetadata;
