import { isAbsolute, resolve } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import * as api from "../index.js";
import { discoverHarnesses } from "./discover.js";
import type { HarnessFs } from "../loader/pair.js";

function memfs(files: Record<string, string | null>, cwd = "/"): HarnessFs {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises;

  return {
    readdir(path, options) {
      return fs.readdir(isAbsolute(path) ? path : resolve(cwd, path), options);
    },
    stat(path) {
      return fs.stat(isAbsolute(path) ? path : resolve(cwd, path));
    }
  };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("discoverHarnesses", () => {
  it("is re-exported from the package entrypoint", () => {
    expect(api.discoverHarnesses).toBe(discoverHarnesses);
  });

  it("returns an empty list for an empty root", async () => {
    const fs = memfs({
      "/repo/.poe-code/harnesses": null
    });

    await expect(discoverHarnesses("/repo/.poe-code/harnesses", fs)).resolves.toEqual([]);
  });

  it("discovers one valid pair in a first-level subdirectory", async () => {
    const fs = memfs({
      "/repo/.poe-code/harnesses/review/review.md": "# Review",
      "/repo/.poe-code/harnesses/review/review.ajs": "export default async () => true;"
    });

    await expect(discoverHarnesses("/repo/.poe-code/harnesses", fs)).resolves.toEqual([
      {
        ajsPath: "/repo/.poe-code/harnesses/review/review.ajs",
        mdPath: "/repo/.poe-code/harnesses/review/review.md",
        basename: "review"
      }
    ]);
  });

  it("discovers multiple valid pairs sorted alphabetically by basename", async () => {
    const fs = memfs({
      "/repo/.poe-code/harnesses/zebra/zebra.md": "# Zebra",
      "/repo/.poe-code/harnesses/zebra/zebra.ajs": "export default async () => true;",
      "/repo/.poe-code/harnesses/alpha/alpha.md": "# Alpha",
      "/repo/.poe-code/harnesses/alpha/alpha.ajs": "export default async () => true;"
    });

    await expect(discoverHarnesses("/repo/.poe-code/harnesses", fs)).resolves.toEqual([
      {
        ajsPath: "/repo/.poe-code/harnesses/alpha/alpha.ajs",
        mdPath: "/repo/.poe-code/harnesses/alpha/alpha.md",
        basename: "alpha"
      },
      {
        ajsPath: "/repo/.poe-code/harnesses/zebra/zebra.ajs",
        mdPath: "/repo/.poe-code/harnesses/zebra/zebra.md",
        basename: "zebra"
      }
    ]);
  });

  it("skips half-valid subdirectories", async () => {
    const fs = memfs({
      "/repo/.poe-code/harnesses/review/review.md": "# Review",
      "/repo/.poe-code/harnesses/build/build.md": "# Build",
      "/repo/.poe-code/harnesses/build/build.ajs": "export default async () => true;"
    });

    await expect(discoverHarnesses("/repo/.poe-code/harnesses", fs)).resolves.toEqual([
      {
        ajsPath: "/repo/.poe-code/harnesses/build/build.ajs",
        mdPath: "/repo/.poe-code/harnesses/build/build.md",
        basename: "build"
      }
    ]);
  });

  it("skips pairs that do not match their containing directory name", async () => {
    const fs = memfs({
      "/repo/.poe-code/harnesses/review/other.md": "# Other",
      "/repo/.poe-code/harnesses/review/other.ajs": "export default async () => true;",
      "/repo/.poe-code/harnesses/build/build.md": "# Build",
      "/repo/.poe-code/harnesses/build/build.ajs": "export default async () => true;"
    });

    await expect(discoverHarnesses("/repo/.poe-code/harnesses", fs)).resolves.toEqual([
      {
        ajsPath: "/repo/.poe-code/harnesses/build/build.ajs",
        mdPath: "/repo/.poe-code/harnesses/build/build.md",
        basename: "build"
      }
    ]);
  });

  it("ignores unrelated files and nested harness-like pairs", async () => {
    const fs = memfs({
      "/repo/.poe-code/harnesses/README.md": "# Harnesses",
      "/repo/.poe-code/harnesses/review/notes.txt": "notes",
      "/repo/.poe-code/harnesses/review/review.md": "# Review",
      "/repo/.poe-code/harnesses/review/review.ajs": "export default async () => true;",
      "/repo/.poe-code/harnesses/nested/child/child.md": "# Child",
      "/repo/.poe-code/harnesses/nested/child/child.ajs": "export default async () => true;"
    });

    await expect(discoverHarnesses("/repo/.poe-code/harnesses", fs)).resolves.toEqual([
      {
        ajsPath: "/repo/.poe-code/harnesses/review/review.ajs",
        mdPath: "/repo/.poe-code/harnesses/review/review.md",
        basename: "review"
      }
    ]);
  });

  it("returns an empty list for a missing root", async () => {
    const fs = memfs({});

    await expect(discoverHarnesses("/repo/.poe-code/harnesses", fs)).resolves.toEqual([]);
  });

  it("does not ignore readdir errors with inherited missing-directory codes", async () => {
    const fs: HarnessFs = {
      readdir: async () => {
        throw new Error("harness root read denied");
      },
      stat: async () => {
        throw new Error("unexpected stat");
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(discoverHarnesses("/repo/.poe-code/harnesses", fs)).rejects.toThrow(
        "harness root read denied"
      );
    });
  });
});
