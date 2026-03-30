import { describe, expect, it } from "vitest";
import { parseFrontmatter, writeFrontmatter } from "./frontmatter.js";
import type { RalphFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
  it("returns defaults when no frontmatter exists", () => {
    const result = parseFrontmatter("# My Plan\n\nSome content");

    expect(result).toEqual({
      data: {
        status: {
          state: "open",
          iteration: 0
        }
      },
      body: "# My Plan\n\nSome content"
    });
  });

  it("parses nested frontmatter with a single agent and iterations", () => {
    const doc = [
      "---",
      "agent: claude-code",
      "iterations: 5",
      "status:",
      "  state: in_progress",
      "  iteration: 3",
      "---",
      "# My Plan",
      "",
      "Content"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result).toEqual({
      data: {
        agent: "claude-code",
        iterations: 5,
        status: {
          state: "in_progress",
          iteration: 3
        }
      },
      body: "# My Plan\n\nContent"
    });
  });

  it("parses an agent array", () => {
    const doc = [
      "---",
      "agent:",
      "  - claude-code",
      "  - codex",
      "status:",
      "  state: open",
      "  iteration: 0",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data).toEqual({
      agent: ["claude-code", "codex"],
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("migrates legacy flat frontmatter to the nested status shape", () => {
    const doc = [
      "---",
      "status: pending",
      "iteration: 2",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result).toEqual({
      data: {
        status: {
          state: "open",
          iteration: 2
        }
      },
      body: "Body"
    });
  });

  it("maps legacy cancelled state back to open", () => {
    const doc = [
      "---",
      "status: cancelled",
      "iteration: 7",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data.status).toEqual({
      state: "open",
      iteration: 7
    });
  });

  it("ignores invalid agent and iterations values", () => {
    const doc = [
      "---",
      "agent:",
      "  - claude-code",
      "  - 3",
      "iterations: 0",
      "status:",
      "  state: nope",
      "  iteration: -1",
      "---",
      "Body"
    ].join("\n");

    const result = parseFrontmatter(doc);

    expect(result).toEqual({
      data: {
        status: {
          state: "open",
          iteration: 0
        }
      },
      body: "Body"
    });
  });

  it("preserves an empty agent array for later validation", () => {
    const doc = ["---", "agent: []", "---", "Body"].join("\n");

    const result = parseFrontmatter(doc);

    expect(result.data).toEqual({
      agent: [],
      status: {
        state: "open",
        iteration: 0
      }
    });
  });

  it("handles empty document", () => {
    const result = parseFrontmatter("");

    expect(result).toEqual({
      data: {
        status: {
          state: "open",
          iteration: 0
        }
      },
      body: ""
    });
  });
});

describe("writeFrontmatter", () => {
  it("writes nested status with agent and iterations", () => {
    const result = writeFrontmatter(
      {
        agent: "claude-code",
        iterations: 3,
        status: {
          state: "in_progress",
          iteration: 1
        }
      },
      "# My Plan\n\nContent"
    );

    expect(result).toBe(
      [
        "---",
        "agent: claude-code",
        "iterations: 3",
        "status:",
        "  state: in_progress",
        "  iteration: 1",
        "---",
        "# My Plan",
        "",
        "Content"
      ].join("\n")
    );
  });

  it("roundtrips agent arrays through parse and write", () => {
    const frontmatter: RalphFrontmatter = {
      agent: ["claude-code", "codex"],
      iterations: 5,
      status: {
        state: "completed",
        iteration: 5
      }
    };
    const body = "# Test\n\nContent here";
    const written = writeFrontmatter(frontmatter, body);
    const parsed = parseFrontmatter(written);

    expect(parsed.data).toEqual(frontmatter);
    expect(parsed.body).toBe(body);
  });

  it("always writes the new nested format after reading a legacy document", () => {
    const original = [
      "---",
      "status: pending",
      "iteration: 0",
      "---",
      "# Plan",
      "",
      "Body"
    ].join("\n");

    const { data, body } = parseFrontmatter(original);
    const result = writeFrontmatter(data, body);

    expect(result).toBe(
      [
        "---",
        "status:",
        "  state: open",
        "  iteration: 0",
        "---",
        "# Plan",
        "",
        "Body"
      ].join("\n")
    );
  });
});
