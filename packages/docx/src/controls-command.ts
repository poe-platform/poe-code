import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import type { ArchiveContext } from "./archive.js";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { DocumentIo } from "./io.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { editDocumentControls, inspectDocumentControls } from "./controls.js";

export async function executeControlsCommand(invocation: DocxInvocation, bytes: Uint8Array, input: PublicationInput | undefined, request: DocxInspectionCommandRequest, context: ArchiveContext): Promise<Uint8Array> {
  if (invocation.operation === "controls.list") {
    const data = await inspectDocumentControls(bytes, invocation.options as DocxOperationArguments<"controls.list">, context);
    return new TextEncoder().encode((invocation.options.json ? JSON.stringify({ version: 1, operation: "controls.list", ok: true, data, affected: 0, locations: data.items.map(item => item.location), warnings: [], errors: [] }) : data.items.map(item => `${item.location.positions.control}: ${item.kind}; ${item.support}; ${escapeTerminalText(item.tag ?? "")}`).join("\n")) + "\n");
  }
  const options = invocation.options as DocxOperationArguments<"controls.set">;
  const output = options.output === undefined || options.output === "-" ? options.output : resolvePath(request.cwd, options.output);
  if ((options.inPlace || output !== undefined && output !== "-") && invocation.inputs[0] !== "-" && !input) throw new PublicationError("unsupported-publication", "Control publication requires admitted input identity.");
    const data = await editDocumentControls(bytes, { ...options, ...(output === undefined ? {} : { output }), ...(input ? { input } : {}) },
      { ...context, encoding: { order: "input", compression: "store" }, filesystem: request.filesystem as FileSystem, stdout: request.stdout,
        binaryResolver: { capability: "command", async *open(path, { signal, maxBytes }) {
          const source = { open: (inner: AbortSignal) => path === "-" ? request.stdin : request.filesystem.readStream ? request.filesystem.readStream(resolvePath(request.cwd, path), { signal: inner }) : { async *[Symbol.asyncIterator]() { yield await request.filesystem.readFile(resolvePath(request.cwd, path), { signal: inner }); } } };
          const bounded = new DocumentIo({ ...context, signal, limits: { ...context.limits, maxArchiveBytes: maxBytes }, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
          try { signal.throwIfAborted(); yield await bounded.readBytes(source); } finally { await bounded.cleanup(); }
        } } });
    if (output === "-" && !data.dryRun) return new Uint8Array();
    return new TextEncoder().encode((options.json ? JSON.stringify({ version: 1, operation: "controls.set", ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] }) : `docx controls set: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} controls filled`) + "\n");
}
