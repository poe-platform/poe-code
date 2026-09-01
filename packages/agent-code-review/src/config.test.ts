import { createMockFs } from "@poe-code/config-mutations/testing";
import { createConfigStore } from "@poe-code/poe-code-config/core";
import { describe, expect, it } from "vitest";
import { codeReviewConfigScope, parseCodeReviewConfigDocument } from "./config-scope.js";
import { loadCodeReviewConfig, resolveCodeReviewRunOptions } from "./config.js";

const homeConfigPath = "/home/test/.poe-code/config.json";
const projectConfigPath = "/repo/.poe-code/config.json";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("codeReview config", () => {
  it("uses code review defaults without introducing an agent override", async () => {
    const fs = createMockFs();

    await expect(loadCodeReviewConfig({ fs, filePath: homeConfigPath })).resolves.toEqual({
      draftStore: ".poe-code/code-review/reviews",
      humanGate: { provider: "none" },
      profileDirectories: []
    });
  });

  it("ignores inherited persisted codeReview blocks", async () => {
    const fs = createMockFs({
      [projectConfigPath]: "{}"
    });

    await withObjectPrototypeProperties(
      {
        codeReview: {
          profileDirectories: ["../catalog"]
        }
      },
      async () => {
        await expect(
          loadCodeReviewConfig({ fs, filePath: homeConfigPath, projectFilePath: projectConfigPath })
        ).resolves.toEqual({
          draftStore: ".poe-code/code-review/reviews",
          humanGate: { provider: "none" },
          profileDirectories: []
        });
      }
    );
  });

  it("does not ignore config read errors with inherited missing-file codes", async () => {
    const baseFs = createMockFs();
    const fs = {
      ...baseFs,
      readFile: async (filePath: string, encoding: "utf8") => {
        if (filePath === homeConfigPath) {
          throw new Error("config read denied");
        }
        return await baseFs.readFile(filePath, encoding);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(loadCodeReviewConfig({ fs, filePath: homeConfigPath })).rejects.toThrow(
        "config read denied"
      );
    });
  });

  it("ignores inherited codeReview scope fields", async () => {
    await withObjectPrototypeProperties(
      {
        agent: 123,
        draftStore: 456,
        profileDirectories: ["../catalog"]
      },
      () => {
        expect(parseCodeReviewConfigDocument({})).toEqual({});
      }
    );
  });

  it("ignores inherited humanGate provider fields", async () => {
    await withObjectPrototypeProperties({ provider: "unsupported" }, () => {
      expect(parseCodeReviewConfigDocument({ humanGate: {} })).toEqual({
        humanGate: { provider: "none" }
      });
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

  it("ignores inherited SDK run option overrides", async () => {
    const fs = createMockFs();

    await withObjectPrototypeProperties(
      {
        agent: "polluted-agent",
        draftStore: ".poe-code/code-review/polluted",
        humanGate: { provider: "none" },
        profileDirectories: ["/polluted-catalog"],
        sessionId: "polluted-session",
        additionalFeedback: "Polluted feedback"
      },
      async () => {
        await expect(
          resolveCodeReviewRunOptions(
            {
              prUrl: "https://github.com/poe-platform/poe-code/pull/42",
              cwd: "/repo"
            },
            { fs, filePath: homeConfigPath, projectFilePath: projectConfigPath }
          )
        ).resolves.toEqual({
          prUrl: "https://github.com/poe-platform/poe-code/pull/42",
          cwd: "/repo",
          draftStore: ".poe-code/code-review/reviews",
          humanGate: { provider: "none" },
          profileDirectories: []
        });
      }
    );
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

  it("rejects non-array SDK profile filters", async () => {
    const fs = createMockFs();

    await expect(
      resolveCodeReviewRunOptions(
        {
          prUrl: "https://github.com/poe-platform/poe-code/pull/42",
          cwd: "/repo",
          profiles: "generic" as unknown as string[]
        },
        { fs, filePath: homeConfigPath, projectFilePath: projectConfigPath }
      )
    ).rejects.toThrow("profiles must be an array of safe profile names.");
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
