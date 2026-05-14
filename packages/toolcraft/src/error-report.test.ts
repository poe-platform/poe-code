import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import { S } from "toolcraft-schema";
import { defineCommand, UserError } from "./index.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { writeErrorReport } = await import("./error-report.js");

const originalErrorReportsEnv = process.env.TOOLCRAFT_ERROR_REPORTS;

function createHttpErrorLike(): Error & {
  name: "HttpError";
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
} {
  const error = new Error(
    "POST https://api.example.com/widgets -> 500 Internal Server Error"
  ) as Error & {
    name: "HttpError";
    request: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body?: unknown;
    };
    response: {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: unknown;
    };
  };

  error.name = "HttpError";
  error.request = {
    method: "POST",
    url: "https://api.example.com/widgets",
    headers: {
      authorization: "Bearer redacted"
    },
    body: {
      name: "demo"
    }
  };
  error.response = {
    status: 500,
    statusText: "Internal Server Error",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req_123"
    },
    body: {
      error: "internal"
    }
  };
  error.stack = "HttpError: request failed\n    at handler";
  return error;
}

const command = defineCommand({
  name: "create",
  params: S.Object({
    name: S.String(),
    apiKey: S.String({ secret: true }),
    refreshToken: S.String(),
    secretLabel: S.String({ secret: false })
  }),
  secrets: {
    poeApiKey: {
      env: "POE_API_KEY"
    }
  },
  handler: async () => ({ ok: true })
});

async function readOnlyReportFile(projectRoot: string): Promise<string | undefined> {
  const files = vol.toJSON(projectRoot);
  const reportPath = Object.keys(files).find((filePath) =>
    filePath.startsWith(path.join(projectRoot, ".toolcraft", "errors"))
  );

  if (reportPath === undefined) {
    return undefined;
  }

  return readFile(reportPath, "utf8");
}

describe("writeErrorReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset();
    vol.fromJSON({
      "/repo/package.json": JSON.stringify({ name: "fixture" })
    });
    if (originalErrorReportsEnv === undefined) {
      delete process.env.TOOLCRAFT_ERROR_REPORTS;
    } else {
      process.env.TOOLCRAFT_ERROR_REPORTS = originalErrorReportsEnv;
    }
  });

  it("writes all report sections for an HttpError-like failure when enabled", async () => {
    const result = await writeErrorReport({
      argv: ["node", "toolcraft", "widgets", "create", "--api-key", "super-secret-key"],
      command,
      commandPath: "widgets.create",
      env: {
        POE_API_KEY: "12345678901234567890123456789012"
      },
      error: createHttpErrorLike(),
      errorReports: true,
      params: {
        name: "demo",
        apiKey: "super-secret-key",
        refreshToken: "default-redacted-token",
        secretLabel: "public-secret-name"
      },
      projectRoot: "/repo",
      secrets: {
        poeApiKey: "12345678901234567890123456789012"
      },
      version: "1.2.3"
    });

    expect(result?.displayPath).toContain(".toolcraft/errors/");
    expect(result?.displayPath).toContain("widgets-create.log");
    const report = await readOnlyReportFile("/repo");

    expect(report).toContain("toolcraft version: 1.2.3");
    expect(report).toContain("node version:");
    expect(report).toContain("platform:");
    expect(report).toContain('"widgets"');
    expect(report).toContain("POE_API_KEY=<set, 32 chars>");
    expect(report).not.toContain("12345678901234567890123456789012");
    expect(report).toContain("Command Path\nwidgets.create");
    expect(report).toContain('"name": "demo"');
    expect(report).toContain('"apiKey": "<redacted>"');
    expect(report).not.toContain("super-secret-key");
    expect(report).toContain('"refreshToken": "<redacted>"');
    expect(report).not.toContain("default-redacted-token");
    expect(report).toContain('"secretLabel": "public-secret-name"');
    expect(report).toContain("name: HttpError");
    expect(report).toContain("structured fields:");
    expect(report).toContain("Stack\nHttpError: request failed");
    expect(report).toContain("HTTP Transcript");
    expect(report).toContain("POST https://api.example.com/widgets");
    expect(report).toContain("500 Internal Server Error");
  });

  it("does not write routine UserError reports", async () => {
    await writeErrorReport({
      command,
      commandPath: "widgets.create",
      error: new UserError("Missing required parameter."),
      errorReports: true,
      projectRoot: "/repo"
    });

    await expect(readOnlyReportFile("/repo")).resolves.toBeUndefined();
  });

  it("does not write reports by default", async () => {
    await writeErrorReport({
      command,
      commandPath: "widgets.create",
      error: createHttpErrorLike(),
      projectRoot: "/repo"
    });

    await expect(readOnlyReportFile("/repo")).resolves.toBeUndefined();
  });

  it("writes reports when TOOLCRAFT_ERROR_REPORTS is set", async () => {
    process.env.TOOLCRAFT_ERROR_REPORTS = "1";

    await writeErrorReport({
      command,
      commandPath: "widgets.create",
      error: createHttpErrorLike(),
      projectRoot: "/repo"
    });

    await expect(readOnlyReportFile("/repo")).resolves.toContain("HTTP Transcript");
  });

  it("redacts secret params from the report file", async () => {
    await writeErrorReport({
      command,
      commandPath: "widgets.create",
      error: createHttpErrorLike(),
      errorReports: true,
      params: {
        name: "demo",
        apiKey: "do-not-print",
        refreshToken: "also-do-not-print",
        secretLabel: "visible-label"
      },
      projectRoot: "/repo"
    });

    const report = await readOnlyReportFile("/repo");
    expect(report).not.toContain("do-not-print");
    expect(report).not.toContain("also-do-not-print");
    expect(report).toContain('"apiKey": "<redacted>"');
    expect(report).toContain('"refreshToken": "<redacted>"');
    expect(report).toContain("visible-label");
  });
});
