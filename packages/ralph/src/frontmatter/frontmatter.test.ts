import { describe, expect, it } from "vitest";
import { parseFrontmatter, writeFrontmatter } from "./frontmatter.js";
import type { RalphFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns defaults when no frontmatter exists", () => {
    const result = parseFrontmatter("# My Plan\n\nSome content");

    expect(result).toEqual({
      data: { status: "pending", iteration: 0 },
      body: "# My Plan\n\nSome content"
    });
  });

  it("parses existing frontmatter with status and iteration", () => {
    const doc = [
      "---",
      "status: in_progress",
      "iteration: 3",
      "---",
      "# My Plan",
      "",
      "Content"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result).toEqual({
      data: { status: "in_progress", iteration: 3 },
      body: "# My Plan\n\nContent"
    });
  });

  it("defaults missing fields", () => {
    const doc = ["---", "status: completed", "---", "Body"].join("\n");

    const result = parseFrontmatter(doc);

    expect(result).toEqual({
      data: { status: "completed", iteration: 0 },
      body: "Body"
    });
  });

  it("handles empty document", () => {
    const result = parseFrontmatter("");

    expect(result).toEqual({
      data: { status: "pending", iteration: 0 },
      body: ""
    });
  });
});

describe("writeFrontmatter", () => {
  it("adds frontmatter to body without existing frontmatter", () => {
    const result = writeFrontmatter(
      { status: "in_progress", iteration: 1 },
      "# My Plan\n\nContent"
    );

    expect(result).toBe(
      [
        "---",
        "status: in_progress",
        "iteration: 1",
        "---",
        "# My Plan",
        "",
        "Content"
      ].join("\n")
    );
  });

  it("replaces existing frontmatter", () => {
    const original = [
      "---",
      "status: pending",
      "iteration: 0",
      "---",
      "# Plan",
      "",
      "Body"
    ].join("\n");

    const { body } = parseFrontmatter(original);
    const result = writeFrontmatter(
      { status: "in_progress", iteration: 2 },
      body
    );

    expect(result).toBe(
      [
        "---",
        "status: in_progress",
        "iteration: 2",
        "---",
        "# Plan",
        "",
        "Body"
      ].join("\n")
    );
  });

  it("writes completed status", () => {
    const result = writeFrontmatter(
      { status: "completed", iteration: 5 },
      "Done"
    );

    expect(result).toBe(
      ["---", "status: completed", "iteration: 5", "---", "Done"].join("\n")
    );
  });

  it("roundtrips through parse and write", () => {
    const frontmatter: RalphFrontmatter = {
      status: "in_progress",
      iteration: 7
    };
    const body = "# Test\n\nContent here";
    const written = writeFrontmatter(frontmatter, body);
    const parsed = parseFrontmatter(written);

    expect(parsed.data).toEqual(frontmatter);
    expect(parsed.body).toBe(body);
  });
});
