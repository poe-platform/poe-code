import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import {
  defineCommand,
  defineGroup,
  S,
  UserError,
  type AuthProvider,
  type CommandNode
} from "toolcraft";
import { runCLI } from "toolcraft/cli";
import { createMCPServer } from "toolcraft/mcp";
import { createCommandTestHarness } from "toolcraft/testing";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import {
  commandsFromSpec,
  defineApiCommand,
  defineClient,
  defineClientFromSpec,
  prepareMultipartFileInputs,
  requestJson,
  resolveOpenApiBaseUrl,
  validateArrayJsonHelperValue,
  writeBinaryResponseOutput,
  type OpenApiDocument,
  type ToolcraftConfig
} from "./index.js";
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

describe("resolveOpenApiBaseUrl", () => {
  it("uses explicit environment, env var, config first, then OpenAPI servers", () => {
    const document: OpenApiDocument = {
      openapi: "3.0.3",
      info: { title: "Example", version: "1.0.0" },
      servers: [{ url: "https://openapi.example.com" }],
      paths: {}
    };
    const environments = {
      production: "https://api.example.com",
      sandbox: "https://sandbox.example.com"
    };

    expect(resolveOpenApiBaseUrl({ document, environments, environment: "sandbox" })).toBe(
      "https://sandbox.example.com"
    );
    expect(
      resolveOpenApiBaseUrl({
        document,
        environments,
        env: { TOOLCRAFT_OPENAPI_ENV: "sandbox" }
      })
    ).toBe("https://sandbox.example.com");
    expect(resolveOpenApiBaseUrl({ document, environments })).toBe("https://api.example.com");
    expect(resolveOpenApiBaseUrl({ document })).toBe("https://openapi.example.com");
  });

  it("rejects unknown explicit environments instead of silently falling back", () => {
    const document: OpenApiDocument = {
      openapi: "3.0.3",
      info: { title: "Example", version: "1.0.0" },
      servers: [{ url: "https://openapi.example.com" }],
      paths: {}
    };

    expect(() =>
      resolveOpenApiBaseUrl({
        document,
        environments: {
          production: "https://api.example.com"
        },
        environment: "sandbox"
      })
    ).toThrow('Unknown OpenAPI environment "sandbox". Available: production.');
  });
});

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

