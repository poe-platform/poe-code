import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { defineCommand, defineGroup, S, UserError, type AuthProvider, type CommandNode } from "agent-kit";
import { runCLI } from "agent-kit/cli";
import { createMCPServer } from "agent-kit/mcp";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import { commandsFromSpec, defineApiCommand, defineClient, defineClientFromSpec, requestJson, type OpenApiDocument } from "./index.js";
import { collectGeneratedCommands, generate } from "./generate.js";

function createAuthProvider(commands: CommandNode<any>[]): AuthProvider {
  return {
    getToken: async () => "token",
    commands
  };
}

function createClientPair(server: ReturnType<typeof createMCPServer>) {
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

function createSetOfficialDocument(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {
      "/bots/{botHandle}/actions/set-official": {
        post: {
          tags: ["bots"],
          operationId: "setOfficialBot",
          summary: "Set official",
          parameters: [
            {
              name: "botHandle",
              in: "path",
              required: true,
              schema: {
                type: "string"
              }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["official"],
                  properties: {
                    official: {
                      type: "boolean"
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function createListDocument(summary: string): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {
      "/bots": {
        get: {
          tags: ["bots"],
          operationId: "listBots",
          summary,
          responses: {
            "200": {
              description: "Listed.",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function createCampaignDocument(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {
      "/campaigns/{campaignId}": {
        patch: {
          tags: ["campaigns"],
          operationId: "updateCampaign",
          parameters: [
            {
              name: "campaignId",
              in: "path",
              required: true,
              schema: {
                type: "string"
              }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["name"],
                  properties: {
                    name: {
                      type: "string"
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function createArrayBodyDocument(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {
      "/conversations/starters": {
        post: {
          tags: ["conversations"],
          operationId: "setConversationStarters",
          summary: "Set conversation starters",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["starters"],
                  properties: {
                    starters: {
                      type: "array",
                      items: {
                        type: "string"
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function createNullableScalarBodyDocument(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {
      "/bots/actions/set-limit": {
        post: {
          tags: ["bots"],
          operationId: "setBotLimit",
          summary: "Set limit",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["limit"],
                  properties: {
                    limit: {
                      type: "integer",
                      nullable: true
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function createParityDocument(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {
      "/bots/{botHandle}/actions/update": {
        post: {
          tags: ["bots"],
          operationId: "updateBot",
          parameters: [
            {
              name: "botHandle",
              in: "path",
              required: true,
              schema: {
                type: "string"
              }
            },
            {
              name: "labels",
              in: "query",
              required: false,
              style: "form",
              explode: false,
              schema: {
                type: "array",
                items: {
                  type: "string"
                }
              }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["limit", "starters"],
                  properties: {
                    limit: {
                      type: "integer",
                      nullable: true
                    },
                    starters: {
                      type: "array",
                      nullable: true,
                      items: {
                        type: "string"
                      }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated.",
              content: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function evaluateGeneratedCommand(fileContents: string, exportName: string) {
  const transformedContents = fileContents
    .replace(/^import .*$/gmu, "")
    .replaceAll(" as const", "")
    .replaceAll(": unknown;", ";")
    .replace(
      `export const ${exportName} = defineApiCommand(`,
      `exports.${exportName} = defineApiCommand(`
    );
  const execute = new Function(
    "deps",
    "exports",
    `
const { S, UserError } = deps.agentKit;
const { requestJson, defineApiCommand } = deps.openapi;
${transformedContents}
return exports;
`
  ) as (
    deps: {
      agentKit: typeof import("agent-kit");
      openapi: { requestJson: typeof requestJson; defineApiCommand: typeof defineApiCommand };
    },
    exports: Record<string, unknown>
  ) => Record<string, unknown>;

  return execute(
    {
      agentKit: { S, UserError },
      openapi: { requestJson, defineApiCommand }
    },
    {}
  )[exportName] as CommandNode<any>;
}

describe("commandsFromSpec", () => {
  it("does not use Function to build runtime handlers", async () => {
    const unexpectedFunction = vi.fn(() => {
      throw new Error("Runtime generation should not use Function.");
    }) as unknown as FunctionConstructor;

    vi.resetModules();
    vi.stubGlobal("Function", unexpectedFunction);

    try {
      const { commandsFromSpec: freshCommandsFromSpec } = await import("./runtime.js");
      const commands = await freshCommandsFromSpec(createSetOfficialDocument());

      expect(commands).toMatchObject([
        {
          kind: "group",
          name: "bots",
          children: [{ kind: "command", name: "set-official-bot" }]
        }
      ]);
      expect(unexpectedFunction).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds runtime commands for a pre-parsed spec and preserves the MCP surface", async () => {
    const commands = await commandsFromSpec(createSetOfficialDocument());
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      commands
    });
    const botsGroup = client.root.children[0];

    if (botsGroup?.kind !== "group") {
      throw new Error("Expected a generated bots group.");
    }

    const command = botsGroup.children[0];

    if (command?.kind !== "command") {
      throw new Error("Expected a generated command.");
    }

    const result = await command.handler({
      params: {
        botHandle: "my-bot",
        official: true
      },
      baseUrl: client.services.baseUrl,
      tokenSource: client.services.tokenSource,
      fetch
    });
    const server = createMCPServer(client.root, {
      name: client.name,
      version: "1.0.0"
    });
    const { client: mcpClient, cleanup } = await createClientPair(server);

    try {
      expect(result).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledWith(
        "https://example.com/api/bots/my-bot/actions/set-official",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json"
          }),
          body: JSON.stringify({
            official: true
          })
        })
      );

      const tools = await mcpClient.listTools();

      expect(tools.tools).toContainEqual(
        expect.objectContaining({
          name: "internal_agent__bots__set_official_bot",
          inputSchema: expect.objectContaining({
            required: ["bot_handle", "official"],
            properties: expect.objectContaining({
              bot_handle: expect.objectContaining({ type: "string" }),
              official: expect.objectContaining({ type: "boolean" })
            })
          })
        })
      );
    } finally {
      await cleanup();
    }
  });

  it("preserves additionalProperties: false on runtime MCP params schemas", async () => {
    const commands = await commandsFromSpec(createCampaignDocument());
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      commands
    });
    const server = createMCPServer(client.root, {
      name: client.name,
      version: "1.0.0"
    });
    const { client: mcpClient, cleanup } = await createClientPair(server);

    try {
      const tools = await mcpClient.listTools();

      expect(tools.tools).toContainEqual(
        expect.objectContaining({
          name: "internal_agent__campaigns__update_campaign",
          inputSchema: expect.objectContaining({
            additionalProperties: false,
            required: ["campaign_id", "name"]
          })
        })
      );
    } finally {
      await cleanup();
    }
  });

  it("reads a spec from a filesystem path", async () => {
    const volume = Volume.fromJSON(
      {
        "/repo/openapi.json": JSON.stringify(createListDocument("List bots from disk."), null, 2)
      },
      "/"
    );
    const fs = createFsFromVolume(volume).promises;

    const commands = await commandsFromSpec("./openapi.json", {
      cwd: "/repo",
      fs
    });

    expect(commands).toMatchObject([
      {
        kind: "group",
        name: "bots",
        children: [{ kind: "command", name: "list" }]
      }
    ]);
  });

  it("works with defineClient collision detection against handwritten commands", async () => {
    const commands = await commandsFromSpec(createListDocument("List bots."));

    expect(() =>
      defineClient({
        name: "internal-agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        commands,
        handwrittenCommands: [
          defineGroup({
            name: "bots",
            children: [
              defineCommand({
                name: "list",
                params: S.Object({}),
                handler: async () => "handwritten"
              })
            ]
          })
        ]
      })
    ).toThrowError(
      new UserError(
        'Command path "bots list" is defined more than once (generated and handwritten).'
      )
    );
  });

  it("surfaces spec-fetch failures as user errors", async () => {
    const fetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("network down"));

    await expect(
      commandsFromSpec("https://example.com/openapi.json", {
        fetch
      })
    ).rejects.toThrowError(
      new UserError(
        'Failed to read OpenAPI document "https://example.com/openapi.json": network down'
      )
    );
  });

  it("supports runtime array JSON helpers in generated handlers", async () => {
    const commands = await commandsFromSpec(createArrayBodyDocument());
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      commands
    });
    const conversationsGroup = client.root.children[0];

    if (conversationsGroup?.kind !== "group") {
      throw new Error("Expected a generated conversations group.");
    }

    const command = conversationsGroup.children[0];

    if (command?.kind !== "command") {
      throw new Error("Expected a generated command.");
    }

    await command.handler({
      params: {
        startersJson: '["alpha","beta"]'
      },
      baseUrl: client.services.baseUrl,
      tokenSource: client.services.tokenSource,
      fetch
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/conversations/starters",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          starters: ["alpha", "beta"]
        })
      })
    );
  });

  it("keeps generated code and runtime handlers in parity for preflight + request-shape behavior", async () => {
    const document = createParityDocument();
    const generatedFiles = generate(document, { specSha: "spec-sha-123" });
    const [generatedCommandMeta] = collectGeneratedCommands(document);

    if (generatedCommandMeta === undefined) {
      throw new Error("Expected one generated command.");
    }

    const generatedFile = generatedFiles.find((file) => file.path === generatedCommandMeta.filePath);

    if (generatedFile === undefined) {
      throw new Error("Expected a generated command file.");
    }

    const generatedCommand = evaluateGeneratedCommand(
      generatedFile.contents,
      generatedCommandMeta.exportName
    );
    const runtimeCommands = await commandsFromSpec(document);
    const botsGroup = runtimeCommands[0];

    if (generatedCommand.kind !== "command" || botsGroup?.kind !== "group") {
      throw new Error("Expected generated and runtime commands.");
    }

    const runtimeCommand = botsGroup.children[0];

    if (runtimeCommand?.kind !== "command") {
      throw new Error("Expected a runtime command.");
    }

    const params = {
      botHandle: "my-bot",
      labels: ["alpha", "beta"],
      limitNull: true,
      startersJson: '["one","two"]'
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        })
    );
    const services = {
      baseUrl: "https://example.com/api",
      tokenSource: createAuthProvider([]),
      fetch
    };

    const generatedResult = await generatedCommand.handler({
      params,
      baseUrl: services.baseUrl,
      tokenSource: services.tokenSource,
      fetch: services.fetch
    });
    const generatedFetchCall = services.fetch.mock.calls[0];

    services.fetch.mockClear();

    const runtimeResult = await runtimeCommand.handler({
      params,
      baseUrl: services.baseUrl,
      tokenSource: services.tokenSource,
      fetch: services.fetch
    });

    expect(generatedResult).toEqual(runtimeResult);
    expect(services.fetch.mock.calls[0]).toEqual(generatedFetchCall);

    await expect(
      generatedCommand.handler({
        params: {
          ...params,
          starters: ["direct"]
        },
        baseUrl: services.baseUrl,
        tokenSource: services.tokenSource,
        fetch: services.fetch
      })
    ).rejects.toThrowError(
      new UserError('Options "--starters" and "--starters-json" are mutually exclusive.')
    );

    await expect(
      runtimeCommand.handler({
        params: {
          ...params,
          starters: ["direct"]
        },
        baseUrl: services.baseUrl,
        tokenSource: services.tokenSource,
        fetch: services.fetch
      })
    ).rejects.toThrowError(
      new UserError('Options "--starters" and "--starters-json" are mutually exclusive.')
    );
  });

  it("supports runtime null helpers in generated handlers", async () => {
    const commands = await commandsFromSpec(createNullableScalarBodyDocument());
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    const client = defineClient({
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      commands
    });
    const botsGroup = client.root.children[0];

    if (botsGroup?.kind !== "group") {
      throw new Error("Expected a generated bots group.");
    }

    const command = botsGroup.children[0];

    if (command?.kind !== "command") {
      throw new Error("Expected a generated command.");
    }

    await command.handler({
      params: {
        limitNull: true
      },
      baseUrl: client.services.baseUrl,
      tokenSource: client.services.tokenSource,
      fetch
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/bots/actions/set-limit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          limit: null
        })
      })
    );
  });

  it("accepts --limit-null alone for required nullable scalar body fields through the CLI", async () => {
    const commands = await commandsFromSpec(createNullableScalarBodyDocument());
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );
    const originalArgv = [...process.argv];
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubGlobal("fetch", fetch);

    try {
      Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
      Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });

      const client = defineClient({
        name: "internal-agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        commands
      });
      const botsGroup = client.root.children[0];

      if (botsGroup?.kind !== "group") {
        throw new Error("Expected a generated bots group.");
      }

      const command = botsGroup.children[0];

      if (command?.kind !== "command") {
        throw new Error("Expected a generated command.");
      }

      process.argv = [
        "node",
        client.name,
        botsGroup.name,
        command.name,
        "--limit-null",
        "--output",
        "json"
      ];

      await runCLI(client.root, {
        rootUsageName: client.name,
        services: client.services
      });
    } finally {
      process.argv = originalArgv;
      stdoutWrite.mockRestore();
      vi.unstubAllGlobals();

      if (stdoutTTY === undefined) {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      } else {
        Object.defineProperty(process.stdout, "isTTY", stdoutTTY);
      }

      if (stdinTTY === undefined) {
        delete (process.stdin as { isTTY?: boolean }).isTTY;
      } else {
        Object.defineProperty(process.stdin, "isTTY", stdinTTY);
      }
    }

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/bots/actions/set-limit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          limit: null
        })
      })
    );
  });
});

describe("defineClientFromSpec", () => {
  it("builds a client from a pre-parsed OpenAPI document", async () => {
    const client = await defineClientFromSpec(createSetOfficialDocument(), {
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([])
    });

    expect(client.root.children).toMatchObject([
      expect.objectContaining({ kind: "group", name: "bots" })
    ]);
  });

  it("builds a client from a URL", async () => {
    const specText = JSON.stringify(createSetOfficialDocument());
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(specText, { status: 200, headers: { "content-type": "application/json" } })
    );

    const client = await defineClientFromSpec("https://example.com/openapi.json", {
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      fetch
    });

    expect(client.root.children).toMatchObject([
      expect.objectContaining({ kind: "group", name: "bots" })
    ]);
    expect(fetch).toHaveBeenCalledWith("https://example.com/openapi.json");
  });

  it("builds a client from a file path", async () => {
    const specText = JSON.stringify(createSetOfficialDocument());
    const volume = Volume.fromJSON({ "/repo/openapi.json": specText });
    const memFs = createFsFromVolume(volume).promises;

    const client = await defineClientFromSpec("openapi.json", {
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      cwd: "/repo",
      fs: memFs as { readFile(filePath: string, encoding: BufferEncoding): Promise<string> }
    });

    expect(client.root.children).toMatchObject([
      expect.objectContaining({ kind: "group", name: "bots" })
    ]);
  });

  it("surfaces spec-fetch failures as user errors", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("network down"));

    await expect(
      defineClientFromSpec("https://example.com/openapi.json", {
        name: "internal-agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        fetch
      })
    ).rejects.toThrow(
      new UserError('Failed to read OpenAPI document "https://example.com/openapi.json": network down')
    );
  });

  it("includes handwritten commands alongside spec-generated commands", async () => {
    const handwrittenCommand = defineCommand({
      name: "ping",
      description: "Health check.",
      params: S.Object({}),
      handler: async () => ({ ok: true })
    });

    const client = await defineClientFromSpec(createSetOfficialDocument(), {
      name: "internal-agent",
      baseUrl: "https://example.com/api",
      auth: createAuthProvider([]),
      handwrittenCommands: [handwrittenCommand]
    });

    expect(client.root.children.map((n) => n.name)).toEqual(
      expect.arrayContaining(["bots", "ping"])
    );
  });
});
