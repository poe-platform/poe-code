import { describe, expect, it } from "vitest";
import { createHttpErrorEnvelope, summarizeHttpError, type HttpErrorLike } from "./api-error-summary.js";

function createError(overrides: Partial<HttpErrorLike> = {}): HttpErrorLike {
  return {
    name: "HttpError",
    message: "POST https://api.example.com/items -> 422 Unprocessable Entity",
    request: {
      method: "POST",
      url: "https://api.example.com/items",
      headers: { authorization: "Bearer secret" },
      body: { api_key: "secret" }
    },
    response: {
      status: 422,
      statusText: "Unprocessable Entity",
      headers: { "x-request-id": "req_123" },
      body: {
        error: "invalid_rows",
        message: "Rows are invalid.",
        field_errors: {
          "rows.0.kind": "Expected prompt or completion."
        }
      }
    },
    ...overrides
  };
}

describe("summarizeHttpError", () => {
  it("extracts common REST fields and nested field errors", () => {
    expect(summarizeHttpError(createError())).toMatchObject({
      status: 422,
      statusText: "Unprocessable Entity",
      requestMethod: "POST",
      requestUrl: "https://api.example.com/items",
      requestId: "req_123",
      code: "invalid_rows",
      message: "Rows are invalid.",
      fieldErrors: [{ path: "rows.0.kind", message: "Expected prompt or completion." }]
    });
  });

  it("extracts GraphQL message and code", () => {
    expect(
      summarizeHttpError(
        createError({
          response: {
            status: 401,
            statusText: "Unauthorized",
            headers: {},
            body: {
              errors: [
                {
                  message: "Unauthorized",
                  extensions: { code: "UNAUTHENTICATED" }
                }
              ]
            }
          }
        })
      )
    ).toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Unauthorized",
      hint: "Check the configured API credentials and permissions."
    });
  });

  it("adds retry guidance and redacts envelope bodies structurally", () => {
    const envelope = createHttpErrorEnvelope(
      createError({
        response: {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "retry-after": "30" },
          body: { message: "Slow down", request_id: "req_retry" }
        }
      }),
      "toolcraft-error.json"
    );

    expect(envelope).toMatchObject({
      kind: "http",
      message: "Slow down",
      requestId: "req_retry",
      retryAfter: "30",
      hint: "Retry after 30.",
      reportPath: "toolcraft-error.json"
    });
    expect(JSON.stringify(envelope)).not.toContain("secret");
  });
});
