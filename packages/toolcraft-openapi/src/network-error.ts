import { UserError } from "toolcraft";
import { redactSensitiveQueryValues } from "./redaction.js";

interface NetworkErrorLike {
  code?: unknown;
  address?: unknown;
  port?: unknown;
  timeout?: unknown;
  ms?: unknown;
  cause?: unknown;
}

export function classifyNetworkError(error: unknown, url: string): UserError | null {
  const networkError = findNetworkError(error);
  const urlParts = new URL(url);
  const host = getHost(networkError, urlParts);
  const redactedUrl = redactSensitiveQueryValues(url);

  switch (readStringProperty(networkError, "code")) {
    case "ECONNREFUSED":
      return new UserError(
        `Connection refused: ${host}:${getPort(networkError, urlParts)}. Is the server running?`,
        { cause: error }
      );
    case "ETIMEDOUT":
      return new UserError(
        `Request timed out after ${getTimeoutMs(networkError)}ms: ${redactedUrl}.`,
        {
          cause: error
        }
      );
    case "ENOTFOUND":
      return new UserError(`DNS lookup failed for ${host}. Check the URL or your network.`, {
        cause: error
      });
    case "ECONNRESET":
      return new UserError(`Connection reset by ${host}. Likely transient: try again.`, {
        cause: error
      });
    case "EAI_AGAIN":
      return new UserError(`Temporary DNS failure for ${host}. Network may be down.`, {
        cause: error
      });
    case "UND_ERR_SOCKET":
      return new UserError(`Network connection failed: ${redactedUrl}.`, { cause: error });
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return new UserError(`Request timed out: ${redactedUrl}.`, { cause: error });
  }

  if (findAbortError(error) !== null) {
    return new UserError(`Request aborted: ${redactedUrl}.`, { cause: error });
  }

  if (error instanceof TypeError && error.message === "fetch failed" && !hasCause(error)) {
    return new UserError(`Network request failed: ${redactedUrl}.`, { cause: error });
  }

  return null;
}

function findNetworkError(error: unknown): NetworkErrorLike | null {
  let current: unknown = error;

  while (isErrorLikeObject(current)) {
    if (readStringProperty(current, "code") !== undefined) {
      return current;
    }

    current = readOwnProperty(current, "cause");
  }

  return null;
}

function isAbortError(error: unknown): boolean {
  return isErrorLikeObject(error) && error.name === "AbortError";
}

function findAbortError(error: unknown): NetworkErrorLike | null {
  let current: unknown = error;

  while (isErrorLikeObject(current)) {
    if (isAbortError(current)) {
      return current;
    }

    current = readOwnProperty(current, "cause");
  }

  return null;
}

function hasCause(error: Error): boolean {
  return readOwnProperty(error, "cause") !== undefined;
}

function getHost(error: NetworkErrorLike | null, url: URL): string {
  return readStringProperty(error, "address") ?? url.hostname;
}

function getPort(error: NetworkErrorLike | null, url: URL): string {
  const port = readStringOrNumberProperty(error, "port");
  if (port !== undefined) {
    return String(port);
  }

  if (url.port) {
    return url.port;
  }

  return url.protocol === "https:" ? "443" : "80";
}

function getTimeoutMs(error: NetworkErrorLike | null): string {
  const ms = readStringOrNumberProperty(error, "ms");
  if (ms !== undefined) {
    return String(ms);
  }

  const timeout = readStringOrNumberProperty(error, "timeout");
  if (timeout !== undefined) {
    return String(timeout);
  }

  return "unknown";
}

function isErrorLikeObject(value: unknown): value is NetworkErrorLike & { name?: unknown } {
  return typeof value === "object" && value !== null;
}

function readOwnProperty<Name extends PropertyKey>(
  value: object | null | undefined,
  name: Name
): unknown {
  if (value === null || value === undefined || !Object.prototype.hasOwnProperty.call(value, name)) {
    return undefined;
  }

  return (value as Record<Name, unknown>)[name];
}

function readStringProperty(
  value: object | null | undefined,
  name: keyof NetworkErrorLike
): string | undefined {
  const property = readOwnProperty(value, name);
  return typeof property === "string" ? property : undefined;
}

function readStringOrNumberProperty(
  value: object | null | undefined,
  name: keyof NetworkErrorLike
): string | number | undefined {
  const property = readOwnProperty(value, name);
  return typeof property === "string" || typeof property === "number" ? property : undefined;
}
