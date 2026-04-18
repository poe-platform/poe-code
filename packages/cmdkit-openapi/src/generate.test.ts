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
                description: "Updated."
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
                description: "Updated."
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
                description: "Updated."
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
});
