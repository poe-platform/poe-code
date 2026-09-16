import { inspectDocxCapabilities } from "./discovery.js";
import { executePackCommand } from "./pack-command.js";
import { extractDocumentArchive, ArchiveExtractionError, type ArchiveExtractionData } from "./extract.js";
import { compareDocument, type DocumentDiffOptions } from "./diff.js";
import { executeContentRemovalCommand } from "./removal-command.js";
import { executeObjectsCommand, ObjectCommandPublicationError } from "./objects-command.js";
import { ObjectExtractionCancellationError, type ObjectExtractionData } from "./objects.js";
import { inspectDocumentRevisions } from "./revisions.js";
import { executeRevisionEditCommand } from "./revision-edit-command.js";
import { executeRevisionDecisionCommand } from "./revision-decisions-command.js";
import { executeControlsCommand } from "./controls-command.js";
import { executeControlTemplateCommand } from "./control-template-command.js";
import { executeCommentsCommand } from "./comments-command.js";
import { executeFieldsCommand } from "./fields-command.js";
import { executeNotesCommand } from "./notes-command.js";
import { inspectDocumentFields } from "./fields.js";
import { executeBookmarksCommand } from "./bookmarks-command.js";
import { inspectDocumentBookmarks } from "./bookmarks.js";
import { executeLinksCommand } from "./links-command.js";
import { inspectDocumentLinks } from "./links.js";
import { executeTableEditCommand } from "./table-edit-command.js";
import { inspectDocumentTable } from "./table-read.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { executeListsCommand } from "./lists-command.js";
import { executeSectionsCommand } from "./sections-command.js";
import { executeStoriesCommand } from "./stories-command.js";
import { UnsupportedEmbeddedFontMutationError } from "./font-resources.js";
import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { type ArchiveLimits, ResourceLimitError, CancellationError } from "./archive.js";
import { DocumentBudget, documentLimitDefaults, type DocumentLimits } from "./budget.js";
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
import { executeBatchCommand } from "./batch-command.js";
import { executeStylesCommand } from "./styles-command.js";
import { executeRunFormatCommand } from "./run-format-command.js";
import { executePackageResourcesCommand } from "./ancillary-resources-command.js";
import { executeSignaturesCommand } from "./signatures-command.js";
import { executeSanitizeCommand } from "./sanitize-command.js";
import { executeSettingsCommand } from "./settings-command.js";
import { executePropertiesCommand } from "./properties-command.js";
import { executeImagesCommand, ImageCommandPublicationError } from "./images-command.js";
import { ImageExtractionCancellationError, type ImageExtractionData } from "./images.js";
import { executeImageInsertionCommand } from "./image-insertion-command.js";
import { executeImageReplacementCommand } from "./image-replacement-command.js";
import { executeImageLayoutCommand } from "./image-layout-command.js";
import { executeShapesCommand } from "./shapes-command.js";
import { executeChartsCommand } from "./charts-command.js";
import { executeDiagramsCommand, serializeDiagramMutationFailure } from "./diagrams-command.js";
import { UnsupportedDiagramMutationError } from "./diagrams.js";
import { executeEquationsCommand } from "./equations-command.js";
import { UnsupportedEquationMutationError } from "./equations.js";

export interface DocxInspectionCommandRequest extends DocxCommandRequest {
  readonly cwd: string;
  readonly filesystem: Pick<FileSystem, "readFile" | "readStream"> & Partial<FileSystem>;
  readonly registerCleanup?: ((cleanup: () => Promise<void>) => void) | undefined;
}
export interface DocxInspectionCommandResult {
  readonly exitCode: number;
  readonly extraction?: ImageExtractionData | ObjectExtractionData | ArchiveExtractionData;
}

