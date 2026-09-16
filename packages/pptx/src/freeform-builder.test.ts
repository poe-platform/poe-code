import { expect, it } from "vitest";
import { FreeformBuilder, FreeformPath } from "./freeform-builder.js";
import { Length } from "./length.js";
import { IndexError, TypeError, ValueError } from "./errors.js";

function builder(startX = 0, startY = 0, scale: number | readonly [number, number] = 1) {
  return new FreeformBuilder((geometry) => geometry, startX, startY, scale);
}
it("retains ordered drawing operations and all sequence protocols", () => {
  const b = builder(10, 20);
  expect(b.length).toBe(0);
  expect(
    b.add_line_segments(
      [
        [30, 40],
        [50, 20]
      ],
      false
    )
  ).toBe(b);
  expect(b.move_to(-2, -3)).toBe(b);
  b.add_line_segments([[4, 8]]);
  expect(b.length).toBe(5);
  expect(b[0]!.x?.emu).toBe(30);
  expect(b[0]!.y?.emu).toBe(40);
  expect(b.at(-1).type).toBe("close");
  expect(b.includes(b[1]!)).toBe(true);
  expect(b.count(b[1]!)).toBe(1);
  expect(b.index(b[1]!)).toBe(1);
  expect(b.slice(1, -1)).toEqual([...b].slice(1, -1));
  expect([...b.reversed()]).toEqual([...b].reverse());
  expect(() => b[99]).toThrow(IndexError);
  expect(() => b[-1]).toThrow(IndexError);
  expect(() => b.at(-99)).toThrow(IndexError);
  expect(() => b.index(b[0]!, 1)).toThrow(ValueError);
  expect(() => b.slice(0, 2, 0)).toThrow(ValueError);
  expect(b.slice(undefined, undefined, -1)).toEqual([...b].reverse());
});
it("converts reusable contours with explicit origin, anisotropic scale and rounded local points", () => {
  const b = builder(4.5, -2.5, [2, 3]);
  b.add_line_segments([
    [-1.5, 7.5],
    [10, 3]
  ]);
  const shape = b.convert_to_shape(new Length(100), new Length(200));
  expect(shape).toMatchObject({
    left: 96,
    top: 191,
    width: 24,
    height: 33,
    localWidth: 12,
    localHeight: 11
  });
  expect(shape.commands).toEqual([
    { type: "move", x: 7, y: 0 },
    { type: "line", x: 0, y: 11 },
    { type: "line", x: 12, y: 6 },
    { type: "close" }
  ]);
  expect(b.convert_to_shape().left).toBe(-4);
  expect(b.length).toBe(3);
});
it("maps returned operation application to a bounded path capability", () => {
  const b = builder();
  b.move_to(3, 4).add_line_segments([[8, 9]]);
  const path = new FreeformPath();
  for (const operation of b) operation.apply_operation_to(path);
  expect(path.commands).toEqual([
    { type: "move", x: 3, y: 4 },
    { type: "line", x: 8, y: 9 },
    { type: "close" }
  ]);
  expect(() => b[0]!.apply_operation_to({} as FreeformPath)).toThrow(TypeError);
  expect(() => {
    (path.commands as unknown[]).push({});
  }).toThrow();
});
it("rejects malformed and over-budget mutations atomically", () => {
  const b = builder();
  expect(() =>
    b.add_line_segments([
      [1, 2],
      [Infinity, 2]
    ])
  ).toThrow(ValueError);
  expect(b.length).toBe(0);
  expect(() => b.move_to(NaN, 1)).toThrow(ValueError);
  expect(() => builder(0, 0, 0)).toThrow(ValueError);
  expect(() => b.add_line_segments([[1, 2]], null as unknown as boolean)).toThrow(TypeError);
  expect(() => b.add_line_segments(Array.from({ length: 4097 }, () => [1, 2] as const))).toThrow();
  expect(b.length).toBe(0);
  expect(() => b.convert_to_shape(1 as unknown as Length)).toThrow(TypeError);
});
it("preserves degenerate geometry and rejects scaled overflow before insertion", () => {
  expect(builder().convert_to_shape()).toMatchObject({
    width: 0,
    height: 0,
    localWidth: 0,
    localHeight: 0
  });
  const b = builder(0, 0, 1e15);
  b.add_line_segments([[10, 10]]);
  expect(() => b.convert_to_shape()).toThrow(ValueError);
});
it("exposes live local offsets and applies operations relative to the current builder bounds", () => {
  const b = builder(12, 18);
  b.move_to(20, 30);
  const operation = b[0]!;
  expect(b.shape_offset_x.emu).toBe(12);
  expect(b.shape_offset_y.emu).toBe(18);
  b.add_line_segments([[-5, -7]], false);
  expect(b.shape_offset_x.emu).toBe(-5);
  expect(b.shape_offset_y.emu).toBe(-7);
  const path = new FreeformPath();
  operation.apply_operation_to(path);
  expect(path.commands).toEqual([{ type: "move", x: 25, y: 37 }]);
});
it("does not expose owner insertion or drawing callbacks as runtime properties", () => {
  const b = builder();
  b.move_to(1, 2);
  expect(Object.keys(b)).not.toContain("insert");
  expect("insert" in b).toBe(false);
  expect("offset" in b[0]!).toBe(false);
});
