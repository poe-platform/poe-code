import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createLogger } from "toolcraft-design";
import type { McpServerConfig } from "@poe-code/agent-mcp-config";
import { HttpTransport, McpClient, StdioTransport } from "tiny-mcp-client";
import type { Tool as ClientTool } from "tiny-mcp-client";
import type { Command, Group, Scope } from "./index.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { convertJsonSchema } from "./json-schema-converter.js";
import { findProjectRoot } from "./project-root.js";
import type { ObjectSchema } from "toolcraft-schema";

export { findProjectRoot } from "./project-root.js";

const GROUP_CONFIG_SYMBOL_DESCRIPTION = "toolcraft.group.config";
const MCP_PROXY_SCHEMA_URL =
  "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json";
const DEFAULT_CLIENT_INFO = {
  name: "toolcraft",
  version: "0.0.1",
} as const;
const proxyNodeSymbol = Symbol("toolcraft.mcpProxyNode");
const proxyConnectionSymbol = Symbol("toolcraft.mcpProxyConnection");
const shutdownDisposers = new Set<() => Promise<void>>();

interface InternalGroupConfig<TServices extends object = Record<string, never>> {
  mcp?: McpServerConfig;
  tools?: string[];
  rename?: Record<string, string>;
  children?: Array<Command<TServices, any, any, any> | Group<TServices>>;
}

interface HotProxyConnection {
  client?: McpClient;
  connecting?: Promise<McpClient>;
  config: McpServerConfig;
  dispose: () => Promise<void>;
  name: string;
}

interface McpProxyCache {
  $schema: string;
  fetchedAt: string;
  tools: Tool[];
  upstream: {
    name: string;
    version: string;
  };
  configFingerprint?: string;
  version: 1;
}

export interface ResolveMcpProxyOptions {
  projectRoot?: string;
}

type Tool = ClientTool & { title?: string };

type GroupChild<TServices extends object = Record<string, never>> =
  | Command<TServices, any, any, any>
  | Group<TServices>;

function getInternalGroupConfig<TServices extends object>(
  group: Group<TServices>
): InternalGroupConfig<TServices> {
  const symbol = Object.getOwnPropertySymbols(group).find(
    (candidate) => candidate.description === GROUP_CONFIG_SYMBOL_DESCRIPTION
  );

  if (symbol === undefined) {
    return {};
  }

  return (((group as unknown) as Record<PropertyKey, unknown>)[symbol] ??
    {}) as InternalGroupConfig<TServices>;
}

function isProxyNode(node: GroupChild<any>): boolean {
  return (node as GroupChild<any> & { [proxyNodeSymbol]?: true })[proxyNodeSymbol] === true;
}

function markProxyNode<TNode extends GroupChild<any>>(node: TNode): TNode {
  Object.defineProperty(node, proxyNodeSymbol, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });

  return node;
}

function cloneSecrets(secrets: Record<string, { env: string; description?: string; optional?: boolean }>) {
  return { ...secrets };
}

function cloneScope(scope: Scope[] | undefined): Scope[] | undefined {
  return scope === undefined ? undefined : [...scope];
}

function registerShutdownDispose(dispose: () => Promise<void>): void {
  shutdownDisposers.add(dispose);
}

function getProxyConnection(group: Group<any>): HotProxyConnection | undefined {
  return (group as Group<any> & {
    [proxyConnectionSymbol]?: HotProxyConnection;
  })[proxyConnectionSymbol];
}

function setProxyConnection(
  group: Group<any>,
  connection: HotProxyConnection | undefined
): void {
  (group as Group<any> & {
    [proxyConnectionSymbol]?: HotProxyConnection;
  })[proxyConnectionSymbol] = connection;
}

function createProxyGroup(
  parent: Group<any>,
  name: string
): Group<any> {
  return markProxyNode<Group<any>>({
    kind: "group",
    name,
    description: undefined,
    aliases: [],
    scope: cloneScope(parent.scope),
    secrets: cloneSecrets(parent.secrets),
    requires: parent.requires,
    children: [],
    default: undefined,
  });
}

