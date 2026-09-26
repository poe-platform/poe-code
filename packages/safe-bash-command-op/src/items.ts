import { parseAssignment } from "./backend.js";
import { renderOpOutput, selectOpBackendContext, type OpCommandContext, type OpCommandOptions } from "./cli.js";
import type { OpBackend, OpBackendRequest } from "./types.js";
import { createOpTextCodec } from "./encoding.js";
import { createHandlerPreparation, createSourceSnapshot } from "./handler-preparation.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
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

async function stdinText(context: OpCommandContext, encoding: unknown): Promise<string> {
  const decoder = createOpTextCodec(encoding).decoder({ fatal: true });
  const iterator = context.stdin[Symbol.asyncIterator]();
  let source = "";
  let length = 0;
  while (true) {
    const next = await cancellable(context.signal, () => iterator.next());
    if (next.done) break;
    length += next.value.byteLength;
    if (length > 16 * 1024 * 1024) throw new Error("Item template stdin exceeds 16 MiB");
    source += decoder.decode(next.value, { stream: true });
  }
  return (source + decoder.decode()).trim();
}

function metadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(metadata);
  if (!record(value) || !Array.isArray(value.files)) return value;
  return {
    ...value,
    files: value.files.map(file => record(file) ? Object.fromEntries(Object.entries(file).filter(([key]) => key !== "content")) : file)
  };
}

export function createItemHandlers(backend: OpBackend): NonNullable<OpCommandOptions["handlers"]> {
  const handlers: Record<string, NonNullable<OpCommandOptions["handlers"]>[string]> = {};
  for (const action of ["create", "edit"] as const) {
    const mutation = async (request: OpBackendRequest, context: OpCommandContext): Promise<OpBackendRequest> => {
      context.signal.throwIfAborted();
      const args = [...request.args];
      const positional: string[] = [];
      let stdinMarker = false;
      if (action === "edit") {
        const selector = args.shift();
        if (!selector || selector === "-") throw new Error("item edit requires an item selector");
        positional.push(selector);
      } else if (args[0] === "-") {
        args.shift();
        stdinMarker = true;
      }
      const assignments = args.map(source => ({ source, parsed: parseAssignment(source) }));
      for (const { parsed } of assignments) {
        if (parsed.type === "file" && !parsed.value) throw new Error("File assignments require a file path");
      }
      const path = request.flags.template;
      if (path !== undefined && (typeof path !== "string" || !path)) throw new Error("--template requires a file path");
      if (path !== undefined && (stdinMarker || request.input !== undefined)) throw new Error("Cannot combine --template with stdin item templates");
      const piped = await stdinText(context, request.flags.encoding);
      if (piped && (path !== undefined || request.input !== undefined)) throw new Error("Cannot combine multiple item template sources");
      if (stdinMarker && !piped && request.input === undefined) throw new Error("Expected an item JSON template on stdin");
      let source = piped;
      if (typeof path === "string") {
        if (!context.readFile) throw new Error("Item templates require a host readFile capability");
        const bytes = await cancellable(context.signal, () => context.readFile!(path));
        source = createOpTextCodec(request.flags.encoding).decoder({ fatal: true }).decode(bytes);
      }
      let input: Record<string, unknown> | Record<string, unknown>[] | undefined;
      if (source || path !== undefined || request.input !== undefined) {
        let parsed: unknown;
        try { parsed = request.input === undefined ? JSON.parse(source) : request.input; }
        catch { throw new Error("Invalid item JSON template"); }
        if (Array.isArray(parsed)) {
          if (action !== "create" || path !== undefined || !parsed.length || parsed.some(value => !record(value))) throw new Error("Item JSON templates must be a nonempty array of objects on create stdin");
        } else if (!record(parsed)) throw new Error("Item JSON template must be an object");
        input = structuredClone(parsed);
      }
      for (const { source: assignment, parsed } of assignments) {
        if (parsed.type !== "file") {
          positional.push(assignment);
          continue;
        }
        if (!context.readFile) throw new Error("File attachments require a host readFile capability");
        const bytes = await cancellable(context.signal, () => context.readFile!(parsed.value!));
        input ??= {};
        for (const item of Array.isArray(input) ? input : [input]) {
          if (item.files !== undefined && !Array.isArray(item.files)) throw new Error("Item files must be an array");
          item.files = [...(item.files as unknown[] | undefined) ?? [], {
            name: parsed.field,
            size: bytes.byteLength,
            content: Uint8Array.from(bytes),
            ...(parsed.section === undefined ? {} : { section: { label: parsed.section } })
          }];
        }
      }
      const flags = { ...request.flags };
      delete flags.template;
      return { ...request, args: positional, flags, ...(input === undefined ? {} : { input }) };
    };
    handlers[`item ${action}`] = Object.assign(async (request: OpBackendRequest, context: OpCommandContext) => {
      const prepared = await mutation(request, context);
      const result = await cancellable(context.signal, () => backend.execute(prepared, selectOpBackendContext(context)));
      const output = renderOpOutput(metadata(result), request);
      if (output !== undefined) await cancellable(context.signal, () => context.stdout.write(output));
      return { exitCode: 0 };
    }, {
      async prepare(request: OpBackendRequest, context: OpCommandContext) {
        const source = createSourceSnapshot(context);
        await source.input();
        const prepared = await mutation(request, { ...source.context, readFile: source.file });
        return createHandlerPreparation([prepared], source.context, [{ kind: "stdout" }]);
      },
    });
  }
  return handlers;
}
