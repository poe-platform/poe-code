import { createHash } from "node:crypto";
import type { OAuthClientProvider } from "mcp-oauth";
import { compileJsonSchema, formatIssues, isJsonValue } from "toolcraft-schema";
import { parseRemoteMcpConfiguration, type ConfigurationOptions, type RemoteMcpConfiguration } from "./configuration.js";
import { bindRemoteMcpConfiguration, type ConfigurationBindingOptions } from "./runtime-configuration.js";
import { preflightRemoteMcpServers, resolveRemoteMcpSchemas, type RemoteMcpSchema, type SchemaFetchOptions } from "./schema.js";
import { remoteMcpCommands, type RemoteMcpCommandOptions } from "./commands.js";
import { parseArgumentJson } from "./json-input.js";

export interface RemoteMcpArtifact {
  readonly version: 1;
  readonly configuration: RemoteMcpConfiguration;
  readonly schemas: readonly RemoteMcpSchema[];
  readonly digest: string;
}
export interface ArtifactOptions extends ConfigurationOptions { readonly maxArtifactBytes?: number }
export interface ArtifactGenerationOptions extends ArtifactOptions {
  readonly binding?: ConfigurationBindingOptions;
  readonly schema?: SchemaFetchOptions;
}
export interface GeneratedRemoteMcpArtifact {
  readonly artifact: RemoteMcpArtifact;
  readonly json: string;
  /** Dependency-free ESM data module exporting the artifact as default. */
  readonly module: string;
}
export interface ArtifactPluginOptions extends ArtifactOptions {
  readonly binding: ConfigurationBindingOptions;
  readonly commands?: RemoteMcpCommandOptions;
}

const artifactValidator = compileJsonSchema({ type: "object", properties: {
  version: { const: 1 }, configuration: { type: "object" }, digest: { type: "string" },
  schemas: { type: "array", items: { type: "object", properties: {
    name: { type: "string" }, url: { type: "string" }, source: { enum: ["provided", "discovered"] },
    tools: { type: "array", items: { type: "object" } },
    serverInfo: { type: "object", properties: { name: { type: "string" }, version: { type: "string" } }, required: ["name", "version"] },
    capabilities: { type: "object" }, instructions: { type: "string" }
  }, required: ["name", "url", "source", "tools"], additionalProperties: false } }
}, required: ["version", "configuration", "schemas", "digest"], additionalProperties: false });

