import { resolvePath, type FileSystem } from "@poe-code/safe-fs/core";
import { escapeTerminalText } from "toolcraft-design/escape-terminal-text";
import { measurePackageResourceSerialization } from "./ancillary-resources.js";
import { archiveSettings, CancellationError, type ArchiveContext } from "./archive.js";
import { DocxUsageError } from "./argument-json.js";
import { commandDiagnostic, type DocxInvocation } from "./command.js";
import type { DocxInspectionCommandRequest } from "./inspection-command.js";
import {
  inspectDocumentObjects,
  extractDocumentObjects,
  ObjectExtractionPublicationError,
  ObjectExtractionCancellationError,
  type ObjectExtractionData
} from "./objects.js";
import type { DocxOperationArguments } from "./operation-types.js";
import { PublicationError, type PublicationInput } from "./publication.js";

function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code <= 127 ? 1 : code <= 2047 ? 2 : code <= 65535 ? 3 : 4;
  }
  return bytes;
}
function escapedUtf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) bytes += utf8Length(escapeTerminalText(character));
  return bytes;
}
export class ObjectCommandPublicationError extends ObjectExtractionPublicationError {
  constructor(
    error: ObjectExtractionPublicationError,
    readonly responseBytes: Uint8Array,
    readonly diagnosticBytes: Uint8Array
  ) {
    super(error, error.data);
  }
}

