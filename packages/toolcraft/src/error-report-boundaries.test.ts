import { describe, expect, it } from "vitest";
import { renderErrorReport } from "./error-report.js";
import { createHttpError, HttpError } from "./http-errors.js";

describe("error-report boundaries", () => {
  it("redacts custom JSON representations in both report sections", () => {
    const body = { toJSON: () => ({ password: "serialized-report-secret", label: "visible" }) };
    const error = new HttpError({
      request: { method: "POST", url: "https://api.example.test/items", headers: {}, body },
      response: { status: 400, statusText: "Bad Request", headers: {}, body: {} }
    });

    const { content } = renderErrorReport({ error, version: "audit", env: {} });

    expect(content).not.toContain("serialized-report-secret");
    expect(content.split('"password": "<redacted>"')).toHaveLength(3);
    expect(content.split('"label": "visible"')).toHaveLength(3);
  });

  it.each([
    ["number", 123456789],
    ["object", { value: "nested-credential" }],
    ["array", ["array-credential", 987654321]],
    ["boolean", true],
    ["null", null]
  ])("redacts %s-valued secrets in both copies of an HTTP body", (_name, secret) => {
    const body = { client_secret: secret, label: "visible" };
    const error = new HttpError({
      request: { method: "POST", url: "https://api.example.test/items", headers: {}, body },
      response: { status: 400, statusText: "Bad Request", headers: {}, body: {} }
    });

    const { content } = renderErrorReport({ error, version: "audit", env: {} });

    expect(content.split('"client_secret": "<redacted>"')).toHaveLength(3);
    expect(content).toContain('"label": "visible"');
    expect(body.client_secret).toBe(secret);
  });

  it.each(["Basic basic-credential", "Digest digest-credential", "opaque-credential"])(
    "does not invent a Bearer scheme for %s",
    (authorization) => {
      const error = new HttpError({
        request: {
          method: "GET",
          url: "https://api.example.test/items",
          headers: { Authorization: authorization, "Proxy-Authorization": authorization }
        },
        response: { status: 400, statusText: "Bad Request", headers: {}, body: {} }
      });

      const { content } = renderErrorReport({ error, version: "audit", env: {} });

      expect(content).toContain("Authorization: ****");
      expect(content).toContain("Proxy-Authorization: ****");
      expect(content).not.toContain("Bearer");
      expect(content).not.toContain(authorization);
    }
  );

  it.each([400, 401, 429, 500, 599])("includes an HTTP transcript for typed status %s", (status) => {
    const error = createHttpError({
      request: { method: "GET", url: "https://api.example.test/items", headers: {} },
      response: { status, statusText: "Audit failure", headers: {}, body: { message: "failed" } }
    });

    const { content } = renderErrorReport({ error, version: "audit", env: {} });

    expect(content).toContain(`name: ${error.name}`);
    expect(content).toContain("\nHTTP Transcript\n");
    expect(content).toContain(`Response:\n${status} Audit failure`);
  });

  it("recognizes compatible typed HTTP errors without requiring a local class identity", () => {
    const error = Object.assign(new Error("request failed"), {
      name: "RateLimitError",
      request: { method: "GET", url: "https://api.example.test/items", headers: {} },
      response: { status: 429, statusText: "Too Many Requests", headers: {}, body: {} }
    });

    const { content } = renderErrorReport({ error, version: "audit", env: {} });

    expect(content).toContain("\nHTTP Transcript\n");
    expect(content).toContain("Response:\n429 Too Many Requests");
  });

  it("terminates cyclic structured fields while preserving repeated non-circular references", () => {
    const shared = { label: "visible", password: { value: "nested-credential" } };
    const details: Record<string, unknown> = { first: shared, second: shared };
    details.self = details;
    const error = Object.assign(new Error("failure"), { details });

    const { content } = renderErrorReport({ error, version: "audit", env: {} });

    expect(content).toContain('"self": "[Circular]"');
    expect(content.split('"label": "visible"')).toHaveLength(3);
    expect(content.split('"password": "<redacted>"')).toHaveLength(3);
    expect(content).not.toContain("nested-credential");
    expect(details.self).toBe(details);
    expect(shared.password.value).toBe("nested-credential");
  });

  it("terminates cyclic arrays in structured error fields", () => {
    const details: unknown[] = ["visible"];
    details.push(details);
    const error = Object.assign(new Error("failure"), { details });

    const { content } = renderErrorReport({ error, version: "audit", env: {} });

    expect(content).toContain('"visible"');
    expect(content).toContain('"[Circular]"');
    expect(details[1]).toBe(details);
  });

  it("stops a repeated cause without re-reading its cause property", () => {
    const error = new Error("failure");
    error.stack = "Error: failure\n    at audit";
    let reads = 0;
    Object.defineProperty(error, "cause", {
      get() {
        reads += 1;
        if (reads > 2) throw new Error("bounded probe detected repeated cause traversal");
        return error;
      }
    });

    const { content } = renderErrorReport({ error, version: "audit", env: {} });

    expect(content).toContain("Caused by: [Circular]");
    expect(content.split("at audit")).toHaveLength(2);
    expect(reads).toBe(1);
  });
});
