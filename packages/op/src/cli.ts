import type { OpBackend, OpBackendContext, OpBackendRequest, OpBindingTarget, OpPreparedBinding } from "./types.js";
import type { OpHandlerPreparation, OpPreparedEffect, OpPreparedHandler } from "./handler-preparation.js";
import { createOpTextCodec } from "./encoding.js";
import { createCompletionCallbackHandler } from "./completion.js";
import { renderOpHelp } from "./help-renderer.js";
import { renderPluginList } from "./plugin-list-output.js";
import { validateOpFlagValue } from "./flag-values.js";
import { parseOpFileMode } from "./file-mode.js";
import { parseOpCsv } from "./csv-values.js";
export { parseOpFileMode } from "./file-mode.js";
export { createOpTextCodec } from "./encoding.js";
import { opCommandCatalog, opGlobalFlags, opRootFlags, type OpCatalogCommand, type OpFlagDefinition } from "./catalog.js";

export interface OpOutputSink {
  isTTY?: boolean;
  write(data: Uint8Array): Promise<void>;
}

export interface OpFileWriteOptions {
  mode?: number;
  overwrite?: boolean;
}

export interface OpCommandContext {
  args: readonly string[];
  env: Record<string, string>;
  signal: AbortSignal;
  binding?: OpBackendContext["binding"];
  authentication?: OpBackendContext["authentication"];
  pluginScope?: OpBackendContext["pluginScope"];
  confirmPluginClear?: OpBackendContext["confirmPluginClear"];
  selectPlugin?: OpBackendContext["selectPlugin"];
  stdin: AsyncIterable<Uint8Array>;
  stdout: OpOutputSink;
  stderr: OpOutputSink;
  invoke?: (command: string, args: readonly string[], options: {
    env: Readonly<Record<string, string>>;
    stdout?: OpOutputSink;
    stderr?: OpOutputSink;
  }) => Promise<{ exitCode: number }>;
  readFile?: (path: string) => Promise<Uint8Array>;
  writeFile?: (path: string, data: Uint8Array, options?: OpFileWriteOptions) => Promise<void>;
}

export interface OpCommandOptions {
  backend: OpBackend;
  version?: string;
  channel?: "stable" | "beta";
  authorize?: (request: OpBackendRequest, context: Readonly<Pick<OpBackendContext, "signal" | "pluginScope" | "authentication">>) =>
    "allow" | "deny" | "ask" | Promise<"allow" | "deny" | "ask">;
  approve?: (request: OpBackendRequest, context: Readonly<Pick<OpBackendContext, "signal" | "pluginScope" | "authentication">>) => boolean | Promise<boolean>;
  approvalMode?: "resolved" | "literal";
  authorizeResolution?: OpCommandOptions["approve"];
  approveResolved?: (approval: OpResolvedApproval, context: Readonly<Pick<OpBackendContext, "signal" | "pluginScope" | "authentication">>) => boolean | Promise<boolean>;
  handlers?: Readonly<Record<string, (request: OpBackendRequest, context: OpCommandContext) => Promise<{ exitCode: number }>>>;
}

export interface OpResolvedApproval {
  readonly operation: Readonly<{ resource: string; action: string }>;
  readonly backendId: string;
  readonly accountId: string | null;
  readonly targets: readonly OpBindingTarget[];
  readonly optionNames: readonly string[];
  readonly mutation: Readonly<{ requested: boolean; propertyNames: readonly string[]; assignmentNames: readonly string[]; batchSize?: number }>;
  readonly output: Readonly<{ kind: "none" | "stdout" | "file"; destination?: string }>;
  readonly child?: Readonly<{ executable: string; argv: readonly string[]; environmentNames: readonly string[] }>;
}

type FlagValue = string | boolean | readonly string[];

export function selectOpGlobalFlags(flags: OpBackendRequest["flags"]): OpBackendRequest["flags"] {
  return Object.freeze(Object.fromEntries(Object.entries(flags).filter(([name]) => Object.hasOwn(opGlobalFlags, name))));
}

