import { isAbsolute, resolve } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";

import * as api from "../index.js";
import {
  InvalidPairExtensionError,
  MissingPairError,
  resolvePair,
  type HarnessFs
} from "./pair.js";

function memfs(files: Record<string, string | null>, cwd = "/"): HarnessFs {
  const volume = Volume.fromJSON(files, "/");
  const fs = createFsFromVolume(volume).promises;

  return {
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

describe("resolvePair", () => {
  it("is re-exported from the package entrypoint", () => {
    expect(api.resolvePair).toBe(resolvePair);
  });

  it("resolves a pair from either side when both files exist", async () => {
    const fs = memfs({
      "/repo/harness/review.md": "# Review",
      "/repo/harness/review.ajs": "return true;"
    });

    await expect(resolvePair("/repo/harness/review.md", fs)).resolves.toEqual({
      ajsPath: "/repo/harness/review.ajs",
      mdPath: "/repo/harness/review.md",
      basename: "review"
    });

    await expect(resolvePair("/repo/harness/review.ajs", fs)).resolves.toEqual({
      ajsPath: "/repo/harness/review.ajs",
      mdPath: "/repo/harness/review.md",
      basename: "review"
    });
  });

  it("preserves dotted basenames and relative directories", async () => {
    const fs = memfs(
      {
        "/repo/harness/review.case.md": "# Review",
        "/repo/harness/review.case.ajs": "return true;"
      },
      "/repo"
    );

    await expect(resolvePair("harness/review.case.md", fs)).resolves.toEqual({
      ajsPath: "harness/review.case.ajs",
      mdPath: "harness/review.case.md",
      basename: "review.case"
    });
  });

  it("throws MissingPairError naming ajs when the .ajs sibling is missing", async () => {
    const fs = memfs({
      "/repo/harness/review.md": "# Review"
    });

    await expect(resolvePair("/repo/harness/review.md", fs)).rejects.toMatchObject({
      name: "MissingPairError",
      side: "ajs",
      path: "/repo/harness/review.ajs"
    });
    await expect(resolvePair("/repo/harness/review.md", fs)).rejects.toBeInstanceOf(
      MissingPairError
    );
  });

  it("throws MissingPairError naming the input side when the input file is missing", async () => {
    const fs = memfs({
      "/repo/harness/review.ajs": "return true;"
    });

    await expect(resolvePair("/repo/harness/review.md", fs)).rejects.toMatchObject({
      name: "MissingPairError",
      side: "md",
      path: "/repo/harness/review.md"
    });
  });

  it("does not rewrite stat failures with inherited missing-file codes", async () => {
    const fs: HarnessFs = {
      stat: async () => {
        throw new Error("pair stat denied");
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(resolvePair("/repo/harness/review.md", fs)).rejects.toThrow(
        "pair stat denied"
      );
    });
  });

  it("throws MissingPairError naming md when the .md sibling is missing", async () => {
    const fs = memfs({
      "/repo/harness/review.ajs": "return true;"
    });

    await expect(resolvePair("/repo/harness/review.ajs", fs)).rejects.toMatchObject({
      name: "MissingPairError",
      side: "md",
      path: "/repo/harness/review.md"
    });
  });

  it("throws MissingPairError naming ajs when the .ajs input is a directory", async () => {
    const fs = memfs({
      "/repo/harness/review.ajs": null,
      "/repo/harness/review.md": "# Review"
    });

    await expect(resolvePair("/repo/harness/review.ajs", fs)).rejects.toMatchObject({
      name: "MissingPairError",
      side: "ajs",
      path: "/repo/harness/review.ajs"
    });
  });

  it("rejects input paths without .md or .ajs extensions", async () => {
    const fs = memfs({
      "/repo/harness/review.txt": "wrong"
    });

    await expect(resolvePair("/repo/harness/review.txt", fs)).rejects.toMatchObject({
      name: "InvalidPairExtensionError",
      extension: ".txt",
      path: "/repo/harness/review.txt"
    });
    await expect(resolvePair("/repo/harness/review.txt", fs)).rejects.toBeInstanceOf(
      InvalidPairExtensionError
    );
  });

  it("treats directories as missing pair files", async () => {
    const fs = memfs({
      "/repo/harness/review.md": null,
      "/repo/harness/review.ajs": "return true;"
    });

    await expect(resolvePair("/repo/harness/review.md", fs)).rejects.toMatchObject({
      name: "MissingPairError",
      side: "md",
      path: "/repo/harness/review.md"
    });
  });

  it("preserves filesystem errors when a pair file cannot be inspected", async () => {
    const accessError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const fs: HarnessFs = {
      async stat(path) {
        if (path.endsWith(".ajs")) {
          throw accessError;
        }

        return { isFile: () => true };
      }
    };

    await expect(resolvePair("/repo/harness/review.md", fs)).rejects.toBe(accessError);
  });
});
