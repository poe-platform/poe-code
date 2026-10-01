import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createLogger } from "toolcraft-design-rust";
import { HttpTransport, McpClient, StdioTransport } from "tiny-mcp-client-rust";
import { formatIssues, validate } from "toolcraft-schema-rust";
import { convertJsonSchema } from "./json-schema-converter.js";
import { asMCPResult } from "./mcp-result.js";
import { findProjectRoot } from "./project-root.js";
import { callNative, protect } from "./host-errors.js";

export { findProjectRoot } from "./project-root.js";
const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const proxyConnection = Symbol("toolcraft.mcpProxyConnection");
const proxyNode = Symbol("toolcraft.mcpProxyNode");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.mcpProxyPolicy, operation, args, host); }
  finally { depth--; }
}

const operations = {
  undefined: () => undefined,
  record: () => ({}),
  list: () => [],
  true: () => true,
  false: () => false,
  truthy: value => !!value,
  objectType: value => typeof value === "object",
  nullValue: value => value === null,
  string: value => typeof value === "string",
  array: Array.isArray,
  error: value => value instanceof Error,
  syntaxError: value => value instanceof SyntaxError,
  empty: value => value.length === 0,
  nonEmpty: value => value.length > 0,
  trim: value => value.trim(),
  refreshNames: value => value.split(",").map(entry => entry.trim()).filter(entry => entry.length > 0),
  set: value => new Set(value),
  has: (set, value) => set.has(value),
  add: (set, value) => set.add(value),
  push: (array, value) => array.push(value),
  clone: value => ({ ...value }),
  cloneScope: value => value === undefined ? undefined : [...value],
  defaultScope: () => ["cli", "sdk"],
  symbols: Object.getOwnPropertySymbols,
  findConfigSymbol: symbols => symbols.find(symbol => invoke("configSymbol", [symbol])),
  property: (value, key) => value[key],
  own: (value, key) => Object.prototype.hasOwnProperty.call(value, key),
  ownCode: value => Object.prototype.hasOwnProperty.call(value, "code"),
  isProxy: node => Object.getOwnPropertySymbols(node).some(symbol => invoke("proxySymbol", [node, symbol])),
  reflect: Reflect.get,
  mark: node => Object.defineProperty(node, proxyNode, { configurable: false, enumerable: false, value: true, writable: false }),
  convert: convertJsonSchema,
  result: asMCPResult,
  validate,
  schemaUrl: () => "https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json",
  epoch: () => new Date(0).toISOString(),
  one: () => 1,
  fingerprint: config => createHash("sha256").update(JSON.stringify(config)).digest("hex"),
  filteredChildren: group => group.children.filter(child => !operations.isProxy(child)),
  visitChildren(group, operation, state) { for (const child of group.children) invoke(operation, [child, state]); },
  collectState: () => [],
  map: () => new Map(),
  snapshot: (snapshot, group) => snapshot.set(group, [...group.children]),
  restore(snapshot) { for (const [group, children] of snapshot) group.children = children; },
  toolNames: tools => new Set(tools.map(tool => tool.name)),
  allowed: (tools, names) => tools.filter(tool => names.has(tool.name)),
  checkRenames(name, names, rename) { for (const key of Object.keys(rename)) invoke("renameKey", [name, names, key]); },
  connection: group => group[proxyConnection],
  setConnection: (group, value) => { group[proxyConnection] = value; },
  createConnection,
  closeConnection(connection) {
    connection.closing = (async () => {
      await connection.connecting?.catch(() => undefined);
      const client = invoke("takeClient", [connection]);
      if (client !== undefined) await client.close();
    })().finally(() => { connection.closing = undefined; });
    return connection.closing;
  },
  connectPending(connection, name, config) {
    connection.connecting = dialUpstream(name, config).then(client => {
      connection.client = client; return client;
    }).finally(() => { connection.connecting = undefined; });
    return connection.connecting;
  },
  findChild: (parent, name) => parent.children.find(child => child.name === name),
  splitPath: value => value.split("."),
  singleton: value => [value],
  last: values => values[values.length - 1],
  populate(group, tools, rename, connection) { for (const tool of tools) invoke("place", [group, tool, rename, connection]); },
  placeParents(group, segments, target) {
    let parent = group;
    for (const segment of segments.slice(0, -1)) parent = invoke("parent", [parent, segment, target]);
    return parent;
  },
  appendChild: (parent, child) => parent.children.push(child),
  appendCommand: (parent, tool, name, connection) => parent.children.push(invoke("command", [parent, tool, name, connection])),
  commandHandler(tool, result, connection) {
    return async ctx => {
      ctx.signal?.throwIfAborted();
      const connecting = ensureConnected(connection);
      const client = ctx.signal === undefined ? await connecting : await new Promise((resolve, reject) => {
        const signal = ctx.signal;
        const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
        signal.addEventListener("abort", abort, { once: true });
        connecting.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
        if (signal.aborted) abort();
      });
      ctx.signal?.throwIfAborted();
      const response = await client.callTool({ name: tool.name, arguments: ctx.params }, { signal: ctx.signal });
      return invoke("toolResult", [tool, result, response]);
    };
  },
  root: findProjectRoot,
  fileUnsafe: name => !!(name.includes("/") || name.includes("\\")),
  cachePath: (root, name) => path.join(root, ".toolcraft", "mcp", `${name}.json`),
  basename: path.basename,
  dirname: path.dirname,
  symlink: stat => !!stat.isSymbolicLink(),
  cacheState: (internal, config, name) => ({ internal, config, name }),
  replacement: (tools, previous, connection, snapshot) => ({ tools, previous, connection, snapshot }),
  pageState: () => ({ tools: [], seen: new Set(), cursor: undefined, pages: 0 }),
  increment: state => { state.pages++; },
  appendTools: (state, page) => state.tools.push(...page.tools),
  pageLimit: state => state.pages >= 128,
  cursorParams: cursor => ({ cursor }),
  cacheRecord: (client, name, config, tools) => ({
    $schema: operations.schemaUrl(), version: 1, upstream: client.serverInfo ?? { name, version: "unknown" },
    configFingerprint: operations.fingerprint(config), fetchedAt: new Date().toISOString(), tools
  }),
  client: name => new McpClient({ clientInfo: { name: `toolcraft-${name}`, version: "0.0.1" } }),
  stdio: options => new StdioTransport(options),
  http: options => new HttpTransport(options),
  connectionPair: (client, transport) => ({ client, transport }),
  connectionList: groups => new Set(groups.flatMap(group => { const connection = group[proxyConnection]; return connection === undefined ? [] : [connection]; })),
  failures: outcomes => outcomes.flatMap(outcome => outcome.status === "rejected" ? [outcome.reason] : []),
  aggregate(failures) { throw new AggregateError(failures, failures.map(error => error instanceof Error ? error.message : String(error)).join("; ")); },
  wrappedMessage: (name, error) => !!error.message.startsWith(`couldn't discover MCP ${name}:`),
  discoveryError(name, error) { throw new Error(`couldn't discover MCP ${name}: ${error instanceof Error ? error.message : String(error)}`); },
  missingRoot() { throw new Error(`Could not find package.json above "${process.cwd()}" while resolving MCP cache path.`); },
  unsafeName(name) { throw new Error(`MCP proxy group name must be a file-safe name: "${name}".`); },
  collision(target) { throw new Error(`command path "${target}" collides with an existing child`); },
  unknownRename(name, key) { throw new Error(`couldn't discover MCP ${name}: rename references unknown upstream tool "${key}"`); },
  invalidParams(tool) { throw new Error(`upstream tool "${tool.name}" must define an object input schema`); },
  missingResult(tool) { throw new Error(`upstream tool "${tool.name}" declared outputSchema but returned no structuredContent`); },
  invalidResult(tool, validation) { throw new Error(`upstream tool "${tool.name}" returned invalid structuredContent: ${formatIssues(validation.issues)}`); },
  symlinkError(path) { throw new Error(`MCP cache path must not contain symbolic links: ${path}.`); },
  repeatedCursor() { throw new Error("upstream tools/list returned a repeated pagination cursor"); },
  paginationLimit() { throw new Error("upstream exceeded the tool pagination limit (128 pages)"); },
  invalidOperation() { throw new TypeError("Invalid MCP proxy operation"); }
};
const host = {
  get: protect((value, key) => value[key]),
  operate: protect((name, args) => {
    if (name.startsWith("set:")) { args[0][name.slice(4)] = args[1]; return args[0]; }
    if (name.startsWith("define:")) return Object.defineProperty(args[0], name.slice(7), { value: args[1], enumerable: true, configurable: true, writable: true });
    if (name.startsWith("literal:")) return name.slice(8);
    return Object.hasOwn(operations, name) ? operations[name](...args) : invoke(name, args);
  })
};

