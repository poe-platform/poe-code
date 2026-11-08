#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApprovalDeclinedError,
  S,
  ToolcraftBugError,
  UserError,
  defineCommand,
  defineGroup
} from "../dist/index.js";
import { runCLI } from "../dist/cli.js";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const badPresetPath = join(fixtureDir, "bad-preset.json");
const badFixturePath = join(fixtureDir, "bin.fixture.json");

class HttpError extends Error {
  constructor({ method = "GET", url, status, statusText, requestBody, responseBody, responseHeaders }) {
    super(`${method} ${url} -> ${status} ${statusText}`);
    this.name = "HttpError";
    this.request = {
      method,
      url,
      headers: {
        authorization: "Bearer qa-secret-token",
        "x-client": "toolcraft-error-ux-fixture"
      },
      body: requestBody
    };
    this.response = {
      status,
      statusText,
      headers: {
        "content-type": "application/json",
        "x-request-id": "qa-request-123",
        ...responseHeaders
      },
      body: responseBody
    };
    this.stack = `HttpError: ${this.message}
    at fixtureHandler (${fileURLToPath(import.meta.url)}:42:7)
    at runFixtureCommand (${fileURLToPath(import.meta.url)}:43:7)
    at node:internal/process/task_queues:95:5`;
  }
}

function httpError(overrides) {
  return new HttpError({
    url: "https://api.example.test/v1/widgets/42",
    status: 500,
    statusText: "Internal Server Error",
    requestBody: {
      name: "qa-widget"
    },
    responseBody: {
      error: "internal_panic",
      trace_id: "qa-trace-500",
      message: "The upstream service failed while rendering a widget."
    },
    ...overrides
  });
}

function networkError(code, message) {
  const error = new Error(`${code} ${message} for https://api.example.test/v1/widgets`);
  error.code = code;
  error.url = "https://api.example.test/v1/widgets";
  return error;
}

async function prepareLocalQaInputs() {
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(badPresetPath, "{\n,", "utf8");

  if (process.argv.includes("bad-fixture-json")) {
    await writeFile(badFixturePath, "{\n,", "utf8");
  }
}

const success = defineCommand({
  name: "success",
  description: "Print a successful marker.",
  params: S.Object({}),
  handler: async () => "ok"
});

const throwUserError = defineCommand({
  name: "throw-user-error",
  description: "Throw a user-facing error.",
  params: S.Object({}),
  handler: async () => {
    throw new UserError("Invalid workspace selection.");
  }
});

const throwBug = defineCommand({
  name: "throw-bug",
  description: "Throw an internal Toolcraft bug error.",
  params: S.Object({}),
  handler: async () => {
    throw new ToolcraftBugError("command registry invariant failed.");
  }
});

const throwHttp500 = defineCommand({
  name: "throw-http-500",
  description: "Throw an HTTP 500 error with a JSON body.",
  params: S.Object({}),
  handler: async () => {
    throw httpError({});
  }
});

const throwHttp401 = defineCommand({
  name: "throw-http-401",
  description: "Throw an HTTP 401 error with a JSON body.",
  params: S.Object({}),
  handler: async () => {
    throw httpError({
      status: 401,
      statusText: "Unauthorized",
      responseBody: {
        error: "unauthorized",
        message: "The supplied API token is not valid."
      }
    });
  }
});

const throwHttpTextHtml404 = defineCommand({
  name: "throw-http-text-html-404",
  description: "Throw an HTTP 404 error with an HTML body.",
  params: S.Object({}),
  handler: async () => {
    throw httpError({
      url: "https://api.example.test/openapi.json",
      status: 404,
      statusText: "Not Found",
      responseHeaders: {
        "content-type": "text/html"
      },
      responseBody:
        "<!doctype html><html><body><h1>Not Found</h1><p>No OpenAPI document exists here.</p></body></html>"
    });
  }
});

const throwHttpProblemDetails = defineCommand({
  name: "throw-http-problem-details",
  description: "Throw an HTTP error with an RFC 7807 problem details body.",
  params: S.Object({}),
  handler: async () => {
    throw httpError({
      status: 400,
      statusText: "Bad Request",
      responseBody: {
        type: "https://api.example.test/problems/invalid-widget",
        title: "Invalid widget request",
        status: 400,
        detail: "name must be at least 3 characters",
        instance: "/v1/widgets/42"
      }
    });
  }
});

const throwHttpGraphql = defineCommand({
  name: "throw-http-graphql",
  description: "Throw an HTTP error with a GraphQL errors body.",
  params: S.Object({}),
  handler: async () => {
    throw httpError({
      status: 200,
      statusText: "OK",
      responseBody: {
        errors: [
          {
            message: "Unauthorized",
            path: ["viewer"],
            extensions: {
              code: "UNAUTHENTICATED"
            }
          },
          {
            message: "Widget missing",
            path: ["widget", 42],
            extensions: {
              code: "NOT_FOUND"
            }
          }
        ]
      }
    });
  }
});

const throwEconnrefused = defineCommand({
  name: "throw-econnrefused",
  description: "Throw a simulated connection refused network error.",
  params: S.Object({}),
  handler: async () => {
    throw networkError("ECONNREFUSED", "connect refused");
  }
});

