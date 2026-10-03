import { expect, it } from "vitest";
import { cosDict, cosName, cosString } from "../ast.js";
import { parseContentSteps } from "./parser.js";

it("emits group boundaries and text fragments without collecting group children", () => {
  const work = parseContentSteps();
  expect(work.next().value).toEqual({ kind: "operator" });
  const group = work.next({ operator: "q", operands: [] }).value;
  expect(group).toMatchObject({ kind: "event", event: { kind: "begin-group", group: { kind: "graphics-group", ops: [] } } });
  expect(work.next().value).toEqual({ kind: "operator" });
  expect(work.next({ operator: "BT", operands: [] }).value).toEqual({ kind: "operator" });
  for (let i = 0; i < 1000; i++) {
    const event = work.next({ operator: "Tj", operands: [cosString("A")] }).value;
    expect(event).toMatchObject({ kind: "event", event: { kind: "text-object", commands: [{ kind: "show-text" }], end: false } });
    expect(work.next().value).toEqual({ kind: "operator" });
  }
  expect(group).toMatchObject({ event: { group: { ops: [] } } });
  work.return();
});

it("suspends for inline-image bytes and resumes normal operator input", async () => {
  const work = parseContentSteps(); work.next();
  expect(work.next({ operator: "BI", operands: [], inlineImage: { dict: cosDict({ CS: cosName("G") }), start: 10, end: 12 } }).value).toEqual({ kind: "inline-image", start: 10, end: 12 });
  await Promise.resolve(); const data = new Uint8Array([1, 2]);
  expect(work.next(data).value).toMatchObject({ kind: "event", event: { kind: "inline-image", data } });
  expect(work.next().value).toEqual({ kind: "operator" });
  expect(work.next(undefined).done).toBe(true);
});
