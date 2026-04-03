import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadPipelineConfig, loadResolvedSteps } from "./loader.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

function createFs(files: Record<string, string> = {}): TestFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises;
}

describe("loadResolvedSteps", () => {
  it("returns empty config when no step config files exist", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs()
    });

    expect(config).toEqual({ steps: {} });
  });

  it("returns empty steps for a comment-only steps.yaml", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps.yaml": [
          "# This is all comments",
          "# No actual steps defined",
          ""
        ].join("\n")
      })
    });

    expect(config).toEqual({ steps: {} });
  });

  it("loads global steps when only the home config exists", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    prompt: |",
          "      Implement {{id}}",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        mode: "yolo",
        prompt: "Implement {{id}}\n"
      }
    });
  });

  it("lets project steps override global steps by name", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    mode: read",
          "    prompt: Global instruction",
          "  test:",
          "    prompt: Run tests",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Project instruction",
          "  commit:",
          "    prompt: Commit changes",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        mode: "yolo",
        prompt: "Project instruction"
      },
      test: {
        mode: "yolo",
        prompt: "Run tests"
      },
      commit: {
        mode: "yolo",
        prompt: "Commit changes"
      }
    });
  });

  it("throws for invalid yaml", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps.yaml": "steps: ["
        })
      })
    ).rejects.toThrow(/invalid pipeline step config yaml/i);
  });

  it("defaults missing mode to yolo and still requires instruction", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Implement",
          "  review:",
          "    mode: read",
          "    prompt: Review",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        mode: "yolo",
        prompt: "Implement"
      },
      review: {
        mode: "read",
        prompt: "Review"
      }
    });

    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps.yaml": [
            "steps:",
            "  implement:",
            "    mode: read",
            "  test:",
            "    prompt: Run tests",
            ""
          ].join("\n")
        })
      })
    ).rejects.toThrow(/missing prompt/i);
  });

  it("parses per-step agent and model overrides", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    prompt: Implement",
          "    agent: codex",
          "    model: o3",
          "  review:",
          "    prompt: Review",
          "    agent: claude-code",
          "  commit:",
          "    prompt: Commit",
          ""
        ].join("\n")
      })
    });

    expect(config.steps).toEqual({
      implement: {
        mode: "yolo",
        prompt: "Implement",
        agent: "codex",
        model: "o3"
      },
      review: {
        mode: "yolo",
        prompt: "Review",
        agent: "claude-code"
      },
      commit: {
        mode: "yolo",
        prompt: "Commit"
      }
    });
  });

  it("parses setup and teardown from steps.yaml", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps.yaml": [
          "setup:",
          "  prompt: Prepare the workspace",
          "teardown:",
          "  mode: read",
          "  prompt: Verify and clean up",
          "steps:",
          "  commit:",
          "    prompt: Commit changes",
          ""
        ].join("\n")
      })
    });

    expect(config.setup).toEqual({ mode: "yolo", prompt: "Prepare the workspace" });
    expect(config.teardown).toEqual({ mode: "read", prompt: "Verify and clean up" });
    expect(config.steps).toEqual({ commit: { mode: "yolo", prompt: "Commit changes" } });
  });

  it("project setup/teardown overrides global setup/teardown", async () => {
    const config = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps.yaml": [
          "setup:",
          "  prompt: Global setup",
          "teardown:",
          "  prompt: Global teardown",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/steps.yaml": [
          "setup:",
          "  prompt: Project setup",
          ""
        ].join("\n")
      })
    });

    expect(config.setup).toEqual({ mode: "yolo", prompt: "Project setup" });
    expect(config.teardown).toEqual({ mode: "yolo", prompt: "Global teardown" });
  });

  it("requires instruction for setup and teardown", async () => {
    await expect(
      loadResolvedSteps({
        cwd: "/repo",
        homeDir: "/home/test",
        fs: createFs({
          "/repo/.poe-code/pipeline/steps.yaml": "setup:\n  mode: read\n"
        })
      })
    ).rejects.toThrow(/missing prompt for setup/i);
  });
});

describe("loadPipelineConfig", () => {
  it("returns merged global and project config with project precedence", async () => {
    const config = await loadPipelineConfig({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/config.yaml": "planPath: global-plan.yaml\n",
        "/repo/.poe-code/pipeline/config.yaml": "planPath: local-plan.yaml\n"
      })
    });

    expect(config).toEqual({
      planPath: "local-plan.yaml"
    });
  });
});
