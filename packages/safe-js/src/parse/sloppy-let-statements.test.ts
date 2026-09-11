import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";

it.each([
  "var let=1;let=3;return let",
  "var let=1;let++;return let",
  "var let={x:3};let.x;return let.x",
  "var let=()=>3;let();return 3",
  "var let=1;for(let=0;let<3;let++){}return let",
  "let x=3;return x"
])("accepts native non-strict let statements: %s", source => {
  expect(() => Function(source)).not.toThrow();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
});

it.each([
  "var let=[3];let[0];return 3",
  '"use strict";let=3',
  "let let=3"
])("preserves restricted let grammar: %s", source => {
  expect(() => Function(source)).toThrow();
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});

it.each(["let", "const"])("rejects let as a %s loop binding", kind => {
  for (const tail of ["of [1]", "in {a:1}"]) {
    const source = `for(${kind} let ${tail}){}`;
    expect(() => Function(source)).toThrow();
    expect(() => parseDynamicFunction("normal", "", source)).toThrow();
  }
});

it.each([
  "var let;for(let in {a:1}){}return let",
  "var let;for((let) of [1]){}return let",
  "for(var let of [1]){}return let"
])("preserves non-lexical let loop targets: %s", source => {
  expect(() => Function(source)).not.toThrow();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
});
