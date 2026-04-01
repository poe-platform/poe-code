import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parseExperimentFrontmatter, writeExperimentFrontmatter } from "./frontmatter.js";
import type { ExperimentFileSystem, MetricDef } from "../types.js";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

describe("parseExperimentFrontmatter", () => {
  it("parses a single metric with direction", () => {
    const content = [
      "---",
      "agent: claude-code",
      "metric:",
      "  name: test_duration",
      "  direction: minimize",
      "status:",
      "  state: open",
      "  experiment: 0",
      "  kept: 0",
      "---",
      "# Experiment",
      "",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric).toEqual({
      name: "test_duration",
      direction: "minimize"
    });
    expect(result.body).toBe("# Experiment\n\nBody");
  });

  it("parses a metric chain", () => {
    const content = [
      "---",
      "metric:",
      "  - name: tests",
      "    direction: maximize",
      "  - name: test_duration",
      "    direction: minimize",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric).toEqual<MetricDef[]>([
      {
        name: "tests",
        direction: "maximize"
      },
      {
        name: "test_duration",
        direction: "minimize"
      }
    ]);
  });

  it("parses baseline as a record of numbers", () => {
    const content = ["---", "baseline:", "  tests: 1", "  test_duration: 42.5", "---", "Body"].join(
      "\n"
    );

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.baseline).toEqual({
      tests: 1,
      test_duration: 42.5
    });
  });

  it("parses baseline as null", () => {
    const content = ["---", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.baseline).toBeNull();
  });

  it("returns defaults when the markdown has no frontmatter", () => {
    const content = ["# Experiment", "", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result).toEqual({
      frontmatter: {
        baseline: null,
        status: {
          state: "open",
          experiment: 0,
          kept: 0
        }
      },
      body: "# Experiment\n\nBody"
    });
  });

  it("returns all frontmatter fields with the expected types", () => {
    const content = [
      "---",
      "agent: claude-code",
      "metric:",
      "  name: tests",
      "  direction: maximize",
      "baseline:",
      "  tests: 1",
      "model: claude-sonnet-4-20250514",
      "status:",
      "  state: open",
      "  experiment: 3",
      "  kept: 2",
      "---",
      "# Experiment"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter).toEqual({
      agent: "claude-code",
      metric: {
        name: "tests",
        direction: "maximize"
      },
      baseline: {
        tests: 1
      },
      model: "claude-sonnet-4-20250514",
      status: {
        state: "open",
        experiment: 3,
        kept: 2
      }
    });
  });
});

describe("writeExperimentFrontmatter", () => {
  it("round-trips parsed frontmatter through write", async () => {
    const fs = createFs();
    const docPath = "/repo/experiment.md";
    const original = [
      "---",
      "agent: claude-code",
      "metric:",
      "  - name: tests",
      "    direction: maximize",
      "  - name: test_duration",
      "    direction: minimize",
      "baseline:",
      "  tests: 1",
      "  test_duration: 42.5",
      "model: claude-sonnet-4-20250514",
      "status:",
      "  state: open",
      "  experiment: 3",
      "  kept: 2",
      "---",
      "# Experiment",
      "",
      "Body"
    ].join("\n");

    const parsed = parseExperimentFrontmatter(original);

    await writeExperimentFrontmatter(docPath, parsed.frontmatter, parsed.body, fs);

    const written = await fs.readFile(docPath, "utf8");
    const reparsed = parseExperimentFrontmatter(written);

    expect(reparsed).toEqual(parsed);
  });

  it("writes a YAML frontmatter block for required fields even when values are defaults", async () => {
    const fs = createFs();
    const docPath = "/repo/experiment.md";

    await writeExperimentFrontmatter(
      docPath,
      {
        baseline: null,
        status: {
          state: "open",
          experiment: 0,
          kept: 0
        }
      },
      "# Experiment\n",
      fs
    );

    const written = await fs.readFile(docPath, "utf8");

    expect(written).toContain("---\n");
    expect(written).toContain("baseline: null\n");
    expect(written).toContain("status:\n  state: open\n  experiment: 0\n  kept: 0\n");
    expect(written.endsWith("# Experiment\n")).toBe(true);
  });
});
