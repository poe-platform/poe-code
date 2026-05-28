import { describe, expect, it } from "vitest";
import {
  deriveMarkdownTitle,
  formatExperimentDetail,
  formatPipelinePlanMarkdown,
  formatRalphDetail,
  formatSuperintendentDetail,
  getLastExperimentState,
  loadPlanPreviewMarkdown,
  readExperimentState,
  readPlanMetadata
} from "./format.js";
import { parseExperimentFrontmatter } from "@poe-code/experiment-loop";
import { parseFrontmatter } from "@poe-code/ralph";

describe("format helpers", () => {
  it("formats Ralph detail strings", () => {
    const { data } = parseFrontmatter([
      "---",
      "agent: codex",
      "iterations: 3",
      "status:",
      "  state: in_progress",
      "  iteration: 2",
      "---",
      "# Plan"
    ].join("\n"));

    expect(formatRalphDetail(data)).toBe("codex · in_progress 2");
  });

  it("formats experiment detail strings", () => {
    const { frontmatter } = parseExperimentFrontmatter([
      "---",
      "agent:",
      "  - claude-code",
      "  - codex",
      "metric:",
      "  - name: tests",
      "    script: npm run metric:test_count",
      "    direction: maximize",
      "  - name: duration",
      "    script: npm run metric:test_duration",
      "    direction: minimize",
      "baseline: null",
      "---",
      "# Improve tests"
    ].join("\n"));

    expect(formatExperimentDetail(frontmatter, "open")).toBe("maximize/minimize · open");
  });

  it("formats superintendent detail strings", () => {
    expect(
      formatSuperintendentDetail({
        status: {
          state: "review",
          round: 4,
          review_turn: 12
        }
      })
    ).toBe("review 12");

    expect(
      formatSuperintendentDetail({
        status: {
          state: "in_progress",
          round: 4,
          review_turn: 0
        }
      })
    ).toBe("in progress");

    expect(
      formatSuperintendentDetail({
        status: {
          state: "build",
          round: 0,
          review_turn: 0
        }
      })
    ).toBe("build");
  });

  it("returns the last experiment journal status when present", () => {
    expect(
      getLastExperimentState(
        [
          JSON.stringify({ status: "discard" }),
          JSON.stringify({ status: "keep" })
        ].join("\n")
      )
    ).toBe("keep");
  });

  it("returns the last experiment journal status with CR line endings", () => {
    expect(
      getLastExperimentState(
        [JSON.stringify({ status: "discard" }), JSON.stringify({ status: "keep" })].join("\r")
      )
    ).toBe("keep");
  });

  it("surfaces experiment journal read failures other than missing journals", async () => {
    await expect(
      readExperimentState(
        { readFile: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); } },
        "/repo/docs/plans/tune.md"
      )
    ).rejects.toThrow("permission denied");
  });

  it("falls back to open when experiment journal content is empty or invalid", () => {
    expect(getLastExperimentState("")).toBe("open");
    expect(getLastExperimentState("{not-json")).toBe("open");
    expect(getLastExperimentState(JSON.stringify({ status: "completed" }))).toBe("open");
  });

  it("converts pipeline YAML plans into preview markdown", () => {
    const markdown = formatPipelinePlanMarkdown({
      title: "plan-feature.yaml",
      content: [
        "tasks:",
        "  - id: first",
        "    title: Add feature",
        "    prompt: Implement it",
        "    status: done",
        "  - id: second",
        "    title: Add tests",
        "    prompt: Cover it",
        "    status:",
        "      implement: done",
        "      test: open",
        ""
      ].join("\n")
    });

    expect(markdown).toContain("# plan-feature.yaml");
    expect(markdown).toContain("- [x] Add feature (`first`)");
    expect(markdown).toContain("- [ ] Add tests (`second`)");
    expect(markdown).toContain("Step status: implement=done, test=open");
    expect(markdown).toContain("> Implement it");
  });

  it("derives a markdown title from the first heading when present", () => {
    expect(deriveMarkdownTitle("# My Plan\n\nBody", "fallback.md")).toBe("My Plan");
    expect(deriveMarkdownTitle("Body only", "fallback.md")).toBe("fallback.md");
  });

  it("ignores headings in fenced code and supports CR-only documents", () => {
    expect(
      deriveMarkdownTitle("```md\n# Example\n```\n\n# Actual Title", "fallback.md")
    ).toBe("Actual Title");
    expect(deriveMarkdownTitle("# Actual Title\r\rBody", "fallback.md")).toBe("Actual Title");
  });

  it("reads pipeline metadata from CR-only markdown frontmatter", async () => {
    const metadata = await readPlanMetadata({
      kind: "pipeline",
      absolutePath: "/repo/docs/plans/plan-feature.md",
      path: "docs/plans/plan-feature.md",
      fs: {
        readFile: async () => [
          "---",
          "kind: pipeline",
          "tasks:",
          "  - id: feature",
          "    title: Add feature",
          "    prompt: Ship it",
          "    status: done",
          "---"
        ].join("\r")
      }
    });

    expect(metadata.detail).toBe("1/1 done");
  });

  it("reads generic kind metadata with a heading-based detail summary", async () => {
    const metadata = await readPlanMetadata({
      kind: "plan",
      absolutePath: "/repo/docs/plans/feature-plan.md",
      path: "docs/plans/feature-plan.md",
      fs: {
        readFile: async () => [
          "---",
          "kind: plan",
          "---",
          "# Feature plan",
          "",
          "Body"
        ].join("\n")
      }
    });

    expect(metadata).toEqual({
      title: "Feature plan",
      detail: "Feature plan",
      format: "markdown"
    });
  });

  it("falls back to design doc when a generic plan has no heading", async () => {
    const metadata = await readPlanMetadata({
      kind: "plan",
      absolutePath: "/repo/docs/plans/feature-plan.md",
      path: "docs/plans/feature-plan.md",
      fs: {
        readFile: async () => "Body only\n"
      }
    });

    expect(metadata).toEqual({
      title: "feature-plan.md",
      detail: "design doc",
      format: "markdown"
    });
  });

  it("reads pipeline metadata from markdown plan docs", async () => {
    const metadata = await readPlanMetadata({
      kind: "pipeline",
      absolutePath: "/repo/docs/plans/plan-feature.md",
      path: "docs/plans/plan-feature.md",
      fs: {
        readFile: async () => [
          "---",
          "kind: pipeline",
          "tasks:",
          "  - id: feature",
          "    title: Add feature",
          "    prompt: Ship it",
          "    status: done",
          "---"
        ].join("\n")
      }
    });

    expect(metadata).toEqual({
      title: "plan-feature.md",
      detail: "1/1 done",
      format: "markdown"
    });
  });

  it("does not count pipeline tasks without any step statuses as done", () => {
    expect(
      formatPipelinePlanMarkdown({
        title: "Empty steps",
        content: [
          "tasks:",
          "  - id: feature",
          "    title: Add feature",
          "    prompt: Ship it",
          "    status: {}"
        ].join("\n")
      })
    ).toContain("Status: 0/1 done");
  });

  it("reads superintendent metadata from status blocks", async () => {
    const metadata = await readPlanMetadata({
      kind: "superintendent",
      absolutePath: "/repo/docs/plans/review-feature.md",
      path: "docs/plans/review-feature.md",
      fs: {
        readFile: async () => [
          "---",
          "kind: superintendent",
          "status:",
          "  state: review",
          "  round: 4",
          "  review_turn: 12",
          "---",
          "# Review feature"
        ].join("\n")
      }
    });

    expect(metadata).toEqual({
      title: "Review feature",
      detail: "review 12",
      format: "markdown"
    });
  });

  it("reads superintendent base metadata as a non-runnable base doc", async () => {
    const metadata = await readPlanMetadata({
      kind: "superintendent-base",
      absolutePath: "/repo/docs/plans/base.md",
      path: "docs/plans/base.md",
      fs: {
        readFile: async () => [
          "---",
          "kind: superintendent-base",
          "---",
          "# Shared base"
        ].join("\n")
      }
    });

    expect(metadata).toEqual({
      title: "Shared base",
      detail: "base doc",
      format: "markdown"
    });
  });

  it("uses the kind field when loading plan previews", async () => {
    const markdown = await loadPlanPreviewMarkdown(
      {
        absolutePath: "/repo/.poe-code/pipeline/plans/plan-feature.yaml",
        format: "yaml",
        kind: "pipeline",
        title: "plan-feature.yaml"
      },
      {
        readFile: async () => [
          "tasks:",
          "  - id: feature",
          "    title: Add feature",
          "    prompt: Ship it",
          "    status: done",
          ""
        ].join("\n")
      }
    );

    expect(markdown).toContain("# plan-feature.yaml");
    expect(markdown).toContain("- [x] Add feature (`feature`)");
  });
});
