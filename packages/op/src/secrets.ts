import type { OpBackend, OpBackendRequest } from "./types.js";
import { selectOpBackendContext, selectOpGlobalFlags, type OpCommandContext } from "./cli.js";
import { createOpTextCodec } from "./encoding.js";
import { parseOpFileMode } from "./file-mode.js";
import { createHandlerPreparation, createSourceSnapshot, type OpEffectIntent } from "./handler-preparation.js";

type SecretHandler = (request: OpBackendRequest, context: OpCommandContext) => Promise<{ exitCode: number }>;

function word(character: string): boolean {
  return character.length === 1 && ((character >= "a" && character <= "z") || (character >= "A" && character <= "Z") || (character >= "0" && character <= "9") || character === "_");
}

function expand(value: string, env: Readonly<Record<string, string>>, escapes = true): string {
  let output = "";
  for (let position = 0; position < value.length;) {
    const character = value[position]!;
    if (escapes && character === "\\" && position + 1 < value.length) {
      output += value[position + 1];
      position += 2;
      continue;
    }
    if (character !== "$") {
      output += character;
      position++;
      continue;
    }
    let end = position + 1;
    let name: string;
    let fallback = "";
    if (value[end] === "{") {
      end = value.indexOf("}", end + 1);
      if (end < 0) throw new Error("Unclosed environment variable");
      name = value.slice(position + 2, end).trim();
      const separator = name.indexOf(":-");
      if (separator >= 0) {
        fallback = name.slice(separator + 2);
        name = name.slice(0, separator).trim();
      }
      end++;
    } else {
      while (end < value.length && word(value[end]!)) end++;
      name = value.slice(position + 1, end);
    }
    if (!name || !Array.from(name).every(word) || (name[0]! >= "0" && name[0]! <= "9")) {
      output += character;
      position++;
      continue;
    }
    const key = Object.keys(env).find(candidate => candidate.toLowerCase() === name.toLowerCase());
    output += key === undefined ? fallback : env[key];
    position = end;
  }
  return output;
}

