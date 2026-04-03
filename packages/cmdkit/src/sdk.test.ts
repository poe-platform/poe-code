import { describe, expect, it, vi } from "vitest";
import { S } from "@poe-code/cmdkit-schema";
import { defineCommand, defineGroup } from "./index.js";
import { createSDK } from "./sdk.js";

describe("createSDK", () => {
  it("resolves nested sdk methods", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "generate",
          children: [
            defineGroup({
              name: "assets",
              children: [
                defineCommand({
                  name: "text",
                  scope: ["sdk"],
                  params: S.Object({
                    prompt: S.String(),
                  }),
                  handler: async ({ params }) => ({
                    content: params.prompt,
                  }),
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const sdk = createSDK(root);
    const result = await sdk.generate.assets.text({
      prompt: "hello",
    });

    expect(result).toEqual({
      content: "hello",
    });
  });

  it("converts command names and parameter keys to camelCase", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "bot-admin",
          children: [
            defineCommand({
              name: "create-bot",
              scope: ["sdk"],
              params: S.Object({
                bot_name: S.String(),
                bot_config: S.Object({
                  api_key: S.String(),
                }),
              }),
              handler: async ({ params }) => params,
            }),
          ],
        }),
      ],
    });

    const sdk = createSDK(root);
    const result = await sdk.botAdmin.createBot({
      botName: "assistant",
      botConfig: {
        apiKey: "secret",
      },
    });

    expect(result).toEqual({
      bot_name: "assistant",
      bot_config: {
        api_key: "secret",
      },
    });
  });

  it("includes only sdk-scoped commands", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "visible-command",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "visible",
        }),
        defineCommand({
          name: "hidden-command",
          scope: ["cli"],
          params: S.Object({}),
          handler: async () => "hidden",
        }),
        defineGroup({
          name: "mixed-group",
          children: [
            defineCommand({
              name: "sdk-child",
              scope: ["sdk"],
              params: S.Object({}),
              handler: async () => "sdk-child",
            }),
            defineCommand({
              name: "mcp-child",
              scope: ["mcp"],
              params: S.Object({}),
              handler: async () => "mcp-child",
            }),
          ],
        }),
      ],
    });

    const sdk = createSDK(root) as Record<string, unknown>;

    expect(typeof sdk.visibleCommand).toBe("function");
    expect("hiddenCommand" in sdk).toBe(false);
    expect("mixedGroup" in sdk).toBe(true);
    expect(sdk.mixedGroup).toEqual({
      sdkChild: expect.any(Function),
    });
  });

  it("uses effective scope from parent groups and default command scope", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "default-scope",
          children: [
            defineCommand({
              name: "default-visible",
              params: S.Object({}),
              handler: async () => "default-visible",
            }),
          ],
        }),
        defineGroup({
          name: "cli-only",
          scope: ["cli"],
          children: [
            defineCommand({
              name: "hidden-child",
              params: S.Object({}),
              handler: async () => "hidden-child",
            }),
            defineCommand({
              name: "explicit-sdk-child",
              scope: ["sdk"],
              params: S.Object({}),
              handler: async () => "explicit-sdk-child",
            }),
          ],
        }),
      ],
    });

    const sdk = createSDK(root) as Record<string, unknown>;

    expect(sdk.defaultScope).toEqual({
      defaultVisible: expect.any(Function),
    });
    expect(sdk.cliOnly).toEqual({
      explicitSdkChild: expect.any(Function),
    });
    expect("hiddenChild" in (sdk.cliOnly as Record<string, unknown>)).toBe(false);
  });

  it("resolves secrets, runs requirements, and ignores confirm while keeping progress as a no-op", async () => {
    const progress = vi.fn();
    const check = vi.fn(async () => ({ ok: true }));
    const originalApiKey = process.env.SDK_TEST_API_KEY;

    process.env.SDK_TEST_API_KEY = "secret";

    try {
      const root = defineGroup({
        name: "root",
        children: [
          defineCommand({
            name: "deploy",
            scope: ["sdk"],
            confirm: true,
            params: S.Object({
              project_name: S.String(),
            }),
            secrets: {
              apiKey: { env: "SDK_TEST_API_KEY" },
            },
            requires: {
              check,
            },
            handler: async ({ params, secrets, progress: reportProgress }) => {
              reportProgress("ignored");
              progress();
              return {
                project: params.project_name,
                apiKey: secrets.apiKey,
              };
            },
          }),
        ],
      });

      const sdk = createSDK(root);
      const result = await sdk.deploy({
        projectName: "demo",
      });

      expect(check).toHaveBeenCalledTimes(1);
      expect(progress).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        project: "demo",
        apiKey: "secret",
      });
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.SDK_TEST_API_KEY;
      } else {
        process.env.SDK_TEST_API_KEY = originalApiKey;
      }
    }
  });

  it("rethrows handler errors directly", async () => {
    const failure = new Error("boom");
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "explode",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => {
            throw failure;
          },
        }),
      ],
    });

    const sdk = createSDK(root);

    await expect(sdk.explode({})).rejects.toBe(failure);
  });
});
