import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";
import {
  ToolcraftBugError,
  UserError,
  assertCommandRequirements,
  defineCommand,
  defineGroup,
  getCommandSourcePath,
  resolveCommandSecrets
} from "./index.js";
import {
  ERROR_INTERNAL,
  ERROR_INVALID_PARAMS,
  McpClient,
  McpError,
  createSdkTestPair
} from "tiny-mcp-client";
import { createMCPServer } from "./mcp.js";
import { createHumanInLoop } from "./human-in-loop/index.js";
import { createHttpError } from "./http-errors.js";
import { renderResult } from "./renderer.js";
import type { OutputMode } from "./renderer.js";
import type { RenderPrimitives } from "./index.js";
import { createSDK } from "./sdk.js";

function createPrimitives(): {
  primitives: RenderPrimitives;
  renderTable: ReturnType<typeof vi.fn>;
} {
  const renderTable = vi.fn(
    (options: {
      columns: Array<{ name: string; title: string }>;
      rows: Record<string, string>[];
    }) =>
      JSON.stringify({
        columns: options.columns.map((column) => ({ name: column.name, title: column.title })),
        rows: options.rows
      })
  );

  return {
    primitives: {
      logger: {
        info: vi.fn(),
        success: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        resolved: vi.fn(),
        errorResolved: vi.fn(),
        message: vi.fn()
      },
      renderTable,
      getTheme: vi.fn(() => ({
        header: (value: string) => value,
        muted: (value: string) => value
      })),
      note: vi.fn(),
      outputFormat: "rich"
    },
    renderTable
  };
}

function runRender(
  command: ReturnType<typeof defineCommand>,
  result: unknown,
  output: OutputMode
): string {
  const { primitives } = createPrimitives();
  let rendered = "";

  renderResult(command, result, output, primitives, (chunk) => {
    rendered += chunk;
  });

  return rendered;
}

