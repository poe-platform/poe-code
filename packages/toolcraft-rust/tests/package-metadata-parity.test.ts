import { beforeEach, describe, expect, it, vi } from "vitest";
import { fs, vol } from "memfs";
import path from "node:path";

vi.mock("node:fs", async () => (await import("memfs")).fs);

import * as native from "../dist/index.js";
import * as reference from "../../toolcraft/src/package-metadata.js";

beforeEach(() => {
  vi.restoreAllMocks();
  vol.reset();
});

describe("native package metadata", () => {
  it("preserves URL, directory, nonexistent-path and metadata field behavior", () => {
    vol.fromJSON({
      "/repo/package.json": '{"name":"root","version":"1"}',
      "/repo/pkg/package.json": '{"name":42,"version":"2","extra":true}',
      "/repo/pkg/src/file.js": "",
      "/repo/other/file.js": ""
    });
    for (const input of [
      "/repo",
      "/repo/pkg",
      "/repo/pkg/src/missing.js",
      "/repo/other/file.js",
      "file:///repo/pkg/src/file.js",
      new URL("file:///repo/pkg/src/file.js")
    ]) {
      expect(native.findPackageMetadata(input)).toEqual(reference.findPackageMetadata(input));
      expect(native.packageMetadata(input)).toEqual(reference.packageMetadata(input));
    }
    expect(native.findPackageMetadata("/missing.js")).toBeUndefined();
    expect(() => native.packageMetadata("/missing.js")).toThrow(
      "No package.json found from /missing.js."
    );
  });

  it("resolves symlinks and falls back to the original directory when stat fails", () => {
    vol.fromJSON({
      "/repo/package.json": '{"name":"real"}',
      "/repo/bin/run": "",
      "/links/package.json": '{"name":"link"}'
    });
    vol.symlinkSync("/repo/bin/run", "/links/run");
    expect(native.packageMetadata("/links/run")).toEqual(reference.packageMetadata("/links/run"));
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(native.packageMetadata("/links/run")).toEqual(reference.packageMetadata("/links/run"));
    expect(native.packageMetadata("/links/run").name).toBe("link");
  });

  it("preserves parse errors and does not continue past a malformed nearest package", () => {
    vol.fromJSON({
      "/repo/package.json": "{}",
      "/repo/nested/package.json": "broken",
      "/repo/nested/run.js": ""
    });
    for (const lib of [native, reference]) {
      expect(() => lib.packageMetadata("/repo/nested/run.js")).toThrow(SyntaxError);
    }
    for (const text of ["null", "[]", "3", '"text"', '{"name":"\uD800","version":false}']) {
      vol.writeFileSync("/repo/nested/package.json", text);
      const capture = (lib: typeof native | typeof reference) => {
        try {
          return lib.packageMetadata("/repo/nested/run.js");
        } catch (error) {
          return { name: (error as Error).name, message: (error as Error).message };
        }
      };
      expect(capture(native)).toEqual(capture(reference));
    }
  });

  it("retains arbitrary filesystem exceptions and URI validation errors", () => {
    for (const input of [
      new URL("https://example.test/file"),
      "file:///repo/a%2Fb",
      "file://remote/repo/file"
    ]) {
      const capture = (lib: typeof native | typeof reference) => {
        try {
          lib.findPackageMetadata(input);
        } catch (error) {
          return [(error as Error).name, (error as Error).message];
        }
      };
      expect(capture(native)).toEqual(capture(reference));
    }
    const error = { reason: "synthetic filesystem failure" };
    vi.spyOn(fs, "existsSync").mockImplementation(() => {
      throw error;
    });
    for (const lib of [native, reference]) {
      let caught;
      try {
        lib.findPackageMetadata("/repo/file");
      } catch (value) {
        caught = value;
      }
      expect(caught).toBe(error);
    }
  });

  it("swallows lookup failures without stringifying them and uses the caller's cwd", () => {
    vol.fromJSON({ [`${process.cwd()}/package.json`]: '{"name":"current"}' });
    const error = {
      toString() {
        throw new Error("must not stringify lookup errors");
      }
    };
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw error;
    });
    expect(native.packageMetadata()).toEqual(reference.packageMetadata());
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw error;
    });
    expect(native.packageMetadata(`${process.cwd()}/missing.js`)).toEqual(
      reference.packageMetadata(`${process.cwd()}/missing.js`)
    );
  });

  it("falls back to the original path when deriving the resolved parent fails", () => {
    vol.fromJSON({
      "/repo/package.json": '{"name":"real"}',
      "/repo/run": "",
      "/links/package.json": '{"name":"link"}'
    });
    vol.symlinkSync("/repo/run", "/links/run");
    for (const lib of [native, reference]) {
      const spy = vi.spyOn(path, "dirname").mockImplementationOnce(() => {
        throw 0;
      });
      try {
        expect(lib.packageMetadata("/links/run").name).toBe("link");
      } finally {
        spy.mockRestore();
      }
    }
  });
});
