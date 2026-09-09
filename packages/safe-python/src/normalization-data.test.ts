import { expect, it } from "vitest";
import { compileNormalizationData } from "../scripts/normalization-data.js";

it("compiles canonical/compatibility decomposition and full composition exclusions", () => {
  const data = compileNormalizationData([
    "00C0;A GRAVE;Lu;0;L;0041 0300;;;;N;;;;;",
    "0300;GRAVE;Mn;230;NSM;;;;;N;;;;;",
    "0344;DIALYTIKA TONOS;Mn;230;NSM;0308 0301;;;;N;;;;;",
    "FB03;LIGATURE FFI;Ll;0;L;<compat> 0066 0066 0069;;;;N;;;;;"
  ].join("\n"), "0344; Full_Composition_Exclusion # excluded\n");
  expect(data).toEqual({ decompositions: { 192: [65, 768], 836: [776, 769], 64259: [102, 102, 105] },
    combiningClasses: { 768: 230, 836: 230 }, compositions: { [65 * 0x110000 + 768]: 192 } });
});