describe("toolcraft", () => {
  function createPreflightContext() {
    return {
      fetch: globalThis.fetch,
      fs: {
        readFile: async () => "",
        writeFile: async () => undefined,
        exists: async () => true
      },
      env: {
        get: () => undefined
      },
      progress: () => undefined
    };
  }

  it("uses toolcraft symbol descriptions for internal metadata", () => {
    const command = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => null
    });
    const group = defineGroup({
      name: "root",
      children: [command]
    });

    expect(Object.getOwnPropertySymbols(command).map((symbol) => symbol.description)).toContain(
      "toolcraft.command.config"
    );
    expect(Object.getOwnPropertySymbols(group).map((symbol) => symbol.description)).toContain(
      "toolcraft.group.config"
    );
  });

  it("rejects invalid rename paths at group definition time", () => {
    expect(() =>
      defineGroup({
        name: "root",
        rename: {
          create_issue: ""
        },
        children: []
      })
    ).toThrowError(
      new UserError('Invalid rename target for upstream tool "create_issue": path cannot be empty.')
    );

    expect(() =>
      defineGroup({
        name: "root",
        rename: {
          create_issue: ".issues.create"
        },
        children: []
      })
    ).toThrowError(
      new UserError(
        'Invalid rename target for upstream tool "create_issue": ".issues.create" contains an empty segment.'
      )
    );

    expect(() =>
      defineGroup({
        name: "root",
        rename: {
          create_issue: "issues.create."
        },
        children: []
      })
    ).toThrowError(
      new UserError(
        'Invalid rename target for upstream tool "create_issue": "issues.create." contains an empty segment.'
      )
    );

    expect(() =>
      defineGroup({
        name: "root",
        rename: {
          create_issue: "issues..create"
        },
        children: []
      })
    ).toThrowError(
      new UserError(
        'Invalid rename target for upstream tool "create_issue": "issues..create" contains an empty segment.'
      )
    );
  });

  it("rejects duplicate rename targets at group definition time", () => {
    expect(() =>
      defineGroup({
        name: "root",
        rename: {
          create_issue: "issues.create",
          open_issue: "issues.create"
        },
        children: []
      })
    ).toThrowError(
      new UserError(
        'Duplicate rename target "issues.create" for upstream tools "create_issue" and "open_issue".'
      )
    );
  });

  it("ignores installed toolcraft stack frames when inferring a command source path", () => {
    const OriginalError = globalThis.Error;

    class MockError extends OriginalError {
      override stack =
        "Error\n" +
        "    at defineCommand (file:///repo/node_modules/toolcraft/dist/index.js:10:5)\n" +
        "    at createCommand (file:///repo/src/commands/deploy.ts:20:3)\n";
    }

    globalThis.Error = MockError as ErrorConstructor;

    try {
      const command = defineCommand({
        name: "deploy",
        params: S.Object({}),
        handler: async () => null
      });

      expect(getCommandSourcePath(command)).toBe("/repo/src/commands/deploy.ts");
    } finally {
      globalThis.Error = OriginalError;
    }
  });

  it("inherits secrets through nested groups", () => {
    const leaf = defineCommand({
      name: "leaf",
      params: S.Object({
        name: S.String()
      }),
      secrets: {
        leafToken: {
          env: "LEAF_TOKEN"
        }
      },
      handler: async () => null
    });

    const nested = defineGroup({
      name: "nested",
      secrets: {
        nestedToken: {
          env: "NESTED_TOKEN",
          optional: true
        }
      },
      children: [leaf]
    });

    const root = defineGroup({
      name: "root",
      secrets: {
        rootToken: {
          env: "ROOT_TOKEN",
          description: "Root token"
        }
      },
      children: [nested]
    });

    const inheritedLeaf = root.children[0];
    expect(inheritedLeaf.kind).toBe("group");
    if (inheritedLeaf.kind !== "group") {
      throw new Error("Expected nested group");
    }

    const command = inheritedLeaf.children[0];
    expect(command.kind).toBe("command");
    if (command.kind !== "command") {
      throw new Error("Expected leaf command");
    }

    expect(command.secrets).toEqual({
      rootToken: {
        env: "ROOT_TOKEN",
        description: "Root token"
      },
      nestedToken: {
        env: "NESTED_TOKEN",
        optional: true
      },
      leafToken: {
        env: "LEAF_TOKEN"
      }
    });
  });

  it("inherits scope through nested groups unless a child overrides it", () => {
    const inheritedLeaf = defineCommand({
      name: "inherited",
      params: S.Object({
        value: S.String()
      }),
      handler: async () => null
    });

    const overriddenLeaf = defineCommand({
      name: "overridden",
      scope: ["sdk"],
      params: S.Object({
        value: S.String()
      }),
      handler: async () => null
    });

    const nested = defineGroup({
      name: "nested",
      children: [inheritedLeaf, overriddenLeaf]
    });

    const root = defineGroup({
      name: "root",
      scope: ["mcp"],
      children: [nested]
    });

    const group = root.children[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      throw new Error("Expected nested group");
    }

    expect(group.scope).toEqual(["mcp"]);
    expect(group.children[0]?.kind).toBe("command");
    expect(group.children[1]?.kind).toBe("command");

    if (group.children[0]?.kind !== "command" || group.children[1]?.kind !== "command") {
      throw new Error("Expected commands");
    }

    expect(group.children[0].scope).toEqual(["mcp"]);
    expect(group.children[1].scope).toEqual(["sdk"]);
  });

  it("inherits and composes requires through group nesting", async () => {
    const calls: string[] = [];
    const rootCheck = vi.fn(async () => {
      calls.push("root");
      return { ok: true };
    });
    const nestedCheck = vi.fn(async () => {
      calls.push("nested");
      return { ok: true };
    });
    const leafCheck = vi.fn(async () => {
      calls.push("leaf");
      return { ok: true };
    });

    const leaf = defineCommand({
      name: "leaf",
      params: S.Object({
        name: S.String()
      }),
      requires: {
        check: leafCheck
      },
      handler: async () => null
    });

    const nested = defineGroup({
      name: "nested",
      requires: {
        apiVersion: "2026-01-01",
        check: nestedCheck
      },
      children: [leaf]
    });

    const root = defineGroup({
      name: "root",
      requires: {
        auth: true,
        check: rootCheck
      },
      children: [nested]
    });

    const group = root.children[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      throw new Error("Expected nested group");
    }

    const command = group.children[0];
    expect(command.kind).toBe("command");
    if (command.kind !== "command") {
      throw new Error("Expected leaf command");
    }

    expect(command.requires?.auth).toBe(true);
    expect(command.requires?.apiVersion).toBe("2026-01-01");

    const result = await command.requires?.check?.({
      params: { name: "demo" },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: async () => "",
        writeFile: async () => undefined,
        exists: async () => true
      },
      env: {
        get: () => undefined
      },
      progress: () => undefined
    });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["root", "nested", "leaf"]);
  });

  it("stops running descendant checks when an ancestor check fails", async () => {
    const nestedCheck = vi.fn(async () => ({ ok: true }));
    const leafCheck = vi.fn(async () => ({ ok: true }));

    const leaf = defineCommand({
      name: "leaf",
      params: S.Object({
        name: S.String()
      }),
      requires: {
        check: leafCheck
      },
      handler: async () => null
    });

    const nested = defineGroup({
      name: "nested",
      requires: {
        check: nestedCheck
      },
      children: [leaf]
    });

    const root = defineGroup({
      name: "root",
      requires: {
        check: async () => ({
          ok: false,
          message: "blocked"
        })
      },
      children: [nested]
    });

    const group = root.children[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      throw new Error("Expected nested group");
    }

    const command = group.children[0];
    expect(command.kind).toBe("command");
    if (command.kind !== "command") {
      throw new Error("Expected leaf command");
    }

    const result = await command.requires?.check?.({
      params: { name: "demo" },
      secrets: {},
      fetch: globalThis.fetch,
      fs: {
        readFile: async () => "",
        writeFile: async () => undefined,
        exists: async () => true
      },
      env: {
        get: () => undefined
      },
      progress: () => undefined
    });

    expect(result).toEqual({
      ok: false,
      message: "blocked"
    });
    expect(nestedCheck).not.toHaveBeenCalled();
    expect(leafCheck).not.toHaveBeenCalled();
  });

  it("keeps secret definitions isolated from source config mutations and sibling nodes", () => {
    const rootSecret = {
      env: "ROOT_TOKEN",
      description: "Root token"
    };
    const leafSecret = {
      env: "LEAF_TOKEN"
    };

    const leaf = defineCommand({
      name: "leaf",
      params: S.Object({
        name: S.String()
      }),
      secrets: {
        leafToken: leafSecret
      },
      handler: async () => null
    });

    const nested = defineGroup({
      name: "nested",
      children: [leaf]
    });

    const root = defineGroup({
      name: "root",
      secrets: {
        rootToken: rootSecret
      },
      children: [nested]
    });

    rootSecret.env = "MUTATED_ROOT_TOKEN";
    leafSecret.env = "MUTATED_LEAF_TOKEN";

    expect(root.secrets.rootToken).toEqual({
      env: "ROOT_TOKEN",
      description: "Root token"
    });

    const group = root.children[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      throw new Error("Expected nested group");
    }

    const command = group.children[0];
    expect(command.kind).toBe("command");
    if (command.kind !== "command") {
      throw new Error("Expected leaf command");
    }

    expect(command.secrets).toEqual({
      rootToken: {
        env: "ROOT_TOKEN",
        description: "Root token"
      },
      leafToken: {
        env: "LEAF_TOKEN"
      }
    });

    command.secrets.rootToken.description = "Leaf view";
    expect(root.secrets.rootToken.description).toBe("Root token");
    expect(group.secrets.rootToken.description).toBe("Root token");
  });

  it("throws when a required secret has no description", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: { env: "TOKEN" }
      },
      handler: async () => null
    });

    expect(() => resolveCommandSecrets(cmd, {})).toThrowError(
      new UserError("Missing required secret TOKEN")
    );
  });

  it("suggests close missing required secret environment variable names", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: { env: "POE_API_KEY" }
      },
      handler: async () => null
    });

    expect(() => resolveCommandSecrets(cmd, { POE_KEY: "set" })).toThrowError(
      new UserError("Missing required secret POE_API_KEY\nDid you mean: POE_KEY?")
    );
  });

  it("does not filter out close missing secret names with different underscore placement", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: { env: "POE_API_KEY" }
      },
      handler: async () => null
    });

    expect(() => resolveCommandSecrets(cmd, { POE_APIKEY: "set", POE_KEY: "set" })).toThrowError(
      new UserError("Missing required secret POE_API_KEY\nDid you mean: POE_APIKEY, POE_KEY?")
    );
  });

  it("does not suggest distant missing required secret names for short inputs", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: { env: "ABC" }
      },
      handler: async () => null
    });

    expect(() => resolveCommandSecrets(cmd, { XYZ: "set" })).toThrowError(
      new UserError("Missing required secret ABC")
    );
  });

  it("does not suggest env names that only add an unrelated prefix", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: { env: "API_KEY" }
      },
      handler: async () => null
    });

    expect(() => resolveCommandSecrets(cmd, { POE_API_KEY: "set" })).toThrowError(
      new UserError("Missing required secret API_KEY")
    );
  });

  it("appends missing secret suggestions without replacing the description", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: {
          env: "TOKEN",
          description: "Set it before running cmd."
        }
      },
      handler: async () => null
    });

    expect(() => resolveCommandSecrets(cmd, { TOKNE: "set" })).toThrowError(
      new UserError(
        "Missing required secret TOKEN\n  Set it before running cmd.\nDid you mean: TOKNE?"
      )
    );
  });

  it("passes undefined for optional secrets that are missing", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: {
        token: { env: "TOKEN", optional: true }
      },
      handler: async () => null
    });

    expect(resolveCommandSecrets(cmd, {})).toEqual({ token: undefined });
  });

  it("preserves a declared __proto__ secret in resolved command secrets", () => {
    const cmd = defineCommand({
      name: "cmd",
      params: S.Object({}),
      secrets: JSON.parse('{"__proto__":{"env":"TOKEN"}}'),
      handler: async () => null
    });

    const secrets = resolveCommandSecrets(cmd, { TOKEN: "visible" });
    expect(Object.prototype.hasOwnProperty.call(secrets, "__proto__")).toBe(true);
    expect(secrets["__proto__"]).toBe("visible");
  });

  it("throws when a required inherited secret is missing", () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      handler: async () => null
    });

    const root = defineGroup({
      name: "root",
      secrets: {
        apiKey: {
          env: "API_KEY",
          description: "Set it before running deploy."
        }
      },
      children: [deploy]
    });

    const command = root.children[0];
    expect(command?.kind).toBe("command");
    if (command?.kind !== "command") {
      throw new Error("Expected deploy command");
    }

    expect(() =>
      resolveCommandSecrets(command, {
        API_KEY: undefined
      })
    ).toThrowError(
      new UserError("Missing required secret API_KEY\n  Set it before running deploy.")
    );
  });

  it("throws when auth is required and the auth env var is missing", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        auth: true
      },
      handler: async () => null
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext(), {
        env: {}
      })
    ).rejects.toThrowError(
      new UserError(`Command "deploy" requires authentication.\n  Run 'poe-code login' first.`)
    );
  });

  it("throws when the runner api version does not satisfy the command requirement", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        apiVersion: ">=2.4.0"
      },
      handler: async () => null
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext(), {
        apiVersion: "2.3.9"
      })
    ).rejects.toThrowError(
      new UserError(
        'Command "deploy" requires API version >=2.4.0, but runner API version is 2.3.9.'
      )
    );
  });

  it("throws when a custom requirement check fails", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        check: async () => ({
          ok: false,
          message: "Account is not allowed to deploy."
        })
      },
      handler: async () => null
    });

    await expect(assertCommandRequirements(deploy, createPreflightContext())).rejects.toThrowError(
      new UserError("Account is not allowed to deploy.")
    );
  });

  it("uses a fallback message when check fails without one", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        check: async () => ({ ok: false })
      },
      handler: async () => null
    });

    await expect(assertCommandRequirements(deploy, createPreflightContext())).rejects.toThrowError(
      new UserError("Command precondition failed.")
    );
  });

  it("throws when apiVersion requirement has invalid format", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        apiVersion: "1.0.0"
      },
      handler: async () => null
    });

    await expect(assertCommandRequirements(deploy, createPreflightContext())).rejects.toThrowError(
      new UserError(
        'Command "deploy" has invalid apiVersion requirement "1.0.0". Expected format ">=X.Y.Z".'
      )
    );
  });

  it("throws when apiVersion is required but runner provides none", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        apiVersion: ">=1.0.0"
      },
      handler: async () => null
    });

    await expect(assertCommandRequirements(deploy, createPreflightContext())).rejects.toThrowError(
      new UserError(
        'Command "deploy" requires API version >=1.0.0, but no runner API version was provided.'
      )
    );
  });

  it("throws when runner apiVersion is not valid semver", async () => {
    const deploy = defineCommand({
      name: "deploy",
      params: S.Object({}),
      requires: {
        apiVersion: ">=1.0.0"
      },
      handler: async () => null
    });

    await expect(
      assertCommandRequirements(deploy, createPreflightContext(), {
        apiVersion: "not-semver"
      })
    ).rejects.toThrowError(
      new UserError(
        'Command "deploy" requires API version >=1.0.0, but runner API version "not-semver" is not valid semver.'
      )
    );
  });

  it("materializes the default command and validates the declaration", () => {
    const run = defineCommand({
      name: "run",
      positional: ["name"],
      params: S.Object({
        name: S.String()
      }),
      handler: async () => null
    });

    const list = defineCommand({
      name: "list",
      params: S.Object({}),
      handler: async () => null
    });

    const root = defineGroup({
      name: "root",
      scope: ["mcp"],
      secrets: {
        rootToken: {
          env: "ROOT_TOKEN"
        }
      },
      requires: {
        auth: true
      },
      children: [run, list],
      default: run
    });

    expect(root.default).toBe(root.children[0]);
    expect(root.default?.scope).toEqual(["mcp"]);
    expect(root.default?.secrets).toEqual({
      rootToken: {
        env: "ROOT_TOKEN"
      }
    });
    expect(root.default?.requires).toEqual({
      auth: true,
      apiVersion: undefined,
      check: undefined
    });

    expect(() =>
      defineGroup({
        name: "invalid",
        children: [list],
        default: run
      })
    ).toThrowError(new ToolcraftBugError('Default command "run" must be listed in children.'));
  });
});

