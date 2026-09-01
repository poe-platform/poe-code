import path from "node:path";
import {
  resolveConfigPath,
  resolveProjectConfigPath,
  resolveServicesConfigPath
} from "@poe-code/poe-code-config/core";

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
  readonly configPath: string;
  readonly servicesConfigPath: string;
  readonly projectConfigPath: string;
  readonly logDir: string;
  readonly poeApiBaseUrl: string;
  readonly poeBaseUrl: string;
  readonly variables: Record<string, string | undefined>;
  resolveHomePath: (...segments: string[]) => string;
  getVariable: (name: string) => string | undefined;
}

export function createCliEnvironment(init: CliEnvironmentInit): CliEnvironment {
  const platform = init.platform ?? process.platform;
  const variables = normalizeEnvironment(init.variables ?? process.env);
  const configPath = resolveConfigPath(init.homeDir);
  const servicesConfigPath = resolveServicesConfigPath(init.homeDir);
  const projectConfigPath = resolveProjectConfigPath(init.cwd);
  const logDir = resolveLogDir(init.homeDir);
  const { poeApiBaseUrl, poeBaseUrl } = resolvePoeBaseUrls(variables);

  const resolveHomePath = (...segments: string[]): string => path.join(init.homeDir, ...segments);

  const getVariable = (name: string): string | undefined => variables[name];

  return {
    cwd: init.cwd,
    homeDir: init.homeDir,
    platform,
    configPath,
    servicesConfigPath,
    projectConfigPath,
    logDir,
    poeApiBaseUrl,
    poeBaseUrl,
    variables,
    resolveHomePath,
    getVariable
  };
}

function normalizeEnvironment(
  input: Record<string, string | undefined>
): Record<string, string | undefined> {
  const output = Object.create(null) as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      output[key] = value;
    }
  }
  return output;
}

export function resolveLogDir(homeDir: string): string {
  return path.join(homeDir, ".poe-code", "logs");
}

export function resolveSpawnLogDir(homeDir: string): string {
  const dir = path.join(homeDir, ".poe-code", "spawn-logs");
  return dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
}

const DEFAULT_POE_API_BASE_URL = "https://api.poe.com/v1";

export function resolvePoeApiBaseUrl(
  variables: Record<string, string | undefined> = process.env
): string {
  return resolvePoeBaseUrls(variables).poeApiBaseUrl;
}

function resolvePoeBaseUrls(variables: Record<string, string | undefined>): {
  poeApiBaseUrl: string;
  poeBaseUrl: string;
} {
  const raw = Object.hasOwn(variables, "POE_BASE_URL") ? variables.POE_BASE_URL : undefined;
  const baseInput =
    typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : DEFAULT_POE_API_BASE_URL;
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
