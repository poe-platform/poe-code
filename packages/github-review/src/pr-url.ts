function parseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

function parsePathPart(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    const hasDisallowedCharacter = [...decoded].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return character === "/" || character === "\\" || codePoint < 32 || codePoint === 127;
    });
    if (!decoded || hasDisallowedCharacter) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export interface GitHubPullRequestRef {
  host: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
}

function formatPullRequestUrl(ref: Omit<GitHubPullRequestRef, "url">): string {
  return `https://${ref.host}/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pull/${ref.number}`;
}

export function parseGitHubPullRequestRef(prUrl: string): GitHubPullRequestRef | null {
  const parsed = parseUrl(prUrl);
  if (
    !parsed ||
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }

  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(parsed.pathname);
  if (!match) {
    return null;
  }
  const owner = parsePathPart(match[1] ?? "");
  const repo = parsePathPart(match[2] ?? "");
  const number = Number.parseInt(match[3] ?? "0", 10);
  if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0) {
    return null;
  }

  const ref = {
    host: parsed.host.toLowerCase(),
    owner,
    repo,
    number
  };
  return { ...ref, url: formatPullRequestUrl(ref) };
}

export function canonicalPullRequestUrl(prUrl: string): string {
  const ref = parseGitHubPullRequestRef(prUrl);
  if (!ref) {
    return prUrl;
  }
  return ref.url;
}
