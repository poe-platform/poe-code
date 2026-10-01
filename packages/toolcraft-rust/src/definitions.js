import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ToolcraftBugError, UserError } from "./index.js";

const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const commandConfigSymbol = Symbol("toolcraft.command.config");
const groupConfigSymbol = Symbol("toolcraft.group.config");
const commandSourcePathSymbol = Symbol("toolcraft.command.sourcePath");

function cloneScope(scope) {
  return scope === undefined ? undefined : [...scope];
}
function cloneSecrets(secrets) {
  return Object.fromEntries(
    Object.entries(secrets ?? {}).map(([name, secret]) => [
      name,
      {
        env: secret.env,
        description: secret.description,
        optional: secret.optional
      }
    ])
  );
}
function cloneRequires(requires) {
  return requires === undefined
    ? undefined
    : { auth: requires.auth, apiVersion: requires.apiVersion, check: requires.check };
}
function cloneExamples(examples) {
  return (examples ?? []).map((example) => ({
    title: example.title,
    params: { ...example.params }
  }));
}
function cloneMcp(config) {
  if (config === undefined) return undefined;
  if (config.transport === "stdio")
    return {
      transport: "stdio",
      command: config.command,
      args: cloneScope(config.args),
      env: config.env === undefined ? undefined : { ...config.env }
    };
  return {
    transport: "http",
    url: config.url,
    headers: config.headers === undefined ? undefined : { ...config.headers }
  };
}

// Callable checks and null/undefined distinctions are host observations. Rust
// selects inherited fields and secret precedence without serializing host values.
function mergeMetadata(own, parent, command) {
  const parentSecrets = Object.entries(parent.secrets),
    ownSecrets = Object.entries(own.secrets);
  const input = (value, secrets, child) => ({
    scope: value.scope,
    secrets: secrets.map(([name]) => name),
    approval: value.humanInLoop !== undefined,
    auth: child ? value.requires?.auth != null : value.requires?.auth !== undefined,
    version: child ? value.requires?.apiVersion != null : value.requires?.apiVersion !== undefined,
    check: value.requires?.check !== undefined
  });
  const plan = native.mergeDefinitionMetadata(
    input(parent, parentSecrets, false),
    input(own, ownSecrets, true),
    command
  );
  const values = [undefined, parent, own],
    entries = [undefined, parentSecrets, ownSecrets];
  let check;
  if (plan.check === 3) {
    const parentCheck = parent.requires.check,
      childCheck = own.requires.check;
    check = async (ctx) => {
      const result = await parentCheck(ctx);
      return result.ok ? childCheck(ctx) : result;
    };
  } else check = values[plan.check]?.requires?.check;
  return {
    scope: plan.scope ?? undefined,
    humanInLoop: values[plan.approval]?.humanInLoop,
    secrets: cloneSecrets(
      Object.fromEntries(plan.secrets.map(({ source, index }) => entries[source][index]))
    ),
    requires:
      plan.auth || plan.version || plan.check
        ? {
            auth: values[plan.auth]?.requires?.auth,
            apiVersion: values[plan.version]?.requires?.apiVersion,
            check
          }
        : undefined
  };
}

function validateApproval(config) {
  const label = Array.isArray(config.children) ? "group" : "command";
  if (config.confirm === true && config.humanInLoop !== undefined && config.humanInLoop !== null)
    throw new Error(`${label} '${config.name}': use either confirm or humanInLoop, not both`);
  if (config.humanInLoop === undefined || config.humanInLoop === null) return;
  if (config.humanInLoop.mode !== "sync" && config.humanInLoop.mode !== "async")
    throw new Error(`${label} '${config.name}': humanInLoop.mode must be "sync" or "async"`);
  if (typeof config.humanInLoop.message !== "function")
    throw new Error(`${label} '${config.name}': humanInLoop.message must be a function`);
  if (config.humanInLoop.plan !== undefined && typeof config.humanInLoop.plan !== "function")
    throw new Error(`${label} '${config.name}': humanInLoop.plan must be a function`);
}

function inferSourcePath() {
  const stack = new Error().stack;
  if (typeof stack !== "string") return undefined;
  for (const line of stack.split("\n").slice(1)) {
    let candidate = native.definitionSourceLocation(line);
    if (candidate == null) continue;
    if (candidate.startsWith("file://")) {
      try {
        candidate = fileURLToPath(candidate);
      } catch {
        continue;
      }
    }
    if (
      [
        "/packages/toolcraft/src/index.ts",
        "/packages/toolcraft/dist/index.js",
        "/node_modules/toolcraft/dist/index.js",
        "/toolcraft-rust/src/definitions.js",
        "/toolcraft-rust/dist/definitions.js"
      ].some((path) => candidate.includes(path))
    )
      continue;
    return candidate;
  }
}

