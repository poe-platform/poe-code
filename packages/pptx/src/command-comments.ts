import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxPublicationRequest
} from "./command-engine.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { commentSchemas } from "./comments-schema.js";
import { mutateComments, readComments, readCommentAuthors } from "./comments.js";
import { SelectionError, type SelectionQuery } from "./selectors.js";

export interface CommentsArguments {
  operation: string;
  input?: string;
  scope?: string;
  token?: string;
  slide?: number;
  commentEdit?: {
    id?: string;
    text?: string;
    author?: string;
    authorId?: string;
    initials?: string;
    timestamp?: string;
    left?: number;
    top?: number;
  };
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
export function validateCommentsCommand(
  args: CommentsArguments,
  positionals: readonly string[],
  seen: ReadonlySet<string>
): void {
  const allowed = Object.keys(commentSchemas[args.operation]!.options.properties).map(
    (key) => "--" + [...key].map((c) => (c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c)).join("")
  );
  if ([...seen].some((flag) => !allowed.includes(flag)))
    usage("Option does not apply to comments.");
  if (positionals.length !== 1 || !positionals[0]) usage("Comments require exactly one input.");
  args.input = positionals[0];
  if (args.scope !== undefined && args.scope !== "slides") usage("Comments require slides scope.");
  if (args.token && ["--slide", "--scope", "--id"].some((flag) => seen.has(flag)))
    usage("Opaque and simple selectors cannot be combined.");
  if (args.operation === "comments.list" || args.operation === "comments.get") return;
  if (!args.token && args.slide === undefined && !args.all)
    throw new SelectionError("missing-selection");
  if (
    args.operation === "comments.add" &&
    [args.commentEdit?.text, args.commentEdit?.author, args.commentEdit?.timestamp].some(
      (value) => value === undefined
    )
  )
    usage("Comment creation requires text, author and timestamp.");
  if (
    args.operation === "comments.set" &&
    !Object.keys(args.commentEdit ?? {}).some((key) => key !== "id")
  )
    usage("Comment update requires an edit.");
  if (args.inPlace && args.input === "-") usage("Stdin cannot be edited in place.");
  if (args.inPlace && args.output) usage("Output and in-place cannot be combined.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an explicit output destination.");
  if (args.output === args.input && args.output !== "-")
    usage("Replacing input requires --in-place.");
  if (args.output === "-" && args.json && !args.dryRun)
    usage("Binary stdout cannot be combined with JSON.");
}
export async function executeCommentsCommand(
  args: CommentsArguments,
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
    ...(!args.token && (args.all || ["comments.list", "comments.get"].includes(args.operation))
      ? { all: true }
      : {})
  };
  if (args.operation === "comments.list" || args.operation === "comments.get") {
    const records = await readComments(
      original,
      { selection, ...(args.commentEdit?.id === undefined ? {} : { id: args.commentEdit.id }) },
      context
    );
    const authors = await readCommentAuthors(original, context);
    if (args.operation === "comments.get" && records.length > 1)
      throw new SelectionError(records.length ? "ambiguous-selection" : "missing-selection");
    return {
      result: {
        version: 1,
        operation: args.operation,
        ok: true,
        data:
          args.operation === "comments.get" && !records.length
            ? null
            : { comments: records, authors },
        affected: 0,
        warnings: [],
        errors: [],
        locations: records.map((record) => record.location)
      },
      human: records.map((record) => `${record.slide}: ${record.text ?? ""}\n`).join("")
    };
  }
  const changed = await mutateComments(
    original,
    args.operation.slice(9) as "add" | "set" | "remove",
    {
      selection,
      ...args.commentEdit,
      ...(args.all === undefined ? {} : { all: args.all }),
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
    human: `${dryRun ? "Validated" : "Updated"} ${changed.affected} comment(s)\n`,
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
