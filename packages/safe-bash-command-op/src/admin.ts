import type { OpAuthenticationPolicy, OpBackendContext, OpBackendRequest, OpClock, OpObject, OpSession, OpTerminalAccount } from "./types.js";
import { beginAuthentication, sameData } from "./auth.js";
import { objectBatchCommands, parseObjectSelectors } from "./selectors.js";
import { changeVaultPermissions, expandVaultPermissions } from "./permissions.js";
import { clearPluginDefaults } from "./plugin-scopes.js";

export interface OpAdminHookResult {
  value?: unknown;
  resources?: Readonly<Record<string, readonly OpObject[]>>;
  authentication?: {
    sessions?: readonly OpSession[];
    terminalAccounts?: readonly OpTerminalAccount[];
    signedInSession?: string;
  };
}

export type OpAdminHook = (request: OpBackendRequest, context: OpBackendContext, resources: ReadonlyMap<string, readonly OpObject[]>) => Promise<OpAdminHookResult>;

export interface OpAdminContext extends OpBackendContext {
  adminHooks?: Readonly<Record<string, OpAdminHook>>;
  nextId?: () => string;
  authenticationPolicy?: OpAuthenticationPolicy;
  clock?: OpClock;
}

export const externalCommands = new Set([
  "account add", "signin", "service-account create", "service-account ratelimit",
  "connect server create", "connect token create", "events-api create",
  "user provision", "user recovery begin", "plugin init", "plugin run",
  "item share", "update", "plugin credential import",
]);

const relations: Readonly<Record<string, readonly [string, string, string, string]>> = {
  "group user": ["group", "group", "user", "user"],
  "vault user": ["vault", "vault", "user", "user"],
  "vault group": ["vault", "vault", "group", "group"],
  "connect vault": ["server", "connect server", "vault", "vault"],
  "connect group": ["server", "connect server", "group", "group"],
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function merge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(result, key, { value: record(value) && record(target[key]) ? merge(target[key], value) : structuredClone(value), enumerable: true, configurable: true, writable: true });
  }
  return result;
}

function select(objects: readonly OpObject[], selector: unknown): OpObject {
  if (typeof selector !== "string" || !selector) throw new Error("Object selector is required");
  const folded = selector.toLowerCase();
  const ids = objects.filter(object => object.id.toLowerCase() === folded);
  const matches = ids.length ? ids : objects.filter(object => [object.name, object.title, object.email, object.shorthand, object.url, object.address, object.user_uuid, object.userId].some(value => typeof value === "string" && value.toLowerCase() === folded));
  if (matches.length !== 1) throw new Error(matches.length ? "Ambiguous object selector" : "Object not found");
  return matches[0]!;
}

function selectors(request: OpBackendRequest): string[] {
  if (request.args.length === 1 && request.args[0] === "-") {
    return parseObjectSelectors(request.input);
  }
  if (request.args.length !== 1) throw new Error("One object selector is required");
  return [...request.args];
}

function stringList(value: unknown): string[] {
  if (value === undefined) return [];
  const values = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(values) || values.some(entry => typeof entry !== "string" || !entry)) throw new Error("Invalid list value");
  return [...new Set(values as string[])];
}

function objectId(resources: ReadonlyMap<string, readonly OpObject[]>): string {
  const used = new Set<string>();
  for (const objects of resources.values()) {
    for (const object of objects) {
      used.add(object.id.toLowerCase());
      for (const children of [object.fields, object.sections, object.files]) {
        if (!Array.isArray(children)) continue;
        for (const child of children) {
          if (record(child) && typeof child.id === "string") used.add(child.id.toLowerCase());
        }
      }
    }
  }
  let sequence = 1;
  while (used.has(sequence.toString(36).padStart(26, "a"))) sequence++;
  return sequence.toString(36).padStart(26, "a");
}

