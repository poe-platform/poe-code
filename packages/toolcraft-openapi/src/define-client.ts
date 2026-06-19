import type { Command, CommandNode, Group, Scope } from "toolcraft";
import { ToolcraftBugError, defineCommand, defineGroup, UserError } from "toolcraft";
import type { AuthProvider, TokenSource } from "./auth/types.js";
import { toMcpPrefix } from "./naming.js";

export interface OpenApiClientServices {
  baseUrl: string;
  tokenSource: TokenSource;
}

export interface DefineClientOptions<TServices extends object = Record<string, never>> {
  name: string;
  baseUrl: string;
  auth: AuthProvider;
  commands: CommandNode<OpenApiClientServices & TServices>[];
  handwrittenCommands?: CommandNode<OpenApiClientServices & TServices>[];
}

export interface DefinedClient<TServices extends object = Record<string, never>> {
  name: string;
  mcpPrefix: string;
  root: Group<OpenApiClientServices & TServices>;
  services: OpenApiClientServices;
}

type CommandSource = "generated" | "handwritten" | "auth";

const CLI_SCOPE: Scope[] = ["cli"];

export function defineClient<TServices extends object = Record<string, never>>(
  options: DefineClientOptions<TServices>
): DefinedClient<TServices> {
  validateClientName(options.name);

  if (options.auth === undefined) {
    throw new UserError("defineClient requires an auth provider.");
  }

  const mergedChildren = mergeChildren([
    { nodes: options.commands, source: "generated" },
    { nodes: options.handwrittenCommands ?? [], source: "handwritten" },
    { nodes: options.auth.commands.map((command) => cloneNode(command, CLI_SCOPE)), source: "auth" }
  ]);

  return {
    name: options.name,
    mcpPrefix: toMcpPrefix(options.name),
    root: defineGroup({
      name: options.name,
      children: mergedChildren
    }),
    services: {
      baseUrl: options.baseUrl,
      tokenSource: options.auth
    }
  };
}

function mergeChildren<TServices extends object>(
  entries: Array<{
    nodes: CommandNode<TServices>[];
    source: CommandSource;
  }>
): CommandNode<TServices>[] {
  const nodeSources = new Map<object, CommandSource>();
  const merged: CommandNode<TServices>[] = [];

  for (const entry of entries) {
    mergeInto(merged, entry.nodes, [], entry.source, nodeSources);
  }

  // defineGroup snapshots its children at construction time, while mergeInto mutates an
  // existing group's children after that snapshot. Re-cloning here re-materializes each
  // merged group so nesting client.root under another group preserves the merged children.
  return merged.map((node) => cloneNode(node));
}

function mergeInto<TServices extends object>(
  target: CommandNode<TServices>[],
  incoming: CommandNode<TServices>[],
  path: string[],
  source: CommandSource,
  nodeSources: Map<object, CommandSource>
): void {
  for (const candidate of incoming) {
    const nextNode = cloneNode(candidate);
    registerSource(nextNode, source, nodeSources);

    const existing = target.find((node) => node.name === nextNode.name);
    if (existing === undefined) {
      target.push(nextNode);
      continue;
    }

    if (existing.kind !== "group" || nextNode.kind !== "group") {
      throw createCollisionError(
        [...path, nextNode.name],
        getRegisteredSource(nodeSources, existing),
        source
      );
    }

    mergeInto(existing.children, nextNode.children, [...path, nextNode.name], source, nodeSources);
  }
}

function registerSource<TServices extends object>(
  node: CommandNode<TServices>,
  source: CommandSource,
  nodeSources: Map<object, CommandSource>
): void {
  nodeSources.set(node, source);

  if (node.kind === "group") {
    for (const child of node.children) {
      registerSource(child, source, nodeSources);
    }
  }
}

function getRegisteredSource<TNode extends object>(
  nodeSources: Map<object, CommandSource>,
  node: TNode
): CommandSource {
  const source = nodeSources.get(node);

  if (source === undefined) {
    throw new ToolcraftBugError("merged command node is missing source metadata.");
  }

  return source;
}

function createCollisionError(
  path: string[],
  left: CommandSource,
  right: CommandSource
): UserError {
  return new UserError(
    `Command path ${JSON.stringify(path.join(" "))} is defined more than once (${left} and ${right}).`
  );
}

function cloneNode<TServices extends object>(
  node: CommandNode<TServices>,
  scopeOverride?: Scope[]
): CommandNode<TServices> {
  if (node.kind === "command") {
    return cloneCommand(node, scopeOverride);
  }

  return cloneGroup(node, scopeOverride);
}

function cloneCommand<TServices extends object>(
  command: Command<TServices, any, any, any>,
  scopeOverride?: Scope[]
): Command<TServices, any, any, any> {
  return defineCommand({
    name: command.name,
    hidden: command.hidden,
    description: command.description,
    examples: command.examples.map((example) => ({
      title: example.title,
      params: { ...example.params }
    })),
    aliases: [...command.aliases],
    positional: [...command.positional],
    params: command.params,
    secrets: { ...command.secrets },
    scope: [...(scopeOverride ?? command.scope)],
    confirm: command.confirm,
    requires: command.requires,
    handler: command.handler,
    render: command.render
  });
}

function cloneGroup<TServices extends object>(
  group: Group<TServices>,
  scopeOverride?: Scope[]
): Group<TServices> {
  const children = group.children.map((child) => cloneNode(child, scopeOverride));
  const defaultCommand = findCommand(children, group.default?.name);

  return defineGroup({
    name: group.name,
    description: group.description,
    aliases: [...group.aliases],
    scope: cloneScope(group.scope, scopeOverride),
    secrets: { ...group.secrets },
    requires: group.requires,
    children,
    default: defaultCommand
  });
}

function validateClientName(name: string): void {
  if (!isValidClientName(name)) {
    throw new UserError(
      `Client name ${JSON.stringify(name)} must use lowercase letters, numbers, and hyphens only.`
    );
  }
}

function isValidClientName(name: string): boolean {
  if (name.length === 0 || name.startsWith("-") || name.endsWith("-")) {
    return false;
  }

  for (const character of name) {
    if (character === "-") {
      continue;
    }

    if (character >= "a" && character <= "z") {
      continue;
    }

    if (character >= "0" && character <= "9") {
      continue;
    }

    return false;
  }

  return true;
}

function cloneScope(scope: Scope[] | undefined, scopeOverride?: Scope[]): Scope[] | undefined {
  if (scopeOverride !== undefined) {
    return [...scopeOverride];
  }

  if (scope === undefined) {
    return undefined;
  }

  return [...scope];
}

function findCommand<TServices extends object>(
  nodes: CommandNode<TServices>[],
  name: string | undefined
): Command<TServices, any, any, any> | undefined {
  if (name === undefined) {
    return undefined;
  }

  for (const node of nodes) {
    if (node.kind === "command" && node.name === name) {
      return node;
    }
  }

  return undefined;
}
