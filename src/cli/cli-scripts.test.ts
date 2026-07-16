import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { ErrorLogger } from "./error-logger.js";
import { createCliContainer } from "./container.js";
import type { FileSystem } from "../utils/file-system.js";
import { createHomeFs } from "../../tests/test-helpers.js";
import { ensureIsolatedConfigForService } from "./commands/ensure-isolated-config.js";
import { resolveIsolatedTargetDirectory } from "./isolated-env.js";
import { createCliEnvironment } from "./environment.js";
import type { ProviderIsolatedEnv } from "./service-registry.js";
import { createOptionResolvers } from "./options.js";
import { createPromptLibrary } from "./prompts.js";
import { createPromptRunner } from "./prompt-runner.js";
import { OperationCancelledError, ValidationError } from "./errors.js";
import { createServiceRegistry, type ProviderService } from "./service-registry.js";
import { createProviderStub } from "../../tests/provider-stub.js";

// ---------------------------------------------------------------------------
// build-comment-prompt-script
// ---------------------------------------------------------------------------

describe("build comment prompt workflow script", () => {
  const scriptPath = "../../scripts/workflows/build-comment-prompt.cjs";

  type MockResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    headers: { get: (name: string) => string | null };
    json: () => Promise<unknown>;
  };

  function createResponse(options: {
    status: number;
    body: unknown;
    link?: string | null;
  }): MockResponse {
    return {
      ok: options.status >= 200 && options.status < 300,
      status: options.status,
      statusText: options.status === 200 ? "OK" : "",
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === "link") {
            return options.link ?? null;
          }
          return null;
        }
      },
      json: async () => options.body
    };
  }

  let fetchMock: ReturnType<typeof vi.fn>;
  let output: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    output = [];
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: unknown) => {
        output.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);

    process.env.ISSUE_NUMBER = "42";
    process.env.COMMENT_BODY = "Please fix auth.spec.ts flake";
    process.env.COMMENT_AUTHOR = "bob";
    process.env.GITHUB_REPOSITORY = "poe-platform/poe-code";
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stdoutSpy.mockRestore();
    delete process.env.ISSUE_NUMBER;
    delete process.env.COMMENT_BODY;
    delete process.env.COMMENT_AUTHOR;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;
    vi.resetModules();
  });

  it("builds prompt with conversation and highlighted latest instruction", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        body: {
          title: "Fix auth bug",
          body: "The login flow breaks.",
          user: { login: "alice" },
          created_at: "2026-02-27T10:00:00Z"
        }
      }) satisfies MockResponse
    );
    fetchMock.mockResolvedValueOnce(
      createResponse({
        status: 200,
        body: [
          {
            body: "I can reproduce this.",
            user: { login: "bob" },
            created_at: "2026-02-27T11:00:00Z"
          }
        ]
      }) satisfies MockResponse
    );

    await import(scriptPath);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const prompt = output.join("");
      expect(prompt).toContain("You are working on GitHub issue #42: Fix auth bug.");
      expect(prompt).toContain("Conversation:");
      expect(prompt).toContain("@alice (2026-02-27T10:00:00.000Z):");
      expect(prompt).toContain("The login flow breaks.");
      expect(prompt).toContain("@bob (2026-02-27T11:00:00.000Z):");
      expect(prompt).toContain("I can reproduce this.");
      expect(prompt).toContain("Latest instruction (from @bob):");
      expect(prompt).toContain("Please fix auth.spec.ts flake");
      expect(prompt).toContain("Act on the latest instruction above.");
    });
  });
});

// ---------------------------------------------------------------------------
// build-issue-prompt-script
// ---------------------------------------------------------------------------

describe("build issue prompt workflow script", () => {
  const scriptUrl = new URL(
    "../../scripts/workflows/build-issue-prompt.cjs",
    import.meta.url
  ).href;

  it("adds explicit model-discovery guidance for renamed models", async () => {
    const { buildPrompt } = await import(scriptUrl);

    const prompt = buildPrompt({
      issueNumber: 123,
      issue: {
        title: "Renamed model: old-name -> new-name",
        body: "## Event\n\n- type: renamed\n",
        user: { login: "poe-bot" },
        created_at: "2026-03-18T10:00:00.000Z"
      },
      comments: []
    });

    expect(prompt).toContain(
      "This is a model discovery issue triggered by a Poe model changelog event."
    );
    expect(prompt).toContain(
      "The Poe model `old-name` was renamed to `new-name`."
    );
    expect(prompt).toContain(
      "Determine whether any model mentions in this repository need updating because of this rename, and make the update if needed."
    );
    expect(prompt).toContain(
      "If updates are needed, implement the minimal required changes and commit them."
    );
  });

  it("falls back to the generic issue prompt for non-model issues", async () => {
    const { buildPrompt } = await import(scriptUrl);

    const prompt = buildPrompt({
      issueNumber: 456,
      issue: {
        title: "Fix flaky test",
        body: "Investigate the intermittent failure.",
        user: { login: "poe-bot" },
        created_at: "2026-03-18T11:00:00.000Z"
      },
      comments: []
    });

    expect(prompt).not.toContain(
      "This is a model discovery issue triggered by a Poe model changelog event."
    );
    expect(prompt).toContain("Implement the required changes and commit them.");
  });

  it("tells the agent to make the update for added models when warranted", async () => {
    const { buildPrompt } = await import(scriptUrl);

    const prompt = buildPrompt({
      issueNumber: 789,
      issue: {
        title: "New model: gpt-5.3-codex",
        body: "## Event\n\n- type: added\n",
        user: { login: "poe-bot" },
        created_at: "2026-03-18T12:00:00.000Z"
      },
      comments: []
    });

    expect(prompt).toContain(
      "Determine whether any existing model mentions in this repository need updating because of this addition, and make the update if needed."
    );
  });
});

// ---------------------------------------------------------------------------
// check-eligible-user-script
// ---------------------------------------------------------------------------

