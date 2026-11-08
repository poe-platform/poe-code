import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";

it.each([
  "let x;for(var x in {}){}",
  "let x;for(var x of []){}",
  "{let x;for(var x in {}){}}",
  "for(var x in {}){}let x;",
  "for(var x of []){}let x;",
  "for(var {x} of []){}let x;",
  "let x;{for(var x in {}){}}",
  "const x=1;for(var [x] of []){}",
  "for(var {a:x} of []){}class x {}"
])("rejects loop var/lexical conflicts: %s", source => {
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});

it.each([
  "var x;for(var x in {}){}",
  "for(var x in {}){}for(var x in {}){}",
  "for(var x of []){}for(var x of []){}",
  "for(let x in {}){}let x;",
  "for(const x of []){}let x;",
  "let x;function f(){for(var x in {}){}}",
  "for(var x in {}){}{let x;}",
  "{let x;}for(var x of []){}"
])("allows distinct lexical scopes and repeated loop var bindings: %s", source => {
  expect(() => Function(source)).not.toThrow();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
});
