import assert from "node:assert/strict";
import { test } from "node:test";
import * as own from "../dist/index.js";
import * as original from "../../toolcraft-design/dist/index.js";
function capture(api, format, operation) {
  const lines = [];
  api.acp.withAcpWriter(
    (line) => lines.push(line),
    () => api.withOutputFormat(format, () => operation(api.acp))
  );
  return lines;
}
test("tool, reasoning, permission, error and usage events match reference in every format", () => {
  const saved = process.env.FORCE_COLOR;
  process.env.FORCE_COLOR = "1";
  try {
    for (const format of ["terminal", "markdown", "json"])
      for (const kind of [
        "exec",
        "edit",
        "read",
        "search",
        "think",
        "other",
        "toString",
        "__proto__",
        "🌍"
      ])
        for (const text of [
          "simple",
          "x".repeat(200),
          "🌍".repeat(100),
          "\ud800",
          "a\n\x1b[31mb"
        ]) {
          const operation = (api) => {
            api.renderToolStart(kind, text);
            api.renderToolComplete(kind);
            api.renderReasoning(text);
            api.renderError(text);
            api.renderPermissionRejected(text);
            api.renderUsage({ input: 1500, output: 350, cached: 800, costUsd: 0.12345678 });
          };
          assert.deepEqual(capture(own, format, operation), capture(original, format, operation));
        }
  } finally {
    if (saved === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = saved;
  }
});
test("usage retains lazy private receiver reads and original exception identity", () => {
  for (const format of ["terminal", "markdown", "json"]) {
    const observe = (api) => {
      const reads = [];
      class Usage {
        #n = 0;
        get input() {
          reads.push("input");
          return 1500;
        }
        get output() {
          reads.push("output");
          return 350;
        }
        get cached() {
          reads.push("cached");
          return ++this.#n;
        }
        get costUsd() {
          reads.push("cost");
          return 0.12345678;
        }
      }
      return { lines: capture(api, format, (a) => a.renderUsage(new Usage())), reads };
    };
    assert.deepEqual(observe(own), observe(original));
  }
  const reason = { error: true };
  for (const api of [own, original])
    assert.throws(
      () =>
        capture(api, "terminal", (a) =>
          a.renderUsage({
            input: 1,
            output: 1,
            get cached() {
              throw reason;
            }
          })
        ),
      (error) => error === reason
    );
});
test("usage preserves finite, negative, nullish and nonfinite number formatting", () => {
  for (const format of ["terminal", "markdown", "json"])
    for (const costUsd of [undefined, null, NaN, Infinity, -Infinity, 0, -0, -1234.56789123])
      for (const cached of [undefined, null, NaN, Infinity, -1, 0, 200]) {
        const value = { input: NaN, output: Infinity, cached, costUsd };
        assert.deepEqual(
          capture(own, format, (a) => a.renderUsage(value)),
          capture(original, format, (a) => a.renderUsage(value))
        );
      }
});