describe("check eligible user workflow script", () => {
  const scriptPath = "../../scripts/workflows/check-eligible-user.cjs";

  type MockResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    headers: { get: (name: string) => string | null };
    json: () => Promise<unknown>;
  };

  function createResponse(options: {
    ok: boolean;
    status: number;
    statusText?: string;
    body?: unknown;
  }): MockResponse {
    return {
      ok: options.ok,
      status: options.status,
      statusText: options.statusText ?? "",
      headers: {
        get: () => null
      },
      json: async () => options.body ?? {}
    };
  }

  let originalAppend: typeof fs.appendFileSync;
  let writes: string[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    writes = [];
    originalAppend = fs.appendFileSync;
    fs.appendFileSync = ((_, content: string | NodeJS.ArrayBufferView) => {
      const text =
        typeof content === "string"
          ? content
          : Buffer.isBuffer(content)
            ? content.toString("utf8")
            : String(content);
      writes.push(text);
    }) as typeof fs.appendFileSync;

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    process.env.USERNAME = "eligible-user";
    process.env.GITHUB_REPOSITORY = "poe-platform/poe-code";
    process.env.GITHUB_TOKEN = "test-token";
    process.env.GITHUB_OUTPUT = "/tmp/output";
  });

  afterEach(() => {
    fs.appendFileSync = originalAppend;
    vi.unstubAllGlobals();
    delete process.env.USERNAME;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_OUTPUT;
    vi.resetModules();
  });

  it("writes allowed=true for org member with write permission", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: true, status: 204 }) satisfies MockResponse
    );
    fetchMock.mockResolvedValueOnce(
      createResponse({
        ok: true,
        status: 200,
        body: { permission: "write" }
      }) satisfies MockResponse
    );

    await import(scriptPath);

    await vi.waitFor(() => {
      expect(writes.join("")).toContain("allowed=true");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/orgs/poe-platform/members/eligible-user",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/poe-platform/poe-code/collaborators/eligible-user/permission",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
  });

  it("writes allowed=false when user is not an org member", async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: false, status: 404, statusText: "Not Found" }) satisfies MockResponse
    );

    await import(scriptPath);

    await vi.waitFor(() => {
      expect(writes.join("")).toContain("allowed=false");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to append eligibility output through a symbolic link", async () => {
    const volume = Volume.fromJSON({ "/outside-output": "sentinel" }, "/");
    volume.mkdirSync("/github", { recursive: true });
    volume.symlinkSync("/outside-output", "/github/output");
    const memoryFs = createFsFromVolume(volume);
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: false, status: 404, statusText: "Not Found" }) satisfies MockResponse
    );
    const { appendWorkflowOutput } = await import(scriptPath);

    expect(() => appendWorkflowOutput("/github/output", "allowed=true\n", memoryFs)).toThrow(
      "symbolic link"
    );
    expect(memoryFs.readFileSync("/outside-output", "utf8")).toBe("sentinel");
  });
});

// ---------------------------------------------------------------------------
// discover-models-script
// ---------------------------------------------------------------------------

