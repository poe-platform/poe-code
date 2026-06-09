import { UserError } from "toolcraft";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import simpleFixture from "../testing/fixtures/simple.md";
import withFrontmatterFixture from "../testing/fixtures/with-frontmatter.md";
import { createReadMarkdown } from "./read-markdown.js";

type ReadOnlyFs = {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
};

function createMemFs(files: Record<string, string>): ReadOnlyFs {
  const volume = Volume.fromJSON(files, "/");

  return createFsFromVolume(volume).promises as unknown as ReadOnlyFs;
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

describe("readMarkdown", () => {
  it("reads a markdown fixture into the SDK JSON shape", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({ "/repo/docs/with-frontmatter.md": withFrontmatterFixture }),
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/with-frontmatter.md" })).resolves.toMatchInlineSnapshot(`
      {
        "file": "docs/with-frontmatter.md",
        "frontmatter": {
          "owner": "docs",
          "tags": [
            "alpha",
            "beta",
          ],
          "title": "Frontmatter Example",
        },
        "sections": [
          {
            "depth": 1,
            "number": null,
            "title": "Frontmatter Title",
          },
          {
            "depth": 2,
            "number": "1",
            "title": "Details",
          },
        ],
      }
    `);
  });

  it("filters the TOC by heading depth", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({ "/repo/docs/simple.md": simpleFixture }),
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/simple.md", depth: 1 })).resolves.toEqual({
      file: "docs/simple.md",
      frontmatter: {},
      sections: [{ depth: 1, number: null, title: "Simple Document" }]
    });
  });

  it("returns an empty TOC for depth 0", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({ "/repo/docs/simple.md": simpleFixture }),
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/simple.md", depth: 0 })).resolves.toEqual({
      file: "docs/simple.md",
      frontmatter: {},
      sections: []
    });
  });

  it("accepts both relative and absolute file paths", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({ "/repo/docs/simple.md": simpleFixture }),
      cwd: "/repo"
    });

    const [relativeResult, absoluteResult] = await Promise.all([
      readMarkdown({ file: "docs/simple.md" }),
      readMarkdown({ file: "/repo/docs/simple.md" })
    ]);

    expect(relativeResult.sections).toEqual(absoluteResult.sections);
    expect(relativeResult.frontmatter).toEqual(absoluteResult.frontmatter);
    expect(relativeResult.file).toBe("docs/simple.md");
    expect(absoluteResult.file).toBe("/repo/docs/simple.md");
  });

  it("returns empty sections for an empty file and for frontmatter-only content", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({
        "/repo/docs/empty.md": "",
        "/repo/docs/frontmatter-only.md": ["---", "title: Only Metadata", "---", ""].join("\n")
      }),
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/empty.md" })).resolves.toEqual({
      file: "docs/empty.md",
      frontmatter: {},
      sections: []
    });

    await expect(readMarkdown({ file: "docs/frontmatter-only.md" })).resolves.toEqual({
      file: "docs/frontmatter-only.md",
      frontmatter: { title: "Only Metadata" },
      sections: []
    });
  });

  it("reads frontmatter from carriage-return-only markdown", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({
        "/repo/docs/metadata.md": ["---", "title: Metadata", "owner: docs", "---", "# Heading"].join("\r")
      }),
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/metadata.md" })).resolves.toMatchObject({
      frontmatter: { title: "Metadata", owner: "docs" },
      sections: [{ depth: 1, number: null, title: "Heading" }]
    });
  });

  it("rejects invalid table-of-contents depths", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({ "/repo/docs/simple.md": simpleFixture }),
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/simple.md", depth: Number.NaN })).rejects.toThrowError(
      new UserError("invalid depth: expected a non-negative integer")
    );
  });

  it("throws a UserError when the file is missing", async () => {
    const readMarkdown = createReadMarkdown({ fs: createMemFs({}), cwd: "/repo" });

    await expect(readMarkdown({ file: "docs/missing.md" })).rejects.toThrowError(
      new UserError("file not found: docs/missing.md")
    );
  });

  it("wraps unreadable file errors in a UserError", async () => {
    const readMarkdown = createReadMarkdown({
      fs: {
        async readFile() {
          const error = Object.assign(new Error("EACCES: permission denied, open '/repo/docs/secret.md'"), {
            code: "EACCES"
          });

          throw error;
        }
      },
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/secret.md" })).rejects.toThrowError(
      new UserError("EACCES: permission denied, open '/repo/docs/secret.md'")
    );
  });

  it("does not treat inherited read error codes as missing files", async () => {
    const readMarkdown = createReadMarkdown({
      fs: {
        async readFile() {
          throw new Error("plain read failure");
        }
      },
      cwd: "/repo"
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(readMarkdown({ file: "docs/plain.md" })).rejects.toThrowError(
        new UserError("plain read failure")
      );
    });
  });

  it("preserves existing UserError instances from the filesystem dependency", async () => {
    const wrappedError = new UserError("already wrapped");
    const readMarkdown = createReadMarkdown({
      fs: {
        async readFile() {
          throw wrappedError;
        }
      },
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/already-wrapped.md" })).rejects.toBe(wrappedError);
  });

  it("stringifies non-Error filesystem failures into a UserError", async () => {
    const readMarkdown = createReadMarkdown({
      fs: {
        async readFile() {
          throw 123;
        }
      },
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/non-error.md" })).rejects.toThrowError(
      new UserError("123")
    );
  });

  it("throws a UserError when the frontmatter is malformed", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({
        "/repo/docs/bad-frontmatter.md": ["---", "title: demo: broken", "---", "", "# Broken"].join(
          "\n"
        )
      }),
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/bad-frontmatter.md" })).rejects.toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("invalid frontmatter in docs/bad-frontmatter.md:")
      })
    );
  });

  it("rejects malformed frontmatter after a UTF-8 byte-order mark", async () => {
    const readMarkdown = createReadMarkdown({
      fs: createMemFs({
        "/repo/docs/bom-frontmatter.md": "\uFEFF---\ntitle: demo: broken\n---\n\n# Broken\n"
      }),
      cwd: "/repo"
    });

    await expect(readMarkdown({ file: "docs/bom-frontmatter.md" })).rejects.toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("invalid frontmatter in docs/bom-frontmatter.md:")
      })
    );
  });
});