export function createAccountScope(request: OpBackendRequest, source: Map<string, OpObject[]>): { resources: Map<string, OpObject[]>; account?: string; commit: (value?: unknown) => void } {
  const accounts = source.get("account") ?? [];
  const globalCommand = request.flags.account === undefined && (request.resource === "account" || (request.resource === "signout" && request.flags.all === true) || request.resource === "item template");
  let selected: OpObject | undefined;
  if (request.flags.account !== undefined) selected = select(accounts, request.flags.account);
  else if (!globalCommand && accounts.length) {
    const session = (source.get("session") ?? []).at(-1);
    if (session) selected = select(accounts, record(session.account) ? session.account.id : session.account);
    else if (accounts.length === 1) selected = accounts[0];
    else throw new Error("Account selection is required");
  }
  if (!selected) return { resources: source, commit() {} };
  const accountId = selected.id;
  const accountReference = (value: unknown): string => select(accounts, record(value) ? value.id : value).id;
  const ownership = (resource: string, object: OpObject, all: ReadonlyMap<string, readonly OpObject[]>, seen = new Set<OpObject>()): string | undefined => {
    if (resource === "account") return object.id;
    if (seen.has(object)) return undefined;
    seen.add(object);
    const owners = new Set<string>();
    if (object.account !== undefined) owners.add(accountReference(object.account));
    const links: [string, string][] = [];
    if (object.vault !== undefined) links.push(["vault", "vault"]);
    if (object.item !== undefined) links.push(["item", "item"]);
    const relation = relations[resource];
    if (relation) links.push([relation[0], relation[1]], [relation[2], relation[3]]);
    if (resource === "connect token") links.push([object.integrationId !== undefined ? "integrationId" : "server", "connect server"]);
    if (resource === "session" && object.user !== undefined) links.push(["user", "user"]);
    for (const [key, target] of links) {
      if (object[key] === undefined || object[key] === "*" || object[key] === "managers") continue;
      const value = object[key];
      const candidates = all.get(target) ?? [];
      const linked = select(candidates, record(value) ? value.id : value);
      const owner = ownership(target, linked, all, new Set(seen));
      if (owner === undefined) return undefined;
      owners.add(owner);
    }
    if (owners.size > 1) throw new Error("Object links cross account boundaries");
    return owners.values().next().value ?? (accounts.length === 1 ? accountId : undefined);
  };
  const resources = new Map<string, OpObject[]>();
  for (const [resource, objects] of source) {
    const visible = objects.filter(object => {
      if (resource === "item template" && object.account === undefined) return true;
      const owner = ownership(resource, object, source);
      if (owner === undefined && resource === request.resource && request.action === "list") throw new Error("Account ownership is unavailable for this resource");
      return owner === accountId;
    });
    resources.set(resource, structuredClone(visible));
  }
  for (const [flag, resource] of [["vault", "vault"], ["current-vault", "vault"], ["destination-vault", "vault"], ["group", "group"], ["user", "user"], ["server", "connect server"]]) {
    const value = request.flags[flag!];
    if (value === undefined) continue;
    if (flag === "vault" && request.action === "create" && ["service-account", "connect token"].includes(request.resource)) {
      const grants = typeof value === "string" ? [value] : value;
      if (!Array.isArray(grants) || grants.some(grant => typeof grant !== "string")) throw new Error("Invalid vault grants");
      for (const grant of grants as string[]) {
        const separator = request.resource === "service-account" ? grant.lastIndexOf(":") : grant.lastIndexOf(",");
        const hasPermissions = separator >= 0 && (request.resource === "service-account" || ["r", "w"].includes(grant.slice(separator + 1)));
        select(resources.get("vault") ?? [], hasPermissions ? grant.slice(0, separator) : grant);
      }
    } else select(resources.get(resource!) ?? [], value);
  }
  if (request.resource === "connect server" && request.action === "create") {
    for (const vault of stringList(request.flags.vaults)) select(resources.get("vault") ?? [], vault);
  }
  const batchInput = request.args.length === 1 && request.args[0] === "-" && objectBatchCommands.includes(`${request.resource} ${request.action}`);
  const inputs = request.resource === "item" && request.action === "create" && Array.isArray(request.input) ? request.input : [request.input];
  for (const input of batchInput ? [] : inputs) {
    if (!record(input)) continue;
    if (input.account !== undefined && accountReference(input.account) !== accountId) throw new Error("Object account differs from selected account");
    if (input.vault !== undefined) select(resources.get("vault") ?? [], record(input.vault) ? input.vault.id : input.vault);
  }
  const targetResource = request.resource === "user recovery" ? "user" : request.resource;
  if (request.resource !== "item template" && request.args[0] !== undefined && request.args[0] !== "-" && ["get", "edit", "update", "delete", "move", "share", "suspend", "reactivate", "confirm", "inspect", "clear", "forget", "begin"].includes(request.action)) {
    try { select(resources.get(targetResource) ?? [], request.args[0]); }
    catch (error) {
      let known = true;
      try { select(source.get(targetResource) ?? [], request.args[0]); }
      catch (lookupError) { if (lookupError instanceof Error && lookupError.message === "Object not found") known = false; }
      if (known) throw error;
    }
  }
  const initial = structuredClone(resources);
  return {
    resources,
    account: accountId,
    commit(value) {
      const projected = (request.resource === "environment" && request.action === "read") || (request.resource === "item" && request.flags.fields !== undefined);
      for (const entry of projected ? [] : Array.isArray(value) ? value : [value]) {
        if (!record(entry) || typeof entry.id !== "string") continue;
        if (entry.account !== undefined && accountReference(entry.account) !== accountId) throw new Error("Result account differs from selected account");
        const id = entry.id.toLowerCase();
        const existing = (source.get(request.resource) ?? []).find(object => object.id.toLowerCase() === id);
        if (existing && ownership(request.resource, existing, source) !== accountId) throw new Error("Result belongs to a different account");
      }
      const changes = new Map<string, OpObject[]>();
      for (const [resource, objects] of resources) {
        const before = initial.get(resource) ?? [];
        if (sameData(objects, before)) continue;
        const originals = new Map(before.map(object => [object.id.toLowerCase(), object]));
        const proposed = new Map(objects.map(object => [object.id.toLowerCase(), object]));
        const current = new Map((source.get(resource) ?? []).map(object => [object.id.toLowerCase(), object]));
        for (const id of new Set([...originals.keys(), ...proposed.keys()])) {
          const original = originals.get(id);
          const replacement = proposed.get(id);
          if (sameData(original, replacement)) continue;
          if (!sameData(current.get(id), original)) throw new Error("Object changed during scoped operation");
          if (replacement === undefined) current.delete(id);
          else {
            const published = structuredClone(replacement);
            if (!original && published.account === undefined && resource !== "account" && resource !== "item template") published.account = accountId;
            current.set(id, published);
          }
        }
        changes.set(resource, [...current.values()]);
      }
      const candidate = new Map([...source, ...changes]);
      for (const [resource, objects] of changes) {
        const scopedIds = new Set((resources.get(resource) ?? []).map(object => object.id));
        for (const object of objects) {
          if (!scopedIds.has(object.id)) continue;
          if (resource === "item template" && object.account === undefined) continue;
          if (ownership(resource, object, candidate) !== accountId) throw new Error("Object account differs from selected account");
        }
      }
      for (const [resource, objects] of changes) source.set(resource, objects);
    }
  };
}

