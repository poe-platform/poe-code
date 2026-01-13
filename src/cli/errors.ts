import type { ErrorContext } from "./error-logger.js";

/**
 * Base error class for all CLI errors with context support
 */
export class CliError extends Error {
  public readonly context?: ErrorContext;
  public readonly isUserError: boolean;

  constructor(
    message: string,
    context?: ErrorContext,
    options?: { isUserError?: boolean }
  ) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.isUserError = options?.isUserError ?? false;

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error used purely for control flow: exits the CLI silently with code 0.
 */
export class SilentError extends CliError {
  constructor(message = "", options?: { isUserError?: boolean }) {
    super(message, undefined, { isUserError: options?.isUserError ?? false });
  }
}

/**
 * API-related errors (network, HTTP status, API responses)
 */
export class ApiError extends CliError {
  public readonly httpStatus?: number;
  public readonly endpoint?: string;

  constructor(
    message: string,
    options?: {
      httpStatus?: number;
      endpoint?: string;
      context?: ErrorContext;
    }
  ) {
    super(message, {
      ...options?.context,
      httpStatus: options?.httpStatus,
      apiEndpoint: options?.endpoint
    });
    this.httpStatus = options?.httpStatus;
    this.endpoint = options?.endpoint;
  }
}

/**
 * Configuration and validation errors (user input, config files)
 */
export class ValidationError extends CliError {
  constructor(message: string, context?: ErrorContext) {
    super(message, context, { isUserError: true });
  }
}

/**
 * File system operation errors
 */
export class FileSystemError extends CliError {
  public readonly filePath?: string;
  public readonly operation?: string;

  constructor(
    message: string,
    options?: {
      filePath?: string;
      operation?: string;
      context?: ErrorContext;
    }
  ) {
    super(message, {
      ...options?.context,
      filePath: options?.filePath,
      operation: options?.operation
    });
    this.filePath = options?.filePath;
    this.operation = options?.operation;
  }
}

/**
 * Authentication and credential errors
 */
export class AuthenticationError extends CliError {
  constructor(message: string, context?: ErrorContext) {
    super(message, context, { isUserError: true });
  }
}

/**
 * Command execution errors
 */
export class CommandExecutionError extends CliError {
  public readonly command?: string;
  public readonly exitCode?: number;

  constructor(
    message: string,
    options?: {
      command?: string;
      exitCode?: number;
      context?: ErrorContext;
    }
  ) {
    super(message, {
      ...options?.context,
      command: options?.command,
      exitCode: options?.exitCode
    });
    this.command = options?.command;
    this.exitCode = options?.exitCode;
  }
}

/**
 * Service provider errors (MCP, Codex, etc.)
 */
export class ServiceError extends CliError {
  public readonly service?: string;

  constructor(
    message: string,
    options?: {
      service?: string;
      context?: ErrorContext;
    }
  ) {
    super(message, {
      ...options?.context,
      service: options?.service
    });
    this.service = options?.service;
  }
}

/**
 * Graceful cancellation triggered by the user (Ctrl+C, escape, etc.)
 */
export class OperationCancelledError extends SilentError {
  constructor(message = "Operation cancelled.") {
    super(message, { isUserError: true });
  }
}

/**
 * Helper to determine if an error should be shown to users
 */
export function isUserFacingError(error: unknown): boolean {
  return error instanceof CliError && error.isUserError;
}

/**
 * Helper to extract error context from any error
 */
export function extractErrorContext(error: unknown): ErrorContext | undefined {
  if (error instanceof CliError) {
    return error.context;
  }
  return undefined;
}

/**
 * Helper to create a standardized error message with context
 */
export function formatErrorWithContext(
  error: Error,
  context?: ErrorContext
): string {
  const parts = [error.message];

  if (context) {
    if (context.operation) {
      parts.push(`Operation: ${context.operation}`);
    }
    if (context.component) {
      parts.push(`Component: ${context.component}`);
    }
  }

  return parts.join(" | ");
}
