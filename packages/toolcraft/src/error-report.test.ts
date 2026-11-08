import { readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const { renderErrorReport, writeErrorReport } = await import("./error-report.js");

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

describe("error reports", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("renders declared-secret redaction assertions without writing a report file", async () => {
    const assertionCommand = defineCommand({
      name: "verify",
      params: S.Object({}),
      secrets: {
        primaryToken: { env: "PRIMARY_TOKEN" },
        backupToken: { env: "BACKUP_TOKEN" }
      },
      handler: async () => null
    });
    const primaryToken = "primary-secret-value";
    const backupToken = "backup-secret-value";

    const result = renderErrorReport({
      command: assertionCommand,
      commandPath: "verify",
      env: {
        PRIMARY_TOKEN: primaryToken,
        BACKUP_TOKEN: backupToken
      },
      error: new Error(`failed with ${primaryToken} and ${backupToken}`),
      version: "1.2.3"
    });

    expect(result.redactedKeys).toEqual(["PRIMARY_TOKEN", "BACKUP_TOKEN"]);
    expect(result.content).toContain("PRIMARY_TOKEN=<set, 20 chars>");
    expect(result.content).toContain("BACKUP_TOKEN=<set, 19 chars>");
    expect(result.content).not.toContain(primaryToken);
    expect(result.content).not.toContain(backupToken);
    await expect(readOnlyReportFile("/repo")).resolves.toBeUndefined();
  });

  it("writes all report sections for an HttpError-like failure when enabled", async () => {
    const reportContext = {
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
      secrets: {
        poeApiKey: "12345678901234567890123456789012"
      },
      version: "1.2.3"
    };
    const rendered = renderErrorReport(reportContext);
    const result = await writeErrorReport({
      ...reportContext,
      errorReports: true,
      projectRoot: "/repo"
    });

    expect(result?.displayPath).toContain(".toolcraft/errors/");
    expect(result?.displayPath).toMatch(/widgets-create-[0-9a-f-]+\.log$/);
    const report = await readOnlyReportFile("/repo");

    expect(report).toBe(rendered.content);
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
    expect(report).toContain("authorization: Bearer ****");
    expect(report).not.toContain("Bearer redacted");
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

  it("redacts declared secrets and sensitive params from error messages and stack chains", async () => {
    const declaredSecret = "declared-secret-value";
    const apiKey = "param-api-key-value";
    const refreshToken = "param-refresh-token-value";
    const cause = new Error(`cause failed for ${refreshToken}`);
    cause.stack = `Error: cause failed for ${refreshToken}\n    at refresh (${declaredSecret})`;
    const error = new Error(`handler failed for ${declaredSecret}`, { cause });
    error.stack = `Error: handler failed for ${declaredSecret}\n    at handler (${apiKey})`;

    await writeErrorReport({
      command,
      commandPath: "widgets.create",
      env: {
        POE_API_KEY: declaredSecret
      },
      error,
      errorReports: true,
      params: {
        name: "demo",
        apiKey,
        refreshToken,
        secretLabel: "visible-label"
      },
      projectRoot: "/repo",
      secrets: {
        poeApiKey: declaredSecret
      }
    });

    const report = await readOnlyReportFile("/repo");
    expect(report).toContain("message: handler failed for <redacted>");
    expect(report).toContain("Error: handler failed for <redacted>");
    expect(report).toContain("at handler (<redacted>)");
    expect(report).toContain("Caused by: Error: cause failed for <redacted>");
    expect(report).toContain("at refresh (<redacted>)");
    expect(report).not.toContain(declaredSecret);
    expect(report).not.toContain(apiKey);
    expect(report).not.toContain(refreshToken);
    expect(report).toContain("visible-label");
  });

  it("redacts secret-like HTTP request and response body fields from reports", async () => {
    const error = createHttpErrorLike();
    error.request.body = {
      name: "demo",
      client_secret: "report-client-secret",
      nested: {
        apiKey: "report-api-key"
      }
    };
    error.response.body = {
      error: "internal",
      access_token: "report-access-token",
      nested: [
        {
          refreshToken: "report-refresh-token"
        }
      ]
    };

    await writeErrorReport({
      command,
      commandPath: "widgets.create",
      error,
      errorReports: true,
      projectRoot: "/repo"
    });

    const report = await readOnlyReportFile("/repo");
    expect(report).toContain('"name": "demo"');
    expect(report).toContain('"client_secret": "<redacted>"');
    expect(report).toContain('"apiKey": "<redacted>"');
    expect(report).toContain('"access_token": "<redacted>"');
    expect(report).toContain('"refreshToken": "<redacted>"');
    expect(report).not.toContain("report-client-secret");
    expect(report).not.toContain("report-api-key");
    expect(report).not.toContain("report-access-token");
    expect(report).not.toContain("report-refresh-token");
  });

  it("preserves enumerable __proto__ structured error fields", async () => {
    const error = new Error("boom");
    Object.defineProperty(error, "__proto__", {
      value: { requestId: "visible" },
      enumerable: true,
      configurable: true,
      writable: true
    });

    await writeErrorReport({
      command,
      commandPath: "widgets.create",
      error,
      errorReports: true,
      projectRoot: "/repo"
    });

    const report = await readOnlyReportFile("/repo");
    expect(report).toContain('"__proto__": {');
    expect(report).toContain('"requestId": "visible"');
  });

  it("retains separate reports for failures in the same minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:34:56.789Z"));

    const first = await writeErrorReport({
      commandPath: "widgets.create",
      error: new Error("first failure"),
      errorReports: true,
      projectRoot: "/repo"
    });
    const second = await writeErrorReport({
      commandPath: "widgets.create",
      error: new Error("second failure"),
      errorReports: true,
      projectRoot: "/repo"
    });

    expect(first?.absolutePath).not.toBe(second?.absolutePath);
    const reports = Object.values(vol.toJSON("/repo/.toolcraft/errors"));
    expect(reports).toHaveLength(2);
    expect(reports).toEqual(
      expect.arrayContaining([
        expect.stringContaining("first failure"),
        expect.stringContaining("second failure")
      ])
    );
  });

  it("rejects a symlinked default report directory outside the project", async () => {
    vol.fromJSON({
      "/repo/.toolcraft/.keep": "",
      "/outside/.keep": ""
    });
    await symlink("/outside", "/repo/.toolcraft/errors");

    await expect(
      writeErrorReport({
        commandPath: "widgets.create",
        error: new Error("failure"),
        errorReports: true,
        projectRoot: "/repo"
      })
    ).rejects.toThrow("Error report directory resolves outside project root.");

    expect(Object.keys(vol.toJSON("/outside"))).toEqual(["/outside/.keep"]);
  });
});
