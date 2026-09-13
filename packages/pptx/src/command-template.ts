import { sha256 } from "@noble/hashes/sha2.js";
import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxPublicationRequest
} from "./command-engine.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { commandJson } from "./command-engine-values.js";
import {
  applyTemplateBindings,
  validateTemplateBindings,
  type TemplateBinding
} from "./template-bindings.js";
import {
  applyTemplateRepeat,
  validateTemplateRepeat,
  type TemplateRepeat
} from "./template-repeat.js";

export function validateTemplateData(
  value: unknown
): asserts value is readonly TemplateBinding[] | TemplateRepeat {
  if (Array.isArray(value)) validateTemplateBindings(value);
  else validateTemplateRepeat(value);
}

export interface TemplateArguments {
  input?: string;
  dataFile?: string;
  bindings?: readonly TemplateBinding[] | TemplateRepeat;
  output?: string;
  json: boolean;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
}
function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
export function validateTemplateCommand(
  args: TemplateArguments,
  positionals: readonly string[],
  seen: ReadonlySet<string>
): void {
  if (
    [...seen].some(
      (flag) =>
        ![
          "--data-json",
          "--data-file",
          "--json",
          "--limit",
          "--output",
          "--in-place",
          "--force",
          "--dry-run"
        ].includes(flag)
    )
  )
    usage("Option does not apply to template apply.");
  if (positionals.length !== 1 || !positionals[0])
    usage("Template apply requires exactly one input.");
  args.input = positionals[0];
  if ((args.bindings !== undefined) === (args.dataFile !== undefined))
    usage("Template apply requires exactly one binding source.");
  if (args.dataFile === "") usage("Binding file path must not be empty.");
  if (args.input === "-" && args.dataFile === "-") usage("Only one input may consume stdin.");
  if (args.inPlace && args.input === "-") usage("Stdin cannot be edited in place.");
  if (args.inPlace && args.output) usage("Output and in-place cannot be combined.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an explicit output destination.");
  if (args.output === args.input && args.output !== "-")
    usage("Replacing input requires --in-place.");
  const destination = args.inPlace ? args.input : args.output;
  if (args.dataFile !== undefined && args.dataFile !== "-" && destination === args.dataFile)
    usage("Output cannot replace the binding source.");
  if (args.output === "-" && args.json && !args.dryRun)
    usage("Binary stdout cannot be combined with JSON.");
}
export async function executeTemplateCommand(
  args: TemplateArguments,
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<{
  result: OfficeResult<unknown>;
  human: string;
  binary?: Uint8Array;
  publication?: PptxPublicationRequest;
}> {
  const context = { ...options.context, signal: request.signal };
  let bindings: unknown = args.bindings;
  if (args.dataFile !== undefined) {
    const data = await request.readInput(
      args.dataFile,
      Math.min(context.limits.maxBytes, context.xmlLimits.maxBytes, 1048576)
    );
    let json: string;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      usage("Binding data must be UTF-8 JSON.");
    }
    bindings = commandJson(json);
  }
  validateTemplateData(bindings);
  const bytes = await request.readInput(
    args.input!,
    Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
  );
  const mutation = Array.isArray(bindings)
    ? await applyTemplateBindings(bytes, bindings, context)
    : await applyTemplateRepeat(bytes, bindings as TemplateRepeat, context);
  const dryRun = args.dryRun ?? false;
  const destination = args.inPlace ? args.input! : args.output;
  if (destination && destination !== "-" && !request.publishOutput)
    throw Object.assign(new Error("Output publication capability is unavailable."), {
      code: "publication-unsupported"
    });
  const fingerprint = Array.from(sha256(mutation.bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const repeat = Array.isArray(bindings) ? undefined : (bindings as TemplateRepeat);
  return {
    result: {
      version: 1,
      operation: "template.apply",
      ok: true,
      data: {
        effects: mutation.locations.map((location, index) => ({
          location,
          action: repeat
            ? repeat.records.length === 0
              ? "remove"
              : index < repeat.slides.length * repeat.records.length
                ? "add"
                : "replace"
            : "replace",
          feature: "F57"
        })),
        outputs: dryRun
          ? []
          : [{ path: destination!, sha256: fingerprint, bytes: mutation.bytes.length }],
        fingerprint: dryRun ? null : fingerprint
      },
      affected: mutation.affected,
      warnings: [],
      errors: [],
      locations: mutation.locations
    },
    human: `${dryRun ? "Validated" : "Applied"} ${mutation.affected} template binding target(s)\n`,
    ...(destination === "-" && !dryRun ? { binary: mutation.bytes } : {}),
    ...(destination && destination !== "-"
      ? {
          publication: {
            inputPath: args.input!,
            ...(args.dataFile ? { protectedInputPaths: [args.dataFile] } : {}),
            outputPath: destination,
            bytes: mutation.bytes,
            originalBytes: bytes,
            inPlace: args.inPlace ?? false,
            force: args.force ?? false,
            dryRun
          }
        }
      : {})
  };
}
