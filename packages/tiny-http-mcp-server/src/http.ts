export interface HttpServerOptions {
  basePath?: string;
}

export interface HttpHandler {
  (request: unknown, response: unknown): Promise<void> | void;
}

export class HttpTransportNotImplementedError extends Error {
  constructor() {
    super("HTTP transport is not implemented yet.");
    this.name = "HttpTransportNotImplementedError";
  }
}

export function createHttpHandler(_options: HttpServerOptions = {}): HttpHandler {
  throw new HttpTransportNotImplementedError();
}

export function createHttpServer(_options: HttpServerOptions = {}): never {
  throw new HttpTransportNotImplementedError();
}
