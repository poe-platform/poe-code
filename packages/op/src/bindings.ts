import { createAccountScope, externalCommands } from "./admin.js";
import { opCrypto } from "#op-crypto";
import { inspectAuthentication, sameData } from "./auth.js";
import { parseSecretReference } from "./references.js";
import { parseObjectSelectors } from "./selectors.js";
import { selectPluginId } from "./plugin-selection.js";
import { selectCreationVault } from "./object-vaults.js";
import type { OpAdminContext } from "./admin.js";
import type { OpAuthenticationPolicy, OpBackendContext, OpBackendRequest, OpBindingHandle, OpBindingPrepareContext, OpBindingRequestMetadata, OpBindingTarget, OpClock, OpObject, OpPreparedBinding } from "./types.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function normalizeObjectRequest(request: OpBackendRequest): OpBackendRequest {
  if (request.resource === "item" && request.action === "get" && request.args.length === 0 && request.input !== undefined) request = { ...request, args: ["-"] };
  if (request.resource === "item" && request.action === "create" && typeof request.flags.account === "string" && typeof request.flags.vault === "string" && request.input !== undefined) {
    const inputs = Array.isArray(request.input) ? request.input : [request.input];
    const normalized = inputs.map(input => record(input) ? { ...input, account: request.flags.account, vault: request.flags.vault } : input);
    request = { ...request, input: Array.isArray(request.input) ? normalized : normalized[0] };
  }
  return request;
}

function select(objects: readonly OpObject[], selector: unknown): OpObject {
  if (typeof selector !== "string" || !selector) throw new Error("Binding target is required");
  const folded = selector.toLowerCase();
  const ids = objects.filter(object => object.id.toLowerCase() === folded);
  const matches = ids.length ? ids : objects.filter(object => [object.name, object.title, object.label, object.email, object.shorthand, object.url, object.address, object.user_uuid, object.userId].some(value => typeof value === "string" && value.toLowerCase() === folded));
  if (matches.length !== 1) throw new Error("Binding target is missing or ambiguous");
  return matches[0]!;
}

function metadata(source: Map<string, OpObject[]>): Map<string, OpObject[]> {
  const section = (value: unknown) => {
    if (!record(value)) throw new Error("Invalid section metadata");
    return { id: value.id, ...(value.label === undefined ? {} : { label: value.label }) };
  };
  const keys = ["id", "name", "title", "label", "email", "shorthand", "url", "address", "user_uuid", "userId", "account", "vault", "state", "category", "favorite", "tags", "group", "user", "server", "integrationId", "item", "permissions", "terminalId"];
  return new Map([...source].map(([resource, objects]) => [resource, objects.map(object => {
    const result = Object.fromEntries(keys.filter(key => Object.hasOwn(object, key)).map(key => [key, structuredClone(object[key])])) as OpObject;
    if (resource === "item") {
      result.fields = (object.fields as OpObject[] | undefined)?.map(field => ({ ...Object.fromEntries(["id", "label", "name", "type", "purpose"].filter(key => Object.hasOwn(field, key)).map(key => [key, structuredClone(field[key])])), ...(field.section === undefined ? {} : { section: section(field.section) }) }));
      result.files = (object.files as OpObject[] | undefined)?.map(file => ({ id: file.id, name: file.name, ...(file.section === undefined ? {} : { section: section(file.section) }) }));
      result.sections = (object.sections as OpObject[] | undefined)?.map(section);
    }
    return result;
  })]));
}

interface Step {
  original: OpBackendRequest;
  resolved: OpBackendRequest;
  dependencies: { resource: string; id?: string }[];
  status: "pending" | "running" | "complete";
}

interface Binding {
  generation: number;
  expiresAt: number;
  signal: AbortSignal;
  authentication: OpBackendContext["authentication"];
  pluginScope: OpBackendContext["pluginScope"];
  steps: Step[];
  cancelled: boolean;
  staged?: Map<string, OpObject[]>;
  queue: Promise<void>;
  abort: () => void;
}