describe("discover models workflow script", () => {
  const scriptUrl = new URL(
    "../../scripts/workflows/discover-models.mjs",
    import.meta.url
  ).href;

  type MockResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    headers: { get: (name: string) => string | null };
    json: () => Promise<unknown>;
  };

  function createResponse(options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}): MockResponse {
    const lowerHeaders = new Map<string, string>();
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      lowerHeaders.set(key.toLowerCase(), value);
    }
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      statusText: options.statusText ?? "",
      headers: {
        get: (name: string) => lowerHeaders.get(name.toLowerCase()) ?? null
      },
      json: async () => options.body ?? {}
    };
  }

  function createDiscoveryFetch(overrides: {
    changelogFeed?: unknown;
    renameFeed?: unknown;
    graphQlBody?: unknown;
  } = {}) {
    return vi.fn(async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      if (url === "https://models.poecdn.net/changelog.json") {
        return createResponse({ body: overrides.changelogFeed ?? [] });
      }
      if (url === "https://models.poecdn.net/test_changelog.json") {
        return createResponse({ body: overrides.renameFeed ?? [] });
      }
      if (
        method === "GET" &&
        url.startsWith("https://api.github.com/repos/poe-platform/poe-code/issues?")
      ) {
        return createResponse({ body: [] });
      }
      if (
        method === "POST" &&
        url === "https://api.github.com/repos/poe-platform/poe-code/labels"
      ) {
        return createResponse({
          ok: false,
          status: 422,
          statusText: "Unprocessable Entity",
          body: { message: "Validation Failed" }
        });
      }
      if (method === "POST" && url === "https://api.github.com/graphql") {
        return createResponse({
          body:
            overrides.graphQlBody ??
            {
              data: {
                organization: {
                  projectV2: {
                    id: "PVT_project"
                  }
                }
              }
            }
        });
      }
      if (
        method === "POST" &&
        url === "https://api.github.com/repos/poe-platform/poe-code/issues"
      ) {
        return createResponse({ status: 201, body: { number: 123, node_id: "I_123" } });
      }
      if (
        method === "PATCH" &&
        url === "https://api.github.com/repos/poe-platform/poe-code/issues/123"
      ) {
        return createResponse({ body: { number: 123, node_id: "I_123" } });
      }
      throw new Error(`Unhandled request in discover-models test: ${method} ${url}`);
    });
  }

  it("refuses to append model output through a symbolic link", async () => {
    const volume = Volume.fromJSON({ "/outside-output": "sentinel" }, "/");
    volume.mkdirSync("/github", { recursive: true });
    volume.symlinkSync("/outside-output", "/github/output");
    const memoryFs = createFsFromVolume(volume);
    const { writeWorkflowOutputs } = await import(scriptUrl);

    expect(() => writeWorkflowOutputs("/github/output", [42], memoryFs)).toThrow("symbolic link");
    expect(memoryFs.readFileSync("/outside-output", "utf8")).toBe("sentinel");
  });

  it("calls poe-code models in json output mode for parse-safe YAML", async () => {
    const { runDiscovery } = await import(scriptUrl);
    const now = new Date().toISOString();
    const fetchMock = createDiscoveryFetch({
      changelogFeed: [
        {
          date: now,
          added: ["gpt-5.3-codex"]
        }
      ]
    });
    const execMock = vi.fn().mockImplementation((_, args: string[]) => {
      if (args.includes("--model")) {
        return "- id: gpt-5.3-codex\n  owned_by: OpenAI\n  created: 1700000000000\n";
      }
      return "[]\n";
    });

    await runDiscovery({
      env: {
        GITHUB_REPOSITORY: "poe-platform/poe-code",
        GITHUB_TOKEN: "token"
      },
      fetch: fetchMock as typeof fetch,
      execFileSync: execMock,
      readdirSync: () => [],
      readFileSync: () => "",
      statSync: () => ({
        isFile: () => true
      }),
      log: () => {},
      warn: () => {}
    });

    expect(execMock).toHaveBeenCalledTimes(2);
    expect(execMock).toHaveBeenNthCalledWith(
      1,
      "poe-code",
      ["models", "--view", "raw"],
      expect.objectContaining({
        encoding: "utf8",
        env: expect.objectContaining({
          OUTPUT_FORMAT: "json"
        })
      })
    );
    expect(execMock).toHaveBeenNthCalledWith(
      2,
      "poe-code",
      ["models", "--model", "gpt-5.3-codex", "--view", "raw"],
      expect.objectContaining({
        encoding: "utf8",
        env: expect.objectContaining({
          OUTPUT_FORMAT: "json"
        })
      })
    );
  });

  it("silently skips project assignment when projectV2 is missing", async () => {
    const { runDiscovery } = await import(scriptUrl);
    const fetchMock = createDiscoveryFetch({
      graphQlBody: {
        errors: [
          {
            type: "NOT_FOUND",
            path: ["organization", "projectV2"],
            message: "Could not resolve to a ProjectV2 with the number 3."
          }
        ]
      }
    });
    const execMock = vi.fn().mockReturnValue("[]\n");
    const warn = vi.fn();

    await runDiscovery({
      env: {
        GITHUB_REPOSITORY: "poe-platform/poe-code",
        GITHUB_TOKEN: "token",
        PROJECT_OWNER: "poe-platform",
        PROJECT_NUMBER: "3"
      },
      fetch: fetchMock as typeof fetch,
      execFileSync: execMock,
      readdirSync: () => [],
      readFileSync: () => "",
      statSync: () => ({
        isFile: () => true
      }),
      log: () => {},
      warn
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("collects normalized model events from this week only", async () => {
    const { collectEvents } = await import(scriptUrl);
    const events = collectEvents(
      [
        {
          date: "2026-02-20T23:59:00+00:00",
          added: ["Old-Model"],
          removed: ["Old-Removed"]
        },
        {
          date: "2026-02-23T00:00:00+00:00",
          added: ["GPT-5.2-Codex", "gpt-5.2-codex", "Claude-Opus-4.7"],
          removed: ["Legacy-Model"]
        },
        {
          date: "2026-02-27T10:00:00+00:00",
          added: ["New-One"],
          removed: ["legacy-model"]
        }
      ],
      [
        {
          date: "2026-02-21T10:00:00+00:00",
          renamed: [{ from: "Old-Rename", to: "New-Rename" }]
        },
        {
          date: "2026-02-27T11:00:00+00:00",
          renamed: [
            { from: "Old-Name", to: "New-Name" },
            { from: "old-name", to: "new-name" }
          ]
        }
      ],
      { referenceDate: new Date("2026-02-27T12:00:00+00:00") }
    );

    expect(events.added).toEqual(["gpt-5.2-codex", "claude-opus-4.7", "new-one"]);
    expect(events.removed).toEqual(["legacy-model"]);
    expect(events.renamed).toEqual([{ from: "old-name", to: "new-name" }]);
  });

  it("parses known tracking issue titles into event keys", async () => {
    const { parseIssueKeyFromTitle } = await import(scriptUrl);

    expect(parseIssueKeyFromTitle("New model: GPT-5.2-Codex")).toBe(
      "added::gpt-5.2-codex"
    );
    expect(parseIssueKeyFromTitle("Removed model: legacy-model")).toBe(
      "removed::legacy-model"
    );
    expect(parseIssueKeyFromTitle("Renamed model: old-name -> new-name")).toBe(
      "renamed::old-name->new-name"
    );
    expect(parseIssueKeyFromTitle("Something else")).toBeNull();
  });

  it("builds issue labels with the model label for all created issues", async () => {
    const { buildIssueLabels } = await import(scriptUrl);

    expect(buildIssueLabels("new-model", true)).toEqual([
      "new-model",
      "model",
      "agent:claude-code"
    ]);
    expect(buildIssueLabels("renamed-model", false)).toEqual([
      "renamed-model",
      "model"
    ]);
  });

  it("renders resolver context that asks whether model mentions need updating", async () => {
    const { renderIssueBody } = await import(scriptUrl);

    const addedBody = renderIssueBody({
      eventType: "added",
      modelId: "gpt-5.3-codex",
      metadata: {
        id: "gpt-5.3-codex",
        owned_by: "openai",
        created: 1700000000000
      },
      triage: {
        exactMentions: [],
        predecessorMentions: ["src/providers/openai.ts:12 (gpt-5.2-codex)"]
      },
      needsChanges: true
    });
    expect(addedBody).toContain("## Resolver Context");
    expect(addedBody).toContain(
      "A new Poe model was added: `gpt-5.3-codex`."
    );
    expect(addedBody).toContain(
      "Does any existing model mention need updating because of this addition?"
    );
    expect(addedBody).toContain(
      "If yes, make the update."
    );

    const removedBody = renderIssueBody({
      eventType: "removed",
      modelId: "legacy-model",
      metadata: null,
      triage: {
        exactMentions: ["src/providers/legacy.ts:3 (legacy-model)"],
        predecessorMentions: []
      },
      needsChanges: true
    });
    expect(removedBody).toContain(
      "A Poe model was removed: `legacy-model`."
    );
    expect(removedBody).toContain(
      "Does any mention of this removed model need to be removed or replaced?"
    );
    expect(removedBody).toContain(
      "If yes, make the update."
    );

    const renamedBody = renderIssueBody({
      eventType: "renamed",
      modelId: "new-name",
      previousModelId: "old-name",
      metadata: {
        id: "new-name",
        owned_by: "openai",
        created: 1700000000001
      },
      triage: {
        exactMentions: ["src/providers/openai.ts:7 (old-name)"],
        predecessorMentions: []
      },
      needsChanges: true
    });
    expect(renamedBody).toContain("The Poe model `old-name` was renamed to `new-name`.");
    expect(renamedBody).toContain(
      "Does any model mention need updating from `old-name` to `new-name`?"
    );
    expect(renamedBody).toContain(
      "If yes, make the update."
    );
  });

  it("decides actionability based on event type evidence", async () => {
    const { shouldOpenIssue } = await import(scriptUrl);

    expect(
      shouldOpenIssue("added", {
        exactMentions: [],
        predecessorMentions: []
      })
    ).toBe(false);
    expect(
      shouldOpenIssue("added", {
        exactMentions: ["src/a.ts:1"],
        predecessorMentions: []
      })
    ).toBe(false);
    expect(
      shouldOpenIssue("added", {
        exactMentions: [],
        predecessorMentions: ["src/a.ts:2"]
      })
    ).toBe(true);

    expect(
      shouldOpenIssue("removed", {
        exactMentions: [],
        predecessorMentions: ["src/b.ts:2"]
      })
    ).toBe(false);
    expect(
      shouldOpenIssue("removed", {
        exactMentions: ["src/b.ts:2"],
        predecessorMentions: []
      })
    ).toBe(true);

    expect(
      shouldOpenIssue("renamed", {
        exactMentions: [],
        predecessorMentions: ["src/c.ts:3"]
      })
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// error-logger
// ---------------------------------------------------------------------------

describe("ErrorLogger (read-only environments)", () => {
  const logDir = "/root/.poe-code/logs";
  const logFile = path.join(logDir, "errors.log");
  const now = () => new Date("2024-01-01T00:00:00.000Z");
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  function createErofsError(message: string): NodeJS.ErrnoException {
    const error = new Error(message) as NodeJS.ErrnoException;
    error.code = "EROFS";
    return error;
  }

  function createSyncFs(initialFiles: Record<string, string>): any {
    const vol = Volume.fromJSON(initialFiles);
    return createFsFromVolume(vol);
  }

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("falls back to stderr and stops writing once append fails", () => {
    const syncFs = createSyncFs({ [logFile]: "" });
    const appendSpy = vi
      .spyOn(syncFs, "appendFileSync")
      .mockImplementation(() => {
        throw createErofsError("append");
      });

    const logger = new ErrorLogger({
      fs: syncFs,
      logDir,
      logToStderr: false,
      now
    });

    logger.logError(new Error("first failure"));

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("ERROR: first failure");
    expect(consoleErrorSpy.mock.calls[0][0]).not.toContain(
      "Failed to write to error log file"
    );

    consoleErrorSpy.mockClear();
    logger.logError(new Error("second failure"));

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("second failure");
  });

  it("disables file logging entirely when initialization fails", () => {
    const syncFs = createSyncFs({});

    vi.spyOn(syncFs, "existsSync").mockImplementation((target: string) => {
      if (target === "/") {
        return true;
      }
      if (target === logDir) {
        return false;
      }
      if (target === logFile) {
        return false;
      }
      return false;
    });

    const mkdirSpy = vi.spyOn(syncFs, "mkdirSync").mockImplementation(() => {
      throw createErofsError("mkdir");
    });

    const appendSpy = vi.spyOn(syncFs, "appendFileSync");

    const logger = new ErrorLogger({
      fs: syncFs,
      logDir,
      logToStderr: false,
      now
    });

    logger.logError("run command");

    expect(mkdirSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("ERROR: run command");
  });

  it("redacts secret-like messages and context before writing logs", () => {
    const syncFs = createSyncFs({ [logFile]: "" });
    const logger = new ErrorLogger({
      fs: syncFs,
      logDir,
      logToStderr: false,
      now
    });

    logger.logError(
      new Error("request failed with Authorization: Bearer logger-bearer-token"),
      {
        responseBody: JSON.stringify({
          access_token: "logger-access-token",
          nested: {
            client_secret: "logger-client-secret"
          }
        }),
        requestBody: "api_key=logger-api-key",
        safe: "visible"
      }
    );

    const logContent = syncFs.readFileSync(logFile, "utf8");
    const contextLine = logContent
      .split("\n")
      .find((line: string) => line.startsWith("Context: "));
    const loggedContext = JSON.parse(contextLine!.slice("Context: ".length)) as {
      responseBody: string;
      requestBody: string;
      safe: string;
    };

    expect(logContent).toContain("Authorization: Bearer [redacted]");
    expect(loggedContext.responseBody).toContain('"access_token":"[redacted]"');
    expect(loggedContext.responseBody).toContain('"client_secret":"[redacted]"');
    expect(loggedContext.requestBody).toBe("api_key=[redacted]");
    expect(loggedContext.safe).toBe("visible");
    expect(logContent).not.toContain("logger-bearer-token");
    expect(logContent).not.toContain("logger-access-token");
    expect(logContent).not.toContain("logger-client-secret");
    expect(logContent).not.toContain("logger-api-key");
  });

  it("redacts bare token-shaped strings in messages, stacks, and context", () => {
    const syncFs = createSyncFs({ [logFile]: "" });
    const logger = new ErrorLogger({
      fs: syncFs,
      logDir,
      logToStderr: false,
      now
    });
    const error = new Error("provider rejected sk-live-1234567890");
    error.stack = "Error: provider rejected sk-live-1234567890\n    at sk-proj-abcdefghijklmnopqrstuvwxyz";

    logger.logError(error, {
      detail: "Gateway echoed ghp_abcdefghijklmnopqrstuvwxyz1234 in detail"
    });

    const logContent = syncFs.readFileSync(logFile, "utf8");
    expect(logContent).toContain("provider rejected [redacted]");
    expect(logContent).toContain("Gateway echoed [redacted] in detail");
    expect(logContent).not.toMatch(
      /sk-live-1234567890|sk-proj-abcdefghijklmnopqrstuvwxyz|ghp_abcdefghijklmnopqrstuvwxyz1234/u
    );
  });

  it("does not write logs through a symlinked log directory", () => {
    const syncFs = createSyncFs({ "/outside/.keep": "" });
    syncFs.mkdirSync("/root/.poe-code", { recursive: true });
    syncFs.symlinkSync("/outside", logDir);

    const logger = new ErrorLogger({
      fs: syncFs,
      logDir,
      logToStderr: false,
      now
    });

    logger.logWarning("outside write blocked");

    expect(syncFs.existsSync("/outside/errors.log")).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("outside write blocked");
  });

  it("keeps retained backups when a later rotation rename fails", () => {
    const backup1 = `${logFile}.1`;
    const backup2 = `${logFile}.2`;
    const syncFs = createSyncFs({
      [logFile]: "current log at limit",
      [backup1]: "newer history",
      [backup2]: "oldest retained history"
    });
    const renameSync = syncFs.renameSync.bind(syncFs);
    let failed = false;

    vi.spyOn(syncFs, "renameSync").mockImplementation(
      (source: string, target: string) => {
        if (!failed && target === backup2 && source !== backup1) {
          failed = true;
          throw new Error("rotation rename denied");
        }
        renameSync(source, target);
      }
    );

    const logger = new ErrorLogger({
      fs: syncFs,
      logDir,
      logToStderr: false,
      maxSize: 1,
      maxBackups: 2,
      now
    });

    logger.logWarning("new warning");

    expect(syncFs.readFileSync(backup2, "utf8")).toBe("oldest retained history");
    expect(syncFs.readFileSync(backup1, "utf8")).toBe("newer history");
    expect(syncFs.readFileSync(logFile, "utf8")).toContain("new warning");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error during log rotation:",
      expect.any(Error)
    );
  });
});

// ---------------------------------------------------------------------------
// isolated-config
// ---------------------------------------------------------------------------

describe("ensureIsolatedConfigForService", () => {
  const cwd = "/repo";
  const homeDir = "/home/test";
  let isolatedFs: FileSystem;

  beforeEach(() => {
    isolatedFs = createHomeFs(homeDir);
  });

  it("creates Codex isolated config without touching ~/.codex", async () => {
    const container = createCliContainer({
      fs: isolatedFs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    vi.spyOn(container.options, "resolveReasoning").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const adapter = container.registry.require("codex");

    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "codex",
      flags: { dryRun: false, assumeYes: true }
    });

    await expect(
      isolatedFs.stat(`${homeDir}/.poe-code/codex/config.toml`)
    ).resolves.toBeTruthy();
    await expect(
      isolatedFs.stat(`${homeDir}/.codex/config.toml`)
    ).rejects.toBeTruthy();
  });

  it("creates OpenCode isolated config without touching ~/.config/opencode", async () => {
    const container = createCliContainer({
      fs: isolatedFs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-test");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const adapter = container.registry.require("opencode");

    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "opencode",
      flags: { dryRun: false, assumeYes: true }
    });

    await expect(
      isolatedFs.stat(`${homeDir}/.poe-code/opencode/.config/opencode/config.json`)
    ).resolves.toBeTruthy();
    await expect(
      isolatedFs.stat(`${homeDir}/.config/opencode/config.json`)
    ).rejects.toBeTruthy();
  });

  it("refreshes isolated config when requested", async () => {
    const container = createCliContainer({
      fs: isolatedFs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir },
      logger: () => {},
      commandRunner: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    });

    vi.spyOn(container.options, "resolveApiKey").mockResolvedValue("sk-new");
    vi.spyOn(container.options, "resolveModel").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );
    vi.spyOn(container.options, "resolveReasoning").mockImplementation(
      async ({ defaultValue }) => defaultValue
    );

    const configPath = `${homeDir}/.poe-code/codex/config.toml`;
    await isolatedFs.mkdir(`${homeDir}/.poe-code/codex`, { recursive: true });
    const initialConfig = [
      'model_provider = "poe"',
      'model = "o1-mini"',
      'model_reasoning_effort = "low"',
      "",
      "[model_providers.poe]",
      'name = "poe"',
      'base_url = "https://old.example"',
      'wire_api = "chat"',
      'experimental_bearer_token = "sk-old"',
      ""
    ].join("\n");
    await isolatedFs.writeFile(configPath, initialConfig, { encoding: "utf8" });

    const before = await isolatedFs.readFile(configPath, "utf8");
    expect(before).toContain('experimental_bearer_token = "sk-old"');

    const adapter = container.registry.require("codex");

    await ensureIsolatedConfigForService({
      container,
      adapter,
      service: "codex",
      flags: { dryRun: false, assumeYes: true },
      refresh: true
    });

    const after = await isolatedFs.readFile(configPath, "utf8");
    expect(after).toContain('experimental_bearer_token = "sk-new"');
  });
});

// ---------------------------------------------------------------------------
// isolated-env
// ---------------------------------------------------------------------------

describe("resolveIsolatedTargetDirectory", () => {
  const mockIsolated: ProviderIsolatedEnv = {
    agentBinary: "test-agent",
    configProbe: { kind: "isolatedDir" },
    env: {}
  };

  describe("Unix paths", () => {
    beforeEach(() => {
      vi.spyOn(path, "sep", "get").mockReturnValue("/");
      vi.spyOn(path, "join").mockImplementation((...parts) => parts.join("/"));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("accepts paths under home directory with forward slashes", () => {
      const homeDir = "/home/user";
      const env = createCliEnvironment({ cwd: "/workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: "/home/user/.claude",
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe("/home/user/.poe-code/test-provider/.claude");
    });

    it("rejects paths outside home directory", () => {
      const homeDir = "/home/user";
      const env = createCliEnvironment({ cwd: "/workspace", homeDir });

      expect(() =>
        resolveIsolatedTargetDirectory({
          targetDirectory: "/etc/config",
          isolated: mockIsolated,
          env,
          providerName: "test-provider"
        })
      ).toThrow(
        'Isolated config targets must live under the user\'s home directory (received "/etc/config").'
      );
    });

    it("accepts home directory itself", () => {
      const homeDir = "/home/user";
      const env = createCliEnvironment({ cwd: "/workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: homeDir,
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe("/home/user/.poe-code/test-provider");
    });
  });

  describe("Windows paths", () => {
    beforeEach(() => {
      vi.spyOn(path, "sep", "get").mockReturnValue("\\");
      vi.spyOn(path, "join").mockImplementation((...parts) =>
        parts.join("\\")
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("accepts paths under home directory with backslashes", () => {
      const homeDir = "C:\\Users\\testuser";
      const env = createCliEnvironment({ cwd: "C:\\workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: "C:\\Users\\testuser\\.claude",
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe(
        "C:\\Users\\testuser\\.poe-code\\test-provider\\.claude"
      );
    });

    it("rejects paths outside home directory on Windows", () => {
      const homeDir = "C:\\Users\\testuser";
      const env = createCliEnvironment({ cwd: "C:\\workspace", homeDir });

      expect(() =>
        resolveIsolatedTargetDirectory({
          targetDirectory: "D:\\config",
          isolated: mockIsolated,
          env,
          providerName: "test-provider"
        })
      ).toThrow(
        'Isolated config targets must live under the user\'s home directory (received "D:\\config").'
      );
    });

    it("accepts home directory itself on Windows", () => {
      const homeDir = "C:\\Users\\testuser";
      const env = createCliEnvironment({ cwd: "C:\\workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: homeDir,
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe("C:\\Users\\testuser\\.poe-code\\test-provider");
    });

    it("handles paths with ~ shortcut on Windows", () => {
      const homeDir = "C:\\Users\\testuser";
      const env = createCliEnvironment({ cwd: "C:\\workspace", homeDir });

      const result = resolveIsolatedTargetDirectory({
        targetDirectory: "~\\.claude",
        isolated: mockIsolated,
        env,
        providerName: "test-provider"
      });

      expect(result).toBe(
        "C:\\Users\\testuser\\.poe-code\\test-provider\\.claude"
      );
    });
  });
});

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

describe("option resolvers", () => {
  const VALID_API_KEY = "vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuo";
  const VALID_SK_POE_API_KEY = "sk-poe-vnlaoHCddCx7eAGLgdH4iSg1MYPsg0JnTRPF1qMuo";

  it("uses the login API key prompt when a key is missing", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(1);
    const [descriptor] = prompts.mock.calls[0]!;
    expect(descriptor.message).toContain("Enter your Poe API key");
  });

  it("strips bracketed paste escape sequences from API key", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    // Simulate tmux/iTerm2 bracketed paste: \x1b[200~ at start, \x1b[201~ at end
    const result = await resolvers.resolveApiKey({
      value: "\x1b[200~my-api-key-here\x1b[201~",
      dryRun: false
    });

    expect(result).toBe("my-api-key-here");
    expect(apiKeyStore.write).toHaveBeenCalledWith("my-api-key-here");
  });

  it("strips multiple bracketed paste sequences from API key", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: "\x1b[200~part1\x1b[201~\x1b[200~part2\x1b[201~",
      dryRun: false
    });

    expect(result).toBe("part1part2");
  });

  it("preserves undefinedndefined suffixes in API keys", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: "vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuoundefinedndefined",
      dryRun: false
    });

    expect(result).toBe("vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuoundefinedndefined");
    expect(checkAuthFn).toHaveBeenCalledWith("vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuoundefinedndefined");
    expect(apiKeyStore.write).toHaveBeenCalledWith("vnlaoHCddCx7eAGLgdH4iS-g_1MYPsg0JnTRPF1qMuoundefinedndefined");
  });

  it.each(["undefined", "ndefined"])("preserves trailing %s suffixes in API keys", async (suffix) => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const value = `my-api-key${suffix}`;
    const result = await resolvers.resolveApiKey({
      value,
      dryRun: false
    });

    expect(result).toBe(value);
    expect(checkAuthFn).toHaveBeenCalledWith(value);
    expect(apiKeyStore.write).toHaveBeenCalledWith(value);
  });

  it("confirms env var usage when envValue is present", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      envValue: VALID_API_KEY,
      dryRun: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(confirmFn).toHaveBeenCalledWith(
      expect.stringContaining("environment")
    );
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("skips env var confirmation when assumeYes is true", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      envValue: VALID_API_KEY,
      dryRun: false,
      assumeYes: true
    });

    expect(result).toBe(VALID_API_KEY);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("rejects invalid env key without prompting when assumeYes is true", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const checkAuthFn = vi.fn().mockResolvedValue(false);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    await expect(
      resolvers.resolveApiKey({
        value: undefined,
        envValue: "invalid-key",
        dryRun: false,
        assumeYes: true,
        allowStored: false
      })
    ).rejects.toThrow("API key rejected.");

    expect(prompts).not.toHaveBeenCalled();
    expect(confirmFn).not.toHaveBeenCalled();
    expect(apiKeyStore.write).not.toHaveBeenCalled();
  });

  it("does not start OAuth or prompts when assumeYes has no credential", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const checkAuthFn = vi.fn();
    const loginViaOAuth = vi.fn().mockResolvedValue(VALID_API_KEY);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn,
      loginViaOAuth
    });

    await expect(
      resolvers.resolveApiKey({
        dryRun: false,
        assumeYes: true
      })
    ).rejects.toThrow("No API key found. Pass --api-key, set POE_API_KEY");

    expect(loginViaOAuth).not.toHaveBeenCalled();
    expect(prompts).not.toHaveBeenCalled();
    expect(apiKeyStore.write).not.toHaveBeenCalled();
  });

  it("falls through to stored credentials when env var is declined", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue("stored-key"),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(false);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      envValue: "env-key",
      dryRun: false
    });

    expect(result).toBe("stored-key");
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(apiKeyStore.write).not.toHaveBeenCalled();
  });

  it("skips stored credentials when allowStored is false", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue("stored-key"),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false,
      allowStored: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(1);
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("re-prompts when checkAuth rejects the key", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: "bad-key"
      }))
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(false);
    const checkAuthFn = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false,
      allowStored: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(2);
    expect(checkAuthFn).toHaveBeenCalledTimes(2);
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("re-prompts when prompted key is missing", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementationOnce(async () => ({}))
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false,
      allowStored: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(2);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("re-prompts when prompted key is empty", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: ""
      }))
      .mockImplementationOnce(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false,
      allowStored: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(2);
    expect(confirmFn).not.toHaveBeenCalled();
    expect(apiKeyStore.write).toHaveBeenCalledWith(VALID_API_KEY);
  });

  it("falls through to prompt when env var declined and no stored key", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi
      .fn()
      .mockImplementation(async (descriptor: { name: string }) => ({
        [descriptor.name]: VALID_API_KEY
      }));
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(false);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      envValue: "env-key",
      dryRun: false
    });

    expect(result).toBe(VALID_API_KEY);
    expect(prompts).toHaveBeenCalledTimes(1);
  });

  it("rejects key via checkAuth when passed directly", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(false);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    await expect(
      resolvers.resolveApiKey({
        value: "invalid-key",
        dryRun: false
      })
    ).rejects.toThrow("API key rejected.");
    expect(checkAuthFn).toHaveBeenCalledWith("invalid-key");
    expect(apiKeyStore.write).not.toHaveBeenCalled();
  });

  it("validates key via checkAuth for valid keys", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: VALID_SK_POE_API_KEY,
      dryRun: false
    });

    expect(result).toBe(VALID_SK_POE_API_KEY);
    expect(checkAuthFn).toHaveBeenCalledWith(VALID_SK_POE_API_KEY);
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("skips checkAuth for stored credentials", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn();
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue("stored with spaces"),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn();
    const checkAuthFn = vi.fn();
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveApiKey({
      value: undefined,
      dryRun: false
    });

    expect(result).toBe("stored with spaces");
    expect(checkAuthFn).not.toHaveBeenCalled();
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("auto-selects the only available model without prompting", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn().mockResolvedValue({});
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveModel({
      value: undefined,
      assumeDefault: false,
      defaultValue: "Default-Model",
      choices: [{ title: "Only Choice", value: "Unique-Model" }],
      label: "Test Model"
    });

    expect(result).toBe("Unique-Model");
    expect(prompts).not.toHaveBeenCalled();
  });

  it("prompts for a text model when no choices are provided", async () => {
    const promptLibrary = createPromptLibrary();
    const prompts = vi.fn().mockResolvedValue({ model: "typed-model" });
    const apiKeyStore = {
      read: vi.fn().mockResolvedValue(null),
      write: vi.fn().mockResolvedValue(undefined)
    };
    const confirmFn = vi.fn().mockResolvedValue(true);
    const checkAuthFn = vi.fn().mockResolvedValue(true);
    const resolvers = createOptionResolvers({
      prompts,
      promptLibrary,
      apiKeyStore,
      confirm: confirmFn,
      checkAuth: checkAuthFn
    });

    const result = await resolvers.resolveModel({
      value: undefined,
      assumeDefault: false,
      defaultValue: "Default-Model",
      label: "Test Model"
    });

    expect(result).toBe("typed-model");
    expect(prompts).toHaveBeenCalledWith({
      name: "model",
      message: "Test Model",
      type: "text",
      initial: "Default-Model"
    });
  });

  function createResolvers() {
    return createOptionResolvers({
      prompts: vi.fn().mockResolvedValue({}),
      promptLibrary: createPromptLibrary(),
      apiKeyStore: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue(undefined)
      },
      confirm: vi.fn().mockResolvedValue(true),
      checkAuth: vi.fn().mockResolvedValue(true)
    });
  }

  const catalogChoices = [
    { title: "Haiku", value: "anthropic/claude-haiku-4.5" },
    { title: "Sonnet", value: "anthropic/claude-sonnet-4.6" }
  ];
  const catalogAliases = {
    haiku: "anthropic/claude-haiku-4.5",
    sonnet: "anthropic/claude-sonnet-4.6"
  };

  it("rejects an explicit model that is absent from the catalog", async () => {
    const resolvers = createResolvers();

    await expect(
      resolvers.resolveModel({
        value: "does-not-exist-xyz",
        defaultValue: "anthropic/claude-sonnet-4.6",
        choices: catalogChoices,
        strictChoices: true,
        label: "Claude Code default model"
      })
    ).rejects.toThrow(ValidationError);
  });

  it("lists catalog models and aliases when an explicit model is unknown", async () => {
    const resolvers = createResolvers();

    await expect(
      resolvers.resolveModel({
        value: "does-not-exist-xyz",
        defaultValue: "anthropic/claude-sonnet-4.6",
        choices: catalogChoices,
        aliases: catalogAliases,
        strictChoices: true,
        label: "Claude Code default model"
      })
    ).rejects.toThrow(
      'Unknown model "does-not-exist-xyz" for Claude Code default model. Available models: haiku, sonnet, anthropic/claude-haiku-4.5, anthropic/claude-sonnet-4.6.'
    );
  });

  it("suggests near matches for an explicit model typo", async () => {
    const resolvers = createResolvers();

    await expect(
      resolvers.resolveModel({
        value: "claude-sonnet",
        defaultValue: "anthropic/claude-sonnet-4.6",
        choices: catalogChoices,
        aliases: catalogAliases,
        strictChoices: true,
        label: "Claude Code default model"
      })
    ).rejects.toThrow(
      'Unknown model "claude-sonnet" for Claude Code default model. Did you mean: sonnet, anthropic/claude-sonnet-4.6?'
    );
  });

  it("resolves an explicit alias to the full catalog id and echoes it", async () => {
    const resolvers = createResolvers();
    const onResolve = vi.fn();

    const result = await resolvers.resolveModel({
      value: "sonnet",
      defaultValue: "anthropic/claude-sonnet-4.6",
      choices: catalogChoices,
      aliases: catalogAliases,
      strictChoices: true,
      label: "Claude Code default model",
      onResolve
    });

    expect(result).toBe("anthropic/claude-sonnet-4.6");
    expect(onResolve).toHaveBeenCalledWith(
      "Claude Code default model",
      "anthropic/claude-sonnet-4.6"
    );
  });

  it("accepts an explicit model that is present in the catalog", async () => {
    const resolvers = createResolvers();

    await expect(
      resolvers.resolveModel({
        value: "anthropic/claude-haiku-4.5",
        defaultValue: "anthropic/claude-sonnet-4.6",
        choices: catalogChoices,
        aliases: catalogAliases,
        strictChoices: true,
        label: "Claude Code default model"
      })
    ).resolves.toBe("anthropic/claude-haiku-4.5");
  });

  it("keeps explicit models unchecked when the choice list is not authoritative", async () => {
    const resolvers = createResolvers();

    await expect(
      resolvers.resolveModel({
        value: "some-live-catalog-model",
        defaultValue: "anthropic/claude-sonnet-4.6",
        choices: catalogChoices,
        label: "Dynamic model"
      })
    ).resolves.toBe("some-live-catalog-model");
  });
});