describe("createMCPServer", () => {
  const originalPoeApiKey = process.env.POE_API_KEY;
  const originalApiKey = process.env.API_KEY;

  afterEach(() => {
    process.env.POE_API_KEY = originalPoeApiKey;
    process.env.API_KEY = originalApiKey;
  });

  async function createClient(server: ReturnType<typeof createMCPServer>) {
    return createSdkTestPair(
      server,
      () =>
        new McpClient({
          clientInfo: {
            name: "test-client",
            version: "1.0.0"
          }
        })
    );
  }

  it("keeps the root group name in MCP tool names by default", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async () => "ok"
        })
      ]
    });

    const server = createMCPServer(root, {
      approvals: true,
      humanInLoop: createHumanInLoop({
        provider: {
          id: "test-provider",
          requestApproval: async () => ({ outcome: "approved" as const })
        }
      }),
      name: "toolcraft-test",
      version: "1.0.0"
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toContain("root__deploy");
    } finally {
      await cleanup();
    }
  });

  it("rejects MCP commands that normalize to the same tool name", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "runTask",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async () => "camel"
        }),
        defineCommand({
          name: "run_task",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async () => "snake"
        })
      ]
    });

    expect(() =>
      createMCPServer(root, {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true
      })
    ).toThrow('MCP commands "runTask" and "run_task" use conflicting tool name "run_task".');
  });

  it("lists only mcp-scoped commands that match the allowlist and applies schema casing", async () => {
    const usage = defineCommand({
      name: "usage",
      description: "Show usage",
      scope: ["mcp"],
      params: S.Object({
        previewMode: S.Boolean(),
        botConfig: S.Object({
          apiKey: S.String()
        })
      }),
      handler: async () => "usage"
    });

    const create = defineCommand({
      name: "create",
      description: "Create bot",
      params: S.Object({
        botName: S.String()
      }),
      handler: async () => "created"
    });

    const remove = defineCommand({
      name: "remove",
      description: "Remove bot",
      scope: ["cli"],
      params: S.Object({}),
      handler: async () => "removed"
    });

    const sdkOnly = defineCommand({
      name: "sdk-only",
      description: "SDK only",
      scope: ["sdk"],
      params: S.Object({}),
      handler: async () => "sdk"
    });

    const root = defineGroup({
      name: "root",
      children: [
        usage,
        defineGroup({
          name: "bot",
          scope: ["mcp"],
          children: [create, remove]
        }),
        sdkOnly
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true,
      tools: ["usage", "bot"]
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual(["usage", "bot__create"]);
      expect(result.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: {
          preview_mode: {
            type: "boolean"
          },
          bot_config: {
            type: "object",
            properties: {
              api_key: {
                type: "string"
              }
            },
            required: ["api_key"],
            additionalProperties: false
          }
        },
        required: ["preview_mode", "bot_config"],
        additionalProperties: false
      });
      expect(result.tools[1]?.inputSchema).toEqual({
        type: "object",
        properties: {
          bot_name: {
            type: "string"
          }
        },
        required: ["bot_name"],
        additionalProperties: false
      });
    } finally {
      await cleanup();
    }
  });

  it("keeps positive schema descriptions in MCP metadata when CLI wording differs", async () => {
    const inspect = defineCommand({
      name: "inspect",
      scope: ["mcp"],
      params: S.Object({
        open: S.Optional(
          S.Boolean({
            default: true,
            description: "Open the login URL in the default browser",
            cliDescription: "Do not open the login URL in the default browser"
          })
        )
      }),
      handler: async () => null
    });
    const server = createMCPServer(defineGroup({ name: "root", children: [inspect] }), {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();
      expect(result.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: {
          open: {
            type: "boolean",
            description: "Open the login URL in the default browser",
            default: true
          }
        },
        required: [],
        additionalProperties: false
      });
    } finally {
      await cleanup();
    }
  });

  it("preserves required array params for MCP when CLI-only helper flags make the direct param optional", async () => {
    const generate = defineCommand({
      name: "generate",
      description: "Generate starters",
      scope: ["mcp"],
      params: S.Object({
        starters: S.Optional(
          S.Array(S.String(), {
            requiredScopes: ["mcp", "sdk"]
          })
        ),
        startersJson: S.Optional(
          S.String({
            description: "JSON-encoded value for starters.",
            scope: ["cli"]
          })
        )
      }),
      handler: async () => "generated"
    });
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "bots",
          children: [generate]
        })
      ]
    });
    const server = createMCPServer(root, {
      approvals: true,
      humanInLoop: createHumanInLoop({
        provider: {
          id: "test-provider",
          requestApproval: async () => ({ outcome: "approved" as const })
        }
      }),
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: {
          starters: {
            type: "array",
            items: {
              type: "string"
            }
          }
        },
        required: ["starters"],
        additionalProperties: false
      });
    } finally {
      await cleanup();
    }
  });

  it("preserves declared __proto__ parameters through MCP dispatch", async () => {
    const handler = vi.fn(async ({ params }: { params: Record<string, unknown> }) => params);
    const paramsShape = Object.fromEntries([["__proto__", S.String()]]) as Record<
      string,
      ReturnType<typeof S.String>
    >;
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "probe",
          scope: ["mcp"],
          params: S.Object(paramsShape),
          handler
        })
      ]
    });
    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      await client.callTool({ name: "probe", arguments: { proto: "visible" } });
      const params = handler.mock.calls[0]?.[0].params;
      expect(Object.prototype.hasOwnProperty.call(params, "__proto__")).toBe(true);
      expect(params?.["__proto__"]).toBe("visible");
    } finally {
      await cleanup();
    }
  });

  it("rejects MCP parameters that normalize to the same input field", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "submit",
          scope: ["mcp"],
          params: S.Object({
            fooBar: S.String(),
            foo_bar: S.String()
          }),
          handler: async ({ params }) => params
        })
      ]
    });

    expect(() =>
      createMCPServer(root, {
        name: "toolcraft-test",
        version: "1.0.0",
        omitRootToolNamePrefix: true
      })
    ).toThrow('Parameters "fooBar" and "foo_bar" use conflicting MCP field "foo_bar".');
  });

  it("filters params whose schema scope excludes MCP", async () => {
    const run = defineCommand({
      name: "run",
      scope: ["mcp"],
      params: S.Object({
        endpoint: S.String(),
        preview: S.Optional(S.Boolean({ scope: ["cli", "sdk"] })),
        verbose: S.Optional(S.Boolean({ scope: ["cli", "sdk"] }))
      }),
      handler: async ({ params }) => params
    });

    const root = defineGroup({
      name: "root",
      children: [run]
    });

    const server = createMCPServer(root, {
      approvals: true,
      humanInLoop: createHumanInLoop({
        provider: {
          id: "test-provider",
          requestApproval: async () => ({ outcome: "approved" as const })
        }
      }),
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools).toHaveLength(3);
      expect(result.tools[0]?.name).toBe("run");
      expect(result.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: {
          endpoint: {
            type: "string"
          }
        },
        required: ["endpoint"],
        additionalProperties: false
      });
    } finally {
      await cleanup();
    }
  });

  it("preserves nullable metadata in MCP schemas and accepts null arguments", async () => {
    const run = defineCommand({
      name: "run",
      scope: ["mcp"],
      params: S.Object({
        limit: S.Optional(
          S.Number({
            jsonType: "integer",
            nullable: true
          })
        )
      }),
      handler: async ({ params }) => params
    });

    const root = defineGroup({
      name: "root",
      children: [run]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: {
          limit: {
            type: "integer",
            nullable: true
          }
        },
        required: [],
        additionalProperties: false
      });

      const callResult = await client.callTool({
        name: "run",
        arguments: {
          limit: null
        }
      });

      expect(callResult.isError).not.toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("rejects fractional MCP arguments for integer params", async () => {
    const run = defineCommand({
      name: "run",
      scope: ["mcp"],
      params: S.Object({
        count: S.Number({
          jsonType: "integer"
        })
      }),
      handler: async ({ params }) => params
    });

    const root = defineGroup({
      name: "root",
      children: [run]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "run",
          arguments: {
            count: 1.5
          }
        })
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes('Invalid value for "count". Expected an integer, got 1.5.')
      );
    } finally {
      await cleanup();
    }
  });

  it("rejects MCP arguments that violate string, number, and array constraints", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);
    const run = defineCommand({
      name: "run",
      scope: ["mcp"],
      params: S.Object({
        slug: S.String({ minLength: 3, maxLength: 5, pattern: "^[a-z]+$" }),
        count: S.Number({ minimum: 1, maximum: 3 }),
        tags: S.Array(S.String(), { minItems: 2, maxItems: 2 })
      }),
      handler
    });

    const root = defineGroup({
      name: "root",
      children: [run]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "run",
          arguments: {
            slug: "BAD",
            count: 99,
            tags: ["only-one"]
          }
        })
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("3 parameter errors:") &&
          error.message.includes(
            'Invalid value for "slug": "BAD" does not match pattern "^[a-z]+$".'
          ) &&
          error.message.includes(
            'Invalid value for "count". Expected a number greater than or equal to 1 and less than or equal to 3, got 99.'
          ) &&
          error.message.includes(
            'Invalid value for "tags". Expected an array with at least 2 items, got array(1).'
          )
      );
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("describes received MCP argument values in validation errors", async () => {
    const run = defineCommand({
      name: "run",
      scope: ["mcp"],
      params: S.Object({
        name: S.String(),
        enabled: S.Boolean(),
        tags: S.Array(S.String()),
        config: S.Object({ mode: S.String() }),
        mode: S.Enum(["safe", "fast"] as const)
      }),
      handler: async ({ params }) => params
    });

    const root = defineGroup({
      name: "root",
      children: [run]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const longMode = "x".repeat(45);

      for (const [argumentsValue, expected] of [
        [
          { name: 123, enabled: true, tags: [], config: { mode: "safe" }, mode: "safe" },
          'Invalid value for "name". Expected a string, got 123.'
        ],
        [
          { name: "Ada", enabled: "yes", tags: [], config: { mode: "safe" }, mode: "safe" },
          'Invalid value for "enabled". Expected a boolean, got "yes".'
        ],
        [
          { name: "Ada", enabled: true, tags: "core", config: { mode: "safe" }, mode: "safe" },
          'Invalid value for "tags". Expected an array, got "core".'
        ],
        [
          { name: "Ada", enabled: true, tags: [], config: [], mode: "safe" },
          'Invalid value for "config". Expected an object, got array(0).'
        ],
        [
          { name: "Ada", enabled: true, tags: [], config: { mode: "safe" }, mode: longMode },
          `Invalid value for "mode". Expected one of: safe, fast, got "${"x".repeat(40)}…".`
        ],
        [
          { name: "Ada", enabled: true, tags: [], config: { mode: "safe" }, mode: "sk-secret" },
          'Invalid value for "mode". Expected one of: safe, fast, got "sk-secret".'
        ]
      ] as const) {
        await expect(
          client.callTool({
            name: "run",
            arguments: argumentsValue
          })
        ).rejects.toSatisfy(
          (error: unknown) => error instanceof Error && error.message.includes(expected)
        );
      }

      await expect(
        client.callTool({
          name: "run",
          arguments: {
            name: "Ada",
            enabled: true,
            tags: [],
            config: { mode: "safe" },
            mode: "fats"
          }
        })
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("Did you mean: fast?\nExpected one of: safe, fast")
      );

      await expect(
        client.callTool({
          name: "run",
          arguments: {
            name: "Ada",
            enabled: true,
            tags: [],
            config: { mode: "safe" },
            mode: "abc"
          }
        })
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof Error &&
          !error.message.includes("Did you mean") &&
          error.message.includes('Expected one of: safe, fast, got "abc".')
      );
    } finally {
      await cleanup();
    }
  });

  it("includes null in MCP enum schemas for nullable enum params", async () => {
    const run = defineCommand({
      name: "run",
      scope: ["mcp"],
      params: S.Object({
        mode: S.Optional(
          S.Enum(["off", "auto", "forced"] as const, {
            nullable: true
          })
        )
      }),
      handler: async ({ params }) => params
    });

    const root = defineGroup({
      name: "root",
      children: [run]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools[0]?.inputSchema).toEqual({
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["off", "auto", "forced", null],
            nullable: true
          }
        },
        required: [],
        additionalProperties: false
      });
    } finally {
      await cleanup();
    }
  });

  it("includes all descendants when a nested group is allowlisted and supports camel casing", async () => {
    const create = defineCommand({
      name: "create-bot",
      description: "Create a bot",
      params: S.Object({
        botName: S.String(),
        botConfig: S.Object({
          apiKey: S.String()
        })
      }),
      handler: async ({ params }) => params
    });

    const remove = defineCommand({
      name: "remove-bot",
      description: "Remove a bot",
      params: S.Object({
        botName: S.String()
      }),
      handler: async ({ params }) => params
    });

    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "bot-admin",
          scope: ["mcp"],
          children: [
            defineGroup({
              name: "bot",
              children: [create, remove]
            })
          ]
        })
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true,
      tools: ["bot_admin__bot"],
      casing: "camel"
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual([
        "bot_admin__bot__create_bot",
        "bot_admin__bot__remove_bot"
      ]);
      expect(result.tools[0]).toMatchObject({
        description: "Create a bot Parameters: botName (required), botConfig.apiKey (required).",
        inputSchema: {
          type: "object",
          properties: {
            botName: {
              type: "string"
            },
            botConfig: {
              type: "object",
              properties: {
                apiKey: {
                  type: "string"
                }
              },
              required: ["apiKey"]
            }
          },
          required: ["botName", "botConfig"]
        }
      });
    } finally {
      await cleanup();
    }
  });

  it("composes tools from multiple root groups", async () => {
    const firstHandler = vi.fn(async ({ params }: { params: { name: string } }) => ({
      group: "first",
      name: params.name
    }));
    const secondHandler = vi.fn(async () => ({
      group: "second"
    }));

    const firstRoot = defineGroup({
      name: "terminal-pilot",
      children: [
        defineCommand({
          name: "create-session",
          scope: ["mcp"],
          params: S.Object({
            name: S.String()
          }),
          handler: firstHandler
        })
      ]
    });

    const secondRoot = defineGroup({
      name: "terminal-png",
      children: [
        defineCommand({
          name: "render",
          scope: ["mcp"],
          params: S.Object({}),
          handler: secondHandler
        })
      ]
    });

    const server = createMCPServer([firstRoot, secondRoot], {
      approvals: true,
      humanInLoop: createHumanInLoop({
        provider: {
          id: "test-provider",
          requestApproval: async () => ({ outcome: "approved" as const })
        }
      }),
      name: "toolcraft-test",
      version: "1.0.0"
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.listTools();

      expect(result.tools.map((tool) => tool.name)).toEqual([
        "terminal_pilot__create_session",
        "terminal_png__render",
        "approvals__list",
        "approvals__show"
      ]);

      const callResult = await client.callTool({
        name: "terminal_pilot__create_session",
        arguments: {
          name: "demo"
        }
      });

      expect(firstHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            name: "demo"
          }
        })
      );
      expect(secondHandler).not.toHaveBeenCalled();
      expect(callResult).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              group: "first",
              name: "demo"
            })
          }
        ]
      });
    } finally {
      await cleanup();
    }
  });

  it("maps secret resolution failures to invalid params", async () => {
    delete process.env.API_KEY;

    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["mcp"],
          params: S.Object({
            name: S.String()
          }),
          secrets: {
            apiKey: {
              env: "API_KEY"
            }
          },
          handler: async ({ params }) => params.name
        })
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const callPromise = client.callTool({
        name: "deploy",
        arguments: {}
      });

      await expect(callPromise).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INVALID_PARAMS
        });
        expect((error as Error).message).toContain("Missing required secret API_KEY");
        return true;
      });
    } finally {
      await cleanup();
    }
  });

  it("maps requirement failures to invalid params", async () => {
    delete process.env.POE_API_KEY;

    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["mcp"],
          params: S.Object({}),
          requires: {
            auth: true
          },
          handler: async () => "ok"
        })
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.callTool({ name: "deploy", arguments: {} })).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(McpError);
          expect(error).toMatchObject({
            code: ERROR_INVALID_PARAMS
          });
          expect((error as Error).message).toContain("requires authentication");
          return true;
        }
      );
    } finally {
      await cleanup();
    }
  });

  it("maps validation failures to invalid params", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["mcp"],
          params: S.Object({
            name: S.String()
          }),
          handler: async ({ params }) => params.name
        })
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const callPromise = client.callTool({
        name: "deploy",
        arguments: {}
      });

      await expect(callPromise).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INVALID_PARAMS
        });
        expect((error as Error).message).toContain('Missing required parameter "name".');
        return true;
      });
    } finally {
      await cleanup();
    }
  });

  it("maps collected validation failures to invalid params", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["mcp"],
          params: S.Object({
            name: S.String(),
            retries: S.Number(),
            preview: S.Boolean()
          }),
          handler: async ({ params }) => params
        })
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      casing: "camel",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const callPromise = client.callTool({
        name: "deploy",
        arguments: {
          name: 42,
          retries: "many",
          preview: "yes"
        }
      });

      await expect(callPromise).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INVALID_PARAMS
        });
        expect((error as Error).message).toContain(
          [
            "3 parameter errors:",
            '  - name: Invalid value for "name". Expected a string, got 42.',
            '  - retries: Invalid value for "retries". Expected a number, got "many".',
            '  - preview: Invalid value for "preview". Expected a boolean, got "yes".'
          ].join("\n")
        );
        return true;
      });
    } finally {
      await cleanup();
    }
  });

  it("maps unknown tools to invalid params", async () => {
    const root = defineGroup({
      name: "root",
      children: []
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      await expect(client.callTool({ name: "missing", arguments: {} })).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(McpError);
          expect(error).toMatchObject({
            code: ERROR_INVALID_PARAMS
          });
          expect((error as Error).message).toContain("missing");
          return true;
        }
      );
    } finally {
      await cleanup();
    }
  });

  it("calls the handler with resolved services and ignores confirm and progress", async () => {
    process.env.API_KEY = "secret-token";
    const progress = vi.fn();

    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          description: "Deploy a bot",
          scope: ["mcp"],
          confirm: true,
          params: S.Object({
            botName: S.String()
          }),
          secrets: {
            apiKey: {
              env: "API_KEY"
            }
          },
          handler: async (context) => {
            context.progress("deploying");
            progress("handler-called");
            return {
              botName: context.params.botName,
              apiKey: context.secrets.apiKey,
              envHasApiKey: context.env.get("API_KEY"),
              region: context.region
            };
          }
        })
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      services: {
        region: "us"
      },
      omitRootToolNamePrefix: true,
      casing: "camel"
    });
    const { client, cleanup } = await createClient(server);

    try {
      const result = await client.callTool({
        name: "deploy",
        arguments: {
          botName: "demo"
        }
      });

      expect(progress).toHaveBeenCalledWith("handler-called");
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              botName: "demo",
              apiKey: "secret-token",
              envHasApiKey: "secret-token",
              region: "us"
            })
          }
        ]
      });
    } finally {
      await cleanup();
    }
  });

  it("maps unexpected handler failures to internal errors", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "explode",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async () => {
            throw new Error("Boom.");
          }
        })
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      const callPromise = client.callTool({
        name: "explode",
        arguments: {}
      });

      await expect(callPromise).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INTERNAL
        });
        expect((error as Error).message).toContain("Boom.");
        return true;
      });
    } finally {
      await cleanup();
    }
  });

  it("maps HttpError handler failures to structured MCP error data", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "write",
          scope: ["mcp"],
          params: S.Object({}),
          handler: async () => {
            throw createHttpError({
              request: {
                method: "POST",
                url: "https://api.example.com/rows",
                headers: {}
              },
              response: {
                status: 422,
                statusText: "Unprocessable Entity",
                headers: { "x-request-id": "req_rows" },
                body: {
                  error: "invalid_rows",
                  message: "Rows are invalid.",
                  field_errors: {
                    "rows.1.kind": "Expected prompt or completion."
                  }
                }
              }
            });
          }
        })
      ]
    });

    const server = createMCPServer(root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client, cleanup } = await createClient(server);

    try {
      await expect(
        client.callTool({
          name: "write",
          arguments: {}
        })
      ).rejects.toSatisfy((error: unknown) => {
        expect(error).toBeInstanceOf(McpError);
        expect(error).toMatchObject({
          code: ERROR_INVALID_PARAMS,
          data: {
            kind: "http",
            message: "Rows are invalid.",
            code: "invalid_rows",
            requestId: "req_rows",
            http: {
              method: "POST",
              url: "https://api.example.com/rows",
              status: 422,
              statusText: "Unprocessable Entity"
            },
            fieldErrors: [
              { path: "rows.1.kind", message: "Expected prompt or completion." }
            ]
          }
        });
        return true;
      });
    } finally {
      await cleanup();
    }
  });
});

