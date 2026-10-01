import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/api-error-summary.js";
import * as reference from "../../toolcraft/dist/api-error-summary.js";

function error(body, status = 422, headers = {}) {
  return { name: "HttpError", message: "fallback", request: { method: "POST", url: "https://example.test", headers: {} }, response: { status, statusText: "Failed", headers, body } };
}

test("HTTP summaries preserve REST and GraphQL precedence, redaction and nested field paths", () => {
  for (const body of [undefined, null, "raw", '{"message":"JSON message"}', [], {},
    { message: "", detail: "detail", error_code: "code", requestId: "body-id" },
    { message: "outer", code: "outer-code", errors: [{ message: "graphql", extensions: { code: "GQL" } }] },
    { field_errors: { nested: ["first", "second"], token: "private", mixed: [0, { leaf: "bad" }] }, non_field_errors: "general" },
    { errors: Array(3), request_id: "body-id", error_description: "description" }]) {
    for (const status of [200, 401, 403, 429, 503, NaN]) {
      for (const headers of [{}, { "X-Request-ID": "header-id", "Retry-After": "0" }, { "retry-after": "", "x-request-id": "" }]) {
        const value = error(body, status, headers);
        assert.deepEqual(native.summarizeHttpError(value), reference.summarizeHttpError(value));
        for (const report of [undefined, null, "report.json"]) assert.deepEqual(native.createHttpErrorEnvelope(value, report), reference.createHttpErrorEnvelope(value, report));
      }
    }
  }
});

test("HTTP shape recognition retains own body requirements, loose object prototypes and numeric semantics", () => {
  for (const value of [undefined, null, false, 0, [], {}, () => {}, error(undefined), error(null, NaN),
    { ...error(null), response: Object.create({ status: 400, statusText: "", headers: {}, body: null }) },
    { ...error(null), request: { method: "GET", url: "url", headers: { number: 1 } } }]) {
    assert.equal(native.isHttpErrorLike(value), reference.isHttpErrorLike(value));
  }
});

test("HTTP summary and recognition preserve getter order and thrown identity", () => {
  for (const operation of ["isHttpErrorLike", "summarizeHttpError", "createHttpErrorEnvelope"]) {
    const run = lib => {
      const reads = [];
      const observe = (value, prefix) => new Proxy(value, { get(target, key, receiver) { reads.push(`${prefix}.${String(key)}`); return Reflect.get(target, key, receiver); } });
      const value = error({ errors: [{ message: "gql", extensions: { code: "CODE" } }] }, 503, { "Retry-After": "3" });
      value.request = observe(value.request, "request");
      value.response = observe(value.response, "response");
      return { value: lib[operation](observe(value, "error")), reads };
    };
    assert.deepEqual(run(native), run(reference));
    for (const failure of [undefined, null, false, Symbol("failure"), { failure: true }]) {
      for (const lib of [native, reference]) {
        const value = error(null);
        Object.defineProperty(value, "response", { get() { throw failure; } });
        assert.throws(() => lib[operation](value), thrown => thrown === failure);
      }
    }
  }
});
