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

  switch (networkError?.code) {
    case "ECONNREFUSED":
      return new UserError(
        `Connection refused: ${host}:${getPort(networkError, urlParts)}. Is the server running?`,
        { cause: error }
      );
    case "ETIMEDOUT":
      return new UserError(`Request timed out after ${getTimeoutMs(networkError)}ms: ${redactedUrl}.`, {
        cause: error
      });
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
    if (typeof current.code === "string") {
      return current;
    }

    current = current.cause;
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

    current = current.cause;
  }

  return null;
}

function hasCause(error: Error): boolean {
  return "cause" in error && error.cause !== undefined;
}

function getHost(error: NetworkErrorLike | null, url: URL): string {
  return typeof error?.address === "string" ? error.address : url.hostname;
}

function getPort(error: NetworkErrorLike | null, url: URL): string {
  if (typeof error?.port === "number" || typeof error?.port === "string") {
    return String(error.port);
  }

  if (url.port) {
    return url.port;
  }

  return url.protocol === "https:" ? "443" : "80";
}

function getTimeoutMs(error: NetworkErrorLike): string {
  if (typeof error.ms === "number" || typeof error.ms === "string") {
    return String(error.ms);
  }

  if (typeof error.timeout === "number" || typeof error.timeout === "string") {
    return String(error.timeout);
  }

  return "unknown";
}

function isErrorLikeObject(value: unknown): value is NetworkErrorLike & { name?: unknown } {
  return typeof value === "object" && value !== null;
}
