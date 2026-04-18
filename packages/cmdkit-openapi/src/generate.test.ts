import { describe, expect, it } from "vitest";
import { UserError } from "@poe-code/cmdkit";
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

  it("emits cmdkit-schema params in generated commands", () => {
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

    expect(commandFile?.contents).toContain('import { defineCommand, S } from "@poe-code/cmdkit";');
    expect(commandFile?.contents).toContain("params: S.Object({");
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
      'import { defineCommand, S, UserError } from "@poe-code/cmdkit";'
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
    expect(commandFile?.contents).toContain('"botHandle": params.botHandle');
    expect(commandFile?.contents).not.toContain("handle: S.String()");
  });

  it("marks generated transport params as non-MCP", () => {
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
      'dryRun: S.Optional(S.Boolean({ description: "Print the HTTP request and exit without sending it.", scope: ["cli", "sdk"] }))'
    );
    expect(commandFile?.contents).toContain(
      'verbose: S.Optional(S.Boolean({ description: "Log the request line to stderr.", short: "v", scope: ["cli", "sdk"] }))'
    );
    expect(commandFile?.contents).toContain(
      'json: S.Optional(S.Boolean({ description: "Print the response as raw JSON.", scope: ["cli", "sdk"] }))'
    );
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

  it("generates query-array params with a repeatable CLI flag, a JSON variant, and query serialization", () => {
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

    expect(commandFile?.contents).toContain('tags: S.Optional(S.Array(S.String(), { scope: ["mcp", "sdk"] }))');
    expect(commandFile?.contents).toContain('tag: S.Optional(S.Array(S.String(), { scope: ["cli"] }))');
    expect(commandFile?.contents).toContain(
      'tagsJson: S.Optional(S.String({ description: "JSON-encoded value for tags.", scope: ["cli"] }))'
    );
    expect(commandFile?.contents).toContain(
      "let resolvedTags = params.tags !== undefined ? params.tags : params.tag;"
    );
    expect(commandFile?.contents).toContain('"tags": resolvedTags');
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
    expect(commandFile?.contents).toContain(
      "let resolvedStarters = params.starters !== undefined ? params.starters : params.starter;"
    );
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

    expect(files.find((file) => file.path === "bots/delete.ts")?.contents).toContain("  confirm: true,");
  });

  it("does not mark non-delete commands as confirmable", () => {
    const files = generate(
      createDocument({
        "/bots/{handle}": {
          get: {
            tags: ["bots"],
            operationId: "viewBot",
            summary: "View a bot.",
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

    expect(files.find((file) => file.path === "bots/view.ts")?.contents).not.toContain(
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
    expect(commandFile?.contents).toContain('starters: S.Array(S.String(), { scope: ["mcp", "sdk"] })');
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
    const startersCommand = files.find(
      (file) => file.path === "bots/set-conversation-starters.ts"
    );

    expect(listCommand?.contents).toContain('limit: S.Optional(S.Number({ minimum: 1, maximum: 100, jsonType: "integer" }))');
    expect(startersCommand?.contents).toContain(
      'starters: S.Array(S.String({ minLength: 3, maxLength: 120, pattern: "^[a-z].+$", format: "date-time" }), { scope: ["mcp", "sdk"], minItems: 1, maxItems: 4'
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
    expect(commandFile?.contents).toContain("const resolvedLimit = params.limitNull ? null : params.limit;");
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

  it("throws when an operation declares a non-JSON success response", () => {
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
    ).toThrowError(
      new UserError(
        'Operation "exportBot" declares unsupported success response content type(s) for status "200": "text/plain". Only application/json responses (or empty success responses) are supported in v1.'
      )
    );
  });

  it("throws when a request body omits application/json content", () => {
    expect(() =>
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
                  "application/xml": {
                    schema: { type: "string" }
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
      )
    ).toThrowError(
      new UserError(
        'Operation "importBot" must define requestBody.content["application/json"] in v1.'
      )
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

  it("throws when an operation has no tags", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots": {
            get: {
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
      )
    ).toThrowError(
      new UserError('Operation "listBots" must define tags[0] to derive a command noun.')
    );
  });

  it("throws when an ambiguous operation omits operationId", () => {
    expect(() =>
      generate(
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
      )
    ).toThrowError(
      new UserError(
        'Operation "POST /bots/search" is missing an operationId, so cmdkit-openapi cannot derive a stable command verb.'
      )
    );
  });

  it("throws when an operation uses an unsupported header parameter", () => {
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
      )
    ).toThrowError(
      new UserError('Operation "listBots" uses unsupported parameter location "header".')
    );
  });

  it("throws when two operations resolve to the same noun and verb", () => {
    expect(() =>
      generate(
        createDocument({
          "/bots": {
            get: {
              tags: ["bots"],
              operationId: "listBots",
              responses: {
                "200": {
                  description: "List."
                }
              }
            }
          },
          "/bots/list": {
            get: {
              tags: ["bots"],
              operationId: "listBotsAgain",
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
        'Generated command path "bots list" is defined more than once ("listBots" and "listBotsAgain").'
      )
    );
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
});
