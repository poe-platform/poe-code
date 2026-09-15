import { deriveItemFieldReferences, parseSecretReference } from "./references.js";
import { opCrypto } from "#op-crypto";
import { generateOtp } from "./otp.js";
import { createAccountScope, executeAdmittedAdminRequest } from "./admin.js";
import { beginAuthentication, validateAuthentication } from "./auth.js";
import { objectBatchCommands, parseObjectSelectors } from "./selectors.js";
import { validateVaultOptions } from "./vault-options.js";
import { getItemTemplate, listItemTemplates } from "./templates.js";
import { createBindingManager, normalizeObjectRequest } from "./bindings.js";
import { availablePlugins } from "./plugin-catalog.js";
import { selectCreationVault } from "./object-vaults.js";
import type { OpAdminContext } from "./admin.js";
import type { OpBackendRequest, OpField, OpFile, OpItem, OpObject, OpObjectBackend, OpObjectBackendOptions, OpSection } from "./types.js";

function strings(value: OpBackendRequest["flags"][string]): readonly string[] {
  return typeof value === "string" ? value === "" ? [] : value.split(",") : Array.isArray(value) ? value : [];
}

function generatePassword(recipe: string | boolean | readonly string[]): string {
  const alphabets: Record<string, string> = { letters: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", digits: "0123456789", symbols: "!@.-_*" };
  let length = 32;
  let alphabet = "";
  let hasLength = false;
  for (const part of recipe === true || recipe === "" ? ["letters", "digits", "symbols"] : strings(recipe)) {
    const label = part.toLowerCase();
    const digits = part.startsWith("+") ? part.slice(1) : part;
    if (Object.hasOwn(alphabets, label)) alphabet += alphabets[label];
    else if (digits.length && [...digits].every(character => "0123456789".includes(character)) && !hasLength) { length = Number(digits); hasLength = true; }
    else throw new Error("Invalid password recipe");
  }
  if (!Number.isInteger(length) || length < 1 || length > 64) throw new Error("Password length must be between 1 and 64");
  if (!alphabet) alphabet = Object.values(alphabets).join("");
  alphabet = [...new Set(alphabet)].join("");
  const cutoff = 256 - (256 % alphabet.length);
  let password = "";
  while (password.length < length) {
    for (const byte of opCrypto.getRandomValues(new Uint8Array(64))) {
      if (byte < cutoff) password += alphabet[byte % alphabet.length];
      if (password.length === length) break;
    }
  }
  return password;
}

export function parseAssignment(source: string): { section?: string; field: string; type?: string; value?: string } {
  const names: string[] = [];
  let name = "";
  let offset = 0;
  for (; offset < source.length; offset++) {
    const character = source[offset]!;
    if (character === "\\") {
      const next = source[++offset];
      if (!next || !".\\=".includes(next)) throw new Error("Invalid field name escape");
      name += next;
    } else if (character === ".") { names.push(name); name = ""; }
    else if (character === "=" || character === "[") break;
    else name += character;
  }
  names.push(name);
  if (names.length > 2 || names.some(part => !part)) throw new Error("Invalid field assignment");
  let type: string | undefined;
  if (source[offset] === "[") {
    const closing = source.indexOf("]", offset);
    if (closing < 0) throw new Error("Invalid field type");
    type = source.slice(offset + 1, closing);
    offset = closing + 1;
  }
  if (offset < source.length && source[offset] !== "=") throw new Error("Invalid field assignment");
  if (offset === source.length && !type) throw new Error("Assignment requires a value or type");
  return { ...(names.length === 2 ? { section: names[0]! } : {}), field: names.at(-1)!, ...(type === undefined ? {} : { type }), ...(source[offset] === "=" ? { value: source.slice(offset + 1) } : {}) };
}

function itemPatch(input: Record<string, unknown>, args: readonly string[], flags: OpBackendRequest["flags"], nextId: () => string): Record<string, unknown> {
  const result = structuredClone(input);
  for (const key of ["title", "category"]) if (typeof flags[key] === "string") result[key] = flags[key];
  if (typeof result.category === "string") result.category = result.category.toUpperCase().split(" ").join("_");
  if (flags.tags !== undefined) result.tags = [...strings(flags.tags)];
  if (flags.favorite !== undefined) result.favorite = flags.favorite === true || flags.favorite === "true";
  if (typeof flags.url === "string") result.urls = [{ href: flags.url, primary: true }];
  if (flags["ssh-generate-key"]) throw new Error("SSH generation is not supported by the object backend");
  const fields = structuredClone(result.fields ?? []) as OpField[];
  const files = structuredClone(result.files ?? []) as OpFile[];
  let sections = structuredClone(result.sections ?? []) as OpSection[];
  if (!Array.isArray(fields) || !Array.isArray(files) || !Array.isArray(sections)) throw new Error("Item fields, files and sections must be arrays");
  for (const field of fields) if (record(field)) delete field.reference;
  for (const section of sections) {
    if (!record(section)) throw new Error("Invalid item section");
    if (section.id === undefined) section.id = nextId();
    if (typeof section.id !== "string" || !section.id) throw new Error("Invalid item section ID");
  }
  for (const member of [...fields, ...files]) {
    if (!record(member)) throw new Error("Invalid item field or file");
    if (member.id === undefined) member.id = nextId();
    if (typeof member.id !== "string" || !member.id) throw new Error("Invalid item field or file ID");
    if (member.section === undefined) continue;
    const reference = member.section;
    if (!record(reference) || (typeof reference.id !== "string" && typeof reference.label !== "string")) throw new Error("Invalid item section reference");
    const matches = sections.filter(section => typeof reference.id === "string" ? section.id === reference.id : section.label?.split(" ").join("").toLowerCase() === reference.label?.split(" ").join("").toLowerCase());
    if (matches.length > 1) throw new Error("Ambiguous section");
    const section = matches[0] ?? { ...reference, id: reference.id ?? nextId() };
    if (!matches.length) sections.push(section);
    member.section = { ...section };
  }
  const types: Record<string, string> = { text: "STRING", password: "CONCEALED", email: "EMAIL", url: "URL", phone: "PHONE", otp: "OTP", date: "DATE", monthyear: "MONTH_YEAR", address: "ADDRESS", reference: "REFERENCE", menu: "MENU", concealed: "CONCEALED" };
  for (const source of args) {
    const parsed = parseAssignment(source);
    let section: OpSection | undefined;
    if (parsed.section) {
      const matches = sections.filter(entry => entry.id === parsed.section || entry.label?.split(" ").join("").toLowerCase() === parsed.section!.split(" ").join("").toLowerCase());
      if (matches.length > 1) throw new Error("Ambiguous section");
      section = matches[0];
      if (!section) { section = { id: nextId(), label: parsed.section }; sections.push(section); }
    }
    const matches = fields.filter(field => (!section || field.section?.id === section.id) && [field.id, field.label, field.name, field.n].some(value => typeof value === "string" && value.split(" ").join("").toLowerCase() === parsed.field.split(" ").join("").toLowerCase()));
    if (matches.length > 1) throw new Error("Ambiguous field");
    let field = matches[0];
    if (parsed.type === "delete") {
      if (!field) throw new Error("Field not found");
      if (field.purpose) throw new Error("Built-in fields cannot be deleted");
      fields.splice(fields.indexOf(field), 1);
      if (field.section && ![...fields, ...files].some(entry => entry.section?.id === field!.section!.id)) sections = sections.filter(entry => entry.id !== field!.section!.id);
      continue;
    }
    if (parsed.type && !Object.hasOwn(types, parsed.type)) throw new Error("Unsupported field type");
    if (!field) {
      const purpose = !section && ["username", "password", "notesPlain"].includes(parsed.field) ? ({ username: "USERNAME", password: "PASSWORD", notesPlain: "NOTES" } as Record<string, string>)[parsed.field] : undefined;
      field = { id: purpose ? parsed.field : nextId(), label: parsed.field, type: parsed.field === "password" ? "CONCEALED" : "STRING", ...(purpose ? { purpose } : {}), ...(section ? { section } : {}) };
      fields.push(field);
    }
    if (parsed.type) field.type = types[parsed.type];
    if (parsed.value !== undefined) field.value = parsed.value;
  }
  result.fields = fields;
  if (result.files !== undefined) result.files = files;
  result.sections = sections;
  if (flags["generate-password"] !== undefined && flags["generate-password"] !== false) {
    if (!["LOGIN", "PASSWORD"].includes(String(result.category))) throw new Error("Password generation requires a Login or Password item");
    let password = fields.find(field => field.purpose === "PASSWORD" || field.id === "password");
    if (!password) { password = { id: "password", label: "password", purpose: "PASSWORD", type: "CONCEALED" }; fields.push(password); }
    password.value = generatePassword(flags["generate-password"]);
  }
  return result;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function merge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    Object.defineProperty(result, key, { value: record(value) && record(target[key]) ? merge(target[key], value) : structuredClone(value), writable: true, enumerable: true, configurable: true });
  }
  return result;
}

