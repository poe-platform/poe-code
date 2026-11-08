import { defineCommand, defineGroup, S, UserError, type Static } from "toolcraft";
import { isCancel, password } from "toolcraft-design";
import { createSecretStore, type StoreBackend } from "toolcraft/auth-store";
import { requestJson } from "../http.js";
import type { AuthProvider } from "./types.js";

export interface BearerTokenAuthOptions {
  serviceName: string;
  envVar: string;
  whoamiPath?: string;
  commandPrefix?: string;
}

interface BearerTokenAuthCommandServices {
  baseUrl?: string;
  fetch: typeof globalThis.fetch;
  readStdin?: () => Promise<string>;
}

interface LoginResult {
  email?: string;
  isEmployee?: boolean;
  storageBackend: StoreBackend;
}

interface LogoutResult {
  storageBackend: StoreBackend;
}

interface StatusResult {
  loggedIn: boolean;
  tokenSource?: string;
  email?: string;
  isEmployee?: boolean;
}

interface TokenResolution {
  token: string;
  tokenSource: string;
}

interface Identity {
  email?: string;
  isEmployee?: boolean;
}

const DEFAULT_COMMAND_PREFIX = "auth";
const loginParams = S.Object({
  token: S.Optional(S.String({ description: "Bearer token to store." })),
  tokenStdin: S.Optional(
    S.Boolean({ description: "Read the token from stdin instead of prompting." })
  ),
});
type LoginParams = Static<typeof loginParams>;
const emptyParams = S.Object({});
const KEYCHAIN_ACCOUNT = "token";
const DEFAULT_STORE_DIRECTORY = ".toolcraft-openapi";
const DEFAULT_STORE_VERSION = "v1";

export function bearerTokenAuth(options: BearerTokenAuthOptions): AuthProvider {
  const commandPrefix = options.commandPrefix ?? DEFAULT_COMMAND_PREFIX;
  const { store, backend } = createSecretStore({
    fileStore: {
      salt: `${options.serviceName}:toolcraft-openapi:${DEFAULT_STORE_VERSION}`,
      defaultDirectory: DEFAULT_STORE_DIRECTORY,
      defaultFileName: `${options.serviceName}.enc`,
    },
    keychainStore: {
      service: options.serviceName,
      account: KEYCHAIN_ACCOUNT,
    },
  });
  let lastResolvedToken: TokenResolution | null = null;

  async function resolveToken(): Promise<TokenResolution | null> {
    const envToken = normalizeToken(process.env[options.envVar]);
    if (envToken) {
      lastResolvedToken = {
        token: envToken,
        tokenSource: `env (${options.envVar})`,
      };
      return lastResolvedToken;
    }

    const storedToken = normalizeToken(await store.get());
    if (!storedToken) {
      lastResolvedToken = null;
      return null;
    }

    lastResolvedToken = {
      token: storedToken,
      tokenSource: backend,
    };
    return lastResolvedToken;
  }

  const loginCommand = defineCommand({
    name: "login",
    description: "Store a bearer token for future requests.",
    params: loginParams,
    handler: async (ctx) => {
      const token = await resolveLoginToken(ctx.params, ctx.readStdin);
      const identity = await resolveIdentity(token, ctx, options.whoamiPath);

      if (options.whoamiPath !== undefined && identity.isEmployee !== true) {
        throw new UserError("Authenticated account is not an employee.");
      }

      await store.set(token);

      return {
        email: identity.email,
        isEmployee: identity.isEmployee,
        storageBackend: backend,
      } satisfies LoginResult;
    },
    render: {
      rich: (result: LoginResult, { logger }) => {
        logger.success(formatLoginMessage(result));
        logger.message(
          result.storageBackend === "keychain"
            ? "Stored in macOS Keychain."
            : "Stored in encrypted file store."
        );
      },
      json: (result) => result,
    },
  });

  const logoutCommand = defineCommand({
    name: "logout",
    description: "Remove the stored bearer token.",
    params: emptyParams,
    handler: async () => {
      await store.delete();

      return {
        storageBackend: backend,
      } satisfies LogoutResult;
    },
    render: {
      rich: (_result: LogoutResult, { logger }) => {
        logger.success("Removed stored credential.");
      },
      json: (result) => result,
    },
  });

  const statusCommand = defineCommand({
    name: "status",
    description: "Show where the current bearer token resolves from.",
    params: emptyParams,
    handler: async (ctx) => {
      const resolvedToken = await resolveToken();
      if (!resolvedToken) {
        return { loggedIn: false } satisfies StatusResult;
      }

      const identity = await resolveIdentity(
        resolvedToken.token,
        ctx,
        options.whoamiPath
      );

      return {
        loggedIn: true,
        tokenSource: resolvedToken.tokenSource,
        email: identity.email,
        isEmployee: identity.isEmployee,
      } satisfies StatusResult;
    },
    render: {
      rich: (result: StatusResult, { logger }) => {
        if (!result.loggedIn) {
          logger.message("Not logged in.");
          return;
        }

        logger.success(result.email ? `Logged in as ${result.email}` : "Logged in.");
        logger.message(`Token source: ${result.tokenSource}`);
      },
      json: (result) => result,
    },
  });

  return {
    async getToken(): Promise<string> {
      const resolvedToken = await resolveToken();
      if (resolvedToken) {
        return resolvedToken.token;
      }

      throw new UserError(`Run '${commandPrefix} login' first.`);
    },
    async invalidate(token?: string): Promise<void> {
      if (
        token !== undefined &&
        lastResolvedToken?.token === token &&
        lastResolvedToken.tokenSource.startsWith("env (")
      ) {
        return;
      }
      await store.delete();
    },
    commands: [defineGroup({
      name: commandPrefix,
      description: "Manage stored bearer-token authentication.",
      scope: ["cli"],
      children: [loginCommand, logoutCommand, statusCommand],
    })],
  } satisfies AuthProvider;
}

