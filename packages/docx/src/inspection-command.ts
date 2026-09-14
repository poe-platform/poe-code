import { executeListsCommand } from "./lists-command.js";
import { executeSectionsCommand } from "./sections-command.js";
import { executeStoriesCommand } from "./stories-command.js";
import { UnsupportedEmbeddedFontMutationError } from "./font-resources.js";
import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { type ArchiveLimits, ResourceLimitError, CancellationError } from "./archive.js";
import { DocumentBudget } from "./budget.js";
import { createDocxCommandEngine, commandDiagnostic, docxInvocationBudgets, type DocxCommandRequest } from "./command.js";
import { DocumentIo } from "./io.js";
import { inspectDocument, validateDocument } from "./inspection.js";
import { openDocumentLocations } from "./locations.js";
import type { DocumentScope } from "./location-index.js";
import type { Location } from "./location-token.js";
import { executeXmlCommand } from "./xml-command.js";
import { PublicationError, type PublicationInput } from "./publication.js";
import { extractDocumentText, type TextOptions } from "./text.js";
import { executeCreateCommand } from "./create-command.js";
import { executeTextReplaceCommand } from "./text-replace-command.js";
import { executeParagraphEditCommand } from "./paragraph-edit-command.js";
import { executeStyleModelCommand } from "./style-model-command.js";
import { executeStylesCommand } from "./styles-command.js";
import { executeRunFormatCommand } from "./run-format-command.js";

export interface DocxInspectionCommandRequest extends DocxCommandRequest {
  readonly cwd: string;
  readonly filesystem: Pick<FileSystem, "readFile" | "readStream"> & Partial<FileSystem>;
  readonly registerCleanup?: ((cleanup: () => Promise<void>) => void) | undefined;
}

