import { text } from "node:stream/consumers";
import { createHostRunner, type Runner } from "@poe-code/process-runner";
import { UserError } from "@poe-code/user-error";

const DEFAULT_ENDPOINT = "https://api.github.com/graphql";
const USER_AGENT = "poe-code-task-list/0.0.1";
const AUTH_ERROR = "gh auth token failed; install gh, run 'gh auth login', or pass auth: { token }";

export interface GhClientOptions {
  token: string;
  endpoint?: string;
  fetch?: typeof fetch;
}

export interface GhClient {
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export function createGhClient(options: GhClientOptions): GhClient {
  const fetchImpl = options.fetch ?? fetch;
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;

  return {
    async graphql<T>(query: string, variables: Record<string, unknown>) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT
        },
        body: JSON.stringify({ query, variables })
      });

      const body = await response.text();
      if (response.status === 401) {
        throw new UserError(
          "GitHub rejected your credentials (HTTP 401). Your token is missing or expired - run 'gh auth login', or pass a valid token via auth: { token }."
        );
      }
      if (response.status !== 200) {
        throw new Error(`GitHub GraphQL request failed with status ${response.status}: ${body}`);
      }

      const parsed = JSON.parse(body) as {
        data?: T | null;
        errors?: { message?: string }[];
      };

      if (parsed.data !== undefined && parsed.data !== null) {
        return parsed.data;
      }

      const firstError = parsed.errors?.[0];
      if (firstError !== undefined) {
        throw new Error(firstError.message ?? "GitHub GraphQL request failed");
      }

      return parsed.data as T;
    }
  };
}

export interface ResolveAuthOptions {
  explicitToken?: string;
  runner?: Runner;
}

export async function resolveAuth(options: ResolveAuthOptions): Promise<string> {
  if (options.explicitToken !== undefined) {
    return options.explicitToken;
  }

  const runner = options.runner ?? createHostRunner();
  const handle = runner.exec({
    command: "gh",
    args: ["auth", "token"],
    stdout: "pipe",
    stderr: "pipe"
  });

  const [stdout, , result] = await Promise.all([
    handle.stdout === null ? Promise.resolve("") : text(handle.stdout),
    handle.stderr === null ? Promise.resolve("") : text(handle.stderr),
    handle.result
  ]);
  const token = stdout.trim();

  if (result.exitCode !== 0 || token.length === 0) {
    throw new Error(AUTH_ERROR);
  }

  return token;
}

export interface ResolveEndpointOptions {
  env?: Record<string, string | undefined>;
}

export function resolveEndpoint(options: ResolveEndpointOptions = {}): string {
  const env = options.env ?? process.env;
  const host = env.GH_HOST;

  if (host !== undefined && host !== "" && host !== "github.com") {
    return `https://${host}/api/graphql`;
  }

  return DEFAULT_ENDPOINT;
}
