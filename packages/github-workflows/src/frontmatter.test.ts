import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns an empty frontmatter object when the markdown has no frontmatter", () => {
    const markdown = "# Prompt\n\nBody";

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: "# Prompt\n\nBody"
    });
  });

  it("does not treat a leading fence without a newline as frontmatter", () => {
    const markdown = "--- heading\n\nBody";

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: "--- heading\n\nBody"
    });
  });

  it("parses a yaml frontmatter object and returns the remaining prompt body", () => {
    const markdown = [
      "---",
      "name: triage",
      "model: gpt-5.4",
      "mcp:",
      "  github:",
      "    command: npx",
      "    args:",
      "      - -y",
      "      - github-mcp-server",
      "---",
      "# Prompt",
      "",
      "Investigate the issue."
    ].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage",
        model: "gpt-5.4",
        mcp: {
          github: {
            command: "npx",
            args: ["-y", "github-mcp-server"]
          }
        }
      },
      body: "# Prompt\n\nInvestigate the issue."
    });
  });

  it("parses frontmatter when the markdown starts with a utf-8 bom", () => {
    const markdown = ["\uFEFF---", "name: triage", "---", "Body"].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage"
      },
      body: "Body"
    });
  });

  it("returns an empty object for an empty frontmatter block", () => {
    const markdown = ["---", "---", "Body"].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {},
      body: "Body"
    });
  });

  it("supports windows newlines", () => {
    const markdown = [
      "---",
      "name: triage",
      "---",
      "# Prompt",
      "",
      "Body"
    ].join("\r\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage"
      },
      body: "# Prompt\r\n\r\nBody"
    });
  });

  it("preserves intentional blank lines at the start of the body", () => {
    const markdown = ["---", "name: triage", "---", "", "", "Body"].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage"
      },
      body: "\n\nBody"
    });
  });

  it("returns an empty body when the document only contains frontmatter", () => {
    const markdown = ["---", "name: triage", "---"].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "triage"
      },
      body: ""
    });
  });

  it("throws when the frontmatter block is not closed", () => {
    const markdown = ["---", "name: triage"].join("\n");

    expect(() => parseFrontmatter(markdown)).toThrow(
      "Missing YAML frontmatter end delimiter (---)."
    );
  });

  it("throws when yaml is invalid", () => {
    const markdown = ["---", "name: [", "---", "Body"].join("\n");

    expect(() => parseFrontmatter(markdown)).toThrow(/yaml/i);
  });

  it("throws when the parsed frontmatter is not an object", () => {
    const markdown = ["---", "- triage", "---", "Body"].join("\n");

    expect(() => parseFrontmatter(markdown)).toThrow(
      "YAML frontmatter must parse to an object."
    );
  });
});
