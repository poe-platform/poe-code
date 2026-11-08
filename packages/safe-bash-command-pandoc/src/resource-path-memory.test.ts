import {expect, it, vi} from "vitest";
import {ExecutionContext} from "./execution.js";
import {writeDocument} from "./engine.js";
import type {ResourceFileSystem} from "./types.js";
import {inspectResourcePath, localResourceTarget, resourceDirectory} from "./resources.js";

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


it("inspects ancestors in order without collecting the complete path", async () => {
  const path = "/" + "folder/".repeat(512) + "file";
  const context = new ExecutionContext("convert", {});
  let inspected = 0;
  const fs: ResourceFileSystem = {
    async lstat(current) {
      expect(current).toBe(inspected === 0 ? "/" : inspected <= 512 ? "/" + "folder/".repeat(inspected).slice(0, -1) : path);
      inspected++;
      return {type: current === path ? "file" : "directory"};
    }, async mkdir() {}, async writeFile() {}
  };
  const original = String.prototype.split;
  const split = vi.spyOn(String.prototype, "split").mockImplementation(function(this: string, ...args: Parameters<typeof original>) {
    if (this === path) throw new Error("Whole-path component array forbidden");
    return original.apply(this, args);
  });
  try {expect(await inspectResourcePath(fs, path, context)).toBe("file"); expect(inspected).toBe(514);}
  finally {split.mockRestore(); await context.close();}
});

it("extracts literal media keys and encodes destinations without path arrays", async () => {
  const id = "folder/".repeat(512) + "p%20.png", destination = "/" + "deep/".repeat(128) + "output x";
  const path = destination + "/p%20.png", bytes = Uint8Array.of(1, 2, 3);
  const writeFile = vi.fn(async (_path: string, _bytes: Uint8Array) => {});
  const fs: ResourceFileSystem = {
    async lstat(current) {if (current === "/") return {type: "directory"}; throw Object.assign(new Error("missing"), {code: "ENOENT"});},
    async mkdir() {}, writeFile
  };
  const original = String.prototype.split;
  const split = vi.spyOn(String.prototype, "split").mockImplementation(function(this: string, ...args: Parameters<typeof original>) {
    if (this === id || this === destination || this === path) throw new Error("Whole-path component array forbidden");
    return original.apply(this, args);
  });
  try {
    const result = await writeDocument({blocks: [{t: "Para", c: [{t: "Image", c: [["", [], []], [], [id, ""]]}]}], metadata: {}, resources: [{id, bytes}]}, {to: "html", extractMedia: destination}, {resourceFiles: fs});
    expect(result).toMatchObject({text: expect.stringContaining(destination.replace("output x", "output%20x") + "/p%2520.png")});
    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile.mock.calls[0]).toEqual([path, bytes, expect.anything()]);
  } finally {split.mockRestore();}
});