describe("renderResult", () => {
  it.each([
    {
      label: "object in rich",
      output: "rich" as const,
      result: { name: "demo", count: 2 },
      expected: "Demo\n\nName   demo\nCount  2\n"
    },
    {
      label: "object in markdown",
      output: "md" as const,
      result: { name: "demo", count: 2 },
      expected: "- name: demo\n- count: 2\n"
    },
    {
      label: "object in json",
      output: "json" as const,
      result: { name: "demo", count: 2 },
      expected: '{\n  "name": "demo",\n  "count": 2\n}\n'
    },
    {
      label: "array of objects in rich",
      output: "rich" as const,
      result: [
        { name: "alpha", count: 1 },
        { name: "beta", count: 2 }
      ],
      expected:
        '{"columns":[{"name":"name","title":"name"},{"name":"count","title":"count"}],"rows":[{"name":"alpha","count":"1"},{"name":"beta","count":"2"}]}\n'
    },
    {
      label: "array of objects in markdown",
      output: "md" as const,
      result: [
        { name: "alpha", count: 1 },
        { name: "beta", count: 2 }
      ],
      expected: "| name | count |\n| :--- | :--- |\n| alpha | 1 |\n| beta | 2 |\n"
    },
    {
      label: "array of objects in json",
      output: "json" as const,
      result: [
        { name: "alpha", count: 1 },
        { name: "beta", count: 2 }
      ],
      expected:
        '[\n  {\n    "name": "alpha",\n    "count": 1\n  },\n  {\n    "name": "beta",\n    "count": 2\n  }\n]\n'
    },
    {
      label: "string in rich",
      output: "rich" as const,
      result: "hello",
      expected: "hello\n"
    },
    {
      label: "string in markdown",
      output: "md" as const,
      result: "hello",
      expected: "hello\n"
    },
    {
      label: "string in json",
      output: "json" as const,
      result: "hello",
      expected: '{\n  "result": "hello"\n}\n'
    },
    {
      label: "null in rich",
      output: "rich" as const,
      result: null,
      expected: "Done.\n"
    },
    {
      label: "null in markdown",
      output: "md" as const,
      result: null,
      expected: "Done.\n"
    },
    {
      label: "null in json",
      output: "json" as const,
      result: null,
      expected: '{\n  "ok": true\n}\n'
    },
    {
      label: "undefined in rich",
      output: "rich" as const,
      result: undefined,
      expected: "Done.\n"
    },
    {
      label: "undefined in markdown",
      output: "md" as const,
      result: undefined,
      expected: "Done.\n"
    },
    {
      label: "undefined in json",
      output: "json" as const,
      result: undefined,
      expected: '{\n  "ok": true\n}\n'
    }
  ])("auto-renders $label", ({ output, result, expected }) => {
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => result
    });

    expect(runRender(command, result, output)).toBe(expected);
  });

  it("renders sparse arrays of objects with merged columns and escaped markdown cells", () => {
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => [
        { name: "alpha|beta", count: 1 },
        { enabled: true, count: 2 }
      ]
    });

    expect(
      runRender(
        command,
        [
          { name: "alpha|beta", count: 1 },
          { enabled: true, count: 2 }
        ],
        "rich"
      )
    ).toBe(
      '{"columns":[{"name":"name","title":"name"},{"name":"count","title":"count"},{"name":"enabled","title":"enabled"}],"rows":[{"name":"alpha|beta","count":"1","enabled":""},{"name":"","count":"2","enabled":"true"}]}\n'
    );

    expect(
      runRender(
        command,
        [
          { name: "alpha|beta", count: 1 },
          { enabled: true, count: 2 }
        ],
        "md"
      )
    ).toBe(
      "| name | count | enabled |\n| :--- | :--- | :--- |\n| alpha\\|beta | 1 |  |\n|  | 2 | true |\n"
    );
  });

  it("leaves inherited constructor values out of sparse markdown table cells", () => {
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => undefined
    });

    expect(runRender(command, [JSON.parse('{"constructor":"provided"}'), {}], "md")).toBe(
      "| constructor |\n| :--- |\n| provided |\n|  |\n"
    );
  });

  it("passes design-system primitives to format overrides", () => {
    const rich = vi.fn();
    const markdown = vi.fn(() => "override-md");
    const json = vi.fn(() => ({ override: true }));
    const { primitives } = createPrimitives();

    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => "ignored",
      render: {
        rich,
        markdown,
        json
      }
    });

    renderResult(command, "value", "rich", primitives, () => undefined);
    renderResult(command, "value", "md", primitives, () => undefined);
    renderResult(command, "value", "json", primitives, () => undefined);

    expect(rich).toHaveBeenCalledWith("value", primitives);
    expect(markdown).toHaveBeenCalledWith("value", primitives);
    expect(json).toHaveBeenCalledWith("value", primitives);
  });

  it("passes the selected output format to command renderers", () => {
    const markdown = vi.fn((_result: string, primitives: RenderPrimitives) => {
      expect(primitives.outputFormat).toBe("md");
      return "formatted";
    });
    const { primitives } = createPrimitives();
    primitives.outputFormat = "md";
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => "ignored",
      render: { markdown }
    });

    renderResult(command, "value", "md", primitives, () => undefined);

    expect(markdown).toHaveBeenCalledOnce();
  });

  it("uses format overrides instead of the auto renderer", () => {
    const rich = vi.fn();
    const markdown = vi.fn(() => "override-md");
    const json = vi.fn(() => ({ override: true }));
    const { primitives, renderTable } = createPrimitives();
    const writes: string[] = [];

    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => ({ name: "auto" }),
      render: {
        rich,
        markdown,
        json
      }
    });

    renderResult(command, { name: "auto" }, "rich", primitives, (chunk) => {
      writes.push(chunk);
    });
    renderResult(command, { name: "auto" }, "md", primitives, (chunk) => {
      writes.push(chunk);
    });
    renderResult(command, { name: "auto" }, "json", primitives, (chunk) => {
      writes.push(chunk);
    });

    expect(rich).toHaveBeenCalledTimes(1);
    expect(renderTable).not.toHaveBeenCalled();
    expect(writes).toEqual(["override-md\n", '{\n  "override": true\n}\n']);
  });

  it("does not write when markdown or json overrides return nothing", () => {
    const writes: string[] = [];
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => ({ ok: true }),
      render: {
        markdown: vi.fn(() => "" as string),
        json: vi.fn(() => undefined)
      }
    });
    const { primitives } = createPrimitives();

    renderResult(command, { ok: true }, "md", primitives, (chunk) => {
      writes.push(chunk);
    });
    renderResult(command, { ok: true }, "json", primitives, (chunk) => {
      writes.push(chunk);
    });

    expect(writes).toEqual([]);
  });

  it("ignores malformed markdown overrides that return undefined", () => {
    const writes: string[] = [];
    const command = defineCommand({
      name: "demo",
      params: S.Object({}),
      handler: async () => ({ ok: true }),
      render: {
        markdown: vi.fn(() => undefined as unknown as string)
      }
    });
    const { primitives } = createPrimitives();

    expect(() => {
      renderResult(command, { ok: true }, "md", primitives, (chunk) => {
        writes.push(chunk);
      });
    }).not.toThrow();
    expect(writes).toEqual([]);
  });
});

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
                    prompt: S.String()
                  }),
                  handler: async ({ params }) => ({
                    content: params.prompt
                  })
                })
              ]
            })
          ]
        })
      ]
    });

    const sdk = createSDK(root);
    const result = await sdk.generate.assets.text({
      prompt: "hello"
    });

    expect(result).toEqual({
      content: "hello"
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
                  api_key: S.String()
                })
              }),
              handler: async ({ params }) => params
            })
          ]
        })
      ]
    });

    const sdk = createSDK(root);
    const result = await sdk.botAdmin.createBot({
      botName: "assistant",
      botConfig: {
        apiKey: "secret"
      }
    });

    expect(result).toEqual({
      bot_name: "assistant",
      bot_config: {
        api_key: "secret"
      }
    });
  });

  it("preserves declared __proto__ parameters through SDK dispatch", async () => {
    const handler = vi.fn(async ({ params }: { params: Record<string, unknown> }) => params);
    const paramsShape = Object.fromEntries([["__proto__", S.String()]]) as Record<
      string,
      ReturnType<typeof S.String>
    >;
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "probe",
          scope: ["sdk"],
          params: S.Object(paramsShape),
          handler
        })
      ]
    });

    const sdk = createSDK(root) as { probe(params: { proto: string }): Promise<unknown> };
    await sdk.probe({ proto: "visible" });

    const params = handler.mock.calls[0]?.[0].params;
    expect(Object.prototype.hasOwnProperty.call(params, "__proto__")).toBe(true);
    expect(params?.["__proto__"]).toBe("visible");
  });

  it("rejects SDK parameters that normalize to the same member name", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "submit",
          scope: ["sdk"],
          params: S.Object({
            fooBar: S.String(),
            foo_bar: S.String()
          }),
          handler: async ({ params }) => params
        })
      ]
    });

    expect(() => createSDK(root)).toThrow(
      'Parameters "fooBar" and "foo_bar" use conflicting SDK member "fooBar".'
    );
  });

  it("rejects commands that normalize to the same SDK member name", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "runTask",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "camel"
        }),
        defineCommand({
          name: "run_task",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "snake"
        })
      ]
    });

    expect(() => createSDK(root)).toThrow(
      'SDK members "runTask" and "run_task" use conflicting member "runTask".'
    );
  });

  it("rejects an SDK command named then", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "then",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "reachable"
        })
      ]
    });

    expect(() => createSDK(root)).toThrow('SDK member "then" uses reserved member "then".');
  });

  it("rejects a nested SDK command named then consistently with deferred SDKs", () => {
    const local = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "ops",
          children: [
            defineCommand({
              name: "then",
              scope: ["sdk"],
              params: S.Object({}),
              handler: async () => "reachable"
            })
          ]
        })
      ]
    });

    expect(() => createSDK(local)).toThrow('SDK member "then" uses reserved member "then".');
  });

  it("treats required array params as required in the SDK even when CLI-only helper flags make the direct param optional", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "bots",
          children: [
            defineCommand({
              name: "set-conversation-starters",
              scope: ["sdk"],
              params: S.Object({
                starters: S.Optional(
                  S.Array(S.String(), {
                    requiredScopes: ["mcp", "sdk"]
                  })
                ),
                startersJson: S.Optional(
                  S.String({
                    scope: ["cli"]
                  })
                )
              }),
              handler: async ({ params }) => params
            })
          ]
        })
      ]
    });

    const sdk = createSDK(root);

    await expect(sdk.bots.setConversationStarters({})).rejects.toThrow(
      'Missing required parameter "starters".'
    );
  });

  it("collects multiple SDK validation errors into one message", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["sdk"],
          params: S.Object({
            name: S.String(),
            retries: S.Number(),
            preview: S.Boolean()
          }),
          handler: async ({ params }) => params
        })
      ]
    });

    const sdk = createSDK(root);

    await expect(
      sdk.deploy({
        name: 42,
        retries: "many",
        preview: "yes"
      })
    ).rejects.toThrow(
      [
        "3 parameter errors:",
        '  - name: Invalid value for "name". Expected a string, got 42.',
        '  - retries: Invalid value for "retries". Expected a number, got "many".',
        '  - preview: Invalid value for "preview". Expected a boolean, got "yes".'
      ].join("\n")
    );
  });

  it("rejects SDK arguments that violate string, number, and array constraints", async () => {
    const handler = vi.fn(async ({ params }: { params: unknown }) => params);
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          scope: ["sdk"],
          params: S.Object({
            slug: S.String({ minLength: 3, maxLength: 5, pattern: "^[a-z]+$" }),
            count: S.Number({ minimum: 1, maximum: 3 }),
            tags: S.Array(S.String(), { minItems: 2, maxItems: 2 })
          }),
          handler
        })
      ]
    });

    const sdk = createSDK(root);

    await expect(
      sdk.deploy({
        slug: "BAD",
        count: 99,
        tags: ["only-one"]
      })
    ).rejects.toThrow(
      [
        "3 parameter errors:",
        '  - slug: Invalid value for "slug": "BAD" does not match pattern "^[a-z]+$".',
        '  - count: Invalid value for "count". Expected a number greater than or equal to 1 and less than or equal to 3, got 99.',
        '  - tags: Invalid value for "tags". Expected an array with at least 2 items, got array(1).'
      ].join("\n")
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects CLI-only helper flags in the SDK argument surface", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineGroup({
          name: "bots",
          children: [
            defineCommand({
              name: "set-conversation-starters",
              scope: ["sdk"],
              params: S.Object({
                starters: S.Optional(
                  S.Array(S.String(), {
                    requiredScopes: ["mcp", "sdk"]
                  })
                ),
                startersJson: S.Optional(
                  S.String({
                    scope: ["cli"]
                  })
                )
              }),
              handler: async ({ params }) => params
            })
          ]
        })
      ]
    });

    const sdk = createSDK(root);

    await expect(
      sdk.bots.setConversationStarters({
        startersJson: '["a"]'
      })
    ).rejects.toThrow('Unexpected parameter "startersJson". Available: starters.');
  });

  it("lists reserved service names for SDK and MCP service name collisions", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "deploy",
          params: S.Object({}),
          handler: async () => null
        })
      ]
    });
    const message =
      'Service name "root" is reserved. Choose a different name. Available reserved names: params, secrets, fetch, fs, env, diagnostics, progress, runtimeOptions, root.';

    expect(() =>
      createSDK(root, {
        services: {
          root: "bad"
        }
      })
    ).toThrow(message);
    expect(() =>
      createMCPServer(root, {
        name: "toolcraft-test",
        services: {
          root: "bad"
        }
      })
    ).toThrow(message);
  });

  it("includes only sdk-scoped commands", () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "visible-command",
          scope: ["sdk"],
          params: S.Object({}),
          handler: async () => "visible"
        }),
        defineCommand({
          name: "hidden-command",
          scope: ["cli"],
          params: S.Object({}),
          handler: async () => "hidden"
        }),
        defineGroup({
          name: "mixed-group",
          children: [
            defineCommand({
              name: "sdk-child",
              scope: ["sdk"],
              params: S.Object({}),
              handler: async () => "sdk-child"
            }),
            defineCommand({
              name: "mcp-child",
              scope: ["mcp"],
              params: S.Object({}),
              handler: async () => "mcp-child"
            })
          ]
        })
      ]
    });

    const sdk = createSDK(root) as Record<string, unknown>;

    expect(typeof sdk.visibleCommand).toBe("function");
    expect("hiddenCommand" in sdk).toBe(false);
    expect("mixedGroup" in sdk).toBe(true);
    expect(sdk.mixedGroup).toEqual({
      sdkChild: expect.any(Function)
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
              handler: async () => "default-visible"
            })
          ]
        }),
        defineGroup({
          name: "cli-only",
          scope: ["cli"],
          children: [
            defineCommand({
              name: "hidden-child",
              params: S.Object({}),
              handler: async () => "hidden-child"
            }),
            defineCommand({
              name: "explicit-sdk-child",
              scope: ["sdk"],
              params: S.Object({}),
              handler: async () => "explicit-sdk-child"
            })
          ]
        })
      ]
    });

    const sdk = createSDK(root) as Record<string, unknown>;

    expect(sdk.defaultScope).toEqual({
      defaultVisible: expect.any(Function)
    });
    expect(sdk.cliOnly).toEqual({
      explicitSdkChild: expect.any(Function)
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
              project_name: S.String()
            }),
            secrets: {
              apiKey: { env: "SDK_TEST_API_KEY" }
            },
            requires: {
              check
            },
            handler: async ({ params, secrets, progress: reportProgress }) => {
              reportProgress("ignored");
              progress();
              return {
                project: params.project_name,
                apiKey: secrets.apiKey
              };
            }
          })
        ]
      });

      const sdk = createSDK(root);
      const result = await sdk.deploy({
        projectName: "demo"
      });

      expect(check).toHaveBeenCalledTimes(1);
      expect(progress).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        project: "demo",
        apiKey: "secret"
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
          }
        })
      ]
    });

    const sdk = createSDK(root);

    await expect(sdk.explode({})).rejects.toBe(failure);
  });

  it("accepts nullable SDK parameters", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "configure-limit",
          scope: ["sdk"],
          params: S.Object({
            limit: S.Optional(
              S.Number({
                nullable: true
              })
            )
          }),
          handler: async ({ params }) => params
        })
      ]
    });

    const sdk = createSDK(root);
    const result = await sdk.configureLimit({
      limit: null
    });

    expect(result).toEqual({
      limit: null
    });
  });

  it("preserves complex SDK parameter values", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "create",
          scope: ["sdk"],
          params: S.Object({
            body: S.Json(),
            tags: S.Record(S.String()),
            choice: S.OneOf({
              discriminator: "kind",
              branches: { named: S.Object({ name: S.String() }) }
            }),
            target: S.Union([S.Object({ id: S.String() }), S.Object({ slug: S.String() })])
          }),
          handler: async ({ params }) => params
        })
      ]
    });

    const sdk = createSDK(root, { approvals: false });
    const params = {
      body: { hello: "world" },
      tags: { a: "b" },
      choice: { kind: "named", name: "demo" },
      target: { id: "123" }
    };

    await expect(sdk.create(params)).resolves.toEqual(params);
  });

  it("preserves additional SDK object properties when allowed", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "create",
          scope: ["sdk"],
          params: S.Object({ metadata: S.Object({}, { additionalProperties: true }) }),
          handler: async ({ params }) => params
        })
      ]
    });

    const sdk = createSDK(root, { approvals: false });
    await expect(sdk.create({ metadata: { custom: "value" } })).resolves.toEqual({
      metadata: { custom: "value" }
    });
  });

  it("rejects fractional SDK values for integer params", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "configure-limit",
          scope: ["sdk"],
          params: S.Object({
            limit: S.Number({
              jsonType: "integer"
            })
          }),
          handler: async ({ params }) => params
        })
      ]
    });

    const sdk = createSDK(root);

    await expect(
      sdk.configureLimit({
        limit: 1.5
      })
    ).rejects.toThrow('Invalid value for "limit". Expected an integer, got 1.5.');
  });

  it("describes received SDK argument values in validation errors", async () => {
    const root = defineGroup({
      name: "root",
      children: [
        defineCommand({
          name: "run",
          scope: ["sdk"],
          params: S.Object({
            name: S.String(),
            enabled: S.Boolean(),
            tags: S.Array(S.String()),
            config: S.Object({ mode: S.String() }),
            mode: S.Enum(["safe", "fast"] as const)
          }),
          handler: async ({ params }) => params
        })
      ]
    });

    const sdk = createSDK(root);
    const longMode = "x".repeat(45);

    await expect(
      sdk.run({
        name: 123,
        enabled: true,
        tags: [],
        config: { mode: "safe" },
        mode: "safe"
      })
    ).rejects.toThrow('Invalid value for "name". Expected a string, got 123.');

    await expect(
      sdk.run({
        name: "Ada",
        enabled: "yes",
        tags: [],
        config: { mode: "safe" },
        mode: "safe"
      })
    ).rejects.toThrow('Invalid value for "enabled". Expected a boolean, got "yes".');

    await expect(
      sdk.run({
        name: "Ada",
        enabled: true,
        tags: "core",
        config: { mode: "safe" },
        mode: "safe"
      })
    ).rejects.toThrow('Invalid value for "tags". Expected an array, got "core".');

    await expect(
      sdk.run({
        name: "Ada",
        enabled: true,
        tags: [],
        config: [],
        mode: "safe"
      })
    ).rejects.toThrow('Invalid value for "config". Expected an object, got array(0).');

    await expect(
      sdk.run({
        name: "Ada",
        enabled: true,
        tags: [],
        config: { mode: "safe" },
        mode: longMode
      })
    ).rejects.toThrow(
      `Invalid value for "mode". Expected one of: safe, fast, got "${"x".repeat(40)}…".`
    );

    await expect(
      sdk.run({
        name: "Ada",
        enabled: true,
        tags: [],
        config: { mode: "safe" },
        mode: "sk-secret"
      })
    ).rejects.toThrow('Invalid value for "mode". Expected one of: safe, fast, got "sk-secret".');

    await expect(
      sdk.run({
        name: "Ada",
        enabled: true,
        tags: [],
        config: { mode: "safe" },
        mode: "fats"
      })
    ).rejects.toThrow("Did you mean: fast?\nExpected one of: safe, fast");

    await expect(
      sdk.run({
        name: "Ada",
        enabled: true,
        tags: [],
        config: { mode: "safe" },
        mode: "abc"
      })
    ).rejects.toThrow('Invalid value for "mode". Expected one of: safe, fast, got "abc".');
  });
});
