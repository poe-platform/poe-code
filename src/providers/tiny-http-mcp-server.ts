import {
  configMutation,
  fileMutation,
  templateMutation
} from "@poe-code/config-mutations";
import { createProvider } from "./create-provider.js";
import type { ProviderConfigurePayloadContext } from "../cli/service-registry.js";

interface TinyHttpMcpServerOauthConfig {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[];
  requiredScopes: string[];
  bearerMethodsSupported: string[];
  verifierModule: string;
  verifierExport: string;
}

interface TinyHttpMcpServerConfigureContext extends Record<string, unknown> {
  name: string;
  version: string;
  listen: {
    hostname: string;
    path: string;
    port: number;
  };
  oauth: TinyHttpMcpServerOauthConfig;
}

const SCAFFOLD_DIRECTORY = "~/.poe-code/tiny-http-mcp-server";
const CONFIG_FILE = `${SCAFFOLD_DIRECTORY}/config.json`;
const SERVER_FILE = `${SCAFFOLD_DIRECTORY}/server.mjs`;
const VERIFIER_FILE = `${SCAFFOLD_DIRECTORY}/verify-token.mjs`;

const DEFAULT_CONFIG: TinyHttpMcpServerConfigureContext = {
  name: "oauth-http-server",
  version: "1.0.0",
  listen: {
    hostname: "127.0.0.1",
    path: "/mcp",
    port: 3000,
  },
  oauth: {
    resource: "https://example.com/mcp",
    authorizationServers: ["https://auth.example.com"],
    scopesSupported: ["mcp.read", "mcp.write"],
    requiredScopes: ["mcp.read"],
    bearerMethodsSupported: ["header"],
    verifierModule: "./verify-token.mjs",
    verifierExport: "default",
  },
};

function normalizeString(value: string): string {
  return value.trim();
}

function normalizeStringList(values: readonly string[]): string[] {
  const normalized: string[] = [];

  for (const value of values) {
    const trimmed = normalizeString(value);
    if (trimmed.length === 0 || normalized.includes(trimmed)) {
      continue;
    }
    normalized.push(trimmed);
  }

  return normalized;
}

function splitCommaSeparated(value: string): string[] {
  return normalizeStringList(value.split(","));
}

function readStringOption(
  context: ProviderConfigurePayloadContext,
  key: string
): string | undefined {
  const value = context.commandOptions[key];
  return typeof value === "string" && value.trim().length > 0
    ? normalizeString(value)
    : undefined;
}

