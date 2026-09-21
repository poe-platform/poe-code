import type { RemoteMcpServer } from "./schema.js";
import type { OAuthTokenEndpointAuthMethod } from "mcp-oauth";
import { preflightRemoteMcpServers } from "./schema.js";
import { compileJsonSchema, formatIssues, isJsonValue } from "toolcraft-schema";
import { parseArgumentJson } from "./json-input.js";
import { validateCommandName } from "./commands.js";

export interface EnvironmentReference { readonly env: string }
export interface PublicEnvironmentReference extends EnvironmentReference { readonly fallback?: string }
export interface OAuthCredentialReferences {
  readonly clientId: EnvironmentReference;
  readonly clientSecret: EnvironmentReference;
  readonly scope: PublicEnvironmentReference;
  readonly redirectUri: PublicEnvironmentReference;
  readonly accessToken: EnvironmentReference;
  readonly refreshToken: EnvironmentReference;
  readonly expiresAt: EnvironmentReference;
  readonly expiresIn?: EnvironmentReference;
  readonly issuedAt?: EnvironmentReference;
}
export type RemoteMcpAuthenticationConfiguration =
  | { readonly type: "bearer"; readonly token: EnvironmentReference }
  | { readonly type: "oauth"; readonly clientMode: "static" | "dynamic"; readonly persistenceNamespace?: string;
      readonly tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod; readonly credentials: OAuthCredentialReferences };
export interface RemoteMcpServerConfiguration extends Omit<RemoteMcpServer, "headers" | "oauth"> {
  readonly headers?: Readonly<Record<string, EnvironmentReference>>;
  readonly auth?: RemoteMcpAuthenticationConfiguration;
}
export interface RemoteMcpConfiguration {
  readonly version: 1;
  readonly servers: readonly RemoteMcpServerConfiguration[];
}
export interface InitRemoteMcpServer extends Omit<RemoteMcpServerConfiguration, "auth"> {
  readonly auth?:
    | { readonly type: "bearer"; readonly env?: string }
    | { readonly type: "oauth"; readonly clientMode: "static" | "dynamic";
        readonly persistenceNamespace?: string;
        readonly tokenEndpointAuthMethod?: OAuthTokenEndpointAuthMethod;
        readonly env?: Partial<Record<keyof OAuthCredentialReferences, string>>;
        readonly scope?: string; readonly redirectUri?: string };
}
export interface ConfigurationOptions {
  readonly maxConfigurationBytes?: number;
  readonly maxTools?: number;
}
export interface RemoteMcpInitialization {
  readonly configuration: RemoteMcpConfiguration;
  readonly envTemplate: string;
}

const credentialFields = {
  clientId: { suffix: "CLIENT_ID", description: "OAuth app/client ID; required for static registration." },
  clientSecret: { suffix: "CLIENT_SECRET", description: "OAuth app/client secret, if required by the app." },
  scope: { suffix: "SCOPE", description: "Requested OAuth scopes, separated by spaces; overrides the public fallback." },
  redirectUri: { suffix: "REDIRECT_URI", description: "Exact registered callback URL; overrides the public fallback. Empty uses a random loopback port." },
  accessToken: { suffix: "ACCESS_TOKEN", description: "OAuth access token, if importing an existing grant." },
  refreshToken: { suffix: "REFRESH_TOKEN", description: "OAuth refresh token, if importing an existing grant." },
  expiresAt: { suffix: "EXPIRES_AT", description: "Access-token expiry in Unix epoch milliseconds; overrides relative lifetime. Leave empty if unknown." },
  expiresIn: { suffix: "EXPIRES_IN", description: "Optional access-token lifetime in seconds; means remaining lifetime at import unless ISSUED_AT is supplied.", optional: true },
  issuedAt: { suffix: "ISSUED_AT", description: "Optional original issuance time in Unix epoch milliseconds for a delayed relative-lifetime import.", optional: true }
} as const;
const referenceSchema = { type: "object", properties: { env: { type: "string" } }, required: ["env"], additionalProperties: false };
const publicReferenceSchema = { ...referenceSchema, properties: { ...referenceSchema.properties, fallback: { type: "string" } } };
const oauthCredentialSchemas = Object.fromEntries(Object.keys(credentialFields).map(key => [key,
  key === "scope" || key === "redirectUri" ? publicReferenceSchema : referenceSchema]));
const oauthShape = { type: "object", properties: { type: { const: "oauth" }, clientMode: { enum: ["static", "dynamic"] }, persistenceNamespace: { type: "string", minLength: 1, maxLength: 1024 },
  tokenEndpointAuthMethod: { enum: ["none", "client_secret_post", "client_secret_basic"] } }, required: ["type", "clientMode"], additionalProperties: false };
