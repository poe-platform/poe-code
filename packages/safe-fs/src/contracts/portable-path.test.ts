import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { basename, dirname, extname, isAbsolutePath, joinPath } from "./portable-path.js";

const paths = ["", ".", "..", "...", "/", "//", "///", "a", "/a", "//a", "a/", "a//b", "a/../b/", "/a/.hidden", "/a/file.ext", "a..", "a.b.c", "../a//", "λ/雪.txt"];

describe("portable POSIX path helpers", () => {
  it.each(paths)("preserves Node path semantics for %j", path => {
    expect(dirname(path)).toBe(posix.dirname(path));
    expect(extname(path)).toBe(posix.extname(path));
    expect(isAbsolutePath(path)).toBe(posix.isAbsolute(path));
    for (const suffix of ["", "a", ".ext", ".txt", path, posix.basename(path)]) {
      expect(basename(path, suffix)).toBe(posix.basename(path, suffix));
    }
    for (const other of paths) expect(joinPath(path, other)).toBe(posix.join(path, other));
  });

  it("rejects non-string arguments instead of coercing them", () => {
    for (const value of [null, undefined, 1, {}, ["a"]]) {
      for (const operation of [basename, dirname, extname, isAbsolutePath, joinPath]) {
        expect(() => operation(value as string)).toThrow(TypeError);
      }
    }
    expect(() => basename("a", null as unknown as string)).toThrow(TypeError);
    expect(joinPath()).toBe(".");
  });

  it("matches short POSIX path and suffix combinations", () => {
    let fragments = [""];
    for (let depth = 0; depth < 4; depth++) {
      fragments = fragments.flatMap(prefix => ["a", ".", "/"].map(character => prefix + character));
      for (const path of fragments) {
        expect(dirname(path)).toBe(posix.dirname(path));
        expect(extname(path)).toBe(posix.extname(path));
        for (const suffix of ["a", ".", "/", "aa", "a/", "/a", ".."])
          expect(basename(path, suffix), JSON.stringify([path, suffix])).toBe(posix.basename(path, suffix));
      }
    }
  });
});
