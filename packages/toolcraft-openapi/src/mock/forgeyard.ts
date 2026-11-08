import type {
  OpenApiDocument,
  OpenApiOperationObject,
  OpenApiParameter,
  OpenApiPathItemObject,
  OpenApiSchemaObject
} from "../generate.js";

export const FORGEYARD_BASE_URL = "https://api.forgeyard.invalid";

export const FORGEYARD_RESOURCES = [
  "artifacts",
  "audits",
  "automations",
  "branches",
  "builds",
  "checks",
  "changes",
  "comments",
  "commits",
  "deployments",
  "discussions",
  "environments",
  "events",
  "files",
  "hooks",
  "identities",
  "integrations",
  "invitations",
  "jobs",
  "keys",
  "labels",
  "licenses",
  "members",
  "milestones",
  "notifications",
  "organizations",
  "packages",
  "pages",
  "permissions",
  "pipelines",
  "policies",
  "projects",
  "releases",
  "repositories",
  "reviews",
  "runners",
  "secrets",
  "sessions",
  "settings",
  "snapshots",
  "statuses",
  "tags",
  "teams",
  "templates",
  "tokens",
  "topics",
  "variables",
  "webhooks",
  "workflows",
  "workspaces",
  "approvals",
  "archives",
  "attestations",
  "billing-accounts",
  "codespaces",
  "dependencies",
  "exports",
  "imports",
  "mirrors",
  "rulesets",
  "security-alerts",
  "service-accounts",
  "signatures",
  "sponsors"
] as const;

const stringSchema: OpenApiSchemaObject = { type: "string" };
const identifierParameter: OpenApiParameter = {
  name: "id",
  in: "path",
  required: true,
  description: "Stable Forgeyard resource identifier.",
  schema: stringSchema
};
const queryParameter: OpenApiParameter = {
  name: "query",
  in: "query",
  description: "Search query.",
  schema: stringSchema
};
const bodySchema: OpenApiSchemaObject = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string", description: "Display name." },
    active: { type: "boolean", description: "Whether the resource is active." },
    labels: { type: "array", items: { type: "string" }, description: "Labels to attach." }
  }
};
const successResponse = {
  description: "Successful Forgeyard response.",
  content: {
    "application/json": {
      schema: { type: "object" as const },
      example: { ok: true }
    }
  }
};