export function createBindingManager(source: Map<string, OpObject[]>, policy: OpAuthenticationPolicy, clock: OpClock, hasHook: (command: string, context: OpBackendContext) => boolean, defaultVault?: string) {
  const backendId = opCrypto.randomUUID();
  let generation = 0;
  const bindings = new WeakMap<OpBindingHandle, Binding>();
  const environmentMetadata = new WeakMap<OpObject, OpBindingRequestMetadata>();
  function indexEnvironments(): void {
    for (const resource of ["environment", "environment snapshot"]) {
      for (const object of source.get(resource) ?? []) {
        if (environmentMetadata.has(object)) continue;
        const snapshot = resource === "environment snapshot";
        const value = snapshot ? object.snapshot : object;
        let metadata: OpBindingRequestMetadata = {};
        if (record(value) && record(value.variables) && (!snapshot || (value.version === 1 && ["complete", "selected"].includes(String(value.scope))))) {
          const entries = Object.entries(value.variables);
          if (entries.every(([key, value]) => key && !key.includes("=") && !key.includes("\0") && (typeof value === "string" && !value.includes("\0") || snapshot && value === null))) {
            metadata = { environment: Object.freeze({
              names: Object.freeze(entries.map(([key]) => key)),
              ...(snapshot ? { unsetNames: Object.freeze(entries.filter(([, value]) => value === null).map(([key]) => key)), scope: value.scope as "complete" | "selected" } : {}),
              dependenciesComplete: snapshot || entries.every(([, value]) => typeof value === "string" && !value.toLowerCase().includes("op://"))
            }) };
          }
        }
        environmentMetadata.set(object, Object.freeze(metadata));
      }
    }
  }
  indexEnvironments();
  function published(before: ReadonlyMap<string, OpObject[]>): void {
    if (before.size !== source.size || [...source].some(([key, objects]) => before.get(key) !== objects)) {
      indexEnvironments();
      generation++;
    }
  }
  const invalid = () => new Error("Binding is invalid or no longer current");
  function cancel(binding: Binding): void {
    binding.cancelled = true;
    binding.staged = undefined;
    binding.steps = [];
    binding.signal.removeEventListener("abort", binding.abort);
  }
  function validate(handle: OpBindingHandle, context: OpBackendContext): Binding {
    const binding = bindings.get(handle);
    if (!binding) throw invalid();
    try {
      context.signal.throwIfAborted();
      binding.signal.throwIfAborted();
      const now = clock.now();
      if (binding.cancelled || generation !== binding.generation || !Number.isFinite(now) || now >= binding.expiresAt || !sameData(binding.authentication, context.authentication) || !sameData(binding.pluginScope, context.pluginScope)) throw invalid();
      for (const step of binding.steps) inspectAuthentication(step.resolved, context, source, policy, clock);
      return binding;
    } catch {
      cancel(binding);
      throw invalid();
    }
  }
  return {
    async prepareBinding(requests: readonly OpBackendRequest[], context: OpBindingPrepareContext): Promise<OpPreparedBinding> {
      context.signal.throwIfAborted();
      if (context.binding || requests.length > 1024) throw new Error("Invalid binding plan");
      context = Object.freeze({ ...context, authentication: structuredClone(context.authentication), pluginScope: structuredClone(context.pluginScope) });
      const preparedGeneration = generation;
      const now = clock.now();
      const expiresAt = context.expiresAt ?? now + 60_000;
      if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("Invalid binding deadline");
      const targets: OpBindingTarget[] = [];
      const requestMetadata: OpBindingRequestMetadata[] = requests.map(() => Object.freeze({}));
      const accounts = new Set<string | null>();
      const view = requests.length ? metadata(source) : new Map<string, OpObject[]>();
      const steps: Step[] = [];
      for (const [requestIndex, detached] of structuredClone(requests).entries()) {
        let request = normalizeObjectRequest(detached);
        const command = `${request.resource} ${request.action}`.trim();
        if (request.action === "create" && request.input !== undefined && !(record(request.input) || request.resource === "item" && Array.isArray(request.input) && request.input.length > 0 && request.input.every(record))) throw new Error("Create requires an object input");
        const pluginInspect = request.resource === "plugin" && request.action === "inspect";
        if (hasHook(command, context) || externalCommands.has(command) || request.flags["ssh-generate-key"] !== undefined && request.flags["ssh-generate-key"] !== false || request.flags["ssh-format"] || request.resource === "plugin" && !pluginInspect || ["session", "session default", "app default"].includes(request.resource)) throw new Error("Operation does not support bindings");
        if (!pluginInspect && !["list", "get", "create", "edit", "update", "delete", "move", "read"].includes(request.action) || request.resource.includes(" ") && request.resource !== "environment snapshot") throw new Error("Operation does not support bindings");
        request = inspectAuthentication(request, context, source, policy, clock).request;
        const scope = createAccountScope(request, view);
        const resources = scope.resources;
        const account = scope.account;
        if (pluginInspect) {
          if (request.args.length > 1 || request.args[0] === "-") throw new Error("Exactly one plugin is required");
          if (!request.args.length) request = { ...request, args: [await selectPluginId(resources.get("plugin") ?? [], context, account ?? null)] };
          context.signal.throwIfAborted();
          if (generation !== preparedGeneration) throw invalid();
        }
        accounts.add(account ?? null);
        const dependencies: Step["dependencies"] = [];
        const add = (resource: string, object: OpObject, kind: OpBindingTarget["kind"] = "object", parentId?: string): void => {
          targets.push(Object.freeze({ requestIndex, resource, kind, id: object.id, ...(account === undefined ? {} : { account }), ...(parentId === undefined ? {} : { parentId }), revision: String(generation) }));
          if (kind === "object") dependencies.push({ resource, id: object.id });
        };
        const flags: Record<string, string | boolean | readonly string[]> = { ...request.flags, ...(account === undefined ? {} : { account }) };
        if (account !== undefined) add("account", select(resources.get("account") ?? [], account));
        for (const key of ["vault", "current-vault", "destination-vault"]) {
          if (flags[key] !== undefined) {
            const vault = select(resources.get("vault") ?? [], flags[key]);
            flags[key] = vault.id;
            add("vault", vault);
          }
        }
        request = { ...request, flags };
        if (request.resource === "secret" && request.action === "read") {
          if (request.args.length !== 1) throw new Error("One secret reference is required");
          const reference = parseSecretReference(request.args[0]!);
          if (reference.query?.["ssh-format"] !== undefined) throw new Error("SSH hooks do not support bindings");
          const vault = select(resources.get("vault") ?? [], reference.vault);
          const item = select((resources.get("item") ?? []).filter(object => (record(object.vault) ? object.vault.id : object.vault) === vault.id && object.state !== "ARCHIVED" && object.state !== "DELETED"), reference.item);
          let fields = [...item.fields as OpObject[] ?? [], ...item.files as OpObject[] ?? []];
          let section: OpObject | undefined;
          if (reference.section !== undefined) {
            const sections = new Map((item.sections as OpObject[] ?? []).map(entry => [entry.id, entry]));
            for (const field of fields) if (record(field.section) && typeof field.section.id === "string" && !sections.has(field.section.id)) sections.set(field.section.id, field.section as OpObject);
            section = select([...sections.values()], reference.section);
            fields = fields.filter(field => record(field.section) && field.section.id === section!.id);
            add("item", section, "section", item.id);
          }
          const field = select(fields, reference.field);
          add("vault", vault);
          add("item", item);
          add("item", field, "field", item.id);
          const query = request.args[0]!.indexOf("?");
          request = { ...request, args: [`op://${[vault.id, item.id, ...(section ? [section.id] : []), field.id].join("/")}${query < 0 ? "" : request.args[0]!.slice(query)}`] };
        } else {
          const objects = resources.get(request.resource) ?? [];
          const vaulted = ["item", "document"].includes(request.resource);
          let candidates = objects;
          const vaultId = request.action === "move" ? flags["current-vault"] : flags.vault;
          if (vaulted && vaultId !== undefined) candidates = candidates.filter(object => (record(object.vault) ? object.vault.id : object.vault) === vaultId);
          const selected: OpObject[] = [];
          if (["list", "create"].includes(request.action)) {
            targets.push(Object.freeze({ requestIndex, resource: request.resource, kind: "collection", ...(account === undefined ? {} : { account }), revision: String(generation) }));
            dependencies.push({ resource: request.resource });
            if (request.action === "list") {
              if (vaulted) candidates = candidates.filter(object => object.state !== "DELETED" && (object.state !== "ARCHIVED" || flags["include-archive"] === true));
              if (request.resource === "item") {
                const strings = (value: unknown): readonly string[] => typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
                const categories = strings(flags.categories).map(value => value.toUpperCase().split(" ").join("_"));
                const tags = strings(flags.tags);
                candidates = candidates.filter(object => (!categories.length || categories.includes(String(object.category))) && (!flags.favorite || object.favorite === true) && (!tags.length || tags.some(tag => Array.isArray(object.tags) && object.tags.some(value => typeof value === "string" && (value === tag || value.startsWith(`${tag}/`))))));
              }
              selected.push(...candidates);
            }
            else if (vaulted) {
              const inputs = Array.isArray(request.input) ? request.input : [request.input];
              const resolvedInputs: unknown[] = [];
              for (const input of inputs) {
                const selector = flags.vault ?? (record(input) ? input.vault : undefined);
                const vault = selectCreationVault(resources.get("vault") ?? [], selector, defaultVault);
                add("vault", vault);
                resolvedInputs.push({ ...(record(input) ? input : {}), vault: vault.id });
              }
              request = { ...request, input: Array.isArray(request.input) ? resolvedInputs : resolvedInputs[0] };
            }
          } else {
            const batch = request.args[0] === "-";
            const selectors = batch ? parseObjectSelectors(request.input) : request.args.length ? [request.args[0]!] : request.resource === "account" && account !== undefined ? [account] : [];
            if (!selectors.length) throw new Error("Binding target is required");
            for (const selector of selectors) {
              const candidatesForSelector = vaulted ? candidates.filter(object => object.state !== "DELETED" && (object.state !== "ARCHIVED" || flags["include-archive"] === true || object.id.toLowerCase() === selector.toLowerCase())) : candidates;
              selected.push(select(candidatesForSelector, selector));
            }
            if (batch) request = { ...request, input: selected.map(object => ({ id: object.id })) };
            else if (request.args.length) request = { ...request, args: [selected[0]!.id, ...request.args.slice(1)] };
          }
          for (const object of selected) {
            add(request.resource, object);
            if (["environment", "environment snapshot"].includes(request.resource) && ["get", "read"].includes(request.action)) {
              const original = source.get(request.resource)?.find(entry => entry.id === object.id);
              requestMetadata[requestIndex] = original ? environmentMetadata.get(original) ?? Object.freeze({}) : Object.freeze({});
            }
            if (vaulted && object.vault !== undefined) add("vault", select(resources.get("vault") ?? [], record(object.vault) ? object.vault.id : object.vault));
            if (request.resource === "item" && request.action === "get") {
              const fields = object.fields as OpObject[] ?? [];
              let selectedFields = fields;
              if (flags.fields !== undefined) {
                const selectors = typeof flags.fields === "string" ? flags.fields.split(",") : Array.isArray(flags.fields) ? flags.fields : [];
                selectedFields = selectors.flatMap(selector => {
                  const separator = selector.indexOf("=");
                  const key = separator < 0 ? "label" : selector.slice(0, separator);
                  const value = (separator < 0 ? selector : selector.slice(separator + 1)).toLowerCase();
                  if (!["label", "type"].includes(key)) throw new Error("Unsupported field selector");
                  const matches = fields.filter(field => String(field[key] ?? (key === "label" ? field.id : "")).toLowerCase() === value);
                  if (!matches.length) throw new Error("Field not found");
                  return matches;
                });
              } else if (flags.otp) selectedFields = fields.filter(field => field.type === "OTP").slice(0, 1);
              for (const field of selectedFields) {
                if (record(field.section) && typeof field.section.id === "string") add("item", field.section as OpObject, "section", object.id);
                add("item", field, "field", object.id);
              }
            }
          }
        }
        steps.push({ original: detached, resolved: request, dependencies, status: "pending" });
      }
      if (generation !== preparedGeneration) throw invalid();
      if (accounts.size > 1) throw new Error("A binding requires one account scope");
      const handle = Object.freeze({}) as OpBindingHandle;
      const binding: Binding = { generation, expiresAt, signal: context.signal, authentication: structuredClone(context.authentication), pluginScope: structuredClone(context.pluginScope), steps, cancelled: false, queue: Promise.resolve(), abort: () => cancel(binding) };
      bindings.set(handle, binding);
      context.signal.addEventListener("abort", binding.abort, { once: true });
      validate(handle, context);
      return Object.freeze({ backendId, accountId: accounts.values().next().value ?? null, handle, targets: Object.freeze(targets), metadata: Object.freeze(requestMetadata) });
    },
    validateBinding(handle: OpBindingHandle, context: OpBackendContext): void { validate(handle, context); },
    cancelBinding(handle: OpBindingHandle): void {
      const binding = bindings.get(handle);
      if (!binding) throw invalid();
      cancel(binding);
    },
    published,
    async execute(request: OpBackendRequest, context: OpAdminContext, operation: (request: OpBackendRequest, resources: Map<string, OpObject[]>) => Promise<unknown>): Promise<unknown> {
      const handle = context.binding!;
      const binding = validate(handle, context);
      const step = binding.steps.find(candidate => candidate.status === "pending" && sameData(candidate.original, request));
      if (!step || hasHook(`${request.resource} ${request.action}`.trim(), context)) { cancel(binding); throw invalid(); }
      step.status = "running";
      const previous = binding.queue;
      let release!: () => void;
      binding.queue = new Promise<void>(resolve => { release = resolve; });
      try {
        await previous;
        validate(handle, context);
        binding.staged ??= structuredClone(source);
        for (const dependency of step.dependencies) {
          const original = source.get(dependency.resource);
          const staged = binding.staged.get(dependency.resource);
          if (!sameData(dependency.id === undefined ? original : original?.find(object => object.id === dependency.id), dependency.id === undefined ? staged : staged?.find(object => object.id === dependency.id))) throw invalid();
        }
        const result = await operation(structuredClone(step.resolved), binding.staged);
        validate(handle, context);
        step.status = "complete";
        if (binding.steps.every(candidate => candidate.status === "complete")) {
          const before = new Map(source);
          for (const [resource, objects] of binding.staged) if (!sameData(source.get(resource), objects)) source.set(resource, objects);
          published(before);
          binding.generation = generation;
          binding.staged = undefined;
        }
        return result;
      } catch (error) {
        cancel(binding);
        throw error;
      } finally { release(); }
    }
  };
}