export async function executeAdminRequest(request: OpBackendRequest, context: OpAdminContext, resources: Map<string, OpObject[]>): Promise<{ handled: boolean; value?: unknown }> {
  context.signal.throwIfAborted();
  if (context.binding) throw new Error("Direct admin execution does not support bindings");
  const adminContext = context as OpAdminContext;
  const authentication = beginAuthentication(request, context, resources, adminContext.authenticationPolicy ?? { mode: "object-store" }, adminContext.clock ?? { now: Date.now });
  request = authentication.request;
  const scope = createAccountScope(request, authentication.resources);
  const nextId = (context as OpAdminContext).nextId ?? (() => objectId(resources));
  const result = await executeAdmittedAdminRequest(request, context, scope.resources, nextId, scope.account, authentication.sessionId, authentication.recordSignin);
  context.signal.throwIfAborted();
  if (result.handled) {
    scope.commit(result.value);
    authentication.commit();
  }
  return result;
}

export async function executeAdmittedAdminRequest(request: OpBackendRequest, context: OpBackendContext, resources: Map<string, OpObject[]>, nextId: () => string, selectedAccount?: string, sessionId?: string, recordSignin?: (session: OpSession, nextId: () => string) => void): Promise<{ handled: boolean; value?: unknown }> {
  const { resource, action, args, flags } = request;
  const owned = ["account", "signin", "signout", "whoami", "group", "user", "user recovery", "service-account", "connect server", "connect token", "events-api", "environment", "plugin"];
  context.signal.throwIfAborted();
  const command = action ? `${resource} ${action}` : resource;
  if (command === "signin" && sessionId !== undefined) {
    if (args.length) throw new Error("Unexpected arguments");
    const session = (resources.get("session") ?? []).find(entry => entry.id === sessionId)!;
    recordSignin?.(session as OpSession, nextId);
    return { handled: true, value: session.mode === "manual" ? session.token : undefined };
  }
  if (args.length === 1 && args[0] === "-" && objectBatchCommands.includes(command)) {
    const targetResource = resource === "vault group" ? "vault" : resource;
    const batch = parseObjectSelectors(request.input);
    let candidates = resources.get(targetResource) ?? [];
    if (resource === "item") {
      candidates = candidates.filter(object => object.state !== "DELETED" && (object.state !== "ARCHIVED" || flags["include-archive"] === true || batch.some(selector => object.id.toLowerCase() === selector.toLowerCase())));
      const vaultSelector = action === "move" ? flags["current-vault"] : flags.vault;
      if (vaultSelector !== undefined) {
        const vault = select(resources.get("vault") ?? [], vaultSelector);
        candidates = candidates.filter(object => (record(object.vault) ? object.vault.id : object.vault) === vault.id);
      }
    }
    for (const selector of batch) select(candidates, selector);
  }
  const hook = (context as OpAdminContext).adminHooks?.[command];
  if (context.binding && (hook || externalCommands.has(command))) throw new Error("External admin hooks do not support bindings");
  if (hook || externalCommands.has(command)) {
    if (!hook) throw new Error("Admin command requires an injected hook");
    let result: OpAdminHookResult;
    try {
      const scope = context.pluginScope;
      const hookContext = Object.freeze({
        signal: context.signal,
        ...(context.authentication === undefined ? {} : { authentication: Object.freeze({ ...context.authentication }) }),
        ...(scope === undefined ? {} : { pluginScope: Object.freeze({ cwd: scope.cwd, home: scope.home, ...(scope.terminalSession === undefined ? {} : { terminalSession: scope.terminalSession }) }) }),
      });
      result = await hook(structuredClone(request), hookContext, structuredClone(resources));
      if (!record(result) || (result.resources !== undefined && !record(result.resources))) throw new Error();
      if (result.resources && ["session", "session default", "app default"].some(key => Object.hasOwn(result.resources!, key))) throw new Error("Use typed authentication hook state");
      if (result.authentication !== undefined && (!record(result.authentication) || (result.authentication.sessions !== undefined && !Array.isArray(result.authentication.sessions)) || (result.authentication.terminalAccounts !== undefined && !Array.isArray(result.authentication.terminalAccounts)))) throw new Error();
      for (const entries of Object.values(result.resources ?? {})) {
        if (!Array.isArray(entries)) throw new Error();
        const ids = new Set<string>();
        for (const entry of entries) {
          if (!record(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id.toLowerCase())) throw new Error();
          ids.add(entry.id.toLowerCase());
        }
      }
      result = structuredClone(result);
    } catch {
      throw new Error("Admin hook failed");
    }
    context.signal.throwIfAborted();
    for (const [key, entries] of Object.entries(result.resources ?? {})) resources.set(key, entries as OpObject[]);
    if (result.authentication?.sessions !== undefined) resources.set("session", [...result.authentication.sessions]);
    if (result.authentication?.terminalAccounts !== undefined) resources.set("session default", [...result.authentication.terminalAccounts]);
    if (["signin", "account add"].includes(command) && result.authentication?.sessions?.length) {
      const mode = flags.session === undefined ? context.authentication?.integration ?? "manual" : "manual";
      const candidates = result.authentication.sessions.filter(session => session.mode === mode && (selectedAccount === undefined || session.account === selectedAccount) && (session.mode !== "app" || session.terminalId === context.authentication?.terminalId) && (result.authentication?.signedInSession === undefined || session.id === result.authentication.signedInSession));
      if (candidates.length !== 1) throw new Error("Signin hook must identify its authenticated session");
      recordSignin?.(candidates[0]!, nextId);
    } else if (command === "signin") {
      throw new Error("Signin hook must provide authenticated session state");
    }
    return { handled: true, value: structuredClone(result.value) };
  }

  if (!owned.includes(resource) && !Object.hasOwn(relations, resource) && !(resource === "vault" && action === "list" && (flags.user !== undefined || flags.group !== undefined))) return { handled: false };

  const working = structuredClone(resources);
  const entries = (key: string): OpObject[] => working.get(key) ?? [];
  const account = (): OpObject => {
    if (flags.account !== undefined) return select(entries("account"), flags.account);
    const session = entries("session").at(-1);
    if (session) return select(entries("account"), session.account);
    if (entries("account").length !== 1) throw new Error("Account selection is required");
    return entries("account")[0]!;
  };
  const session = (): OpObject => {
    const candidates = entries("session").filter(entry => sessionId === undefined || entry.id === sessionId).filter(entry => flags.account === undefined || entry.account === account().id).filter(entry => flags.session === undefined || entry.token === flags.session);
    const selected = candidates.at(-1);
    if (!selected) throw new Error("No authenticated session");
    return selected;
  };
  const remove = (key: string, objects: readonly OpObject[]) => {
    const ids = new Set(objects.map(object => object.id));
    working.set(key, entries(key).filter(object => !ids.has(object.id)));
    for (const [relation, [parent, parentResource, child, childResource]] of Object.entries(relations)) {
      working.set(relation, entries(relation).filter(entry => !(parentResource === key && ids.has(String(entry[parent]))) && !(childResource === key && ids.has(String(entry[child])))));
    }
    if (key === "connect server") working.set("connect token", entries("connect token").filter(entry => !ids.has(String(entry.integrationId ?? entry.server))));
    if (key === "account" || key === "user") working.set("session", entries("session").filter(entry => !ids.has(String(entry[key]))));
    if (key === "account") working.set("session default", entries("session default").filter(entry => !ids.has(String(entry.account))));
    if (key === "account") working.set("app default", entries("app default").filter(entry => !ids.has(String(entry.account))));
  };
  let value: unknown;
  if (resource === "whoami" && action === "") {
    if (args.length) throw new Error("Unexpected arguments");
    const current = session();
    value = current.identity ?? select(entries("user"), current.user);
  } else if (resource === "signout" && action === "") {
    if (args.length || (flags.all === true && flags.account !== undefined)) throw new Error("Conflicting account selection");
    const selectedAccounts = flags.all === true ? entries("account") : [account()];
    const ids = new Set(selectedAccounts.map(entry => entry.id));
    working.set("session", entries("session").filter(entry => !ids.has(String(entry.account))));
    working.set("session default", entries("session default").filter(entry => !ids.has(String(entry.account))));
    if (flags.forget === true) remove("account", selectedAccounts);
  } else if (resource === "account") {
    if (action === "list") {
      if (args.length) throw new Error("Unexpected arguments");
      value = entries("account");
    } else if (action === "get") {
      if (args.length > 1) throw new Error("One object selector is required");
      value = args.length ? select(entries("account"), args[0]) : account();
    } else if (action === "forget") {
      if (args.length > 1 || (flags.all === true && (args.length || flags.account !== undefined))) throw new Error("Conflicting account selection");
      remove("account", flags.all === true ? entries("account") : [args.length ? select(entries("account"), args[0]) : account()]);
    } else throw new Error("Unsupported admin action");
  } else if (Object.hasOwn(relations, resource)) {
    const [parent, parentResource, child, childResource] = relations[resource]!;
    if (!["grant", "revoke", "list"].includes(action) || (action === "list" && resource.startsWith("connect"))) throw new Error("Unsupported admin action");
    if (action === "list") {
      if (args[0] === "-" && resource !== "vault group") throw new Error("Batch selectors are unsupported for this relationship");
      const owners = selectors(request).map(selector => select(entries(parentResource), selector));
      value = owners.flatMap(owner => entries(resource).filter(entry => entry[parent] === owner.id).map(entry => ({ ...select(entries(childResource), entry[child]), ...(entry.role === undefined ? {} : { role: entry.role }), ...(entry.permissions === undefined ? {} : { permissions: entry.permissions }) })));
    } else {
      if (args.length) throw new Error("Unexpected arguments");
      if (resource === "connect group" && flags["all-servers"] === true && flags.server !== undefined) throw new Error("Conflicting server selection");
      const owner = resource === "connect group" && flags.server === undefined ? flags["all-servers"] === true ? "*" : "managers" : select(entries(parentResource), flags[parent]).id;
      const member = select(entries(childResource), flags[child]);
      const existing = entries(resource).find(entry => entry[parent] === owner && entry[child] === member.id);
      const permissions = stringList(flags.permissions);
      const role = typeof flags.role === "string" ? flags.role.toLowerCase() : flags.role ?? "member";
      if (resource === "group user" && (typeof role !== "string" || !["member", "manager"].includes(role))) throw new Error("Invalid group role");
      const remaining = resource.startsWith("vault ") ? changeVaultPermissions(stringList(existing?.permissions), permissions, action === "grant" ? "grant" : "revoke") : [];
      const relation: OpObject = { ...existing, id: existing?.id ?? nextId(), [parent]: owner, [child]: member.id, ...(resource === "group user" ? { role } : {}), ...(resource.startsWith("vault ") ? { permissions: remaining } : {}) };
      const others = entries(resource).filter(entry => entry !== existing);
      const keep = action === "grant" || (resource.startsWith("vault ") && remaining.length > 0);
      working.set(resource, keep ? [...others, relation] : others);
      value = keep ? relation : undefined;
    }
  } else if (resource === "environment" && action === "read") {
    const environment = select(entries(resource), selectors(request)[0]);
    if (!record(environment.variables)) throw new Error("Environment variables are unavailable");
    value = environment.variables;
  } else if (resource === "plugin") {
    if (action === "list") {
      if (args.length) throw new Error("Unexpected arguments");
      value = entries(resource);
    } else if (action === "inspect") {
      if (!args.length) throw new Error("Plugin selection capability is unavailable");
      value = select(entries(resource), selectors(request)[0]);
    } else if (action === "clear") {
      if (args.length !== 1 || args[0] === "-") throw new Error("Exactly one plugin is required");
      const plugin = select(entries(resource), args[0]);
      const replacement = await clearPluginDefaults(plugin, context, flags.all === true, flags.force === true);
      context.signal.throwIfAborted();
      const current = resources.get(resource) ?? [];
      if (!sameData(current.find(entry => entry.id === plugin.id), plugin)) throw new Error("Plugin changed during confirmation");
      resources.set(resource, current.map(entry => entry.id === plugin.id ? replacement : entry));
      return { handled: true };
    } else throw new Error("Unsupported admin action");
  } else if (["group", "user", "connect server", "connect token", "vault"].includes(resource)) {
    let candidates = entries(resource);
    if (resource === "connect token" && flags.server !== undefined) {
      const server = select(entries("connect server"), flags.server);
      candidates = candidates.filter(entry => (entry.integrationId ?? entry.server) === server.id);
    }
    if (action === "list") {
      if (args.length) throw new Error("Unexpected arguments");
      for (const [relation, [parent, parentResource, child, childResource]] of Object.entries(relations)) {
        const filterKey = resource === parentResource ? child : resource === childResource ? parent : undefined;
        if (!filterKey || flags[filterKey] === undefined) continue;
        const filterResource = resource === parentResource ? childResource : parentResource;
        const filter = select(entries(filterResource), flags[filterKey]);
        candidates = candidates.flatMap(entry => {
          const grant = entries(relation).find(link => link[filterKey] === filter.id && link[resource === parentResource ? parent : child] === entry.id);
          if (resource === "vault" && !expandVaultPermissions(stringList(flags.permission)).every(permission => expandVaultPermissions(stringList(grant?.permissions)).includes(permission))) return [];
          return grant ? [{ ...entry, ...(relation === "group user" && resource === "user" ? { role: grant.role } : {}) }] : [];
        });
      }
      value = candidates;
    } else if (resource === "group" && action === "create") {
      if (args.length > 1 || (request.input !== undefined && !record(request.input))) throw new Error("Create requires an object input");
      const input = record(request.input) ? request.input : {};
      const name = args[0] ?? input.name;
      const id = input.id ?? nextId();
      if (typeof name !== "string" || !name || typeof id !== "string" || !id || candidates.some(entry => entry.id.toLowerCase() === id.toLowerCase())) throw new Error("Invalid or duplicate object");
      const created = { ...input, id, name, ...(selectedAccount === undefined ? {} : { account: selectedAccount }), ...(flags.description === undefined ? {} : { description: flags.description }) };
      working.set(resource, [...candidates, created]);
      value = created;
    } else {
      const supported = resource === "user" ? ["get", "edit", "delete", "confirm", "suspend", "reactivate"] : ["get", "edit", "delete"];
      if (!supported.includes(action) || resource === "vault") throw new Error("Unsupported admin action");
      if (flags.all === true && args.length) throw new Error("Conflicting user selection");
      const targets = resource === "user" && action === "confirm" && flags.all === true ? candidates.filter(entry => entry.state === "PENDING") : resource === "user" && flags.me === true && action === "get" ? [select(candidates, session().user)] : selectors(request).map(selector => select(candidates, selector));
      if (action === "get") {
        value = targets.map(target => {
          const attribute = flags["public-key"] === true ? "public_key" : flags.fingerprint === true ? "fingerprint" : undefined;
          if (attribute && target[attribute] === undefined) throw new Error("User key material is unavailable");
          return attribute ? target[attribute] : target;
        });
      } else if (action === "delete") {
        if (resource === "connect token") {
          working.set(resource, entries(resource).map(entry => targets.includes(entry) ? { ...entry, state: "REVOKED" } : entry));
        } else remove(resource, targets);
      }
      else {
        const patch = args[0] === "-" ? {} : request.input ?? {};
        if (!record(patch)) throw new Error("Update requires an object input");
        value = targets.map(target => {
          if (Object.hasOwn(patch, "id") && patch.id !== target.id) throw new Error("Object IDs cannot be changed");
          const updated = merge(target, patch) as OpObject;
          for (const key of ["name", "description", "travel-mode"]) if (flags[key] !== undefined) updated[key] = flags[key];
          if (updated["travel-mode"] !== undefined && !["on", "off"].includes(String(updated["travel-mode"]))) throw new Error("Invalid travel mode");
          if (action === "confirm" || action === "reactivate") {
            if (target.state !== (action === "confirm" ? "PENDING" : "SUSPENDED")) throw new Error("Invalid user state transition");
            updated.state = "ACTIVE";
          }
          if (action === "suspend") {
            if (target.state !== "ACTIVE") throw new Error("Invalid user state transition");
            if (flags["deauthorize-devices-after"] !== undefined) throw new Error("Admin command requires an injected hook");
            updated.state = "SUSPENDED";
            working.set("session", entries("session").filter(entry => entry.user !== target.id));
          }
          working.set(resource, entries(resource).map(entry => entry.id === target.id ? updated : entry));
          return updated;
        });
      }
      if (Array.isArray(value) && args[0] !== "-" && flags.all !== true) value = value[0];
    }
  } else throw new Error("Unsupported admin action");
  context.signal.throwIfAborted();
  for (const [key, objects] of working) resources.set(key, objects);
  return { handled: true, value: structuredClone(value) };
}
