import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  parseSourceRef,
  serializeFrontmatter,
  serializeSourceRef
} from "./frontmatter.js";

describe("parseSourceRef", () => {
  it("parses plain paths and github-style line anchors", () => {
    expect(parseSourceRef("packages/memory/src/frontmatter.ts")).toEqual({
      path: "packages/memory/src/frontmatter.ts"
    });
    expect(parseSourceRef("packages/memory/src/frontmatter.ts#L12")).toEqual({
      path: "packages/memory/src/frontmatter.ts",
      startLine: 12
    });
    expect(parseSourceRef("packages/memory/src/frontmatter.ts#L12-L18")).toEqual({
      path: "packages/memory/src/frontmatter.ts",
      startLine: 12,
      endLine: 18
    });
  });

  it("rejects malformed line anchors", () => {
    expect(() => parseSourceRef("packages/memory/src/frontmatter.ts#L0")).toThrow(/line/i);
    expect(() => parseSourceRef("packages/memory/src/frontmatter.ts#L12-L4")).toThrow(/line/i);
    expect(() => parseSourceRef("packages/memory/src/frontmatter.ts#bad")).toThrow(/source/i);
  });
});

describe("serializeSourceRef", () => {
  it("serializes optional line anchors", () => {
    expect(serializeSourceRef({ path: "packages/memory/src/frontmatter.ts" })).toBe(
      "packages/memory/src/frontmatter.ts"
    );
    expect(
      serializeSourceRef({ path: "packages/memory/src/frontmatter.ts", startLine: 12 })
    ).toBe("packages/memory/src/frontmatter.ts#L12");
    expect(
      serializeSourceRef({
        path: "packages/memory/src/frontmatter.ts",
        startLine: 12,
        endLine: 18
      })
    ).toBe("packages/memory/src/frontmatter.ts#L12-L18");
  });
});

describe("parseFrontmatter", () => {
  it("returns an empty frontmatter object when the document has no frontmatter", () => {
    expect(parseFrontmatter("# Memory\n\nBody")).toEqual({
      frontmatter: {},
      body: "# Memory\n\nBody"
    });
  });

  it("parses supported fields and source refs", () => {
    const markdown = [
      "---",
      "name: superintendent",
      "description: Loop harness",
      "last_touched_at: 2026-04-18T10:22:00Z",
      "sources:",
      "  - packages/superintendent/src/phases.ts#L42-L58",
      "  - pages/incidents/2026-03-migration.md",
      "---",
      "# Superintendent",
      "",
      "Body"
    ].join("\n");

    expect(parseFrontmatter(markdown)).toEqual({
      frontmatter: {
        name: "superintendent",
        description: "Loop harness",
        lastTouchedAt: "2026-04-18T10:22:00Z",
        sources: [
          {
            path: "packages/superintendent/src/phases.ts",
            startLine: 42,
            endLine: 58
          },
          {
            path: "pages/incidents/2026-03-migration.md"
          }
        ]
      },
      body: "# Superintendent\n\nBody"
    });
  });

  it("throws when the yaml frontmatter is malformed", () => {
    expect(() =>
      parseFrontmatter(["---", "name: [broken", "---", "# Memory"].join("\n"))
    ).toThrow(/yaml/i);
  });
});

describe("serializeFrontmatter", () => {
  it("omits the fence when there is no frontmatter to write", () => {
    expect(serializeFrontmatter({}, "# Memory\n")).toBe("# Memory\n");
  });

  it("writes the supported keys in a stable format", () => {
    const markdown = serializeFrontmatter(
      {
        name: "superintendent",
        description: "Loop harness",
        lastTouchedAt: "2026-04-18T10:22:00Z",
        sources: [
          {
            path: "packages/superintendent/src/phases.ts",
            startLine: 42,
            endLine: 58
          },
          {
            path: "pages/incidents/2026-03-migration.md"
          }
        ]
      },
      "# Superintendent\n\nBody\n"
    );

    expect(markdown).toBe([
      "---",
      "name: superintendent",
      "description: Loop harness",
      "last_touched_at: 2026-04-18T10:22:00Z",
      "sources:",
      "  - packages/superintendent/src/phases.ts#L42-L58",
      "  - pages/incidents/2026-03-migration.md",
      "---",
      "# Superintendent",
      "",
      "Body",
      ""
    ].join("\n"));
  });
});
