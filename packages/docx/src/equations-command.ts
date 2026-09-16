import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { archiveSettings, CancellationError, ResourceLimitError, type ArchiveContext } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { SourceError, type DocxInvocation } from "./command.js";
import { inspectDocumentEquations, addDocumentEquation, replaceDocumentEquation, type EquationMutationContext, type EquationMutationData } from "./equations.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import type { DocumentIo } from "./io.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { UnsupportedProfileError } from "./package-xml.js";
import { PublicationError, type PublicationInput } from "./publication.js";

/** Adapts physical math snapshots and explicit capability-owned fragments. */
export async function executeEquationsCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined,
  request: DocxInspectionCommandRequest, context: ArchiveContext, io: DocumentIo): Promise<Uint8Array> {
  if (!["equations.list", "equations.add", "equations.replace"].includes(invocation.operation)) throw new DocxUsageError("Expected equation inventory or fragment mutation.");
  const settings = archiveSettings(context), encoder = new TextEncoder();
  const budget = settings.budget.lower(Object.fromEntries(((invocation.options as DocxOperationArguments<"equations.list">).limit ?? []).map(item => [item.name, item.value])));
  if (invocation.operation === "equations.list") {
    const options = invocation.options as DocxOperationArguments<"equations.list">;
    const { warnings, ...data } = await inspectDocumentEquations(bytes, options, { ...settings, budget });
    const envelope = { version: 1, operation: invocation.operation, ok: true, data, affected: 0, locations: data.items.map(item => item.location), warnings, errors: [] };
    const retainedSize = measurePackageResourceSerialization(envelope, budget);
    budget.charge("retainedBytes", retainedSize * 12); budget.charge("work", retainedSize * 12);
    const human = `Equation units: ${data.items.length}\n` + data.items.map(item => `${escapeTerminalText(item.name)}: ${item.details.mode}; ${item.support}\n`).join("");
    const diagnostic = warnings.map(warning => `docx: ${escapeTerminalText(warning.code)}: ${escapeTerminalText(warning.message)}\n`).join("");
    const diagnosticBytes = encoder.encode(diagnostic), size = options.json ? retainedSize + 1 : encoder.encode(human).length;
    budget.check("serializedOutput", size); budget.check("diagnosticBytes", diagnosticBytes.length);
    budget.charge("retainedBytes", size * 8 + diagnosticBytes.length * 8); budget.charge("work", size * 8 + diagnosticBytes.length * 8);
    settings.signal.throwIfAborted();
    if (diagnosticBytes.length) await request.stderr.write(diagnosticBytes);
    return encoder.encode(options.json ? JSON.stringify(envelope) + "\n" : human);
  }
  const operation = invocation.operation as "equations.add" | "equations.replace", options = invocation.options as DocxOperationArguments<typeof operation>;
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  const file = options.file.kind === "vfs" && options.file.capability === "command"
    ? { ...options.file, path: options.file.path === "-" && invocation.sources?.some(source => source.argument === "file" && source.path === "-") ? "-" : resolvePath(request.cwd, options.file.path) } : options.file;
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input)
    throw new PublicationError("unsupported-publication", "Equation publication requires admitted input identity.");
  const envelope = (data: EquationMutationData) => ({ version: 1, operation, ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] });
  const human = (data: EquationMutationData) => `docx ${operation.replace(".", " ")}: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} selection changed\n`;
  const mutationContext: EquationMutationContext = {
    ...settings, budget, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout,
    admitPublication(planned): undefined {
      const size = output === "-" && !planned.dryRun ? 0 : options.json ? measurePackageResourceSerialization(envelope(planned), budget) + 1 : encoder.encode(human(planned)).length;
      budget.check("serializedOutput", size); budget.charge("retainedBytes", size * 8); budget.charge("work", size * 8);
      return undefined;
    },
    binaryResolver: { capability: "command", async *open(path, { signal, maxBytes }) {
      try {
        if (path !== "-" && !request.filesystem.readStream) throw new UnsupportedProfileError("Equation fragment paths require an explicit streaming read capability.");
        const source = { open(inner: AbortSignal) {
          const stream = path === "-" ? request.stdin : request.filesystem.readStream!(resolvePath(request.cwd, path), { signal: inner });
          return { async *[Symbol.asyncIterator]() {
            let size = 0;
            for await (const chunk of stream) {
              size += chunk.length;
              if (size > Math.min(maxBytes, settings.limits.maxEntryBytes, budget.limits.xmlPartBytes)) throw new ResourceLimitError("Equation fragment byte limit exceeded.");
              yield chunk;
            }
          } };
        } };
        signal.throwIfAborted(); yield await io.readBytes(source);
      } catch (error) {
        if (error instanceof ResourceLimitError || error instanceof CancellationError || error instanceof UnsupportedProfileError) throw error;
        if (signal.aborted) throw new CancellationError("Equation fragment acquisition cancelled.", { cause: signal.reason });
        throw new SourceError("Unable to read the declared equation fragment.");
      }
    } }
  };
  const mutationOptions = { ...options, file, ...(output === undefined ? {} : { output }) };
  const data = operation === "equations.add"
    ? await addDocumentEquation(bytes, { operation, options: mutationOptions, ...(input ? { input } : {}) }, mutationContext)
    : await replaceDocumentEquation(bytes, { operation, options: mutationOptions, ...(input ? { input } : {}) }, mutationContext);
  if (output === "-" && !data.dryRun) return new Uint8Array();
  return encoder.encode(options.json ? JSON.stringify(envelope(data)) + "\n" : human(data));
}
