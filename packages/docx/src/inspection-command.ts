import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { type ArchiveLimits, ResourceLimitError, CancellationError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import { createDocxCommandEngine, docxInvocationBudgets, type DocxCommandRequest } from "./command.js";
import { DocumentIo } from "./io.js";
import { inspectDocument, validateDocument } from "./inspection.js";
import { openDocumentLocations } from "./locations.js";
import type { DocumentScope } from "./location-index.js";
import type { Location } from "./location-token.js";

export interface DocxInspectionCommandRequest extends DocxCommandRequest {
  readonly cwd: string;
  readonly filesystem: Pick<FileSystem, "readFile" | "readStream">;
  readonly registerCleanup?: (cleanup: () => Promise<void>) => void;
}

/** Executes the read-only operations with explicitly supplied filesystem authority. */
export function createDocxInspectionCommandEngine(options: { readonly limits: ArchiveLimits }) {
  const limits = Object.freeze({ ...options.limits });
  return createDocxCommandEngine<DocxInspectionCommandRequest>({
    async execute(invocation, request) {
      const budget = docxInvocationBudgets.get(invocation) ?? new DocumentBudget({}, request.signal);
      const context = { limits, signal: request.signal, budget };
      const io = new DocumentIo({ ...context, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
      let acquiring = false;
      let writingDiagnostics = false;
      let output: Uint8Array;
      let exitCode = 0;
      try {
        if (invocation.operation !== "inspect" && invocation.operation !== "validate") {
          throw Object.assign(new Error("This document operation is not implemented."), { code: "unsupported-profile" });
        }
        if (["link", "control", "revision", "shape", "field", "bookmark"].some(key => invocation.options[key] !== undefined)) {
          throw Object.assign(new Error("This inspection selector is not implemented."), { code: "unsupported-profile" });
        }
        const input = invocation.inputs[0]!;
        acquiring = true;
        const bytes = await io.readBytes({ open(signal) {
          if (input === "-") return request.stdin;
          const path = resolvePath(request.cwd, input);
          if (request.filesystem.readStream) return request.filesystem.readStream(path, { signal });
          return { async *[Symbol.asyncIterator]() { yield await request.filesystem.readFile(path, { signal }); } };
        } });
        acquiring = false;
        const data = invocation.operation === "inspect" ? await inspectDocument(bytes, context)
          : await validateDocument(bytes, context, invocation.options.profile === undefined ? {} : { profile: invocation.options.profile as "core-v1" });
        const locations: Location[] = [];
        if (invocation.operation === "inspect") {
          const selected = invocation.options;
          if ("stories" in data && !["select", "section", "comment", "note", "table", "cell", "paragraph", "run", "image"].some(key => selected[key] !== undefined)) {
            const scope = selected.scope ?? "body";
            locations.push(...data.stories.filter(story => scope === "all-stories" || story.kind === scope).map(story => story.location));
          } else {
            const document = await openDocumentLocations(bytes, context);
            if (typeof selected.select === "string") locations.push(document.resolve(selected.select));
            else {
              const query = { scope: (selected.scope ?? "body") as DocumentScope, ...(selected.section !== undefined ? { section: selected.section as number } : {}) };
              let owner: Location | undefined;
              if (selected.comment !== undefined || selected.note !== undefined) owner = document.at("story", (selected.comment ?? selected.note) as number, { scope: selected.comment !== undefined ? "comments" : query.scope });
              for (const kind of ["table", "cell", "paragraph", "run", "image"] as const) {
                if (selected[kind] === undefined) continue;
                owner = kind === "cell" ? document.cell(owner!.token, selected.cell as string) : document.at(kind, selected[kind] as number, owner ? { owner: owner.token } : query);
              }
              locations.push(...(owner ? [owner] : document.list("story", query)));
            }
          }
        }
        const valid = !("valid" in data) || data.valid;
        exitCode = valid ? 0 : 1;
        const warnings = data.warnings.map(warning => typeof warning === "string" ? { code: "partial-validation", message: warning } : warning);
        const errors = "diagnostics" in data ? data.diagnostics.map(item => ({ code: "invalid-package", message: item.message, part: item.part, location: item.location })) : [];
        const human = "valid" in data ? `docx validate: ${data.valid ? "valid within" : "invalid within"} ${data.profile}\n${data.checks.map(check => `${check.id}: ${check.status}`).join("\n")}\n`
          : `docx inspect: ${data.kind}, ${data.dialect}\nParts: ${data.parts.length}; paragraphs: ${data.counts.paragraphs}; tables: ${data.counts.tables}; images: ${data.counts.images}\nCached pages: ${data.counts.cachedPages ?? "unknown"}; rendered pages: not calculated\nFont references do not establish installed fonts.\nSignatures present: ${data.signed}; signatures verified: not performed\nProtected: ${data.protected}\n`;
        const diagnostic = warnings.map(warning => `docx: ${escapeTerminalText(warning.code)}: ${escapeTerminalText(warning.message)}\n`).join("") + errors.map(error => `docx: ${escapeTerminalText(error.code)}: ${escapeTerminalText(error.message)}\n`).join("");
        budget.check("diagnosticBytes", new TextEncoder().encode(diagnostic).length);
        output = new TextEncoder().encode(invocation.options.json === true ? JSON.stringify({ version: 1, operation: invocation.operation, ok: valid, data: valid ? data : null, warnings, errors, affected: 0, locations }) + "\n" : human);
        budget.check("serializedOutput", output.length);
        if (diagnostic) {
          writingDiagnostics = true;
          await request.stderr.write(new TextEncoder().encode(diagnostic));
          writingDiagnostics = false;
        }
      } catch (error) {
        request.signal.throwIfAborted();
        if (error instanceof CancellationError) throw error;
        if (writingDiagnostics) return { exitCode: 3 };
        const code = error instanceof ResourceLimitError ? "limit-exceeded" : acquiring ? "source-failure" : error && typeof error === "object" && "code" in error ? String(error.code) : "invalid-document";
        exitCode = error instanceof ResourceLimitError ? 4 : acquiring ? 3 : 1;
        const message = acquiring ? "Unable to read the declared document input." : "Document operation failed: " + code;
        output = new TextEncoder().encode(invocation.options.json === true ? JSON.stringify({ version: 1, operation: invocation.operation, ok: false, data: null, warnings: [], errors: [{ code, message }], affected: 0, locations: [] }) + "\n" : "");
        try { await request.stderr.write(new TextEncoder().encode(`docx: ${escapeTerminalText(message)}\n`)); }
        catch { request.signal.throwIfAborted(); return { exitCode: 3 }; }
      } finally { await io.cleanup(); }
      try { if (output.length) await request.stdout.write(output); }
      catch {
        request.signal.throwIfAborted();
        return { exitCode: 3 };
      }
      return { exitCode };
    }
  }, { compressedInput: limits.maxArchiveBytes, expandedPackage: limits.maxTotalBytes, zipEntries: limits.maxMembers, retainedBytes: limits.maxRetainedBytes, xmlPartBytes: limits.maxEntryBytes, xmlDepth: limits.maxDepth });
}
