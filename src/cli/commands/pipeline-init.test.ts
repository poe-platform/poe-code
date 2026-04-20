import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { buildPipelineInitPrompt, discoverPipelineInitSources } from "./pipeline-init.js";

const cwd = "/repo";
const homeDir = "/home/test";

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

describe("buildPipelineInitPrompt", () => {
  it("instructs in-place edit and embeds skill, user request, and source document", () => {
    const prompt = buildPipelineInitPrompt({
      question: "Turn this into a pipeline plan",
      sourceDocPath: "docs/plans/feature.md",
      sourceDocContent: "# Feature\nShip it.",
      skillContent: "SKILL BODY"
    });

    expect(prompt).toContain("SKILL BODY");
    expect(prompt).toContain("Edit docs/plans/feature.md directly");
    expect(prompt).not.toContain("Plan directory:");
    expect(prompt).toContain("User request:");
    expect(prompt).toContain("Turn this into a pipeline plan");
    expect(prompt).toContain("Source document:");
    expect(prompt).toContain("Path: docs/plans/feature.md");
    expect(prompt).toContain("# Feature\nShip it.");
  });

  it("uses an in-place fallback request when the question is empty", () => {
    const prompt = buildPipelineInitPrompt({
      question: "   ",
      sourceDocPath: "docs/plans/feature.md",
      sourceDocContent: "# Feature\nShip it.",
      skillContent: "SKILL BODY"
    });

    expect(prompt).toContain(
      'Add pipeline frontmatter to "Feature" in place, based on the document below. Do not create a separate plan file and do not ask for more input.'
    );
    expect(prompt).not.toContain("one-sentence description");
  });

  it("uses a safe fence when the source document contains triple backticks", () => {
    const sourceDocContent = [
      "# Feature",
      "```ts",
      "const value = 1;",
      "```",
      ""
    ].join("\n");

    const prompt = buildPipelineInitPrompt({
      question: "Turn this into a pipeline plan",
      sourceDocPath: "docs/plans/feature.md",
      sourceDocContent,
      skillContent: "SKILL BODY"
    });

    expect(prompt).toContain(sourceDocContent);
    expect(prompt).toContain("````markdown");
    expect(prompt).toContain("\n````");
  });
});

describe("discoverPipelineInitSources", () => {
  it("excludes files under archive", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/feature.md": "# Feature\n",
        "/repo/docs/plans/archive/archived.md": "# Archived\n"
      }),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    const sources = await discoverPipelineInitSources({ container });

    expect(sources).toEqual([
      {
        absolutePath: "/repo/docs/plans/feature.md",
        relativePath: "feature.md",
        title: "Feature"
      }
    ]);
  });

  it("excludes files that already carry kind: pipeline frontmatter", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/feature.md": [
          "---",
          "kind: pipeline",
          "version: 1",
          "tasks: []",
          "---",
          "",
          "# Feature",
          ""
        ].join("\n"),
        "/repo/docs/plans/another.md": "# Another\n"
      }),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    const sources = await discoverPipelineInitSources({ container });

    expect(sources).toEqual([
      {
        absolutePath: "/repo/docs/plans/another.md",
        relativePath: "another.md",
        title: "Another"
      }
    ]);
  });

  it("keeps files whose frontmatter is not a pipeline plan", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/feature.md": [
          "---",
          "title: Feature",
          "---",
          "",
          "# Feature",
          ""
        ].join("\n")
      }),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    const sources = await discoverPipelineInitSources({ container });

    expect(sources).toEqual([
      {
        absolutePath: "/repo/docs/plans/feature.md",
        relativePath: "feature.md",
        title: "Feature"
      }
    ]);
  });

  it("uses the configured source plan directory", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          plan: { plan_directory: "design-docs" }
        }),
        "/repo/design-docs/keep-me.md": "# Keep me\n"
      }),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    const sources = await discoverPipelineInitSources({ container });

    expect(sources).toEqual([
      {
        absolutePath: "/repo/design-docs/keep-me.md",
        relativePath: "keep-me.md",
        title: "Keep me"
      }
    ]);
  });

  it("falls back to the basename when a file has no top-level heading", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/no-heading.md": "No heading here.\n"
      }),
      prompts: async () => ({}),
      env: { cwd, homeDir },
      logger: () => {}
    });

    const sources = await discoverPipelineInitSources({ container });

    expect(sources).toEqual([
      {
        absolutePath: "/repo/docs/plans/no-heading.md",
        relativePath: "no-heading.md",
        title: "no-heading"
      }
    ]);
  });
});
