import {expect, it, vi} from "vitest";
import {ExecutionContext} from "./execution.js";
import {localResourceTarget, resourceDirectory} from "./resources.js";

it.each([32, 8192])("normalizes %i path components without a whole-path split", count => {
  const input = "a/../".repeat(count) + "folder/p%20x.png";
  const directory = "/" + "./folder/".repeat(count);
  const context = new ExecutionContext("convert", {});
  const original = String.prototype.split;
  const split = vi.spyOn(String.prototype, "split").mockImplementation(function(this: string, ...args: Parameters<typeof original>) {
    if (this === input || this === directory) throw new Error("Whole-path component array forbidden");
    return original.apply(this, args);
  });
  try {
    expect(localResourceTarget(input + "?query#fragment", context)).toEqual({name: "folder/p x.png", suffix: "?query#fragment"});
    expect(resourceDirectory(directory)).toBe("/" + Array<string>(count).fill("folder").join("/"));
  } finally {split.mockRestore();}
});

it("validates a long component without a character-array scan", () => {
  const value = "letter".repeat(32768), context = new ExecutionContext("convert", {});
  const original = Array.prototype.some;
  const some = vi.spyOn(Array.prototype, "some").mockImplementation(function(this: unknown[], ...args: Parameters<typeof original>) {
    if (this.length === value.length) throw new Error("Whole-component character array forbidden");
    return original.apply(this, args);
  });
  try {expect(localResourceTarget(value, context)).toEqual({name: value, suffix: ""});}
  finally {some.mockRestore();}
});

it.each(["%00", "%1f", "%7f", "%2f", "%5c", "%3a", "%zz"])("rejects %s at the end of a long component", suffix => {
  const context = new ExecutionContext("convert", {});
  expect(() => localResourceTarget("a".repeat(32768) + suffix, context)).toThrow(expect.objectContaining({code: "E_CAPABILITY"}));
});

it.each([
  ["a//b/../c", "a/c"],
  ["a/%2e%2e/c", "c"],
  ["%7ehome/../c", "c"],
  ["a/%252e%252e/c", "a/%2e%2e/c"],
  ["😀/%E5%AD%97.png", "😀/字.png"],
  [".//p.png", "p.png"]
])("preserves normalization of %s", (input, name) => {
  expect(localResourceTarget(input, new ExecutionContext("convert", {}))).toEqual({name, suffix: ""});
});
it.each(["../x", "a/../../x", "%7ehome/x", "./", "a/.."])("rejects unsafe or empty normalized target %s", input => {
  expect(() => localResourceTarget(input, new ExecutionContext("convert", {}))).toThrow(expect.objectContaining({code: "E_CAPABILITY"}));
});
it.each([
  [".", "/a", "/a"],
  ["a//./b", "/", "/a/b"],
  ["///", "/a", "/"],
  ["x", "/a//./b", "/a/b/x"]
])("preserves directory spelling for %s under %s", (input, cwd, expected) => {
  expect(resourceDirectory(input, cwd)).toBe(expected);
});
it.each([["../x", "/a"], ["x", "/a/../b"]])("rejects parent directory traversal for %s under %s", (input, cwd) => {
  expect(() => resourceDirectory(input, cwd)).toThrow(expect.objectContaining({code: "E_OPTION"}));
});
