import {expect, it} from "vitest";
import {fillPrintNewlines} from "./text-lines.js";

it.each([
  ["ab\ncd", false, "ab↩cd"],
  ["אב\nגד", true, "אב↪גד"],
  ["אב\n\nגד", true, "אב↪↪גד"],
  ["אב\r\nגד\u2028", true, "אב\r↪גד\u2028"]
])("marks Fill line feeds according to base direction: %s", (value, rtl, expected) => {
  let work = 0;
  expect(fillPrintNewlines(value, rtl, amount => {work += amount ?? 1;})).toBe(expected);
  expect(work).toBe(value.length);
});

it("charges Fill text work before allocating replacements", () => {
  const reason = new Error("cancelled");
  expect(() => fillPrintNewlines("ab\ncd", false, () => {throw reason;})).toThrow(reason);
});
