import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { loadPipelineConfig, loadResolvedSteps } from "./loader.js";

type TestFs = ReturnType<typeof createFsFromVolume>["promises"];

function createFs(files: Record<string, string> = {}): TestFs {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises;
}

describe("loadResolvedSteps", () => {
  it("returns an empty map when no step config files exist", async () => {
    const steps = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs()
    });

    expect(steps).toEqual({});
  });

  it("loads global steps when only the home config exists", async () => {
    const steps = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    instruction: |",
          "      Implement {{id}}",
          ""
        ].join("\n")
      })
    });

    expect(steps).toEqual({
      implement: {
        mode: "yolo",
        instruction: "Implement {{id}}\n"
      }
    });
  });

  it("lets project steps override global steps by name", async () => {
    const steps = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/home/test/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    mode: read",
          "    instruction: Global instruction",
          "  test:",
          "    instruction: Run tests",
          ""
        ].join("\n"),
        "/repo/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    instruction: Project instruction",
          "  commit:",
          "    instruction: Commit changes",
          ""
        ].join("\n")
      })
    });

    expect(steps).toEqual({
      implement: {
        mode: "yolo",
        instruction: "Project instruction"
      },
      test: {
        mode: "yolo",
        instruction: "Run tests"
      },
      commit: {
        mode: "yolo",
        instruction: "Commit changes"
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
    const steps = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    instruction: Implement",
          "  review:",
          "    mode: read",
          "    instruction: Review",
          ""
        ].join("\n")
      })
    });

    expect(steps).toEqual({
      implement: {
        mode: "yolo",
        instruction: "Implement"
      },
      review: {
        mode: "read",
        instruction: "Review"
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
            "    instruction: Run tests",
            ""
          ].join("\n")
        })
      })
    ).rejects.toThrow(/missing instruction/i);
  });

  it("parses per-step agent and model overrides", async () => {
    const steps = await loadResolvedSteps({
      cwd: "/repo",
      homeDir: "/home/test",
      fs: createFs({
        "/repo/.poe-code/pipeline/steps.yaml": [
          "steps:",
          "  implement:",
          "    instruction: Implement",
          "    agent: codex",
          "    model: o3",
          "  review:",
          "    instruction: Review",
          "    agent: claude-code",
          "  commit:",
          "    instruction: Commit",
          ""
        ].join("\n")
      })
    });

    expect(steps).toEqual({
      implement: {
        mode: "yolo",
        instruction: "Implement",
        agent: "codex",
        model: "o3"
      },
      review: {
        mode: "yolo",
        instruction: "Review",
        agent: "claude-code"
      },
      commit: {
        mode: "yolo",
        instruction: "Commit"
      }
    });
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
