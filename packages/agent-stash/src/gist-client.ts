import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GistClient, GistRecord, GistWriteInput } from "./types.js";

const execFileAsync = promisify(execFile);

export async function resolveGitHubToken(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (env.GITHUB_TOKEN) {
    return env.GITHUB_TOKEN;
  }
  if (env.GH_TOKEN) {
    return env.GH_TOKEN;
  }
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"]);
    const token = stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

export class GitHubGistClient implements GistClient {
  constructor(private readonly token: string) {}

  async createSecret(input: GistWriteInput): Promise<GistRecord> {
    return this.request("https://api.github.com/gists", {
      method: "POST",
      body: JSON.stringify({ public: false, description: input.description, files: input.files })
    });
  }

  async read(gistId: string): Promise<GistRecord> {
    assertValidGistId(gistId);
    const first = await this.request(readGistUrl(gistId, 1), { method: "GET" });
    if (!first.updatedAt) {
      return first;
    }
    const second = await this.request(readGistUrl(gistId, 2), { method: "GET" });
    return newestGistRecord(first, second);
  }

  async update(gistId: string, input: GistWriteInput): Promise<GistRecord> {
    assertValidGistId(gistId);
    return this.request(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH",
      body: JSON.stringify({ description: input.description, files: input.files })
    });
  }

  private async request(url: string, init: RequestInit): Promise<GistRecord> {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        Pragma: "no-cache",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (response.status === 403) {
      throw new Error(`GitHub Gist request failed with 403${await responseErrorSuffix(response)}. Ensure the token has the gist scope.`);
    }
    if (!response.ok) {
      throw new Error(`GitHub Gist request failed with ${response.status}${await responseErrorSuffix(response)}`);
    }
    let json: {
      id: unknown;
      html_url?: unknown;
      updated_at?: unknown;
      files?: unknown;
    };
    try {
      json = (await response.json()) as typeof json;
    } catch {
      throw new Error("Invalid GitHub Gist response JSON.");
    }
    assertValidGistId(json.id);
    return {
      id: json.id,
      htmlUrl: typeof json.html_url === "string" ? json.html_url : undefined,
      updatedAt: typeof json.updated_at === "string" ? json.updated_at : undefined,
      files: parseGistResponseFiles(json.files)
    };
  }
}

function readGistUrl(gistId: string, attempt: number): string {
  const fresh = `${Date.now()}-${attempt}-${Math.random().toString(16).slice(2)}`;
  return `https://api.github.com/gists/${gistId}?agent_stash_fresh=${encodeURIComponent(fresh)}`;
}

function newestGistRecord(first: GistRecord, second: GistRecord): GistRecord {
  const firstTime = parseTimestamp(first.updatedAt);
  const secondTime = parseTimestamp(second.updatedAt);
  if (firstTime === undefined || secondTime === undefined) {
    return second;
  }
  return secondTime >= firstTime ? second : first;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function parseGistResponseFiles(files: unknown): GistRecord["files"] {
  if (files === undefined) {
    return {};
  }
  if (!isRecord(files)) {
    throw new Error("Invalid Gist files response.");
  }
  const result = Object.create(null) as GistRecord["files"];
  for (const [filename, file] of Object.entries(files)) {
    if (file === null) {
      continue;
    }
    if (!isRecord(file)) {
      throw new Error(`Invalid Gist file response: ${filename}`);
    }
    if (file.filename !== undefined && typeof file.filename !== "string") {
      throw new Error(`Invalid Gist file filename: ${filename}`);
    }
    if (typeof file.content !== "string") {
      throw new Error(`Invalid Gist file content: ${filename}`);
    }
    result[filename] = { filename: file.filename ?? filename, content: file.content };
  }
  return result;
}

async function responseErrorSuffix(response: Response): Promise<string> {
  const body = await response.text();
  if (body.trim().length === 0) {
    return "";
  }
  return `: ${body.slice(0, 500)}`;
}

function assertValidGistId(gistId: unknown): asserts gistId is string {
  if (
    typeof gistId !== "string" ||
    gistId.length === 0 ||
    gistId === "." ||
    gistId === ".." ||
    [...gistId].some((character) => !isGistIdCharacter(character))
  ) {
    throw new Error(`Invalid Gist id: ${String(gistId)}`);
  }
}

function isGistIdCharacter(character: string): boolean {
  return isAsciiAlphaNumeric(character) || character === "." || character === "_" || character === "-";
}

function isAsciiAlphaNumeric(character: string): boolean {
  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createDefaultGistClient(): Promise<GistClient> {
  const token = await resolveGitHubToken();
  if (!token) {
    throw new Error("GitHub token required for Gist operations. Set GITHUB_TOKEN or GH_TOKEN, or run gh auth login.");
  }
  return new GitHubGistClient(token);
}