export function selectOpBackendContext(context: OpCommandContext): OpBackendContext {
  return Object.freeze({
    signal: context.signal,
    ...(context.binding === undefined ? {} : { binding: context.binding }),
    ...(context.authentication === undefined ? {} : { authentication: context.authentication }),
    ...(context.pluginScope === undefined ? {} : { pluginScope: context.pluginScope }),
    ...(context.confirmPluginClear === undefined ? {} : { confirmPluginClear: context.confirmPluginClear }),
    ...(context.selectPlugin === undefined ? {} : { selectPlugin: context.selectPlugin }),
  });
}

function booleanValue(value: string): boolean | undefined {
  if (["true", "1", "t", "TRUE", "True", "T"].includes(value)) return true;
  if (["false", "0", "f", "FALSE", "False", "F"].includes(value)) return false;
  return undefined;
}

function flagValue(name: string, definition: OpFlagDefinition, value: string | undefined): FlagValue {
  if (definition.kind === "boolean") {
    if (value === undefined) return true;
    const parsed = booleanValue(value);
    if (parsed !== undefined) return parsed;
    throw new Error(`invalid boolean value for --${name}`);
  }
  if (definition.kind === "optional" && value === undefined) return true;
  if (value === undefined) throw new Error(`flag needs a value: --${name}`);
  validateOpFlagValue(name, definition, value);
  if (definition.kind === "array") return [value];
  if (definition.kind === "csv") return definition.valueSyntax === "csv" ? parseOpCsv(value) : value.split(",");
  return value;
}

function commandFlags(command: OpCatalogCommand | undefined, channel: "stable" | "beta", root: boolean): Record<string, OpFlagDefinition> {
  return Object.fromEntries(Object.entries({ ...opGlobalFlags, ...(root ? opRootFlags : {}), ...command?.flags }).filter(([, flag]) => channel === "beta" || flag.availability !== "beta"));
}

function scanCommand(argv: readonly string[], channel: "stable" | "beta", resolvedFlags?: Record<string, OpFlagDefinition>) {
  const tokens = [...argv];
  const path: string[] = [];
  const args: string[] = [];
  const flags: Record<string, FlagValue> = Object.create(null);
  let command: OpCatalogCommand | undefined;
  let candidates = opCommandCatalog.filter(entry => channel === "beta" || entry.availability !== "beta");
  let literal = false;
  let help = argv[0] === "help";
  for (let index = help ? 1 : 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (literal) { args.push(token); continue; }
    if (token === "--") { literal = true; continue; }
    if (token.startsWith("-") && token !== "-") {
      const available = resolvedFlags ?? {};
      if (!resolvedFlags) {
        for (const candidate of candidates) {
          for (const [name, definition] of Object.entries(commandFlags(candidate, channel, path.length === 0))) {
            const previous = available[name];
            available[name] = { ...definition,
              alias: previous?.alias ?? definition.alias,
              longAliases: [...new Set([...(previous?.longAliases ?? []), ...(definition.longAliases ?? [])])],
            };
          }
        }
      }
      if (!token.startsWith("--") && token.length > 2 && token[2] !== "=") {
        const firstName = Object.keys(available).find(key => available[key]!.alias === token[1]);
        if (!firstName) throw new Error(`unknown shorthand flag: ${token[1]}`);
        const first = available[firstName]!;
        tokens.splice(index, 1, ...(first.kind === "boolean" ? [token.slice(0, 2), `-${token.slice(2)}`] : [`${token.slice(0, 2)}=${token.slice(2)}`]));
        index--;
        continue;
      }
      const equal = token.indexOf("=");
      const long = token.startsWith("--");
      const spelling = token.slice(long ? 2 : 1, equal < 0 ? undefined : equal);
      const name = long ? Object.hasOwn(available, spelling) ? spelling : Object.keys(available).find(key => available[key]!.longAliases?.includes(spelling))
        : Object.keys(available).find(key => available[key]!.alias === spelling);
      const definition = name === undefined || !Object.hasOwn(available, name) ? undefined : available[name];
      if (!name || !definition) throw new Error(`unknown flag: ${token.slice(0, equal < 0 ? undefined : equal)}`);
      if (!resolvedFlags && !command && equal < 0 && !Object.hasOwn(commandFlags(undefined, channel, path.length === 0), name)) {
        index++;
        continue;
      }
      let value = equal < 0 ? undefined : token.slice(equal + 1);
      if (value === undefined && definition.kind !== "boolean" && definition.kind !== "optional") {
        value = tokens[++index];
        if (value === undefined) throw new Error(`flag needs a value: --${name}`);
      }
      const parsed = flagValue(name, definition, value);
      const previous = flags[name];
      flags[name] = Array.isArray(previous) && Array.isArray(parsed) ? [...previous, ...parsed] : parsed;
      continue;
    }
    if (command) { args.push(token); continue; }
    if (token === "help" && path.length === 0) { help = true; continue; }
    candidates = candidates.filter(entry => entry.path[path.length] === token || (entry.path.length === path.length + 1 && entry.aliases.includes(token)));
    if (candidates.length === 0) throw new Error(`unknown command: ${[...path, token].join(" ")}`);
    path.push(candidates[0]!.path[path.length]!);
    command = candidates.find(entry => entry.path.length === path.length);
  }
  help ||= flags.help === true || path.length === 0 || (!command && args.length === 0);
  return { path, args, flags, command, help };
}