function select<T extends OpObject>(objects: readonly T[], selector: string): T {
  const folded = selector.toLowerCase();
  const ids = objects.filter(object => object.id.toLowerCase() === folded);
  const matches = ids.length ? ids : objects.filter(object => [object.name, object.title, object.label].some(value => typeof value === "string" && value.toLowerCase() === folded));
  if (matches.length !== 1) throw new Error(matches.length ? "Ambiguous object selector" : "Object not found");
  return matches[0]!;
}

export function createObjectBackend(options: OpObjectBackendOptions = {}): OpObjectBackend {
  const resources = new Map<string, OpObject[]>();
  const adminHooks = { ...options.adminHooks };
  const authenticationPolicy = { ...options.authentication ?? { mode: "object-store" as const } };
  const clock = options.clock ?? { now: Date.now };
  const ssh = options.ssh === undefined ? undefined : { ...options.ssh };
  let sequence = 0;
  function nextId(): string {
    let id: string;
    do { id = (++sequence).toString(36).padStart(26, "a"); } while ([...resources.values()].some(entries => entries.some(entry => entry.id.toLowerCase() === id || [entry.fields, entry.sections, entry.files].some(children => Array.isArray(children) && children.some(child => record(child) && typeof child.id === "string" && child.id.toLowerCase() === id)))));
    return id;
  }
  for (const [resource, objects] of Object.entries({ ...options.resources, vault: options.vaults ?? options.resources?.vault ?? [], item: options.items ?? options.resources?.item ?? [], document: options.documents ?? options.resources?.document ?? [], account: options.accounts ?? options.resources?.account ?? [] })) {
    const entries = structuredClone(objects) as OpObject[];
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!record(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id.toLowerCase())) throw new Error("Invalid or duplicate object ID");
      ids.add(entry.id.toLowerCase());
    }
    resources.set(resource, entries);
  }

  let defaultVault: string | undefined;
  if (options.defaultVault !== undefined) {
    const supplied = options.defaultVault;
    const vault = typeof supplied === "string" && supplied ? resources.get("vault")?.find(vault => vault.id.toLowerCase() === supplied.toLowerCase()) : undefined;
    if (!vault) throw new Error("defaultVault must identify an existing vault ID");
    defaultVault = vault.id;
  }
  validateAuthentication(resources, authenticationPolicy);

  function vaultReference(value: unknown, source = resources): { id: string; name?: string } {
    const selector = typeof value === "string" ? value : record(value) ? value.id : undefined;
    if (typeof selector !== "string" || !selector) throw new Error("A vault is required");
    const vault = select(source.get("vault") ?? [], selector);
    return { id: vault.id, ...(vault.name === undefined ? {} : { name: vault.name }) };
  }

  for (const item of resources.get("item") ?? []) item.vault = vaultReference(item.vault);
  for (const document of resources.get("document") ?? []) if (document.vault !== undefined) document.vault = vaultReference(document.vault);

  const bindings = createBindingManager(resources, authenticationPolicy, clock, (command, context) => Object.hasOwn(adminHooks, command) || Object.hasOwn((context as OpAdminContext).adminHooks ?? {}, command), defaultVault);

  return {
    prepareBinding: bindings.prepareBinding,
    validateBinding: bindings.validateBinding,
    cancelBinding: bindings.cancelBinding,
    snapshot() {
      const { vault, item, document, account, ...extensions } = Object.fromEntries(resources);
      return structuredClone({ vaults: vault, items: item, documents: document, accounts: account, resources: extensions, ...(defaultVault === undefined ? {} : { defaultVault }), ...(authenticationPolicy.mode === "managed" ? { authentication: authenticationPolicy } : {}) }) as unknown as OpObjectBackendOptions;
    },
    async execute(request, context) {
      context.signal.throwIfAborted();
      const prepared = !context.binding && request.resource === "plugin" && request.action === "inspect" && request.args.length === 0
        ? await bindings.prepareBinding([request], context) : undefined;
      if (prepared) context = { ...context, binding: prepared.handle };
      async function executeOperation(request: OpBackendRequest, executionResources: Map<string, OpObject[]>): Promise<unknown> {
      request = normalizeObjectRequest(request);
      const authentication = beginAuthentication(request, context, executionResources, authenticationPolicy, clock);
      request = authentication.request;
      const scope = createAccountScope(request, authentication.resources);
      async function executeScoped(resources: Map<string, OpObject[]>): Promise<unknown> {
      const { resource, action, args, flags } = request;
      if (["session", "session default"].includes(resource)) throw new Error("Session state requires typed authentication hooks");
      const command = action ? `${resource} ${action}` : resource;
      const batch = args.length === 1 && args[0] === "-" && objectBatchCommands.includes(command);
      const targetSelectors = batch ? parseObjectSelectors(request.input) : args;
      const vaulted = resource === "item" || resource === "document";
      const invocationHooks = { ...adminHooks, ...context.adminHooks };
      if (resource === "plugin" && !Object.hasOwn(invocationHooks, command)) {
        const configured = resources.get("plugin") ?? [];
        if (action === "list") {
          if (args.length) throw new Error("Unexpected arguments");
          return availablePlugins(configured);
        }
        if (action === "inspect" && args.length === 1 && !configured.some(plugin => plugin.id.toLowerCase() === args[0]!.toLowerCase()) && availablePlugins([]).some(plugin => plugin.executable?.toLowerCase() === args[0]!.toLowerCase())) throw new Error("Plugin configuration is unavailable");
      }
      if (Object.hasOwn(invocationHooks, command) || !(resource === "account" && ["create", "edit", "update", "delete"].includes(action))) {
        const adminContext = { ...context, adminHooks: invocationHooks, nextId };
        const admin = await executeAdmittedAdminRequest(action === "update" ? { ...request, action: "edit" } : request, adminContext, resources, nextId, scope.account, authentication.sessionId, authentication.recordSignin);
        context.signal.throwIfAborted();
        if (admin.handled) return admin.value;
      }
      if (resource === "item template") {
        const templates = resources.get(resource) ?? [];
        if (action === "list" && !args.length) return listItemTemplates(templates);
        if (action === "get" && args.length === 1) return getItemTemplate(args[0]!, templates);
        throw new Error("Invalid item template request");
      }
      if (resource === "secret" && action === "read") {
        if (args.length !== 1) throw new Error("One secret reference is required");
        const reference = parseSecretReference(args[0]!);
        const vault = select(resources.get("vault") ?? [], reference.vault);
        const items = (resources.get("item") ?? []).filter(item => item.state !== "DELETED" && item.state !== "ARCHIVED" && record(item.vault) && item.vault.id === vault.id) as OpItem[];
        const item = select(items, reference.item);
        let candidates: (OpField | OpFile)[] = [...item.fields ?? [], ...item.files ?? []];
        if (reference.section) {
          const sections = new Map<string, OpSection>();
          for (const section of item.sections ?? []) sections.set(section.id, section);
          for (const field of candidates) if (field.section) sections.set(field.section.id, { ...field.section, ...sections.get(field.section.id) });
          const section = select([...sections.values()], reference.section);
          candidates = candidates.filter(field => field.section?.id === section.id);
        }
        const field = select(candidates, reference.field);
        const attribute = reference.query?.attribute ?? reference.query?.attr ?? (Object.hasOwn(field, "content") ? "content" : "value");
        const sshFormat = reference.query?.["ssh-format"];
        if (sshFormat !== undefined) {
          if (!ssh) throw new Error("SSH transformation requires an injected hook");
          if (sshFormat !== "openssh" && sshFormat !== "pkcs1" && sshFormat !== "pkcs8") throw new Error("Unsupported SSH format");
          if (attribute !== "value" || field.type !== "SSHKEY" || typeof field.value !== "string") throw new Error("SSH private key field is unavailable");
          context.signal.throwIfAborted();
          try { return await ssh.transform(field.value, sshFormat); }
          finally { context.signal.throwIfAborted(); }
        }
        if (attribute === "otp") {
          if (field.type !== "OTP" || typeof field.value !== "string") throw new Error("OTP field is unavailable");
          const code = await generateOtp(field.value);
          context.signal.throwIfAborted();
          return code;
        }
        const attributes = item.files?.some(file => file === field) ? ["type", "content", "size", "id", "name"] : ["type", "value", "id", "purpose"];
        if (!attributes.includes(attribute) || !Object.hasOwn(field, attribute)) throw new Error("Secret attribute is unavailable");
        return structuredClone(field[attribute]);
      }
      if (!["list", "get", "create", "edit", "update", "delete", ...(resource === "item" ? ["move"] : [])].includes(action)) throw new Error("Unsupported backend action");
      if (!resource) throw new Error("Resource is required");
      const objects = resources.get(resource) ?? [];
      let candidates = vaulted ? objects.filter(object => object.state !== "DELETED" && (object.state !== "ARCHIVED" || flags["include-archive"] === true || (action !== "list" && targetSelectors.some(selector => object.id.toLowerCase() === selector.toLowerCase())))) : objects;
      const vaultSelector = action === "move" ? flags["current-vault"] : flags.vault;
      if (typeof vaultSelector === "string") {
        const vault = vaultReference(vaultSelector, resources);
        candidates = candidates.filter(object => record(object.vault) ? object.vault.id === vault.id : object.vault === vault.id);
      }
      if (action === "list") {
        if (args.length) throw new Error("List does not accept a selector");
        if (resource === "item") {
          const categories = strings(flags.categories).map(value => value.toUpperCase().split(" ").join("_"));
          const tags = strings(flags.tags);
          candidates = candidates.filter(object => (!categories.length || categories.includes(String(object.category))) && (!flags.favorite || object.favorite === true) && (!tags.length || tags.some(tag => Array.isArray(object.tags) && object.tags.some(value => typeof value === "string" && (value === tag || value.startsWith(`${tag}/`))))));
        }
        return structuredClone(candidates);
      }
      if (action === "create") {
        const bulk = resource === "item" && Array.isArray(request.input);
        const inputs = bulk ? request.input as unknown[] : [request.input ?? {}];
        if (!inputs.length || inputs.some(input => !record(input))) throw new Error("Create requires an object input");
        const createdItems: OpObject[] = [];
        for (const source of inputs) {
        let input = structuredClone(source) as Record<string, unknown>;
        if (resource === "item") {
          const copying = input.id !== undefined;
          for (const key of ["id", "version", "created_at", "updated_at", "last_edited_by"]) delete input[key];
          const keyType = flags["ssh-generate-key"];
          if (keyType !== undefined && keyType !== false) {
            if (!ssh) throw new Error("SSH generation requires an injected hook");
            let type = keyType === true || keyType === "" ? "ed25519" : keyType;
            if (typeof type === "string") {
              type = type.toLowerCase();
              if (type.startsWith("rsa-")) type = `rsa${type.slice(4)}`;
            }
            if (typeof type !== "string" || !["ed25519", "rsa", "rsa2048", "rsa3072", "rsa4096"].includes(type)) throw new Error("Unsupported SSH key type");
            const category = flags.category ?? input.category;
            if (category !== undefined && (typeof category !== "string" || category.toUpperCase().split(" ").join("_") !== "SSH_KEY")) throw new Error("SSH generation requires the SSH Key category");
            context.signal.throwIfAborted();
            let generated: Awaited<ReturnType<NonNullable<OpObjectBackendOptions["ssh"]>["generate"]>>;
            try { generated = await ssh.generate(type); }
            finally { context.signal.throwIfAborted(); }
            if (generated.category !== "SSH_KEY" || !Array.isArray(generated.fields)) throw new Error("Invalid generated SSH key");
            const fields = new Map((Array.isArray(input.fields) ? input.fields : []).map((field: OpField) => [field.id, field]));
            for (const field of generated.fields) fields.set(field.id, structuredClone(field));
            input = { ...input, category: generated.category, fields: [...fields.values()] };
          }
          const category = flags.category ?? input.category;
          if (typeof category === "string") {
            if (input.title !== undefined && typeof input.title !== "string") throw new Error("Item title must be a string");
            const supplied = typeof input.category === "string" && Array.isArray(input.fields) ? { ...input, id: input.category, title: typeof input.title === "string" ? input.title : "" } : undefined;
            const template = getItemTemplate(category, resources.get("item template") ?? [], supplied);
            const fields = new Map(template.fields.map(field => [field.id, field]));
            if (input.fields !== undefined && !Array.isArray(input.fields)) throw new Error("Item fields must be an array");
            for (const field of input.fields as unknown[] ?? []) {
              if (!record(field) || typeof field.id !== "string") throw new Error("Item fields require IDs");
              fields.set(field.id, merge(fields.get(field.id) ?? {}, field) as OpField);
            }
            input = { ...merge(template, input), category: template.category, fields: [...fields.values()] };
          }
          input = itemPatch(input, args[0] === "-" ? args.slice(1) : args, { ...flags, "ssh-generate-key": false, ...(typeof input.category === "string" ? { category: input.category } : {}) }, nextId);
          if (copying) {
            const sectionIds = new Map<string, string>();
            for (const section of input.sections as OpSection[]) {
              const folded = section.id.toLowerCase();
              if (sectionIds.has(folded)) throw new Error("Duplicate item section ID");
              const id = nextId();
              sectionIds.set(folded, id);
              section.id = id;
            }
            for (const field of input.fields as OpField[]) {
              if (!field.purpose && !["username", "password", "notesPlain"].includes(field.id)) field.id = nextId();
            }
            for (const file of input.files as OpFile[] ?? []) file.id = nextId();
            for (const member of [...input.fields as OpField[], ...input.files as OpFile[] ?? []]) {
              if (member.section) member.section.id = sectionIds.get(member.section.id.toLowerCase()) ?? member.section.id;
            }
          }
        }
        else if (resource === "vault") {
          if (args.length > 1) throw new Error("One vault name is required");
          if (args[0] !== undefined) input.name = args[0];
          for (const key of ["description", "icon", "allow-admins-to-manage"]) if (flags[key] !== undefined) input[key] = flags[key];
          validateVaultOptions(input);
        } else if (args.length || request.input === undefined) throw new Error("Create requires an object input");
        let id = input.id;
        if (id === undefined) {
          id = nextId();
        }
        if (typeof id !== "string" || !id || objects.some(object => object.id.toLowerCase() === id.toLowerCase())) throw new Error("Invalid or duplicate object ID");
        const created: OpObject = { ...input, id, ...(scope.account !== undefined && resource !== "account" ? { account: scope.account } : {}) };
        if (vaulted) {
          created.vault = vaultReference(selectCreationVault(resources.get("vault") ?? [], flags.vault ?? input.vault, defaultVault).id, resources);
          created.state = "ACTIVE";
        }
        context.signal.throwIfAborted();
        const current = [...resources.get(resource) ?? [], ...createdItems];
        if (current.some(entry => entry.id.toLowerCase() === created.id.toLowerCase())) throw new Error("Invalid or duplicate object ID");
        createdItems.push(created);
        }
        if (!flags["dry-run"]) resources.set(resource, [...resources.get(resource) ?? [], ...createdItems]);
        return structuredClone(bulk ? createdItems : createdItems[0]);
      }
      if (args.length < 1 || (args.length > 1 && !(resource === "item" && ["edit", "update"].includes(action)))) throw new Error("One object selector is required");
      const targets = (batch ? targetSelectors : [args[0]!]).map(selector => select(candidates, selector));
      if (action === "get") {
        const values = await Promise.all(targets.map(async object => {
        if (resource === "item") object = deriveItemFieldReferences(object as OpItem);
        if (resource === "item" && flags.fields !== undefined) {
          const fields = (object as OpItem).fields ?? [];
          const selected: OpField[] = [];
          for (const selector of strings(flags.fields)) {
            const separator = selector.indexOf("=");
            const key = separator < 0 ? "label" : selector.slice(0, separator);
            const value = (separator < 0 ? selector : selector.slice(separator + 1)).toLowerCase();
            if (!["label", "type"].includes(key)) throw new Error("Unsupported field selector");
            const matches = fields.filter(field => String(field[key] ?? (key === "label" ? field.id : "")).toLowerCase() === value);
            if (!matches.length) throw new Error("Field not found");
            for (const field of matches) if (!selected.includes(field)) selected.push(field);
          }
          return structuredClone(selected);
        }
        if (resource === "item" && flags.otp) {
          const field = (object as OpItem).fields?.find(candidate => candidate.type === "OTP");
          if (typeof field?.value !== "string") throw new Error("OTP field is unavailable");
          const code = await generateOtp(field.value);
          context.signal.throwIfAborted();
          return code;
        }
        return structuredClone(object);
        }));
        return batch ? resource === "item" && flags.fields !== undefined ? values.flat() : values : values[0];
      }
      if (action === "delete") {
        if (resource === "vault" && targets.some(object => [...resources.values()].some(entries => entries.some(entry => entry.state !== "DELETED" && (record(entry.vault) ? entry.vault.id === object.id : entry.vault === object.id))))) throw new Error("Vault is not empty");
        resources.set(resource, vaulted ? objects.map(entry => targets.includes(entry) ? { ...entry, state: flags.archive ? "ARCHIVED" : "DELETED" } : entry) : objects.filter(entry => !targets.includes(entry)));
        return undefined;
      }
      if (action === "move") {
        const destination = vaultReference(flags["destination-vault"], resources);
        const moved = [...new Set(targets)].map(object => {
          const item = { ...structuredClone(object), id: nextId(), vault: destination } as OpItem;
          for (const field of item.fields ?? []) delete field.reference;
          return item;
        });
        resources.set(resource, [...objects.map(entry => targets.includes(entry) ? { ...entry, state: "DELETED" } : entry), ...moved]);
        return structuredClone(batch ? moved : moved[0]);
      }
      if (!batch && request.input !== undefined && !record(request.input)) throw new Error("Update requires an object input");
      const patch = (batch ? {} : request.input ?? {}) as Record<string, unknown>;
      const updates = new Map(targets.map(object => {
        if (Object.hasOwn(patch, "id") && patch.id !== object.id) throw new Error("Object IDs cannot be changed");
        let updated = merge(object, patch) as OpObject;
        if (resource === "item") updated = itemPatch(updated, args.slice(1), flags, nextId) as OpObject;
        if (resource === "vault") {
          for (const key of ["name", "description", "icon", "travel-mode"]) if (flags[key] !== undefined) updated[key] = flags[key];
          validateVaultOptions(updated);
        }
        if (vaulted) updated.vault = vaultReference(updated.vault, resources);
        return [object, updated] as const;
      }));
      context.signal.throwIfAborted();
      if (!flags["dry-run"]) resources.set(resource, objects.map(entry => updates.get(entry) ?? entry));
      return structuredClone(batch ? targets.map(object => updates.get(object)!) : updates.get(targets[0]!));
      }
      const result = await executeScoped(scope.resources);
      context.signal.throwIfAborted();
      if (context.binding) bindings.validateBinding(context.binding, context);
      scope.commit(result);
      if (defaultVault !== undefined && !authentication.resources.get("vault")?.some(vault => vault.id === defaultVault)) throw new Error("Cannot remove the configured default vault");
      const beforeCommit = new Map(executionResources);
      authentication.commit();
      if (!context.binding) bindings.published(beforeCommit);
      return result;
      }
      try { return await (context.binding ? bindings.execute(request, context, executeOperation) : executeOperation(request, resources)); }
      finally { if (prepared) bindings.cancelBinding(prepared.handle); }
    }
  };
}
