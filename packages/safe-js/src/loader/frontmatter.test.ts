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

  it("parses frontmatter with CR-only line endings", () => {
    const markdown = "---\rtitle: Example\r---\r```js\rreturn true;\r```";

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: { title: "Example" },
      body: "```js\rreturn true;\r```"
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

  it("returns an empty object for frontmatter that contains only blank lines", () => {
    const markdown = ["---", "", "  ", "\t", "---", "# Heading"].join("\n");

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
    const markdown = ["---", 'separator: "---"', "title: Example", "---", "Body"].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        separator: "---",
        title: "Example"
      },
      body: "Body"
    });
  });

  it("parses frontmatter values containing colons and dashes", () => {
    const markdown = [
      "---",
      'command: "npm run dev -- --agent claude"',
      'description: "Fix loader: preserve alpha-beta values"',
      "path: packages/safejs/src/loader/frontmatter.ts",
      "---",
      "Body"
    ].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        command: "npm run dev -- --agent claude",
        description: "Fix loader: preserve alpha-beta values",
        path: "packages/safejs/src/loader/frontmatter.ts"
      },
      body: "Body"
    });
  });

  it("handles CRLF-only line endings without reporting a missing closing fence", () => {
    const markdown = "---\r\ntitle: Example\r\n---\r\nBody";

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        title: "Example"
      },
      body: "Body"
    });
  });

  it("surfaces YAML errors for mixed tab and space indentation with the original line", () => {
    const markdown = ["---", "tasks:", "\t- name: tabbed", "  - name: spaced", "---"].join("\n");

    expect(() => splitFrontmatter(markdown)).toThrow("Invalid YAML frontmatter at line 3:");
  });

  it("does not impose a frontmatter size limit", () => {
    const markdown = ["---", `value: ${"a".repeat(1024 * 1024 + 1)}`, "---", "Body"].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        value: "a".repeat(1024 * 1024 + 1)
      },
      body: "Body"
    });
  });

  it("preserves nested arrays of objects structurally", () => {
    const markdown = [
      "---",
      "tasks:",
      "  - name: plan",
      "    steps:",
      "      - title: inspect",
      "        done: true",
      "      - title: implement",
      "        done: false",
      "---",
      "Body"
    ].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        tasks: [
          {
            name: "plan",
            steps: [
              {
                title: "inspect",
                done: true
              },
              {
                title: "implement",
                done: false
              }
            ]
          }
        ]
      },
      body: "Body"
    });
  });

  it("accepts a closing fence with trailing whitespace", () => {
    const markdown = ["---", "title: Example", "--- ", "Body"].join("\n");

    expect(splitFrontmatter(markdown)).toEqual({
      frontmatter: {
        title: "Example"
      },
      body: "Body"
    });
  });

  it("does not accept a closing fence with leading whitespace", () => {
    const markdown = ["---", "title: Example", " ---"].join("\n");

    expect(() => splitFrontmatter(markdown)).toThrow(
      "Invalid frontmatter at line 3: missing closing delimiter (---)."
    );
  });

  it("reports malformed yaml with the document line number", () => {
    const markdown = ["---", "title: ok", "items: [broken", "---", "# Heading"].join("\n");

    expect(() => splitFrontmatter(markdown)).toThrow("Invalid YAML frontmatter at line 3:");
  });

  it("reports malformed yaml with the correct line number for CRLF content", () => {
    const markdown = ["---", "title: ok", "items: [broken", "---", "# Heading"].join("\r\n");

    expect(() => splitFrontmatter(markdown)).toThrow("Invalid YAML frontmatter at line 3:");
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