/** Routes inert object inventory and explicit original-byte VFS extraction. */
export async function executeObjectsCommand(
  invocation: DocxInvocation,
  bytes: Uint8Array,
  input: PublicationInput | undefined,
  request: DocxInspectionCommandRequest,
  context: ArchiveContext,
  onExtraction?: (data: ObjectExtractionData) => undefined
): Promise<Uint8Array> {
  if (!["objects.list", "objects.extract"].includes(invocation.operation))
    throw new DocxUsageError("Expected an object inspection or extraction operation.");
  const settings = archiveSettings(context),
    options = invocation.options as DocxOperationArguments<"objects.extract">;
  const budget = settings.budget.lower(
    Object.fromEntries((options.limit ?? []).map((limit) => [limit.name, limit.value]))
  );
  const extraction = invocation.operation === "objects.extract";
  let reserved = false;
  const admitPublication = (planned: ObjectExtractionData): undefined => {
    const { warnings, ...data } = planned,
      locations = data.entries.flatMap((entry) => entry.locations);
    const diagnosticSize = warnings.reduce(
      (size, warning) => size + utf8Length(`docx: ${warning.code}: ${warning.message}\n`),
      0
    );
    budget.check(
      "diagnosticBytes",
      diagnosticSize +
        utf8Length(
          "docx: unsupported-publication: Document operation failed: unsupported-publication\n"
        )
    );
    let responseSize: number;
    if (options.json) {
      const envelope = {
        version: 1,
        operation: invocation.operation,
        ok: true,
        data,
        affected: 0,
        locations,
        warnings,
        errors: []
      };
      const success = measurePackageResourceSerialization(envelope, budget) + 1;
      const failure =
        measurePackageResourceSerialization(
          {
            ...envelope,
            ok: false,
            data: { ...data, complete: false },
            errors: [
              {
                code: "unsupported-publication",
                message: "Document operation failed: unsupported-publication"
              }
            ]
          },
          budget
        ) + 1;
      budget.check("serializedOutput", Math.max(success, failure));
      responseSize = Math.max(success, failure);
    } else {
      responseSize = utf8Length(`Objects extracted: ${data.entries.length}; complete: false\n`);
      budget.check("serializedOutput", responseSize);
    }
    const diagnostics =
      diagnosticSize +
      utf8Length(
        "docx: unsupported-publication: Document operation failed: unsupported-publication\n"
      );
    budget.charge(
      "retainedBytes",
      responseSize * 12 + diagnostics * 12 + data.entries.length * 512 + 1024
    );
    budget.charge("work", responseSize * 12 + diagnostics * 12 + data.entries.length * 16 + 1024);
    reserved = true;
    return undefined;
  };
  const commandError = (error: ObjectExtractionPublicationError): ObjectCommandPublicationError => {
    const { warnings, ...data } = error.data,
      diagnostic = commandDiagnostic(
        "Document operation failed: " + error.code,
        error.code,
        budget.limits.diagnosticBytes
      );
    const envelope = {
      version: 1,
      operation: invocation.operation,
      ok: false,
      data,
      affected: 0,
      locations: data.entries.flatMap((entry) => entry.locations),
      warnings,
      errors: [{ code: error.code, message: diagnostic.message }]
    };
    return new ObjectCommandPublicationError(
      error,
      new TextEncoder().encode(options.json ? JSON.stringify(envelope) + "\n" : ""),
      new TextEncoder().encode(diagnostic.human)
    );
  };
  let inspected;
  try {
    inspected = extraction
      ? await extractDocumentObjects(
          bytes,
          {
            ...options,
            outputDir: resolvePath(request.cwd, options.outputDir!),
            ...(input ? { input } : {})
          },
          {
            ...settings,
            budget,
            encoding: { order: "input", compression: "store" },
            filesystem: request.filesystem as FileSystem,
            admitPublication
          }
        )
      : await inspectDocumentObjects(
          bytes,
          invocation.options as DocxOperationArguments<"objects.list">,
          { ...settings, budget }
        );
  } catch (error) {
    if (reserved && error instanceof ObjectExtractionPublicationError) throw commandError(error);
    throw error;
  }
  if ("entries" in inspected && onExtraction) onExtraction(inspected);
  const { warnings, ...data } = inspected;
  const records = "items" in data ? data.items : [];
  const locations =
    "entries" in data
      ? data.entries.flatMap((entry) => entry.locations)
      : records.map((record) => record.location);
  const envelope = {
    version: 1,
    operation: invocation.operation,
    ok: true,
    data,
    affected: 0,
    locations,
    warnings,
    errors: []
  };
  let text: string;
  if (options.json) {
    if (!reserved) {
      const size = measurePackageResourceSerialization(envelope, budget) + 1;
      budget.check("serializedOutput", size);
      budget.charge("retainedBytes", size * 6);
    }
    text = JSON.stringify(envelope) + "\n";
  } else if ("entries" in data) {
    text = `Objects extracted: ${data.entries.filter((entry) => entry.published).length}; complete: ${data.complete}\n`;
  } else {
    let size = utf8Length(`Objects: ${records.length}\n`);
    for (const record of records)
      size +=
        escapedUtf8Length(record.name ?? "Unresolved object") +
        escapedUtf8Length(record.details.resource?.contentType ?? "unresolved") +
        utf8Length(`: ; ${record.details.resource?.bytes ?? "unknown"} bytes; ${record.support}\n`);
    budget.check("serializedOutput", size);
    budget.charge("retainedBytes", size * 6);
    text =
      `Objects: ${records.length}\n` +
      records
        .map(
          (record) =>
            `${escapeTerminalText(record.name ?? "Unresolved object")}: ${escapeTerminalText(record.details.resource?.contentType ?? "unresolved")}; ${record.details.resource?.bytes ?? "unknown"} bytes; ${record.support}\n`
        )
        .join("");
  }
  const diagnosticSize = warnings.reduce(
    (size, warning) => size + utf8Length(`docx: ${warning.code}: ${warning.message}\n`),
    0
  );
  if (!reserved) {
    budget.check("diagnosticBytes", diagnosticSize);
    budget.charge("retainedBytes", diagnosticSize * 3 + utf8Length(text) * 3);
  }
  if (warnings.length) {
    try {
      await request.stderr.write(
        new TextEncoder().encode(
          warnings.map((warning) => `docx: ${warning.code}: ${warning.message}\n`).join("")
        )
      );
      settings.signal.throwIfAborted();
    } catch (cause) {
      const published =
        "entries" in data
          ? [
              ...data.entries
                .filter((entry) => entry.published)
                .map((entry) => ({ path: entry.path, bytes: entry.bytes })),
              ...(data.manifest.published
                ? [{ path: data.manifest.path, bytes: data.manifest.bytes }]
                : [])
            ]
          : [];
      if (settings.signal.aborted) {
        const error = new CancellationError("Object diagnostics cancelled.", { cause });
        if ("entries" in data)
          throw new ObjectExtractionCancellationError(
            error,
            { ...data, warnings, complete: false },
            published
          );
        throw error;
      }
      const error = new PublicationError(
        "sink-failure",
        "Object diagnostics could not be written.",
        published,
        false,
        { cause }
      );
      if ("entries" in data)
        throw commandError(
          new ObjectExtractionPublicationError(error, { ...data, warnings, complete: false })
        );
      throw error;
    }
  }
  budget.check("work", 0);
  return new TextEncoder().encode(text);
}