function createBaseCommand(config) {
  if (config.mcpResult !== undefined && config.result === undefined)
    throw new ToolcraftBugError(
      `Command "${config.name}" defines mcpResult without a result schema.`
    );
  const command = {
    kind: "command",
    name: config.name,
    title: config.title,
    description: config.description,
    annotations: config.annotations === undefined ? undefined : { ...config.annotations },
    hidden: config.hidden ?? false,
    examples: cloneExamples(config.examples),
    aliases: [...(config.aliases ?? [])],
    positional: [...(config.positional ?? [])],
    params: config.params,
    result: config.result,
    mcpResult: config.mcpResult,
    stream: undefined,
    secrets: cloneSecrets(config.secrets),
    scope: cloneScope(config.scope),
    confirm: config.confirm ?? false,
    humanInLoop: config.humanInLoop,
    requires: cloneRequires(config.requires),
    handler: config.handler,
    render: config.render
  };
  Object.defineProperty(command, commandConfigSymbol, {
    value: {
      title: config.title,
      annotations: config.annotations === undefined ? undefined : { ...config.annotations },
      scope: cloneScope(config.scope),
      hidden: config.hidden ?? false,
      examples: cloneExamples(config.examples),
      result: config.result,
      mcpResult: config.mcpResult,
      humanInLoop: config.humanInLoop,
      secrets: cloneSecrets(config.secrets),
      requires: cloneRequires(config.requires),
      sourcePath: inferSourcePath()
    }
  });
  return command;
}

function createBaseGroup(config) {
  const group = {
    kind: "group",
    name: config.name,
    description: config.description,
    aliases: [...(config.aliases ?? [])],
    scope: cloneScope(config.scope),
    humanInLoop: config.humanInLoop,
    secrets: cloneSecrets(config.secrets),
    requires: cloneRequires(config.requires),
    children: [],
    default: undefined
  };
  Object.defineProperty(group, groupConfigSymbol, {
    value: {
      mcp: cloneMcp(config.mcp),
      scope: cloneScope(config.scope),
      humanInLoop: config.humanInLoop,
      secrets: cloneSecrets(config.secrets),
      tools: cloneScope(config.tools),
      rename: config.rename === undefined ? undefined : { ...config.rename },
      requires: cloneRequires(config.requires),
      children: [...config.children],
      default: config.default
    }
  });
  return group;
}

function materialize(node, parent = { secrets: {} }) {
  const command = node.kind === "command",
    symbol = command ? commandConfigSymbol : groupConfigSymbol;
  const internal = node[symbol];
  const merged = mergeMetadata(internal, parent, command);
  if (command) {
    const result = {
      kind: "command",
      name: node.name,
      title: internal.title,
      description: node.description,
      annotations: internal.annotations === undefined ? undefined : { ...internal.annotations },
      hidden: internal.hidden,
      examples: cloneExamples(internal.examples),
      aliases: [...node.aliases],
      positional: [...node.positional],
      params: node.params,
      result: internal.result,
      mcpResult: internal.mcpResult,
      stream: node.stream,
      secrets: merged.secrets,
      scope: merged.scope,
      confirm: node.confirm,
      humanInLoop: merged.humanInLoop,
      requires: merged.requires,
      handler: node.handler,
      render: node.render
    };
    Object.defineProperty(result, symbol, {
      value: {
        title: internal.title,
        annotations: internal.annotations === undefined ? undefined : { ...internal.annotations },
        scope: cloneScope(internal.scope),
        hidden: internal.hidden,
        examples: cloneExamples(internal.examples),
        result: internal.result,
        mcpResult: internal.mcpResult,
        humanInLoop: internal.humanInLoop,
        secrets: cloneSecrets(internal.secrets),
        requires: cloneRequires(internal.requires),
        sourcePath: internal.sourcePath
      }
    });
    Object.defineProperty(result, commandSourcePathSymbol, { value: internal.sourcePath });
    return result;
  }
  const children = internal.children.map((child) => materialize(child, merged));
  let defaultChild;
  if (internal.default !== undefined) {
    const index = internal.children.indexOf(internal.default);
    const issue = native.definitionDefaultIssue(
      index,
      Array.from(children, (child) => child?.kind === "command")
    );
    if (issue === "missing")
      throw new ToolcraftBugError(
        `Default command "${internal.default.name}" must be listed in children.`
      );
    if (issue === "group")
      throw new ToolcraftBugError(`Default child "${internal.default.name}" must be a command.`);
    defaultChild = children[index];
  }
  const result = {
    kind: "group",
    name: node.name,
    description: node.description,
    aliases: [...node.aliases],
    scope: merged.scope,
    humanInLoop: merged.humanInLoop,
    secrets: merged.secrets,
    requires: merged.requires,
    children,
    default: defaultChild
  };
  Object.defineProperty(result, symbol, {
    value: {
      mcp: cloneMcp(internal.mcp),
      scope: cloneScope(internal.scope),
      humanInLoop: internal.humanInLoop,
      secrets: cloneSecrets(internal.secrets),
      tools: cloneScope(internal.tools),
      rename: internal.rename === undefined ? undefined : { ...internal.rename },
      requires: cloneRequires(internal.requires),
      children: [...internal.children],
      default: internal.default
    }
  });
  return result;
}

