import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { FsError } from "../src/core.js";
import { assertPathWithin, dirname, isPathWithin, normalizePath, relativePath, resolvePath } from "../src/contracts/virtual-path.js";

const pieces = ["", "/", "//", "///", ".", "..", "a", "b", ".hidden", "...", "😀", "a\\b"];
const paths = [...new Set(pieces.flatMap(left => pieces.map(right => `${left}/${right}`)))];

describe("portable virtual-path primitives", () => {
  it("matches POSIX dirname across slash, dot, Unicode and trailing-separator cases", () => {
    for (const path of [...pieces, ...paths]) expect(dirname(path), path).toBe(posix.dirname(path));
  });
  it("resolves all paths against the supplied virtual cwd without ambient cwd", () => {
    for (const cwd of ["/", "/base/sub", "//base/../root/"])
      for (const path of paths) expect(normalizePath(path, cwd), `${cwd} | ${path}`).toBe(posix.resolve(cwd, path));
    for (const first of pieces)
      for (const second of pieces) expect(resolvePath("/cwd", first, second)).toBe(posix.resolve("/cwd", first, second));
  });
  it("normalizes cwd without operands and resets on later absolute operands", () => {
    for (const cwd of ["/", "/base/sub", "//base/../root/"])
      expect(resolvePath(cwd)).toBe(posix.resolve(cwd));
    expect(resolvePath("/base", "one", "..", "/reset", "two", ".", "three")).toBe("/reset/two/three");
  });
  it("validates every operand even when a later absolute path resets it", () => {
    for (const invalid of [undefined, null, 1, "bad\0path"]) {
      expect(() => resolvePath("/base", invalid as string)).toThrowError(expect.objectContaining({ code: "EINVAL" }));
      expect(() => resolvePath("/base", "one", invalid as string, "/reset")).toThrowError(expect.objectContaining({ code: "EINVAL" }));
    }
  });
  it("matches relative paths after virtual normalization", () => {
    for (const from of pieces)
      for (const to of paths) expect(relativePath(from, to)).toBe(posix.relative(posix.resolve("/", from), posix.resolve("/", to)));
  });
  it("checks component boundaries and rejects invalid virtual inputs", () => {
    expect(isPathWithin("/a", "/a/../ab")).toBe(false);
    expect(isPathWithin("/a", "/a/b/..")).toBe(true);
    expect(assertPathWithin("/a", "/a/./b")).toBe("/a/b");
    expect(() => assertPathWithin("/a", "/ab")).toThrowError(expect.objectContaining({ code: "EACCES" }));
    for (const input of ["bad\0path", null, undefined, 1]) {
      expect(() => normalizePath(input as string)).toThrowError(FsError);
    }
    expect(() => normalizePath("file", "relative")).toThrowError(expect.objectContaining({ code: "EINVAL" }));
    expect(() => dirname(null as unknown as string)).toThrowError(TypeError);
  });
});

describe("portable POSIX path surface", () => {
  it("normalizes without making relative paths absolute", async () => {
    const { posixPath } = await import("../src/contracts/path.js");
    for (const path of [...pieces, ...paths]) expect(posixPath.normalize(path), path).toBe(posix.normalize(path));
    expect(posixPath.sep).toBe("/");
    expect(posixPath.delimiter).toBe(":");
  });
  it("resolves and relativizes from the portable root", async () => {
    const { posixPath } = await import("../src/contracts/path.js");
    expect(posixPath.resolve()).toBe("/");
    for (const first of pieces) for (const second of paths) {
      expect(posixPath.resolve(first, second)).toBe(posix.resolve("/", first, second));
      expect(posixPath.relative(first, second)).toBe(posix.relative(posix.resolve("/", first), posix.resolve("/", second)));
    }
    expect(posixPath.resolve("/base", "child", "/reset", "../last/")).toBe("/last");
    expect(() => posixPath.resolve(null as unknown as string, "/reset")).toThrow(TypeError);
    expect(() => posixPath.normalize(null as unknown as string)).toThrow(TypeError);
  });
});
