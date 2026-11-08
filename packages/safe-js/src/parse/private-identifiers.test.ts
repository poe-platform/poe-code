import { expect, it } from "vitest";
import { tokenize } from "./tokenizer.js";

it.each([["#value", "value"], ["#class", "class"], ["#π", "π"], ["#\\u0078", "x"]])("tokenizes private name %s", (source, name) => {
  const token = tokenize(source)[0];
  expect(token?.type).toBe("private-identifier");
  expect(token?.value).toBe(name);
  expect(token?.start.offset).toBe(0);
  expect(token?.end.offset).toBe(source.length);
});

it.each(["#", "#1", "# value", "#\\u0030"])("rejects malformed private name %s", source => {
  expect(() => tokenize(source)).toThrow();
});
