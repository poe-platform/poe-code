import { UserError } from "toolcraft";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import nestedFixture from "../testing/fixtures/nested.md";
import fencedCodeFixture from "../testing/fixtures/with-fenced-code.md";
import { createReadSection } from "./read-section.js";

type ReadOnlyFs = {
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;
};

function createMemFs(files: Record<string, string>): ReadOnlyFs {
  const volume = Volume.fromJSON(files, "/");

  return createFsFromVolume(volume).promises as unknown as ReadOnlyFs;
}

describe("readSection", () => {
  it("returns identical markdown when resolving by section number or title", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/nested.md": nestedFixture }),
      cwd: "/repo"
    });

    const [byNumber, byTitle] = await Promise.all([
      readSection({ file: "docs/nested.md", section: "1" }),
      readSection({ file: "docs/nested.md", section: "Child One" })
    ]);

    expect(byNumber).toEqual(byTitle);
    expect(byNumber).toEqual({
      file: "docs/nested.md",
      markdown: "## Child One\n\nContent for child one.\n\n### Grandchild One\n\nNested content.\n\n",
      section: {
        depth: 2,
        number: "1",
        title: "Child One"
      }
    });
  });

  it("stops at the next heading of any depth when includeChildren is false", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/nested.md": nestedFixture }),
      cwd: "/repo"
    });

    await expect(
      readSection({ file: "docs/nested.md", section: "Root Section", includeChildren: false })
    ).resolves.toEqual({
      file: "docs/nested.md",
      section: { depth: 1, number: null, title: "Root Section" },
      markdown: "# Root Section\n\nRoot intro.\n\n"
    });
  });

  it("selects an unnumbered title over a duplicate child title", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/overview.md": "# Overview\n\nIntro.\n\n## Overview\n\nDetails.\n" }),
      cwd: "/repo"
    });

    await expect(readSection({ file: "docs/overview.md", section: "Overview" })).resolves.toMatchObject({
      markdown: "# Overview\n\nIntro.\n\n## Overview\n\nDetails.\n",
      section: { depth: 1, number: null, title: "Overview" }
    });
  });

  it("selects a numbered child path before an unnumbered numeric title", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/numeric.md": "# 1\n\nIntro.\n\n## Child\n\nDetails.\n" }),
      cwd: "/repo"
    });

    await expect(readSection({ file: "docs/numeric.md", section: "1" })).resolves.toMatchObject({
      markdown: "## Child\n\nDetails.\n",
      section: { depth: 2, number: "1", title: "Child" }
    });
  });

  it("rejects empty file paths and section ids before resolving sections", async () => {
    const readSection = createReadSection({
      fs: {
        async readFile(filePath) {
          throw new Error(`should not read ${filePath}`);
        }
      },
      cwd: "/repo"
    });

    await expect(readSection({ file: "", section: "1" })).rejects.toThrowError(
      new UserError("invalid file: expected a non-empty path")
    );
    await expect(readSection({ file: "docs/simple.md", section: "   " })).rejects.toThrowError(
      new UserError("invalid section: expected a non-empty section id")
    );
  });

  it("preserves fenced code blocks and trailing blank lines exactly", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/with-fenced-code.md": fencedCodeFixture }),
      cwd: "/repo"
    });

    await expect(
      readSection({ file: "docs/with-fenced-code.md", section: "Code Example", includeChildren: false })
    ).resolves.toEqual({
      file: "docs/with-fenced-code.md",
      section: { depth: 1, number: null, title: "Code Example" },
      markdown: [
        "# Code Example",
        "",
        "Intro text.",
        "",
        "```ts",
        "# not a heading",
        "## still not a heading",
        "const snippet = `### not a heading either`;",
        "```",
        "",
        ""
      ].join("\n")
    });
  });

  it("defaults includeChildren to true", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/nested.md": nestedFixture }),
      cwd: "/repo"
    });

    const implicitChildren = await readSection({ file: "docs/nested.md", section: "1" });
    const explicitChildren = await readSection({
      file: "docs/nested.md",
      section: "1",
      includeChildren: true
    });

    expect(implicitChildren).toEqual(explicitChildren);
  });

  it("treats includeChildren=false on a leaf section the same as the default", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/nested.md": nestedFixture }),
      cwd: "/repo"
    });

    const [defaultResult, leafOnlyResult] = await Promise.all([
      readSection({ file: "docs/nested.md", section: "Child Two" }),
      readSection({ file: "docs/nested.md", section: "Child Two", includeChildren: false })
    ]);

    expect(leafOnlyResult).toEqual(defaultResult);
    expect(leafOnlyResult.markdown).toBe("## Child Two\n\nContent for child two.\n");
  });

  it("accepts both relative and absolute file paths", async () => {
    const readSection = createReadSection({
      fs: createMemFs({ "/repo/docs/nested.md": nestedFixture }),
      cwd: "/repo"
    });

    const [relativeResult, absoluteResult] = await Promise.all([
      readSection({ file: "docs/nested.md", section: "1" }),
      readSection({ file: "/repo/docs/nested.md", section: "1" })
    ]);

    expect(relativeResult.markdown).toBe(absoluteResult.markdown);
    expect(relativeResult.section).toEqual(absoluteResult.section);
    expect(relativeResult.file).toBe("docs/nested.md");
    expect(absoluteResult.file).toBe("/repo/docs/nested.md");
  });

  it("throws a UserError when the file is missing", async () => {
    const readSection = createReadSection({ fs: createMemFs({}), cwd: "/repo" });

    await expect(readSection({ file: "docs/missing.md", section: "1" })).rejects.toThrowError(
      new UserError("file not found: docs/missing.md")
    );
  });

  it("throws the resolver error for empty and frontmatter-only files", async () => {
    const readSection = createReadSection({
      fs: createMemFs({
        "/repo/docs/empty.md": "",
        "/repo/docs/frontmatter-only.md": ["---", "title: Only Metadata", "---", ""].join("\n")
      }),
      cwd: "/repo"
    });

    await expect(readSection({ file: "docs/empty.md", section: "1" })).rejects.toThrowError(
      new UserError(
        'no section matching "1" (try \'read-markdown\' to see the table of contents)'
      )
    );

    await expect(
      readSection({ file: "docs/frontmatter-only.md", section: "1" })
    ).rejects.toThrowError(
      new UserError(
        'no section matching "1" (try \'read-markdown\' to see the table of contents)'
      )
    );
  });

  it("wraps unreadable file errors and malformed frontmatter in UserError", async () => {
    const unreadable = createReadSection({
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

    await expect(unreadable({ file: "docs/secret.md", section: "1" })).rejects.toThrowError(
      new UserError("EACCES: permission denied, open '/repo/docs/secret.md'")
    );

    const malformed = createReadSection({
      fs: createMemFs({
        "/repo/docs/bad-frontmatter.md": ["---", "title: demo: broken", "---", "", "# Broken"].join(
          "\n"
        )
      }),
      cwd: "/repo"
    });

    await expect(
      malformed({ file: "docs/bad-frontmatter.md", section: "Broken" })
    ).rejects.toThrowError(
      expect.objectContaining({
        message: expect.stringContaining("invalid frontmatter in docs/bad-frontmatter.md:")
      })
    );
  });
});
