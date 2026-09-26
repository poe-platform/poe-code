import { expect, it, vi } from "vitest";
import { markerGeometry } from "./marker.js";

it("scales square geometry around the marker center using native cap/join/width", () => {
  expect(markerGeometry("SQUARE", 5, 10, 20, 2)).toEqual({
    shape: "square", closed: true, lineCap: "square", lineJoin: "miter", strokeWidth: 1,
    outline: [["M", 5, 15], ["L", 5, 25], ["L", 15, 25], ["L", 15, 15], ["Z"]],
    fill: [["M", 5, 15], ["L", 5, 25], ["L", 15, 25], ["L", 15, 15], ["Z"]]
  });
});
it("uses a square fill independently of open crossed outline geometry", () => {
  const x = markerGeometry("x", 2, 0, 0, 1);
  expect(x.closed).toBe(false);
  expect(x.outline).toEqual([["M", 1, 1], ["L", -1, -1], ["M", 1, -1], ["L", -1, 1]]);
  expect(x.fill).toEqual(markerGeometry("square", 2, 0, 0, 1).fill);
});
it("uses the pinned circle cubic control value 0.56", () => {
  const circle = markerGeometry("circle", 2, 0, 0, 1);
  expect(circle.outline).toEqual([
    ["M", 1, 0], ["C", 1, 0.56, 0.56, 1, 0, 1], ["C", -0.56, 1, -1, 0.56, -1, 0],
    ["C", -1, -0.56, -0.56, -1, 0, -1], ["C", 0.56, -1, 1, -0.56, 1, 0], ["L", 1, 0], ["Z"]
  ]);
});
it.each(["none", "square", "diamond", "triangle-down", "triangle-up", "triangle-right", "triangle-left", "circle", "x", "cross", "asterisk", "bar", "half-bar", "butterfly", "hourglass", "lefthalf-bar"])("retains native marker name %s", shape => {
  expect(markerGeometry(shape, 5, 0, 0, 1).shape).toBe(shape);
});
it("does not invent an alias and returns owned geometry for separate calls", () => {
  expect(markerGeometry("left-half-bar", 5, 0, 0, 1).shape).toBe("none");
  expect(markerGeometry("unknown", 5, 0, 0, 1).outline).toEqual([]);
  const first = markerGeometry("square", 2, 0, 0, 1);
  (first.outline as unknown as unknown[][])[0]![1] = 99;
  expect(markerGeometry("square", 2, 0, 0, 1).outline[0]).toEqual(["M", -1, -1]);
  expect(first.fill[0]).toEqual(["M", -1, -1]);
});
it("bounds shape-name processing by the finite native name inventory", () => {
  const iterator = String.prototype[Symbol.iterator];
  let visited = 0;
  const spy = vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function* (this: string): Generator<string, undefined, unknown> {
    for (const character of iterator.call(this)) { visited++; yield character; }
    return undefined;
  });
  try {
    expect(markerGeometry("invalid".repeat(1000), 2, 0, 0, 1).shape).toBe("none");
    expect(visited).toBeLessThanOrEqual(14 * 16);
  } finally { spy.mockRestore(); }
});
it.each([
  ["none", ""],
  ["square", "M,-1,-1 L,-1,1 L,1,1 L,1,-1 Z"],
  ["diamond", "M,0,-1 L,1,0 L,0,1 L,-1,0 Z"],
  ["triangle-down", "M,-1,-1 L,1,-1 L,0,1 Z"],
  ["triangle-up", "M,0,-1 L,1,1 L,-1,1 Z"],
  ["triangle-right", "M,-1,-1 L,1,0 L,-1,1 Z"],
  ["triangle-left", "M,1,-1 L,-1,0 L,1,1 Z"],
  ["circle", "M,1,0 C,1,0.56,0.56,1,0,1 C,-0.56,1,-1,0.56,-1,0 C,-1,-0.56,-0.56,-1,0,-1 C,0.56,-1,1,-0.56,1,0 L,1,0 Z"],
  ["x", "M,1,1 L,-1,-1 M,1,-1 L,-1,1"],
  ["cross", "M,1,0 L,-1,0 M,0,1 L,0,-1"],
  ["asterisk", "M,0.7,0.7 L,-0.7,-0.7 M,0.7,-0.7 L,-0.7,0.7 M,1,0 L,-1,0 M,0,1 L,0,-1"],
  ["bar", "M,-1,-0.2 L,1,-0.2 L,1,0.2 L,-1,0.2 Z"],
  ["half-bar", "M,0,-0.2 L,1,-0.2 L,1,0.2 L,0,0.2 Z"],
  ["butterfly", "M,-1,-1 L,-1,1 L,0,0 L,1,1 L,1,-1 L,0,0 Z"],
  ["hourglass", "M,-1,-1 L,1,-1 L,0,0 L,1,1 L,-1,1 L,0,0 Z"],
  ["lefthalf-bar", "M,0,-0.2 L,-1,-0.2 L,-1,0.2 L,0,0.2 Z"]
])("matches the pinned normalized %s path including controls and subpaths", (name, expected) => {
  const geometry = markerGeometry(name, 2, 0, 0, 1);
  expect(geometry.outline.map(command => command.join(",")).join(" ")).toBe(expected);
  const crossed = ["x", "cross", "asterisk"].includes(name);
  expect(geometry.closed).toBe(!crossed);
  expect(geometry.fill).toEqual(crossed ? markerGeometry("square", 2, 0, 0, 1).outline : geometry.outline);
});
it("retains ASCII-only case comparison and does not trim names", () => {
  expect(markerGeometry("TrIaNgLe-RiGhT", 2, 0, 0, 1).shape).toBe("triangle-right");
  for (const name of ["ſquare", " square", "square ", "__proto__", "constructor", "toString"]) {
    expect(markerGeometry(name, 2, 0, 0, 1).shape).toBe("none");
  }
});
it("transforms circle controls independently and reflects negative scales", () => {
  const circle = markerGeometry("circle", 3, 7, 11, -2);
  expect(circle.outline[1]).toEqual(["C", 4, 9.32, 5.32, 8, 7, 8]);
  expect(circle.strokeWidth).toBe(0.6000000000000001);
  const zero = markerGeometry("cross", 0, 7, 11, 3);
  expect(zero.outline).toEqual([["M", 7, 11], ["L", 7, 11], ["M", 7, 11], ["L", 7, 11]]);
  expect(zero.strokeWidth).toBe(0);
});