// ---------------------------------------------------------------------------
// prompt-runner
// ---------------------------------------------------------------------------

describe("createPromptRunner", () => {
  function createAdapter() {
    return {
      text: vi.fn(),
      password: vi.fn(),
      select: vi.fn(),
      isCancel: vi.fn(),
      cancel: vi.fn()
    };
  }

  it("uses the adapter for text prompts", async () => {
    const adapter = createAdapter();
    adapter.text.mockResolvedValue("hello");
    adapter.isCancel.mockReturnValue(false);
    const runner = createPromptRunner(adapter);

    const result = await runner({
      name: "value",
      message: "Say hello",
      type: "text",
      initial: "hi"
    });

    expect(adapter.text).toHaveBeenCalledWith({
      message: "Say hello",
      initialValue: "hi",
      validate: undefined
    });
    expect(result).toEqual({ value: "hello" });
  });

  it("uses the adapter for password prompts", async () => {
    const adapter = createAdapter();
    adapter.password.mockResolvedValue("secret");
    adapter.isCancel.mockReturnValue(false);
    const runner = createPromptRunner(adapter);

    const result = await runner({
      name: "apiKey",
      message: "Enter key",
      type: "password"
    });

    expect(adapter.password).toHaveBeenCalledWith({
      message: "Enter key",
      validate: undefined
    });
    expect(result).toEqual({ apiKey: "secret" });
  });

  it("maps select prompts with choices and initial selection", async () => {
    const adapter = createAdapter();
    adapter.select.mockResolvedValue("b");
    adapter.isCancel.mockReturnValue(false);
    const runner = createPromptRunner(adapter);

    const result = await runner({
      name: "model",
      message: "Pick model",
      type: "select",
      initial: 1,
      choices: [
        { title: "Option A", value: "a" },
        { title: "Option B", value: "b" }
      ]
    });

    expect(adapter.select).toHaveBeenCalledWith({
      message: "Pick model",
      options: [
        { label: "Option A", value: "a" },
        { label: "Option B", value: "b" }
      ],
      initialValue: "b"
    });
    expect(result).toEqual({ model: "b" });
  });

  it("throws a user-facing error on cancellation", async () => {
    const adapter = createAdapter();
    const cancelToken = Symbol("cancel");
    adapter.text.mockResolvedValue(cancelToken);
    adapter.isCancel.mockReturnValue(true);
    const runner = createPromptRunner(adapter);

    await expect(
      runner({
        name: "value",
        message: "Say hello",
        type: "text"
      })
    ).rejects.toBeInstanceOf(OperationCancelledError);

    expect(adapter.cancel).toHaveBeenCalledWith("Operation cancelled.");
  });
});

