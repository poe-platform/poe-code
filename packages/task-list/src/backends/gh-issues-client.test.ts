import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { RunHandle, Runner, RunSpec } from "@poe-code/process-runner";
import { isUserError } from "@poe-code/user-error";
import { createGhClient, resolveAuth, resolveEndpoint } from "./gh-issues-client.js";

describe("resolveAuth", () => {
  it("returns explicit token without invoking runner", async () => {
    const runner = createStubRunner({ exitCode: 0, stdout: "from-gh\n" });

    await expect(resolveAuth({ explicitToken: "explicit", runner })).resolves.toBe("explicit");

    expect(runner.calls).toEqual([]);
  });

  it("shells out to gh auth token and trims output", async () => {
    const runner = createStubRunner({ exitCode: 0, stdout: "  gh-token\n" });

    await expect(resolveAuth({ runner })).resolves.toBe("gh-token");

    expect(runner.calls).toEqual([
      {
        command: "gh",
        args: ["auth", "token"],
        stdout: "pipe",
        stderr: "pipe"
      }
    ]);
  });

  it("throws when runner exit code is non-zero", async () => {
    const runner = createStubRunner({ exitCode: 1, stdout: "token\n", stderr: "no auth\n" });

    await expect(resolveAuth({ runner })).rejects.toThrow(
      "gh auth token failed; install gh, run 'gh auth login', or pass auth: { token }"
    );
  });

  it("throws when runner stdout is empty", async () => {
    const runner = createStubRunner({ exitCode: 0, stdout: " \n" });

    await expect(resolveAuth({ runner })).rejects.toThrow(
      "gh auth token failed; install gh, run 'gh auth login', or pass auth: { token }"
    );
  });
});

describe("resolveEndpoint", () => {
  it("honors GH_HOST", () => {
    expect(resolveEndpoint({ env: { GH_HOST: "github.example.test" } })).toBe(
      "https://github.example.test/api/graphql"
    );
  });

  it("uses github.com GraphQL endpoint by default", () => {
    expect(resolveEndpoint({ env: { GH_HOST: "github.com" } })).toBe(
      "https://api.github.com/graphql"
    );
    expect(resolveEndpoint({ env: {} })).toBe("https://api.github.com/graphql");
  });
});

describe("createGhClient", () => {
  it("injects auth header, posts the query, and returns data", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse({ data: { viewer: { login: "octo" } } })
    );
    const client = createGhClient({
      token: "secret",
      endpoint: "https://github.example.test/api/graphql",
      fetch: fetchMock
    });

    await expect(
      client.graphql<{ viewer: { login: string } }>(
        "query Viewer($first: Int!) { viewer { login } }",
        {
          first: 1
        }
      )
    ).resolves.toEqual({ viewer: { login: "octo" } });

    expect(fetchMock).toHaveBeenCalledWith("https://github.example.test/api/graphql", {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
        "User-Agent": "poe-code-task-list/0.0.1"
      },
      body: JSON.stringify({
        query: "query Viewer($first: Int!) { viewer { login } }",
        variables: { first: 1 }
      })
    });
  });

  it("uses the default github.com GraphQL endpoint when endpoint is omitted", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ data: { ok: true } }));
    const client = createGhClient({
      token: "secret",
      fetch: fetchMock
    });

    await expect(
      client.graphql<{ ok: boolean }>("query { viewer { login } }", {})
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/graphql",
      expect.objectContaining({
        method: "POST"
      })
    );
  });

  it("throws on GraphQL errors", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse({ errors: [{ message: "Could not resolve project" }] })
    );
    const client = createGhClient({
      token: "secret",
      endpoint: "https://api.github.com/graphql",
      fetch: fetchMock
    });

    await expect(client.graphql("query { viewer { login } }", {})).rejects.toThrow(
      "Could not resolve project"
    );
  });

  it("throws a fallback message when a GraphQL error has no message", async () => {
    const fetchMock = vi.fn(async () => createJsonResponse({ errors: [{}] }));
    const client = createGhClient({
      token: "secret",
      endpoint: "https://api.github.com/graphql",
      fetch: fetchMock
    });

    await expect(client.graphql("query { viewer { login } }", {})).rejects.toThrow(
      "GitHub GraphQL request failed"
    );
  });

  it("maps a 401 to auth guidance without leaking the response body", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse(
        { message: "Bad credentials", documentation_url: "https://docs.github.com/graphql" },
        { status: 401 }
      )
    );
    const client = createGhClient({
      token: "stale",
      endpoint: "https://api.github.com/graphql",
      fetch: fetchMock
    });

    const error = await client
      .graphql("query { viewer { login } }", {})
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(isUserError(error)).toBe(true);
    expect((error as Error).message).toContain("gh auth login");
    expect((error as Error).message).not.toContain("Bad credentials");
    expect((error as Error).message).not.toContain("documentation_url");
  });

  it("throws on non-200 responses with status and body", async () => {
    const fetchMock = vi.fn(async () =>
      createJsonResponse({ message: "rate limited" }, { status: 403 })
    );
    const client = createGhClient({
      token: "secret",
      endpoint: "https://api.github.com/graphql",
      fetch: fetchMock
    });

    await expect(client.graphql("query { viewer { login } }", {})).rejects.toThrow(
      'GitHub GraphQL request failed with status 403: {"message":"rate limited"}'
    );
  });
});

function createJsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" }
  });
}

function createStubRunner(behavior: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}): Runner & {
  calls: RunSpec[];
} {
  const calls: RunSpec[] = [];

  return {
    name: "stub",
    calls,
    exec(spec) {
      calls.push(spec);

      return {
        pid: null,
        stdout: streamFromString(behavior.stdout ?? ""),
        stderr: streamFromString(behavior.stderr ?? ""),
        stdin: null,
        result: Promise.resolve({ exitCode: behavior.exitCode }),
        kill() {}
      } satisfies RunHandle;
    }
  };
}

function streamFromString(value: string): Readable {
  return Readable.from([value]);
}
