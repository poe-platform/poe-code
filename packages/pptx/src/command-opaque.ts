import { sha256 } from "@noble/hashes/sha2.js";
import type { PptxCommandEngineOptions, PptxCommandRequest, PptxPublicationRequest } from "./command-engine.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { extractObject, readFonts, readObjects } from "./opaque-objects.js";
import { opaqueSchemas } from "./opaque-schema.js";
import { partName } from "./package-uri.js";

interface OpaqueArguments {
  operation: string; input?: string; scope?: string; part?: string; outputDir?: string;
  json: boolean; force?: boolean; dryRun?: boolean; allowPartialOutput?: boolean;
  limits?: Readonly<Record<string, number>>;
}
export interface OpaqueManifestItem {
  part: string; name: string; path: string; sha256: string; bytes: number;
}
function usage(message: string): never { throw new OfficeError("invalid-value", message, "usage"); }
export function validateOpaqueCommand(args: OpaqueArguments, positionals: readonly string[], seen: ReadonlySet<string>): void {
  const schema = opaqueSchemas[args.operation]!;
  const allowed = Object.keys(schema.options.properties).map(key => "--" + [...key].map(c => c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c).join(""));
  if ([...seen].some(flag => !allowed.includes(flag))) usage("Option does not apply to opaque resources.");
  if (positionals.length !== 1 || !positionals[0]) usage("Opaque resources require exactly one input.");
  args.input = positionals[0];
  const scope = args.operation === "fonts.list" ? "presentation" : "shared";
  if (args.scope !== undefined && args.scope !== scope) usage("Unsupported opaque resource scope.");
  if (args.operation !== "objects.extract") return;
  if (!args.part) usage("Object extraction requires --part.");
  try { if (partName(args.part, false) !== args.part) usage("Object extraction requires a canonical package part."); }
  catch { usage("Object extraction requires a canonical package part."); }
  if (!args.outputDir && !args.dryRun) usage("Object extraction requires --output-dir.");
  if (args.outputDir === "-") usage("Output directories cannot be stdout.");
  if (args.force && !args.outputDir) usage("Force requires an output directory.");
}
export async function executeOpaqueCommand(args: OpaqueArguments, request: PptxCommandRequest, options: PptxCommandEngineOptions): Promise<{
  result: OfficeResult<unknown>; human: string; publications?: readonly PptxPublicationRequest[];
  opaqueManifest?: readonly OpaqueManifestItem[]; allowPartialOutput?: boolean;
}> {
  const context = { ...options.context, signal: request.signal };
  const bytes = await request.readInput(args.input!, Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes));
  const base = { version: 1 as const, operation: args.operation, ok: true as const, affected: 0, warnings: [] as [], errors: [] as [], locations: [] };
  if (args.operation !== "objects.extract") {
    if (args.operation === "fonts.list") {
      const inventory = await readFonts(bytes, context);
      return { result: { ...base, data: inventory }, human: inventory.fonts.map(item => `${item.part} ${item.bytes} bytes\n`).join("") };
    }
    const inventory = await readObjects(bytes, context);
    return { result: { ...base, data: inventory }, human: inventory.objects.map(item => `${item.part} ${item.kind} ${item.bytes} bytes${item.activeContent ? " active-content" : ""}\n`).join("") };
  }
  const extracted = await extractObject(bytes, { part: args.part! }, context);
  const files = [{ part: extracted.part, name: extracted.name, bytes: extracted.bytes }, ...extracted.dependencies];
  if (files.length > (args.limits?.maxOutputs ?? context.archiveLimits.maxMembers)) throw new OfficeError("resource-limit", "Opaque output count exceeds limit.", "validate-intent");
  const dryRun = args.dryRun ?? false;
  const allowPartialOutput = args.allowPartialOutput ?? false;
  if (!dryRun && !request.publishOutputs && (!allowPartialOutput || !request.publishOutput)) throw Object.assign(new Error("Object extraction requires atomic publication or explicit partial output."), { code: "publication-unsupported" });
  const opaqueManifest = files.map(file => ({ part: file.part, name: file.name,
    path: `${args.outputDir ?? ""}${!args.outputDir || args.outputDir.endsWith("/") ? "" : "/"}${file.name}`,
    sha256: [...sha256(file.bytes)].map(byte => byte.toString(16).padStart(2, "0")).join(""), bytes: file.bytes.length }));
  const publications = args.outputDir ? files.map((file, index) => ({ inputPath: args.input!, outputPath: opaqueManifest[index]!.path, bytes: file.bytes, originalBytes: bytes, inPlace: false, force: args.force ?? false, dryRun })) : undefined;
  return {
    result: { ...base, affected: 1, data: { outputs: opaqueManifest, relationships: extracted.relationships, activationPerformed: false, recursiveParsingPerformed: false, dryRun } },
    human: `${dryRun ? "Validated" : "Extracted"} ${files.length} opaque resource file(s)\n`,
    ...(publications ? { publications } : {}), opaqueManifest, allowPartialOutput
  };
}
