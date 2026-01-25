import path from "node:path";

export interface CliEnvironmentInit {
  cwd: string;
  homeDir: string;
  platform?: NodeJS.Platform;
  variables?: Record<string, string | undefined>;
}

export interface CliEnvironment {
  readonly cwd: string;
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
  readonly credentialsPath: string;
  readonly logDir: string;
  readonly poeApiBaseUrl: string;
  readonly poeBaseUrl: string;
  readonly variables: Record<string, string | undefined>;
  resolveHomePath: (...segments: string[]) => string;
  getVariable: (name: string) => string | undefined;
}

export function createCliEnvironment(init: CliEnvironmentInit): CliEnvironment {
  const platform = init.platform ?? process.platform;
  const variables = init.variables ?? process.env;
  const credentialsPath = resolveCredentialsPath(init.homeDir);
  const logDir = resolveLogDir(init.homeDir);
  const { poeApiBaseUrl, poeBaseUrl } = resolvePoeBaseUrls(variables);

  const resolveHomePath = (...segments: string[]): string =>
    path.join(init.homeDir, ...segments);

  const getVariable = (name: string): string | undefined => variables[name];

  return {
    cwd: init.cwd,
    homeDir: init.homeDir,
    platform,
    credentialsPath,
    logDir,
    poeApiBaseUrl,
    poeBaseUrl,
    variables,
    resolveHomePath,
    getVariable
  };
}

export function resolveCredentialsPath(homeDir: string): string {
  return path.join(homeDir, ".poe-code", "credentials.json");
}

export function resolveLogDir(homeDir: string): string {
  return path.join(homeDir, ".poe-code", "logs");
}

const DEFAULT_POE_API_BASE_URL = "https://api.poe.com/v1";

function resolvePoeBaseUrls(variables: Record<string, string | undefined>): {
  poeApiBaseUrl: string;
  poeBaseUrl: string;
} {
  const raw = variables.POE_BASE_URL;
  const baseInput =
    typeof raw === "string" && raw.trim().length > 0
      ? raw.trim()
      : DEFAULT_POE_API_BASE_URL;
  const parsed = parseUrl(baseInput);
  if (!parsed) {
    const trimmed = trimTrailingSlash(baseInput.trim());
    return {
      poeApiBaseUrl: ensureV1Suffix(trimmed),
      poeBaseUrl: stripV1Suffix(trimmed)
    };
  }

  const normalizedPath = normalizePath(parsed.pathname);
  return {
    poeApiBaseUrl: buildApiBaseUrl(parsed.origin, normalizedPath),
    poeBaseUrl: buildPoeBaseUrl(parsed.origin, normalizedPath)
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizePath(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return "";
  }
  if (pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function buildApiBaseUrl(origin: string, pathname: string): string {
  if (pathname === "" || pathname === "/") {
    return `${origin}/v1`;
  }
  if (pathname.endsWith("/v1")) {
    return `${origin}${pathname}`;
  }
  return `${origin}${pathname}/v1`;
}

function buildPoeBaseUrl(origin: string, pathname: string): string {
  if (pathname.endsWith("/v1")) {
    const trimmed = pathname.slice(0, -3);
    return trimmed.length > 0 ? `${origin}${trimmed}` : origin;
  }
  return pathname.length > 0 ? `${origin}${pathname}` : origin;
}

function trimTrailingSlash(value: string): string {
  if (value.length > 1 && value.endsWith("/")) {
    return value.slice(0, -1);
  }
  if (value === "/") {
    return "";
  }
  return value;
}

function ensureV1Suffix(value: string): string {
  if (value.endsWith("/v1")) {
    return value;
  }
  if (value === "") {
    return "/v1";
  }
  return `${value}/v1`;
}

function stripV1Suffix(value: string): string {
  if (value.endsWith("/v1")) {
    return value.slice(0, -3);
  }
  return value;
}
