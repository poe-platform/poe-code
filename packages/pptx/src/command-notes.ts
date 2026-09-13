import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxPublicationRequest
} from "./command-engine.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { noteSchemas } from "./notes-schema.js";
import { mutateNotes, readNotes, validateNotesOptions } from "./notes.js";
import { readSelectionIndex, SelectionError, type SelectionQuery } from "./selectors.js";

export interface NotesArguments {
  operation: string;
  input?: string;
  scope?: string;
  token?: string;
  slide?: number;
  noteText?: string;
  output?: string;
  json: boolean;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
  all?: boolean;
  allowEmpty?: boolean;
}
function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
export function validateNotesCommand(
  args: NotesArguments,
  positionals: readonly string[],
  seen: ReadonlySet<string>
): void {
  const allowed = Object.keys(noteSchemas[args.operation]!.options.properties).map(
    (key) => "--" + [...key].map((c) => (c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c)).join("")
  );
  if ([...seen].some((flag) => !allowed.includes(flag))) usage("Option does not apply to notes.");
  if (positionals.length !== 1 || !positionals[0]) usage("Notes require exactly one input.");
  args.input = positionals[0];
  if (args.scope !== undefined && args.scope !== "notes") usage("Notes require notes scope.");
  if (args.token && ["--slide", "--scope"].some((flag) => seen.has(flag)))
    usage("Opaque and simple selectors cannot be combined.");
  if (args.operation === "notes.list" || args.operation === "notes.get") return;
  if (!args.token && args.slide === undefined && !args.all)
    throw new SelectionError("missing-selection");
  validateNotesOptions(args.operation.slice(6) as "add" | "set" | "remove", {
    selection: { kind: "slide" },
    ...(args.noteText === undefined ? {} : { text: args.noteText })
  });
  if (args.inPlace && args.input === "-") usage("Stdin cannot be edited in place.");
  if (args.inPlace && args.output) usage("Output and in-place cannot be combined.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an explicit output destination.");
  if (args.output === args.input && args.output !== "-")
    usage("Replacing input requires --in-place.");
  if (args.output === "-" && args.json && !args.dryRun)
    usage("Binary stdout cannot be combined with JSON.");
}
export async function executeNotesCommand(
  args: NotesArguments,
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<{
  result: OfficeResult<unknown>;
  human: string;
  binary?: Uint8Array;
  publication?: PptxPublicationRequest;
}> {
  const context = { ...options.context, signal: request.signal };
  const original = await request.readInput(
    args.input!,
    Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  );
  const selection: SelectionQuery = {
    kind: "slide",
    ...(args.token ? { token: args.token } : {}),
    ...(args.slide === undefined
      ? {}
      : { position: { coordinateSystem: "one-based", value: args.slide } }),
    ...(!args.token && (args.all || args.operation === "notes.list") ? { all: true } : {})
  };
  if (args.operation === "notes.list" || args.operation === "notes.get") {
    if (args.operation === "notes.get")
      (await readSelectionIndex(original, context)).select(selection);
    const records = await readNotes(original, { selection }, context);
    return {
      result: {
        version: 1,
        operation: args.operation,
        ok: true,
        data: args.operation === "notes.get" && !records.length ? null : { notes: records },
        affected: 0,
        warnings: [],
        errors: [],
        locations: records.map((record) => record.location)
      },
      human: records.map((record) => `${record.slide}: ${record.text ?? ""}\n`).join("")
    };
  }
  const changed = await mutateNotes(
    original,
    args.operation.slice(6) as "add" | "set" | "remove",
    {
      selection,
      ...(args.noteText === undefined ? {} : { text: args.noteText }),
      ...(args.allowEmpty === undefined ? {} : { allowEmpty: args.allowEmpty })
    },
    context
  );
  const dryRun = args.dryRun ?? false;
  const destination = args.inPlace ? args.input! : args.output;
  if (destination && destination !== "-" && !request.publishOutput)
    throw Object.assign(new Error("Output publication capability is unavailable."), {
      code: "publication-unsupported"
    });
  return {
    result: {
      version: 1,
      operation: args.operation,
      ok: true,
      data: { dryRun },
      affected: changed.affected,
      warnings: [],
      errors: [],
      locations: changed.locations
    },
    human: `${dryRun ? "Validated" : "Updated"} ${changed.affected} note(s)\n`,
    ...(destination === "-" && !dryRun ? { binary: changed.bytes } : {}),
    ...(destination && destination !== "-"
      ? {
          publication: {
            inputPath: args.input!,
            outputPath: destination,
            bytes: changed.bytes,
            originalBytes: original,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          }
        }
      : {})
  };
}
