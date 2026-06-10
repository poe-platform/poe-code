export function isHarnessSpawnResultRetryable(result: {
  exitCode: number;
  stderr: string;
  summary: string;
}): boolean {
  return (
    (result.exitCode === 1 ||
      result.exitCode === 124 ||
      result.exitCode === 125 ||
      result.exitCode === 137) &&
    isHarnessSpawnErrorRetryable({ message: result.stderr || result.summary })
  );
}

export function isHarnessSpawnErrorRetryable(error: unknown): boolean {
  const message = formatUnknownError(error);
  const normalized = message.toLowerCase();
  return !(
    message.startsWith("Unknown service ") ||
    message.startsWith("Unknown agent ") ||
    isPermanentCredentialError(message) ||
    message.startsWith("spawnAgent must ") ||
    message.startsWith("spawnAgent result ") ||
    message.includes(" does not support spawn.") ||
    message.includes(" does not support ACP spawn.") ||
    message.includes(" does not support MCP servers over ACP spawn.") ||
    message.includes(" does not support CLI spawn.") ||
    message.includes(" has no spawn config.") ||
    message.includes(" has no binaryName.") ||
    message.includes(" spawn requires an active configured provider.") ||
    message.endsWith(" CLI binary not found on PATH.") ||
    normalized.startsWith("unauthorized") ||
    normalized.startsWith("forbidden") ||
    normalized.includes("http 401") ||
    normalized.includes("http 403") ||
    normalized.includes("authentication failed") ||
    normalized.includes("invalid api key") ||
    message.includes(" cannot configure agent ") ||
    message.startsWith("Cannot resolve ") ||
    message.startsWith("Unsupported isolated environment value.")
  );
}

function isPermanentCredentialError(message: string): boolean {
  const normalized = message.toLowerCase();
  if (!normalized.includes("api key")) {
    return false;
  }
  return [
    "cannot be empty",
    "expired",
    "invalid expiration",
    "is missing",
    "missing ",
    "no api key",
    "not available",
    "not found",
    "rejected"
  ].some((marker) => normalized.includes(marker));
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