function createProxyCommand(
  parent: Group<any>,
  tool: Tool,
  commandName: string,
  connection: HotProxyConnection
): Command<any, ObjectSchema<any>, undefined, unknown> {
  const params = convertJsonSchema(tool.inputSchema as Parameters<typeof convertJsonSchema>[0]);

  if (params.kind !== "object") {
    throw new Error(`upstream tool "${tool.name}" must define an object input schema`);
  }
  const result = tool.outputSchema === undefined
    ? undefined
    : convertJsonSchema(tool.outputSchema as Parameters<typeof convertJsonSchema>[0]);

  if (result !== undefined && result.kind !== "object") {
    throw new Error(`upstream tool "${tool.name}" must define an object output schema`);
  }

  return markProxyNode({
    kind: "command",
    name: commandName,
    title: tool.title,
    description: tool.description,
    annotations: tool.annotations === undefined ? undefined : { ...tool.annotations },
    hidden: false,
    examples: [],
    aliases: [],
    positional: [],
    params,
    ...(result === undefined ? {} : { result }),
    secrets: cloneSecrets(parent.secrets),
    scope: cloneScope(parent.scope) ?? (["cli", "sdk"] satisfies Scope[]),
    confirm: false,
    requires: parent.requires,
    handler: async (ctx) => {
      const client = await ensureConnected(connection);
      const toolResult = await client.callTool({
        name: tool.name,
        arguments: ctx.params as Record<string, unknown>,
      });
      if (result === undefined) {
        return toolResult;
      }
      if (toolResult.structuredContent === undefined) {
        throw new Error(
          `upstream tool "${tool.name}" declared outputSchema but returned no structuredContent`
        );
      }
      return toolResult.structuredContent;
    },
    render: undefined,
  });
}

function removeProxyChildren(group: Group<any>): void {
  group.children = group.children.filter((child) => !isProxyNode(child));

  for (const child of group.children) {
    if (child.kind === "group") {
      removeProxyChildren(child);
    }
  }
}

function findChild(group: Group<any>, name: string): GroupChild<any> | undefined {
  return group.children.find((child) => child.name === name);
}

function filterAllowlistedTools(tools: Tool[], allowlist: string[] | undefined): Tool[] {
  if (allowlist === undefined) {
    return tools;
  }

  const allowedNames = new Set(allowlist);
  return tools.filter((tool) => allowedNames.has(tool.name));
}

function validateRenameMap(name: string, tools: Tool[], rename: Record<string, string> | undefined): void {
  if (rename === undefined) {
    return;
  }

  const toolNames = new Set(tools.map((tool) => tool.name));

  for (const upstreamToolName of Object.keys(rename)) {
    if (!toolNames.has(upstreamToolName)) {
      throw new Error(
        `couldn't discover MCP ${name}: rename references unknown upstream tool "${upstreamToolName}"`
      );
    }
  }
}

function createConnection(name: string, config: McpServerConfig): HotProxyConnection {
  const connection: HotProxyConnection = {
    name,
    config,
    async dispose(): Promise<void> {
      shutdownDisposers.delete(connection.dispose);
      connection.connecting = undefined;

      if (connection.client === undefined) {
        return;
      }

      const client = connection.client;
      connection.client = undefined;
      await client.close();
    },
  };

  registerShutdownDispose(connection.dispose);
  return connection;
}

async function ensureConnected(connection: HotProxyConnection): Promise<McpClient> {
  if (connection.client !== undefined && connection.client.state === "ready") {
    return connection.client;
  }

  if (connection.connecting !== undefined) {
    return connection.connecting;
  }

  connection.connecting = dialUpstream(connection.name, connection.config)
    .then((client) => {
      connection.client = client;
      return client;
    })
    .finally(() => {
      connection.connecting = undefined;
    });

  return connection.connecting;
}

async function readCache(cachePath: string): Promise<McpProxyCache | undefined> {
  try {
    await assertCachePathHasNoSymlinks(cachePath);
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<McpProxyCache>;

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.tools) ||
      parsed.upstream === undefined ||
      typeof parsed.upstream.name !== "string" ||
      typeof parsed.upstream.version !== "string"
    ) {
      return undefined;
    }

    return {
      $schema: typeof parsed.$schema === "string" ? parsed.$schema : MCP_PROXY_SCHEMA_URL,
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : new Date(0).toISOString(),
      tools: parsed.tools,
      upstream: parsed.upstream,
      configFingerprint:
        typeof parsed.configFingerprint === "string" ? parsed.configFingerprint : undefined,
      version: parsed.version === 1 ? 1 : 1,
    };
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT") || error instanceof SyntaxError) {
      return undefined;
    }

    return undefined;
  }
}

