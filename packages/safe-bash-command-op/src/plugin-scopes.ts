import type { OpBackendContext, OpObject, PluginDefault, PluginScope } from "./types.js";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absolutePath(value: unknown): { root: string; segments: string[] } {
  const invalid = () => new Error("Plugin scope requires normalized absolute paths");
  if (typeof value !== "string" || value.includes("\\") || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw invalid();
  let root: string;
  let remainder: string;
  let windows = false;
  if (value.startsWith("//")) {
    const parts = value.slice(2).split("/");
    if (parts.length < 2 || !parts[0] || !parts[1]) throw invalid();
    root = `//${parts[0]}/${parts[1]}`;
    remainder = value.slice(root.length + 1);
    if (value === `${root}/`) throw invalid();
    windows = true;
  } else if (value.startsWith("/")) {
    root = "/";
    remainder = value.slice(1);
  } else if (value.length >= 3 && "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".includes(value[0]!) && value.slice(1, 3) === ":/") {
    root = value.slice(0, 3);
    remainder = value.slice(3);
    windows = true;
  } else throw invalid();
  const segments = remainder === "" ? [] : remainder.split("/");
  const checked = windows && root.startsWith("//") ? [...root.slice(2).split("/"), ...segments] : segments;
  if (checked.some(segment => !segment || segment === "." || segment === ".." || (windows && ([...segment].some(character => '<>:"|?*'.includes(character)) || segment.endsWith(".") || segment.endsWith(" "))))) throw invalid();
  return { root, segments };
}

function directoryChain(cwd: string, home: string): string[] {
  const current = absolutePath(cwd);
  absolutePath(home);
  const chain: string[] = [];
  for (let length = current.segments.length; length >= 0; length--) {
    const directory = current.root + (length && !current.root.endsWith("/") ? "/" : "") + current.segments.slice(0, length).join("/");
    chain.push(directory);
    if (directory === home) break;
  }
  return chain;
}

function parseScope(value: unknown): PluginScope {
  if (!object(value)) throw new Error("Invalid plugin default scope");
  if (value.kind === "global") return { kind: "global" };
  if (value.kind === "directory" && typeof value.path === "string") {
    absolutePath(value.path);
    return { kind: "directory", path: value.path };
  }
  if (value.kind === "terminal" && typeof value.terminalSession === "string" && value.terminalSession.length > 0) return { kind: "terminal", terminalSession: value.terminalSession };
  throw new Error("Invalid plugin default scope");
}

export async function clearPluginDefaults(plugin: OpObject, context: OpBackendContext, all: boolean, force: boolean): Promise<OpObject> {
  context.signal.throwIfAborted();
  if (Object.hasOwn(plugin, "configuration")) throw new Error("Plugin configuration requires explicit scope migration");
  const trustedScope = context.pluginScope;
  if (!trustedScope) throw new Error("Plugin scope context is unavailable");
  const { cwd, home, terminalSession } = trustedScope;
  const chain = directoryChain(cwd, home);
  if (terminalSession !== undefined && (typeof terminalSession !== "string" || !terminalSession.length)) throw new Error("Invalid plugin terminal identity");
  if (plugin.defaults !== undefined && !Array.isArray(plugin.defaults)) throw new Error("Invalid plugin defaults");
  const ids = new Set<string>();
  const scopes = new Set<string>();
  const defaults: PluginDefault[] = (plugin.defaults ?? []).map((entry: unknown) => {
    if (!object(entry) || typeof entry.id !== "string" || !entry.id || !object(entry.configuration)) throw new Error("Invalid plugin default");
    const scope = parseScope(entry.scope);
    const key = JSON.stringify(scope);
    if (ids.has(entry.id) || scopes.has(key)) throw new Error("Plugin defaults contain duplicate IDs or scopes");
    ids.add(entry.id);
    scopes.add(key);
    return { id: entry.id, scope, configuration: entry.configuration };
  });
  const applicable = defaults.flatMap(entry => {
    const scope = entry.scope;
    const priority = scope.kind === "global" ? chain.length + 1 : scope.kind === "terminal" ? scope.terminalSession === terminalSession ? 0 : -1 : chain.indexOf(scope.path) < 0 ? -1 : chain.indexOf(scope.path) + 1;
    return priority < 0 ? [] : [{ entry, priority }];
  }).sort((left, right) => left.priority - right.priority);
  const selected = all ? applicable : applicable.slice(0, 1);
  if (!selected.length) return plugin;
  if (!force) {
    const confirm = context.confirmPluginClear;
    if (!confirm) throw new Error("Plugin clear confirmation capability is unavailable");
    const confirmation = Object.freeze({ pluginId: plugin.id, defaults: Object.freeze(selected.map(({ entry }) => Object.freeze({ id: entry.id, scope: Object.freeze({ ...entry.scope }) }))) });
    let onAbort!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new DOMException("Plugin clear aborted", "AbortError"));
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
    });
    let accepted: boolean;
    try {
      accepted = await Promise.race([aborted, Promise.resolve().then(() => {
        context.signal.throwIfAborted();
        return confirm(confirmation, Object.freeze({ signal: context.signal }));
      })]);
    } catch {
      if (context.signal.aborted) throw new DOMException("Plugin clear aborted", "AbortError");
      throw new Error("Plugin clear confirmation failed");
    } finally {
      context.signal.removeEventListener("abort", onAbort);
    }
    if (accepted !== true) throw new Error("Plugin clear was not confirmed");
  }
  context.signal.throwIfAborted();
  const removed = new Set(selected.map(({ entry }) => entry.id));
  return { ...plugin, defaults: (plugin.defaults as PluginDefault[]).filter(entry => !removed.has(entry.id)) };
}
