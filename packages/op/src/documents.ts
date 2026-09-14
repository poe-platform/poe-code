import { parseOpFileMode, renderOpOutput, selectOpBackendContext, type OpCommandContext, type OpCommandOptions } from "./cli.js";
import type { OpBackend, OpBackendRequest } from "./types.js";
import { createHandlerPreparation, createSourceSnapshot } from "./handler-preparation.js";

export interface OpDocumentHandlerOptions {
  maxBytes?: number;
}

function textFlag(request: OpBackendRequest, name: string): string | undefined {
  const value = request.flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`--${name} requires a string`);
  return value;
}

async function uploadBytes(context: OpCommandContext, path: string | undefined, maxBytes: number): Promise<Uint8Array> {
  context.signal.throwIfAborted();
  if (path !== undefined && path !== "-") {
    if (!context.readFile) throw new Error("document upload requires a host readFile capability");
    const bytes = await context.readFile(path);
    context.signal.throwIfAborted();
    if (bytes.byteLength > maxBytes) throw new Error("document exceeds byte limit");
    return Uint8Array.from(bytes);
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of context.stdin) {
    context.signal.throwIfAborted();
    if (chunk.byteLength > maxBytes - length) throw new Error("document exceeds byte limit");
    length += chunk.byteLength;
    chunks.push(Uint8Array.from(chunk));
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function readable(bytes: Uint8Array): boolean {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return Array.from(text).every(character => {
      const code = character.codePointAt(0)!;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127 && (code < 128 || code > 159));
    });
  } catch { return false; }
}

export function createDocumentHandlers(backend: OpBackend, options: OpDocumentHandlerOptions = {}): NonNullable<OpCommandOptions["handlers"]> {
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("maxBytes must be a nonnegative safe integer");
  const handlers: Record<string, NonNullable<OpCommandOptions["handlers"]>[string]> = {};
  for (const action of ["create", "edit"] as const) {
    const mutation = async (request: OpBackendRequest, context: OpCommandContext): Promise<OpBackendRequest> => {
      if (request.args.length > (action === "create" ? 1 : 2) || (action === "edit" && !request.args[0])) throw new Error(`invalid arguments for document ${action}`);
      const path = request.args[action === "create" ? 0 : 1];
      const explicitName = textFlag(request, "file-name");
      const title = textFlag(request, "title");
      const vault = textFlag(request, "vault");
      const filename = explicitName ?? (path !== undefined && path !== "-" ? path.split("\\").join("/").split("/").at(-1) : undefined);
      if (filename === "") throw new Error("document filename must not be empty");
      const content = await uploadBytes(context, path, maxBytes);
      const input = {
        content,
        ...(filename === undefined ? action === "create" ? { name: "stdin" } : {} : { name: filename }),
        ...(title === undefined ? action === "create" ? { title: filename ?? "stdin" } : {} : { title }),
        ...(action === "create" && vault !== undefined ? { vault } : {}),
        ...(request.flags.tags === undefined ? {} : { tags: request.flags.tags }),
      };
      context.signal.throwIfAborted();
      return { ...request, resource: "document", action, args: action === "create" ? [] : [request.args[0]!], input };
    };
    handlers[`document ${action}`] = Object.assign(async (request: OpBackendRequest, context: OpCommandContext) => {
      const prepared = await mutation(request, context);
      const result = await backend.execute(prepared, selectOpBackendContext(context));
      context.signal.throwIfAborted();
      const output = renderOpOutput(result, request);
      if (output !== undefined) await context.stdout.write(output);
      return { exitCode: 0 };
    }, {
      async prepare(request: OpBackendRequest, context: OpCommandContext) {
        const source = createSourceSnapshot(context, maxBytes);
        const path = request.args[action === "create" ? 0 : 1];
        if (path === undefined || path === "-") await source.input();
        const prepared = await mutation(request, { ...source.context, readFile: source.file });
        return createHandlerPreparation([prepared], source.context, [{ kind: "stdout" }]);
      },
    });
  }
  handlers["document get"] = Object.assign(async (request: OpBackendRequest, context: OpCommandContext) => {
    if (request.args.length !== 1 || !request.args[0] || request.args[0] === "-") throw new Error("document get requires one document name or ID");
    const path = textFlag(request, "out-file");
    const mode = path === undefined ? undefined : parseOpFileMode(request.flags["file-mode"]);
    if (path !== undefined && !context.writeFile) throw new Error("document output requires a host writeFile capability");
    context.signal.throwIfAborted();
    const result = await backend.execute(request, selectOpBackendContext(context));
    context.signal.throwIfAborted();
    const bytes = renderOpOutput(result, request);
    if (!(bytes instanceof Uint8Array)) throw new Error("document backend did not return content");
    if (bytes.byteLength > maxBytes) throw new Error("document exceeds byte limit");
    if (path !== undefined) await context.writeFile!(path, bytes, { mode, overwrite: request.flags.force === true });
    else {
      if (context.stdout.isTTY && request.flags.force !== true && !readable(bytes)) throw new Error("refusing binary document output to terminal; use --force or --out-file");
      await context.stdout.write(bytes);
    }
    return { exitCode: 0 };
  }, {
    async prepare(request: OpBackendRequest, context: OpCommandContext) {
      const source = createSourceSnapshot(context, maxBytes);
      const path = textFlag(request, "out-file");
      return createHandlerPreparation([request], source.context, [path === undefined ? { kind: "stdout" } : { kind: "file", path, options: { mode: parseOpFileMode(request.flags["file-mode"]), overwrite: request.flags.force === true } }]);
    },
  });
  return Object.freeze(handlers);
}