const throwEtimedout = defineCommand({
  name: "throw-etimedout",
  description: "Throw a simulated timeout network error.",
  params: S.Object({}),
  handler: async () => {
    throw networkError("ETIMEDOUT", "request timed out");
  }
});

const throwEnotfound = defineCommand({
  name: "throw-enotfound",
  description: "Throw a simulated DNS failure.",
  params: S.Object({}),
  handler: async () => {
    throw networkError("ENOTFOUND", "getaddrinfo failed");
  }
});

const throwApprovalDeclined = defineCommand({
  name: "throw-approval-declined",
  description: "Throw an approval declined error.",
  params: S.Object({}),
  handler: async () => {
    throw new ApprovalDeclinedError({
      commandPath: "throw-approval-declined",
      reason: "The approver declined the QA fixture run."
    });
  }
});

const badPreset = defineCommand({
  name: "bad-preset",
  description: "Consume an invalid JSON preset.",
  params: S.Object({
    service: S.String({
      description: "Service name"
    })
  }),
  handler: async ({ params }) => params
});

const badFixtureJson = defineCommand({
  name: "bad-fixture-json",
  description: "Consume a corrupt toolcraft fixture file.",
  params: S.Object({}),
  handler: async () => "fixture should fail before handler"
});

const validateMulti = defineCommand({
  name: "validate-multi",
  description: "Fail several validation checks in one invocation.",
  params: S.Object({
    slug: S.String({
      pattern: "^[a-z]+$",
      description: "Lowercase slug"
    }),
    ownerEmail: S.String({
      pattern: "^[^@]+@[^@]+$",
      description: "Owner email"
    }),
    mode: S.Enum(["safe", "fast"], {
      description: "Execution mode"
    })
  }),
  handler: async ({ params }) => params
});

const missingSecret = defineCommand({
  name: "missing-secret",
  description: "Require a secret that should be absent.",
  params: S.Object({}),
  secrets: {
    poeApiKey: {
      env: "POE_API_KEY",
      description: "Set POE_API_KEY before calling this command."
    }
  },
  handler: async () => "secret should fail before handler"
});

const missingSecretNearMiss = defineCommand({
  name: "missing-secret-near-miss",
  description: "Require a secret with a close miss in the environment.",
  params: S.Object({}),
  secrets: {
    poeApiKey: {
      env: "POE_API_KEY",
      description: "Set POE_API_KEY before calling this command."
    }
  },
  handler: async () => "secret should fail before handler"
});

const unionZeroMatch = defineCommand({
  name: "union-zero-match",
  description: "Trigger a union branch selection failure.",
  params: S.Object({
    contact: S.Union([
      S.Object({
        email: S.String()
      }),
      S.Object({
        phone: S.String()
      })
    ])
  }),
  handler: async ({ params }) => params
});

const longRunning = defineCommand({
  name: "long-running",
  description: "Emit progress, then throw an error.",
  params: S.Object({}),
  handler: async ({ progress }) => {
    progress("starting long-running fixture");
    await new Promise((resolve) => setTimeout(resolve, 150));
    progress("halfway through long-running fixture");
    await new Promise((resolve) => setTimeout(resolve, 150));
    throw new UserError("Long-running fixture failed after progress.");
  }
});

const createWidget = defineCommand({
  name: "create",
  description: "Create a widget.",
  params: S.Object({
    name: S.String({
      description: "Widget name"
    }),
    tier: S.Optional(
      S.Enum(["free", "pro", "enterprise"], {
        description: "Widget tier"
      })
    )
  }),
  handler: async ({ params }) => params
});

const listWidgets = defineCommand({
  name: "list",
  description: "List widgets.",
  params: S.Object({
    status: S.Optional(
      S.Enum(["active", "inactive"], {
        description: "Widget status"
      })
    )
  }),
  handler: async ({ params }) => params
});

const deactivateWidget = defineCommand({
  name: "deactivate",
  description: "Deactivate a widget.",
  params: S.Object({
    name: S.String({
      description: "Widget name"
    })
  }),
  handler: async ({ params }) => params
});

const widgets = defineGroup({
  name: "widgets",
  description: "Widget commands",
  children: [createWidget, listWidgets, deactivateWidget]
});

const root = defineGroup({
  name: "toolcraft-error-ux",
  description: "Error UX QA fixture",
  children: [
    success,
    throwUserError,
    throwBug,
    throwHttp500,
    throwHttp401,
    throwHttpTextHtml404,
    throwHttpProblemDetails,
    throwHttpGraphql,
    throwEconnrefused,
    throwEtimedout,
    throwEnotfound,
    throwApprovalDeclined,
    badPreset,
    badFixtureJson,
    validateMulti,
    missingSecret,
    missingSecretNearMiss,
    unionZeroMatch,
    longRunning,
    widgets
  ]
});

await prepareLocalQaInputs();
await runCLI(root, {
  presets: true,
  rootDisplayName: "toolcraft-error-ux",
  rootUsageName: "node QA-error-ux-fixture/bin.js",
  version: "0.1.0",
  errorReports: true,
  projectRoot: fixtureDir
});
