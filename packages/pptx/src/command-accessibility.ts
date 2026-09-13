import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxPublicationRequest
} from "./command-engine.js";
import type { OfficeResult, Scope } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { accessibilitySchemas } from "./accessibility-schema.js";
import {
  readAccessibility,
  mutateAccessibility,
  validateAccessibilityUpdate,
  type AccessibilityUpdate
} from "./accessibility.js";
import { SelectionError } from "./selectors.js";

export interface AccessibilityArguments {
  operation: string;
  input?: string;
  scope?: string;
  token?: string;
  slide?: number;
  shape?: string;
  output?: string;
  json: boolean;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
  all?: boolean;
  allowEmpty?: boolean;
  accessibilityEdit?: AccessibilityUpdate | undefined;
}
function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
export function validateAccessibilityCommand(
  args: AccessibilityArguments,
  positionals: readonly string[],
  seen: ReadonlySet<string>
): void {
  const allowed = Object.keys(accessibilitySchemas[args.operation]!.options.properties).map(
    (key) => "--" + [...key].map((c) => (c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c)).join("")
  );
  if ([...seen].some((flag) => !allowed.includes(flag)))
    usage("Option does not apply to accessibility.");
  if (positionals.length !== 1 || !positionals[0])
    usage("Accessibility requires exactly one input.");
  args.input = positionals[0];
  if (args.scope !== undefined && !["slides", "layouts", "masters"].includes(args.scope))
    usage("Unsupported accessibility scope.");
  if (args.token && ["--slide", "--shape", "--scope", "--all"].some((flag) => seen.has(flag)))
    usage("Opaque and simple selectors cannot be combined.");
  if (args.shape !== undefined && args.slide === undefined)
    usage("Shape selection requires a slide.");
  if (args.operation !== "accessibility.set") return;
  validateAccessibilityUpdate(args.accessibilityEdit ?? {});
  if (!args.token && args.slide === undefined && !args.all)
    usage("Accessibility mutation requires explicit selection.");
  if (args.inPlace && args.input === "-") usage("Stdin cannot be edited in place.");
  if (args.inPlace && args.output) usage("Output and in-place cannot be combined.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an output destination.");
  if (args.output === args.input && args.output !== "-")
    usage("Replacing input requires --in-place.");
  if (args.output === "-" && args.json && !args.dryRun)
    usage("Binary stdout cannot be combined with JSON.");
}
export async function executeAccessibilityCommand(
  args: AccessibilityArguments,
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
  const selection = {
    ...(args.scope === undefined ? {} : { scope: args.scope as Scope }),
    ...(args.token ? { select: args.token } : {}),
    ...(args.slide === undefined ? {} : { slide: args.slide }),
    ...(args.shape === undefined ? {} : { shape: args.shape })
  };
  if (args.operation !== "accessibility.set") {
    const data = await readAccessibility(original, selection, context);
    if (args.operation === "accessibility.get" && data.objects.length !== 1)
      throw new SelectionError(data.objects.length ? "ambiguous-selection" : "missing-selection");
    return {
      result: {
        version: 1,
        operation: args.operation,
        ok: true,
        data,
        affected: 0,
        warnings: [],
        errors: [],
        locations: data.objects.map((object) => object.location)
      },
      human:
        data.objects
          .map(
            (object) =>
              `${object.structuralOrder}. ${JSON.stringify(object.name)}: title=${JSON.stringify(object.title)}; description=${JSON.stringify(object.description)}; decorative=${object.decorative}\n`
          )
          .join("") +
        data.slides
          .map(
            (slide) =>
              `Slide ${slide.slide}: missing title=${slide.missingTitle}; duplicate title=${slide.duplicateTitle}; multiple titles=${slide.multipleTitles}\n`
          )
          .join("") +
        "Order: structural\n" +
        data.limitations.join("\n") +
        "\n"
    };
  }
  const changed = await mutateAccessibility(
    original,
    {
      ...selection,
      ...(args.all === undefined ? {} : { all: args.all }),
      ...(args.allowEmpty === undefined ? {} : { allowEmpty: args.allowEmpty }),
      update: args.accessibilityEdit!
    },
    context
  );
  const dryRun = args.dryRun ?? false,
    destination = args.inPlace ? args.input! : args.output;
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
      locations: changed.records.map((record) => record.location)
    },
    human: `${dryRun ? "Validated" : "Updated"} ${changed.affected} accessibility object(s)\n`,
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
