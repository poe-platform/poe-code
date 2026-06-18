import { describe, expect, it } from "vitest";
import { UserError } from "toolcraft";
import { generate, type OpenApiDocument } from "./generate.js";

function createDocument(paths: OpenApiDocument["paths"]): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: {
      title: "Internal Agent API",
      version: "1.0.0"
    },
    paths
  };
}

describe("generate", () => {
  it("resolves percent-encoded local JSON Pointer path references", () => {
    const files = generate(
      createDocument({
        "/bots/{botId}": {
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            parameters: [{ name: "botId", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Viewed." } }
          }
        },
        "/bots/{botId}/status": {
          get: {
            tags: ["bots"],
            operationId: "viewBotStatus",
            parameters: [{ $ref: "#/paths/~1bots~1%7BbotId%7D/get/parameters/0" }],
            responses: { "200": { description: "Viewed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/bot-status.ts");
    expect(commandFile?.contents).toContain('"botId": params.botId,');
  });

  it("unwraps parameter-shaped references used as array item schemas", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "fields",
                in: "query",
                schema: {
                  type: "array",
                  items: { $ref: "#/paths/~1bots~1%7BbotId%7D/get/parameters/1" }
                }
              }
            ],
            responses: { "200": { description: "Listed." } }
          }
        },
        "/bots/{botId}": {
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            parameters: [
              { name: "botId", in: "path", required: true, schema: { type: "string" } },
              { name: "fields", in: "query", schema: { type: "string", enum: ["name", "status"] } }
            ],
            responses: { "200": { description: "Viewed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/list.ts")?.contents).toContain(
      'fields: S.Optional(S.Array(S.Enum(["name","status"] as const)))'
    );
  });

  it("sends an empty object for a required empty-object request body", () => {
    const files = generate(
      createDocument({
        "/zones": {
          post: {
            tags: ["zones"],
            operationId: "listAvailableZones",
            requestBody: {
              required: true,
              content: { "application/json": { schema: { type: "object", properties: {} } } }
            },
            responses: { "200": { description: "Listed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.contents.includes("operation-id: listAvailableZones"))?.contents).toContain(
      "body: {}"
    );
  });

  it("generates commands from Swagger 2 query and body parameters", () => {
    const files = generate(
      {
        swagger: "2.0",
        info: { title: "Internal Agent API", version: "1.0.0" },
        consumes: ["application/json"],
        produces: ["application/json"],
        definitions: {
          BotInput: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" } }
          }
        },
        paths: {
          "/bots": {
            post: {
              tags: ["bots"],
              operationId: "createBot",
              parameters: [
                { name: "notify", in: "query", type: "boolean" },
                { name: "body", in: "body", required: true, schema: { $ref: "#/definitions/BotInput" } }
              ],
              responses: { "200": { description: "Created.", schema: { type: "object" } } }
            }
          }
        }
      } as never,
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/create-bot.ts");

    expect(commandFile?.contents).toContain("notify: S.Optional(S.Boolean())");
    expect(commandFile?.contents).toContain("name: S.String()");
    expect(commandFile?.contents).toContain('"notify": params.notify');
    expect(commandFile?.contents).toContain('"name": params.name');
  });

  it("generates a path-param command with a scalar JSON body", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-official": {
          post: {
            tags: ["bots"],
            operationId: "setOfficial",
            summary: "Mark a bot as official.",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
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
                      official: { type: "boolean" }
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files).toMatchSnapshot();
  });

  it("emits toolcraft schema params in generated commands", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-official": {
          post: {
            tags: ["bots"],
            operationId: "setOfficial",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
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
                      official: { type: "boolean" }
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
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-official.ts");

    expect(commandFile?.contents).toContain('import { S } from "toolcraft";');
    expect(commandFile?.contents).toContain("params: S.Object({");
  });

  it("adds a generated header to every generated TypeScript file", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            responses: {
              "200": {
                description: "Listed."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    for (const file of files) {
      expect(file.contents).toContain("/**\n * Generated by toolcraft-openapi.\n");
    }
  });

  it("sorts generated index imports and groups by noun and verb", () => {
    const files = generate(
      createDocument({
        "/widgets/publish": {
          post: {
            tags: ["widgets"],
            operationId: "publishWidgets",
            responses: {
              "200": {
                description: "Published."
              }
            }
          }
        },
        "/accounts/logout": {
          post: {
            tags: ["accounts"],
            operationId: "logoutAccounts",
            responses: {
              "200": {
                description: "Logged out."
              }
            }
          }
        },
        "/widgets/archive": {
          post: {
            tags: ["widgets"],
            operationId: "archiveWidgets",
            responses: {
              "200": {
                description: "Archived."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "index.ts")?.contents).toMatchInlineSnapshot(`
      "/**
       * Generated by toolcraft-openapi.
       */
      import { defineGroup } from "toolcraft";
      import { accountsLogoutCommand } from "./accounts/logout.js";
      import { widgetsArchiveCommand } from "./widgets/archive.js";
      import { widgetsPublishCommand } from "./widgets/publish.js";

      export const accounts = defineGroup({
        name: "accounts",
        children: [accountsLogoutCommand],
      });

      export const widgets = defineGroup({
        name: "widgets",
        children: [widgetsArchiveCommand, widgetsPublishCommand],
      });

      export const generatedCommands = [accounts, widgets] as const;
      "
    `);
  });

  it("emits a generated CLI theme bootstrap from plain brand and tool-name strings", () => {
    const files = generate(createDocument({}), {
      specSha: "spec-sha-123",
      brand: "green"
    });

    expect(files.find((file) => file.path === "cli.ts")?.contents).toContain(
      'configureTheme({ brand: "green", label: "Internal Agent API" });'
    );
  });

  it("emits an empty generated index module when the document has no operations", () => {
    const files = generate(createDocument({}), { specSha: "spec-sha-123" });

    expect(files).toEqual([
      {
        path: "index.ts",
        contents:
          "/**\n * Generated by toolcraft-openapi.\n */\nexport const generatedCommands = [] as const;\n"
      },
      {
        path: "cli.ts",
        contents:
          '#!/usr/bin/env node\n/**\n * Generated by toolcraft-openapi.\n */\nimport { configureTheme, runCLI } from "toolcraft/cli";\nimport { generatedCommands } from "./index.js";\n\nconfigureTheme({ brand: "blue", label: "Internal Agent API" });\n\nawait runCLI(generatedCommands);\n'
      }
    ]);
  });

  it("renders option-less scalar, enum, and array definitions without extra arguments", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/update-metadata": {
          post: {
            tags: ["bots"],
            operationId: "updateMetadata",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["label", "status"],
                    properties: {
                      label: { type: "string" },
                      status: {
                        type: "string",
                        enum: ["draft", "published"]
                      },
                      tags: {
                        type: "array",
                        items: { type: "string" }
                      }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/update-metadata.ts");

    expect(commandFile?.contents).toContain("label: S.String()");
    expect(commandFile?.contents).toContain('status: S.Enum(["draft","published"] as const)');
    expect(commandFile?.contents).toContain("tags: S.Optional(S.Array(S.String()))");
  });

  it("imports UserError when generated preflight guards are present", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-limit": {
          post: {
            tags: ["bots"],
            operationId: "setLimit",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/set-limit.ts")?.contents).toContain(
      'import { S, UserError } from "toolcraft";'
    );
  });

  it("does not import UserError when generated preflight guards are absent", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-official": {
          post: {
            tags: ["bots"],
            operationId: "setOfficial",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
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
                      official: { type: "boolean" }
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/set-official.ts")?.contents).toContain(
      'import { S } from "toolcraft";'
    );
    expect(files.find((file) => file.path === "bots/set-official.ts")?.contents).not.toContain(
      'import { S, UserError } from "toolcraft";'
    );
  });

  it("emits auth: none for operations that declare security: []", () => {
    const files = generate(
      createDocument({
        "/status": {
          get: {
            tags: ["status"],
            operationId: "getStatus",
            security: [],
            responses: {
              "200": {
                description: "OK."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path !== "index.ts")?.contents).toContain(
      '      auth: "none",'
    );
  });

  it("emits auth: none when neither the operation nor the document declares security", () => {
    const files = generate(
      createDocument({
        "/status": {
          get: {
            tags: ["status"],
            operationId: "getStatus",
            responses: {
              "200": {
                description: "OK."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path !== "index.ts")?.contents).toContain(
      '      auth: "none",'
    );
  });

  it("emits auth: required when the document declares security", () => {
    const files = generate(
      {
        openapi: "3.0.3",
        info: {
          title: "Internal Agent API",
          version: "1.0.0"
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer"
            }
          }
        },
        security: [{ bearerAuth: [] }],
        paths: {
          "/status": {
            get: {
              tags: ["status"],
              operationId: "getStatus",
              responses: {
                "200": {
                  description: "OK."
                }
              }
            }
          }
        }
      },
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path !== "index.ts")?.contents).toContain(
      '      auth: "required",'
    );
  });

  it("rejects document-level security that references an undefined scheme", () => {
    expect(() =>
      generate(
        {
          openapi: "3.0.3",
          info: {
            title: "Internal Agent API",
            version: "1.0.0"
          },
          security: [{ bearerAuth: [] }],
          paths: {
            "/status": {
              get: {
                tags: ["status"],
                operationId: "getStatus",
                responses: {
                  "200": {
                    description: "OK."
                  }
                }
              }
            }
          }
        },
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "getStatus" references undefined security scheme "bearerAuth" in document security. Expected components.securitySchemes to define it.'
      )
    );
  });

  it("rejects inherited document-level security scheme names", () => {
    expect(() =>
      generate(
        {
          openapi: "3.0.3",
          info: { title: "Internal Agent API", version: "1.0.0" },
          components: { securitySchemes: {} },
          security: [{ constructor: [] }],
          paths: {
            "/status": {
              get: {
                tags: ["status"],
                operationId: "getStatus",
                responses: { "200": { description: "OK." } }
              }
            }
          }
        },
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "getStatus" references undefined security scheme "constructor" in document security. Expected components.securitySchemes to define it.'
      )
    );
  });

  it("rejects operation-level security that references an undefined scheme", () => {
    expect(() =>
      generate(
        {
          openapi: "3.0.3",
          info: {
            title: "Internal Agent API",
            version: "1.0.0"
          },
          components: {
            securitySchemes: {
              bearerAuth: {
                type: "http",
                scheme: "bearer"
              }
            }
          },
          paths: {
            "/status": {
              get: {
                tags: ["status"],
                operationId: "getStatus",
                security: [{ sessionAuth: [] }],
                responses: {
                  "200": {
                    description: "OK."
                  }
                }
              }
            }
          }
        },
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "getStatus" references undefined security scheme "sessionAuth" in operation security. Expected components.securitySchemes to define it.'
      )
    );
  });

  it("inherits auth: none from document-level security: []", () => {
    const files = generate(
      {
        openapi: "3.0.3",
        info: {
          title: "Internal Agent API",
          version: "1.0.0"
        },
        security: [],
        paths: {
          "/status": {
            get: {
              tags: ["status"],
              operationId: "getStatus",
              responses: {
                "200": {
                  description: "OK."
                }
              }
            }
          }
        }
      },
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path !== "index.ts")?.contents).toContain(
      '      auth: "none",'
    );
  });

  it("keeps explicit camel-cased param names instead of stripping the noun prefix", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-official": {
          post: {
            tags: ["bots"],
            operationId: "setOfficial",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
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
                      official: { type: "boolean" }
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
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-official.ts");

    expect(commandFile?.contents).toContain("botHandle: S.String()");
    expect(commandFile?.contents).toContain('  positional: ["botHandle"],');
    expect(commandFile?.contents).toContain('"botHandle": params.botHandle');
    expect(commandFile?.contents).not.toContain("handle: S.String()");
  });

  it("marks generated transport params as non-MCP without a per-command json flag", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-official": {
          post: {
            tags: ["bots"],
            operationId: "setOfficial",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
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
                      official: { type: "boolean" }
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
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-official.ts");

    expect(commandFile?.contents).toContain(
      'verbose: S.Optional(S.Boolean({ description: "Log the request line to stderr.", short: "v", scope: ["cli", "sdk"], global: true }))'
    );
    expect(commandFile?.contents).not.toContain("dryRun: S.Optional");
    expect(commandFile?.contents).not.toContain(
      'json: S.Optional(S.Boolean({ description: "Print the response as raw JSON.", scope: ["cli", "sdk"] }))'
    );
  });

  it("keeps OpenAPI dry_run body fields as business params without transport collisions", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/rename": {
          post: {
            tags: ["bot-actions"],
            operationId: "renameBot",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["dry_run", "new_handle"],
                    properties: {
                      dry_run: {
                        type: "boolean",
                        description: "Ask the API to simulate the rename."
                      },
                      new_handle: { type: "string" }
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
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) =>
      file.contents.includes("Ask the API to simulate the rename.")
    );

    expect(commandFile?.contents).toContain(
      '"dry_run": S.Boolean({ description: "Ask the API to simulate the rename." })'
    );
    expect(commandFile?.contents).toContain('"dry_run": params.dry_run');
    expect(commandFile?.contents).not.toContain("Print the HTTP request and exit without sending it.");
    expect(commandFile?.contents).not.toContain("dryRun: params.dryRun");
  });

  it("omits the generated json transport param when the success response has no body schema", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-official": {
          post: {
            tags: ["bots"],
            operationId: "setOfficial",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
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
                      official: { type: "boolean" }
                    }
                  }
                }
              }
            },
            responses: {
              "204": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/set-official.ts")?.contents).not.toContain(
      'json: S.Optional(S.Boolean({ description: "Print the response as raw JSON.", scope: ["cli", "sdk"] }))'
    );
  });

  it("generates an enum JSON body command", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-image-comprehension": {
          post: {
            tags: ["bots"],
            operationId: "setImageComprehension",
            summary: "Set image comprehension mode.",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["mode"],
                    properties: {
                      mode: {
                        type: "string",
                        enum: ["off", "auto", "forced"]
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files).toMatchSnapshot();
  });

  it("preserves integer enums in the emitted MCP schema", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-status-code": {
          post: {
            tags: ["bots"],
            operationId: "setStatusCode",
            summary: "Set a status code.",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["statusCode"],
                    properties: {
                      statusCode: {
                        type: "integer",
                        enum: [1, 2]
                      }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files).toMatchSnapshot();
  });

  it("trusts explicit enum primitive values when schema.type disagrees", () => {
    const files = generate(
        createDocument({
          "/bots/{botHandle}/actions/set-image-comprehension": {
            post: {
              tags: ["bots"],
              operationId: "setImageComprehension",
              parameters: [
                {
                  name: "botHandle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["mode"],
                      properties: {
                        mode: {
                          type: "string",
                          enum: [1, 2]
                        }
                      }
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Updated."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-image-comprehension.ts");

    expect(commandFile?.contents).toContain("mode: S.Enum([1,2] as const)");
  });

  it("infers nullable enums when explicit values include null", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              { name: "status", in: "query", schema: { type: "string", enum: ["active", null] } }
            ],
            responses: { "200": { description: "Listed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");
    expect(commandFile?.contents).toContain('status: S.Optional(S.Enum(["active"] as const, { nullable: true }))');
  });

  it("ignores malformed non-primitive enum metadata when valid choices remain", () => {
    const files = generate(
      createDocument({
        "/expenses": {
          get: {
            tags: ["expenses"],
            operationId: "listExpenses",
            parameters: [
              {
                name: "projects",
                in: "query",
                schema: { type: "string", enum: ["all", "none", ["project1", "project2"]] }
              }
            ],
            responses: { "200": { description: "Listed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.contents.includes("operation-id: listExpenses"))?.contents;
    expect(command).toContain('projects: S.Optional(S.Enum(["all","none"]');
  });

  it("collapses same-shape oneOf and anyOf parameter branches", () => {
    const files = generate(
      createDocument({
        "/images": {
          get: {
            tags: ["images"],
            operationId: "searchImages",
            parameters: [
              {
                name: "countries",
                in: "query",
                schema: {
                  oneOf: [
                    { type: "array", items: { type: "string", format: "country-code-2" } },
                    { type: "array", items: { type: "string", format: "negated-country-code-2" } }
                  ]
                }
              },
              {
                name: "region",
                in: "query",
                schema: {
                  anyOf: [
                    { type: "string", format: "country-code-2" },
                    { type: "string", format: "ipv4" }
                  ]
                }
              }
            ],
            responses: { "200": { description: "Searched." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.contents.includes("operation-id: searchImages"))?.contents;
    expect(command).toContain('countries: S.Optional(S.Array(S.String()))');
    expect(command).toContain('region: S.Optional(S.String())');
  });

  it("preserves enum values when collapsing same-shape oneOf parameter branches", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "status",
                in: "query",
                schema: {
                  oneOf: [
                    { type: "string", enum: ["active"] },
                    { type: "string", enum: ["archived"] }
                  ]
                }
              }
            ],
            responses: { "200": { description: "Listed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.contents.includes("operation-id: listBots"))?.contents;
    expect(command).toContain('status: S.Optional(S.Enum(["active","archived"]');
    expect(command).not.toContain("status: S.Optional(S.String())");
  });

  it("serializes deepObject query arrays with bracketed keys", () => {
    const files = generate(
      createDocument({
        "/accounts": {
          get: {
            tags: ["accounts"],
            operationId: "listAccounts",
            parameters: [
              {
                name: "expand",
                in: "query",
                style: "deepObject",
                explode: true,
                schema: { type: "array", items: { type: "string" } }
              }
            ],
            responses: { "200": { description: "Listed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.contents.includes("operation-id: listAccounts"))?.contents;
    expect(command).toContain('"expand[]": resolvedExpand,');
  });

  it("uses JSON params for deepObject query unions", () => {
    const files = generate(
      createDocument({
        "/accounts": {
          get: {
            tags: ["accounts"],
            operationId: "listAccounts",
            parameters: [
              {
                name: "created",
                in: "query",
                style: "deepObject",
                explode: true,
                schema: {
                  anyOf: [
                    { type: "object", properties: { gt: { type: "integer" } } },
                    { type: "integer" }
                  ]
                }
              }
            ],
            responses: { "200": { description: "Listed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.contents.includes("operation-id: listAccounts"))?.contents;
    expect(command).toContain('created: S.Optional(S.Json())');
    expect(command).toContain('"created": params.created,');
  });

  it("uses JSON params for deepObject arrays of objects", () => {
    const files = generate(
      createDocument({
        "/credit-notes/preview": {
          get: {
            tags: ["credit-notes"],
            operationId: "previewCreditNote",
            parameters: [
              {
                name: "lines",
                in: "query",
                style: "deepObject",
                explode: true,
                schema: {
                  type: "array",
                  items: { type: "object", properties: { amount: { type: "integer" } } }
                }
              }
            ],
            responses: { "200": { description: "Previewed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.contents.includes("operation-id: previewCreditNote"))?.contents;
    expect(command).toContain('lines: S.Optional(S.Json())');
    expect(command).toContain('"lines": params.lines,');
  });

  it("promotes a query-declared path placeholder to a required path parameter", () => {
    const files = generate(
      createDocument({
        "/bots/{bot_id}": {
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            parameters: [{ name: "bot_id", in: "query", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Viewed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/view.ts");
    expect(commandFile?.contents).toContain('pathParams: {\n        "bot_id": params.bot_id,');
    expect(commandFile?.contents).not.toContain('query: {\n        "bot_id": params.bot_id,');
  });

  it("generates a scalar query command", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            summary: "List bots.",
            parameters: [
              {
                name: "owner",
                in: "query",
                schema: { type: "string" }
              },
              {
                name: "limit",
                in: "query",
                schema: { type: "integer", default: 50 }
              }
            ],
            responses: {
              "200": {
                description: "List.",
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files).toMatchSnapshot();
  });

  it("preserves spec param order in generated params", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-official": {
          post: {
            tags: ["bots"],
            operationId: "setOfficialWithFilters",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              {
                name: "owner",
                in: "query",
                schema: { type: "string" }
              },
              {
                name: "limit",
                in: "query",
                schema: { type: "integer", default: 50 }
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
                      official: { type: "boolean" }
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path !== "index.ts")?.contents).toContain(`params: S.Object({
    botHandle: S.String(),
    owner: S.Optional(S.String()),
    limit: S.Optional(S.Number({ default: 50, jsonType: "integer" })),
    official: S.Boolean(),
    verbose: S.Optional(S.Boolean({ description: "Log the request line to stderr.", short: "v", scope: ["cli", "sdk"], global: true })),
  }),`);
  });

  it("generates query-array params with a plural CLI flag, a JSON variant, and query serialization", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            summary: "List bots.",
            parameters: [
              {
                name: "tags",
                in: "query",
                schema: {
                  type: "array",
                  items: {
                    type: "string"
                  }
                }
              }
            ],
            responses: {
              "200": {
                description: "List.",
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
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).toContain("tags: S.Optional(S.Array(S.String()))");
    expect(commandFile?.contents).toContain(
      'tagsJson: S.Optional(S.String({ description: "JSON-encoded value for tags.", scope: ["cli"] }))'
    );
    expect(commandFile?.contents).toContain("let resolvedTags = params.tags;");
    expect(commandFile?.contents).toContain('"tags": resolvedTags');
  });

  it("serializes form explode=false query arrays as comma-delimited strings", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "tags",
                in: "query",
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
            responses: {
              "200": {
                description: "List.",
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/list.ts")?.contents).toContain(
      '"tags": resolvedTags === undefined || resolvedTags === null ? resolvedTags : resolvedTags.join(",")'
    );
  });

  it("serializes pipeDelimited query arrays as pipe-delimited strings", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "tags",
                in: "query",
                style: "pipeDelimited",
                schema: {
                  type: "array",
                  items: {
                    type: "string"
                  }
                }
              }
            ],
            responses: {
              "200": {
                description: "List.",
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/list.ts")?.contents).toContain(
      '"tags": resolvedTags === undefined || resolvedTags === null ? resolvedTags : resolvedTags.join("|")'
    );
  });

  it("rejects unsupported query-array serialization styles", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots": {
            get: {
              tags: ["bots"],
              operationId: "listBots",
              parameters: [
                {
                  name: "tags",
                  in: "query",
                  style: "deepObject",
                  schema: {
                    type: "array",
                    items: {
                      type: "string"
                    }
                  }
                }
              ],
              responses: {
                "200": {
                  description: "List.",
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
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "listBots" uses unsupported query-array serialization for parameter "tags". Supported in v1: form (explode true/false) and pipeDelimited.'
      )
    );
  });

  it("does not add a null helper flag for nullable query arrays", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "tags",
                in: "query",
                schema: {
                  type: "array",
                  nullable: true,
                  items: {
                    type: "string"
                  }
                }
              }
            ],
            responses: {
              "200": {
                description: "List.",
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
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).not.toContain("tagsNull");
  });

  it("does not advertise nullable query arrays in generated params schemas", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "tags",
                in: "query",
                schema: {
                  type: "array",
                  nullable: true,
                  items: {
                    type: "string"
                  }
                }
              }
            ],
            responses: {
              "200": {
                description: "List.",
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/list.ts")?.contents).not.toContain(
      "nullable: true"
    );
  });

  it("does not add a null helper flag for nullable scalar query params", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "cursor",
                in: "query",
                schema: {
                  type: "string",
                  nullable: true
                }
              }
            ],
            responses: {
              "200": {
                description: "List.",
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
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).toContain("cursor: S.Optional(S.String({ nullable: true }))");
    expect(commandFile?.contents).not.toContain("cursorNull");
  });

  it("preserves original OpenAPI names in generated params and skips array singularization", () => {
    const files = generate(
      createDocument({
        "/bots/{bot_handle}/actions/set-preferences": {
          post: {
            tags: ["bots"],
            operationId: "setPreferences",
            parameters: [
              {
                name: "bot_handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              {
                name: "x-trace-id",
                in: "query",
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["user_name", "status"],
                    properties: {
                      user_name: { type: "string" },
                      status: {
                        type: "array",
                        items: { type: "string" }
                      }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-preferences.ts");

    expect(commandFile?.contents).toContain('"bot_handle": S.String()');
    expect(commandFile?.contents).toContain('"x-trace-id": S.Optional(S.String())');
    expect(commandFile?.contents).toContain('"user_name": S.String()');
    expect(commandFile?.contents).toContain("status: S.Optional(S.Array(S.String()");
    expect(commandFile?.contents).not.toContain("statu: S.");
    expect(commandFile?.contents).toContain('"bot_handle": params.bot_handle');
    expect(commandFile?.contents).toContain('"x-trace-id": params["x-trace-id"]');
    expect(commandFile?.contents).toContain('"user_name": params.user_name');
  });

  it("uses the first tag when multiple tags are present", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots", "ignored"],
            operationId: "listBots",
            responses: {
              "200": {
                description: "List."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toContain("bots/list.ts");
  });

  it("uses view as the verb for get-by-id operations", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "200": {
                description: "Viewed."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toContain("bots/view.ts");
  });

  it("uses the operationId-derived verb for singleton GET endpoints", () => {
    const files = generate(
      createDocument({
        "/v1/whoami": {
          get: {
            tags: ["agent"],
            operationId: "whoami_v1_whoami_get",
            summary: "Whoami",
            responses: {
              "200": {
                description: "Viewed."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toContain("agent/whoami.ts");
  });

  it("drops duplicated tag prefixes from slash-delimited operationIds", () => {
    const files = generate(
      createDocument({
        "/repos/{owner}/{repo}/environments/{environment_name}/variables": {
          post: {
            tags: ["actions"],
            operationId: "actions/create-environment-variable",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name", "value"],
                    properties: {
                      name: { type: "string" },
                      value: { type: "string" }
                    }
                  }
                }
              }
            },
            parameters: [
              {
                name: "owner",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              {
                name: "repo",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              {
                name: "environment_name",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "201": {
                description: "Created."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toContain("actions/create-environment-variable.ts");
    expect(
      files.find((file) => file.path === "actions/create-environment-variable.ts")?.contents
    ).toContain("export const actionsCreateEnvironmentVariableCommand");
  });

  it("treats required body fields as optional when the request body is optional", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-description": {
          post: {
            tags: ["bots"],
            operationId: "setDescription",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["description"],
                    properties: {
                      description: { type: "string" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files).toMatchSnapshot();
  });

  it("omits the generated body option when an optional request body has no defined fields", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/update-profile": {
          post: {
            tags: ["bots"],
            operationId: "updateProfile",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      description: { type: "string" },
                      displayName: { type: "string" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/update-profile.ts");

    expect(commandFile?.contents)
      .toContain(`      ...(params.description === undefined && params.displayName === undefined
        ? {}
        : {
            body: {
              "description": params.description,
              "displayName": params.displayName,
            },
          }),`);
  });

  it("uses delete as the verb for delete-by-id operations", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          delete: {
            tags: ["bots"],
            operationId: "deleteBot",
            summary: "Delete a bot.",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "204": {
                description: "Deleted."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files).toMatchSnapshot();
  });

  it("keeps request-body flags on delete operations", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          delete: {
            tags: ["bots"],
            operationId: "deleteBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      reason: { type: "string" }
                    }
                  }
                }
              }
            },
            responses: {
              "204": {
                description: "Deleted."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/delete.ts")?.contents).toContain(
      "reason: S.Optional(S.String())"
    );
  });

  it("generates array body params with a repeatable CLI flag, a JSON variant, and MCP array fidelity", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-conversation-starters": {
          post: {
            tags: ["bots"],
            operationId: "setConversationStarters",
            summary: "Set conversation starters.",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
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
                        maxItems: 4,
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files).toMatchSnapshot();
  });

  it("emits required scopes on body arrays that are CLI-optional because they also have a JSON helper", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-conversation-starters": {
          post: {
            tags: ["bots"],
            operationId: "setConversationStarters",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
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
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(
      files.find((file) => file.path === "bots/set-conversation-starters.ts")?.contents
    ).toContain('starters: S.Optional(S.Array(S.String(), { requiredScopes: ["mcp", "sdk"] }))');
  });

  it("emits required scopes on query arrays that are CLI-optional because they also have a JSON helper", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "tags",
                in: "query",
                required: true,
                schema: {
                  type: "array",
                  items: {
                    type: "string"
                  }
                }
              }
            ],
            responses: {
              "200": {
                description: "List."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/list.ts")?.contents).toContain(
      'tags: S.Optional(S.Array(S.String(), { requiredScopes: ["mcp", "sdk"] }))'
    );
  });

  it("omits readOnly request-body fields from generated command params", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-profile": {
          post: {
            tags: ["bots"],
            operationId: "setProfile",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["displayName", "serverManaged"],
                    properties: {
                      displayName: { type: "string" },
                      serverManaged: { type: "string", readOnly: true }
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files).toMatchSnapshot();
  });

  it("appends requestBody.description to the generated command description", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-official": {
          post: {
            tags: ["bots"],
            operationId: "setOfficial",
            summary: "Mark a bot as official.",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              description: "Requires elevated reviewer approval.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["official"],
                    properties: {
                      official: { type: "boolean" }
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
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/set-official.ts")?.contents).toContain(
      'description: "Mark a bot as official.\\n\\nRequest body: Requires elevated reviewer approval.",'
    );
  });

  it("does not duplicate requestBody.description when a top-level scalar body param already carries it", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/import": {
          post: {
            tags: ["bots"],
            operationId: "importBot",
            summary: "Import a bot.",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              description: "Raw import payload.",
              content: {
                "application/json": {
                  schema: {
                    type: "string"
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Imported."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/import-bot.ts");

    expect(commandFile?.contents).toContain('description: "Import a bot.",');
    expect(commandFile?.contents).toContain(
      'body: S.String({ description: "Raw import payload." })'
    );
    expect(commandFile?.contents).not.toContain(
      'description: "Import a bot.\\n\\nRequest body: Raw import payload.",'
    );
  });

  it("adds a null helper flag for nullable array body fields", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-conversation-starters": {
          post: {
            tags: ["bots"],
            operationId: "setConversationStarters",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
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
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-conversation-starters.ts");

    expect(commandFile?.contents).toContain("startersNull: S.Optional(S.Boolean(");
    expect(commandFile?.contents).toContain("let resolvedStarters = params.starters;");
    expect(commandFile?.contents).toContain("if (params.startersNull) {");
    expect(commandFile?.contents).toContain("resolvedStarters = null;");
  });

  it("marks generated delete commands as confirmable", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          delete: {
            tags: ["bots"],
            operationId: "deleteBot",
            summary: "Delete a bot.",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "204": {
                description: "Deleted."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/delete.ts")?.contents).toContain(
      "  confirm: true,"
    );
  });

  it("resolves local component refs in request bodies and parameter schemas", () => {
    const files = generate(
      {
        openapi: "3.0.3",
        info: {
          title: "Internal Agent API",
          version: "1.0.0"
        },
        components: {
          schemas: {
            BotHandle: {
              type: "string"
            },
            ConversationStarters: {
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
        },
        paths: {
          "/bots/{botHandle}/actions/set-conversation-starters": {
            post: {
              tags: ["bots"],
              operationId: "setConversationStarters",
              parameters: [
                {
                  name: "botHandle",
                  in: "path",
                  required: true,
                  schema: {
                    $ref: "#/components/schemas/BotHandle"
                  }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/ConversationStarters"
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Updated."
                }
              }
            }
          }
        }
      },
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-conversation-starters.ts");

    expect(commandFile?.contents).toContain("botHandle: S.String()");
    expect(commandFile?.contents).toContain(
      'starters: S.Optional(S.Array(S.String(), { requiredScopes: ["mcp", "sdk"] }))'
    );
  });

  it("throws when local component refs form a cycle", () => {
    expect(() =>
      generate(
        {
          openapi: "3.0.3",
          info: {
            title: "Internal Agent API",
            version: "1.0.0"
          },
          components: {
            schemas: {
              CycleA: {
                $ref: "#/components/schemas/CycleB"
              },
              CycleB: {
                $ref: "#/components/schemas/CycleA"
              }
            }
          },
          paths: {
            "/bots/{botHandle}": {
              get: {
                tags: ["bots"],
                operationId: "viewBot",
                parameters: [
                  {
                    name: "botHandle",
                    in: "path",
                    required: true,
                    schema: {
                      $ref: "#/components/schemas/CycleA"
                    }
                  }
                ],
                responses: {
                  "200": {
                    description: "Viewed."
                  }
                }
              }
            }
          }
        },
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "viewBot" uses circular $ref chain in parameter "botHandle": "#/components/schemas/CycleA" -> "#/components/schemas/CycleB" -> "#/components/schemas/CycleA".'
      )
    );
  });

  it("resolves local operation refs", () => {
    const files = generate(
      {
        openapi: "3.0.3",
        info: {
          title: "Internal Agent API",
          version: "1.0.0"
        },
        "x-sharedOperations": {
          listBots: {
            tags: ["bots"],
            operationId: "listBots",
            summary: "List bots.",
            parameters: [
              {
                name: "owner",
                in: "query",
                schema: {
                  type: "string"
                }
              }
            ],
            responses: {
              "200": {
                description: "Listed."
              }
            }
          }
        },
        paths: {
          "/bots": {
            get: {
              $ref: "#/x-sharedOperations/listBots"
            } as unknown as OpenApiDocument["paths"][string]["get"]
          }
        }
      } as OpenApiDocument,
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).toContain('description: "List bots.",');
    expect(commandFile?.contents).toContain("owner: S.Optional(S.String())");
  });

  it("throws when an operation uses an external ref", () => {
    expect(() =>
      generate(
        {
          openapi: "3.0.3",
          info: {
            title: "Internal Agent API",
            version: "1.0.0"
          },
          paths: {
            "/bots": {
              get: {
                $ref: "./operations/list-bots.json"
              } as unknown as OpenApiDocument["paths"][string]["get"]
            }
          }
        },
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "GET /bots" uses unsupported external $ref "./operations/list-bots.json" in operation GET /bots.'
      )
    );
  });

  it("does not resolve missing refs through inherited prototype properties", () => {
    expect(() =>
      generate(
        {
          openapi: "3.0.3",
          info: {
            title: "Internal Agent API",
            version: "1.0.0"
          },
          components: {
            schemas: {}
          },
          paths: {
            "/bots": {
              get: {
                tags: ["bots"],
                operationId: "listBots",
                parameters: [
                  {
                    name: "filter",
                    in: "query",
                    schema: {
                      $ref: "#/components/schemas/__proto__"
                    }
                  }
                ],
                responses: {
                  "200": {
                    description: "Listed."
                  }
                }
              }
            }
          }
        },
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "listBots" references missing $ref "#/components/schemas/__proto__" in parameter "filter".'
      )
    );
  });

  it("ignores inherited reference markers", () => {
    const inheritedSchema = Object.assign(
      Object.create({ $ref: "#/components/schemas/IntegerValue" }),
      { type: "string" }
    ) as never;

    const files = generate(
      {
        ...createDocument({
          "/bots": {
            get: {
              tags: ["bots"],
              operationId: "listBots",
              parameters: [
                {
                  name: "filter",
                  in: "query",
                  schema: inheritedSchema
                }
              ],
              responses: {
                "200": {
                  description: "Listed."
                }
              }
            }
          }
        }),
        components: {
          schemas: {
            IntegerValue: {
              type: "integer"
            }
          }
        }
      },
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).toContain("filter: S.Optional(S.String())");
  });

  it("preserves OpenAPI scalar and array constraints in generated MCP schemas", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            summary: "List bots.",
            parameters: [
              {
                name: "limit",
                in: "query",
                schema: {
                  type: "integer",
                  minimum: 1,
                  maximum: 100
                }
              }
            ],
            responses: {
              "200": {
                description: "List."
              }
            }
          }
        },
        "/bots/{botHandle}/actions/set-conversation-starters": {
          post: {
            tags: ["bots"],
            operationId: "setConversationStarters",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
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
                        minItems: 1,
                        maxItems: 4,
                        items: {
                          type: "string",
                          minLength: 3,
                          maxLength: 120,
                          pattern: "^[a-z].+$",
                          format: "date-time"
                        }
                      }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const listCommand = files.find((file) => file.path === "bots/list.ts");
    const startersCommand = files.find((file) => file.path === "bots/set-conversation-starters.ts");

    expect(listCommand?.contents).toContain(
      'limit: S.Optional(S.Number({ minimum: 1, maximum: 100, jsonType: "integer" }))'
    );
    expect(startersCommand?.contents).toContain(
      'starters: S.Optional(S.Array(S.String({ minLength: 3, maxLength: 120, pattern: "^[a-z].+$", format: "date-time" }), { minItems: 1, maxItems: 4'
    );
  });

  it("adds a null helper flag for nullable scalar body fields", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}/actions/set-limit": {
          post: {
            tags: ["bots"],
            operationId: "setLimit",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
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
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-limit.ts");

    expect(commandFile?.contents).toContain("limitNull: S.Optional(S.Boolean(");
    expect(commandFile?.contents).toContain(
      "const resolvedLimit = params.limitNull ? null : params.limit;"
    );
  });

  it("treats OpenAPI 3.1 anyOf null request body fields as nullable fields", () => {
    const files = generate(
      createDocument({
        "/bots/{botHandle}": {
          patch: {
            tags: ["bots"],
            operationId: "patchBot",
            parameters: [
              {
                name: "botHandle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      display_name: {
                        anyOf: [{ type: "string" }, { type: "null" }]
                      },
                      allow_related_bot_recommendations: {
                        anyOf: [{ type: "null" }, { type: "boolean" }]
                      },
                      picture_url: {
                        type: ["string", "null"],
                        format: "uri",
                        minLength: 1,
                        maxLength: 2083
                      }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find(
      (file) =>
        file.contents.includes('path: "/bots/{botHandle}"') &&
        file.contents.includes('method: "PATCH"')
    );

    expect(commandFile?.contents).toContain(
      '"display_name": S.Optional(S.String({ nullable: true }))'
    );
    expect(commandFile?.contents).toContain(
      '"allow_related_bot_recommendations": S.Optional(S.Boolean({ nullable: true }))'
    );
    expect(commandFile?.contents).toContain(
      '"picture_url": S.Optional(S.String({ minLength: 1, maxLength: 2083, format: "uri", nullable: true }))'
    );
    expect(commandFile?.contents).toContain("displayNameNull: S.Optional(S.Boolean(");
    expect(commandFile?.contents).toContain(
      "const resolvedDisplayName = params.displayNameNull ? null : params.display_name;"
    );
  });

  it("ignores inherited schema composition keywords", () => {
    const inheritedSchema = Object.assign(
      Object.create({
        anyOf: [{ type: "integer" }, { type: "null" }]
      }),
      { type: "string" }
    ) as never;

    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "filter",
                in: "query",
                schema: inheritedSchema
              }
            ],
            responses: {
              "200": {
                description: "Listed."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).toContain("filter: S.Optional(S.String())");
  });

  it("makes required nullable scalar body fields CLI-optional while keeping MCP and SDK required", () => {
    const files = generate(
      createDocument({
        "/bots/actions/set-limit": {
          post: {
            tags: ["bots"],
            operationId: "setBotLimit",
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
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/set-bot-limit.ts");

    expect(commandFile?.contents).toContain(
      'limit: S.Optional(S.Number({ jsonType: "integer", nullable: true, requiredScopes: ["mcp", "sdk"] }))'
    );
    expect(commandFile?.contents).toContain(
      'throw new UserError("Missing required parameter \\"limit\\".");'
    );
  });

  it.each(["head", "options"] as const)("generates supported %s operations", (method) => {
    const files = generate(
      createDocument({
        "/bots": {
          [method]: {
            tags: ["bots"],
            responses: { "200": { description: "Checked." } }
          }
        } as OpenApiDocument["paths"][string]
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toContain(
      `bots/${method === "head" ? "check" : "options"}.ts`
    );
  });

  it("throws for unsupported trace operations instead of silently dropping them", () => {
      expect(() =>
        generate(
          createDocument({
            "/bots": {
              trace: {
                tags: ["bots"],
                operationId: "traceBots",
                responses: {
                  "200": {
                    description: "Listed."
                  }
                }
              }
            } as OpenApiDocument["paths"][string]
          }),
          { specSha: "spec-sha-123" }
        )
      ).toThrowError(
        new UserError(
          'Operation "traceBots" uses unsupported HTTP method "TRACE". Supported in v1: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.'
        )
      );
  });

  it("ignores inherited supported path-item operations", () => {
    const pathItem = Object.create({
      get: {
        tags: ["bots"],
        operationId: "listBots",
        responses: {
          "200": {
            description: "Listed."
          }
        }
      }
    }) as OpenApiDocument["paths"][string];

    const files = generate(
      createDocument({
        "/bots": pathItem
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).not.toContain("bots/list.ts");
  });

  it("ignores inherited unsupported path-item operations", () => {
    const pathItem = Object.create({
      trace: {
        tags: ["bots"],
        operationId: "traceBots",
        responses: {
          "200": {
            description: "Traced."
          }
        }
      }
    }) as OpenApiDocument["paths"][string];

    expect(() =>
      generate(
        createDocument({
          "/bots": pathItem
        }),
        { specSha: "spec-sha-123" }
      )
    ).not.toThrow();
  });

  it("accepts a path placeholder satisfied by a path-item parameter", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          parameters: [
            {
              name: "handle",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            summary: "View a bot.",
            responses: {
              "200": {
                description: "Viewed."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/view.ts")?.contents).toContain(
      '"handle": params.handle'
    );
  });

  it("throws when a path placeholder has no matching path parameter", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              responses: {
                "200": {
                  description: "Viewed."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "viewBot" path "/bots/{handle}" references "{handle}" but does not define a matching path parameter.'
      )
    );
  });

  it("throws when a declared path parameter does not appear in the path template", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "viewBot" path "/bots" declares path parameter "handle" but the path template does not include "{handle}".'
      )
    );
  });

  it("throws when a path parameter is not marked required", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: false,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError('Operation "viewBot" path parameter "handle" must set required: true.')
    );
  });

  it("throws when a path parameter uses a non-default style", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  style: "label",
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "viewBot" path parameter "handle" uses unsupported serialization. Path parameters must use style "simple" with explode false in v1.'
      )
    );
  });

  it("throws when a path parameter sets explode to true", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  explode: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "viewBot" path parameter "handle" uses unsupported serialization. Path parameters must use style "simple" with explode false in v1.'
      )
    );
  });

  it("generates text response commands for textual success media types", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}/export": {
            get: {
              tags: ["bots"],
              operationId: "exportBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Exported.",
                  content: {
                    "text/plain": {
                      schema: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/export-bot.ts");
    expect(commandFile?.contents).toContain('responseMode: "text",');
    expect(commandFile?.contents).toContain('accept: "text/plain",');
  });

  it("allows mixed success response content types when JSON is available", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}/export": {
            get: {
              tags: ["bots"],
              operationId: "exportBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Exported.",
                  content: {
                    "application/json": {
                      schema: { type: "object" }
                    },
                    "text/plain": {
                      schema: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).not.toThrow();
  });

  it("generates text response commands for wildcard textual success responses", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}/export": {
            get: {
              tags: ["bots"],
              operationId: "exportBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "2XX": {
                  description: "Exported.",
                  content: {
                    "text/plain": {
                      schema: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/export-bot.ts")?.contents).toContain(
      'responseMode: "text",'
    );
  });

  it("accepts wildcard success response media types", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                { name: "handle", in: "path", required: true, schema: { type: "string" } }
              ],
              responses: {
                "200": {
                  description: "Viewed.",
                  content: { "*/*": { schema: { type: "object" } } }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).not.toThrow();
  });

  it("generates text response commands for textual default responses", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}/export": {
            get: {
              tags: ["bots"],
              operationId: "exportBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                default: {
                  description: "Exported.",
                  content: {
                    "text/plain": {
                      schema: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/export-bot.ts")?.contents).toContain(
      'responseMode: "text",'
    );
  });

  it("generates binary response commands for file media types", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/archive": {
          get: {
            tags: ["bots"],
            operationId: "archiveBot",
            parameters: [
              { name: "handle", in: "path", required: true, schema: { type: "string" } }
            ],
            responses: {
              "200": {
                description: "Archived.",
                content: {
                  "application/octet-stream": {
                    schema: { type: "string", format: "binary" }
                  }
                }
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.path === "bots/archive-bot.ts")?.contents;
    expect(command).toContain('responseMode: "binary",');
    expect(command).toContain('accept: "application/octet-stream",');
    expect(command).toContain("output: S.Optional(S.String(");
    expect(command).toContain("writeBinaryResponseOutput(result, params.output, { fs, env });");
  });

  it("allows wildcard error response ranges when success responses stay JSON", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed.",
                  content: {
                    "application/json": {
                      schema: { type: "object" }
                    }
                  }
                },
                "4XX": {
                  description: "Bad request.",
                  content: {
                    "text/plain": {
                      schema: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).not.toThrow();
  });

  it("accepts success response schemas with nested oneOf composition", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed.",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          result: {
                            oneOf: [{ type: "string" }, { type: "integer" }]
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).not.toThrow();
  });

  it("accepts success response schemas that use anyOf for nullable unknown values", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed.",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          before: {
                            anyOf: [{}, { type: "null" }]
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).not.toThrow();
  });

  it("accepts success response schemas with nested additionalProperties", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed.",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          metadata: {
                            type: "object",
                            additionalProperties: {
                              type: "string"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).not.toThrow();
  });

  it("generates raw text request bodies for non-JSON textual media types", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/import": {
          post: {
            tags: ["bots"],
            operationId: "importBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "text/xml": {
                  schema: { type: "object", properties: { name: { type: "string" } } }
                }
              }
            },
            responses: { "200": { description: "Imported." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.path === "bots/import-bot.ts")?.contents;
    expect(command).toContain('bodyMode: "raw",');
    expect(command).toContain('contentType: "text/xml",');
    expect(command).toContain('body: params.body,');
    expect(command).toContain('body: S.String(');
    expect(command).not.toContain('name: S.String(');
  });

  it("generates base64 request bodies for binary media types", () => {
    const files = generate(
      createDocument({
        "/imports": {
          post: {
            tags: ["imports"],
            operationId: "importArchive",
            requestBody: {
              required: true,
              content: {
                "application/zip": {
                  schema: { type: "string", format: "binary" }
                }
              }
            },
            responses: { "200": { description: "Imported." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.path === "imports/import-archive.ts")?.contents;
    expect(command).toContain('bodyMode: "base64",');
    expect(command).toContain('contentType: "application/zip",');
    expect(command).toContain('body: params.body,');
    expect(command).toContain('body: S.String(');
  });

  it("generates multipart forms with declared base64 file fields", () => {
    const files = generate(
      createDocument({
        "/uploads": {
          post: {
            tags: ["uploads"],
            operationId: "uploadFile",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["file"],
                    properties: {
                      file: { type: "string", format: "binary" },
                      description: { type: "string" },
                      placement: { type: "integer" }
                    }
                  }
                }
              }
            },
            responses: { "200": { description: "Uploaded." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.path === "uploads/upload-file.ts")?.contents;
    expect(command).toContain('bodyMode: "multipart",');
    expect(command).toContain('multipartBinaryFields: ["file"],');
    expect(command).toContain("prepareMultipartFileInputs(requestShape, {");
    expect(command).toContain('file: S.String(');
    expect(command).toContain('description: S.Optional(S.String(');
    expect(command).toContain('placement: S.Optional(S.Number(');
  });

  it("generates URL-encoded form request bodies", () => {
    const files = generate(
      createDocument({
        "/tokens": {
          post: {
            tags: ["tokens"],
            operationId: "createToken",
            requestBody: {
              required: true,
              content: {
                "application/x-www-form-urlencoded": {
                  schema: {
                    type: "object",
                    required: ["username", "password"],
                    properties: {
                      username: { type: "string" },
                      password: { type: "string" },
                      scopes: { type: "array", items: { type: "string" } }
                    }
                  }
                }
              }
            },
            responses: { "200": { description: "Created." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "tokens/create-token.ts");
    expect(commandFile?.contents).toContain('bodyMode: "form",');
    expect(commandFile?.contents).toContain('"username": params.username,');
    expect(commandFile?.contents).toContain('"password": params.password,');
  });

  it("uses a JSON param when a request body relies on additionalProperties", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}/import": {
            post: {
              tags: ["bots"],
              operationId: "importBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {},
                      additionalProperties: true
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Imported."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      );

    expect(files.find((file) => file.path === "bots/import-bot.ts")?.contents).toContain(
      "body: S.Json()"
    );
  });

  it("accepts request bodies declared as application/json with parameters", () => {
    expect(
      generate(
        createDocument({
          "/bots/{handle}/import": {
            post: {
              tags: ["bots"],
              operationId: "importBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json; charset=utf-8": {
                    schema: {
                      type: "object",
                      properties: {
                        official: { type: "boolean" }
                      }
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Imported."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      ).some((file) => file.contents.includes('"official": params.official'))
    ).toBe(true);
  });

  it("accepts request bodies declared as vendor json media types", () => {
    expect(
      generate(
        createDocument({
          "/bots/{handle}/import": {
            post: {
              tags: ["bots"],
              operationId: "importBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/vnd.api+json": {
                    schema: {
                      type: "object",
                      properties: {
                        official: { type: "boolean" }
                      }
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Imported."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      ).some((file) => file.contents.includes('"official": params.official'))
    ).toBe(true);
  });

  it("generates explicitly declared GET request bodies", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            parameters: [
              { name: "handle", in: "path", required: true, schema: { type: "string" } }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["includeArchived"],
                    properties: { includeArchived: { type: "boolean" } }
                  }
                }
              }
            },
            responses: { "200": { description: "Viewed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.contents.includes("operation-id: viewBot"))?.contents;
    expect(command).toContain('method: "GET",');
    expect(command).toContain('body: {');
    expect(command).toContain('"includeArchived": params.includeArchived,');
  });

  it("uses typed params for nested request body fields", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}": {
            patch: {
              tags: ["bots"],
              operationId: "updateBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        metadata: {
                          type: "object",
                          properties: {
                            theme: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Updated."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      );

    const commandFile = files.find((file) => file.path === "bots/update-bot.ts");

    expect(commandFile?.contents).toContain(
      "metadata: S.Optional(S.Object({ theme: S.Optional(S.String()) }, { additionalProperties: true }))"
    );
    expect(commandFile?.contents).toContain('"metadata": params.metadata');
  });

  it("generates typed schemas for nested required request object fields", () => {
    const files = generate(
      {
        openapi: "3.0.3",
        info: {
          title: "Internal Agent API",
          version: "1.0.0"
        },
        components: {
          schemas: {
            CreateApiBotRequest: {
              type: "object",
              required: ["plan"],
              properties: {
                plan: { $ref: "#/components/schemas/BotCreationPlan-Input" }
              }
            },
            "BotCreationPlan-Input": {
              type: "object",
              required: ["api_bot_settings"],
              properties: {
                api_bot_settings: { $ref: "#/components/schemas/ApiBotSettingsPlan-Input" }
              }
            },
            "ApiBotSettingsPlan-Input": {
              type: "object",
              required: ["model_name", "api_key_reference"],
              properties: {
                model_name: { type: "string" },
                api_key_reference: { $ref: "#/components/schemas/ApiKeyReferencePlan" }
              }
            },
            ApiKeyReferencePlan: {
              type: "object",
              required: ["integration_id"],
              properties: {
                integration_id: { type: "string" },
                key: { type: "string" }
              }
            }
          }
        },
        paths: {
          "/bots": {
            post: {
              tags: ["bots"],
              operationId: "createApiBot",
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/CreateApiBotRequest" }
                  }
                }
              },
              responses: {
                "201": {
                  description: "Created."
                }
              }
            }
          }
        }
      },
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/create-api-bot.ts");

    expect(commandFile?.contents).toContain("plan: S.Object({");
    expect(commandFile?.contents).toContain('"api_bot_settings": S.Object({');
    expect(commandFile?.contents).toContain('"api_key_reference": S.Object({');
    expect(commandFile?.contents).toContain('"integration_id": S.String()');
    expect(commandFile?.contents).toContain("key: S.Optional(S.String())");
    expect(commandFile?.contents).toContain('"plan": params.plan');
  });

  it("uses JSON params for structural object body fields without an explicit type", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          patch: {
            tags: ["bots"],
            operationId: "updateBot",
            parameters: [
              { name: "handle", in: "path", required: true, schema: { type: "string" } }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["metadata", "rules"],
                    properties: {
                      metadata: { properties: { theme: { type: "string" } } },
                      rules: { type: "array", items: { properties: { name: { type: "string" } } } }
                    }
                  }
                }
              }
            },
            responses: { "200": { description: "Updated." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/update-bot.ts");

    expect(commandFile?.contents).toContain("metadata: S.Json()")
    expect(commandFile?.contents).toContain("rules: S.Json()")
  });

  it("uses JSON params for unconstrained request body fields", () => {
    const files = generate(
      createDocument({
        "/bots": {
          post: {
            tags: ["bots"],
            operationId: "createBot",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["configuration", "items"],
                    properties: {
                      configuration: { description: "Provider-defined JSON configuration." },
                      items: { type: "array", items: {} }
                    }
                  }
                }
              }
            },
            responses: { "201": { description: "Created." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/create-bot.ts");

    expect(commandFile?.contents).toContain("configuration: S.Json()")
    expect(commandFile?.contents).toContain("items: S.Json()")
  });

  it("generates deep-object query parameters as JSON params", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "filter",
                in: "query",
                style: "deepObject",
                explode: true,
                schema: {
                  type: "object",
                  properties: {
                    owner: { type: "string" },
                    active: { type: "boolean" }
                  }
                }
              }
            ],
            responses: { "200": { description: "Listed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).toContain("filter: S.Optional(S.Json())");
    expect(commandFile?.contents).toContain('"filter": params.filter,');
  });

  it("generates a command for a top-level scalar request body", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/import": {
          post: {
            tags: ["bots"],
            operationId: "importBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "string",
                    description: "Raw import payload."
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Imported."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/import-bot.ts");

    expect(commandFile?.contents).toContain(
      'body: S.String({ description: "Raw import payload." })'
    );
    expect(commandFile?.contents).toContain("body: params.body,");
    expect(commandFile?.contents).not.toContain("body: {\n");
  });

  it("omits an optional top-level scalar body when it is undefined", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/import": {
          post: {
            tags: ["bots"],
            operationId: "importBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "string",
                    description: "Raw import payload."
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Imported."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/import-bot.ts");

    expect(commandFile?.contents).toContain(`      ...(params.body === undefined
        ? {}
        : {
            body: params.body,
          }),`);
  });

  it("renders query params alongside a top-level scalar body without nesting the body payload", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/import": {
          post: {
            tags: ["bots"],
            operationId: "importBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              {
                name: "mode",
                in: "query",
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "string",
                    description: "Raw import payload."
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Imported."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/import-bot.ts");

    expect(commandFile?.contents).toContain("query: {");
    expect(commandFile?.contents).toContain('"mode": params.mode,');
    expect(commandFile?.contents).toContain(`      ...(params.body === undefined
        ? {}
        : {
            body: params.body,
          }),`);
    expect(commandFile?.contents).not.toContain("body: {\n");
  });

  it("renders query params alongside a top-level array body without nesting the body payload", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/import": {
          post: {
            tags: ["bots"],
            operationId: "importBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              },
              {
                name: "mode",
                in: "query",
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Imported."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/import-bot.ts");

    expect(commandFile?.contents).toContain("query: {");
    expect(commandFile?.contents).toContain('"mode": params.mode,');
    expect(commandFile?.contents).toContain(`      ...(resolvedBody === undefined
        ? {}
        : {
            body: resolvedBody,
          }),`);
    expect(commandFile?.contents).not.toContain("body: {\n");
  });

  it("generates a command for a top-level array request body", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/import": {
          post: {
            tags: ["bots"],
            operationId: "importBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Imported."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/import-bot.ts");

    expect(commandFile?.contents).toContain(
      'bodyJson: S.Optional(S.String({ description: "JSON-encoded value for body.", scope: ["cli"] }))'
    );
    expect(commandFile?.contents).toContain("let resolvedBody = params.body;");
    expect(commandFile?.contents).toContain("body: resolvedBody,");
  });

  it("omits an optional top-level array body when it is undefined", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}/import": {
          post: {
            tags: ["bots"],
            operationId: "importBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: false,
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Imported."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/import-bot.ts");

    expect(commandFile?.contents).toContain(`      ...(resolvedBody === undefined
        ? {}
        : {
            body: resolvedBody,
          }),`);
  });

  it("uses a JSON param for composed request bodies", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}": {
            patch: {
              tags: ["bots"],
              operationId: "updateBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      oneOf: [{ type: "string" }, { type: "integer" }]
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Updated."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      );

    const commandFile = files.find((file) => file.path === "bots/update-bot.ts");
    expect(commandFile?.contents).toContain("body: S.Json()");
    expect(commandFile?.contents).toContain("body: params.body");
  });

  it("uses a JSON param for anyOf request bodies", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}": {
            patch: {
              tags: ["bots"],
              operationId: "updateBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      anyOf: [{ type: "string" }, { type: "integer" }]
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Updated."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      );
    expect(files.find((file) => file.path === "bots/update-bot.ts")?.contents).toContain(
      "body: S.Json()"
    );
  });

  it("uses a JSON param for allOf request bodies", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}": {
            patch: {
              tags: ["bots"],
              operationId: "updateBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      allOf: [{ type: "string" }, { maxLength: 100 }]
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Updated."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      );
    expect(files.find((file) => file.path === "bots/update-bot.ts")?.contents).toContain(
      "body: S.Json()"
    );
  });

  it("allows non-JSON error responses when success responses stay JSON", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Viewed.",
                  content: {
                    "application/json": {
                      schema: { type: "object" }
                    }
                  }
                },
                "400": {
                  description: "Bad request.",
                  content: {
                    "text/plain": {
                      schema: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).not.toThrow();
  });

  it("falls back to a static path segment when an operation has no tags", () => {
    const files = generate(
      createDocument({
        "/v1/accounts": {
          get: {
            operationId: "listAccounts",
            responses: {
              "200": {
                description: "List."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "accounts/list.ts")).toBeDefined();
  });

  it("uses the operation ID as the noun when an operation has no usable static path segment", () => {
    const files = generate(
        createDocument({
          "/{botHandle}": {
            get: {
              operationId: "viewBot",
              parameters: [
                {
                  name: "botHandle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              responses: {
                "200": {
                  description: "Bot."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toContain("view-bot/view.ts");
  });

  it("prefixes a derived noun that starts with a digit", () => {
    const files = generate(
        createDocument({
          "/v2/1-clicks": {
            get: {
              operationId: "listOneClicks",
              responses: {
                "200": {
                  description: "List."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toContain("api-1-clicks/one-clicks.ts");
  });

  it("prefixes a tag-derived noun that maps to a reserved TypeScript identifier", () => {
    const files = generate(
        createDocument({
          "/defaults": {
            get: {
              tags: ["default"],
              operationId: "listDefaults",
              responses: {
                "200": {
                  description: "List."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toContain("api-default/list.ts");
  });

  it("prefers operation.description over summary in generated command descriptions", () => {
    const files = generate(
      createDocument({
        "/events": {
          get: {
            tags: ["activity"],
            operationId: "listPublicEvents",
            summary: "List public events.",
            description: "Events may be delayed by 30 seconds to 6 hours.",
            responses: {
              "200": {
                description: "List."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "activity/public-events.ts");

    expect(commandFile?.contents).toContain(
      'description: "Events may be delayed by 30 seconds to 6 hours.",'
    );
    expect(commandFile?.contents).not.toContain('description: "List public events.",');
  });

  it("falls back to operation.summary when description is absent", () => {
    expect(
      generate(
        createDocument({
          "/events": {
            get: {
              tags: ["activity"],
              operationId: "listPublicEvents",
              summary: "List public events.",
              responses: {
                "200": {
                  description: "List."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      ).find((file) => file.path === "activity/public-events.ts")?.contents
    ).toContain('description: "List public events.",');
  });

  it("preserves additionalProperties: false on generated params schemas for object request bodies", () => {
    const files = generate(
      createDocument({
        "/campaigns/{campaignId}": {
          patch: {
            tags: ["campaigns"],
            operationId: "updateCampaign",
            parameters: [
              {
                name: "campaignId",
                in: "path",
                required: true,
                schema: { type: "string" }
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
                      name: { type: "string" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Updated."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "campaigns/update-campaign.ts");

    expect(commandFile?.contents).toContain("params: S.Object({");
    expect(commandFile?.contents).toContain("  }, { additionalProperties: false }),");
  });

  it("derives a stable verb when an operation omits operationId", () => {
    const files = generate(
        createDocument({
          "/bots/search": {
            post: {
              tags: ["bots"],
              responses: {
                "200": {
                  description: "Searched."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      );

    expect(files.map((file) => file.path)).toContain("bots/create-search.ts");
  });

  it("generates scalar header parameters", () => {
    const files = generate(
        {
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
                parameters: [
                  {
                    name: "x-trace-id",
                    in: "header",
                    schema: { type: "string" }
                  } as never
                ],
                responses: {
                  "200": {
                    description: "List."
                  }
                }
              }
            }
          }
        },
        { specSha: "spec-sha-123" }
      );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).toContain('"x-trace-id": S.Optional(S.String())');
    expect(commandFile?.contents).toContain('headers: {');
    expect(commandFile?.contents).toContain('"x-trace-id": params["x-trace-id"],');
  });

  it("generates explicit Authorization headers for unauthenticated operations", () => {
    const files = generate(
      createDocument({
        "/tokens": {
          post: {
            tags: ["tokens"],
            operationId: "createToken",
            security: [],
            parameters: [
              {
                name: "Authorization",
                in: "header",
                required: true,
                schema: { type: "string" }
              } as never
            ],
            responses: { "200": { description: "Created." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const command = files.find((file) => file.contents.includes("operation-id: createToken"))?.contents;
    expect(command).toContain('"Authorization": S.String(');
    expect(command).toContain('"Authorization": params.Authorization,');
  });

  it("ignores declarative Accept and Content-Type header parameters", () => {
    const files = generate(
      createDocument({
        "/bots": {
          post: {
            tags: ["bots"],
            operationId: "createBot",
            parameters: [
              { name: "Accept", in: "header", required: true, schema: { type: "string" } },
              { name: "Content-Type", in: "header", required: true, schema: { type: "string" } }
            ],
            requestBody: {
              content: { "text/json": { schema: { type: "object", properties: { name: { type: "string" } } } } }
            },
            responses: { "200": { description: "Created." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/create-bot.ts");
    expect(commandFile?.contents).toContain("name: S.Optional(S.String())");
    expect(commandFile?.contents).not.toContain('"Accept": params');
    expect(commandFile?.contents).not.toContain('"Content-Type": params');
  });

  it("throws when an operation uses an unsupported cookie parameter", () => {
    expect(() =>
      generate(
        {
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
                parameters: [
                  {
                    name: "session",
                    in: "cookie",
                    schema: { type: "string" }
                  } as never
                ],
                responses: {
                  "200": {
                    description: "List."
                  }
                }
              }
            }
          }
        },
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "listBots" uses unsupported parameter location "cookie". Only path, query, and header parameters are supported in v1; use auth or handwritten commands for cookies.'
      )
    );
  });

  it("throws when a path parameter is nullable", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{botHandle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "botHandle",
                  in: "path",
                  required: true,
                  schema: {
                    type: "string",
                    nullable: true
                  }
                }
              ],
              responses: {
                "200": {
                  description: "Bot."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "viewBot" path parameter "botHandle" uses unsupported nullable schema. Path parameters cannot be nullable in v1.'
      )
    );
  });

  it("throws when a parameter uses content instead of schema", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots": {
            get: {
              tags: ["bots"],
              operationId: "listBots",
              parameters: [
                {
                  name: "filter",
                  in: "query",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          owner: { type: "string" }
                        }
                      }
                    }
                  }
                } as never
              ],
              responses: {
                "200": {
                  description: "List."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "listBots" parameter "filter" uses unsupported parameter.content. Define path/query parameters with parameter.schema in v1.'
      )
    );
  });

  it("generates fixed per-operation server overrides", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            servers: [{ url: "https://alt.example.com" }],
            responses: { "200": { description: "List." } }
          } as never
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.contents.includes("operation-id: listBots"))?.contents).toContain(
      'baseUrl: "https://alt.example.com",'
    );
  });

  it("serializes path array parameters using simple comma-separated values", () => {
    const files = generate(
        createDocument({
          "/bots/{botHandle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "botHandle",
                  in: "path",
                  required: true,
                  schema: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              ],
              responses: {
                "200": {
                  description: "Bot."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/view.ts");
    expect(commandFile?.contents).toContain("botHandle: S.Array(S.String())");
    expect(commandFile?.contents).toContain('params.botHandle.join(","),');
  });

  it("qualifies duplicate path and query parameter names by location", () => {
    const files = generate(
      createDocument({
        "/bots/{bot_id}": {
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            parameters: [
              { name: "bot_id", in: "path", required: true, schema: { type: "string" } },
              { name: "bot_id", in: "query", required: true, schema: { type: "string" } }
            ],
            responses: { "200": { description: "Viewed." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/view.ts");
    expect(commandFile?.contents).toContain('"bot_id": S.String()')
    expect(commandFile?.contents).toContain("queryBotId: S.String()")
    expect(commandFile?.contents).toContain('"bot_id": params.queryBotId,')
  });

  it("throws when a path parameter uses an object schema", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{botHandle}": {
            get: {
              tags: ["bots"],
              operationId: "viewBot",
              parameters: [
                {
                  name: "botHandle",
                  in: "path",
                  required: true,
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "string" }
                    }
                  }
                }
              ],
              responses: {
                "200": {
                  description: "Bot."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "viewBot" path parameter "botHandle" must use a scalar schema (string, number, integer, or boolean).'
      )
    );
  });

  it("uses operation IDs to disambiguate generated command paths", () => {
    const files = generate(
        createDocument({
          "/quotes": {
            get: {
              tags: ["forex"],
              operationId: "listQuotes",
              responses: {
                "200": {
                  description: "Quotes."
                }
              }
            }
          },
          "/symbols": {
            get: {
              tags: ["forex"],
              operationId: "listSymbols",
              responses: {
                "200": {
                  description: "Symbols."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["forex/quotes.ts", "forex/symbols.ts"])
    );
  });

  it("uses path-qualified verbs when operation IDs cannot disambiguate command paths", () => {
    const files = generate(
        createDocument({
          "/bots": {
            post: {
              tags: ["bots"],
              operationId: "createBot",
              responses: {
                "201": {
                  description: "Created."
                }
              }
            }
          },
          "/bots/create": {
            post: {
              tags: ["bots"],
              operationId: "bots/create-bot",
              responses: {
                "201": {
                  description: "Created."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["bots/create-bot.ts", "bots/create-create.ts"])
    );
  });

  it("throws when path-qualified verbs still cannot distinguish command paths", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/create": {
            post: {
              tags: ["bots"],
              operationId: "createBot",
              responses: {
                "201": {
                  description: "Created."
                }
              }
            }
          },
          "/bots/create/": {
            post: {
              tags: ["bots"],
              operationId: "bots/create-bot",
              responses: {
                "201": {
                  description: "Created."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Generated command path "bots create-bot" is defined more than once ("createBot" and "bots/create-bot").'
      )
    );
  });

  it("uses parent path context when child resource paths collide", () => {
    const files = generate(
      createDocument({
        "/maps/{id}/attachments": {
          post: { tags: ["attachments"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created." } } }
        },
        "/spots/{id}/attachments": {
          post: { tags: ["attachments"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Created." } } }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["attachments/maps-id-attachments.ts", "attachments/spots-id-attachments.ts"])
    );
  });

  it("distinguishes collection and resource paths with identical operation IDs", () => {
    const files = generate(
      createDocument({
        "/products-uuid": {
          patch: {
            tags: ["Product [uuid]"],
            operationId: "patch_products_uuid",
            responses: { "200": { description: "Patched." } }
          }
        },
        "/products-uuid/{uuid}": {
          patch: {
            tags: ["Product [uuid]"],
            operationId: "patch_products_uuid",
            parameters: [{ name: "uuid", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Patched." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "product-uuid/update-products-uuid.ts",
        "product-uuid/update-products-uuid-uuid.ts"
      ])
    );
  });

  it("keeps plural array params distinct from neighboring scalar params", () => {
    const files = generate(
      createDocument({
        "/bots": {
          get: {
            tags: ["bots"],
            operationId: "listBots",
            parameters: [
              {
                name: "tags",
                in: "query",
                schema: {
                  type: "array",
                  items: {
                    type: "string"
                  }
                }
              },
              {
                name: "tag",
                in: "query",
                schema: { type: "string" }
              }
            ],
            responses: {
              "200": {
                description: "List."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/list.ts");

    expect(commandFile?.contents).toContain("tag: S.Optional(S.String())");
    expect(commandFile?.contents).toContain("tags: S.Optional(S.Array(S.String()))");
  });

  it("qualifies body params that collide with path params while preserving wire names", () => {
    const files = generate(
      createDocument({
        "/bots/{code}": {
          patch: {
            tags: ["bots"],
            operationId: "updateBot",
            parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["code"],
                    properties: { code: { type: "string" } }
                  }
                }
              }
            },
            responses: { "200": { description: "Updated." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "bots/update-bot.ts");
    expect(commandFile?.contents).toContain("code: S.String()");
    expect(commandFile?.contents).toContain("bodyCode: S.String()");
    expect(commandFile?.contents).toContain('"code": params.bodyCode');
    expect(commandFile?.contents).toContain('"code": params.code');
  });

  it("throws when the OpenAPI document is missing paths", () => {
    expect(() =>
      generate(
        {
          openapi: "3.0.3",
          info: {
            title: "Internal Agent API",
            version: "1.0.0"
          }
        },
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(new UserError('OpenAPI document must define a top-level "paths" object.'));
  });

  it("emits the same files for identical input", () => {
    const document = createDocument({
      "/bots/{handle}/actions/update-description": {
        put: {
          tags: ["bots"],
          operationId: "updateDescription",
          parameters: [
            {
              name: "handle",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["description"],
                  properties: {
                    description: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Updated."
            }
          }
        }
      }
    });

    expect(generate(document, { specSha: "spec-sha-123" })).toEqual(
      generate(document, { specSha: "spec-sha-123" })
    );
  });

  it("serializes JSON bodies for put operations", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          put: {
            tags: ["bots"],
            operationId: "replaceBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["description"],
                    properties: {
                      description: { type: "string" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Replaced."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/replace-bot.ts")?.contents).toContain(
      '"description": params.description'
    );
  });

  it("serializes JSON bodies for patch operations", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          patch: {
            tags: ["bots"],
            operationId: "patchBot",
            parameters: [
              {
                name: "handle",
                in: "path",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["description"],
                    properties: {
                      description: { type: "string" }
                    }
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Patched."
              }
            }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/patch-bot.ts")?.contents).toContain(
      '"description": params.description'
    );
  });

  it("sends an empty object when a required request body object declares no fields", () => {
    const files = generate(
        createDocument({
          "/bots/{handle}": {
            patch: {
              tags: ["bots"],
              operationId: "patchBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {}
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Patched."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
    );

    expect(files.find((file) => file.path === "bots/patch-bot.ts")?.contents).toContain("body: {}");
  });

  it("throws when a required request body filters all fields via readOnly", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots/{handle}": {
            patch: {
              tags: ["bots"],
              operationId: "patchBot",
              parameters: [
                {
                  name: "handle",
                  in: "path",
                  required: true,
                  schema: { type: "string" }
                }
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        serverManaged: {
                          type: "string",
                          readOnly: true
                        }
                      }
                    }
                  }
                }
              },
              responses: {
                "200": {
                  description: "Patched."
                }
              }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(
      new UserError(
        'Operation "patchBot" requestBody is required but all declared fields are readOnly.'
      )
    );
  });

  it("emits an own schema property for a __proto__ parameter", () => {
    const files = generate(
      createDocument({
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
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "search/list.ts");

    expect(commandFile?.contents).toContain('["__proto__"]: S.Optional(S.String()),');
    expect(commandFile?.contents).toContain(
      '["__proto__"]: (Object.prototype.hasOwnProperty.call(params, "__proto__") ? params["__proto__"] : undefined),'
    );
  });

  it("ignores inherited schema fields", () => {
    const inheritedSchema = Object.assign(
      Object.create({
        default: "prototype-default"
      }),
      { type: "string" }
    ) as never;

    const files = generate(
      createDocument({
        "/search": {
          get: {
            tags: ["search"],
            operationId: "search",
            parameters: [{ name: "term", in: "query", schema: inheritedSchema }],
            responses: { "200": { description: "Searched." } }
          }
        }
      }),
      { specSha: "spec-sha-123" }
    );

    const commandFile = files.find((file) => file.path === "search/list.ts");

    expect(commandFile?.contents).toContain("term: S.Optional(S.String())");
    expect(commandFile?.contents).not.toContain("prototype-default");
  });

  it("rejects inherited scalar schema type names with a user-facing error", () => {
    expect(() =>
      generate(
        createDocument({
          "/search": {
            get: {
              tags: ["search"],
              operationId: "search",
              parameters: [{ name: "term", in: "query", schema: { type: "constructor" as never } }],
              responses: { "200": { description: "Searched." } }
            }
          }
        }),
        { specSha: "spec-sha-123" }
      )
    ).toThrowError(/Operation "search" uses unsupported parameter "term"/);
  });
});
