import type http from "node:http";
import { createAuthorizationState } from "./authorization-state.js";
import { createLoopbackAuthorizationSession } from "./loopback-authorization.js";
import type { OAuthLandingPage } from "./loopback-authorization.js";
import {
  generateCodeChallenge as generatePkceCodeChallenge,
  generateCodeVerifier as generatePkceCodeVerifier
} from "./pkce.js";

const DEFAULT_AUTHORIZATION_ENDPOINT = "https://poe.com/oauth/authorize";
const DEFAULT_TOKEN_ENDPOINT = "https://api.poe.com/token";
const MAX_VALID_EPOCH_MS = 8_640_000_000_000_000;

export interface OAuthClientConfig {
  clientId: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  landingPage?: OAuthLandingPage;
  openBrowser?: (url: string) => Promise<void>;
  readLine?: () => Promise<string>;
  createServer?: () => http.Server;
  fetch?: typeof globalThis.fetch;
}

export interface OAuthResult {
  apiKey: string;
  expiresIn: number | null;
}

export interface OAuthAuthorization {
  authorizationUrl: string;
  waitForResult: () => Promise<OAuthResult>;
}

export interface OAuthClient {
  authorize(): Promise<OAuthAuthorization>;
}

export function createOAuthClient(config: OAuthClientConfig): OAuthClient {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const clientId = validateClientId(config.clientId);
  const normalizedConfig = {
    ...config,
    clientId
  };

  return {
    authorize: () => startAuthorization(normalizedConfig, fetchFn)
  };
}

function generateCodeVerifier(): string {
  return generatePkceCodeVerifier();
}

async function startAuthorization(
  config: OAuthClientConfig,
  fetchFn: typeof globalThis.fetch
): Promise<OAuthAuthorization> {
  const authorizationEndpoint = config.authorizationEndpoint ?? DEFAULT_AUTHORIZATION_ENDPOINT;
  const tokenEndpoint = config.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generatePkceCodeChallenge(codeVerifier);

  const loopbackSession = await createLoopbackAuthorizationSession({
    openBrowser: config.openBrowser,
    readLine: config.readLine,
    createServer: config.createServer,
    landingPage: config.landingPage ?? {
      title: "Connected to Poe",
      body: "You can close this tab and return to your terminal."
    }
  });
  const redirectUri = loopbackSession.redirectUri;

  const authorizationUrl = buildAuthorizationUrl({
    endpoint: authorizationEndpoint,
    clientId: config.clientId,
    redirectUri,
    codeChallenge,
    state: createAuthorizationState({
      issuer: new URL(authorizationEndpoint).origin,
      requireIssuer: false
    })
  });

  let resultPromise: Promise<OAuthResult> | undefined;
  const waitForResult = (): Promise<OAuthResult> => {
    resultPromise ??= (async () => {
      try {
        const code = await loopbackSession.waitForCode(authorizationUrl);

        return await exchangeCodeForApiKey({
          tokenEndpoint,
          code,
          codeVerifier,
          clientId: config.clientId,
          redirectUri,
          fetchFn
        });
      } finally {
        loopbackSession.close();
      }
    })();
    return resultPromise;
  };

  return { authorizationUrl, waitForResult };
}

function buildAuthorizationUrl(params: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const url = new URL(params.endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("scope", "apikey:create");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function exchangeCodeForApiKey(params: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  fetchFn: typeof globalThis.fetch;
}): Promise<OAuthResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
    redirect_uri: params.redirectUri
  });

  const response = await params.fetchFn(params.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!response.ok) {
    const text = await response.text();
    const description = parseErrorDescription(text);
    throw new Error(description ?? `Token exchange failed (${response.status}): ${text}`);
  }

  let value: unknown;
  try {
    value = (await response.json()) as unknown;
  } catch (error) {
    throw new Error(`Token exchange failed: invalid JSON response from ${params.tokenEndpoint}`, {
      cause: error
    });
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Token response must be a JSON object");
  }
  const data = value as Record<string, unknown>;
  const apiKey = getOwnString(data, "api_key")?.trim();
  const apiKeyExpiresIn = getOwnEntry(data, "api_key_expires_in");

  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Token response missing api_key field");
  }

  if (apiKeyExpiresIn !== undefined && !isValidExpiresIn(apiKeyExpiresIn)) {
    throw new Error("Token response invalid api_key_expires_in field");
  }

  return {
    apiKey,
    expiresIn: typeof apiKeyExpiresIn === "number" ? apiKeyExpiresIn : null
  };
}

function parseErrorDescription(text: string): string | null {
  try {
    const data = JSON.parse(text) as unknown;
    if (!isObjectRecord(data)) {
      return null;
    }

    const errorDescription = getOwnString(data, "error_description");
    if (errorDescription !== undefined) {
      return errorDescription;
    }

    const error = getOwnString(data, "error");
    if (error !== undefined) {
      return error;
    }
  } catch {
    // not JSON
  }
  return null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function getOwnString(record: Record<string, unknown>, key: string): string | undefined {
  const value = getOwnEntry(record, key);
  return typeof value === "string" ? value : undefined;
}

function validateClientId(clientId: string): string {
  const trimmed = clientId.trim();
  if (trimmed.length === 0 || trimmed !== clientId) {
    throw new Error("Poe OAuth clientId must not be blank or contain surrounding whitespace.");
  }
  return clientId;
}

function isValidExpiresIn(value: unknown): value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    return false;
  }

  const expiresAt = Date.now() + value * 1000;
  return Number.isSafeInteger(expiresAt) && expiresAt <= MAX_VALID_EPOCH_MS;
}
