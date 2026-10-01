import { createRequire } from "node:module";
import path from "node:path";
import { isPlainRecord } from "toolcraft-schema-rust";
import { UserError, ToolcraftBugError, assertCommandRequirements, resolveCommandSecrets, createRuntimeLogger } from "./index.js";
import { assertHumanInLoopWired, mergeApprovalsRoot } from "./approval-wiring.js";
import { hasMcpProxyGroups, resolveMcpProxies } from "./mcp-proxy.js";
import { isMCPResult } from "./mcp-result.js";
import { filterSchemaForScope } from "./schema-scope.js";
import { validateCasedSchemaMembers } from "./schema-member-names.js";
import { formatSegment, validateObjectSchema } from "./sdk-validation.js";
import { createEnv, createFs, validateServices } from "./runtime-io.js";
import { createManagedStream } from "./stream.js";
import { writeErrorReport } from "./error-report.js";
import { callNative, protect } from "./host-errors.js";

globalThis.require ??= createRequire(path.join(process.cwd(), "package.json"));
export { mergeApprovalsRoot, validateObjectSchema };
const native = createRequire(import.meta.url)("./toolcraft-rust.node");
let depth = 0;
function invoke(operation, args) {
  if (depth >= 128) throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try { return callNative(native.sdkPolicy, operation, args, host); }
  finally { depth--; }
}

const operations = {
  undefined: () => undefined,
  record: () => ({}),
  list: () => [],
  map: () => new Map(),
  mapGet: (map, key) => map.get(key),
  mapSet: (map, key, value) => map.set(key, value),
  sourceMaps: () => process.setSourceMapsEnabled?.(true),
  merge: mergeApprovalsRoot,
  assertWired: assertHumanInLoopWired,
  hasProxies: hasMcpProxyGroups,
  globalFetch: () => globalThis.fetch,
  logger: (level, logger) => createRuntimeLogger({ level, logger }),
  services: validateServices,
  state: (root, options, services, humanInLoop, fetch, diagnostics) => ({ root, options, services, humanInLoop, fetch, diagnostics }),
  scope: schema => filterSchemaForScope(schema, "sdk"),
  members: schema => validateCasedSchemaMembers(schema, formatSegment, "SDK member"),
  includesSdk: scope => !!scope.includes("sdk"),
  plain: isPlainRecord,
  emptyKeys: value => Object.keys(value).length === 0,
  empty: value => value.length === 0,
  single: value => value.length === 1,
  own: (value, key) => Object.prototype.hasOwnProperty.call(value, key),
  format: formatSegment,
  appendPath: (path, node) => [...path, node.name],
  build: (node, path, state) => invoke("build", [node, path, state]),
  children(node, path, state, output, names) {
    for (const child of node.children) invoke("child", [child, path, state, output, names]);
  },
  defineMember: (output, key, value) => Object.defineProperty(output, key, { value, enumerable: true, configurable: false, writable: false }),
  reserved(node) { throw new UserError(`SDK member "${node.name}" uses reserved member "then".`); },
  conflict(existing, node, member) { throw new UserError(`SDK members "${existing}" and "${node.name}" use conflicting member "${member}".`); },
  duplicate(key) { throw new Error(`Duplicate SDK member "${key}".`); },
  invalidSchema(node) { throw new ToolcraftBugError(`command "${node.name}" must define an object params schema for SDK.`); },
  validate: (schema, params, errors) => validateObjectSchema(schema, params, "", errors),
  singleError(errors) { throw new UserError(errors[0]?.message ?? "Invalid parameters."); },
  multipleErrors(errors) {
    const rendered = errors.slice(0, 10).map(error => `  - ${error.path}: ${error.message}`);
    const remaining = errors.length - rendered.length;
    if (remaining > 0) rendered.push(`  … and ${remaining} more`);
    throw new UserError(`${errors.length} parameter errors:\n${rendered.join("\n")}`);
  },
  method: createInvocation,
  streamMethod: (node, path, state) => (params, streamOptions = {}) => createManagedStream({
    eventSchema: node.stream.event,
    ...streamOptions,
    create: createInvocation(node, path, state, params, true)
  }),
  handler: (node, context) => node.handler(context),
  runtimeInvoke: (runtime, node, context, path) => runtime.invoke(node, context, path),
  isMcpResult: isMCPResult,
  mcpError(result) {
    const text = result.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
    const message = text || (result.structuredContent === undefined ? "Upstream tool failed." : JSON.stringify(result.structuredContent));
    throw new UserError(message, { cause: result });
  },
  deferred: createDeferredSDK,
  pendingSDK: (state, root, options) => (async () => {
    await resolveMcpProxies(root, { projectRoot: options.projectRoot });
    return invoke("resolved", [root, options]);
  })().catch(error => invoke("deferredRejected", [state, error])),
  setPromise: (state, promise) => { state.promise = promise; },
  setCurrent: (state, current) => { state.current = current; },
  throw(error) { throw error; },
  rootThen: resolve => resolve().then.bind(resolve()),
  nextProxy: (proxy, path, property) => proxy([...path, property]),
  validSegment: value => typeof value === "string" || typeof value === "number",
  property: (value, key) => value[key],
  callable: value => typeof value === "function",
  call: (value, args) => value(...args),
  notCallable(path) { throw new TypeError(`SDK member "${path.map(String).join(".")}" is not callable.`); },
  invalidOperation() { throw new TypeError("Invalid SDK policy operation"); }
};
const host = { operate: protect((name, args) => operations[name](...args)), get: protect((value, key) => value[key]) };

