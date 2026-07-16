import { createSecretStore } from "auth-store";
import { ApiError, AuthenticationError } from "../cli/errors.js";
import type { HttpClient } from "../cli/http.js";
import { resolvePoeApiBaseUrl } from "../cli/environment.js";

export interface PoeAuthIdentity {
  user_id: number;
  handle: string;
  name: string;
  profile_picture: string;
  [key: string]: unknown;
}

export interface FetchPoeAuthIdentityOptions {
  apiKey: string;
  baseUrl?: string;
  httpClient?: HttpClient;
}

export interface GetPoeAuthIdentityOptions {
  apiKey?: string;
  baseUrl?: string;
  variables?: Record<string, string | undefined>;
  httpClient?: HttpClient;
}

/**
 * Reads the Poe API key with the following priority:
 * 1. `POE_API_KEY` environment variable (if set)
 * 2. Auth store (`auth-store`)
 *
 * @returns The API key
 * @throws AuthenticationError if no credentials found
 */
export async function getPoeApiKey(): Promise<string> {
  const envKey = Object.hasOwn(process.env, "POE_API_KEY") ? process.env.POE_API_KEY : undefined;
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return envKey.trim();
  }

  const { store } = createSecretStore({
    backendEnvVar: "POE_AUTH_BACKEND",
    fileStore: {
      salt: "poe-code:encrypted-file-auth-store:v1",
      defaultDirectory: ".poe-code",
      defaultFileName: "credentials.enc"
    }
  });
  const storedKey = await store.get();

  if (typeof storedKey === "string" && storedKey.trim().length > 0) {
    return storedKey.trim();
  }

  throw new AuthenticationError("No API key found. Set POE_API_KEY or run 'poe-code login'.");
}

export async function ensurePoeApiKeyEnv(): Promise<void> {
  const envKey = Object.hasOwn(process.env, "POE_API_KEY") ? process.env.POE_API_KEY : undefined;
  if (typeof envKey === "string" && envKey.trim().length > 0) {
    return;
  }

  process.env.POE_API_KEY = await getPoeApiKey();
}

export async function getPoeAuthIdentity(
  options: GetPoeAuthIdentityOptions = {}
): Promise<PoeAuthIdentity> {
  const apiKey = options.apiKey ?? await getPoeApiKey();
  return fetchPoeAuthIdentity({
    apiKey,
    baseUrl: options.baseUrl ?? resolvePoeApiBaseUrl(options.variables),
    httpClient: options.httpClient
  });
}

export async function fetchPoeAuthIdentity(
  options: FetchPoeAuthIdentityOptions
): Promise<PoeAuthIdentity> {
  const httpClient = options.httpClient ?? createDefaultHttpClient();
  const response = await httpClient(`${trimTrailingSlashes(options.baseUrl ?? resolvePoeApiBaseUrl())}/whoami`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`
    }
  });

  if (!response.ok) {
    throw new ApiError(`Failed to fetch identity (HTTP ${response.status})`, {
      httpStatus: response.status,
      endpoint: "/v1/whoami"
    });
  }

  return parsePoeAuthIdentity(await response.json());
}

function parsePoeAuthIdentity(value: unknown): PoeAuthIdentity {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ApiError("Malformed identity response from Poe API.", {
      endpoint: "/v1/whoami"
    });
  }

  const identity = value as Partial<PoeAuthIdentity>;
  if (
    typeof identity.user_id !== "number" ||
    !Number.isFinite(identity.user_id) ||
    typeof identity.handle !== "string" ||
    identity.handle.trim().length === 0 ||
    typeof identity.name !== "string" ||
    identity.name.trim().length === 0 ||
    typeof identity.profile_picture !== "string"
  ) {
    throw new ApiError("Malformed identity response from Poe API.", {
      endpoint: "/v1/whoami"
    });
  }

  return value as PoeAuthIdentity;
}

function createDefaultHttpClient(): HttpClient {
  return async (url, init) => {
    const response = await globalThis.fetch(url, init as RequestInit);
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json()
    };
  };
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
