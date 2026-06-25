import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { findEntrypointPackageMetadata, findPackageMetadata, packageMetadata } = await import(
  "./package-metadata.js"
);

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

  it("reads entrypoint package metadata through a symlinked global bin", () => {
    vol.fromJSON(
      {
        "/repo/packages/mytool/package.json": JSON.stringify({
          name: "mytool",
          version: "2.3.4",
        }),
        "/repo/packages/mytool/dist/bin.js": "",
        "/usr/local/bin": null,
      },
      "/"
    );
    vol.symlinkSync("/repo/packages/mytool/dist/bin.js", "/usr/local/bin/mytool");

    expect(findEntrypointPackageMetadata("/usr/local/bin/mytool")).toEqual({
      name: "mytool",
      path: "/repo/packages/mytool/package.json",
      version: "2.3.4",
    });
  });
});
