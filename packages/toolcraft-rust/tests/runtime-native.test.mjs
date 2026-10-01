import { test } from "node:test";
import assert from "node:assert/strict";
import { tsImport } from "tsx/esm/api";
import * as native from "../dist/index.js";

const reference = {
  ...(await tsImport("../../toolcraft/src/suggest.ts", import.meta.url)),
  ...(await tsImport("../../toolcraft/src/runtime-logging.ts", import.meta.url)),
  ...(await tsImport("../../toolcraft/src/http-errors.ts", import.meta.url)),
  ...(await tsImport("../../toolcraft/src/user-error.ts", import.meta.url))
};

test("suggestions preserve UTF-16, locale ordering, duplicates and slice options", () => {
  const inputs = ["", "namee", "CA", "🦀", "\ud800", "a\0", "Résumé", "POE_API_KEY"];
  const candidates = [
    "name",
    "names",
    "named",
    "NAME",
    "name",
    "ABC",
    "🦀",
    "\ud801",
    "a",
    "á",
    "A",
    "résumé",
    "POE_KEY",
    "POE_APIKEY"
  ];
  for (const input of inputs)
    for (const max of [undefined, 0, 1, 3, -1, 1.5, NaN, Infinity])
      for (const threshold of [undefined, 0, 1, 4, Infinity, NaN]) {
        assert.deepEqual(
          native.suggest(input, candidates, { max, threshold }),
          reference.suggest(input, candidates, { max, threshold })
        );
      }
  const words = [""];
  for (let length = 1; length <= 3; length++) {
    for (const word of words.filter((word) => word.length === length - 1)) {
      for (const unit of ["a", "b", "\ud800"]) words.push(word + unit);
    }
  }
  for (const input of words)
    assert.deepEqual(
      native.suggest(input, words, { max: Infinity, threshold: Infinity }),
      reference.suggest(input, words, { max: Infinity, threshold: Infinity })
    );
});

test("loggers preserve event identity, sink receiver, default level and exception identity", () => {
  const levels = ["silent", "error", "warn", "info", "debug", "trace", "unknown"];
  for (const event of levels)
    for (const configured of levels) {
      assert.equal(
        native.shouldEmitDiagnostic(event, configured),
        reference.shouldEmitDiagnostic(event, configured)
      );
      assert.equal(native.isLogLevel(event), reference.isLogLevel(event));
    }
  for (const implementation of [native, reference]) {
    const event = { level: "warn", message: "retry", data: { arbitrary: 1n } };
    const events = [];
    const sink = {
      level: "silent",
      emit(value) {
        assert.equal(this, sink);
        events.push(value);
      }
    };
    const logger = implementation.createRuntimeLogger({ logger: sink });
    assert.equal(logger.level, "warn");
    logger.emit(event);
    assert.equal(events[0], event);
    logger.level = "silent";
    logger.emit(event);
    assert.equal(events.length, 2);
    const failure = new Error("sink failure");
    assert.throws(
      () =>
        implementation
          .createRuntimeLogger({
            logger() {
              throw failure;
            }
          })
          .emit(event),
      (error) => error === failure
    );
  }
});

test("suggestions preserve sparse candidates and read each candidate once", () => {
  const sparse = new Array(3);
  sparse[1] = "token";
  assert.deepEqual(native.suggest("toke", sparse), reference.suggest("toke", sparse));
  const run = (implementation) => {
    let reads = 0;
    const candidates = ["name"];
    Object.defineProperty(candidates, 0, {
      get() {
        reads++;
        return "name";
      }
    });
    return { result: implementation.suggest("namee", candidates), reads };
  };
  assert.deepEqual(run(native), run(reference));
});

test("HTTP status taxonomy and own property descriptors match the reference", () => {
  const request = { method: "GET", url: "https://example.test/🦀\ud800", headers: {} };
  const statuses = [
    200,
    400,
    401,
    403,
    404,
    409,
    422,
    429,
    499,
    500,
    503,
    599,
    400.5,
    NaN,
    Infinity
  ];
  for (const status of statuses)
    for (const message of [undefined, "", "override\ud800"]) {
      const response = { status, statusText: "status", headers: {}, body: { value: 1n } };
      const args = { request, response, message, code: "CODE", requestId: "id" };
      const actual = native.createHttpError(args),
        expected = reference.createHttpError(args);
      assert.equal(actual.constructor.name, expected.constructor.name);
      assert.equal(actual.name, expected.name);
      assert.equal(actual.body, response.body);
      assert.ok(actual instanceof native.HttpError);
      assert.deepEqual(Reflect.ownKeys(actual), Reflect.ownKeys(expected));
      for (const key of Reflect.ownKeys(expected).filter((key) => key !== "stack")) {
        assert.deepEqual(
          Object.getOwnPropertyDescriptor(actual, key),
          Object.getOwnPropertyDescriptor(expected, key)
        );
      }
      for (const name of ["ClientError", "ServerError"])
        assert.equal(actual instanceof native[name], expected instanceof reference[name]);
    }
  const custom = new (class CustomError extends native.HttpError {})({
    request,
    response: { status: 418, statusText: "tea", headers: {}, body: null }
  });
  assert.equal(custom.name, "CustomError");
});

test("Toolcraft errors preserve causes, bundle recognition and renamed local instances", () => {
  const cause = {};
  cause.self = cause;
  for (const name of ["UserError", "ToolcraftBugError"]) {
    const actual = new native[name]("message\ud800", { cause });
    const expected = new reference[name]("message\ud800", { cause });
    for (const key of Reflect.ownKeys(expected).filter((key) => key !== "stack"))
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(actual, key),
        Object.getOwnPropertyDescriptor(expected, key)
      );
  }
  const own = new native.UserError("message");
  own.name = "renamed";
  assert.equal(native.isUserError(own), true);
  assert.equal(native.isUserError(new reference.UserError("foreign")), true);
  assert.equal(reference.isUserError(new native.UserError("foreign")), true);
  assert.equal(native.isUserError({ name: "UserError" }), false);
  assert.equal(native.isUserError(null), false);
});
