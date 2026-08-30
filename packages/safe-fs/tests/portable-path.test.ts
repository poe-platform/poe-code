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
