import type { PptxCommandEngineOptions, PptxCommandRequest, PptxPublicationRequest } from "./command-engine.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { equationSchemas } from "./equations-schema.js";
import { readEquations, mutateEquations } from "./equations.js";
import { SelectionError } from "./selectors.js";

interface EquationArguments {
  operation: string;
  input?: string;
  scope?: string;
  token?: string;
  slide?: number;
  shape?: string;
  file?: string;
  output?: string;
  json: boolean;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
}
function usage(message: string): never { throw new OfficeError("invalid-value", message, "usage"); }

export function validateEquationCommand(args: EquationArguments, positionals: readonly string[], seen: ReadonlySet<string>): void {
  const schema = equationSchemas[args.operation]!;
  const allowed = Object.keys(schema.options.properties).map(key => "--" + [...key].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join(""));
  if ([...seen].some(flag => !allowed.includes(flag))) usage("Option does not apply to equations.");
  if (positionals.length !== 1 || !positionals[0]) usage("Equations require exactly one input.");
  args.input = positionals[0];
  if (args.scope !== undefined && args.scope !== "slides") usage("Equations support slides scope.");
  if (args.token && ["--slide", "--shape", "--scope"].some(flag => seen.has(flag))) usage("Opaque and simple selectors cannot be combined.");
  if (args.shape !== undefined && args.slide === undefined) usage("Shape selection requires a slide.");
  if (args.operation !== "equations.add") return;
  if (!args.file) usage("Equation insertion requires --file.");
  if (!args.token && !args.shape) usage("Equation insertion requires a shape selector.");
  if (args.input === "-" && args.file === "-") usage("Only one input may consume stdin.");
  if (args.inPlace && args.input === "-") usage("Stdin cannot be edited in place.");
  if (args.inPlace && args.output) usage("Output and in-place cannot be combined.");
  if (!args.dryRun && !args.inPlace && !args.output) usage("Mutation requires a destination.");
  if (args.force && !args.output) usage("Force requires an explicit output destination.");
  if (args.output === args.input && args.output !== "-") usage("Replacing input requires --in-place.");
  if (args.output === "-" && args.json && !args.dryRun) usage("Binary stdout cannot be combined with JSON.");
}

export async function executeEquationCommand(args: EquationArguments, request: PptxCommandRequest, options: PptxCommandEngineOptions): Promise<{
  result: OfficeResult<unknown>; human: string; binary?: Uint8Array; publication?: PptxPublicationRequest;
}> {
  const context = { ...options.context, signal: request.signal };
  const bytes = await request.readInput(args.input!, Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes));
  const selection = {
    scope: "slides" as const,
    ...(args.token ? { select: { token: args.token } } : args.slide === undefined ? {} : { select: { kind: "slide" as const, position: { coordinateSystem: "one-based" as const, value: args.slide } } }),
    ...(args.shape === undefined ? {} : { shape: args.shape })
  };
  if (args.operation !== "equations.add") {
    const equations = await readEquations(bytes, selection, context);
    if (args.operation === "equations.get" && equations.length !== 1) throw new SelectionError(equations.length ? "ambiguous-selection" : "missing-selection");
    return {
      result: { version: 1, operation: args.operation, ok: true, data: { equations }, affected: 0, warnings: [], errors: [], locations: equations.map(equation => equation.location) },
      human: equations.map(equation => equation.omml).join("\n") + (equations.length ? "\n" : "")
    };
  }
  const file = await request.readInput(args.file!, Math.min(context.limits.maxBytes, context.xmlLimits.maxBytes));
  const mutation = await mutateEquations(bytes, "add", { ...selection, file }, context);
  const dryRun = args.dryRun ?? false;
  const destination = args.inPlace ? args.input! : args.output;
  if (destination && destination !== "-" && !request.publishOutput) throw Object.assign(new Error("Output publication capability is unavailable."), { code: "publication-unsupported" });
  return {
    result: { version: 1, operation: args.operation, ok: true, data: { dryRun }, affected: mutation.affected, warnings: [], errors: [], locations: mutation.locations },
    human: `${dryRun ? "Validated" : "Inserted"} ${mutation.affected} equation(s)\n`,
    ...(destination === "-" && !dryRun ? { binary: mutation.bytes } : {}),
    ...(destination && destination !== "-" ? { publication: { inputPath: args.input!, protectedInputPaths: [args.file!], outputPath: destination, bytes: mutation.bytes, originalBytes: bytes, inPlace: args.inPlace ?? false, force: args.force ?? false, dryRun } } : {})
  };
}
