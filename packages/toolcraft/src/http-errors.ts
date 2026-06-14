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

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly code?: string;
  readonly requestId?: string;
  readonly request: HttpErrorRequest;
  readonly response: HttpErrorResponse;

  get body(): unknown {
    return this.response.body;
  }

  constructor(args: {
    request: HttpErrorRequest;
    response: HttpErrorResponse;
    code?: string;
    requestId?: string;
    message?: string;
  }) {
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

export function createHttpError(args: {
  request: HttpErrorRequest;
  response: HttpErrorResponse;
  code?: string;
  requestId?: string;
  message?: string;
}): HttpError {
  const ErrorClass = getHttpErrorClass(args.response.status);
  return new ErrorClass(args);
}

function getHttpErrorClass(status: number): typeof HttpError {
  switch (status) {
    case 400:
      return BadRequestError;
    case 401:
      return AuthenticationError;
    case 403:
      return PermissionDeniedError;
    case 404:
      return NotFoundError;
    case 409:
      return ConflictError;
    case 422:
      return UnprocessableEntityError;
    case 429:
      return RateLimitError;
    case 500:
      return InternalServerError;
    case 503:
      return ServiceUnavailableError;
    default:
      return status >= 400 && status < 500 ? ClientError : status >= 500 ? ServerError : HttpError;
  }
}
