import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/tool-results.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../poe-agent/src/runtime/tool-results.ts", import.meta.url);
test("structured results preserve identity, sparse arrays and host serialization", () => {
  const text = { type: "text", text: "t\ud800" },
    image = { type: "image", mimeType: "image/x", data: "AA==" },
    error = { type: "error", code: "e", message: "x", retriable: false };
  const cases = [
    undefined,
    null,
    false,
    0,
    1n,
    Symbol("s"),
    () => {},
    "raw",
    text,
    image,
    error,
    [],
    [text, image, error],
    new Array(3),
    { type: "image", mimeType: "x" },
    {
      toJSON() {
        return "owned";
      }
    },
    {
      toJSON() {
        throw null;
      },
      toString() {
        return "fallback";
      }
    }
  ];
  const cyclic = {};
  cyclic.self = cyclic;
  cases.push(cyclic);
  for (const value of cases) {
    for (const name of [
      "isToolResultPart",
      "getStructuredToolResultParts",
      "normalizeToolResult"
    ]) {
      assert.deepEqual(own[name](value), original[name](value));
    }
    for (const api of [original, own]) {
      if (value === text || value === image || value === error || Array.isArray(value)) {
        assert.equal(api.normalizeToolResult(value), value);
      }
    }
  }
  for (const value of [text, image, error, [text, image, error], "raw", undefined])
    assert.deepEqual(own.toToolMessageContent(value), original.toToolMessageContent(value));
  for (const value of [text, image, error])
    assert.equal(own.toolResultPartToText(value), original.toolResultPartToText(value));
  assert.equal(
    own.estimateMessageContentSize([text, image, error]),
    original.estimateMessageContentSize([text, image, error])
  );
});
test("part getter ordering, changing types and arbitrary exceptions remain exact", () => {
  for (const api of [original, own]) {
    const trace = [];
    let reads = 0;
    const part = {
      get type() {
        trace.push("type");
        return ["image", "other", "image"][reads++] ?? "error";
      },
      get mimeType() {
        trace.push("mime");
        return "x";
      },
      get data() {
        trace.push("data");
        return "d";
      }
    };
    assert.equal(api.isToolResultPart(part), true);
    assert.deepEqual(trace, ["type", "type", "type", "mime", "data"]);
    for (const reason of [undefined, null, false, Symbol("getter")]) {
      const value = {
        get type() {
          throw reason;
        }
      };
      assert.throws(
        () => api.isToolResultPart(value),
        (error) => error === reason
      );
    }
    assert.equal(api.isToolResultPart({ type: "x".repeat(32768) }), false);
    const skipped = {
      type: "image",
      mimeType: 1,
      get data() {
        throw Error("must not read");
      }
    };
    assert.equal(api.isToolResultPart(skipped), false);
    const serial = {
      toJSON() {
        return undefined;
      }
    };
    assert.equal(api.normalizeToolResult(serial), undefined);
    assert.throws(() => api.toToolMessageContent(serial), TypeError);
  }
});
