import { readFileStream } from "@poe-code/safe-fs/core";
import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "@poe-code/terminal-text";
import type { ArchiveContext } from "safe-bash-docx-engine/archive";
import type { DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import { DocumentIo } from "safe-bash-docx-engine/io";
import type { DocxOperationArguments } from "safe-bash-docx-engine/operation-types";
import { PublicationError, type PublicationInput } from "safe-bash-docx-engine/publication";
import { editDocumentControls, inspectDocumentControls } from "safe-bash-docx-engine/controls";

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
          const source = { open: (inner: AbortSignal) => path === "-" ? request.stdin : readFileStream(request.filesystem as FileSystem, resolvePath(request.cwd, path), { signal: inner }) };
          const bounded = new DocumentIo({ ...context, signal, limits: { ...context.limits, maxArchiveBytes: maxBytes }, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
          try { signal.throwIfAborted(); yield await bounded.readBytes(source); } finally { await bounded.cleanup(); }
        } } });
    if (output === "-" && !data.dryRun) return new Uint8Array();
    return new TextEncoder().encode((options.json ? JSON.stringify({ version: 1, operation: "controls.set", ok: true, data, affected: data.changes.length, locations: data.changes.map(change => change.after), warnings: [], errors: [] }) : `docx controls set: ${data.dryRun ? "dry-run; " : ""}${data.changes.length} controls filled`) + "\n");
}