/** Executes inspection, text and explicit XML operations with supplied filesystem authority. */
export function createDocxInspectionCommandEngine(options: { readonly limits: ArchiveLimits; readonly documentLimits?: Partial<DocumentLimits> }) {
  const limits = Object.freeze({ ...options.limits });
  return createDocxCommandEngine<DocxInspectionCommandRequest, DocxInspectionCommandResult>({
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
      let archiveReceipt: ArchiveExtractionData | undefined;
      let imageReceipt: ImageExtractionData | ObjectExtractionData | undefined;
      const sinkFailure = (cause: unknown): DocxInspectionCommandResult => {
        if (archiveReceipt) {
          const extraction = { ...archiveReceipt, complete: false, possiblePartialOutput: archiveReceipt.complete || archiveReceipt.possiblePartialOutput };
          if (request.signal.aborted || cause instanceof CancellationError) throw new ArchiveExtractionError(cause, extraction, true);
          return { exitCode: 3, extraction };
        }
        if (!imageReceipt) { request.signal.throwIfAborted(); return { exitCode: invocation.operation === "diff" ? 2 : 3 }; }
        const extraction = { ...imageReceipt, complete: false };
        if (request.signal.aborted || cause instanceof CancellationError) {
          const published = [...extraction.entries.filter(entry => entry.published).map(entry => ({ path: entry.path, bytes: entry.bytes })), ...(extraction.manifest.published ? [{ path: extraction.manifest.path, bytes: extraction.manifest.bytes }] : [])];
          const ErrorType = invocation.operation === "objects.extract" ? ObjectExtractionCancellationError : ImageExtractionCancellationError;
          throw new ErrorType(cause instanceof CancellationError ? cause : new CancellationError("Resource output cancelled.", { cause }), extraction, published);
        }
        return { exitCode: 3, extraction };
      };
      const controlTemplateOperation = ["controls.repeat", "controls.bind", "template.apply"].includes(invocation.operation);
      const controlOperation = controlTemplateOperation || ["controls.list", "controls.set"].includes(invocation.operation);
      const fieldOperation = ["fields.add", "fields.set", "toc.add", "toc.set", "captions.add", "captions.set"].includes(invocation.operation);
      const commentOperation = ["comments.list", "comments.get", "comments.add", "comments.set", "comments.remove"].includes(invocation.operation);
      const revisionEditOperation = ["revisions.add", "revisions.accept", "revisions.reject"].includes(invocation.operation);
      const noteOperation = ["notes.list", "notes.get", "notes.add", "notes.set", "notes.remove"].includes(invocation.operation);
      const bookmarkOperation = ["bookmarks.add", "bookmarks.set", "bookmarks.remove"].includes(invocation.operation);
      const linkOperation = ["links.add", "links.set", "links.remove"].includes(invocation.operation);
      const tableOperation = ["tables.set", "tables.rows.add", "tables.rows.remove", "tables.columns.add", "tables.columns.remove", "tables.merge", "tables.split"].includes(invocation.operation);
      const listOperation = ["lists.add", "lists.set"].includes(invocation.operation);
      const storyOperation = ["headers.list", "headers.get", "headers.set", "headers.remove", "footers.list", "footers.get", "footers.set", "footers.remove"].includes(invocation.operation);
      const propertyOperation = ["properties.list", "properties.get", "properties.set", "properties.remove"].includes(invocation.operation);
      const objectOperation = ["objects.list", "objects.extract"].includes(invocation.operation);
      const imageOperation = ["images.list", "images.get", "images.extract"].includes(invocation.operation);
      const imageInsertionOperation = invocation.operation === "images.add";
      const imageReplacementOperation = invocation.operation === "images.replace";
      const imageLayoutOperation = invocation.operation === "images.set";
      const shapeOperation = ["shapes.list", "shapes.set"].includes(invocation.operation);
      const chartOperation = invocation.operation === "charts.list";
      const diagramOperation = invocation.operation === "diagrams.list";
      const equationOperation = ["equations.list", "equations.add", "equations.replace"].includes(invocation.operation);
      const equationEditOperation = equationOperation && invocation.operation !== "equations.list";
      const signatureOperation = ["signatures.list", "signatures.remove"].includes(invocation.operation);
      const packageResourceOperation = signatureOperation || invocation.operation === "settings.list" || objectOperation || equationOperation || diagramOperation || chartOperation || imageLayoutOperation || imageReplacementOperation || imageInsertionOperation || imageOperation || propertyOperation || ["custom-xml.list", "glossary.list"].includes(invocation.operation);
      try {
        if (invocation.operation === "diff") {
          acquiring = true;
          const inputs: Uint8Array[] = [];
          for (const input of invocation.inputs) {
            inputs.push(await io.readBytes({ open(signal) {
              if (input === "-") return request.stdin;
              const path = resolvePath(request.cwd, input);
              return request.filesystem.readStream ? request.filesystem.readStream(path, { signal }) : { async *[Symbol.asyncIterator]() { yield await request.filesystem.readFile(path, { signal }); } };
            } }));
          }
          acquiring = false;
          const data = await compareDocument(inputs[0]!, inputs[1]!, context, invocation.options as DocumentDiffOptions);
          exitCode = data.equal ? 0 : 1;
          output = new TextEncoder().encode(invocation.options.json ? JSON.stringify({ version: 1, operation: "diff", ok: true, data, warnings: [], errors: [], affected: 0, locations: [] }) + "\n" : `docx diff: ${data.equal ? "equal" : "different"} (${data.mode}); ${data.differences.length} changed parts\n`);
          budget.check("serializedOutput", output.length);
        } else if (invocation.operation === "pack") {
          output = await executePackCommand(invocation, request, context, io);
          budget.check("serializedOutput", output.length);
        } else if (invocation.operation === "create") {
          output = await executeCreateCommand(invocation, request, context, io);
          budget.check("serializedOutput", output.length);
        } else {
        if (invocation.operation !== "extract" && !shapeOperation && !packageResourceOperation && invocation.operation !== "revisions.list" && !controlOperation && !revisionEditOperation && !commentOperation && !noteOperation && !fieldOperation && invocation.operation !== "fields.list" && !bookmarkOperation && invocation.operation !== "bookmarks.list" && !linkOperation && invocation.operation !== "links.list" && !tableOperation && invocation.operation !== "tables.get" && !listOperation && !storyOperation && invocation.operation !== "batch" && invocation.operation !== "capabilities" && invocation.operation !== "inspect" && invocation.operation !== "validate" && invocation.operation !== "text.get" && !["sanitize", "text.replace", "lorem.set"].includes(invocation.operation) && invocation.operation !== "runs.set" && !["paragraphs.remove", "runs.remove", "tables.remove", "paragraphs.set", "paragraphs.add", "runs.add", "tables.add"].includes(invocation.operation) && !["sections.list", "sections.set", "sections.add", "batch", "styles.list", "styles.get", "styles.add", "styles.set", "styles.defaults.get", "styles.defaults.set", "styles.latent.list", "styles.latent.get", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.get", "styles.latent.defaults.set"].includes(invocation.operation) && invocation.operation !== "xml.get" && invocation.operation !== "xml.set") {
          throw Object.assign(new Error("This document operation is not implemented."), { code: "unsupported-profile" });
        }
        if (invocation.operation !== "revisions.list" && !controlOperation && !revisionEditOperation && !fieldOperation && invocation.operation !== "fields.list" && !bookmarkOperation && invocation.operation !== "bookmarks.list" && !linkOperation && invocation.operation !== "links.list" && ["link", "control", "revision", "shape", "field", "bookmark"].some(key => invocation.options[key] !== undefined && !(key === "shape" && (shapeOperation || ["text.get", "text.replace"].includes(invocation.operation))))) {
          throw Object.assign(new Error("This inspection selector is not implemented."), { code: "unsupported-profile" });
        }
        const input = invocation.inputs[0]!;
        acquiring = true;
        let inputIdentity: PublicationInput | undefined;
        if ((equationEditOperation || ["images.extract", "objects.extract"].includes(invocation.operation) || imageInsertionOperation || imageReplacementOperation || imageLayoutOperation) && input !== "-" && request.filesystem.lstat) {
          const path = resolvePath(request.cwd, input);
          inputIdentity = { path, stat: await request.filesystem.lstat(path, { signal: request.signal }) };
        }
        if ((controlTemplateOperation || invocation.operation === "controls.set" || (commentOperation && !["comments.list", "comments.get"].includes(invocation.operation)) || (noteOperation && !["notes.list", "notes.get"].includes(invocation.operation)) || revisionEditOperation || fieldOperation || bookmarkOperation || linkOperation || tableOperation || ["sanitize", "signatures.remove", "shapes.set", "properties.set", "properties.remove", "lists.add", "lists.set", "headers.set", "headers.remove", "footers.set", "footers.remove", "sections.set", "sections.add", "batch", "styles.add", "styles.set", "styles.defaults.set", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.set", "xml.set", "text.replace", "lorem.set", "runs.set", "paragraphs.remove", "runs.remove", "tables.remove", "paragraphs.set", "paragraphs.add", "runs.add", "tables.add"].includes(invocation.operation)) && input !== "-" && request.filesystem.lstat && (invocation.operation !== "batch" || invocation.options.inPlace === true || typeof invocation.options.output === "string" && invocation.options.output !== "-")) {
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
        if (invocation.operation === "extract") {
          const extraction = await extractDocumentArchive(bytes, { ...invocation.options, outputDir: resolvePath(request.cwd, invocation.options.outputDir as string) }, { ...context, filesystem: request.filesystem as FileSystem });
          archiveReceipt = extraction;
          const envelope = { version: 1, operation: "extract", ok: true, data: extraction, affected: 0, locations: [], warnings: [], errors: [] };
          output = new TextEncoder().encode(invocation.options.json ? JSON.stringify(envelope) + "\n" : `Extracted: ${extraction.entries.length}; complete: true\n`);
          budget.check("serializedOutput", output.length);
        } else if (shapeOperation || packageResourceOperation || controlOperation || revisionEditOperation || commentOperation || noteOperation || fieldOperation || bookmarkOperation || linkOperation || tableOperation || listOperation || storyOperation || ["sanitize", "sections.list", "sections.set", "sections.add", "batch", "styles.list", "styles.get", "styles.add", "styles.set", "styles.defaults.get", "styles.defaults.set", "styles.latent.list", "styles.latent.get", "styles.latent.add", "styles.latent.set", "styles.latent.remove", "styles.latent.defaults.get", "styles.latent.defaults.set", "xml.get", "xml.set", "text.replace", "lorem.set", "runs.set", "paragraphs.remove", "runs.remove", "tables.remove", "paragraphs.set", "paragraphs.add", "runs.add", "tables.add"].includes(invocation.operation)) {
          output = invocation.operation === "sanitize" ? await executeSanitizeCommand(invocation, bytes, inputIdentity, request, context)
            : signatureOperation ? await executeSignaturesCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation === "settings.list" ? await executeSettingsCommand(invocation, bytes, context)
            : objectOperation ? await executeObjectsCommand(invocation, bytes, inputIdentity, request, context, data => { imageReceipt = data; return undefined; })
            : equationOperation ? await executeEquationsCommand(invocation, bytes, inputIdentity, request, context, io)
            : diagramOperation ? await executeDiagramsCommand(invocation, bytes, request, context)
            : chartOperation ? await executeChartsCommand(invocation, bytes, request, context)
            : shapeOperation ? await executeShapesCommand(invocation, bytes, inputIdentity, request, context)
            : imageLayoutOperation ? await executeImageLayoutCommand(invocation, bytes, inputIdentity, request, context)
            : imageReplacementOperation ? await executeImageReplacementCommand(invocation, bytes, inputIdentity, request, context)
            : imageInsertionOperation ? await executeImageInsertionCommand(invocation, bytes, inputIdentity, request, context)
            : imageOperation ? await executeImagesCommand(invocation, bytes, inputIdentity, request, context, data => { imageReceipt = data; return undefined; })
            : packageResourceOperation ? propertyOperation
            ? await executePropertiesCommand(invocation, bytes, inputIdentity, request, context)
            : await executePackageResourcesCommand(invocation, bytes, request, context)
            : controlOperation ? controlTemplateOperation
            ? await executeControlTemplateCommand(invocation, bytes, inputIdentity, request, context)
            : await executeControlsCommand(invocation, bytes, inputIdentity, request, context)
            : revisionEditOperation ? invocation.operation === "revisions.add"
            ? await executeRevisionEditCommand(invocation, bytes, inputIdentity, request, context)
            : await executeRevisionDecisionCommand(invocation, bytes, inputIdentity, request, context)
            : commentOperation ? await executeCommentsCommand(invocation, bytes, inputIdentity, request, context)
            : noteOperation ? await executeNotesCommand(invocation, bytes, inputIdentity, request, context)
            : fieldOperation ? await executeFieldsCommand(invocation, bytes, inputIdentity, request, context)
            : bookmarkOperation ? await executeBookmarksCommand(invocation, bytes, inputIdentity, request, context)
            : linkOperation ? await executeLinksCommand(invocation, bytes, inputIdentity, request, context)
            : tableOperation ? await executeTableEditCommand(invocation, bytes, inputIdentity, request, context)
            : listOperation ? await executeListsCommand(invocation, bytes, inputIdentity, request, context)
            : storyOperation ? await executeStoriesCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation.startsWith("sections.") ? await executeSectionsCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation === "batch" ? await executeBatchCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation.startsWith("styles.") ? await executeStylesCommand(invocation, bytes, inputIdentity, request, context)
            : ["paragraphs.remove", "runs.remove", "tables.remove"].includes(invocation.operation) ? await executeContentRemovalCommand(invocation, bytes, inputIdentity, request, context)
            : ["paragraphs.set", "paragraphs.add", "runs.add", "tables.add"].includes(invocation.operation) ? await executeParagraphEditCommand(invocation, bytes, inputIdentity, request, context)
            : invocation.operation === "runs.set" ? await executeRunFormatCommand(invocation, bytes, inputIdentity, request, context)
            : ["sanitize", "text.replace", "lorem.set"].includes(invocation.operation) ? await executeTextReplaceCommand(invocation, bytes, inputIdentity, request, context)
            : await executeXmlCommand(invocation, bytes, inputIdentity, request, context, io);
          budget.check("serializedOutput", output.length);
        } else if (invocation.operation === "revisions.list") {
          const data = await inspectDocumentRevisions(bytes, invocation.options as DocxOperationArguments<"revisions.list">, context);
          const human = data.items.map((item, i) => `${i + 1}. ${escapeTerminalText(item.markup)} (ID ${escapeTerminalText(item.id ?? "unknown")}): ${item.support}; ${escapeTerminalText(item.author ?? "unknown")}; ${escapeTerminalText(item.timestamp ?? "unknown")}`).join("\n") + (data.items.length ? "\n" : "");
          output = new TextEncoder().encode(invocation.options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: 0, locations: data.items.map(i => i.location), warnings: [], errors: [] }) + "\n" : human);
          budget.check("serializedOutput", output.length);
        } else if (invocation.operation === "fields.list") {
          const data = await inspectDocumentFields(bytes, invocation.options as DocxOperationArguments<"fields.list">, context);
          output = new TextEncoder().encode(invocation.options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: 0, locations: data.items.map(i => i.location), warnings: [], errors: [] }) + "\n" : data.items.map((item, i) => `${i + 1}. ${escapeTerminalText(item.kind)}: ${escapeTerminalText(item.instruction)} → ${escapeTerminalText(item.result)}`).join("\n") + (data.items.length ? "\n" : ""));
          budget.check("serializedOutput", output.length);
        } else if (invocation.operation === "bookmarks.list") {
          const data = await inspectDocumentBookmarks(bytes, invocation.options as DocxOperationArguments<"bookmarks.list">, context);
          const human = [...data.items.map((item, i) => `${i + 1}. ${escapeTerminalText(item.name)} (ID ${escapeTerminalText(item.id)})`), ...data.issues.map(issue => `Issue: ${escapeTerminalText(issue)}`)].join("\n") + (data.items.length || data.issues.length ? "\n" : "");
          output = new TextEncoder().encode(invocation.options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: 0, locations: data.items.map(i => i.location), warnings: [], errors: [] }) + "\n" : human);
          budget.check("serializedOutput", output.length);
        } else if (invocation.operation === "links.list") {
          const data = await inspectDocumentLinks(bytes, invocation.options as DocxOperationArguments<"links.list">, context);
          output = new TextEncoder().encode(invocation.options.json ? JSON.stringify({ version: 1, operation: "links.list", ok: true, data, affected: 0, locations: data.items.map(i => i.location), warnings: [], errors: [] }) + "\n" : data.items.map((item, i) => `${i + 1}. ${escapeTerminalText(item.text)} → ${escapeTerminalText(item.address || "#" + item.fragment)}`).join("\n") + (data.items.length ? "\n" : ""));
          budget.check("serializedOutput", output.length);
        } else if (invocation.operation === "tables.get") {
          const data = await inspectDocumentTable(bytes, invocation.options as DocxOperationArguments<"tables.get">, context);
          const details = data.item.details;
          const human = `docx tables get: ${details.rows} rows; ${details.columns} columns\n` + details.cells.map(cell =>
            `Row ${cell.row}, column ${cell.column} (${cell.rowSpan}x${cell.columnSpan}): ${escapeTerminalText(cell.text)}\n`).join("");
          output = new TextEncoder().encode(invocation.options.json ? JSON.stringify({ version: 1, operation: invocation.operation, ok: true, data, affected: 0, locations: [data.item.location, ...details.cells.map(cell => cell.location)], warnings: [], errors: [] }) + "\n" : human);
          budget.check("serializedOutput", output.length);
        } else if (invocation.operation === "capabilities") {
          const discovery = await inspectDocxCapabilities(bytes, context, request.filesystem);
          output = new TextEncoder().encode(invocation.options.json ? JSON.stringify({ version: 1, operation: "capabilities", ok: true, data: discovery.data, warnings: [], errors: [], affected: 0, locations: [] }) + "\n" : discovery.human);
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
        if (error instanceof ArchiveExtractionError) {
          archiveReceipt = error.data;
          const diagnostic = commandDiagnostic(error.message, error.code, budget.limits.diagnosticBytes);
          const envelope = { version: 1, operation: "extract", ok: false, data: error.data, affected: 0, locations: [], warnings: [], errors: [{ code: error.code, message: error.message }] };
          try {
            if (invocation.options.json) await request.stdout.write(new TextEncoder().encode(JSON.stringify(envelope) + "\n"));
            await request.stderr.write(new TextEncoder().encode(diagnostic.human));
          } catch (cause) { return sinkFailure(cause); }
          if (error.code === "cancelled") throw error;
          return { exitCode: error.code === "limit-exceeded" ? 4 : error.code === "conflict" ? 1 : 3, extraction: error.data };
        }
        if (["images.extract", "objects.extract"].includes(invocation.operation) && (error instanceof ImageExtractionCancellationError || error instanceof ObjectExtractionCancellationError)) throw error;
        request.signal.throwIfAborted();
        if (error instanceof CancellationError) throw error;
        if (writingDiagnostics) return { exitCode: invocation.operation === "diff" ? 2 : 3 };
        const code = error instanceof ResourceLimitError ? "limit-exceeded" : acquiring ? "source-failure" : error && typeof error === "object" && "code" in error ? String(error.code) : "invalid-document";
        exitCode = error instanceof ResourceLimitError ? 4 : code === "conflict" ? 1 : acquiring || error instanceof PublicationError || code === "source-failure" || code === "sink-failure" ? 3 : code === "usage" ? 2 : 1;
        if (invocation.operation === "diff") exitCode = 2;
        const diagnostic = commandDiagnostic(acquiring ? "Unable to read the declared document input." : error instanceof PublicationError && error.stdoutMayBePartial ? "Binary stdout may contain partial output." : error instanceof UnsupportedEmbeddedFontMutationError ? error.message : "Document operation failed: " + code, code, budget.limits.diagnosticBytes);
        const message = diagnostic.message;
        const batchFailure = invocation.operation === "batch" && error instanceof Error && "operationIndex" in error && "operationId" in error
          ? { operationIndex: error.operationIndex, operationId: error.operationId } : {};
        const imageFailure = ["images.extract", "objects.extract"].includes(invocation.operation) && (error instanceof ImageCommandPublicationError || error instanceof ObjectCommandPublicationError) ? error : undefined;
        const locatedFailure = error instanceof UnsupportedDiagramMutationError || error instanceof UnsupportedEquationMutationError ? error : undefined;
        if (imageFailure) imageReceipt = imageFailure.data;
        output = imageFailure ? imageFailure.responseBytes : locatedFailure && invocation.options.json === true
          ? serializeDiagramMutationFailure(invocation.operation, locatedFailure, code, message, budget)
          : new TextEncoder().encode(invocation.options.json === true ? JSON.stringify({ version: 1, operation: invocation.operation, ok: false, data: null, warnings: [], errors: [{ code, message, ...batchFailure }], affected: 0, locations: [] }) + "\n" : "");
        try { await request.stderr.write(imageFailure ? imageFailure.diagnosticBytes : new TextEncoder().encode(diagnostic.human)); }
        catch (cause) { return sinkFailure(cause); }
      } finally { await io.cleanup(); }
      try { if (output.length) await request.stdout.write(output); }
      catch (cause) { return sinkFailure(cause); }
      return { exitCode, ...(archiveReceipt ? { extraction: archiveReceipt } : {}) };
    }
  }, { compressedInput: limits.maxArchiveBytes, expandedPackage: limits.maxTotalBytes, zipEntries: limits.maxMembers, retainedBytes: limits.maxRetainedBytes, xmlPartBytes: Math.min(limits.maxEntryBytes, documentLimitDefaults.xmlPartBytes), xmlDepth: Math.min(limits.maxDepth, documentLimitDefaults.xmlDepth), ...options.documentLimits });
}