function createArrayObjectBodyDocument(): OpenApiDocument {
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
                        type: "object",
                        required: ["title"],
                        properties: {
                          title: { type: "string" },
                          enabled: { type: "boolean" }
                        }
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

function createMultipartBinaryDocument(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths: {
      "/audio/clean": {
        post: {
          tags: ["audio"],
          operationId: "cleanAudio",
          summary: "Clean audio",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["audio"],
                  properties: {
                    audio: {
                      type: "string",
                      format: "binary"
                    },
                    preset: {
                      type: "string"
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Cleaned audio.",
              content: {
                "audio/wav": {
                  schema: {
                    type: "string",
                    format: "binary"
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
const { requestJson, defineApiCommand, prepareMultipartFileInputs, validateArrayJsonHelperValue, writeBinaryResponseOutput } = deps.openapi;
${transformedContents}
return exports;
`
  ) as (
    deps: {
      agentKit: typeof import("toolcraft");
      openapi: {
        requestJson: typeof requestJson;
        defineApiCommand: typeof defineApiCommand;
        prepareMultipartFileInputs: typeof prepareMultipartFileInputs;
        validateArrayJsonHelperValue: typeof validateArrayJsonHelperValue;
        writeBinaryResponseOutput: typeof writeBinaryResponseOutput;
      };
    },
    exports: Record<string, unknown>
  ) => Record<string, unknown>;

  return execute(
    {
      agentKit: { S, UserError },
      openapi: {
        requestJson,
        defineApiCommand,
        prepareMultipartFileInputs,
        validateArrayJsonHelperValue,
        writeBinaryResponseOutput
      }
    },
    {}
  )[exportName] as CommandNode<any>;
}

describe("commandsFromSpec", () => {
  it("keeps untagged singleton GET endpoints as top-level runtime commands", async () => {
    const commands = await commandsFromSpec({
      openapi: "3.0.3",
      info: { title: "Identity API", version: "1.0.0" },
      paths: {
        "/v1/whoami": {
          get: {
            operationId: "whoami",
            summary: "Show the current identity.",
            responses: { "200": { description: "Viewed." } }
          }
        }
      }
    });

    expect(commands).toMatchObject([
      {
        kind: "command",
        name: "whoami",
        description: "Show the current identity."
      }
    ]);
  });

  it("preserves configured runtime names, help metadata, and transport behavior", async () => {
    const config: ToolcraftConfig = {
      edition: "2026-05-16",
      client_settings: { idempotency_header: "Idempotency-Key" },
      resources: {
        agents: {
          methods: {
            promote: {
              method: "post",
              path: "/bots/{botHandle}/actions/set-official",
              idempotent: true
            }
          }
        }
      },
      readme: {
        examples: {
          "agents.promote": [
            {
              title: "Promote an agent",
              params: { botHandle: "helper", official: true }
            }
          ]
        }
      }
    };
    const commands = await commandsFromSpec(createSetOfficialDocument(), { config });
    const group = commands[0];
    const command = group?.kind === "group" ? group.children[0] : undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" }
        })
    );

    expect(group).toMatchObject({ kind: "group", name: "agents" });
    expect(command).toMatchObject({
      kind: "command",
      name: "promote",
      examples: [
        {
          title: "Promote an agent",
          params: { botHandle: "helper", official: true }
        }
      ]
    });
    if (command?.kind !== "command") throw new Error("Expected configured runtime command.");
    expect(command.params.shape.rawResponse).toMatchObject({
      kind: "optional",
      inner: expect.objectContaining({ cliAliases: ["raw"] })
    });

    const result = await command.handler({
      params: {
        botHandle: "helper",
        official: true,
        idempotencyKey: "promote-helper",
        rawResponse: true
      },
      baseUrl: "https://example.com/api",
      tokenSource: createAuthProvider([]),
      fetch
    } as never);

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/bots/helper/actions/set-official",
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "promote-helper" })
      })
    );
    expect(result).toMatchObject({ data: { ok: true }, response: expect.any(Response) });
  });

  it("uses OpenAPI tag descriptions for runtime command groups", async () => {
    const document = createListDocument("List bots.");
    document.tags = [{ name: "bots", description: "Manage API bots." }];

    await expect(commandsFromSpec(document)).resolves.toMatchObject([
      { kind: "group", name: "bots", description: "Manage API bots." }
    ]);
  });

  it("uses fixed per-operation server overrides", async () => {
    const document = createListDocument("List bots.");
    (document.paths?.["/bots"]?.get as { servers?: Array<{ url: string }> }).servers = [
      { url: "https://alt.example.com" }
    ];
    const [group] = await commandsFromSpec(document);
    const command = group?.kind === "group" ? group.children[0] : undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("{}", { headers: { "content-type": "application/json" } })
    );

    if (command?.kind !== "command") throw new Error("Expected runtime command.");
    if (group?.kind !== "group") throw new Error("Expected runtime group.");
    const harness = createCommandTestHarness(defineGroup({ name: "test", children: [group] }), {
      services: {
        baseUrl: "https://default.example.com",
        tokenSource: createAuthProvider([])
      },
      fetch
    });

    const result = await harness.run([group.name, command.name]);

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toHaveProperty("url", "https://alt.example.com/bots");
    expect(fetch.mock.calls[0]?.[0]).toHaveProperty("method", "GET");
  });

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
      version: "1.0.0",
      omitRootToolNamePrefix: true
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
          name: "bots__set_official_bot",
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

  it("reads multipart binary file paths and writes binary responses to output paths", async () => {
    const commands = await commandsFromSpec(createMultipartBinaryDocument());
    const group = commands[0];
    const command = group?.kind === "group" ? group.children[0] : undefined;
    const volume = Volume.fromJSON(
      {
        "/repo/input/voice.wav": "input audio"
      },
      "/"
    );
    const memFs = createFsFromVolume(volume).promises;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(new Uint8Array([0, 1, 2, 255]), {
          status: 200,
          headers: { "content-type": "audio/wav" }
        })
    );

    if (command?.kind !== "command") throw new Error("Expected runtime command.");

    const result = await command.handler({
      params: {
        audio: "input/voice.wav",
        preset: "voice",
        output: "output/clean.wav"
      },
      baseUrl: "https://example.com/api",
      tokenSource: createAuthProvider([]),
      fetch,
      fs: {
        readFile: async (filePath: string, encoding: BufferEncoding = "utf8") =>
          memFs.readFile(filePath, { encoding }) as Promise<string>,
        writeFile: async (
          filePath: string,
          contents: string,
          options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
        ) => {
          await memFs.mkdir("/repo/output", { recursive: true });
          await memFs.writeFile(filePath, contents, options);
        },
        exists: async (filePath: string) => {
          try {
            await memFs.access(filePath);
            return true;
          } catch {
            return false;
          }
        },
        lstat: (filePath: string) => memFs.lstat(filePath) as never,
        rename: async (fromPath: string, toPath: string) => {
          await memFs.rename(fromPath, toPath);
        },
        unlink: async (filePath: string) => {
          await memFs.unlink(filePath);
        }
      },
      env: {
        get: (key: string) => (key === "INIT_CWD" ? "/repo" : undefined)
      }
    });

    const [, request] = fetch.mock.calls[0] ?? [];
    const form = request?.body as FormData;
    const file = form.get("audio");

    expect(request?.method).toBe("POST");
    expect(form.get("preset")).toBe("voice");
    expect(file).toBeInstanceOf(Blob);
    expect((file as { name?: string }).name).toBe("voice.wav");
    expect(Buffer.from(await (file as Blob).arrayBuffer()).toString("utf8")).toBe("input audio");
    expect(await memFs.readFile("/repo/output/clean.wav")).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(result).toEqual({
      output: "/repo/output/clean.wav",
      byteLength: 4,
      contentType: "audio/wav"
    });
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
      version: "1.0.0",
      omitRootToolNamePrefix: true
    });
    const { client: mcpClient, cleanup } = await createClientPair(server);

    try {
      const tools = await mcpClient.listTools();

      expect(tools.tools).toContainEqual(
        expect.objectContaining({
          name: "campaigns__update_campaign",
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

  it("keeps the last successfully materialized spec as the offline fallback", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    const validSpec = JSON.stringify(createListDocument("List cached bots."));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(validSpec, {
          headers: { etag: '"valid-spec"' }
        })
      )
      .mockResolvedValueOnce(new Response('{"openapi":'))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const options = {
      cache: { directory: "/cache", maxAgeMs: 0 },
      fetch,
      fs,
      timeoutMs: 100
    };

    await expect(
      commandsFromSpec("https://example.com/openapi.json", options)
    ).resolves.toMatchObject([
      {
        kind: "group",
        name: "bots",
        children: [{ kind: "command", name: "list" }]
      }
    ]);
    await expect(commandsFromSpec("https://example.com/openapi.json", options)).rejects.toThrow(
      'Failed to parse OpenAPI document "https://example.com/openapi.json"'
    );
    await expect(
      commandsFromSpec("https://example.com/openapi.json", options)
    ).resolves.toMatchObject([
      {
        kind: "group",
        name: "bots",
        children: [{ kind: "command", name: "list" }]
      }
    ]);
  });

  it("enables the default cache with the built-in fetch and a writable filesystem", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify(createListDocument("List cached bots.")))
    );
    vi.stubGlobal("fetch", fetch);

    try {
      await commandsFromSpec("https://example.com/openapi.json", { fs });
      await commandsFromSpec("https://example.com/openapi.json", { fs });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows the default disk cache to be disabled through the environment", async () => {
    const volume = Volume.fromJSON({}, "/");
    const fs = createFsFromVolume(volume).promises;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify(createListDocument("List live bots.")))
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("TOOLCRAFT_OPENAPI_CACHE", "0");

    try {
      await commandsFromSpec("https://example.com/openapi.json", { fs });
      await commandsFromSpec("https://example.com/openapi.json", { fs });
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }

    expect(fetch).toHaveBeenCalledTimes(2);
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

  it("surfaces non-2xx spec-fetch responses with body snippets", async () => {
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<!doctype html>\n<title>Not Found</title>", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/html; charset=utf-8" }
      })
    );

    await expect(
      commandsFromSpec("https://example.com/openapi.json", {
        fetch
      })
    ).rejects.toThrowError(
      /Failed to fetch "https:\/\/example\.com\/openapi\.json": 404 Not Found \(content-type: text\/html; charset=utf-8\)\n {2}body: <!doctype html> <title>Not Found<\/title>/
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

  it("validates runtime array JSON helper items in generated handlers", async () => {
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

    await expect(
      command.handler({
        params: {
          startersJson: "[1,2]"
        },
        baseUrl: client.services.baseUrl,
        tokenSource: client.services.tokenSource,
        fetch
      })
    ).rejects.toMatchObject<UserError>({
      name: "UserError",
      message: 'Invalid value for "--starters-json". Expected string at [0].'
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates runtime array JSON helper object items in generated handlers", async () => {
    const commands = await commandsFromSpec(createArrayObjectBodyDocument());
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

    await expect(
      command.handler({
        params: {
          startersJson: '[{"enabled":true}]'
        },
        baseUrl: client.services.baseUrl,
        tokenSource: client.services.tokenSource,
        fetch
      })
    ).rejects.toMatchObject<UserError>({
      name: "UserError",
      message: 'Invalid value for "--starters-json". Expected required property "title" at [0].'
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps generated code and runtime handlers in parity for preflight + request-shape behavior", async () => {
    const document = createParityDocument();
    const generatedFiles = generate(document, { specSha: "spec-sha-123" });
    const [generatedCommandMeta] = collectGeneratedCommands(document);

    if (generatedCommandMeta === undefined) {
      throw new Error("Expected one generated command.");
    }

    const generatedFile = generatedFiles.find(
      (file) => file.path === generatedCommandMeta.filePath
    );

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
        controls: { output: true },
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

  it("accepts -v as a global verbose flag before generated command paths", async () => {
    const commands = await commandsFromSpec(createSetOfficialDocument());
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const stderrChunks: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
    vi.stubGlobal("fetch", fetch);

    try {
      const client = defineClient({
        name: "internal-agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        commands
      });

      await runCLI(client.root, {
        argv: [
          "node",
          client.name,
          "-v",
          "bots",
          "set-official-bot",
          "demo",
          "--official",
          "--output",
          "json",
          "--yes"
        ],
        controls: { output: true, verbose: true, yes: true },
        rootUsageName: client.name,
        services: client.services
      });
    } finally {
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
      vi.unstubAllGlobals();
    }

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/bots/demo/actions/set-official",
      expect.objectContaining({ method: "POST" })
    );
    expect(stderrChunks.join("")).toContain(
      "→ POST https://example.com/api/bots/demo/actions/set-official"
    );
  });

  it("parses an OpenAPI verbose query parameter as a business param", async () => {
    const commands = await commandsFromSpec({
      openapi: "3.0.3",
      info: { title: "Internal Agent API", version: "1.0.0" },
      paths: {
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "verbose",
                in: "query",
                schema: { type: "boolean" }
              }
            ],
            responses: {
              "200": {
                description: "Listed.",
                content: {
                  "application/json": {
                    schema: { type: "object" }
                  }
                }
              }
            }
          }
        }
      }
    });
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const stderrChunks: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
    const originalArgv = [...process.argv];
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
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

      process.argv = [
        "node",
        client.name,
        "bots",
        "list",
        "--verbose",
        "--output",
        "json",
        "--yes"
      ];

      await runCLI(client.root, {
        controls: { output: true, yes: true },
        rootUsageName: client.name,
        services: client.services
      });
    } finally {
      process.argv = originalArgv;
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
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

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/bots?verbose=true",
      expect.objectContaining({ method: "GET" })
    );
    const stderrText = stderrChunks.join("");
    expect(stderrText).not.toContain("GET https://example.com/api/bots?verbose=true");
  });

  it("does not emit a request line to stderr when --verbose is omitted", async () => {
    const commands = await commandsFromSpec(createSetOfficialDocument());
    const fetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const stderrChunks: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrChunks.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    });
    const originalArgv = [...process.argv];
    const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
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

      process.argv = [
        "node",
        client.name,
        "bots",
        "set-official-bot",
        "demo",
        "--official",
        "--output",
        "json",
        "--yes"
      ];

      await runCLI(client.root, {
        controls: { output: true, verbose: true, yes: true },
        rootUsageName: client.name,
        services: client.services
      });
    } finally {
      process.argv = originalArgv;
      stdoutWrite.mockRestore();
      stderrWrite.mockRestore();
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

    expect(fetch).toHaveBeenCalledTimes(1);
    const stderrText = stderrChunks.join("");
    expect(stderrText).not.toContain("POST https://example.com/api/bots/demo/actions/set-official");
  });

  it("preserves a generated __proto__ query parameter during module evaluation and execution", async () => {
    const document: OpenApiDocument = {
      paths: {
        "/search": {
          get: {
            tags: ["search"],
            operationId: "search",
            parameters: [
              {
                name: "__proto__",
                in: "query",
                schema: { type: "string" }
              }
            ],
            responses: {
              "200": { description: "Searched." }
            }
          }
        }
      }
    };
    const generatedFiles = generate(document, { specSha: "spec-sha-123" });
    const [commandMeta] = collectGeneratedCommands(document);

    if (commandMeta === undefined) {
      throw new Error("Expected one generated command.");
    }

    const generatedFile = generatedFiles.find((file) => file.path === commandMeta.filePath);

    if (generatedFile === undefined) {
      throw new Error("Expected a generated command file.");
    }

    const command = evaluateGeneratedCommand(generatedFile.contents, commandMeta.exportName);

    if (command.kind !== "command") {
      throw new Error("Expected a generated command.");
    }

    expect(Object.hasOwn(command.params.shape, "__proto__")).toBe(true);

    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );

    await command.handler({
      params: Object.fromEntries([["__proto__", "needle"]]),
      baseUrl: "https://example.com/api",
      tokenSource: createAuthProvider([]),
      fetch
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/api/search?__proto__=needle",
      expect.any(Object)
    );

    fetch.mockClear();

    await command.handler({
      params: {},
      baseUrl: "https://example.com/api",
      tokenSource: createAuthProvider([]),
      fetch
    });

    expect(fetch).toHaveBeenCalledWith("https://example.com/api/search", expect.any(Object));
  });
});

describe("defineClientFromSpec", () => {
  it("infers the base URL from the OpenAPI document", async () => {
    const document = createSetOfficialDocument();
    document.servers = [{ url: "https://api.example.com/v1/" }];

    const client = await defineClientFromSpec(document, {
      name: "internal-agent",
      auth: createAuthProvider([])
    });

    expect(client.services.baseUrl).toBe("https://api.example.com/v1");
  });

  it("uses configured environments when an explicit base URL is omitted", async () => {
    const client = await defineClientFromSpec(createSetOfficialDocument(), {
      name: "internal-agent",
      auth: createAuthProvider([]),
      environment: "sandbox",
      config: {
        edition: "2026-05-16",
        environments: {
          production: "https://api.example.com",
          sandbox: "https://sandbox.example.com/"
        }
      }
    });

    expect(client.services.baseUrl).toBe("https://sandbox.example.com");
  });

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
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
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
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/openapi.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
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

  it("surfaces non-2xx spec-fetch responses with body snippets", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("<!doctype html>\n<title>Not Found</title>", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/html; charset=utf-8" }
      })
    );

    await expect(
      defineClientFromSpec("https://example.com/openapi.json", {
        name: "internal-agent",
        baseUrl: "https://example.com/api",
        auth: createAuthProvider([]),
        fetch
      })
    ).rejects.toThrow(
      /Failed to fetch "https:\/\/example\.com\/openapi\.json": 404 Not Found \(content-type: text\/html; charset=utf-8\)\n {2}body: <!doctype html> <title>Not Found<\/title>/
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
