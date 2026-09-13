import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxPublicationRequest
} from "./command-engine.js";
import { inspectSchema } from "./command-schema.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { addOleObject, type AddOleObjectOptions } from "./ole-insertion.js";

export const objectsAddUsage =
  "Usage: pptx objects add INPUT --slide N --file PATH --icon PATH (--program-id TEXT | --program DOCX|PPTX|XLSX) [--icon-content-type TYPE]\n" +
  "  --left LENGTH --top LENGTH --width LENGTH --height LENGTH --icon-width LENGTH --icon-height LENGTH --name TEXT\n" +
  "  --output PATH|--in-place|--dry-run [--force] [--json] [--limit NAME=VALUE]\n" +
  "Embed explicit inert bytes with an explicit icon. No activation or recursive payload parsing.\n";
const length = {
  type: "object",
  additionalProperties: false,
  required: ["value", "unit"],
  properties: { value: { type: "number" }, unit: { enum: ["emu", "in", "cm", "mm", "pt"] } }
};
export const objectsAddSchema = {
  description: objectsAddUsage,
  input: inspectSchema.input,
  options: {
    type: "object",
    additionalProperties: false,
    required: ["slide", "file", "icon"],
    oneOf: [
      { required: ["programId"], not: { required: ["program"] } },
      { required: ["program"], not: { required: ["programId"] } }
    ],
    allOf: [
      { not: { required: ["output", "inPlace"], properties: { inPlace: { const: true } } } },
      {
        if: { required: ["force"], properties: { force: { const: true } } },
        then: { required: ["output"] }
      },
      {
        anyOf: [
          { required: ["output"] },
          { required: ["inPlace"], properties: { inPlace: { const: true } } },
          { required: ["dryRun"], properties: { dryRun: { const: true } } }
        ]
      },
      {
        if: {
          required: ["output", "json"],
          properties: { output: { const: "-" }, json: { const: true } }
        },
        then: { required: ["dryRun"], properties: { dryRun: { const: true } } }
      }
    ],
    properties: {
      slide: { type: "integer", minimum: 1 },
      file: { type: "string", minLength: 1 },
      icon: { type: "string", minLength: 1 },
      programId: { type: "string", minLength: 1, maxLength: 255 },
      program: { enum: ["DOCX", "PPTX", "XLSX"] },
      iconContentType: {
        enum: ["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff", "image/x-wmf"]
      },
      name: { type: "string" },
      left: length,
      top: length,
      width: {
        ...length,
        properties: { ...length.properties, value: { type: "number", exclusiveMinimum: 0 } }
      },
      height: {
        ...length,
        properties: { ...length.properties, value: { type: "number", exclusiveMinimum: 0 } }
      },
      iconWidth: {
        ...length,
        properties: { ...length.properties, value: { type: "number", exclusiveMinimum: 0 } }
      },
      iconHeight: {
        ...length,
        properties: { ...length.properties, value: { type: "number", exclusiveMinimum: 0 } }
      },
      output: { type: "string", minLength: 1 },
      inPlace: { type: "boolean" },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
      json: { type: "boolean" },
      limit: { type: "object" }
    }
  },
  result: {
    ...inspectSchema.result,
    properties: {
      ...inspectSchema.result.properties,
      operation: { const: "objects.add" },
      affected: { type: "integer", minimum: 0 },
      data: {
        oneOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: [
              "dryRun",
              "affectedSlides",
              "activationPerformed",
              "recursiveParsingPerformed"
            ],
            properties: {
              dryRun: { type: "boolean" },
              affectedSlides: { type: "array", items: { type: "integer", minimum: 1 } },
              activationPerformed: { const: false },
              recursiveParsingPerformed: { const: false }
            }
          }
        ]
      }
    }
  }
};
export interface ObjectsAddArguments {
  operation: string;
  input?: string;
  slide?: number;
  file?: string;
  icon?: string;
  iconContentType?: string;
  objectAdd?: Partial<AddOleObjectOptions> | undefined;
  output?: string;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
  json: boolean;
}
function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
export function validateObjectsAddCommand(
  args: ObjectsAddArguments,
  positionals: readonly string[],
  seen: ReadonlySet<string>
): void {
  const allowed = Object.keys(objectsAddSchema.options.properties).map(
    (key) => "--" + [...key].map((c) => (c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c)).join("")
  );
  if ([...seen].some((flag) => !allowed.includes(flag)))
    usage("Option does not apply to object insertion.");
  if (positionals.length !== 1 || !positionals[0])
    usage("Object insertion requires exactly one input.");
  args.input = positionals[0];
  if (seen.has("--program-id") && seen.has("--program"))
    usage("Program and program ID are mutually exclusive.");
  if (!args.slide || !args.file || !args.icon || !args.objectAdd?.progId)
    usage("Object insertion requires slide, file, icon and program ID.");
  if ([args.input, args.file, args.icon].filter((path) => path === "-").length > 1)
    usage("Only one input may consume stdin.");
  if (!args.iconContentType) {
    const extension = args.icon.slice(args.icon.lastIndexOf(".") + 1).toLowerCase();
    const type: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      bmp: "image/bmp",
      tif: "image/tiff",
      tiff: "image/tiff",
      wmf: "image/x-wmf"
    };
    if (!type[extension]) usage("Icon requires a supported extension or explicit content type.");
    args.iconContentType = type[extension];
  }
  if (args.inPlace && (args.input === "-" || args.output))
    usage("In-place requires a named input and no output flag.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an explicit output.");
  if (args.output === args.input && args.output !== "-")
    usage("Replacing input requires --in-place.");
  if (args.output === "-" && args.json && !args.dryRun) usage("Binary stdout conflicts with JSON.");
}
export async function executeObjectsAddCommand(
  args: ObjectsAddArguments,
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<{
  result: OfficeResult<unknown>;
  human: string;
  binary?: Uint8Array;
  publication?: PptxPublicationRequest;
}> {
  const context = { ...options.context, signal: request.signal };
  const source = await request.readInput(
    args.input!,
    Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  );
  const bytes = await request.readInput(
    args.file!,
    Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes)
  );
  const iconBytes = await request.readInput(
    args.icon!,
    Math.min(context.limits.maxBytes, context.archiveLimits.maxEntryBytes)
  );
  const changed = await addOleObject(
    source,
    {
      ...args.objectAdd,
      slide: args.slide!,
      bytes,
      iconBytes,
      iconContentType: args.iconContentType!
    } as AddOleObjectOptions,
    context
  );
  const dryRun = args.dryRun ?? false,
    destination = args.inPlace ? args.input : args.output;
  if (destination && destination !== "-" && !request.publishOutput)
    throw Object.assign(new Error("Output publication capability is unavailable."), {
      code: "publication-unsupported"
    });
  return {
    result: {
      version: 1,
      operation: "objects.add",
      ok: true,
      data: {
        dryRun,
        affectedSlides: [args.slide!],
        activationPerformed: false,
        recursiveParsingPerformed: false
      },
      affected: 1,
      warnings: [],
      errors: [],
      locations: []
    },
    human: `${dryRun ? "Validated" : "Added"} 1 embedded object\n`,
    ...(destination === "-" && !dryRun ? { binary: changed } : {}),
    ...(destination && destination !== "-"
      ? {
          publication: {
            inputPath: args.input!,
            protectedInputPaths: [args.file!, args.icon!],
            outputPath: destination,
            bytes: changed,
            originalBytes: source,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          }
        }
      : {})
  };
}