async function cancellable<Value>(signal: AbortSignal, operation: () => Promise<Value>): Promise<Value> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    const value = await Promise.race([operation(), cancelled]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function template(value: string, env: Readonly<Record<string, string>>, resolve: (reference: string) => Promise<string>, variables = true): Promise<string> {
  let output = "";
  let position = 0;
  while (position < value.length) {
    if (value.startsWith("{{", position)) {
      let start = position + 2;
      while (value[start] === " ") start++;
      if (value[start] === '"') {
        let end = start + 1;
        let escaped = false;
        for (; end < value.length; end++) {
          if (!escaped && value[end] === '"') break;
          if (!escaped && value[end] === "\\") escaped = true;
          else escaped = false;
        }
        const literal = JSON.parse(value.slice(start, end + 1)) as string;
        let close = end + 1;
        while (value[close] === " ") close++;
        if (!value.startsWith("}}", close)) throw new Error("Invalid template literal");
        output += literal;
        position = close + 2;
        continue;
      }
      const end = value.indexOf("}}", start);
      if (end < 0) throw new Error("Unclosed secret template");
      const content = value.slice(start, end).trim();
      const reference = variables ? expand(content, env) : content;
      if (!reference.startsWith("op://")) throw new Error("Expected a secret reference in template");
      output += await resolve(reference);
      position = end + 2;
      continue;
    }
    const previous = value[position - 1] ?? "";
    if (value.startsWith("op://", position) && !(word(previous) || (previous !== "" && "-+\\.".includes(previous)))) {
      let end = position + 5;
      while (end < value.length) {
        const character = value[end]!;
        if (character === "$") {
          if (value[end + 1] === "{") {
            const close = value.indexOf("}", end + 2);
            if (close < 0) throw new Error("Unclosed environment variable");
            end = close + 1;
            continue;
          }
          end++;
          continue;
        }
        if (!word(character) && !"/-?_.=&%".includes(character)) break;
        end++;
      }
      const reference = value.slice(position, end);
      output += await resolve(variables ? expand(reference, env) : reference);
      position = end;
      continue;
    }
    if (variables && value[position] === "$") {
      let end = position + 1;
      if (value[end] === "{") {
        const close = value.indexOf("}", end + 1);
        if (close < 0) throw new Error("Unclosed environment variable");
        end = close + 1;
      } else {
        while (end < value.length && word(value[end]!)) end++;
      }
      output += expand(value.slice(position, end), env);
      position = end;
      continue;
    }
    output += value[position];
    position++;
  }
  return output;
}

function dotenv(source: string, env: Record<string, string>): Set<string> {
  const keys = new Set<string>();
  let position = 0;
  while (position < source.length) {
    while (position < source.length && source[position]!.trim() === "") position++;
    if (position === source.length) break;
    if (source[position] === "#") {
      while (position < source.length && source[position] !== "\n") position++;
      continue;
    }
    const start = position;
    while (position < source.length && source[position] !== "=" && source[position] !== "\n") position++;
    if (source[position] !== "=") throw new Error("Invalid dotenv assignment");
    let key = source.slice(start, position).trim();
    if (key.startsWith("export ")) key = key.slice(7).trim();
    key = expand(key, env);
    if (!key || key.includes("\0") || key.includes("=") || key.includes("op://")) throw new Error("Invalid dotenv key");
    position++;
    while (source[position] === " " || source[position] === "\t") position++;
    const quote = source[position] === "'" || source[position] === '"' ? source[position++]! : undefined;
    let raw = "";
    let closed = quote === undefined;
    while (position < source.length) {
      const character = source[position]!;
      if (quote !== undefined && character === quote) {
        closed = true;
        position++;
        break;
      }
      if (quote === undefined && (character === "\n" || character === "\r" || character === "#")) break;
      if (character === "\\" && quote !== "'" && position + 1 < source.length) {
        raw += character + source[position + 1];
        position += 2;
      } else {
        raw += character;
        position++;
      }
    }
    if (!closed) throw new Error("Unclosed dotenv quote");
    if (quote !== undefined) {
      while (source[position] === " " || source[position] === "\t" || source[position] === "\r") position++;
      if (position < source.length && source[position] !== "#" && source[position] !== "\n") throw new Error("Unexpected text after dotenv quote");
    }
    while (position < source.length && source[position] !== "\n") position++;
    const value = quote === undefined ? raw.trim() : raw;
    Object.defineProperty(env, key, { value: quote === "'" ? value : expand(value, env), enumerable: true, writable: true, configurable: true });
    keys.add(key);
  }
  return keys;
}

export function createMaskedSink(sink: OpCommandContext["stdout"], secrets: readonly string[], signal: AbortSignal) {
  const encoder = new TextEncoder();
  const patterns = [...new Set(secrets)].filter(Boolean).map(secret => encoder.encode(secret)).sort((left, right) => right.length - left.length);
  const replacement = encoder.encode("<concealed by 1Password>");
  let pending = new Uint8Array();
  let queue = Promise.resolve();
  async function drain(final: boolean) {
    const output: number[] = [];
    let position = 0;
    while (position < pending.length) {
      const remaining = pending.length - position;
      const matches = patterns.filter(pattern => pattern.subarray(0, Math.min(pattern.length, remaining)).every((byte, offset) => byte === pending[position + offset]));
      if (!final && matches.some(pattern => pattern.length > remaining)) break;
      const match = matches.find(pattern => pattern.length <= remaining);
      if (match) {
        for (const byte of replacement) output.push(byte);
        position += match.length;
      } else output.push(pending[position++]!);
    }
    pending = pending.slice(position);
    if (output.length) await cancellable(signal, () => sink.write(new Uint8Array(output)));
  }
  return {
    sink: {
      write(data: Uint8Array): Promise<void> {
        const copy = Uint8Array.from(data);
        queue = queue.then(async () => {
          signal.throwIfAborted();
          const next = new Uint8Array(pending.length + copy.length);
          next.set(pending);
          next.set(copy, pending.length);
          pending = next;
          await drain(false);
        });
        return queue;
      }
    },
    async flush() {
      await queue;
      await drain(true);
    }
  };
}

function outputFile(request: OpBackendRequest, context: OpCommandContext): { path: string; options: { mode: number; overwrite: boolean } } | undefined {
  const path = request.flags["out-file"];
  if (typeof path !== "string" || !path) return undefined;
  if (!context.writeFile) throw new Error("Host writeFile capability is required");
  const mode = parseOpFileMode(request.flags["file-mode"]);
  return { path, options: { mode, overwrite: request.flags.force === true } };
}

export function createSecretHandlers(backend: OpBackend): Record<string, SecretHandler> {
  function resolver(request: OpBackendRequest, context: OpCommandContext, secrets: string[] = []) {
    return async (reference: string): Promise<string> => {
      const result = await cancellable(context.signal, () => backend.execute({ resource: "secret", action: "read", args: [reference], flags: selectOpGlobalFlags(request.flags) }, selectOpBackendContext(context)));
      if (typeof result !== "string") throw new Error("Backend read must resolve to text");
      secrets.push(result);
      return result;
    };
  }
  const handlers: Record<string, SecretHandler> = {
    async read(request, context) {
      context.signal.throwIfAborted();
      if (request.args.length !== 1) throw new Error("read requires one secret reference");
      const output = outputFile(request, context);
      const value = await cancellable(context.signal, () => backend.execute({ resource: "secret", action: "read", args: [request.args[0]!], flags: selectOpGlobalFlags(request.flags) }, selectOpBackendContext(context)));
      let bytes: Uint8Array;
      if (value instanceof Uint8Array) {
        bytes = Uint8Array.from(value);
      } else {
        if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) throw new Error("Backend read must resolve to text, bytes, or a nonnegative safe integer");
        bytes = createOpTextCodec(request.flags.encoding).encode(String(value) + (output || request.flags["no-newline"] === true ? "" : "\n"));
      }
      await cancellable(context.signal, () => output ? context.writeFile!(output.path, bytes, output.options) : context.stdout.write(bytes));
      return { exitCode: 0 };
    },
    async inject(request, context) {
      context.signal.throwIfAborted();
      if (request.args.length) throw new Error("inject does not accept positional arguments");
      const output = outputFile(request, context);
      const input = request.flags["in-file"];
      let source = "";
      const decoder = createOpTextCodec(request.flags.encoding).decoder();
      if (typeof input === "string" && input) {
        if (!context.readFile) throw new Error("Host readFile capability is required");
        source = decoder.decode(await cancellable(context.signal, () => context.readFile!(input)));
      } else {
        const iterator = context.stdin[Symbol.asyncIterator]();
        while (true) {
          const next = await cancellable(context.signal, () => iterator.next());
          if (next.done) break;
          source += decoder.decode(next.value, { stream: true });
        }
        source += decoder.decode();
      }
      const value = await template(source, context.env, resolver(request, context));
      const bytes = createOpTextCodec(request.flags.encoding).encode(value);
      await cancellable(context.signal, () => output ? context.writeFile!(output.path, bytes, output.options) : context.stdout.write(bytes));
      return { exitCode: 0 };
    },
    async run(request, context) {
      context.signal.throwIfAborted();
      if (!request.args.length) throw new Error("run requires a command");
      if (!context.invoke) throw new Error("Host invoke capability is required");
      const env = { ...context.env };
      const parsedKeys = new Set<string>();
      const files = request.flags["env-file"];
      for (const path of typeof files === "string" ? [files] : Array.isArray(files) ? files : []) {
        if (!context.readFile) throw new Error("Host readFile capability is required");
        const source = new TextDecoder().decode(await cancellable(context.signal, () => context.readFile!(path)));
        for (const key of dotenv(source, env)) parsedKeys.add(key);
      }
      const secrets: string[] = [];
      const resolve = resolver(request, context, secrets);
      const environmentKeys = new Set<string>();
      const environments = request.flags.environment ?? request.flags.environments;
      for (const id of typeof environments === "string" ? [environments] : Array.isArray(environments) ? environments : []) {
        const result = await cancellable(context.signal, () => backend.execute({ resource: "environment", action: "read", args: [id], flags: selectOpGlobalFlags(request.flags) }, selectOpBackendContext(context)));
        let values: Record<string, string>;
        if (typeof result === "string") {
          values = {};
          dotenv(result, values);
        } else {
          if (result === null || typeof result !== "object" || (Object.getPrototypeOf(result) !== Object.prototype && Object.getPrototypeOf(result) !== null)) throw new Error("Backend environment read must resolve to a string record or dotenv text");
          const entries = Object.entries(result);
          if (entries.some(([, value]) => typeof value !== "string")) throw new Error("Backend environment values must be strings");
          values = Object.fromEntries(entries);
        }
        for (const [key, value] of Object.entries(values)) {
          Object.defineProperty(env, key, { value, enumerable: true, writable: true, configurable: true });
          secrets.push(value);
          environmentKeys.add(key);
        }
      }
      const variables = { ...env };
      for (const [key, value] of Object.entries(env)) {
        if (environmentKeys.has(key)) continue;
        const resolveValue = (reference: string) => resolve(parsedKeys.has(key) ? reference : expand(reference, variables, false));
        env[key] = value.startsWith("op://") ? await resolveValue(value) : await template(value, variables, resolveValue, false);
      }
      if (request.flags["no-masking"] === true) return cancellable(context.signal, () => context.invoke!(request.args[0]!, request.args.slice(1), { env, stdout: context.stdout, stderr: context.stderr }));
      const stdout = createMaskedSink(context.stdout, secrets, context.signal);
      const stderr = createMaskedSink(context.stderr, secrets, context.signal);
      try {
        return await cancellable(context.signal, () => context.invoke!(request.args[0]!, request.args.slice(1), { env, stdout: stdout.sink, stderr: stderr.sink }));
      } finally {
        await Promise.all([stdout.flush(), stderr.flush()]);
      }
    }
  };
  for (const [name, handler] of Object.entries(handlers)) {
    Object.assign(handler, {
      async prepare(request: OpBackendRequest, context: OpCommandContext) {
        const source = createSourceSnapshot(context);
        const requests: OpBackendRequest[] = [];
        const flags = selectOpGlobalFlags(request.flags);
        const collect = async (reference: string) => {
          requests.push({ resource: "secret", action: "read", args: [reference], flags });
          return "";
        };
        if (name === "read") {
          if (request.args.length !== 1) throw new Error("read requires one secret reference");
          await collect(request.args[0]!);
        } else if (name === "inject") {
          if (request.args.length) throw new Error("inject does not accept positional arguments");
          const path = request.flags["in-file"];
          const bytes = typeof path === "string" && path ? await source.file(path) : await source.input();
          await template(createOpTextCodec(request.flags.encoding).decoder().decode(bytes), source.context.env, collect);
        } else {
          if (!request.args.length) throw new Error("run requires a command");
          const env = { ...source.context.env };
          const parsedKeys = new Set<string>();
          const files = request.flags["env-file"];
          for (const path of typeof files === "string" ? [files] : Array.isArray(files) ? files : []) {
            for (const key of dotenv(new TextDecoder().decode(await source.file(path)), env)) parsedKeys.add(key);
          }
          const environments = request.flags.environment;
          const ids = typeof environments === "string" ? [environments] : Array.isArray(environments) ? environments : [];
          for (const id of ids) requests.push({ resource: "environment", action: "read", args: [id], flags });
          let dependent = false;
          const referenceKeys = new Set<string>();
          for (const [key, value] of Object.entries(env)) {
            const resolveValue = async (reference: string) => {
              referenceKeys.add(key);
              if (!parsedKeys.has(key) && reference.includes("$")) dependent = true;
              return collect(parsedKeys.has(key) ? reference : expand(reference, env, false));
            };
            if (value.startsWith("op://")) await resolveValue(value);
            else await template(value, env, resolveValue, false);
          }
          const effect: OpEffectIntent = { kind: "invoke", command: request.args[0]!, args: request.args.slice(1), environmentNames: Object.keys(env), masking: request.flags["no-masking"] !== true };
          return createHandlerPreparation(requests, source.context, [effect], metadata => {
            const names = new Set(Object.keys(env));
            for (let index = 0; index < ids.length; index++) {
              const environment = metadata[index]?.environment;
              if (!environment || !environment.dependenciesComplete) throw new Error("Environment dependency metadata is unavailable");
              if (dependent) throw new Error("Secret-dependent lookup targets are unsupported");
              for (const key of environment.names) {
                if (referenceKeys.has(key)) throw new Error("Environment overrides a planned secret source");
                names.add(key);
              }
            }
            return [{ ...effect, environmentNames: [...names] }];
          });
        }
        const output = outputFile(request, source.context);
        return createHandlerPreparation(requests, source.context, [output ? { kind: "file", ...output } : { kind: "stdout" }]);
      },
    });
  }
  return handlers;
}