async function writeCache(cachePath: string, cache: McpProxyCache): Promise<void> {
  const directory = path.dirname(cachePath);
  const tempPath = `${cachePath}.tmp-${randomUUID()}`;
  let tempCreated = false;

  await assertCachePathHasNoSymlinks(cachePath);
  await assertCachePathHasNoSymlinks(tempPath);
  await mkdir(directory, { recursive: true });
  await assertCachePathHasNoSymlinks(directory);

  try {
    await writeFile(tempPath, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    tempCreated = true;
    await assertCachePathHasNoSymlinks(tempPath);
    await assertCachePathHasNoSymlinks(cachePath);
    await rename(tempPath, cachePath);
    tempCreated = false;
  } catch (error) {
    if (tempCreated || !isAlreadyExistsError(error)) {
      await unlink(tempPath).catch(() => undefined);
    }

    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

async function fetchCache(
  name: string,
  config: McpServerConfig
): Promise<McpProxyCache> {
  const logger = createLogger((message) => {
    process.stderr.write(`${message}\n`);
  });
  logger.info(`MCP ${name}: connecting`);
  const client = await dialUpstream(name, config);

  try {
    logger.info(`MCP ${name}: listing tools`);

    const tools: Tool[] = [];
    let cursor: string | undefined;

    do {
      const page = await client.listTools(cursor === undefined ? {} : { cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    logger.info(`MCP ${name}: found ${tools.length} tools`);

    const upstream = client.serverInfo ?? {
      name,
      version: "unknown",
    };
    const cache: McpProxyCache = {
      $schema: MCP_PROXY_SCHEMA_URL,
      version: 1,
      upstream,
      configFingerprint: fingerprintMcpServerConfig(config),
      fetchedAt: new Date().toISOString(),
      tools,
    };

    return cache;
  } finally {
    await client.close();
  }
}

function populateGroupFromTools(
  group: Group<any>,
  tools: Tool[],
  rename: Record<string, string> | undefined,
  connection: HotProxyConnection
): void {
  removeProxyChildren(group);

  for (const tool of tools) {
    const targetPath = rename?.[tool.name] ?? tool.name;
    const segments =
      rename !== undefined && Object.prototype.hasOwnProperty.call(rename, tool.name)
        ? targetPath.split(".")
        : [tool.name];
    const commandName = segments[segments.length - 1];

    if (commandName === undefined || commandName.length === 0) {
      throw new Error(`command path "${targetPath}" collides with an existing child`);
    }

    let parent = group;

    for (const segment of segments.slice(0, -1)) {
      const existing = findChild(parent, segment);

      if (existing === undefined) {
        const created = createProxyGroup(parent, segment);
        parent.children.push(created);
        parent = created;
        continue;
      }

      if (existing.kind !== "group") {
        throw new Error(`command path "${targetPath}" collides with an existing child`);
      }

      parent = existing;
    }

    if (findChild(parent, commandName) !== undefined) {
      throw new Error(`command path "${targetPath}" collides with an existing child`);
    }

    parent.children.push(createProxyCommand(parent, tool, commandName, connection));
  }
}

function replaceProxyChildrenSafely(
  group: Group<any>,
  tools: Tool[],
  rename: Record<string, string> | undefined,
  connection: HotProxyConnection
): void {
  const previousChildren = snapshotGroupChildren(group);
  try {
    populateGroupFromTools(group, tools, rename, connection);
  } catch (error) {
    for (const [capturedGroup, children] of previousChildren) {
      capturedGroup.children = children;
    }
    throw error;
  }
}

function snapshotGroupChildren(group: Group<any>): Map<Group<any>, GroupChild<any>[]> {
  const snapshot = new Map<Group<any>, GroupChild<any>[]>();
  const visit = (current: Group<any>): void => {
    snapshot.set(current, [...current.children]);
    for (const child of current.children) {
      if (child.kind === "group") {
        visit(child);
      }
    }
  };
  visit(group);
  return snapshot;
}

function isRefreshRequested(name: string, refresh: "all" | Set<string> | undefined): boolean {
  if (refresh === "all") {
    return true;
  }

  return refresh?.has(name) === true;
}

async function resolveSingleProxy(
  group: Group<any>,
  options: ResolveMcpProxyOptions
): Promise<void> {
  const internal = getInternalGroupConfig(group);
  const config = internal.mcp;

  if (config === undefined) {
    return;
  }

  const name = group.name;

  try {
    const cachePath = resolveCachePath(name, options.projectRoot);
    const refresh = parseRefreshEnv(process.env.TOOLCRAFT_MCP_REFRESH);
    let cache: McpProxyCache;
    let shouldWriteCache = false;

    if (isRefreshRequested(name, refresh)) {
      cache = await fetchCache(name, config);
      shouldWriteCache = true;
    } else {
      const storedCache = await readCache(cachePath);
      if (storedCache && cacheMatchesConfig(storedCache, config)) {
        cache = storedCache;
      } else {
        cache = await fetchCache(name, config);
        shouldWriteCache = true;
      }
    }

    const tools = filterAllowlistedTools(cache.tools, internal.tools);

    validateRenameMap(name, tools, internal.rename);
    const previousConnection = getProxyConnection(group);
    const nextConnection = createConnection(name, config);

    try {
      replaceProxyChildrenSafely(group, tools, internal.rename, nextConnection);
      if (shouldWriteCache) {
        await writeCache(cachePath, cache);
        createLogger((message) => process.stderr.write(`${message}\n`)).info(`MCP ${name}: wrote ${cachePath}`);
      }
      setProxyConnection(group, nextConnection);
    } catch (error) {
      await nextConnection.dispose();
      throw error;
    }

    if (previousConnection !== undefined && previousConnection !== nextConnection) {
      await previousConnection.dispose();
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`couldn't discover MCP ${name}:`)) {
      throw error;
    }

    throw new Error(
      `couldn't discover MCP ${name}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function cacheMatchesConfig(cache: McpProxyCache, config: McpServerConfig): boolean {
  return cache.configFingerprint === fingerprintMcpServerConfig(config);
}

function fingerprintMcpServerConfig(config: McpServerConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function collectProxyGroups(root: Group<any>): Group<any>[] {
  const groups: Group<any>[] = [];

  function visit(group: Group<any>): void {
    if (getInternalGroupConfig(group).mcp !== undefined) {
      groups.push(group);
    }

    for (const child of group.children) {
      if (child.kind === "group") {
        visit(child);
      }
    }
  }

  visit(root);
  return groups;
}

export function hasMcpProxyGroups(root: Group<any>): boolean {
  return collectProxyGroups(root).length > 0;
}

export function resolveCachePath(name: string, projectRoot?: string): string {
  const resolvedProjectRoot = projectRoot ?? findProjectRoot();

  if (resolvedProjectRoot === undefined) {
    throw new Error(
      `Could not find package.json above "${process.cwd()}" while resolving MCP cache path.`
    );
  }

  if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error(`MCP proxy group name must be a file-safe name: "${name}".`);
  }

  return path.join(resolvedProjectRoot, ".toolcraft", "mcp", `${name}.json`);
}

async function assertCachePathHasNoSymlinks(filePath: string): Promise<void> {
  let currentPath = filePath;
  while (true) {
    try {
      if ((await lstat(currentPath)).isSymbolicLink()) {
        throw new Error(`MCP cache path must not contain symbolic links: ${currentPath}.`);
      }
    } catch (error) {
      if (!hasOwnErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
    if (path.basename(currentPath) === ".toolcraft") {
      return;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return;
    }
    currentPath = parentPath;
  }
}

export function parseRefreshEnv(
  value: string | undefined
): "all" | Set<string> | undefined {
  const trimmed = value?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  if (trimmed === "1" || trimmed === "true") {
    return "all";
  }

  const names = trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return names.length === 0 ? undefined : new Set(names);
}

export async function dialUpstream(
  name: string,
  config: McpServerConfig
): Promise<McpClient> {
  const client = new McpClient({
    clientInfo: {
      name: `${DEFAULT_CLIENT_INFO.name}-${name}`,
      version: DEFAULT_CLIENT_INFO.version,
    },
  });
  const transport =
    config.transport === "stdio"
      ? new StdioTransport({
          command: config.command,
          ...(config.args === undefined ? {} : { args: config.args }),
          ...(config.env === undefined ? {} : { env: config.env }),
        })
      : new HttpTransport({
          url: config.url,
          ...(config.headers === undefined ? {} : { headers: config.headers }),
        });

  await client.connect(transport);
  return client;
}

export async function resolveMcpProxies(
  root: Group<any>,
  options: ResolveMcpProxyOptions = {}
): Promise<void> {
  const groups = collectProxyGroups(root);
  await Promise.all(groups.map((group) => resolveSingleProxy(group, options)));
}
