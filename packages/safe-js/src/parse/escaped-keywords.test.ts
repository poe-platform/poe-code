import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parseDynamicFunction, parseModule } from "./parser.js";

it.each([
  [String.raw`var \u006cet=3;return let`, true],
  ["var let=3;return let", true],
  ["let let=3;return let", false],
  ['"use strict";var let=3', false],
  ["let value=3;return value", true]
] as const)("handles non-strict let identifiers: %s", (source, valid) => {
  if (valid) {
    expect(() => Function(source)).not.toThrow();
    expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  } else {
    expect(() => Function(source)).toThrow();
    expect(() => parseDynamicFunction("normal", "", source)).toThrow();
  }
});

it.each([
  String.raw`\u0072eturn 3`,
  String.raw`return \u0074rue`,
  String.raw`\u0069f (true) return 3`,
  String.raw`return \u006eull`,
  String.raw`var \u0069f=3`,
  String.raw`\u0076ar x=3;return x`,
  String.raw`\u0073witch(1){case 1:return 3}`,
  String.raw`return \u006eew Object()`,
  String.raw`const o={__proto__:{x:3},m(){return \u0073uper.x}};return o.m()`,
  String.raw`return 1 \u0069n {1:3}`,
  String.raw`return (()=>{\u0064ebugger;return 3})()`
])("rejects an escaped reserved keyword: %s", source => {
  expect(() => runInNewContext(`(function(){${source}})()`)).toThrow();
  expect(() => parseModule(source)).toThrow();
});

it.each([
  String.raw`return ({\u0069f:3}).if`,
  String.raw`return ({\u0069f(){return 3}}).if()`,
  String.raw`const o={if:3};return o.\u0069f`,
  String.raw`const \u0061=3;return a`
])("accepts an escaped property or ordinary identifier: %s", source => {
  expect(runInNewContext(`(function(){${source}})()`)).toBe(3);
  expect(() => parseModule(source)).not.toThrow();
});
