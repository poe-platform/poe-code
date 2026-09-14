import type { OpCommandContext, OpFileWriteOptions } from "./cli.js";
import type { OpBackendRequest } from "./types.js";
import type { EnvironmentSnapshot } from "./environment.js";

export interface OpPreparedEffect {
  readonly kind: "stdout" | "file" | "invoke" | "restore";
  readonly path?: string;
  readonly options?: Readonly<OpFileWriteOptions>;
  readonly command?: string;
  readonly argumentCount?: number;
  readonly environmentNames?: readonly string[];
  readonly unsetNames?: readonly string[];
  readonly masking?: boolean;
}

export interface OpEffectIntent extends OpPreparedEffect {
  readonly args?: readonly string[];
}

export interface OpHandlerRequestMetadata {
  readonly environment?: {
    readonly names: readonly string[];
    readonly unsetNames?: readonly string[];
    readonly scope?: "complete" | "selected";
    readonly dependenciesComplete: boolean;
  };
}

export interface OpHandlerPreparation {
  readonly requests: readonly OpBackendRequest[];
  readonly context: OpCommandContext;
  readonly effects: readonly OpPreparedEffect[];
  complete(metadata: readonly OpHandlerRequestMetadata[]): readonly OpPreparedEffect[];
}

export type OpPreparedHandler = ((request: OpBackendRequest, context: OpCommandContext) => Promise<{ exitCode: number }>) & {
  prepare(request: OpBackendRequest, context: OpCommandContext): Promise<OpHandlerPreparation>;
};

async function acquire<Value>(signal: AbortSignal, operation: () => Promise<Value>): Promise<Value> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Operation aborted"));
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

