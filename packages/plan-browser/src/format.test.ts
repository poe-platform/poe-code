import { describe, expect, it } from "vitest";
import {
  deriveMarkdownTitle,
  formatExperimentDetail,
  formatPipelinePlanMarkdown,
  formatRalphDetail,
  getLastExperimentState,
  loadPlanPreviewMarkdown,
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

    expect(formatRalphDetail(data)).toBe("codex · ×3 · in_progress 2");
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

    expect(formatExperimentDetail(frontmatter, "open")).toBe(
      "claude-code, codex · maximize/minimize · open"
    );
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

  it("falls back to open when experiment journal content is empty or invalid", () => {
    expect(getLastExperimentState("")).toBe("open");
    expect(getLastExperimentState("{not-json")).toBe("open");
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

  it("reads generic kind metadata with detail and format fields", async () => {
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