/** Executes inspection, text and explicit XML operations with supplied filesystem authority. */
export function createDocxInspectionCommandEngine(options: { readonly limits: ArchiveLimits }) {
  const limits = Object.freeze({ ...options.limits });
  return createDocxCommandEngine<DocxInspectionCommandRequest>({
    async readSource(source, request, budget) {
      const io = new DocumentIo({ limits, signal: request.signal, budget, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
      try {
        return await io.readBytes({ open(signal) {
          const path = resolvePath(request.cwd, source.path);
          return request.filesystem.readStream ? request.filesystem.readStream(path, { signal }) :
            { async *[Symbol.asyncIterator]() { yield await request.filesystem.readFile(path, { signal }); } };
        } });
      } finally { await io.cleanup(); }
    },
    async execute(invocation, request) {
      const budget = docxInvocationBudgets.get(invocation) ?? new DocumentBudget({}, request.signal);
      const context = { limits, signal: request.signal, budget };
      const io = new DocumentIo({ ...context, ...(request.registerCleanup ? { registerCleanup: request.registerCleanup } : {}) });
      let acquiring = false;
      let writingDiagnostics = false;
      let output: Uint8Array;
      let exitCode = 0;
      const listOperation = ["lists.add", "lists.set"].includes(invocation.operation);
      const storyOperation = ["headers.list", "headers.get", "headers.set", "headers.remove", "footers.list", "footers.get", "footers.set", "footers.remove"].includes(invocation.operation);
      try {
        if (invocation.operation === "create") {
          output = await executeCreateCommand(invocation, request, context, io);
          budget.check("serializedOutput", output.length);
        } else {
        if (!listOperation && !storyOperation && invocation.operation !== "batch" && invocation.operation !== "inspect" && invocation.operation !== "validate" && invocation.operation !== "text.get" && invocation.operation !== "text.replace" && invocation.operation !== "runs.set" && !["paragraphs.set", "paragraphs.add", "runs.add"].includes(invocation.operation) && !["sections.list", "sections.set", "sections.add", "batch", "styles.list", "styles.get", "styles.add", "styles.set", "styles.defaults.get", "styles.defaults.set", "styles.latent.list", "styles.latent.get", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.get", "styles.latent.defaults.set"].includes(invocation.operation) && invocation.operation !== "xml.get" && invocation.operation !== "xml.set") {
          throw Object.assign(new Error("This document operation is not implemented."), { code: "unsupported-profile" });
        }
        if (["link", "control", "revision", "shape", "field", "bookmark"].some(key => invocation.options[key] !== undefined)) {
          throw Object.assign(new Error("This inspection selector is not implemented."), { code: "unsupported-profile" });
        }
        const input = invocation.inputs[0]!;
        acquiring = true;
        let inputIdentity: PublicationInput | undefined;
        if (["lists.add", "lists.set", "headers.set", "headers.remove", "footers.set", "footers.remove", "sections.set", "sections.add", "batch", "styles.add", "styles.set", "styles.defaults.set", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.set", "xml.set", "text.replace", "runs.set", "paragraphs.set", "paragraphs.add", "runs.add"].includes(invocation.operation) && input !== "-" && request.filesystem.lstat) {
          const path = resolvePath(request.cwd, input);
          inputIdentity = { path, stat: await request.filesystem.lstat(path, { signal: request.signal }) };
        }
        const bytes = await io.readBytes({ open(signal) {
          if (input === "-") return request.stdin;
          const path = resolvePath(request.cwd, input);
          if (request.filesystem.readStream) return request.filesystem.readStream(path, { signal });
          return { async *[Symbol.asyncIterator]() { yield await request.filesystem.readFile(path, { signal }); } };
        } });
        acquiring = false;
        if (listOperation || storyOperation || ["sections.list", "sections.set", "sections.add", "batch", "styles.list", "styles.get", "styles.add", "styles.set", "styles.defaults.get", "styles.defaults.set", "styles.latent.list", "styles.latent.get", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.get", "styles.latent.defaults.set", "xml.get", "xml.set", "text.replace", "runs.set", "paragraphs.set", "paragraphs.add", "runs.add"].includes(invocation.operation)) {
          output = listOperation ? await executeListsCommand(invocation, bytes, inputIdentity, request, context)
            : storyOperation ? await executeStoriesCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation.startsWith("sections.") ? await executeSectionsCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation === "batch" ? await executeStyleModelCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation.startsWith("styles.") ? await executeStylesCommand(invocation, bytes, inputIdentity, request, context)
            : ["paragraphs.set", "paragraphs.add", "runs.add"].includes(invocation.operation) ? await executeParagraphEditCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation === "runs.set" ? await executeRunFormatCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation === "text.replace" ? await executeTextReplaceCommand(invocation, bytes, inputIdentity, request, context)
            : await executeXmlCommand(invocation, bytes, inputIdentity, request, context, io);
          budget.check("serializedOutput", output.length);
        } else {
          const data = invocation.operation === "text.get" ? await extractDocumentText(bytes, context, invocation.options as TextOptions)
            : invocation.operation === "inspect" ? await inspectDocument(bytes, context)
            : await validateDocument(bytes, context, invocation.options.profile === undefined ? {} : { profile: invocation.options.profile as "core-v1" });
          const locations: Location[] = [];
          if ("segments" in data) locations.push(...new Map(data.segments.map(segment => [segment.location.token, segment.location])).values());
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
          const warnings = "warnings" in data ? data.warnings.map(warning => typeof warning === "string" ? { code: "partial-validation", message: warning } : warning) : [];
          const errors = "diagnostics" in data ? data.diagnostics.map(item => ({ code: "invalid-package", message: item.message, part: item.part, location: item.location })) : [];
          const human = "text" in data ? data.text : "valid" in data ? `docx validate: ${data.valid ? "valid within" : "invalid within"} ${data.profile}\n${data.checks.map(check => `${check.id}: ${check.status}`).join("\n")}\n`
            : `docx inspect: ${data.kind}, ${data.dialect}\nParts: ${data.parts.length}; paragraphs: ${data.counts.paragraphs}; tables: ${data.counts.tables}; images: ${data.counts.images}\nCached pages: ${data.counts.cachedPages ?? "unknown"}; rendered pages: not calculated\nThemes: ${data.fontResources.themes.length}; font tables: ${data.fontResources.fontTables.length}; unresolved font/theme references: ${data.fontResources.diagnostics.length}\nFont references do not establish installed fonts or licensing.\nSignatures present: ${data.signed}; signatures verified: not performed\nProtected: ${data.protected}\n`;
          const diagnostic = warnings.map(warning => `docx: ${escapeTerminalText(warning.code)}: ${escapeTerminalText(warning.message)}\n`).join("") + errors.map(error => `docx: ${escapeTerminalText(error.code)}: ${escapeTerminalText(error.message)}\n`).join("");
          budget.check("diagnosticBytes", new TextEncoder().encode(diagnostic).length);
          output = new TextEncoder().encode(invocation.options.json === true ? JSON.stringify({ version: 1, operation: invocation.operation, ok: valid, data: valid ? data : null, warnings, errors, affected: 0, locations }) + "\n" : human);
          budget.check("serializedOutput", output.length);
          if (diagnostic) {
            writingDiagnostics = true;
            await request.stderr.write(new TextEncoder().encode(diagnostic));
            writingDiagnostics = false;
          }
        }
        }
      } catch (error) {
        request.signal.throwIfAborted();
        if (error instanceof CancellationError) throw error;
        if (writingDiagnostics) return { exitCode: 3 };
        const code = error instanceof ResourceLimitError ? "limit-exceeded" : acquiring ? "source-failure" : error && typeof error === "object" && "code" in error ? String(error.code) : "invalid-document";
        exitCode = error instanceof ResourceLimitError ? 4 : code === "conflict" ? 1 : acquiring || error instanceof PublicationError || code === "source-failure" || code === "sink-failure" ? 3 : code === "usage" ? 2 : 1;
        const diagnostic = commandDiagnostic(acquiring ? "Unable to read the declared document input." : error instanceof PublicationError && error.stdoutMayBePartial ? "Binary stdout may contain partial output." : error instanceof UnsupportedEmbeddedFontMutationError ? error.message : "Document operation failed: " + code, code, budget.limits.diagnosticBytes);
        const message = diagnostic.message;
        output = new TextEncoder().encode(invocation.options.json === true ? JSON.stringify({ version: 1, operation: invocation.operation, ok: false, data: null, warnings: [], errors: [{ code, message }], affected: 0, locations: [] }) + "\n" : "");
        try { await request.stderr.write(new TextEncoder().encode(diagnostic.human)); }
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