const commonServerProperties = {
  name: { type: "string" }, url: { type: "string" }, transport: { enum: ["http", "sse"] }, protocolVersion: { enum: ["2025-03-26", "2026-07-28"] },
  tools: { type: "array", items: { type: "object" } }, instructions: { type: "string" }, headers: { type: "object", additionalProperties: referenceSchema }
};
function authenticationSchema(bearer: unknown, oauth: unknown) {
  return { if: { properties: { type: { const: "bearer" } }, required: ["type"] }, then: bearer, else: oauth };
}

const finalServerSchema = { type: "object", properties: { ...commonServerProperties, auth: authenticationSchema(
  { type: "object", properties: { type: { const: "bearer" }, token: referenceSchema }, required: ["type", "token"], additionalProperties: false },
  { ...oauthShape, properties: { ...oauthShape.properties, credentials: { type: "object", properties: oauthCredentialSchemas,
    required: Object.entries(credentialFields).filter(([, field]) => !("optional" in field)).map(([key]) => key), additionalProperties: false } }, required: [...oauthShape.required, "credentials"] }
) }, required: ["name", "url"], additionalProperties: false };
const configurationValidator = compileJsonSchema({ type: "object", properties: { version: { const: 1 }, servers: { type: "array", items: finalServerSchema } },
  required: ["version", "servers"], additionalProperties: false });
const initValidator = compileJsonSchema({ type: "array", items: { ...finalServerSchema, properties: { ...commonServerProperties, auth: authenticationSchema(
  { type: "object", properties: { type: { const: "bearer" }, env: { type: "string" } }, required: ["type"], additionalProperties: false },
  { ...oauthShape, properties: { ...oauthShape.properties, scope: { type: "string" }, redirectUri: { type: "string" }, env: {
    type: "object", properties: Object.fromEntries(Object.keys(credentialFields).map(key => [key, { type: "string" }])), additionalProperties: false
  } } }
) } } });

function configurationData(value: unknown, options: ConfigurationOptions): unknown {
  const limit = options.maxConfigurationBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("maxConfigurationBytes must be a positive safe integer");
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > limit) throw new Error("MCP configuration byte limit exceeded");
    value = parseArgumentJson(value);
  }
  if (!isJsonValue(value, { maxNodes: limit })) throw new Error("MCP configuration must contain only JSON data within the configuration byte limit and depth limit");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > limit) throw new Error("MCP configuration byte limit exceeded");
  return structuredClone(value);
}