export function defineCommand(config) {
  validateApproval(config);
  return materialize(createBaseCommand(config));
}

export function defineStreamCommand(config) {
  const command = defineCommand({
    ...config,
    confirm: false,
    humanInLoop: null,
    handler: config.handler,
    render: undefined
  });
  command.stream = { event: config.event, bufferSize: 1 };
  command.render = config.render;
  return command;
}

export function defineGroup(config) {
  if (config.rename !== undefined) {
    const entries = Object.entries(config.rename),
      issue = native.definitionRenameIssue(entries.map(([, target]) => target));
    if (issue != null) {
      const [name, target] = entries[issue.index];
      if (issue.kind === "empty")
        throw new UserError(
          `Invalid rename target for upstream tool "${name}": path cannot be empty.`
        );
      if (issue.kind === "segment")
        throw new UserError(
          `Invalid rename target for upstream tool "${name}": "${target}" contains an empty segment.`
        );
      throw new UserError(
        `Duplicate rename target "${target}" for upstream tools "${entries[issue.previous][0]}" and "${name}".`
      );
    }
  }
  validateApproval(config);
  return materialize(createBaseGroup(config));
}

export function cloneCommandNode(node, scopeOverride) {
  function rebuild(current, root, withinProxy) {
    const symbol = Object.getOwnPropertySymbols(current).find(
      (candidate) =>
        candidate.description ===
        (current.kind === "command"
          ? commandConfigSymbol.description
          : groupConfigSymbol.description)
    );
    const config = symbol === undefined ? undefined : Reflect.get(current, symbol);
    const inherited = root || config === undefined ? current : config;
    const metadata = {
      scope: scopeOverride ?? inherited.scope,
      humanInLoop: inherited.humanInLoop,
      secrets: inherited.secrets,
      requires: inherited.requires
    };
    if (current.kind === "command") {
      const base = createBaseCommand({ ...current, ...metadata });
      if (config !== undefined) base[commandConfigSymbol].sourcePath = config.sourcePath;
      base.stream = current.stream === undefined ? undefined : { ...current.stream };
      return base;
    }
    const proxyChildren = withinProxy || config?.mcp !== undefined;
    const sourceChildren = current.children.filter(
      (child) =>
        !proxyChildren ||
        !Object.getOwnPropertySymbols(child).some(
          (symbol) =>
            symbol.description === "toolcraft.mcpProxyNode" && Reflect.get(child, symbol) === true
        )
    );
    const children = sourceChildren.map((child) => rebuild(child, false, proxyChildren));
    const defaultIndex =
      current.default === undefined ? -1 : sourceChildren.indexOf(current.default);
    if (current.default !== undefined && defaultIndex === -1)
      throw new ToolcraftBugError(
        `Default command "${current.default.name}" must be listed in children.`
      );
    return createBaseGroup({
      ...current,
      ...metadata,
      mcp: config?.mcp,
      tools: config?.tools,
      rename: config?.rename,
      children,
      default: defaultIndex === -1 ? undefined : children[defaultIndex]
    });
  }
  return materialize(rebuild(node, true, false));
}

export function getCommandSourcePath(command) {
  return command[commandSourcePathSymbol];
}

export function hasMcpProxyConfig(group) {
  const symbol = Object.getOwnPropertySymbols(group).find(
    (candidate) => candidate.description === groupConfigSymbol.description
  );
  const config = symbol === undefined ? undefined : group[symbol];
  if (config?.mcp !== undefined) return true;
  return (config?.children ?? group.children).some(
    (child) => child.kind === "group" && hasMcpProxyConfig(child)
  );
}
