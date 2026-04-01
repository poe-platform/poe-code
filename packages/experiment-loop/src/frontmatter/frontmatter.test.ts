import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { parseExperimentFrontmatter, writeExperimentFrontmatter } from "./frontmatter.js";
import type { ExperimentFileSystem, MetricDef } from "../types.js";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

describe("parseExperimentFrontmatter", () => {
  it("parses a single metric with script and direction", () => {
    const content = [
      "---",
      "agent: claude-code",
      "metric:",
      "  name: test_duration",
      "  script: node scripts/metric-test-duration.mjs",
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
      script: "node scripts/metric-test-duration.mjs",
      direction: "minimize"
    });
    expect(result.body).toBe("# Experiment\n\nBody");
  });

  it("parses a metric with stable direction", () => {
    const content = [
      "---",
      "metric:",
      "  name: test_count",
      "  script: node scripts/metric-test-count.mjs",
      "  direction: stable",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric).toEqual({
      name: "test_count",
      script: "node scripts/metric-test-count.mjs",
      direction: "stable"
    });
  });

  it("parses metricTimeout from frontmatter", () => {
    const content = ["---", "metricTimeout: 120", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metricTimeout).toBe(120);
  });

  it("parses agent as a single string", () => {
    const content = ["---", "agent: claude-code", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.agent).toBe("claude-code");
  });

  it("parses agent as an array of strings", () => {
    const content = [
      "---",
      "agent:",
      "  - claude-code",
      "  - codex",
      "baseline: null",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.agent).toEqual(["claude-code", "codex"]);
  });

  it("parses maxExperiments from frontmatter", () => {
    const content = [
      "---",
      "agent: claude-code",
      "metric:",
      "  name: tests",
      "  script: npm test",
      "  direction: maximize",
      "maxExperiments: 10",
      "baseline: null",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.maxExperiments).toBe(10);
  });

  it("omits maxExperiments when not present", () => {
    const content = ["---", "baseline: null", "---", "Body"].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.maxExperiments).toBeUndefined();
  });

  it("parses a metric chain", () => {
    const content = [
      "---",
      "metric:",
      "  - name: tests",
      "    script: npm test",
      "    direction: maximize",
      "  - name: test_duration",
      "    script: node scripts/metric-test-duration.mjs",
      "    direction: minimize",
      "---",
      "Body"
    ].join("\n");

    const result = parseExperimentFrontmatter(content);

    expect(result.frontmatter.metric).toEqual<MetricDef[]>([
      {
        name: "tests",
        script: "npm test",
        direction: "maximize"
      },
      {
        name: "test_duration",
        script: "node scripts/metric-test-duration.mjs",
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
      "  script: npm test",
      "  direction: maximize",
      "baseline:",
      "  tests: 1",
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
        script: "npm test",
        direction: "maximize"
      },
      baseline: {
        tests: 1
      },
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
      "    script: npm test",
      "    direction: maximize",
      "  - name: test_duration",
      "    script: node scripts/metric-test-duration.mjs",
      "    direction: minimize",
      "baseline:",
      "  tests: 1",
      "  test_duration: 42.5",
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