function createConnection(name, config) {
  const connection = { name, config, dispose() { return invoke("dispose", [connection]); } };
  return connection;
}
async function ensureConnected(connection) {
  if (invoke("isClosing", [connection])) await connection.closing;
  return invoke("connected", [connection]);
}
async function assertNoSymlinks(filePath) {
  let current = filePath;
  while (true) {
    try { invoke("checkStat", [await lstat(current), current]); }
    catch (error) { if (!invoke("missingFile", [error])) throw error; }
    const parent = invoke("parentPath", [current]);
    if (parent === undefined) return;
    current = parent;
  }
}
async function readCache(cachePath) {
  try { await assertNoSymlinks(cachePath); return invoke("readCache", [JSON.parse(await readFile(cachePath, "utf8"))]); }
  catch (error) { return invoke("ignoreReadError", [error]); }
}
async function writeCache(cachePath, cache) {
  const directory = path.dirname(cachePath);
  const temporary = `${cachePath}.tmp-${randomUUID()}`;
  let created = false;
  await assertNoSymlinks(cachePath);
  await assertNoSymlinks(temporary);
  await mkdir(directory, { recursive: true });
  await assertNoSymlinks(directory);
  try {
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    created = true;
    await assertNoSymlinks(temporary);
    await assertNoSymlinks(cachePath);
    await rename(temporary, cachePath);
    created = false;
  } catch (error) {
    if (invoke("cleanupTemp", [created, error])) await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
async function fetchCache(name, config) {
  const logger = createLogger(message => process.stderr.write(`${message}\n`));
  logger.info(`MCP ${name}: connecting`);
  const client = await dialUpstream(name, config);
  try {
    logger.info(`MCP ${name}: listing tools`);
    const state = operations.pageState();
    do { invoke("page", [state, await client.listTools(invoke("pageParams", [state]))]); }
    while (invoke("morePages", [state]));
    logger.info(`MCP ${name}: found ${state.tools.length} tools`);
    return operations.cacheRecord(client, name, config, state.tools);
  } finally { await client.close(); }
}
async function resolveSingle(group, options) {
  const start = invoke("start", [group]);
  if (start === undefined) return;
  const { internal, config, name } = start;
  try {
    const cachePath = resolveCachePath(name, options.projectRoot);
    const refresh = parseRefreshEnv(process.env.TOOLCRAFT_MCP_REFRESH);
    let cache, write = false;
    if (invoke("refreshRequested", [name, refresh])) { cache = await fetchCache(name, config); write = true; }
    else {
      const stored = await readCache(cachePath);
      if (invoke("matches", [stored, config])) cache = stored;
      else { cache = await fetchCache(name, config); write = true; }
    }
    const replacement = invoke("prepare", [group, cache, internal, name, config]);
    try {
      invoke("populateGroup", [group, replacement.tools, internal.rename, replacement.connection]);
      if (write) {
        await writeCache(cachePath, cache);
        createLogger(message => process.stderr.write(`${message}\n`)).info(`MCP ${name}: wrote ${cachePath}`);
      }
      operations.setConnection(group, replacement.connection);
    } catch (error) {
      operations.restore(replacement.snapshot);
      await replacement.connection.dispose();
      throw error;
    }
    const previous = invoke("previous", [replacement]);
    if (previous !== undefined) await previous.dispose();
  } catch (error) { throw invoke("wrapError", [name, error]); }
}

export function hasMcpProxyGroups(root) { return invoke("hasGroups", [root]); }
export function resolveCachePath(name, projectRoot) { return invoke("cachePath", [name, projectRoot]); }
export function parseRefreshEnv(value) { return invoke("refresh", [value]); }
export async function dialUpstream(name, config) {
  const { client, transport } = invoke("dial", [name, config]);
  await client.connect(transport);
  return client;
}
export async function resolveMcpProxies(root, options = {}) {
  const groups = invoke("groups", [root]);
  await Promise.all(groups.map(group => resolveSingle(group, options)));
}
export async function disposeMcpProxies(root) {
  const connections = operations.connectionList(invoke("groups", [root]));
  const outcomes = await Promise.allSettled([...connections].map(connection => connection.dispose()));
  invoke("disposeOutcomes", [outcomes]);
}
