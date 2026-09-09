import { expect, it } from "vitest";
import { createTokenCursor } from "./token-cursor.js";

it("replays a failed grammar alternative without replaying lexer callbacks", () => {
  let comments = 0;
  const cursor = createTokenCursor("(a, # note\nb)", { onComment: () => { comments++; } });
  expect(cursor.attempt(() => { cursor.expect("("); cursor.expect("a"); cursor.expect(","); cursor.expect("x"); })).toBeUndefined();
  expect(cursor.take().text).toBe("(");
  expect(cursor.take().text).toBe("a");
  expect(cursor.take().text).toBe(",");
  expect(cursor.take().text).toBe("b");
  expect(comments).toBe(1);
});

it("commits successful alternatives and restores nested failed alternatives", () => {
  const cursor = createTokenCursor("a b c");
  expect(cursor.attempt(() => {
    cursor.expect("a");
    expect(cursor.attempt(() => { cursor.expect("b"); cursor.expect("x"); })).toBeUndefined();
    return cursor.expect("b").text;
  })).toBe("b");
  expect(cursor.take().text).toBe("c");
});

it("preserves lexer errors during fallback and does not swallow implementation errors", () => {
  const cursor = createTokenCursor("a $");
  expect(cursor.attempt(() => { cursor.take(); cursor.peek(); })).toBeUndefined();
  expect(cursor.take().text).toBe("a");
  expect(() => cursor.peek()).toThrow(SyntaxError);
  const other = createTokenCursor("a");
  expect(() => other.attempt(() => { throw new Error("bug"); })).toThrow("bug");
});