// ---------------------------------------------------------------------------
// resolve-model-issue-script
// ---------------------------------------------------------------------------

describe("resolve model issue workflow script", () => {
  const scriptUrl = new URL(
    "../../scripts/workflows/resolve-model-issue.cjs",
    import.meta.url
  ).href;

  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: "poe-platform/poe-code",
      GITHUB_TOKEN: "token",
      ISSUE_NUMBER: "123"
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("builds an issue prompt and spawns the resolver agent", async () => {
    const spawnSpy = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "Generated prompt",
        stderr: ""
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
        stderr: ""
      });

    const module = await import(scriptUrl);
    module.runWithSpawn(spawnSpy);

    expect(spawnSpy).toHaveBeenNthCalledWith(
      1,
      "node",
      ["scripts/workflows/build-issue-prompt.cjs"],
      expect.objectContaining({
        encoding: "utf8"
      })
    );
    expect(spawnSpy).toHaveBeenNthCalledWith(
      2,
      "poe-code",
      ["spawn", "claude-code", "Generated prompt"],
      expect.objectContaining({
        encoding: "utf8"
      })
    );
  });
});

// ---------------------------------------------------------------------------
// select-service-script
// ---------------------------------------------------------------------------

describe("select service workflow script", () => {
  const scriptPath = "../../scripts/workflows/select-service.cjs";

  let originalAppend: typeof fs.appendFileSync;
  let writes: string[];

  beforeEach(() => {
    vi.resetModules();
    writes = [];
    originalAppend = fs.appendFileSync;
    fs.appendFileSync = ((_, content: string | NodeJS.ArrayBufferView) => {
      const text =
        typeof content === "string"
          ? content
          : Buffer.isBuffer(content)
          ? content.toString("utf8")
          : String(content);
      writes.push(text);
    }) as typeof fs.appendFileSync;
    process.env.GITHUB_OUTPUT = "/tmp/output";
  });

  afterEach(() => {
    fs.appendFileSync = originalAppend;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.ISSUE_LABELS;
    vi.resetModules();
  });

  it("selects the default service when no agent label present", async () => {
    process.env.ISSUE_LABELS = JSON.stringify([{ name: "enhancement" }]);
    await import(scriptPath);
    const output = writes.join("");
    expect(output).toContain("service=claude-code");
    expect(output).toContain("menu_label=false");
  });

  it("prefers agent labels when available", async () => {
    process.env.ISSUE_LABELS = JSON.stringify([
      { name: "agent:codex" },
      { name: "poe-code" }
    ]);
    await import(scriptPath);
    const output = writes.join("");
    expect(output).toContain("service=codex");
    expect(output).toContain("menu_label=true");
  });

  it("refuses to append service output through a symbolic link", async () => {
    const volume = Volume.fromJSON({ "/outside-output": "sentinel" }, "/");
    volume.mkdirSync("/github", { recursive: true });
    volume.symlinkSync("/outside-output", "/github/output");
    const memoryFs = createFsFromVolume(volume);
    const { appendWorkflowOutput } = await import(scriptPath);

    expect(() => appendWorkflowOutput("/github/output", "service=codex\n", memoryFs)).toThrow(
      "symbolic link"
    );
    expect(memoryFs.readFileSync("/outside-output", "utf8")).toBe("sentinel");
  });
});

