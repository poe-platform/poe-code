import { createMockFs } from "@poe-code/config-mutations/testing";
import { createConfigStore } from "@poe-code/poe-code-config";
import { describe, expect, it } from "vitest";
import { codeReviewConfigScope } from "./config-scope.js";
import { loadCodeReviewConfig, resolveCodeReviewRunOptions } from "./config.js";

const homeConfigPath = "/home/test/.poe-code/config.json";
const projectConfigPath = "/repo/.poe-code/config.json";

describe("codeReview config", () => {
  it("uses code review defaults without introducing an agent override", async () => {
    const fs = createMockFs();

    await expect(loadCodeReviewConfig({ fs, filePath: homeConfigPath })).resolves.toEqual({
      draftStore: ".poe-code/code-review/reviews",
      humanGate: { provider: "none" },
      profileDirectories: []
    });
  });

  it("resolves configured values through the shared config store", async () => {
    const fs = createMockFs({
      [projectConfigPath]: JSON.stringify({
        codeReview: {
          agent: "codex",
          draftStore: ".reviews",
          humanGate: { provider: "none" },
          profileDirectories: ["/catalog-a", "/catalog-b"]
        }
      })
    });
    const store = createConfigStore({
      fs,
      filePath: homeConfigPath,
      projectFilePath: projectConfigPath
    });

    await expect(store.scope(codeReviewConfigScope).getAll()).resolves.toEqual({
      agent: "codex",
      draftStore: ".reviews",
      humanGate: { provider: "none" },
      profileDirectories: ["/catalog-a", "/catalog-b"]
    });
  });

  it("lets SDK run input override project config", async () => {
    const fs = createMockFs({
      [projectConfigPath]: JSON.stringify({
        codeReview: {
          agent: "claude-code",
          draftStore: ".poe-code/code-review/from-config",
          humanGate: { provider: "none" },
          profileDirectories: ["/catalog-from-config"]
        }
      })
    });

    await expect(
      resolveCodeReviewRunOptions(
        {
          prUrl: "https://github.com/poe-platform/poe-code/pull/42",
          cwd: "/repo",
          agent: "codex",
          draftStore: ".poe-code/code-review/from-sdk",
          profileDirectories: ["/catalog-from-sdk"],
          additionalFeedback: "Please revisit the API boundary."
        },
        { fs, filePath: homeConfigPath, projectFilePath: projectConfigPath }
      )
    ).resolves.toEqual({
      prUrl: "https://github.com/poe-platform/poe-code/pull/42",
      cwd: "/repo",
      agent: "codex",
      draftStore: ".poe-code/code-review/from-sdk",
      humanGate: { provider: "none" },
      profileDirectories: ["/catalog-from-sdk"],
      additionalFeedback: "Please revisit the API boundary."
    });
  });

  it("rejects relative external profile directories", async () => {
    const fs = createMockFs({
      [projectConfigPath]: JSON.stringify({
        codeReview: { profileDirectories: ["../catalog"] }
      })
    });

    await expect(
      loadCodeReviewConfig({ fs, filePath: homeConfigPath, projectFilePath: projectConfigPath })
    ).rejects.toThrow("codeReview.profileDirectories entries must be absolute paths");
  });
});