// Promises, callbacks, object spread and host I/O stay in the caller's realm.
// Each native continuation receives the same opaque objects across await points.
function createInvocation(node, path, state, streamParams, streaming = false) {
  return async (params, ...extra) => {
    const stream = streaming ? { signal: params, status: extra[0] } : undefined;
    if (streaming) params = streamParams;
    const commandPath = [...path, node.name].join(".");
    const { options, services, humanInLoop, root, fetch, diagnostics } = state;
    let secrets;
    let validatedParams;
    try {
      secrets = resolveCommandSecrets(node, options.env);
      const baseContext = {
        ...services, humanInLoop, root, secrets, fetch,
        fs: createFs(options.fs), env: createEnv(options.env), diagnostics,
        progress(message) { diagnostics.emit({ level: "info", message, category: "progress" }); }
      };
      await assertCommandRequirements(node, { ...baseContext, params: undefined }, { apiVersion: options.apiVersion, env: options.env });
      validatedParams = invoke("validate", [node, params]);
      const context = stream === undefined ? { ...baseContext, params: validatedParams } : {
        ...baseContext, params: validatedParams, signal: stream.signal, status: stream.status,
        async refreshSecrets() { return resolveCommandSecrets(node, options.env); }
      };
      const result = await invoke("invoke", [node, context, state, commandPath, stream !== undefined]);
      return stream === undefined ? invoke("result", [node, result]) : result;
    } catch (error) {
      await writeErrorReport({ command: node, commandPath, env: process.env, error,
        errorReports: options.errorReports, params: validatedParams, projectRoot: options.projectRoot, secrets });
      throw error;
    }
  };
}

function createDeferredSDK(root, options) {
  const state = { promise: undefined };
  const resolveSDK = () => invoke("deferredResolve", [state, root, options]);
  const resolvePath = async path => {
    const state = { current: await resolveSDK() };
    for (const segment of path) {
      if (!invoke("pathSegment", [state, segment])) return undefined;
    }
    return state.current;
  };
  const createPathProxy = path => new Proxy(() => undefined, {
    apply(_target, _thisArg, args) {
      return resolvePath(path).then(value => invoke("callPath", [value, path, args]));
    },
    get(_target, property) {
      return invoke("proxyGet", [path, property, resolveSDK, createPathProxy]);
    }
  });
  return createPathProxy([]);
}

export function createSDK(root, options = {}) {
  return invoke("create", [root, options]);
}
