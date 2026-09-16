import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxPublicationRequest
} from "./command-engine.js";
import type { OfficeResult, Scope } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { addMedia, replaceMedia, type AddMediaOptions } from "./media-editing.js";
import { mediaSchemas } from "./media-schema.js";
export interface MediaEditingArguments {
  operation: string;
  input?: string;
  file?: string;
  poster?: string;
  posterContentType?: string;
  mediaEdit?: Partial<AddMediaOptions> & { shared?: boolean };
  scope?: Scope;
  slide?: number;
  shape?: string;
  token?: string;
  all?: boolean;
  allowEmpty?: boolean;
  output?: string;
  outputDir?: string;
  allowPartialOutput?: boolean;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
  json: boolean;
}
function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
export function validateMediaEditingCommand(
  args: MediaEditingArguments,
  positionals: readonly string[],
  seen: ReadonlySet<string>
): void {
  const allowed = Object.keys(mediaSchemas[args.operation]!.options.properties).map(
    (key) => "--" + [...key].map((c) => (c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c)).join("")
  );
  if ([...seen].some((flag) => !allowed.includes(flag)))
    usage("Option does not apply to this media operation.");
  if (positionals.length !== 1 || !positionals[0]) usage("Media requires exactly one input.");
  args.input = positionals[0];
  if (args.token && ["--slide", "--shape", "--scope", "--all"].some((flag) => seen.has(flag)))
    usage("Opaque and simple selectors cannot be combined.");
  if (args.shape !== undefined && args.slide === undefined)
    usage("Shape selection requires an owning slide.");
  if (args.operation === "media.extract") {
    if (!args.outputDir || args.outputDir === "-")
      usage("Media extraction requires an output directory.");
    return;
  }
  if (args.operation === "media.add" && args.scope !== undefined && args.scope !== "slides")
    usage("Media editing requires slides scope.");
  if (!args.file) usage("Media mutation requires --file.");
  if (args.operation === "media.add") {
    if (
      args.slide === undefined ||
      !args.mediaEdit?.kind ||
      !args.mediaEdit.contentType ||
      ["left", "top", "width", "height"].some(
        (key) => args.mediaEdit?.[key as keyof AddMediaOptions] === undefined
      )
    )
      usage("Media insertion requires slide, kind, MIME type and explicit geometry.");
    if (!args.poster) usage("Media insertion requires an explicit poster.");
  } else {
    if (!args.poster) usage("Media replacement requires an explicit poster.");
    if (!args.token && args.shape === undefined && !args.all)
      usage("Media replacement requires a shape selector or all.");
  }
  if ([args.input, args.file, args.poster].filter((value) => value === "-").length > 1)
    usage("Only one input may consume stdin.");
  if (args.poster && !args.posterContentType) {
    const extension = args.poster.slice(args.poster.lastIndexOf(".") + 1).toLowerCase();
    const inferred = (
      { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", wmf: "image/x-wmf" } as Record<
        string,
        string
      >
    )[extension];
    if (!inferred) usage("Poster requires an explicit content type or supported extension.");
    args.posterContentType = inferred;
  }
  if (args.inPlace && args.input === "-") usage("Stdin cannot be edited in place.");
  if (args.inPlace && args.output) usage("Output and in-place cannot be combined.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an explicit output destination.");
  if (args.output === args.input && args.output !== "-")
    usage("Replacing input requires --in-place.");
  if (args.output === "-" && args.json && !args.dryRun)
    usage("Binary stdout cannot be combined with JSON.");
}
export async function executeMediaEditingCommand(
  args: MediaEditingArguments,
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<{
  result: OfficeResult<unknown>;
  human: string;
  binary?: Uint8Array;
  publication?: PptxPublicationRequest;
}> {
  const context = { ...options.context, signal: request.signal };
  const bytes = await request.readInput(
    args.input!,
    Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  );
  const payload = await request.readInput(
    args.file!,
    Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes)
  );
  const poster = args.poster
    ? {
        bytes: await request.readInput(
          args.poster,
          Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes)
        ),
        contentType: args.posterContentType!
      }
    : undefined;
  const changed =
    args.operation === "media.add"
      ? {
          bytes: await addMedia(
            bytes,
            {
              ...args.mediaEdit,
              slide: args.slide!,
              bytes: payload,
              ...(poster ? { poster } : {})
            } as AddMediaOptions,
            context
          ),
          affected: 1,
          affectedSlides: [args.slide!]
        }
      : await replaceMedia(
          bytes,
          {
            ...args.mediaEdit,
            ...(args.scope === undefined ? {} : { scope: args.scope }),
            ...(args.slide === undefined ? {} : { slide: args.slide }),
            ...(args.shape === undefined ? {} : { shape: args.shape }),
            ...(args.token === undefined ? {} : { select: args.token }),
            ...(args.all === undefined ? {} : { all: args.all }),
            ...(args.allowEmpty === undefined ? {} : { allowEmpty: args.allowEmpty }),
            bytes: payload,
            poster: poster!
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
      data: { dryRun, affectedSlides: changed.affectedSlides },
      affected: changed.affected,
      warnings: [],
      errors: [],
      locations: []
    },
    human: `${dryRun ? "Validated" : args.operation === "media.add" ? "Added" : "Replaced"} ${changed.affected} media occurrence(s)\n`,
    ...(destination === "-" && !dryRun ? { binary: changed.bytes } : {}),
    ...(destination && destination !== "-"
      ? {
          publication: {
            inputPath: args.input!,
            protectedInputPaths: [args.file!, ...(args.poster ? [args.poster] : [])],
            outputPath: destination,
            bytes: changed.bytes,
            originalBytes: bytes,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          }
        }
      : {})
  };
}