function canonicalJson(value: unknown): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted((value as Record<string, unknown>)[key])]));
    return value;
  };
  return JSON.stringify(sorted(value));
}
function artifactLimit(options: ArtifactOptions): number {
  const limit = options.maxArtifactBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("maxArtifactBytes must be a positive safe integer");
  return limit;
}
function compareName(a: { readonly name: string }, b: { readonly name: string }): number { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
function digestPayload(value: unknown): string { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }

/** Discover only absent schemas and produce deterministic, credential-free artifacts. */
export async function generateRemoteMcpArtifact(value: unknown, options: ArtifactGenerationOptions = {}): Promise<GeneratedRemoteMcpArtifact> {
  const limit = artifactLimit(options);
  options.schema?.signal?.throwIfAborted();
  const configuration = parseRemoteMcpConfiguration(value, options);
  const absent = configuration.servers.filter(server => server.tools === undefined);
  const bound = absent.length === 0 ? [] : bindRemoteMcpConfiguration({ version: 1, servers: absent }, options.binding ?? { env: {} });
  const credentials = new Set<string>();
  for (const server of absent) {
    const refs = [...Object.values(server.headers ?? {}), ...(server.auth?.type === "bearer" ? [server.auth.token] : server.auth?.type === "oauth"
      ? [server.auth.credentials.clientId, server.auth.credentials.clientSecret, server.auth.credentials.accessToken, server.auth.credentials.refreshToken] : [])];
    for (const reference of refs) {
      const descriptor = Object.getOwnPropertyDescriptor(options.binding?.env ?? {}, reference.env);
      const value = descriptor?.value as string | undefined;
      if (value !== undefined && value.trim() !== "") { credentials.add(value); credentials.add(value.trim()); }
    }
  }
  const runtime = new Map(bound.map(server => {
    const provider = server.oauth?.provider;
    if (provider === undefined) return [server.name, server] as const;
    const guarded: OAuthClientProvider = { ...provider, async authorizeRequest(input) {
      const grant = await provider.authorizeRequest?.(input);
      const authorization = input.headers.get("Authorization");
      if (authorization !== null && authorization !== "") credentials.add(authorization);
      if (grant !== undefined) {
        credentials.add(grant.accessToken);
        if (grant.refreshToken !== undefined) credentials.add(grant.refreshToken);
      }
      return grant;
    } };
    return [server.name, { ...server, oauth: { provider: guarded } }] as const;
  }));
  const servers = configuration.servers.map(({ headers: _headers, auth: _auth, ...server }) => runtime.get(server.name) ?? server);
  const schemas = (await resolveRemoteMcpSchemas(servers, options.schema)).map(schema => ({ ...schema, tools: [...schema.tools].sort(compareName) })).sort(compareName);
  const assertNoCredential = (value: unknown): void => {
    if (typeof value === "string" && [...credentials].some(credential => value.includes(credential)))
      throw new Error("MCP discovery metadata contains a resolved credential; refusing to generate an artifact");
    if (Array.isArray(value)) for (const item of value) assertNoCredential(item);
    else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) { assertNoCredential(key); assertNoCredential(item); }
  };
  if (credentials.size > 0) assertNoCredential(schemas);
  options.schema?.signal?.throwIfAborted();
  const tools = new Map(schemas.map(schema => [schema.name, schema.tools]));
  const payload = { version: 1 as const, configuration: { version: 1 as const, servers: configuration.servers.map(server => ({ ...server, tools: tools.get(server.name)! })).sort(compareName) }, schemas };
  // Revalidate discovered tool data before writing it into declarative configuration.
  parseRemoteMcpConfiguration(payload.configuration, options);
  const artifact = JSON.parse(canonicalJson({ ...payload, digest: digestPayload(payload) })) as RemoteMcpArtifact;
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  const module = `// Generated remote MCP schema artifact. Credentials are resolved by the host.\nexport default JSON.parse(${JSON.stringify(canonicalJson(artifact))});\n`;
  if (Buffer.byteLength(json, "utf8") > limit || Buffer.byteLength(module, "utf8") > limit) throw new Error("MCP artifact byte limit exceeded");
  return { artifact, json, module };
}

/** Validate bounded JSON, integrity and snapshot/configuration agreement before runtime binding. */
export function parseRemoteMcpArtifact(value: unknown, options: ArtifactOptions = {}): RemoteMcpArtifact {
  const limit = artifactLimit(options);
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > limit) throw new Error("MCP artifact byte limit exceeded");
    value = parseArgumentJson(value);
  }
  if (!isJsonValue(value, { maxNodes: limit }) || Buffer.byteLength(JSON.stringify(value), "utf8") > limit)
    throw new Error("MCP artifact byte limit or JSON data limit exceeded");
  const validation = artifactValidator.validate(value);
  if (!validation.ok) throw new Error(`Invalid MCP artifact: ${formatIssues(validation.issues)}`);
  const artifact = value as unknown as RemoteMcpArtifact;
  const { digest, ...payload } = artifact;
  if (digestPayload(payload) !== digest) throw new Error("MCP artifact digest does not match its contents");
  const configuration = parseRemoteMcpConfiguration(artifact.configuration, options);
  preflightRemoteMcpServers(artifact.schemas, options);
  if (configuration.servers.length !== artifact.schemas.length) throw new Error("MCP artifact schema/configuration mismatch");
  const schemas = new Map(artifact.schemas.map(schema => [schema.name, schema]));
  for (const server of configuration.servers) {
    const schema = schemas.get(server.name);
    if (server.tools === undefined || schema === undefined || schema.url !== server.url || canonicalJson(schema.tools) !== canonicalJson(server.tools))
      throw new Error("MCP artifact schema/configuration mismatch");
  }
  return JSON.parse(canonicalJson(artifact)) as RemoteMcpArtifact;
}

/** Prepare an artifact's commands without rediscovery, using explicit runtime credentials. */
export async function remoteMcpArtifactPlugin(value: unknown, options: ArtifactPluginOptions): Promise<Awaited<ReturnType<typeof remoteMcpCommands>>> {
  options.commands?.signal?.throwIfAborted();
  const artifact = parseRemoteMcpArtifact(value, options);
  const servers = bindRemoteMcpConfiguration(artifact.configuration, options.binding);
  return remoteMcpCommands(servers, options.commands);
}
