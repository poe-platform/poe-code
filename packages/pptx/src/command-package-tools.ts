import { commandJson } from "./command-engine-values.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxPublicationRequest
} from "./command-engine.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { asciiKey, partName } from "./package-uri.js";
import { extractPackage, packPackage } from "./package-tools.js";
import { packageToolsSchemas } from "./package-tools-schema.js";
interface PackageArguments {
  operation: string;
  input?: string;
  manifest?: string;
  parts?: readonly string[];
  outputDir?: string;
  output?: string;
  json: boolean;
  force?: boolean;
  dryRun?: boolean;
  allowPartialOutput?: boolean;
  limits?: Readonly<Record<string, number>>;
  creation?: { kind?: "pptx" | "potx" | "ppsx"; timestamp?: Date; author?: string };
}
function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}
function scopedPath(manifest: string, path: string): string {
  if (path === "-") return path;
  if (path.includes("\\") || [...path].some((c) => c.charCodeAt(0) < 32))
    usage("Invalid scoped file path.");
  const prefix = path.startsWith("/")
    ? ""
    : manifest === "-"
      ? "/"
      : manifest.slice(0, manifest.lastIndexOf("/") + 1);
  const absolute = (prefix + path).startsWith("/");
  const segments: string[] = [];
  for (const segment of (prefix + path).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) usage("Scoped path escapes its root.");
      segments.pop();
    } else segments.push(segment);
  }
  return (absolute ? "/" : "") + segments.join("/");
}
function canonical(part: unknown): part is string {
  try {
    return typeof part === "string" && partName(part, false) === part;
  } catch {
    return false;
  }
}
export function validatePackageCommand(
  args: PackageArguments,
  positionals: readonly string[],
  seen: ReadonlySet<string>
): void {
  const allowed = Object.keys(packageToolsSchemas[args.operation]!.options.properties).map(
    (key) => "--" + [...key].map((c) => (c >= "A" && c <= "Z" ? "-" + c.toLowerCase() : c)).join("")
  );
  if ([...seen].some((flag) => !allowed.includes(flag)))
    usage("Option does not apply to package tools.");
  if (args.operation === "extract") {
    if (positionals.length !== 1 || !positionals[0]) usage("Extraction requires one input.");
    args.input = positionals[0];
    if (!args.outputDir || args.outputDir === "-")
      usage("Extraction requires an output directory.");
    if (
      args.parts &&
      (!args.parts.length ||
        args.parts.some((part) => !canonical(part)) ||
        new Set(args.parts.map(asciiKey)).size !== args.parts.length)
    )
      usage("Parts require unique canonical part URIs.");
  } else {
    if (positionals.length || !args.manifest)
      usage("Pack requires a manifest and no positional inputs.");
    if (!args.output && !args.dryRun) usage("Pack requires output or dry-run.");
    if (args.force && !args.output) usage("Force requires output.");
    if (args.output === "-" && args.json && !args.dryRun)
      usage("Binary stdout cannot be combined with JSON.");
    if (args.output === args.manifest && args.output !== "-")
      usage("Output cannot replace manifest.");
  }
}
export async function executePackageCommand(
  args: PackageArguments,
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<{
  result: OfficeResult<unknown>;
  human: string;
  binary?: Uint8Array;
  publication?: PptxPublicationRequest;
  publications?: readonly PptxPublicationRequest[];
  manifest?: readonly { part: string; name: string; path: string; sha256: string; bytes: number }[];
  allowPartialOutput?: boolean;
}> {
  const context = { ...options.context, signal: request.signal };
  const base = {
    version: 1 as const,
    operation: args.operation,
    ok: true as const,
    warnings: [],
    errors: [] as [],
    locations: [],
    affected: 0
  };
  if (args.operation === "extract") {
    const bytes = await request.readInput(
      args.input!,
      Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes)
    );
    const files = await extractPackage(bytes, context, args.parts ? { parts: args.parts } : {});
    if (
      files.length > (args.limits?.maxOutputs ?? context.archiveLimits.maxMembers) ||
      files.reduce((sum, file) => sum + file.bytes.length, 0) > options.maxOutputBytes
    )
      throw new OfficeError(
        "resource-limit",
        "Package extraction exceeds output limits.",
        "validate-intent"
      );
    const manifest = files.map(({ bytes, ...file }) => ({
      ...file,
      path: `${args.outputDir}${args.outputDir!.endsWith("/") ? "" : "/"}${file.name}`,
      bytes: bytes.length
    }));
    if (!request.publishOutputs && (!args.allowPartialOutput || !request.publishOutput))
      throw Object.assign(new Error("Extraction requires a publication capability."), {
        code: "publication-unsupported"
      });
    return {
      result: { ...base, affected: files.length, data: { outputs: manifest, dryRun: false } },
      human: `Extracted ${files.length} package part(s)\n`,
      manifest,
      allowPartialOutput: args.allowPartialOutput ?? false,
      publications: files.map((file, index) => ({
        inputPath: args.input!,
        outputPath: manifest[index]!.path,
        bytes: file.bytes,
        originalBytes: bytes,
        inPlace: false,
        force: args.force ?? false,
        dryRun: false
      }))
    };
  }
  if (args.creation?.author !== undefined || args.creation?.timestamp !== undefined)
    throw new OfficeError(
      "unsupported-edit",
      "Pack metadata overrides are unavailable; source properties are preserved.",
      "validate-intent"
    );
  const encoded = await request.readInput(
    args.manifest!,
    Math.min(context.limits.maxBytes, context.xmlLimits.maxBytes)
  );
  if (encoded.length > Math.min(context.limits.maxBytes, context.xmlLimits.maxBytes))
    throw new OfficeError("resource-limit", "Manifest exceeds byte limit.", "admit");
  let value: unknown;
  try {
    value = commandJson(new TextDecoder("utf-8", { fatal: true }).decode(encoded));
  } catch {
    usage("Manifest must be valid JSON.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "parts") ||
    !("parts" in value) ||
    !Array.isArray(value.parts) ||
    !value.parts.length
  )
    usage("Manifest requires a nonempty parts array.");
  if (value.parts.length > context.archiveLimits.maxMembers)
    throw new OfficeError("resource-limit", "Manifest exceeds member limit.", "admit");
  const parts = value.parts as { part: string; sha256: string; file: { vfsPath: string } }[];
  for (const item of parts)
    if (
      !item ||
      typeof item !== "object" ||
      Object.keys(item).some((key) => !["part", "sha256", "file"].includes(key)) ||
      !canonical(item.part) ||
      typeof item.sha256 !== "string" ||
      item.sha256.length !== 64 ||
      [...item.sha256].some((c) => !"0123456789abcdef".includes(c)) ||
      !item.file ||
      typeof item.file !== "object" ||
      Object.keys(item.file).length !== 1 ||
      typeof item.file.vfsPath !== "string" ||
      !item.file.vfsPath.length
    )
      usage("Manifest parts require canonical URIs, hashes and explicit scoped files.");
  if (new Set(parts.map((item) => asciiKey(item.part))).size !== parts.length)
    usage("Manifest parts must be unique.");
  const paths = parts.map((item) => scopedPath(args.manifest!, item.file.vfsPath));
  if ([args.manifest, ...paths].filter((path) => path === "-").length > 1)
    usage("Only one manifest input may consume stdin.");
  if (args.output !== "-" && paths.includes(args.output!))
    usage("Output cannot replace a source file.");
  let total = 0;
  const members = [];
  for (const [index, item] of parts.entries()) {
    request.signal.throwIfAborted();
    const bytes = await request.readInput(
      paths[index]!,
      Math.min(context.archiveLimits.maxEntryBytes, context.archiveLimits.maxTotalBytes - total)
    );
    total += bytes.length;
    if (
      bytes.length > context.archiveLimits.maxEntryBytes ||
      total > context.archiveLimits.maxTotalBytes
    )
      throw new OfficeError("resource-limit", "Manifest contents exceed byte limit.", "admit");
    members.push({ part: item.part, sha256: item.sha256, bytes });
  }
  const bytes = await packPackage(
    members,
    context,
    args.creation?.kind ? { kind: args.creation.kind } : {}
  );
  if (bytes.length > options.maxOutputBytes)
    throw new OfficeError("resource-limit", "Packed output exceeds byte limit.", "validate-intent");
  const dryRun = args.dryRun ?? false;
  const fingerprint = [...sha256(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (args.output && args.output !== "-" && !request.publishOutput)
    throw Object.assign(new Error("Output publication unavailable."), {
      code: "publication-unsupported"
    });
  return {
    result: {
      ...base,
      affected: members.length,
      data: {
        effects: ["packed"],
        outputs: dryRun ? [] : [{ path: args.output!, sha256: fingerprint, bytes: bytes.length }],
        fingerprint: dryRun ? null : fingerprint,
        dryRun
      }
    },
    human: `${dryRun ? "Validated" : "Packed"} ${members.length} package part(s)\n`,
    ...(args.output === "-" && !dryRun ? { binary: bytes } : {}),
    ...(args.output && args.output !== "-"
      ? {
          publication: {
            outputPath: args.output,
            protectedInputPaths: [args.manifest!, ...paths],
            bytes,
            originalBytes: new Uint8Array(),
            inPlace: false,
            force: args.force ?? false,
            dryRun
          }
        }
      : {})
  };
}
