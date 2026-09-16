import { dirname, resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { SourceError, type DocxInvocation } from "./command.js";
import { parseDocxJson } from "./argument-json.js";
import type { ArchiveContext } from "./archive.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocumentIo } from "./io.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { packDocumentArchive } from "./pack.js";

export async function executePackCommand(invocation: DocxInvocation, request: DocxInspectionCommandRequest, context: ArchiveContext, io: DocumentIo): Promise<Uint8Array> {
  const input = invocation.inputs[0]!, path = input === "-" ? undefined : resolvePath(request.cwd, input);
  let bytes: Uint8Array;
  try {
    if (path !== undefined) {
      const fs = request.filesystem as FileSystem;
      const segments = path.split("/").slice(1); let current = "";
      for (let i = 0; i < segments.length; i++) {
        current += "/" + segments[i];
        const stat = await fs.lstat(current, { signal: request.signal });
        if (stat.type !== (i === segments.length - 1 ? "file" : "directory") || await fs.realpath(current, { signal: request.signal }) !== current)
          throw new SourceError();
      }
    }
    bytes = await io.readBytes({ open(signal) {
      if (path === undefined) return request.stdin;
      return request.filesystem.readStream ? request.filesystem.readStream(path, { signal }) : { async *[Symbol.asyncIterator]() { yield await request.filesystem.readFile(path, { signal }); } };
    } });
  } catch (error) {
    request.signal.throwIfAborted();
    if (error && typeof error === "object" && "code" in error && ["limit-exceeded", "cancelled"].includes(String(error.code))) throw error;
    throw new SourceError(error);
  }
  const inventory = parseDocxJson(bytes, context.budget);
  const options = { ...invocation.options, ...(typeof invocation.options.output === "string" && invocation.options.output !== "-" ? { output: resolvePath(request.cwd, invocation.options.output) } : {}) } as DocxOperationArguments<"pack">;
  const data = await packDocumentArchive(inventory, options, { ...context, filesystem: request.filesystem as FileSystem, stdout: request.stdout, ...(path === undefined ? {} : { inventoryDirectory: dirname(path) }) });
  if (options.output === "-" && !data.dryRun) return new Uint8Array();
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: "pack", ok: true, data, warnings: [], errors: [], affected: 1, locations: [] }) + "\n" : `docx pack: ${data.dryRun ? "dry-run; " : ""}1 document created\n`);
}
