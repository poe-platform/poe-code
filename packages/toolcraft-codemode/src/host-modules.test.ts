import { lint, run } from "@poe-code/safe-js/core";
import { createHumanInLoop, type HumanInLoopProvider } from "toolcraft/human-in-loop";
import { createSDK } from "toolcraft/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineCommand, defineGroup } from "toolcraft";
import { S } from "toolcraft-schema";

import { buildHostModules } from "./host-modules.js";

describe("buildHostModules", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes commands through SDK-backed SafeJS modules", async () => {
    vi.stubEnv("TOOLCRAFT_CODEMODE_TOKEN", "secret-token");

    const provider: HumanInLoopProvider = {
      id: "in-memory",
      requestApproval: vi.fn(async () => ({ outcome: "approved" }))
    };
    const secretHandler = vi.fn(async ({ secrets }: { secrets: { token: string } }) => ({
      token: secrets.token
    }));
    const deployHandler = vi.fn(async ({ params }: { params: { target: string } }) => ({
      deployed: params.target
    }));
    const root = defineGroup({
      name: "ops",
      children: [
        defineCommand({
          name: "read_secret",
          scope: ["sdk"],
          params: S.Object({}),
          secrets: {
            token: {
              env: "TOOLCRAFT_CODEMODE_TOKEN"
            }
          },
          handler: secretHandler
        }),
        defineGroup({
          name: "deploy",
          children: [
            defineCommand({
              name: "prod",
              scope: ["sdk"],
              params: S.Object({
                target: S.String()
              }),
              humanInLoop: {
                mode: "sync",
                message: ({ params, commandPath }) =>
                  `Deploy ${params.target} using ${commandPath}?`
              },
              handler: deployHandler
            })
          ]
        })
      ]
    });
    const sdk = createSDK(root, {
      humanInLoop: createHumanInLoop({
        provider
      })
    }) as {
      deploy: {
        prod(params: { target: string }): Promise<{ deployed: string }>;
      };
      readSecret(params: Record<string, never>): Promise<{ token: string }>;
    };

    const directResult = await sdk.deploy.prod({ target: "prod" });
    const directApproval = vi.mocked(provider.requestApproval).mock.calls[0]?.[0];
    const { lintModules, modules } = await buildHostModules(root, sdk);
    const source = [
      'import { read_secret } from "ops";',
      'import { prod } from "deploy";',
      "return JSON.stringify({",
      "  secret: await read_secret({}),",
      '  deploy: await prod({ target: "prod" })',
      "});"
    ].join("\n");

    expect(lint(source, { modules: lintModules })).toEqual([]);
    await expect(run(source, { modules })).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify({
        secret: {
          token: "secret-token"
        },
        deploy: {
          deployed: "prod"
        }
      })
    });

    expect(directResult).toEqual({
      deployed: "prod"
    });
    expect(secretHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: {
          token: "secret-token"
        }
      })
    );
    expect(vi.mocked(provider.requestApproval)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(provider.requestApproval).mock.calls[1]?.[0]).toEqual(directApproval);
  });

  it("formats module keys as dot-joined snake_case group paths while calling camelCase SDK members", async () => {
    const root = defineGroup({
      name: "ops-tools",
      children: [
        defineCommand({
          name: "root_command",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "root"
        }),
        defineGroup({
          name: "pull-requests",
          children: [
            defineGroup({
              name: "CodeReview",
              children: [
                defineCommand({
                  name: "list_reviews",
                  scope: ["sdk"],
                  params: S.Object({
                    state: S.String()
                  }),
                  handler: async ({ params }) => [`review:${params.state}`]
                })
              ]
            })
          ]
        })
      ]
    });
    const sdk = createSDK(root);

    const { lintModules, modules } = await buildHostModules(root, sdk);
    const source = [
      'import { root_command } from "ops_tools";',
      'import { list_reviews } from "pull_requests.code_review";',
      "return JSON.stringify({",
      "  root: await root_command({}),",
      '  reviews: await list_reviews({ state: "open" })',
      "});"
    ].join("\n");

    expect(modules).toEqual(
      expect.objectContaining({
        ops_tools: expect.objectContaining({
          root_command: expect.any(Function)
        }),
        "pull_requests.code_review": expect.objectContaining({
          list_reviews: expect.any(Function)
        })
      })
    );
    expect(modules).not.toHaveProperty("ops-tools");
    expect(modules).not.toHaveProperty("pull-requests.CodeReview");
    expect(lintModules).toEqual(
      expect.objectContaining({
        ops_tools: ["root_command"],
        "pull_requests.code_review": ["list_reviews"]
      })
    );
    expect(lint(source, { modules: lintModules })).toEqual([]);
    await expect(run(source, { modules })).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify({
        root: "root",
        reviews: ["review:open"]
      })
    });
  });

  it("executes canonical exports for dotted and prototype-like names", async () => {
    const root = defineGroup({
      name: "constructor",
      children: [
        defineCommand({
          name: "__proto__",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "proto"
        }),
        defineCommand({
          name: "constructor",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "constructor"
        }),
        defineGroup({
          name: "a.b",
          children: [
            defineCommand({
              name: "read.secret",
              scope: ["sdk"],
              params: S.Object({}),
              handler: async () => "dotted"
            })
          ]
        })
      ]
    });
    const { lintModules, modules } = await buildHostModules(root, createSDK(root));
    const source = [
      'import { proto } from "constructor";',
      'import { constructor } from "constructor";',
      'import { read_secret } from "a_b";',
      "return JSON.stringify([await proto({}), await constructor({}), await read_secret({})]);"
    ].join("\n");

    expect(lint(source, { modules: lintModules })).toEqual([]);
    await expect(run(source, { modules })).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["proto", "constructor", "dotted"])
    });
  });

  it("does not call SDK members inherited from the prototype chain", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "danger",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => null
        })
      ]
    });
    const entries = [
      {
        path: "danger",
        groupPath: "",
        name: "danger",
        sdkPath: ["danger"],
        command: root.children[0]
      }
    ];
    const sdk = Object.create({
      danger: async () => "polluted"
    }) as Record<string, unknown>;
    const { modules } = await buildHostModules(root, sdk, entries);

    await expect(modules.root?.danger({})).rejects.toThrow('SDK member "danger" is not callable.');
  });
});
