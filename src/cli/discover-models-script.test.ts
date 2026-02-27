import { describe, it, expect, vi } from "vitest";

const scriptUrl = new URL(
  "../../scripts/workflows/discover-models.mjs",
  import.meta.url
).href;

describe("discover models workflow script", () => {
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
          added: ["GPT-5.2-Codex", "gpt-5.2-codex", "Claude-Opus-4.6"],
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

    expect(events.added).toEqual(["gpt-5.2-codex", "claude-opus-4.6", "new-one"]);
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