export function createForgeyardSpec(): OpenApiDocument {
  const paths: Record<string, OpenApiPathItemObject> = {};

  for (const resource of FORGEYARD_RESOURCES) {
    const tag = resource;
    const singular = singularize(resource);
    const collectionPath = `/v1/${resource}`;
    const resourcePath = `${collectionPath}/{id}`;
    const searchPath = `${collectionPath}/search`;
    const archivePath = `${collectionPath}/{id}/archive`;

    paths[collectionPath] = {
      get: operation(tag, `list ${resource}`, `List ${resource}.`, [queryParameter]),
      post: operation(tag, `create ${singular}`, `Create a ${singular}.`, [], true)
    };
    paths[resourcePath] = {
      get: operation(tag, `view ${singular}`, `View a ${singular}.`, [identifierParameter]),
      put: operation(
        tag,
        `replace ${singular}`,
        `Replace a ${singular}.`,
        [identifierParameter],
        true
      ),
      patch: operation(
        tag,
        `update ${singular}`,
        `Update a ${singular}.`,
        [identifierParameter],
        true
      ),
      delete: operation(tag, `delete ${singular}`, `Delete a ${singular}.`, [identifierParameter])
    };
    paths[searchPath] = {
      get: operation(tag, `search ${resource}`, `Search ${resource}.`, [queryParameter])
    };
    paths[archivePath] = {
      post: operation(
        tag,
        `archive ${singular}`,
        `Archive a ${singular}.`,
        [identifierParameter],
        true
      )
    };
  }

  paths["/v1/compatibility/quotes"] = {
    get: operation("compatibility", "listQuotes", "List compatibility quotes.", [])
  };
  paths["/v1/compatibility/symbols"] = {
    get: operation("compatibility", "listSymbols", "List compatibility symbols.", [])
  };
  paths["/v1/compatibility/representation"] = {
    get: {
      ...operation(
        "compatibility",
        "get compatibility representation",
        "Negotiate a wildcard JSON representation.",
        [
          {
            name: "x-forgeyard-tenant",
            in: "header",
            required: true,
            schema: { type: "string" }
          }
        ]
      ),
      responses: {
        "200": {
          description: "Successful wildcard response.",
          content: {
            "*/*": {
              schema: { type: "object" },
              example: { ok: true }
            }
          }
        }
      }
    }
  };
  paths["/v1/compatibility/jobs"] = {
    post: {
      tags: ["compatibility"],
      summary: "Create a compatibility job without operationId.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["configuration"],
              properties: {
                configuration: {
                  type: "object",
                  properties: {
                    retries: { type: "integer" },
                    matrix: { type: "array", items: { type: "object" } }
                  }
                }
              }
            }
          }
        }
      },
      responses: { "200": successResponse }
    }
  };
  paths["/v1/compatibility/jobs/{id}"] = {
    put: {
      ...operation(
        "compatibility",
        "PUT /v1/compatibility/jobs/{id}",
        "Update a compatibility job without an explicit operationId.",
        [identifierParameter],
        true
      ),
      operationId: undefined
    }
  };
  paths["/v1/compatibility/jobs/{id}/settings"] = {
    put: {
      ...operation(
        "compatibility",
        "PUT /v1/compatibility/jobs/{id}/settings",
        "Update compatibility job settings without an explicit operationId.",
        [identifierParameter],
        true
      ),
      operationId: undefined
    }
  };
  paths["/v1/compatibility/dictionary"] = {
    post: {
      tags: ["compatibility"],
      operationId: "create compatibility dictionary",
      summary: "Create a free-form compatibility dictionary.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true }
          }
        }
      },
      responses: { "200": successResponse }
    }
  };
  paths["/v1/compatibility/report"] = {
    get: {
      tags: ["compatibility"],
      operationId: "export compatibility report",
      responses: {
        "200": {
          description: "Text report.",
          content: { "text/plain": { schema: { type: "string" }, example: "forgeyard report" } }
        }
      }
    }
  };
  paths["/v1/compatibility/archive"] = {
    get: {
      tags: ["compatibility"],
      operationId: "download compatibility archive",
      responses: {
        "200": {
          description: "Binary archive.",
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" }
            }
          }
        }
      }
    }
  };
  paths["/v1/compatibility/manifest"] = {
    post: {
      tags: ["compatibility"],
      operationId: "import compatibility manifest",
      requestBody: {
        required: true,
        content: {
          "text/xml": {
            schema: { type: "object", properties: { name: { type: "string" } } }
          }
        }
      },
      responses: { "200": successResponse }
    }
  };
  paths["/v1/compatibility/bundle"] = {
    post: {
      tags: ["compatibility"],
      operationId: "upload compatibility bundle",
      requestBody: {
        required: true,
        content: {
          "application/zip": {
            schema: { type: "string", format: "binary" }
          }
        }
      },
      responses: { "200": successResponse }
    }
  };
  paths["/v1/compatibility/attachment"] = {
    post: {
      tags: ["compatibility"],
      operationId: "upload compatibility attachment",
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file", "description"],
              properties: {
                file: { type: "string", format: "binary" },
                description: { type: "string" },
                placement: { type: "integer" }
              }
            }
          }
        }
      },
      responses: { "200": successResponse }
    }
  };
  paths["/v1/compatibility/token"] = {
    post: {
      tags: ["compatibility"],
      operationId: "create compatibility token",
      requestBody: {
        required: true,
        content: {
          "application/x-www-form-urlencoded": {
            schema: {
              type: "object",
              required: ["username"],
              properties: { username: { type: "string" }, scopes: { type: "array", items: { type: "string" } } }
            }
          }
        }
      },
      responses: { "200": successResponse }
    }
  };
  paths["/v1/compatibility/filter"] = {
    get: {
      ...operation("compatibility", "filter compatibility", "Filter compatibility data.", [
        {
          name: "filter",
          in: "query",
          style: "deepObject",
          explode: true,
          schema: { type: "object", properties: { owner: { type: "string" }, active: { type: "boolean" } } }
        }
      ])
    }
  };
  paths["/v1/compatibility/batches/{ids}"] = {
    get: operation("compatibility", "view compatibility batch", "View a compatibility batch.", [
      { name: "ids", in: "path", required: true, schema: { type: "array", items: { type: "string" } } }
    ])
  };
  paths["/v1/compatibility/punctuation"] = {
    get: operation("Product [identifier]", "view punctuation compatibility", "Test safe generated nouns.", [])
  };
  paths["/v1/compatibility/referenced/{id}"] = {
    get: operation("compatibility", "view referenced compatibility", "Source for a cross-path reference.", [identifierParameter])
  };
  paths["/v1/compatibility/referenced/{id}/details"] = {
    get: operation("compatibility", "view referenced compatibility details", "Use a cross-path parameter reference.", [
      { $ref: "#/paths/~1v1~1compatibility~1referenced~1%7Bid%7D/get/parameters/0" }
    ])
  };
  paths["/v1/compatibility/operation-server"] = {
    get: {
      ...operation("compatibility", "view operation server compatibility", "Use a fixed operation-level server.", []),
      servers: [{ url: "https://api.forgeyard.invalid" }]
    }
  };
  paths["/v1/compatibility/explicit-authorization"] = {
    post: {
      ...operation("compatibility", "create explicit authorization compatibility", "Use an explicit authorization header.", [
        { name: "Authorization", in: "header", required: true, schema: { type: "string" } }
      ]),
      security: []
    }
  };
  paths["/v1/compatibility/get-body"] = {
    get: {
      tags: ["compatibility"],
      operationId: "search compatibility with body",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["query"],
              properties: { query: { type: "string" } }
            }
          }
        }
      },
      responses: { "200": successResponse }
    }
  };
  paths["/v1/compatibility/composed-query"] = {
    get: operation("compatibility", "search composed compatibility", "Use equivalent composed query schemas.", [
      {
        name: "regions",
        in: "query",
        schema: {
          oneOf: [
            { type: "array", items: { type: "string", format: "country-code-2" } },
            { type: "array", items: { type: "string", format: "negated-country-code-2" } }
          ]
        }
      }
    ])
  };
  paths["/v1/compatibility/bracketed-array"] = {
    get: operation("compatibility", "search bracketed compatibility", "Use bracketed array query serialization.", [
      { name: "expand", in: "query", style: "deepObject", explode: true, schema: { type: "array", items: { type: "string" } } }
    ])
  };
  paths["/v1/compatibility/deep-union"] = {
    get: operation("compatibility", "search union compatibility", "Use a deep-object query union.", [
      {
        name: "created",
        in: "query",
        style: "deepObject",
        explode: true,
        schema: { anyOf: [{ type: "object", properties: { gt: { type: "integer" } } }, { type: "integer" }] }
      }
    ])
  };
  paths["/v1/maps/{id}/attachments"] = {
    post: {
      tags: ["attachments"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "201": successResponse }
    }
  };
  paths["/v1/spots/{id}/attachments"] = {
    post: {
      tags: ["attachments"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: { "201": successResponse }
    }
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "Forgeyard API",
      version: "1.0.0"
    },
    paths
  };
}

function operation(
  tag: string,
  operationId: string,
  summary: string,
  parameters: OpenApiParameter[],
  requestBody = false
): OpenApiOperationObject {
  return {
    tags: [tag],
    operationId,
    summary,
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(requestBody
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: bodySchema }
            }
          }
        }
      : {}),
    responses: { "200": successResponse }
  };
}

function singularize(resource: string): string {
  if (resource.endsWith("ies")) {
    return `${resource.slice(0, -3)}y`;
  }
  if (resource.endsWith("ses")) {
    return resource.slice(0, -2);
  }
  return resource.endsWith("s") ? resource.slice(0, -1) : resource;
}
