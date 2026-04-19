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
  it("embeds the skill content, plan directory, user request, and source document", () => {
    const prompt = buildPipelineInitPrompt({
      question: "Turn this into a pipeline plan",
      planDirectory: ".poe-code/pipeline/plans",
      sourceDocPath: "docs/plans/feature.md",
      sourceDocContent: "# Feature\nShip it.",
      skillContent: "SKILL BODY"
    });

    expect(prompt).toContain("SKILL BODY");
    expect(prompt).toContain("Plan directory: .poe-code/pipeline/plans");
    expect(prompt).toContain("User request:");
    expect(prompt).toContain("Turn this into a pipeline plan");
    expect(prompt).toContain("Source document:");
    expect(prompt).toContain("Path: docs/plans/feature.md");
    expect(prompt).toContain("# Feature\nShip it.");
  });

  it("uses the skill fallback instruction when the question is empty", () => {
    const prompt = buildPipelineInitPrompt({
      question: "   ",
      planDirectory: ".poe-code/pipeline/plans",
      sourceDocPath: "docs/plans/feature.md",
      sourceDocContent: "# Feature\nShip it.",
      skillContent: "SKILL BODY"
    });

    expect(prompt).toContain(
      "Convert the source document below into a pipeline plan. Treat the source document as the user request and do not ask the user for more input."
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
      planDirectory: ".poe-code/pipeline/plans",
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

  it("excludes files that already have a matching pipeline plan", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/docs/plans/feature.md": "# Feature\n",
        "/repo/docs/plans/another.md": "# Another\n",
        "/repo/.poe-code/pipeline/plans/plan-feature.yaml": "tasks: []\n"
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

  it("uses configured source and pipeline plan directories when filtering matches", async () => {
    const container = createCliContainer({
      fs: createMemFs({
        "/repo/.poe-code/config.json": JSON.stringify({
          plan: { plan_directory: "design-docs" },
          pipeline: { plan_directory: ".generated/pipeline-plans" }
        }),
        "/repo/design-docs/feature.md": "# Feature\n",
        "/repo/design-docs/keep-me.md": "# Keep me\n",
        "/repo/.generated/pipeline-plans/plan-feature.md": "---\ntasks: []\n"
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
