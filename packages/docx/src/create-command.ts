import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "./archive.js";
import { SourceError, type DocxInvocation } from "./command.js";
import { createDocument, type DocumentCreateOptions } from "./create.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocumentIo } from "./io.js";
import { PublicationError, type PublicationInput } from "./publication.js";

export async function executeCreateCommand(invocation: DocxInvocation, request: DocxInspectionCommandRequest, context: ArchiveContext, io: DocumentIo): Promise<Uint8Array> {
  const options = invocation.options;
  const file = invocation.sources?.find(source => source.argument === "template")?.path;
  let template: Uint8Array | undefined, input: PublicationInput | undefined;
  if (file !== undefined) {
    if (file !== "-" && options.output !== undefined && options.output !== "-" && !request.filesystem.lstat)
      throw new PublicationError("unsupported-publication", "Template file publication requires admitted source identity.");
    try {
      if (file !== "-" && request.filesystem.lstat) {
        const path = resolvePath(request.cwd, file);
        input = { path, stat: await request.filesystem.lstat(path, { signal: request.signal }) };
      }
      template = await io.readBytes({ open(signal) {
        if (file === "-") return request.stdin;
        const path = resolvePath(request.cwd, file);
        return request.filesystem.readStream ? request.filesystem.readStream(path, { signal }) :
          { async *[Symbol.asyncIterator]() { yield await request.filesystem.readFile(path, { signal }); } };
      } });
    } catch (error) {
      request.signal.throwIfAborted();
      if (error && typeof error === "object" && "code" in error && ["limit-exceeded", "cancelled"].includes(String(error.code))) throw error;
      throw new SourceError(error);
    }
  }
  const creation: DocumentCreateOptions = {
    ...(template === undefined ? {} : { template }),
    ...Object.fromEntries(["kind", "dialect", "content", "timestamp", "author"].filter(key => options[key] !== undefined).map(key => [key, options[key]]))
  };
  const output = typeof options.output === "string" ? options.output === "-" ? "-" : resolvePath(request.cwd, options.output) : undefined;
  const data = await createDocument(creation, { ...(input ? { input } : {}), ...(output === undefined ? {} : { output }),
    ...(options.force === undefined ? {} : { force: options.force as boolean }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun as boolean }),
    ...(options.json === undefined ? {} : { json: options.json as boolean })
  }, { ...context, encoding: { order: "name", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout });
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: "create", ok: true, data, warnings: [], errors: [], affected: 1, locations: [] }) + "\n" : `docx create: ${data.dryRun ? "dry-run; " : ""}1 document created\n`);
}