function assertEnvironment(name: string): void {
  const letter = (char: string): boolean => (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "_";
  if (!name || !letter(name[0]) || [...name].some(char => !letter(char) && !(char >= "0" && char <= "9")))
    throw new Error("Invalid environment variable name in MCP configuration");
}

function stem(name: string): string {
  let result = "";
  for (const char of name.toUpperCase()) {
    if ((char >= "A" && char <= "Z") || (char >= "0" && char <= "9")) result += char;
    else if (result && !result.endsWith("_")) result += "_";
  }
  return (result.endsWith("_") ? result.slice(0, -1) : result) || "SERVER";
}

function validateRegistry(servers: readonly RemoteMcpServerConfiguration[], options: ConfigurationOptions): void {
  for (const server of servers) validateCommandName(server.name);
  preflightRemoteMcpServers(servers.map(({ headers: _headers, auth: _auth, ...server }) => server), options);
}

/** Parse a versioned JSON-only configuration without reading credentials or connecting. */
export function parseRemoteMcpConfiguration(value: unknown, options: ConfigurationOptions = {}): RemoteMcpConfiguration {
  const data = configurationData(value, options);
  const validation = configurationValidator.validate(data);
  if (!validation.ok) throw new Error(`Invalid MCP configuration: ${formatIssues(validation.issues)}`);
  const configuration = data as RemoteMcpConfiguration;
  validateRegistry(configuration.servers, options);
  for (const server of configuration.servers) {
    const headerNames = new Set<string>();
    for (const [name, reference] of Object.entries(server.headers ?? {})) {
      new Headers({ [name]: "validation" });
      const normalized = name.toLowerCase();
      if (headerNames.has(normalized)) throw new Error(`Duplicate HTTP header '${name}' in MCP configuration`);
      if (normalized === "authorization" && server.auth !== undefined)
        throw new Error("Authorization headers cannot be combined with managed MCP authentication");
      headerNames.add(normalized);
      assertEnvironment(reference.env);
    }
    if (server.auth?.type === "bearer") assertEnvironment(server.auth.token.env);
    if (server.auth?.type === "oauth") {
      const namespace = server.auth.persistenceNamespace;
      if (namespace !== undefined && (namespace.trim() === "" || Buffer.byteLength(namespace, "utf8") > 1024))
        throw new Error("OAuth persistence namespace must be a nonempty string within 1024 bytes");
      for (const reference of Object.values(server.auth.credentials)) assertEnvironment(reference.env);
    }
  }
  return configuration;
}

/** Produce declarative credential references and empty dotenv entries, with no network or secret reads. */
export function initRemoteMcpConfiguration(servers: readonly InitRemoteMcpServer[], options: ConfigurationOptions = {}): RemoteMcpInitialization {
  const data = configurationData(servers, options);
  const validation = initValidator.validate(data);
  if (!validation.ok) throw new Error(`Invalid MCP initialization: ${formatIssues(validation.issues)}`);
  const inputs = data as readonly InitRemoteMcpServer[];
  validateRegistry(inputs.map(({ auth: _auth, ...server }) => server), options);
  const explicit = new Set<string>();
  for (const server of inputs) {
    for (const reference of Object.values(server.headers ?? {})) explicit.add(reference.env);
    if (server.auth?.type === "bearer" && server.auth.env !== undefined) explicit.add(server.auth.env);
    if (server.auth?.type === "oauth") for (const env of Object.values(server.auth.env ?? {})) explicit.add(env);
  }
  for (const name of explicit) assertEnvironment(name);
  const natural = new Set(inputs.map(server => stem(server.name)));
  const prefixes = new Map<string, string>();
  const used = new Set(explicit);
  for (const server of [...inputs].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const base = stem(server.name);
    let prefix = base;
    const fields = server.auth?.type === "oauth" ? Object.keys(credentialFields) as (keyof OAuthCredentialReferences)[] : ["accessToken"] as const;
    for (let suffix = 2; (prefix !== base && natural.has(prefix)) || fields.some(field => used.has(`MCP_${prefix}_${credentialFields[field].suffix}`)); suffix++) prefix = `${base}_${suffix}`;
    prefixes.set(server.name, `MCP_${prefix}`);
    for (const field of fields) used.add(`MCP_${prefix}_${credentialFields[field].suffix}`);
  }
  const descriptions = new Map<string, Set<string>>();
  const describe = (reference: EnvironmentReference, description: string): void => {
    const entries = descriptions.get(reference.env) ?? new Set<string>();
    entries.add(description); descriptions.set(reference.env, entries);
  };
  const configured = inputs.map(({ auth, ...server }): RemoteMcpServerConfiguration => {
    for (const [header, reference] of Object.entries(server.headers ?? {})) describe(reference, `HTTP header ${JSON.stringify(header)}.`);
    if (auth === undefined) return server;
    if (auth.type === "bearer") {
      const token = { env: auth.env ?? `${prefixes.get(server.name)!}_ACCESS_TOKEN` };
      describe(token, "Bearer access token; required for this server.");
      return { ...server, auth: { type: "bearer", token } };
    }
    const credentials = Object.fromEntries((Object.keys(credentialFields) as (keyof OAuthCredentialReferences)[]).map(field => {
      const reference: PublicEnvironmentReference = { env: auth.env?.[field] ?? `${prefixes.get(server.name)!}_${credentialFields[field].suffix}`,
        ...(field === "scope" && auth.scope !== undefined ? { fallback: auth.scope } : {}),
        ...(field === "redirectUri" && auth.redirectUri !== undefined ? { fallback: auth.redirectUri } : {}) };
      describe(reference, credentialFields[field].description);
      return [field, reference];
    })) as unknown as OAuthCredentialReferences;
    return { ...server, auth: { type: "oauth", clientMode: auth.clientMode,
      ...(auth.tokenEndpointAuthMethod === undefined ? {} : { tokenEndpointAuthMethod: auth.tokenEndpointAuthMethod }),
      ...(auth.persistenceNamespace === undefined ? {} : { persistenceNamespace: auth.persistenceNamespace }), credentials } };
  });
  const configuration = parseRemoteMcpConfiguration({ version: 1, servers: configured }, options);
  const envTemplate = [...descriptions].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, entries]) => `${[...entries].map(description => `# ${description}`).join("\n")}\n${name}=\n`).join("\n");
  if (Buffer.byteLength(envTemplate, "utf8") > (options.maxConfigurationBytes ?? 16 * 1024 * 1024)) throw new Error("MCP environment template byte limit exceeded");
  return { configuration, envTemplate };
}
