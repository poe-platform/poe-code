import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter.js";

describe("splitFrontmatter", () => {
  it("returns parsed frontmatter and the markdown body", () => {
    const markdown = [
      "---",
      "title: Example",
      "tags:",
      "  - alpha",
      "enabled: true",
      "---",
      "# Heading",
      "",
      "Body"
    ].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        title: "Example",
        tags: ["alpha"],
        enabled: true
      },
      body: "# Heading\n\nBody"
    });
  });

  it("returns an empty frontmatter object when the document has no frontmatter", () => {
    const markdown = "# Heading\n\nBody";

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: markdown
    });
  });

  it("parses frontmatter with CRLF line endings", () => {
    const markdown = [
      "---",
      "title: Example",
      "enabled: true",
      "---",
      "# Heading",
      "",
      "Body"
    ].join("\r\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        title: "Example",
        enabled: true
      },
      body: "# Heading\r\n\r\nBody"
    });
  });

  it("strips a UTF-8 BOM before reading frontmatter", () => {
    const markdown = `\uFEFF---\ntitle: Example\n---\nBody`;

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        title: "Example"
      },
      body: "Body"
    });
  });

  it("returns an empty object for an empty frontmatter block", () => {
    const markdown = ["---", "---", "# Heading"].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: "# Heading"
    });
  });

  it("allows the document to end immediately after the closing delimiter", () => {
    const markdown = ["---", "title: Example", "---"].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        title: "Example"
      },
      body: ""
    });
  });

  it("does not treat a fence-like value inside YAML as the closing delimiter", () => {
    const markdown = ['---', 'separator: "---"', "title: Example", "---", "Body"].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        separator: "---",
        title: "Example"
      },
      body: "Body"
    });
  });

  it("reports malformed yaml with the document line number", () => {
    const markdown = ["---", "title: ok", "items: [broken", "---", "# Heading"].join("\n");

    expect(() => splitFrontmatter(markdown)).toThrow(
      "Invalid YAML frontmatter at line 4:"
    );
  });

  it("reports malformed yaml with the correct line number for CRLF content", () => {
    const markdown = ["---", "title: ok", "items: [broken", "---", "# Heading"].join("\r\n");

    expect(() => splitFrontmatter(markdown)).toThrow(
      "Invalid YAML frontmatter at line 4:"
    );
  });

  it("reports a missing closing fence with the line where parsing stopped", () => {
    const markdown = ["---", "title: Example", "items:", "  - alpha"].join("\n");

    expect(() => splitFrontmatter(markdown)).toThrow(
      "Invalid frontmatter at line 4: missing closing delimiter (---)."
    );
  });

  it("rejects non-object yaml frontmatter", () => {
    const markdown = ["---", "- alpha", "---", "# Heading"].join("\n");

    expect(() => splitFrontmatter(markdown)).toThrow(
      "Invalid frontmatter at line 2: expected a YAML mapping."
    );
  });

  it("treats a leading fence without a newline as plain markdown", () => {
    const markdown = "---";

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: markdown
    });
  });
});
