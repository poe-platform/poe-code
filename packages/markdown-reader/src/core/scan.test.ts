import { describe, expect, it } from "vitest";
import planFixture from "../testing/fixtures/markdown-reader-plan.md";
import fencedCodeFixture from "../testing/fixtures/with-fenced-code.md";
import { scanMarkdown, type Section } from "./scan.js";

function sliceBytes(source: string, start: number, end: number): string {
  return Buffer.from(source, "utf8").subarray(start, end).toString("utf8");
}

function getToc(sections: Section[]): Array<Pick<Section, "depth" | "title" | "number">> {
  return sections.map(({ depth, title, number }) => ({ depth, title, number }));
}

describe("scanMarkdown", () => {
  it("scans the plan fixture with the exact TOC and byte-accurate body slices", () => {
    const sections = scanMarkdown(planFixture);

    expect(getToc(sections)).toEqual([
      { depth: 1, title: "Markdown Reader", number: null },
      { depth: 2, title: "1. Problem", number: "1" },
      { depth: 2, title: "2. User-facing shape", number: "2" },
      { depth: 3, title: "Command: plan markdown-read", number: "2.1" },
      { depth: 3, title: "Command: plan markdown-read-section", number: "2.2" },
      { depth: 3, title: "Command: plan markdown-reader-mcp", number: "2.3" },
      { depth: 3, title: "Error cases users see", number: "2.4" },
      { depth: 3, title: "SDK", number: "2.5" },
      {
        depth: 2,
        title: "3. Implementation details and technical decisions",
        number: "3"
      },
      { depth: 3, title: "Where the code lives", number: "3.1" },
      {
        depth: 3,
        title: "Parsing strategy — extend the shared AST with source positions",
        number: "3.2"
      },
      { depth: 3, title: "Walking the AST", number: "3.3" },
      { depth: 3, title: "Numbering rule", number: "3.4" },
      { depth: 3, title: "Section resolution", number: "3.5" },
      { depth: 3, title: "Flags, env vars, config", number: "3.6" },
      { depth: 3, title: "Edge cases", number: "3.7" },
      { depth: 3, title: "Open questions", number: "3.8" },
      { depth: 2, title: "4. Interfaces and test plan", number: "4" },
      { depth: 3, title: "Module boundaries (TypeScript)", number: "4.1" },
      { depth: 3, title: "MCP tool and group shape", number: "4.2" },
      { depth: 3, title: "Test plan", number: "4.3" },
      { depth: 3, title: "Rollout / migration", number: "4.4" },
      { depth: 3, title: "Autonomy checklist", number: "4.5" },
      { depth: 2, title: "5. Code plan", number: "5" },
      { depth: 3, title: "New files", number: "5.1" },
      { depth: 3, title: "Files to change", number: "5.2" },
      { depth: 3, title: "Function signatures (new or noteworthy)", number: "5.3" },
      {
        depth: 3,
        title: "Build order (keeps the branch green at every step)",
        number: "5.4"
      }
    ]);

    const reconstructed = Buffer.concat([
      Buffer.from(planFixture, "utf8").subarray(0, sections[0]!.headingStart),
      ...sections.map((section) =>
        Buffer.from(
          sliceBytes(planFixture, section.headingStart, section.bodyEndNoChildren),
          "utf8"
        )
      )
    ]).toString("utf8");

    expect(reconstructed).toBe(planFixture);

    const userFacingShape = sections.find((section) => section.number === "2");
    const implementation = sections.find((section) => section.number === "3");
    const firstChild = sections.find((section) => section.number === "2.1");

    expect(userFacingShape).toBeDefined();
    expect(implementation).toBeDefined();
    expect(firstChild).toBeDefined();

    expect(userFacingShape?.bodyEnd).toBe(implementation?.headingStart);
    expect(userFacingShape?.bodyEndNoChildren).toBe(firstChild?.headingStart);
    expect(
      sliceBytes(planFixture, userFacingShape!.headingStart, userFacingShape!.bodyEnd)
    ).toContain("### Command: `plan markdown-reader-mcp`");
    expect(
      sliceBytes(planFixture, userFacingShape!.headingStart, userFacingShape!.bodyEndNoChildren)
    ).not.toContain("### Command: `plan markdown-read`");
  });

  it("uses baseline 2 for a single leading h1 and leaves that title unnumbered", () => {
    const sections = scanMarkdown(
      ["# Document Title", "", "## First Section", "", "Body."].join("\n")
    );

    expect(getToc(sections)).toEqual([
      { depth: 1, title: "Document Title", number: null },
      { depth: 2, title: "First Section", number: "1" }
    ]);
  });

  it("uses the shallowest h3 depth as the numbering baseline when the document only has h3 headings", () => {
    const sections = scanMarkdown(
      ["### Alpha", "", "Body.", "", "### Beta", "", "More."].join("\n")
    );

    expect(getToc(sections)).toEqual([
      { depth: 3, title: "Alpha", number: "1" },
      { depth: 3, title: "Beta", number: "2" }
    ]);
  });

  it("numbers nested h2, h3, and h4 headings as 1, 1.1, and 1.1.1", () => {
    const sections = scanMarkdown(
      ["## Parent", "", "### Child", "", "#### Grandchild", "", "Nested body."].join("\n")
    );

    expect(getToc(sections)).toEqual([
      { depth: 2, title: "Parent", number: "1" },
      { depth: 3, title: "Child", number: "1.1" },
      { depth: 4, title: "Grandchild", number: "1.1.1" }
    ]);
  });

  it("supports setext headings and preserves byte-accurate body slices", () => {
    const source = ["Setext Title", "============", "", "Body paragraph.", ""].join("\n");
    const [section] = scanMarkdown(source);

    expect(section).toBeDefined();
    expect(getToc([section!])).toEqual([{ depth: 1, title: "Setext Title", number: null }]);
    expect(sliceBytes(source, section!.headingStart, section!.bodyEnd)).toBe(source);
    expect(sliceBytes(source, section!.headingStart, section!.bodyStart)).toBe(
      ["Setext Title", "============", ""].join("\n")
    );
  });

  it("flattens inline heading markup into a plain-text title", () => {
    const [section] = scanMarkdown("## Hello `code` *em* **strong** [link](https://example.com)\n");

    expect(section).toMatchObject({
      depth: 2,
      title: "Hello code em strong link",
      number: "1"
    });
  });

  it("ignores heading-like lines inside fenced code blocks", () => {
    const sections = scanMarkdown(fencedCodeFixture);

    expect(getToc(sections)).toEqual([
      { depth: 1, title: "Code Example", number: null },
      { depth: 2, title: "After Code", number: "1" }
    ]);
    expect(
      sliceBytes(fencedCodeFixture, sections[0]!.headingStart, sections[0]!.bodyEnd)
    ).toContain("## still not a heading");
  });

  it("ignores heading-like lines inside HTML comments", () => {
    const source = ["<!--", "# Hidden", "-->", "", "# Visible", ""].join("\n");

    expect(getToc(scanMarkdown(source))).toEqual([
      { depth: 1, title: "Visible", number: null }
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(scanMarkdown("")).toEqual([]);
  });
});
