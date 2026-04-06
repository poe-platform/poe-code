import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getMarkdownDemo } from "../src/terminal-markdown/demo-content.js";
import { renderMarkdown } from "../src/index.js";
import {
  loadMarkdownDemoDocument,
  parseMarkdownDemoArgs,
  resolveDemoWorkingDirectory
} from "./demo.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const packageRoot = path.resolve(import.meta.dirname, "..");

describe("design-system demo script", () => {
  it("prefers INIT_CWD so workspace runs can load repo-root markdown files", () => {
    expect(resolveDemoWorkingDirectory({ INIT_CWD: repoRoot }, packageRoot)).toBe(repoRoot);
  });

  it("falls back to the current working directory when INIT_CWD is absent", () => {
    expect(resolveDemoWorkingDirectory({}, packageRoot)).toBe(packageRoot);
  });

  it("loads preset markdown showcase content", () => {
    expect(loadMarkdownDemoDocument({ kind: "preset", name: "default" }, { cwd: packageRoot })).toBe(
      getMarkdownDemo("default")
    );
  });

  it("loads markdown files relative to INIT_CWD for workspace demo runs", () => {
    const expected = readFileSync(path.join(repoRoot, "README.md"), "utf8");

    expect(
      loadMarkdownDemoDocument(
        { kind: "file", filePath: "README.md" },
        { cwd: packageRoot, env: { INIT_CWD: repoRoot } }
      )
    ).toBe(expected);
  });

  it("loads markdown files from absolute paths", () => {
    const readmePath = path.join(repoRoot, "README.md");
    const expected = readFileSync(readmePath, "utf8");

    expect(
      loadMarkdownDemoDocument({ kind: "file", filePath: readmePath }, { cwd: packageRoot })
    ).toBe(expected);
  });

  it("throws a clear error when markdown-file is missing its path", () => {
    expect(() =>
      loadMarkdownDemoDocument({ kind: "file", filePath: "   " }, { cwd: packageRoot })
    ).toThrow("markdown-file requires a markdown file path.");
  });

  it("throws a clear error when the markdown file does not exist", () => {
    expect(() =>
      loadMarkdownDemoDocument(
        { kind: "file", filePath: "docs/does-not-exist.md" },
        { cwd: packageRoot, env: { INIT_CWD: repoRoot } }
      )
    ).toThrow(`Markdown file not found: ${path.join(repoRoot, "docs/does-not-exist.md")}`);
  });

  it("parses markdown render flags alongside positional args", () => {
    expect(parseMarkdownDemoArgs(["docs/plans/archive/cli-aliasing.md", "--show-frontmatter"])).toEqual({
      positional: ["docs/plans/archive/cli-aliasing.md"],
      renderOptions: { showFrontmatter: true }
    });
  });

  it("can render frontmatter from repo markdown files when requested", () => {
    const { positional, renderOptions } = parseMarkdownDemoArgs([
      "--show-frontmatter",
      "docs/plans/archive/cli-aliasing.md"
    ]);
    const markdown = loadMarkdownDemoDocument(
      { kind: "file", filePath: positional.join(" ") },
      { cwd: packageRoot, env: { INIT_CWD: repoRoot } }
    );

    expect(renderMarkdown(markdown, renderOptions)).toContain("status:");
  });
});
