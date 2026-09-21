import assert from "node:assert/strict";
import { test } from "node:test";
import * as own from "../dist/index.js";
import * as original from "../../toolcraft-design/dist/index.js";
import { plainTerminalText as ownPlain } from "../dist/terminal.js";
import { plainTerminalText as originalPlain } from "../../toolcraft-design/dist/dashboard/ansi.js";
test("visible terminal rows preserve cursor effects, C1 controls and nonfinite SGR parsing", () => {
  for (const value of [
    "a\rZ",
    "abc\bX",
    "abc\x1b[1Kz",
    "abc\r\x1b[2Kz",
    "界\bX",
    "visible\x1b[8msecret\x1b[28mafter",
    "visible\x1b[8msecret\x1b[" + "9".repeat(400) + "mafter",
    "a\x85b",
    "a\t\x1b[31m界\tX",
    "a\x1b[38:2::8:9:10mx",
    "a\x9b8mhidden\x9b0mb"
  ]) {
    assert.equal(ownPlain(value), originalPlain(value), value);
  }
});
test("checklist formatting preserves focused previews and complete sanitized details", () => {
  for (const count of [0, 1, 5, 8, 12])
    for (const focus of [-1, 0, 7])
      for (const content of [
        "Step",
        "界".repeat(60),
        "👩‍💻".repeat(70),
        "old\rnew\x1b[K\n  ✓ fake\x1b]hidden\x07",
        "a\t".repeat(60),
        "\ud800".repeat(120)
      ]) {
        const entries = Array.from({ length: count }, (_, index) => ({
          status: index < focus ? "completed" : index === focus ? "in_progress" : "pending",
          content: content + index
        }));
        assert.deepEqual(own.acp.formatAgentPlan(entries), original.acp.formatAgentPlan(entries));
      }
});
test("writer context retains callback identity through async work and format scopes", async () => {
  for (const api of [own, original]) {
    const lines = [],
      writer = (line) => lines.push(line),
      entries = [{ content: "Check", status: "pending" }];
    await api.acp.withAcpWriter(writer, async () => {
      await Promise.resolve();
      assert.equal(api.acp.getAcpWriter(), writer);
      for (const format of ["terminal", "markdown", "json"])
        api.withOutputFormat(format, () => api.acp.renderAgentPlan(entries));
    });
    assert.equal(lines.length, 3);
    assert.deepEqual(JSON.parse(lines[2]), { event: "plan", entries });
  }
});
test("plan getters observe reference ordering and preserve thrown error identity", () => {
  const observe = (api) => {
    const reads = [],
      entries = Array.from({ length: 6 }, (_, i) => ({
        get status() {
          reads.push("s" + i);
          return i === 2 ? "in_progress" : "pending";
        },
        get content() {
          reads.push("c" + i);
          return "Step " + i;
        }
      }));
    return { value: api.acp.formatAgentPlan(entries), reads };
  };
  assert.deepEqual(observe(own), observe(original));
  const marker = new Error("receiver");
  for (const api of [own, original])
    assert.throws(
      () =>
        api.acp.formatAgentPlan([
          {
            status: "pending",
            get content() {
              throw marker;
            }
          }
        ]),
      (error) => error === marker
    );
});
