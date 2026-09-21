import { createHash } from "node:crypto";
import type { OAuthClientProvider } from "mcp-oauth";
import { compileJsonSchema, formatIssues, isJsonValue, type CompileJsonSchemaOptions } from "toolcraft-schema";
import type { Tool } from "tiny-mcp-client";
import { parseRemoteMcpConfiguration, type ConfigurationOptions, type RemoteMcpConfiguration } from "./configuration.js";
import { bindRemoteMcpConfiguration, type ConfigurationBindingOptions } from "./runtime-configuration.js";
import { preflightRemoteMcpServers, resolveRemoteMcpSchemas, type RemoteMcpSchema, type SchemaFetchOptions } from "./schema.js";
import { remoteMcpCommands, type RemoteMcpCommandOptions } from "./commands.js";
import { parseArgumentJson } from "./json-input.js";

export interface RemoteMcpArtifact {
  readonly version: 1;
  readonly configuration: RemoteMcpConfiguration;
  readonly schemas: readonly RemoteMcpSchema[];
  readonly schemaRegistry?: Readonly<Record<string, unknown>>;
  readonly digest: string;
}
export interface ArtifactOptions extends ConfigurationOptions { readonly maxArtifactBytes?: number }
export interface ArtifactGenerationOptions extends ArtifactOptions {
  readonly binding?: ConfigurationBindingOptions;
  readonly schema?: SchemaFetchOptions;
  /** JSON-only external schema documents captured with the artifact. */
  readonly schemaRegistry?: Readonly<Record<string, unknown>>;
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
  schemaRegistry: { type: "object", additionalProperties: { anyOf: [{ type: "object" }, { type: "boolean" }] } },
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

function snapshotRegistry(value: unknown, limit: number): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value) || !isJsonValue(value, { maxNodes: limit }))
    throw new Error("MCP schema registry must contain only bounded JSON documents");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > limit) throw new Error("MCP artifact byte limit exceeded");
  const registry = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  compileJsonSchema(true, { registry });
  return registry;
}

function validateToolSchemas(tools: readonly Tool[], options: CompileJsonSchemaOptions): void {
  for (const tool of tools) {
    compileJsonSchema(tool.inputSchema, options);
    if (tool.outputSchema !== undefined) compileJsonSchema(tool.outputSchema, options);
  }
}

/** Discover only absent schemas and produce deterministic, credential-free artifacts. */
export async function generateRemoteMcpArtifact(value: unknown, options: ArtifactGenerationOptions = {}): Promise<GeneratedRemoteMcpArtifact> {
  options = { ...options, ...(options.schema === undefined ? {} : { schema: { ...options.schema } }) };
  const limit = artifactLimit(options);
  options.schema?.signal?.throwIfAborted();
  const schemaRegistry = snapshotRegistry(options.schemaRegistry, limit);
  const configuration = parseRemoteMcpConfiguration(value, options);
  for (const server of configuration.servers) validateToolSchemas(server.tools ?? [], { registry: schemaRegistry });
  const absent = configuration.servers.filter(server => server.tools === undefined);
  const credentials = new Set<string>();
  const captureEnvironmentCredentials = (): void => {
    for (const server of absent) {
      const refs = [...Object.values(server.headers ?? {}), ...(server.auth?.type === "bearer" ? [server.auth.token] : server.auth?.type === "oauth"
        ? [server.auth.credentials.clientId, server.auth.credentials.clientSecret, server.auth.credentials.accessToken, server.auth.credentials.refreshToken] : [])];
      for (const reference of refs) {
        const descriptor = Object.getOwnPropertyDescriptor(options.binding?.env ?? {}, reference.env);
        const value: unknown = descriptor?.value;
        if (typeof value === "string" && value.trim() !== "") { credentials.add(value); credentials.add(value.trim()); }
      }
    }
  };
  captureEnvironmentCredentials();
  const bound = absent.length === 0 ? [] : bindRemoteMcpConfiguration({ version: 1, servers: absent }, options.binding ?? { env: {} });
  // Host callbacks may change later environment inputs; retain both generations.
  captureEnvironmentCredentials();
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
  if (credentials.size > 0) { assertNoCredential(schemas); assertNoCredential(schemaRegistry); }
  for (const schema of schemas) validateToolSchemas(schema.tools, { registry: schemaRegistry });
  options.schema?.signal?.throwIfAborted();
  const resolved = new Map(schemas.map(schema => [schema.name, schema]));
  const payload = { version: 1 as const, configuration: { version: 1 as const, servers: configuration.servers.map(server => ({ ...server, tools: resolved.get(server.name)!.tools,
    ...(resolved.get(server.name)!.instructions === undefined ? {} : { instructions: resolved.get(server.name)!.instructions }) })).sort(compareName) }, schemas,
    ...(schemaRegistry === undefined ? {} : { schemaRegistry }) };
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
  const registry = snapshotRegistry(artifact.schemaRegistry, limit);
  if (registry !== undefined) for (const schema of artifact.schemas) validateToolSchemas(schema.tools, { registry });
  const configuration = parseRemoteMcpConfiguration(artifact.configuration, options);
  preflightRemoteMcpServers(artifact.schemas, options);
  if (configuration.servers.length !== artifact.schemas.length) throw new Error("MCP artifact schema/configuration mismatch");
  const schemas = new Map(artifact.schemas.map(schema => [schema.name, schema]));
  for (const server of configuration.servers) {
    const schema = schemas.get(server.name);
    if (server.tools === undefined || schema === undefined || schema.url !== server.url || canonicalJson(schema.tools) !== canonicalJson(server.tools) ||
      (server.instructions !== undefined && server.instructions !== schema.instructions))
      throw new Error("MCP artifact schema/configuration mismatch");
  }
  return JSON.parse(canonicalJson(artifact)) as RemoteMcpArtifact;
}

/** Prepare an artifact's commands without rediscovery, using explicit runtime credentials. */
export async function remoteMcpArtifactPlugin(value: unknown, options: ArtifactPluginOptions): Promise<Awaited<ReturnType<typeof remoteMcpCommands>>> {
  options.commands?.signal?.throwIfAborted();
  const artifact = parseRemoteMcpArtifact(value, options);
  const registry = snapshotRegistry(options.commands?.schemaValidation?.registry, artifactLimit(options)) ?? {};
  if (artifact.schemaRegistry !== undefined) for (const [uri, document] of Object.entries(registry)) {
    if (!Object.hasOwn(artifact.schemaRegistry, uri) || canonicalJson(artifact.schemaRegistry[uri]) !== canonicalJson(document))
      throw new Error("MCP artifact schema registry conflict");
  }
  for (const [uri, document] of Object.entries(artifact.schemaRegistry ?? {})) {
    Object.defineProperty(registry, uri, { value: document, enumerable: true, configurable: true, writable: true });
  }
  const schemaValidation = { ...options.commands?.schemaValidation, registry };
  for (const schema of artifact.schemas) validateToolSchemas(schema.tools, schemaValidation);
  const instructions = new Map(artifact.schemas.map(schema => [schema.name, schema.instructions]));
  const servers = bindRemoteMcpConfiguration(artifact.configuration, options.binding).map(server => ({ ...server,
    ...(instructions.get(server.name) === undefined ? {} : { instructions: instructions.get(server.name) }) }));
  return remoteMcpCommands(servers, { ...options.commands, schemaValidation });
}