async function resolveLoginToken(
  params: LoginParams,
  readStdin?: () => Promise<string>
): Promise<string> {
  const providedToken = normalizeToken(params.token);

  if (providedToken && params.tokenStdin) {
    throw new UserError("Pass either --token or --token-stdin, not both.");
  }

  if (providedToken) {
    return providedToken;
  }

  if (params.tokenStdin) {
    const stdinToken = normalizeToken(await (readStdin?.() ?? readAllFromStdin()));
    if (!stdinToken) {
      throw new UserError("Received an empty token from stdin.");
    }

    return stdinToken;
  }

  const promptedToken = await password({
    message: "Paste your API key:",
  });

  if (isCancel(promptedToken)) {
    throw new UserError("Authentication cancelled.");
  }

  const normalizedPromptedToken = normalizeToken(promptedToken);
  if (!normalizedPromptedToken) {
    throw new UserError("Token cannot be empty.");
  }

  return normalizedPromptedToken;
}

async function resolveIdentity(
  token: string,
  services: BearerTokenAuthCommandServices,
  whoamiPath: string | undefined
): Promise<Identity> {
  if (whoamiPath === undefined) {
    return {};
  }

  if (!services.baseUrl) {
    throw new UserError("Auth verification requires a baseUrl service.");
  }

  const response = await requestJson<unknown>({
    baseUrl: services.baseUrl,
    path: whoamiPath,
    method: "GET",
    auth: "required",
    tokenSource: {
      getToken: async () => token,
    },
    fetch: services.fetch,
  });

  return parseIdentity(response);
}

function parseIdentity(response: unknown): Identity {
  if (!isRecord(response)) {
    return {};
  }

  return {
    email: typeof response.email === "string" ? response.email : undefined,
    isEmployee:
      typeof response.is_employee === "boolean" ? response.is_employee : undefined,
  };
}

async function readAllFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatLoginMessage(result: LoginResult): string {
  if (!result.email) {
    return "Authenticated.";
  }

  if (result.isEmployee === true) {
    return `Authenticated as ${result.email} (employee confirmed).`;
  }

  return `Authenticated as ${result.email}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
