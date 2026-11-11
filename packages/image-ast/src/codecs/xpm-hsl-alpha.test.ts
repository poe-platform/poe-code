import { expect, it } from "vitest";
import { parseColor } from "../ast.js";
import { readXpmImage } from "./xpm.js";

it.each([
  ["hsl(180,50%,50%,0.25)", 255],
  ["hsla(180,50%,50%,25%)", 255],
  ["hsla(180,50%,50%,0.25)", 64],
  ["hsl(180,50%,50%)", 255],
  ["hsla(180,50%,50%,0.25%)", 163],
  ["hsla(180,50%,50%,2)", 255]
] as const)("decodes native XPM HSL alpha: %s", (color, alpha) => {
  const input = new TextEncoder().encode(`/* XPM */
static char *icon[] = {
"3 1 3 1",
"a c ${color}",
"b c blue",
". c None",
"ab."
};`);
  expect(readXpmImage(input).data).toEqual(Uint8Array.from([
    64, 191, 191, alpha, 0, 0, 255, 255, 0, 0, 0, 0
  ]));
});

it("keeps general HSL color parsing independent of XPM alpha rules", () => {
  expect(parseColor("hsl(180,50%,50%,0.25)").a).toBe(64);
});