function parseCommand(argv: readonly string[], env: Readonly<Record<string, string>>, channel: "stable" | "beta") {
  const resolved = scanCommand(argv, channel);
  const parsed = scanCommand(argv, channel, commandFlags(resolved.command, channel, resolved.path.length === 0));
  const { path, flags, command } = parsed;
  if (path.length > 0 && flags.version !== undefined) throw new Error("unknown flag: --version");
  const available = commandFlags(command, channel, path.length === 0);
  for (const [name, definition] of Object.entries(available)) {
    const value = definition.env === undefined ? undefined : env[definition.env];
    if (flags[name] === undefined && value !== undefined && value !== "") {
      if (definition.invalidEnv === "ignore" && definition.kind === "boolean" && booleanValue(value) === undefined) continue;
      flags[name] = flagValue(name, definition, value);
    }
  }
  if (flags.format !== undefined && flags.format !== "json" && flags.format !== "human-readable") throw new Error("format must be json or human-readable");
  return parsed;
}

function freezeJson(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

async function readInput(context: OpCommandContext, encoding: unknown): Promise<{ input: unknown; chunks: Uint8Array[] }> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of context.stdin) {
    context.signal.throwIfAborted();
    length += chunk.byteLength;
    if (length > 16 * 1024 * 1024) throw new Error("stdin exceeds 16 MiB");
    chunks.push(Uint8Array.from(chunk));
  }
  if (length === 0) return { input: undefined, chunks };
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = createOpTextCodec(encoding).decoder().decode(bytes);
  try { return { input: freezeJson(JSON.parse(text)), chunks }; } catch { return { input: text, chunks }; }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function conceal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(conceal);
  if (!record(value)) return value;
  const hidden = ["CONCEALED", "OTP", "SSHKEY"].includes(String(value.type).toUpperCase()) || value.purpose === "PASSWORD";
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    hidden && key === "value" ? "(use 'op item get --reveal' to reveal)" : conceal(entry),
  ]));
}

function metadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(metadata);
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "content").map(([key, entry]) => [key, metadata(entry)]));
}

