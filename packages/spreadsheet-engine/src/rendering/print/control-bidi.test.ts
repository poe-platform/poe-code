import {expect, it} from "vitest";
import {controlBidiItems} from "./control-bidi.js";

it.each(["\u2029", "\r"])("retains native single-paragraph levels after %j", control => {
  const value = `אב\tab${control}אב\u200bאב\tab${control}אב`;
  const result = controlBidiItems(value, "rtl", () => {})!;
  expect(result.order.map(index => result.items[index]!.text)).toEqual([
    "אב", control, "ab", "\t", "אב", "\u200b", "\t", "אב", "ab", "אב", control
  ]);
});
it("keeps pure RTL controls on the existing qualified path", () => {
  expect(controlBidiItems("אב\tאב\rאב", "rtl", () => {})).toBeUndefined();
});
it("refuses unqualified directional formatting", () => {
  expect(controlBidiItems("אב\tab\r\u202eab", "rtl", () => {})).toBeUndefined();
});
it("admits resolver work before processing", () => {
  expect(() => controlBidiItems("אב\tab\rאב", "rtl", () => {throw new Error("cancelled");})).toThrow("cancelled");
});

it("restores boundary neutrals before separators and at the line end", () => {
  const result = controlBidiItems("אב\tab\rאב\u200b\tab\u200b", "rtl", () => {})!;
  expect(result.items.filter(item => item.text.includes("\u200b")).every(item => item.direction === "rtl")).toBe(true);
});
