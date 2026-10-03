import { readFileStream } from "@poe-code/safe-fs/core";
import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import type { ArchiveContext } from "safe-bash-docx-engine/archive";
import { executeDocumentBatch, type DocumentBatchOptions } from "safe-bash-docx-engine/batch";
import { documentBatchActions } from "safe-bash-docx-engine/batch-operations";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { PublicationError, type PublicationInput } from "safe-bash-docx-engine/publication";
import { executeStyleModelCommand } from "./style-model-command.js";

export async function executeBatchCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  const options = invocation.options as unknown as DocumentBatchOptions & { version: 1; operations: readonly { operation: string; arguments: Record<string, unknown>; resultHandle?: string }[] };
  if (options.operations.length && options.operations.some(item => !documentBatchActions.has(item.operation) || item.resultHandle) &&
    options.operations.every(item => !documentBatchActions.has(item.operation) || ["paragraphs.get", "runs.get"].includes(item.operation)))
    return executeStyleModelCommand(invocation, bytes, input, request, context);
  if ((options.inPlace || options.output !== undefined && options.output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "File publication requires admitted input identity.");
  const output = options.output === undefined ? undefined : options.output === "-" ? "-" : resolvePath(request.cwd, options.output);
  const { version, operations, ...intent } = options;
  const data = await executeDocumentBatch(bytes, { version, operations }, { ...intent, ...(input ? { input } : {}), ...(output === undefined ? {} : { output }) },
    { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout,
      binaryResolver: { capability: "command", filesystem: request.filesystem as FileSystem, open(path, { signal }) {
        const absolute = resolvePath(request.cwd, path);
        return readFileStream(request.filesystem as FileSystem, absolute, { signal });
      } }
    });
  if (output === "-" && data.publication && !options.dryRun) return new Uint8Array();
  const affected = data.results.reduce((sum, result) => sum + result.affected, 0);
  return new TextEncoder().encode(options.json ? JSON.stringify({ version: 1, operation: "batch", ok: true, data, warnings: [], errors: [], affected, locations: [] }) + "\n"
    : `docx batch: ${options.dryRun ? "dry-run; " : ""}${data.results.length} operations; ${affected} changes\n`);
}
