export type MarkerCommand = readonly ["M" | "L", number, number]
  | readonly ["C", number, number, number, number, number, number] | readonly ["Z"];

// Normalized go-marker.c paths. Crossed shapes have a distinct square fill.
const square: readonly MarkerCommand[] = [["M", -1, -1], ["L", -1, 1], ["L", 1, 1], ["L", 1, -1], ["Z"]];
const shapes = {
  none: [],
  square,
  diamond: [["M", 0, -1], ["L", 1, 0], ["L", 0, 1], ["L", -1, 0], ["Z"]],
  "triangle-down": [["M", -1, -1], ["L", 1, -1], ["L", 0, 1], ["Z"]],
  "triangle-up": [["M", 0, -1], ["L", 1, 1], ["L", -1, 1], ["Z"]],
  "triangle-right": [["M", -1, -1], ["L", 1, 0], ["L", -1, 1], ["Z"]],
  "triangle-left": [["M", 1, -1], ["L", -1, 0], ["L", 1, 1], ["Z"]],
  circle: [["M", 1, 0], ["C", 1, 0.56, 0.56, 1, 0, 1], ["C", -0.56, 1, -1, 0.56, -1, 0],
    ["C", -1, -0.56, -0.56, -1, 0, -1], ["C", 0.56, -1, 1, -0.56, 1, 0], ["L", 1, 0], ["Z"]],
  x: [["M", 1, 1], ["L", -1, -1], ["M", 1, -1], ["L", -1, 1]],
  cross: [["M", 1, 0], ["L", -1, 0], ["M", 0, 1], ["L", 0, -1]],
  asterisk: [["M", 0.7, 0.7], ["L", -0.7, -0.7], ["M", 0.7, -0.7], ["L", -0.7, 0.7],
    ["M", 1, 0], ["L", -1, 0], ["M", 0, 1], ["L", 0, -1]],
  bar: [["M", -1, -0.2], ["L", 1, -0.2], ["L", 1, 0.2], ["L", -1, 0.2], ["Z"]],
  "half-bar": [["M", 0, -0.2], ["L", 1, -0.2], ["L", 1, 0.2], ["L", 0, 0.2], ["Z"]],
  butterfly: [["M", -1, -1], ["L", -1, 1], ["L", 0, 0], ["L", 1, 1], ["L", 1, -1], ["L", 0, 0], ["Z"]],
  hourglass: [["M", -1, -1], ["L", 1, -1], ["L", 0, 0], ["L", 1, 1], ["L", -1, 1], ["L", 0, 0], ["Z"]],
  "lefthalf-bar": [["M", 0, -0.2], ["L", -1, -0.2], ["L", -1, 0.2], ["L", 0, 0.2], ["Z"]]
} as const satisfies Readonly<Record<string, readonly MarkerCommand[]>>;

export type MarkerShape = keyof typeof shapes;
export interface MarkerGeometry {
  readonly shape: MarkerShape;
  readonly closed: boolean;
  readonly outline: readonly MarkerCommand[];
  readonly fill: readonly MarkerCommand[];
  readonly strokeWidth: number;
  readonly lineCap: "square";
  readonly lineJoin: "miter";
}

/** GOffice 0.10.61 marker path/scaling stage, independent of painting and codec.
 * Size is the resolved nonnegative native integer size. Surface pixel rounding
 * and paint/color resolution are separate stages, not approximated here.
 */
export function markerGeometry(name: string, size: number, x: number, y: number, scale: number): MarkerGeometry {
  const shape: MarkerShape = (Object.keys(shapes) as MarkerShape[]).find(candidate => {
    if (candidate.length !== name.length) return false;
    for (let index = 0; index < candidate.length; index++) {
      const code = name.charCodeAt(index);
      if ((code >= 65 && code <= 90 ? code + 32 : code) !== candidate.charCodeAt(index)) return false;
    }
    return true;
  }) ?? "none";
  const halfSize = 0.5 * scale * size;
  const closed = shape !== "x" && shape !== "cross" && shape !== "asterisk";
  function transform(commands: readonly MarkerCommand[]): MarkerCommand[] {
    return commands.map(command => {
      if (command[0] === "Z") return ["Z"];
      if (command[0] === "C") return ["C", x + command[1] * halfSize, y + command[2] * halfSize,
        x + command[3] * halfSize, y + command[4] * halfSize, x + command[5] * halfSize, y + command[6] * halfSize];
      return [command[0], x + command[1] * halfSize, y + command[2] * halfSize];
    });
  }
  return { shape, closed, outline: transform(shapes[shape]), fill: transform(closed ? shapes[shape] : square),
    strokeWidth: Math.abs(halfSize) * (2 * 0.1), lineCap: "square", lineJoin: "miter" };
}
