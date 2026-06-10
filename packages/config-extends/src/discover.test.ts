import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import type { FileSystem } from "./types.js";
import { findBase } from "./discover.js";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files);
  return createFsFromVolume(volume).promises as unknown as FileSystem;
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

describe("findBase", () => {
  it("finds .md in first directory", async () => {
    const fs = createMemFs({
      "/first/review.md": "# Review"
    });

    await expect(findBase("review", ["/first", "/second"], fs)).resolves.toEqual({
      content: "# Review",
      filePath: "/first/review.md"
    });
  });

  it("finds .yaml in second directory when first has no match", async () => {
    const fs = createMemFs({
      "/first/other.md": "other",
      "/second/review.yaml": "title: Review"
    });

    await expect(findBase("review", ["/first", "/second"], fs)).resolves.toEqual({
      content: "title: Review",
      filePath: "/second/review.yaml"
    });
  });

  it("finds .yml variant", async () => {
    const fs = createMemFs({
      "/bases/review.yml": "title: Review"
    });

    await expect(findBase("review", ["/bases"], fs)).resolves.toEqual({
      content: "title: Review",
      filePath: "/bases/review.yml"
    });
  });

  it("finds .json variant", async () => {
    const fs = createMemFs({
      "/bases/review.json": '{"title":"Review"}'
    });

    await expect(findBase("review", ["/bases"], fs)).resolves.toEqual({
      content: '{"title":"Review"}',
      filePath: "/bases/review.json"
    });
  });

  it("prefers first directory over second", async () => {
    const fs = createMemFs({
      "/first/review.md": "first",
      "/second/review.md": "second"
    });

    await expect(findBase("review", ["/first", "/second"], fs)).resolves.toEqual({
      content: "first",
      filePath: "/first/review.md"
    });
  });

  it("prefers .md over .yaml over .yml over .json in the same directory", async () => {
    const fs = createMemFs({
      "/bases/review.json": '{"format":"json"}',
      "/bases/review.yml": "format: yml",
      "/bases/review.yaml": "format: yaml",
      "/bases/review.md": "markdown"
    });

    await expect(findBase("review", ["/bases"], fs)).resolves.toEqual({
      content: "markdown",
      filePath: "/bases/review.md"
    });
  });

  it("throws with all checked paths when not found", async () => {
    const fs = createMemFs({
      "/first/other.md": "other"
    });

    await expect(findBase("review", ["/first", "/second"], fs)).rejects.toThrowError(
      [
        'Base "review" not found.',
        "Checked paths:",
        "- /first/review.md",
        "- /first/review.yaml",
        "- /first/review.yml",
        "- /first/review.json",
        "- /second/review.md",
        "- /second/review.yaml",
        "- /second/review.yml",
        "- /second/review.json"
      ].join("\n")
    );
  });

  it("skips missing directories gracefully", async () => {
    const fs = createMemFs({
      "/found/review.md": "found"
    });

    await expect(findBase("review", ["/missing", "/found"], fs)).resolves.toEqual({
      content: "found",
      filePath: "/found/review.md"
    });
  });

  it("rethrows non-ENOENT errors", async () => {
    const fs: FileSystem = {
      readFile: async () => {
        const error = new Error("permission denied") as NodeJS.ErrnoException;
        error.code = "EACCES";
        throw error;
      }
    };

    await expect(findBase("review", ["/first"], fs)).rejects.toMatchObject({
      code: "EACCES",
      message: "permission denied"
    });
  });

  it("does not treat inherited read error codes as missing bases", async () => {
    const fs: FileSystem = {
      readFile: async () => {
        throw new Error("read denied");
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(findBase("review", ["/first"], fs)).rejects.toThrow("read denied");
    });
  });

  it("rejects base names that traverse outside configured directories", async () => {
    const fs = createMemFs({
      "/project/secret.md": "external base content"
    });

    await expect(findBase("../secret", ["/project/bases"], fs)).rejects.toThrow(
      "Base name must remain inside configured base directories."
    );
  });
});