// ---------------------------------------------------------------------------
// service-registry
// ---------------------------------------------------------------------------

describe("ServiceRegistry", () => {
  function createAdapter(name: string, label: string): ProviderService {
    return createProviderStub({
      name,
      label
    });
  }

  it("allows providers to self-register and be retrieved by name", () => {
    const registry = createServiceRegistry();
    const adapter = createAdapter("codex", "Codex");

    registry.register(adapter);

    expect(registry.get("codex")).toBe(adapter);
    expect(registry.list()).toEqual([adapter]);
  });

  it("resolves provider aliases to the canonical provider", () => {
    const registry = createServiceRegistry();
    const adapter = createProviderStub({
      name: "claude-code",
      label: "Claude Code",
      aliases: ["claude"]
    });

    registry.register(adapter);

    expect(registry.get("claude")).toBe(adapter);
    expect(registry.require("claude")).toBe(adapter);
    expect(registry.list()).toEqual([adapter]);
  });

  it("resolves agent aliases case-insensitively via agent defs", () => {
    const registry = createServiceRegistry();
    const adapter = createProviderStub({
      name: "claude-code",
      label: "Claude Code"
    });

    registry.register(adapter);

    expect(registry.get("CLAUDE")).toBe(adapter);
  });

  it("prevents alias registrations that collide with existing provider ids", () => {
    const registry = createServiceRegistry();
    registry.register(
      createProviderStub({ name: "claude-code", label: "Claude Code" })
    );

    expect(() =>
      registry.register(
        createProviderStub({
          name: "codex",
          label: "Codex",
          aliases: ["claude-code"]
        })
      )
    ).toThrowError(/already registered/i);
  });

  it("prevents duplicate provider registrations", () => {
    const registry = createServiceRegistry();
    const adapter = createAdapter("codex", "Codex");

    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrowError(
      /"codex" is already registered/i
    );
  });

  it("throws when trying to resolve an unknown provider", () => {
    const registry = createServiceRegistry();

    expect(() => registry.require("unknown"))
      .toThrowError(/unknown provider "unknown"/i);
  });
});
