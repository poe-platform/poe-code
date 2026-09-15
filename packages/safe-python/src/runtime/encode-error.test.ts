import {expect, it} from "vitest";
import {CodePointString} from "./code-point-string.js";
import {PythonEncodeError} from "./encode-error.js";

it("retains the caught encoding fault as explicit context", () => {
  const input = new CodePointString(Uint32Array.of(0xe9));
  const context = new PythonEncodeError("ascii", input, 0, 1, "ordinal not in range(128)");
  const error = new PythonEncodeError("idna", input, 0, 1, "Invalid character in IDN label", undefined, {context});
  expect(error.chaining?.context).toBe(context);
  expect(error.chaining?.suppressContext).toBeUndefined();
});

it.each([[], [0x61], [0x1f600]].map(points => ({points})))("retains invalid encoder spans without indexing the string: $points", ({points}) => {
  const input = new CodePointString(Uint32Array.from(points));
  for (const [start, end] of [[1, 2], [-1, 0], [-2, -1], [2, 3], [0, 0], [1, 0], ...points.length === 0 ? [[0, 1]] : []]) {
    const error = new PythonEncodeError("idna", input, start, end, "reason");
    expect(error.message).toBe(`'idna' codec can't encode characters in position ${start}-${end - 1}: reason`);
    expect(error.object).toBe(input);
    expect([error.start, error.end]).toEqual([start, end]);
  }
});

it.each([[0x61, "x61"], [0x100, "u0100"], [0xd800, "ud800"], [0x1f600, "U0001f600"]] as const)("formats valid scalar and surrogate spans: %i", (point, escaped) => {
  const error = new PythonEncodeError("idna", new CodePointString(Uint32Array.of(point)), 0, 1, "reason");
  expect(error.message).toBe(`'idna' codec can't encode character '\\${escaped}' in position 0: reason`);
});