function readStringArrayOption(
  context: ProviderConfigurePayloadContext,
  key: string
): string[] | undefined {
  const value = context.commandOptions[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = normalizeStringList(
    value.filter((entry): entry is string => typeof entry === "string")
  );
  return normalized.length > 0 ? normalized : undefined;
}

async function promptForValue(
  context: ProviderConfigurePayloadContext,
  input: {
    key: string;
    message: string;
    defaultValue: string;
  }
): Promise<string> {
  const response = await context.prompts({
    name: input.key,
    message: input.message,
    type: "text",
    initial: input.defaultValue,
  });
  const value = response[input.key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing value for ${input.message}.`);
  }
  return normalizeString(value);
}

async function resolveStringField(
  context: ProviderConfigurePayloadContext,
  input: {
    optionKey: string;
    promptKey: string;
    message: string;
    defaultValue: string;
  }
): Promise<string> {
  const configured = readStringOption(context, input.optionKey);
  if (configured !== undefined) {
    return configured;
  }
  if (context.assumeYes) {
    return input.defaultValue;
  }
  return promptForValue(context, {
    key: input.promptKey,
    message: input.message,
    defaultValue: input.defaultValue,
  });
}

async function resolveStringListField(
  context: ProviderConfigurePayloadContext,
  input: {
    optionKey: string;
    promptKey: string;
    message: string;
    defaultValue: string[];
  }
): Promise<string[]> {
  const configured = readStringArrayOption(context, input.optionKey);
  if (configured !== undefined) {
    return configured;
  }
  if (context.assumeYes) {
    return [...input.defaultValue];
  }
  const response = await promptForValue(context, {
    key: input.promptKey,
    message: input.message,
    defaultValue: input.defaultValue.join(", "),
  });
  return splitCommaSeparated(response);
}

async function resolveTinyHttpMcpServerConfig(
  context: ProviderConfigurePayloadContext
): Promise<TinyHttpMcpServerConfigureContext> {
  return {
    name: DEFAULT_CONFIG.name,
    version: DEFAULT_CONFIG.version,
    listen: { ...DEFAULT_CONFIG.listen },
    oauth: {
      resource: await resolveStringField(context, {
        optionKey: "oauthResource",
        promptKey: "oauthResource",
        message: "OAuth protected resource URI",
        defaultValue: DEFAULT_CONFIG.oauth.resource,
      }),
      authorizationServers: await resolveStringListField(context, {
        optionKey: "oauthAuthorizationServer",
        promptKey: "oauthAuthorizationServers",
        message: "OAuth authorization server issuers (comma-separated)",
        defaultValue: DEFAULT_CONFIG.oauth.authorizationServers,
      }),
      scopesSupported: await resolveStringListField(context, {
        optionKey: "oauthSupportedScope",
        promptKey: "oauthSupportedScopes",
        message: "OAuth supported scopes (comma-separated)",
        defaultValue: DEFAULT_CONFIG.oauth.scopesSupported,
      }),
      requiredScopes: await resolveStringListField(context, {
        optionKey: "oauthRequiredScope",
        promptKey: "oauthRequiredScopes",
        message: "OAuth required scopes (comma-separated)",
        defaultValue: DEFAULT_CONFIG.oauth.requiredScopes,
      }),
      bearerMethodsSupported: await resolveStringListField(context, {
        optionKey: "oauthBearerMethod",
        promptKey: "oauthBearerMethods",
        message: "OAuth bearer methods (comma-separated)",
        defaultValue: DEFAULT_CONFIG.oauth.bearerMethodsSupported,
      }),
      verifierModule: await resolveStringField(context, {
        optionKey: "oauthVerifierModule",
        promptKey: "oauthVerifierModule",
        message: "OAuth verifier module path or specifier",
        defaultValue: DEFAULT_CONFIG.oauth.verifierModule,
      }),
      verifierExport: await resolveStringField(context, {
        optionKey: "oauthVerifierExport",
        promptKey: "oauthVerifierExport",
        message: "OAuth verifier export name",
        defaultValue: DEFAULT_CONFIG.oauth.verifierExport,
      }),
    },
  };
}

export const tinyHttpMcpServerService = createProvider<TinyHttpMcpServerConfigureContext>({
  id: "tiny-http-mcp-server",
  name: "tiny-http-mcp-server",
  label: "tiny-http-mcp-server",
  summary: "Scaffold an OAuth-protected tiny-http-mcp-server example.",
  requiresProvider: false,
  async extendConfigurePayload(context) {
    return resolveTinyHttpMcpServerConfig(context);
  },
  manifest: {
    configure: [
      fileMutation.ensureDirectory({ path: SCAFFOLD_DIRECTORY }),
      configMutation.merge({
        target: CONFIG_FILE,
        value: (ctx) => {
          const options = ctx as unknown as TinyHttpMcpServerConfigureContext;
          return {
            name: options.name,
            version: options.version,
            listen: {
              hostname: options.listen.hostname,
              path: options.listen.path,
              port: options.listen.port,
            },
            oauth: {
              resource: options.oauth.resource,
              authorizationServers: options.oauth.authorizationServers,
              scopesSupported: options.oauth.scopesSupported,
              requiredScopes: options.oauth.requiredScopes,
              bearerMethodsSupported: options.oauth.bearerMethodsSupported,
              verifierModule: options.oauth.verifierModule,
              verifierExport: options.oauth.verifierExport,
            },
          };
        },
      }),
      fileMutation.backup({ target: SERVER_FILE }),
      templateMutation.write({
        target: SERVER_FILE,
        templateId: "tiny-http-mcp-server/server.mjs.mustache",
      }),
      fileMutation.backup({ target: VERIFIER_FILE }),
      templateMutation.write({
        target: VERIFIER_FILE,
        templateId: "tiny-http-mcp-server/verify-token.mjs.mustache",
      }),
    ],
    unconfigure: [
      fileMutation.remove({ target: CONFIG_FILE }),
      fileMutation.remove({ target: SERVER_FILE }),
      fileMutation.remove({ target: VERIFIER_FILE }),
      fileMutation.removeDirectory({ path: SCAFFOLD_DIRECTORY }),
    ],
  },
});

export const provider = tinyHttpMcpServerService;