export function createSourceSnapshot(source: OpCommandContext, maxBytes = 16 * 1024 * 1024) {
  const signal = source.signal;
  const readFile = source.readFile?.bind(source);
  const stdin = source.stdin;
  const files = new Map<string, Uint8Array>();
  let input: Promise<Uint8Array> | undefined;
  const context: OpCommandContext = {
    ...source,
    args: Object.freeze([...source.args]),
    env: Object.freeze({ ...source.env }),
    stdout: Object.freeze({ isTTY: source.stdout.isTTY, write: source.stdout.write.bind(source.stdout) }),
    stderr: Object.freeze({ isTTY: source.stderr.isTTY, write: source.stderr.write.bind(source.stderr) }),
    ...(source.writeFile ? { writeFile: source.writeFile.bind(source) } : {}),
    ...(source.invoke ? { invoke: source.invoke.bind(source) } : {}),
    ...(source.authentication ? { authentication: Object.freeze({ ...source.authentication }) } : {}),
    ...(source.pluginScope ? { pluginScope: Object.freeze({ ...source.pluginScope }) } : {}),
    async readFile(path) {
      signal.throwIfAborted();
      const bytes = files.get(path);
      if (!bytes) throw new Error("Unplanned file acquisition");
      return Uint8Array.from(bytes);
    },
    stdin: {
      async *[Symbol.asyncIterator]() {
        signal.throwIfAborted();
        if (!input) throw new Error("Unplanned stdin acquisition");
        yield Uint8Array.from(await input);
      },
    },
  };
  return {
    context,
    async file(path: string): Promise<Uint8Array> {
      signal.throwIfAborted();
      if (!files.has(path)) {
        if (!readFile) throw new Error("Host readFile capability is required");
        const bytes = await acquire(signal, () => readFile(path));
        if (bytes.byteLength > maxBytes) throw new Error("Prepared source exceeds byte limit");
        files.set(path, Uint8Array.from(bytes));
      }
      return Uint8Array.from(files.get(path)!);
    },
    input(): Promise<Uint8Array> {
      input ??= (async () => {
        const chunks: Uint8Array[] = [];
        let size = 0;
        const iterator = stdin[Symbol.asyncIterator]();
        while (true) {
          const next = await acquire(signal, () => iterator.next());
          if (next.done) break;
          if (next.value.byteLength > maxBytes - size) throw new Error("Prepared source exceeds byte limit");
          chunks.push(Uint8Array.from(next.value));
          size += next.value.byteLength;
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
      })();
      return input.then(bytes => Uint8Array.from(bytes));
    },
  };
}

function freezeTree<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !(value instanceof Uint8Array)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function effectMetadata(effects: readonly OpEffectIntent[]): readonly OpPreparedEffect[] {
  return freezeTree(effects.map(effect => {
    const { args, ...metadata } = effect;
    return structuredClone({ ...metadata, ...(args === undefined ? {} : { argumentCount: args.length }) });
  }));
}

export function createHandlerPreparation(
  requests: readonly OpBackendRequest[], context: OpCommandContext, effects: readonly OpEffectIntent[],
  complete: (metadata: readonly OpHandlerRequestMetadata[]) => readonly OpEffectIntent[] = () => effects,
): OpHandlerPreparation {
  let admitted: readonly OpEffectIntent[] | undefined;
  const signal = context.signal;
  const allowed = (kind: OpPreparedEffect["kind"]) => {
    signal.throwIfAborted();
    if (!admitted) throw new Error("Preparation is incomplete");
    return admitted.filter(effect => effect.kind === kind);
  };
  const same = (first: readonly string[], second: readonly string[]) => first.length === second.length && first.every((value, index) => value === second[index]);
  const namesMatch = (expected: readonly string[] | undefined, env: Readonly<Record<string, unknown>>) => expected !== undefined && same([...expected].sort(), Object.keys(env).sort());
  const guarded: OpCommandContext = {
    ...context,
    stdout: {
      isTTY: context.stdout.isTTY,
      async write(bytes) {
        if (!allowed("stdout").length && !allowed("invoke").length) throw new Error("Unplanned output");
        await acquire(signal, () => context.stdout.write(Uint8Array.from(bytes)));
      },
    },
    stderr: {
      isTTY: context.stderr.isTTY,
      async write(bytes) {
        if (!allowed("invoke").length) throw new Error("Unplanned error output");
        await acquire(signal, () => context.stderr.write(Uint8Array.from(bytes)));
      },
    },
    ...(context.writeFile ? { async writeFile(path: string, bytes: Uint8Array, options?: OpFileWriteOptions) {
      if (!allowed("file").some(effect => effect.path === path && effect.options?.mode === options?.mode && effect.options?.overwrite === options?.overwrite)) throw new Error("Unplanned file output");
      await acquire(signal, () => context.writeFile!(path, Uint8Array.from(bytes), options ? { ...options } : undefined));
    } } : {}),
    ...(context.invoke ? { async invoke(command: string, args: readonly string[], options: Parameters<NonNullable<OpCommandContext["invoke"]>>[2]) {
      if (!allowed("invoke").some(effect => effect.command === command && same(effect.args ?? [], args) && namesMatch(effect.environmentNames, options.env))) throw new Error("Unplanned child invocation");
      return acquire(signal, () => context.invoke!(command, Object.freeze([...args]), { ...options, env: Object.freeze({ ...options.env }) }));
    } } : {}),
  };
  const restoration = context as OpCommandContext & { restoreEnvironment?: (snapshot: EnvironmentSnapshot, context: { signal: AbortSignal }) => Promise<void> };
  if (restoration.restoreEnvironment) {
    const restore = restoration.restoreEnvironment.bind(context);
    Object.assign(guarded, { async restoreEnvironment(snapshot: EnvironmentSnapshot) {
      const values = Object.fromEntries(Object.entries(snapshot.variables).filter(([, value]) => value !== null));
      const unsets = Object.entries(snapshot.variables).filter(([, value]) => value === null).map(([key]) => key);
      if (!allowed("restore").some(effect => namesMatch(effect.environmentNames, values) && unsets.every(key => effect.unsetNames?.includes(key)))) throw new Error("Unplanned environment restoration");
      await acquire(signal, () => restore(structuredClone(snapshot), { signal }));
    } });
  }
  return Object.freeze({
    requests: freezeTree(requests.map(request => structuredClone(request))),
    context: guarded,
    effects: effectMetadata(effects),
    complete(metadata: readonly OpHandlerRequestMetadata[]) {
      context.signal.throwIfAborted();
      if (metadata.length !== requests.length) throw new Error("Incomplete binding metadata");
      admitted = freezeTree(complete(metadata).map(effect => structuredClone(effect)));
      return effectMetadata(admitted);
    },
  });
}
