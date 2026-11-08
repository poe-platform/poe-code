import { expect, it } from "vitest";
import { blendApngPixels } from "./apng-input.js";

it("blends APNG over with straight alpha and replaces with source", () => {
  const canvas = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]);
  const pixels = new Uint8Array([0, 0, 255, 128, 0, 255, 0, 128]);
  blendApngPixels(canvas, pixels, 1);
  expect([...canvas]).toEqual([127, 0, 128, 255, 0, 255, 0, 128]);
  blendApngPixels(canvas, new Uint8Array(8), 0);
  expect([...canvas]).toEqual(Array(8).fill(0));
});
