import { createRequire } from "node:module";

export {
  defineCommand,
  defineStreamCommand,
  defineGroup,
  cloneCommandNode,
  getCommandSourcePath,
  hasMcpProxyConfig
} from "./definitions.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");

export const { isLogLevel, shouldEmitDiagnostic } = native;

export function suggest(input, candidates, opts = {}) {
  if (input.length === 0) return [];
  const max = opts.max ?? 3;
  const threshold = opts.threshold ?? Math.max(1, Math.floor(input.length / 4));
  const entries = candidates.map((candidate) => ({ candidate })).filter(() => true);
  const distances = native.candidateDistances(
    input,
    entries.map((entry) => entry.candidate)
  );
  // Collation belongs to the caller's Node/ICU locale, not Rust's byte ordering.
  return entries
    .map(({ candidate }, index) => ({ candidate, distance: distances[index] }))
    .filter(({ distance }) => distance <= threshold)
    .sort(
      (left, right) =>
        left.distance - right.distance || left.candidate.localeCompare(right.candidate)
    )
    .slice(0, max)
    .map(({ candidate }) => candidate);
}

export function createRuntimeLogger(options = {}) {
  const level = options.level ?? "warn";
  const sink = options.logger;
  return {
    level,
    emit(event) {
      if (!shouldEmitDiagnostic(event.level, level)) return;
      if (typeof sink === "function") sink(event);
      else sink?.emit(event);
    }
  };
}

// Native Error construction, causes, subclasses and stack traces stay in the
// caller's JS realm. Moving those objects across the addon loses identity.
export class UserError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "UserError";
  }
}

export function isUserError(error) {
  return error instanceof UserError || (error instanceof Error && error.name === "UserError");
}

export class ToolcraftBugError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolcraftBugError";
  }
}

export class HttpError extends Error {
  status;
  statusText;
  code;
  requestId;
  request;
  response;

  get body() {
    return this.response.body;
  }

  constructor(args) {
    super(
      args.message ??
        `${args.request.method} ${args.request.url} → ${args.response.status} ${args.response.statusText}`
    );
    this.name = new.target.name;
    this.status = args.response.status;
    this.statusText = args.response.statusText;
    this.code = args.code;
    this.requestId = args.requestId;
    this.request = args.request;
    this.response = args.response;
  }
}

export class ClientError extends HttpError {}
export class BadRequestError extends ClientError {}
export class AuthenticationError extends ClientError {}
export class PermissionDeniedError extends ClientError {}
export class NotFoundError extends ClientError {}
export class ConflictError extends ClientError {}
export class UnprocessableEntityError extends ClientError {}
export class RateLimitError extends ClientError {}
export class ServerError extends HttpError {}
export class InternalServerError extends ServerError {}
export class ServiceUnavailableError extends ServerError {}

const httpErrors = {
  HttpError,
  ClientError,
  BadRequestError,
  AuthenticationError,
  PermissionDeniedError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  RateLimitError,
  ServerError,
  InternalServerError,
  ServiceUnavailableError
};

export function createHttpError(args) {
  const ErrorClass = httpErrors[native.httpErrorClass(args.response.status)];
  return new ErrorClass(args);
}

export async function assertCommandRequirements(command, context, options = {}) {
  const requires = command.requires;
  if (requires === undefined) return;
  const env = options.env ?? process.env;
  const authEnvVar = options.authEnvVar ?? "POE_API_KEY";
  if (requires.auth === true && env[authEnvVar] === undefined) {
    throw new UserError(
      `Command "${command.name}" requires authentication.\n  Run 'poe-code login' first.`
    );
  }
  if (requires.apiVersion !== undefined) {
    const requirement = requires.apiVersion;
    // Validate before reading runner options: callers may supply accessors.
    if (native.apiVersionIssue(requirement, undefined) === "invalidRequirement") {
      throw new UserError(
        `Command "${command.name}" has invalid apiVersion requirement "${requires.apiVersion}". Expected format ">=X.Y.Z".`
      );
    }
    if (options.apiVersion === undefined) {
      throw new UserError(
        `Command "${command.name}" requires API version ${requires.apiVersion}, but no runner API version was provided.`
      );
    }
    const issue = native.apiVersionIssue(requirement, options.apiVersion);
    if (issue === "invalidRunner") {
      throw new UserError(
        `Command "${command.name}" requires API version ${requires.apiVersion}, but runner API version "${options.apiVersion}" is not valid semver.`
      );
    }
    if (issue === "tooOld") {
      throw new UserError(
        `Command "${command.name}" requires API version ${requires.apiVersion}, but runner API version is ${options.apiVersion}.`
      );
    }
  }
  const result = await requires.check?.(context);
  if (result && !result.ok) throw new UserError(result.message ?? "Command precondition failed.");
}

export function resolveCommandSecrets(command, env = process.env) {
  const secrets = {};
  for (const [name, secret] of Object.entries(command.secrets)) {
    const value = env[secret.env];
    if (value === undefined && secret.optional !== true) {
      const details = secret.description ? `\n  ${secret.description}` : "";
      const candidates = Object.keys(env).filter(
        (candidate) => candidate !== secret.env && env[candidate] !== undefined
      );
      const suggestions = suggestSecretEnv(secret.env, candidates);
      const suggestionLine =
        suggestions.length > 0 ? `\nDid you mean: ${suggestions.join(", ")}?` : "";
      throw new UserError(`Missing required secret ${secret.env}${details}${suggestionLine}`);
    }
    Object.defineProperty(secrets, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return secrets;
}

function suggestSecretEnv(input, candidates) {
  const direct = suggest(input, candidates);
  if (!input.includes("_")) return direct;
  const inputParts = input.split("_");
  const related = candidates.filter((candidate) => {
    const parts = candidate.split("_");
    return (
      parts[0] === inputParts[0] && parts[parts.length - 1] === inputParts[inputParts.length - 1]
    );
  });
  return [
    ...new Set([
      ...direct,
      ...suggest(input, related, { threshold: Math.max(4, Math.floor(input.length / 4)) })
    ])
  ].slice(0, 3);
}
