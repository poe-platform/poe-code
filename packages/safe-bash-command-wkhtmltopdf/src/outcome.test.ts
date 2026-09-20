import assert from "node:assert/strict";
import { test } from "node:test";
import { conversionOutcome } from "./index.js";

test("single conversion errors take precedence over success", () => {
  for (const success of [false, true]) {
    assert.deepEqual(conversionOutcome({ mode: "single", success, errorCode: 404 }), {
      exitCode: 2, diagnostic: { kind: "http", code: 404, description: "Page not found" },
    });
    assert.equal(conversionOutcome({ mode: "single", success, errorCode: 401 }).exitCode, 3);
    assert.deepEqual(conversionOutcome({ mode: "single", success, errorCode: 418 }), {
      exitCode: 1, diagnostic: { kind: "http", code: 418, description: "" },
    });
  }
});

test("network outcomes retain explicit symbolic profile data and enum offset", () => {
  assert.deepEqual(conversionOutcome({ mode: "single", success: true, errorCode: 1003, networkErrorName: "HostNotFoundError" }), {
    exitCode: 1, diagnostic: { kind: "network", code: 3, name: "HostNotFoundError" },
  });
  assert.deepEqual(conversionOutcome({ mode: "single", success: false, errorCode: 1000 }), {
    exitCode: 1, diagnostic: { kind: "network", code: 0, name: null },
  });
});

test("zero-code outcomes distinguish unknown failure and success", () => {
  assert.deepEqual(conversionOutcome({ mode: "single", success: false, errorCode: 0 }), {
    exitCode: 1, diagnostic: { kind: "unknown" },
  });
  assert.deepEqual(conversionOutcome({ mode: "single", success: true, errorCode: 0 }), {
    exitCode: 0, diagnostic: null,
  });
});

test("batch bypasses single-job HTTP statuses and helper diagnostics", () => {
  for (const errorCode of [0, 401, 404, 1003]) {
    for (const success of [false, true]) {
      assert.deepEqual(conversionOutcome({ mode: "batch", success, errorCode }), {
        exitCode: success ? 0 : 1, diagnostic: null,
      });
    }
  }
});

test("outcome admission rejects unchecked codes and unbounded symbolic names", () => {
  for (const errorCode of [-1, 0.5, NaN, Infinity, 2147483648]) {
    assert.throws(() => conversionOutcome({ mode: "single", success: false, errorCode }), { code: "INVALID_VALUE" });
  }
  for (const networkErrorName of ["", "bad\nname", "x".repeat(129), "é"]) {
    assert.throws(() => conversionOutcome({ mode: "single", success: false, errorCode: 1003, networkErrorName }), { code: "INVALID_VALUE" });
  }
});
