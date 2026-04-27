import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { findPackageMetadata, packageMetadata } = await import("./package-metadata.js");

describe("packageMetadata", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("reads the nearest package metadata from an import.meta.url-style file URL", () => {
    vol.fromJSON(
      {
        "/repo/package.json": JSON.stringify({ name: "workspace", version: "0.0.1" }),
        "/repo/packages/mytool/package.json": JSON.stringify({
          name: "mytool",
          version: "1.2.3",
        }),
        "/repo/packages/mytool/src/bin.ts": "",
      },
      "/"
    );

    expect(packageMetadata("file:///repo/packages/mytool/src/bin.ts")).toEqual({
      name: "mytool",
      path: "/repo/packages/mytool/package.json",
      version: "1.2.3",
    });
  });

  it("returns undefined when optional lookup cannot find package metadata", () => {
    vol.fromJSON(
      {
        "/repo/packages/mytool/src/bin.ts": "",
      },
      "/"
    );

    expect(findPackageMetadata("file:///repo/packages/mytool/src/bin.ts")).toBeUndefined();
  });
});