export function renderOpOutput(result: unknown, request: OpBackendRequest): Uint8Array | undefined {
  const encoder = createOpTextCodec(request.flags.encoding);
  const { resource, action, flags } = request;
  const format = flags.format;
  let value = result;
  if (resource === "plugin" && action === "list" && format !== "json" && Array.isArray(value) && value.every(record)) return encoder.encode(renderPluginList(value));
  if (resource === "document" && action === "get") {
    const content = record(value) ? value.content : value;
    if (content instanceof Uint8Array) return content;
    if (typeof content === "string") return new TextEncoder().encode(content);
    throw new Error("document backend did not return document content");
  }
  if (resource === "item" || resource === "document") value = metadata(value);
  if (resource === "item" && flags.otp === true) {
    const values = request.args.length === 1 && request.args[0] === "-" && Array.isArray(value) ? value : [value];
    const codes: string[] = [];
    for (const entry of values) {
      if (typeof entry !== "string" || ![6, 8].includes(entry.trim().length) || !Array.from(entry.trim()).every(character => character >= "0" && character <= "9")) {
        throw new Error("backend did not return a generated one-time password");
      }
      codes.push(entry.trim());
    }
    if (!codes.length) throw new Error("backend did not return a generated one-time password");
    return encoder.encode(`${codes.join("\n")}\n`);
  }
  if (resource === "item" && flags.fields !== undefined) {
    const selectors = typeof flags.fields === "string" ? parseOpCsv(flags.fields) : flags.fields;
    if (!Array.isArray(selectors)) throw new Error("fields must be a list");
    const fields = record(value) && Array.isArray(value.fields) ? value.fields : Array.isArray(value) ? value : [value];
    const selected = selectors.flatMap(selector => {
      const equal = selector.indexOf("=");
      const key = equal < 0 ? "label" : selector.slice(0, equal);
      const match = (equal < 0 ? selector : selector.slice(equal + 1)).toLowerCase();
      if (key !== "label" && key !== "type") throw new Error("field selectors must use label or type");
      const matches = fields.filter(field => record(field) && (String(field[key] ?? "").toLowerCase() === match || (key === "label" && String(field.id ?? "").toLowerCase() === match)));
      if (!matches.length) throw new Error("selected field was not found");
      return matches;
    });
    if (format === "json") value = selected.length === 1 ? selected[0] : selected;
    else {
      const visible = flags.reveal === true ? selected : selected.map(conceal);
      const values = visible.map(field => {
        const text = String(record(field) ? field.value ?? "" : field);
        return Array.from(text).some(character => ',"\r\n'.includes(character)) ? `"${text.split('"').join('""')}"` : text;
      });
      return encoder.encode(`${values.join(",")}\n`);
    }
  }
  if (resource === "item" && format !== "json" && flags.reveal !== true) value = conceal(value);
  if (value === undefined) return undefined;
  if (value instanceof Uint8Array) return value;
  if (format === "json") return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
  if (typeof value === "string") return encoder.encode(value.endsWith("\n") ? value : `${value}\n`);
  if (Array.isArray(value)) {
    if (value.length === 0) return new Uint8Array();
    if (value.every(row => row !== null && typeof row === "object" && !Array.isArray(row))) {
      const keys = [...new Set(value.flatMap(row => Object.keys(row)))];
      return encoder.encode(`${keys.join("\t")}\n${value.map(row => keys.map(key => typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key] ?? "")).join("\t")).join("\n")}\n`);
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return encoder.encode(`${Object.entries(value).map(([key, entry]) => `${key}: ${typeof entry === "object" ? JSON.stringify(entry) : String(entry)}`).join("\n")}\n`);
  }
  return encoder.encode(`${JSON.stringify(value)}\n`);
}

async function policyResult<Value>(callback: () => Value | Promise<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("operation aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => {
      signal.throwIfAborted();
      return callback();
    }), cancelled]);
  } catch {
    throw new Error("authorization failed");
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function approvalManifest(request: OpBackendRequest, requests: readonly OpBackendRequest[], prepared: OpPreparedBinding, effects: readonly OpPreparedEffect[]): OpResolvedApproval {
  if (typeof prepared.backendId !== "string" || (prepared.accountId !== null && typeof prepared.accountId !== "string")) throw new Error("Invalid binding metadata");
  const targets = prepared.targets.map(target => {
    if (!Number.isInteger(target.requestIndex) || target.requestIndex < 0 || target.requestIndex >= requests.length || typeof target.resource !== "string" || typeof target.revision !== "string" || !["object", "collection", "field", "section"].includes(target.kind)) throw new Error("Invalid binding target metadata");
    for (const name of ["id", "account", "parentId"] as const) if (target[name] !== undefined && typeof target[name] !== "string") throw new Error("Invalid binding target metadata");
    return { requestIndex: target.requestIndex, resource: target.resource, kind: target.kind, revision: target.revision,
      ...(target.id === undefined ? {} : { id: target.id }), ...(target.account === undefined ? {} : { account: target.account }), ...(target.parentId === undefined ? {} : { parentId: target.parentId }) };
  });
  const file = effects.find(effect => effect.kind === "file");
  const child = effects.find(effect => effect.kind === "invoke");
  if (effects.filter(effect => effect.kind === "file").length > 1 || effects.filter(effect => effect.kind === "invoke").length > 1) throw new Error("Multiple output destinations are unsupported");
  if (file && typeof file.path !== "string") throw new Error("Invalid output metadata");
  if (child && (typeof child.command !== "string" || !Number.isSafeInteger(child.argumentCount) || child.argumentCount! < 0 || !Array.isArray(child.environmentNames) || !child.environmentNames.every(name => typeof name === "string"))) throw new Error("Invalid child metadata");
  const mutations = requests.filter(entry => !["get", "list", "read", "inspect", "ratelimit"].includes(entry.action));
  const inputs = mutations.flatMap(entry => Array.isArray(entry.input) ? entry.input : entry.input === undefined ? [] : [entry.input]);
  const propertyNames = [...new Set(inputs.flatMap(input => record(input) ? Object.keys(input) : []))].sort();
  const assignmentNames = [...new Set(mutations.filter(entry => entry.resource === "item" && ["create", "edit", "update"].includes(entry.action)).flatMap(entry => entry.args.filter(arg => arg.includes("=")).map(arg => arg.slice(0, arg.indexOf("=")))))].sort();
  const manifest: OpResolvedApproval = {
    operation: { resource: request.resource, action: request.action }, backendId: prepared.backendId, accountId: prepared.accountId, targets,
    optionNames: Object.keys(request.flags).sort(),
    mutation: { requested: mutations.length > 0, propertyNames, assignmentNames,
      ...(requests.some(entry => Array.isArray(entry.input)) ? { batchSize: inputs.length } : {}) },
    output: file ? { kind: "file", destination: file.path } : { kind: effects.some(effect => effect.kind === "stdout") ? "stdout" : "none" },
    ...(child ? { child: { executable: child.command!, argv: Array.from({ length: child.argumentCount! }, () => "[redacted]"), environmentNames: [...child.environmentNames!] } } : {}),
  };
  return freezeJson(manifest) as OpResolvedApproval;
}

export function createOpCommand(options: OpCommandOptions): { name: "op"; execute(context: OpCommandContext): Promise<{ exitCode: number }> } {
  const { backend, authorize, approve, authorizeResolution, approveResolved, approvalMode = "resolved", version = "0.0.1", channel = "stable" } = options;
  const handlers = { ...options.handlers };
  const planners = new Map(Object.entries(handlers).flatMap(([key, handler]) => typeof (handler as Partial<OpPreparedHandler>).prepare === "function" ? [[key, (handler as OpPreparedHandler).prepare.bind(handler)] as const] : []));
  return {
    name: "op",
    async execute(callerContext) {
      const context: OpCommandContext = {
        ...callerContext,
        binding: undefined,
        args: Object.freeze([...callerContext.args]),
        env: Object.freeze({ ...callerContext.env }),
        ...(callerContext.pluginScope === undefined ? {} : { pluginScope: Object.freeze({ ...callerContext.pluginScope }) }),
      };
      let binding: OpPreparedBinding | undefined;
      let finished = false;
      let approved = false;
      const original = { ...context,
        stdin: { [Symbol.asyncIterator]: context.stdin[Symbol.asyncIterator].bind(context.stdin) },
        stdout: { isTTY: context.stdout.isTTY, write: context.stdout.write.bind(context.stdout) },
        stderr: { isTTY: context.stderr.isTTY, write: context.stderr.write.bind(context.stderr) },
        ...(context.readFile ? { readFile: context.readFile.bind(context) } : {}),
        ...(context.writeFile ? { writeFile: context.writeFile.bind(context) } : {}),
        ...(context.invoke ? { invoke: context.invoke.bind(context) } : {}),
      };
      try {
        context.signal.throwIfAborted();
        const biometric = context.env.OP_BIOMETRIC_UNLOCK_ENABLED;
        if (biometric !== undefined && biometric !== "true" && biometric !== "false") throw new Error("OP_BIOMETRIC_UNLOCK_ENABLED must be true or false.");
        const integration = biometric === undefined ? callerContext.authentication?.integration ?? "manual" : biometric === "true" ? "app" : "manual";
        context.authentication = Object.freeze({ ...callerContext.authentication, integration });
        if (context.args[0] === "__complete" || context.args[0] === "__completeNoDesc") {
          return await createCompletionCallbackHandler(channel)({ resource: context.args[0], action: "", args: context.args.slice(1), flags: {} }, context);
        }
        const parsed = parseCommand(context.args, context.env, channel);
        if (parsed.flags.version === true) {
          await context.stdout.write(new TextEncoder().encode(`${version}\n`));
          return { exitCode: 0 };
        }
        if (parsed.flags.help !== true) createOpTextCodec(parsed.flags.encoding);
        if (parsed.help) {
          await context.stdout.write(new TextEncoder().encode(renderOpHelp(parsed.path, channel)));
          return { exitCode: 0 };
        }
        const codec = createOpTextCodec(parsed.flags.encoding);
        const decodeArgument = (value: string) => codec.decoder().decode(new TextEncoder().encode(value));
        parsed.args = parsed.args.map(decodeArgument);
        for (const [name, value] of Object.entries(parsed.flags)) {
          if (name === "encoding") continue;
          if (typeof value === "string") parsed.flags[name] = decodeArgument(value);
          else if (Array.isArray(value)) parsed.flags[name] = value.map(decodeArgument);
        }
        if (!parsed.command) throw new Error("a command is required");
        const limits = parsed.command.args;
        if (limits && parsed.args.length < limits.min) throw new Error(`expected at least ${limits.min} arguments but got ${parsed.args.length} instead`);
        if (limits?.max !== undefined && parsed.args.length > limits.max) throw new Error(`expected at most ${limits.max} arguments but got ${parsed.args.length} instead`);
        const key = parsed.path.join(" ");
        const handler = Object.hasOwn(handlers, key) ? handlers[key] : undefined;
        const requiresInput = limits?.stdinAlternative === true && parsed.args.length === 0;
        for (const value of Object.values(parsed.flags)) if (Array.isArray(value)) Object.freeze(value);
        const literalRequest: OpBackendRequest = Object.freeze({
          resource: parsed.path.length === 1 ? parsed.path[0]! : parsed.path.slice(0, -1).join(" "),
          action: parsed.path.length === 1 ? "" : parsed.path.at(-1)!,
          args: Object.freeze(parsed.args), flags: Object.freeze({ ...parsed.flags }),
        });
        const executionContext = Object.freeze({
          signal: context.signal,
          ...(context.authentication === undefined ? {} : { authentication: context.authentication }),
          ...(context.pluginScope === undefined ? {} : { pluginScope: context.pluginScope }),
        });
        const decision = authorize ? await policyResult(() => authorize(literalRequest, executionContext), context.signal) : "allow";
        context.signal.throwIfAborted();
        if (decision !== "allow" && decision !== "ask") throw new Error("permission denied");
        if (approvalMode !== "resolved" && approvalMode !== "literal") throw new Error("Unsupported approval mode");
        const resolved = decision === "ask" && approvalMode === "resolved";
        if (decision === "ask") {
          if (!resolved) {
            if (!approve || await policyResult(() => approve(literalRequest, executionContext), context.signal) !== true) throw new Error("permission denied");
          } else {
            if (!authorizeResolution || !approveResolved || !backend.prepareBinding || !backend.validateBinding || !backend.cancelBinding || (handler && !planners.has(key))) throw new Error("Resolved approval is unsupported");
            if (await policyResult(() => authorizeResolution(literalRequest, executionContext), context.signal) !== true) throw new Error("Resolution permission denied");
          }
        }
        context.signal.throwIfAborted();
        context.stdin = original.stdin;
        context.readFile = original.readFile;
        const buffered = !handler || requiresInput ? await readInput(context, parsed.flags.encoding) : undefined;
        const input = buffered?.input;
        if (requiresInput && input === undefined) throw new Error("An object selector or piped input is required");
        if (handler && buffered) context.stdin = { async *[Symbol.asyncIterator]() { yield* buffered.chunks; } };
        const request: OpBackendRequest = input === undefined ? literalRequest : Object.freeze({ ...literalRequest, input });
        if (resolved) {
          const validate = (): void | Promise<void> => {
            context.signal.throwIfAborted();
            if (!approved || !binding || finished) throw new Error("Resolved approval is not active");
            const pending = backend.validateBinding!(binding.handle, selectOpBackendContext(context));
            if (pending !== undefined) return Promise.resolve(pending).then(() => { context.signal.throwIfAborted(); });
            context.signal.throwIfAborted();
          };
          const handoff = <Value>(effect: () => Promise<Value>): Promise<Value> => {
            const pending = validate();
            return pending === undefined ? effect() : pending.then(effect);
          };
          context.stdout = { isTTY: original.stdout.isTTY, async write(bytes) { return handoff(() => original.stdout.write(bytes)); } };
          context.stderr = { isTTY: original.stderr.isTTY, async write(bytes) { return handoff(() => original.stderr.write(bytes)); } };
          if (original.writeFile) context.writeFile = async (path, bytes, writeOptions) => handoff(() => original.writeFile!(path, bytes, writeOptions));
          if (original.invoke) context.invoke = async (command, args, invokeOptions) => handoff(() => original.invoke!(command, args, invokeOptions));
          const restoration = original as OpCommandContext & { restoreEnvironment?: (snapshot: unknown, context: { signal: AbortSignal }) => Promise<void> };
          if (restoration.restoreEnvironment) Object.assign(context, { async restoreEnvironment(snapshot: unknown) { return handoff(() => restoration.restoreEnvironment!(snapshot, { signal: context.signal })); } });
          let preparation: OpHandlerPreparation | undefined;
          if (handler) preparation = await policyResult(() => planners.get(key)!(request, context), context.signal);
          const requests = preparation?.requests ?? [request];
          const pending = Promise.resolve().then(() => {
            context.signal.throwIfAborted();
            return backend.prepareBinding!(requests, selectOpBackendContext(context));
          }).then(value => {
            if (finished || context.signal.aborted) backend.cancelBinding!(value.handle);
            else binding = value;
            return value;
          });
          const prepared = await policyResult(() => pending, context.signal);
          const manifest = await policyResult(() => {
            const destination = request.flags["out-file"];
            const effects: readonly OpPreparedEffect[] = preparation ? preparation.complete(prepared.metadata) : [typeof destination === "string" ? { kind: "file", path: destination } : { kind: "stdout" }];
            return approvalManifest(literalRequest, requests, prepared, effects);
          }, context.signal);
          if (await policyResult(() => approveResolved!(manifest, executionContext), context.signal) !== true) throw new Error("permission denied");
          if (preparation) Object.assign(context, preparation.context, { authentication: executionContext.authentication, pluginScope: executionContext.pluginScope });
          context.binding = prepared.handle;
          approved = true;
          await validate();
        }
        if (handler) return await handler(request, context);
        const destination = parsed.flags["out-file"];
        const writeOptions = typeof destination === "string" ? { mode: parseOpFileMode(parsed.flags["file-mode"]), overwrite: parsed.flags.force === true } : undefined;
        if (typeof destination === "string" && !context.writeFile) throw new Error("file output requires a host writeFile capability");
        const result = await backend.execute(request, selectOpBackendContext(context));
        context.signal.throwIfAborted();
        const output = renderOpOutput(result, request);
        if (output !== undefined) {
          if (typeof destination === "string") {
            await context.writeFile!(destination, output, writeOptions);
          } else await context.stdout.write(output);
        }
        return { exitCode: 0 };
      } catch (error) {
        await original.stderr.write(new TextEncoder().encode(`op: ${context.signal.aborted ? "operation aborted" : error instanceof Error ? error.message : "operation failed"}\n`));
        return { exitCode: context.signal.aborted ? 130 : 1 };
      } finally {
        finished = true;
        if (binding) backend.cancelBinding!(binding.handle);
      }
    },
  };
}
