import { OfficeError } from "./errors.js";
import { packageUri, partName } from "./package-uri.js";
import {
  SelectionError,
  decodeSelectionToken,
  readSelectionIndex,
  type SelectionContext,
  type SelectionRecord
} from "./selectors.js";
import type { Diagnostic, OfficeResult, Scope } from "./contracts.js";
import { inspectSchema, xmlGetSchema, xmlSetSchema } from "./command-schema.js";
import { getXmlPart, replaceXmlPart } from "./xml-parts.js";
import type { ValidationLimits } from "./validation.js";

export interface PptxCommandEngineOptions {
  readonly context: Omit<SelectionContext, "signal"> & {
    readonly validationLimits?: ValidationLimits;
  };
  readonly maxArgumentBytes: number;
  readonly maxOutputBytes: number;
}
export interface PptxPublicationRequest {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly bytes: Uint8Array;
  readonly originalBytes: Uint8Array;
  readonly inPlace: boolean;
  readonly force: boolean;
  readonly dryRun: boolean;
}
export interface PptxCommandRequest {
  readonly publishOutput?: (publication: PptxPublicationRequest) => Promise<void>;
  readonly args: readonly Uint8Array[];
  readonly signal: AbortSignal;
  readonly readInput: (path: string, maxBytes: number) => Promise<Uint8Array>;
}
export interface PptxCommandOutput {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}
export interface PptxCommandEngine {
  execute(request: PptxCommandRequest): Promise<PptxCommandOutput>;
}

const scopes: readonly Scope[] = [
  "slides",
  "notes",
  "layouts",
  "masters",
  "notes-master",
  "handout-master",
  "presentation",
  "shared"
];
const help =
  "Usage: pptx inspect INPUT [--slide N] [--shape NAME] [--all] [--json]\n" +
  "       pptx inspect INPUT --part URI [--scope SCOPE] [--json]\n" +
  "       pptx inspect INPUT --select TOKEN [--json]\n" +
  "       pptx xml get INPUT --part URI [--scope SCOPE] [--pretty] [--json]\n" +
  "       pptx xml set INPUT --part URI --file XML [--scope SCOPE]\n" +
  "                    [--output PATH | --in-place] [--force] [--dry-run] [--json]\n" +
  "       pptx schema [inspect | xml get | xml set] [--json]\n" +
  "       pptx capabilities [--json]\n" +
  "Slide positions are one-based. Shape names are exact; numeric strings are names.\n" +
  "Duplicate names require --all. Default scope: slides.\n" +
  "Scopes: slides, notes, layouts, masters, notes-master, handout-master,\n" +
  "        presentation, shared.\n" +
  "Use --json to obtain reusable fingerprinted selector tokens.\n" +
  "XML operations also accept --select TOKEN instead of --part/--scope.\n" +
  "XML get reads package metadata with --part URI --scope shared.\n" +
  "Input '-' reads stdin; '--' ends options. Output - writes package bytes.\n" +
  "--limit NAME=VALUE lowers maxBytes, maxNodes, maxDepth or maxOutputBytes.\n" +
  "Repeat --limit for distinct names; output requires at least 512 bytes.\n" +
  "XML get emits original bytes; --pretty labels formatted output.\n" +
  "XML set validates before publication; element structure and resource bindings\n" +
  "must remain unchanged. Semantic checks are partial, not full schema validation.\n";

interface Arguments {
  operation: "inspect" | "xml.get" | "xml.set" | "schema" | "capabilities" | "help" | "version";
  pretty?: boolean;
  file?: string;
  output?: string;
  inPlace?: boolean;
  force?: boolean;
  dryRun?: boolean;
  schemaPath?: string;
  limits?: Record<string, number>;
  json: boolean;
  input?: string;
  slide?: number;
  shape?: string;
  part?: string;
  token?: string;
  scope?: Scope;
  all?: boolean;
}

function usage(message: string): never {
  throw new OfficeError("invalid-value", message, "usage");
}

const scalarOptions = [
  "--slide",
  "--shape",
  "--part",
  "--select",
  "--scope",
  "--file",
  "--output",
  "-o",
  "--limit"
];

function parse(
  raw: readonly Uint8Array[],
  maximum: number,
  output: { operation: string; json: boolean }
): Arguments {
  const args: string[] = [];
  let size = 0;
  let hintOptions = true;
  let hintValue = false;
  let invalidUtf8 = false;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for (let index = 0; index < raw.length; index++) {
    const bytes = raw[index]!;
    if (!(bytes instanceof Uint8Array)) usage("Arguments must be byte arrays.");
    size += bytes.length + 1;
    if (size > maximum) {
      if (invalidUtf8) usage("Arguments must be UTF-8.");
      throw new OfficeError("resource-limit", "Argument limit exceeded.", "usage");
    }
    try {
      args.push(decoder.decode(bytes));
    } catch {
      invalidUtf8 = true;
      args.push("");
    }
    const argument = args[index]!;
    if (index === 0) {
      const command =
        argument === "--help" || argument === "-h"
          ? "help"
          : argument === "--version"
            ? "version"
            : argument;
      if (["inspect", "schema", "capabilities", "help", "version"].includes(command))
        output.operation = command;
    } else if (index === 1 && args[0] === "xml" && ["get", "set"].includes(argument)) {
      output.operation = `xml.${argument}`;
    } else if (hintValue) hintValue = false;
    else if (hintOptions) {
      if (argument === "--") hintOptions = false;
      else if (argument === "--json") output.json = true;
      else if (scalarOptions.includes(argument)) hintValue = true;
    }
  }
  if (invalidUtf8) usage("Arguments must be UTF-8.");
  const command = args[0] === "xml" ? `xml.${args.splice(1, 1)[0]}` : (args[0] ?? "help");
  const operation =
    command === "--help" || command === "-h"
      ? "help"
      : command === "--version"
        ? "version"
        : command;
  if (
    !["inspect", "xml.get", "xml.set", "schema", "capabilities", "help", "version"].includes(
      operation
    )
  )
    usage("Unsupported operation.");
  const result: Arguments = { operation: operation as Arguments["operation"], json: false };
  const positionals: string[] = [];
  const seen = new Set<string>();
  let options = true;
  for (let index = 1; index < args.length; index++) {
    const argument = args[index] === "-o" ? "--output" : args[index]!;
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (!options || !argument.startsWith("-") || argument === "-") {
      positionals.push(argument);
      continue;
    }
    if (seen.has(argument) && argument !== "--limit") usage("Repeated option.");
    seen.add(argument);
    if (argument === "--json") {
      result.json = true;
      continue;
    }
    if (["--pretty", "--in-place", "--force", "--dry-run"].includes(argument)) {
      if (argument === "--pretty") result.pretty = true;
      else if (argument === "--in-place") result.inPlace = true;
      else if (argument === "--force") result.force = true;
      else result.dryRun = true;
      continue;
    }
    if (argument === "--all") {
      result.all = true;
      continue;
    }
    if (!scalarOptions.includes(argument)) usage("Unsupported option.");
    const value = args[++index];
    if (value === undefined || value.length === 0) usage("Missing option value.");
    if (argument === "--limit") {
      const pieces = value.split("=");
      const [name, digits] = pieces;
      if (
        pieces.length !== 2 ||
        !name ||
        !digits ||
        ![...digits].every((c) => c >= "0" && c <= "9") ||
        !Number.isSafeInteger(Number(digits)) ||
        Number(digits) < 1
      )
        usage("Limits require NAME=POSITIVE_INTEGER.");
      result.limits ??= {};
      if (Object.hasOwn(result.limits, name)) usage("Repeated limit name.");
      if (!["maxBytes", "maxNodes", "maxDepth", "maxOutputBytes"].includes(name))
        usage("Unknown limit name.");
      result.limits[name] = Number(digits);
    } else if (argument === "--slide") {
      if (
        ![...value].every((character) => character >= "0" && character <= "9") ||
        !Number.isSafeInteger(Number(value)) ||
        Number(value) < 1
      )
        usage("Slide positions must be positive one-based integers.");
      result.slide = Number(value);
    } else if (argument === "--shape") result.shape = value;
    else if (argument === "--part") {
      try {
        result.part = partName(value, false);
      } catch {
        throw new SelectionError("invalid-selection");
      }
    } else if (argument === "--select") result.token = value;
    else if (argument === "--file") result.file = value;
    else if (argument === "--output") result.output = value;
    else {
      if (!scopes.includes(value as Scope)) usage("Unknown scope.");
      result.scope = value as Scope;
    }
  }
  const xml = operation === "xml.get" || operation === "xml.set";
  if (operation !== "inspect" && !xml) {
    if ([...seen].some((option) => option !== "--json"))
      usage("Selection options require inspect.");
    if (
      operation === "schema" &&
      ["inspect", "xml.get", "xml.set"].includes(positionals.join("."))
    ) {
      result.schemaPath = positionals.join(".");
      return result;
    }
    if (positionals.length) usage("Unexpected input.");
    return result;
  }
  if (positionals.length !== 1) usage("Inspection requires exactly one input.");
  result.input = positionals[0]!;
  if (result.input.length === 0) usage("Input path must not be empty.");
  if (
    result.token &&
    ["--slide", "--shape", "--part", "--scope", "--all"].some((option) => seen.has(option))
  )
    usage("Opaque and simple selectors cannot be combined.");
  if (result.part && result.slide !== undefined)
    usage("Part and slide selectors cannot be combined.");
  if (result.shape && result.slide === undefined && !result.part)
    usage("Shape selection requires an owning slide or part.");
  if (result.slide !== undefined && result.scope !== undefined && result.scope !== "slides")
    usage("Slide positions require slides scope.");
  const mutationOptions = ["--file", "--output", "--in-place", "--force", "--dry-run"];
  if (operation !== "xml.set" && mutationOptions.some((option) => seen.has(option)))
    usage("Publication options require xml set.");
  if (!xml && result.limits) usage("Limit overrides require XML operations.");
  if (operation !== "xml.get" && result.pretty) usage("Pretty output requires xml get.");
  if (xml) {
    if (result.slide !== undefined || result.shape || result.all)
      usage("XML operations require one part selector.");
    if (!result.part && !result.token) usage("XML operations require a part or opaque selector.");
  }
  if (operation === "xml.set") {
    if (!result.file) usage("XML replacement requires --file.");
    if (result.input === "-" && result.file === "-") usage("Only one input may consume stdin.");
    if (result.inPlace && result.input === "-") usage("Stdin cannot be edited in place.");
    if (result.inPlace && result.output) usage("Output and in-place cannot be combined.");
    if (!result.dryRun && !result.inPlace && !result.output)
      usage("XML replacement requires a destination.");
    if (result.force && !result.output) usage("Force requires an explicit output destination.");
    if (result.output === result.input && result.output !== "-")
      usage("Replacing input requires --in-place.");
    if (result.output === "-" && result.json && !result.dryRun)
      usage("Binary stdout cannot be combined with JSON.");
  }
  return result;
}

function selected(
  index: Awaited<ReturnType<typeof readSelectionIndex>>,
  args: Arguments
): readonly SelectionRecord[] {
  if (args.token) return index.select({ token: args.token });
  const scope = args.scope ?? "slides";
  const all = args.all ?? false;
  if (args.slide !== undefined) {
    const slides = index.select({
      kind: "slide",
      position: { coordinateSystem: "one-based", value: args.slide }
    });
    if (!args.shape) return slides;
    return index.select({ kind: "object", owner: slides[0]!.part, name: args.shape, scope, all });
  }
  if (args.part) {
    if (args.shape)
      return index.select({ kind: "object", owner: args.part, name: args.shape, scope, all });
    return index.select({ kind: "part", part: args.part, scope, all });
  }
  return scope === "slides"
    ? index.slides
    : index.parts.filter((record) => record.location.scope === scope);
}

function success(
  operation: string,
  data: unknown,
  records: readonly SelectionRecord[] = []
): Extract<OfficeResult<unknown>, { readonly ok: true }> {
  return {
    version: 1,
    operation,
    ok: true,
    data,
    warnings: [],
    errors: [],
    affected: 0,
    locations: records.map((record) => record.location)
  };
}

function outputLimitFailure(operation: string, json: boolean): PptxCommandOutput {
  const failure: OfficeResult<never> = {
    version: 1,
    operation,
    ok: false,
    data: null,
    warnings: [],
    errors: [
      { code: "resource-limit", message: "Output limit exceeded.", context: { phase: "publish" } }
    ],
    affected: 0,
    locations: []
  };
  const message = new TextEncoder().encode(
    json ? `${JSON.stringify(failure)}\n` : "pptx: resource-limit: Output limit exceeded.\n"
  );
  return {
    exitCode: 4,
    stdout: json ? message : new Uint8Array(),
    stderr: json ? new Uint8Array() : message
  };
}

async function execute(
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<PptxCommandOutput> {
  const output = { json: false, operation: "inspect" };
  let result: OfficeResult<unknown>;
  let exitCode = 0;
  let human: string | undefined;
  let binary: Uint8Array | undefined;
  let publication: PptxPublicationRequest | undefined;
  try {
    request.signal.throwIfAborted();
    if (!Array.isArray(request.args)) usage("Arguments must be byte arrays.");
    const args = parse(request.args, options.maxArgumentBytes, output);
    if (args.limits) {
      const validation = options.context.validationLimits;
      const ceilings: Record<string, number> = {
        maxBytes: Math.min(
          options.context.limits.maxBytes,
          options.context.archiveLimits.maxArchiveBytes,
          options.context.xmlLimits.maxBytes,
          validation?.maxBytes ?? Infinity
        ),
        maxNodes: Math.min(options.context.xmlLimits.maxNodes, validation?.maxNodes ?? Infinity),
        maxDepth: Math.min(options.context.xmlLimits.maxDepth, validation?.maxDepth ?? Infinity),
        maxOutputBytes: options.maxOutputBytes
      };
      for (const [name, value] of Object.entries(args.limits)) {
        if (value > ceilings[name]! || (name === "maxOutputBytes" && value < 512))
          usage("Limits must lower trusted ceilings; output requires at least 512 bytes.");
      }
      const loweredXml = Object.fromEntries(
        Object.entries(args.limits).filter(([key]) => key !== "maxOutputBytes")
      );
      options = {
        ...options,
        maxOutputBytes: args.limits.maxOutputBytes ?? options.maxOutputBytes,
        context: {
          ...options.context,
          limits: {
            ...options.context.limits,
            maxBytes: args.limits.maxBytes ?? options.context.limits.maxBytes
          },
          xmlLimits: { ...options.context.xmlLimits, ...loweredXml },
          ...(validation ? { validationLimits: { ...validation, ...loweredXml } } : {})
        }
      };
    }
    output.json = args.json;
    output.operation = args.operation;
    const operation = args.operation;
    if (args.operation === "help") {
      result = success(operation, { usage: help });
      human = help;
    } else if (args.operation === "version") {
      result = success(operation, { version: 1, profile: "selectors" });
      human = "pptx selectors v1\n";
    } else if (args.operation === "schema")
      result = success(operation, {
        version: 1,
        operations: Object.fromEntries(
          Object.entries({
            inspect: inspectSchema,
            "xml.get": xmlGetSchema,
            "xml.set": xmlSetSchema
          }).filter(([path]) => !args.schemaPath || path === args.schemaPath)
        )
      });
    else if (args.operation === "capabilities")
      result = success(operation, {
        features: {
          selectors: { level: "read", subset: "slide, part and drawing object locations" },
          inventory: {
            level: "read",
            subset:
              "ordered slides, owner graph, part hashes, media parts and slide visibility; semantic content remains uninspected"
          },
          editing: { level: "reject", reason: "Semantic model editing is not exposed." },
          xml: {
            level: options.context.validationLimits ? "edit" : "reject",
            subset:
              "bounded XML read; presentation and slide replacement retains element structure, opaque content and resource bindings; partial semantic validation; signed, protected and dialect-changing edits rejected",
            ...(options.context.validationLimits
              ? {}
              : { reason: "Explicit XML validation limits are unavailable." })
          }
        },
        io: { input: "explicit-vfs-or-stdin", network: false, nativeRuntime: false }
      });
    else {
      if (args.token) decodeSelectionToken(args.token);
      let bytes: Uint8Array;
      try {
        bytes = await request.readInput(
          args.input!,
          Math.min(options.context.limits.maxBytes, options.context.archiveLimits.maxArchiveBytes)
        );
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "resource-limit"
        )
          throw new OfficeError("resource-limit", "Input limit exceeded.", "admit");
        throw error;
      }
      const index = await readSelectionIndex(bytes, { ...options.context, signal: request.signal });
      const metadata =
        args.operation === "xml.get" &&
        args.scope === "shared" &&
        args.part &&
        (args.part === "/[Content_Types].xml" ||
          args.part === packageUri("/").relsUri ||
          index.parts.some((record) => packageUri(record.part).relsUri === args.part))
          ? args.part
          : undefined;
      const records = metadata ? [] : selected(index, args);
      if (args.operation === "xml.get" || args.operation === "xml.set") {
        if (!metadata && (records.length !== 1 || records[0]!.kind === "object"))
          throw new SelectionError("invalid-selection");
        const part = metadata ?? records[0]!.part;
        const validationLimits = options.context.validationLimits;
        if (!validationLimits)
          throw new OfficeError(
            "invalid-value",
            "XML operations require explicit validation limits.",
            "usage"
          );
        const context = { ...options.context, validationLimits, signal: request.signal };
        if (args.operation === "xml.get") {
          const xml = await getXmlPart(bytes, part, context, { pretty: args.pretty ?? false });
          result = success(
            operation,
            { part: xml.part, format: xml.format, xml: xml.xml },
            records
          );
          if (metadata)
            result = {
              ...result,
              locations: [
                {
                  fingerprint: index.fingerprint,
                  scope: "shared",
                  owner: metadata,
                  objectId: metadata,
                  coordinateSystem: "identity"
                }
              ]
            };
          if (args.pretty) human = `Pretty XML (not original bytes)\n${xml.xml}\n`;
          else if (!args.json) binary = xml.bytes;
        } else {
          const replacement = await request.readInput(
            args.file!,
            Math.min(validationLimits.maxBytes, context.archiveLimits.maxEntryBytes)
          );
          const changed = await replaceXmlPart(bytes, part, replacement, context);
          result = {
            ...success(operation, { part, dryRun: args.dryRun ?? false }, records),
            affected: 1
          };
          human = `${args.dryRun ? "Validated" : "Replaced"} XML part ${part}\n`;
          const destination = args.inPlace ? args.input! : args.output;
          if (destination === "-" && !args.dryRun) binary = changed;
          else if (destination && destination !== "-") {
            if (!request.publishOutput)
              throw Object.assign(new Error("Output publication capability is unavailable."), {
                code: "publication-unsupported"
              });
            publication = {
              inputPath: args.input!,
              outputPath: destination,
              bytes: changed,
              originalBytes: bytes,
              inPlace: args.inPlace ?? false,
              force: args.force ?? false,
              dryRun: args.dryRun ?? false
            };
          }
        }
      } else {
        result = success(
          operation,
          { fingerprint: index.fingerprint, records, inventory: index.inventory },
          records
        );
        human = records
          .map(
            (record) =>
              `${record.kind} ${record.position} ${JSON.stringify(record.name)} id=${JSON.stringify(record.id)} owner=${JSON.stringify(record.part)}\n`
          )
          .join("");
      }
    }
  } catch (error) {
    if (request.signal.aborted)
      return { exitCode: 130, stdout: new Uint8Array(), stderr: new Uint8Array() };
    const office = error instanceof OfficeError ? error : undefined;
    const capabilityCode =
      error && typeof error === "object" && "code" in error ? error.code : undefined;
    const limit = office?.code === "resource-limit" || capabilityCode === "resource-limit";
    const unsupported = capabilityCode === "publication-unsupported";
    exitCode = limit
      ? 4
      : unsupported
        ? 1
        : office?.code === "cancelled"
          ? 130
          : office?.phase === "usage" || office?.code === "invalid-selection"
            ? 2
            : office?.code === "io-failure" || !office
              ? 3
              : 1;
    const diagnostic: Diagnostic = {
      code: limit
        ? "resource-limit"
        : unsupported
          ? "publication-unsupported"
          : (office?.code ?? "io-failure"),
      message: limit
        ? "Input or argument limit exceeded."
        : unsupported
          ? "Output publication capability is unavailable."
          : (office?.message ?? "Input could not be read."),
      context: {
        phase: office?.phase ?? (unsupported ? "publish" : "admit"),
        ...(error instanceof SelectionError ? { candidates: error.candidates } : {})
      }
    };
    result = {
      version: 1,
      operation: output.operation,
      ok: false,
      data: null,
      warnings: [],
      errors: [diagnostic],
      affected: 0,
      locations: []
    };
    human = `pptx: ${diagnostic.code}: ${diagnostic.message}\n`;
  }
  const { json, operation } = output;
  const encoded =
    binary ??
    new TextEncoder().encode(
      json ? `${JSON.stringify(result)}\n` : (human ?? `${JSON.stringify(result.data, null, 2)}\n`)
    );
  if (encoded.length > options.maxOutputBytes) return outputLimitFailure(operation, json);
  if (publication && result.ok) {
    try {
      request.signal.throwIfAborted();
      await request.publishOutput!(publication);
    } catch (error) {
      if (request.signal.aborted)
        return { exitCode: 130, stdout: new Uint8Array(), stderr: new Uint8Array() };
      const office = error instanceof OfficeError ? error : undefined;
      const rawCode =
        error && typeof error === "object" && "code" in error ? error.code : undefined;
      const code =
        typeof rawCode === "string" &&
        [
          "resource-limit",
          "stale-selection",
          "stale-input",
          "publication-unsupported",
          "io-failure"
        ].includes(rawCode)
          ? rawCode
          : (office?.code ?? "io-failure");
      const failure = {
        ...result,
        ok: false,
        data: null,
        affected: 0,
        locations: [],
        errors: [
          {
            code,
            message:
              code === "resource-limit"
                ? "Output limit exceeded."
                : code === "publication-unsupported"
                  ? "Atomic output publication is unavailable."
                  : code === "stale-input" || code === "stale-selection"
                    ? "Input changed before publication."
                    : "Output could not be published.",
            context: { phase: office?.phase ?? "publish" }
          }
        ]
      };
      const message = new TextEncoder().encode(
        json ? `${JSON.stringify(failure)}\n` : `pptx: ${code}: ${failure.errors[0]!.message}\n`
      );
      if (message.length > options.maxOutputBytes) return outputLimitFailure(operation, json);
      return {
        exitCode:
          code === "resource-limit"
            ? 4
            : office?.phase === "usage"
              ? 2
              : code === "stale-selection" ||
                  code === "stale-input" ||
                  code === "publication-unsupported"
                ? 1
                : 3,
        stdout: json ? message : new Uint8Array(),
        stderr: json ? new Uint8Array() : message
      };
    }
  }
  return {
    exitCode,
    stdout: json || result.ok ? encoded : new Uint8Array(),
    stderr: json || result.ok ? new Uint8Array() : encoded
  };
}

export function createPptxCommandEngine(options: PptxCommandEngineOptions): PptxCommandEngine {
  if (
    !options?.context ||
    ![options.maxArgumentBytes, options.maxOutputBytes, options.context.limits?.maxBytes].every(
      (value) => Number.isSafeInteger(value) && value > 0
    ) ||
    options.maxOutputBytes < 512
  )
    throw new TypeError(
      "Explicit positive pptx limits and at least 512 output bytes are required."
    );
  const owned = {
    ...options,
    context: {
      ...options.context,
      limits: { ...options.context.limits },
      archiveLimits: { ...options.context.archiveLimits },
      xmlLimits: { ...options.context.xmlLimits },
      relationshipLimits: { ...options.context.relationshipLimits },
      ...(options.context.validationLimits
        ? { validationLimits: { ...options.context.validationLimits } }
        : {})
    }
  };
  return Object.freeze({ execute: (request: PptxCommandRequest) => execute(request, owned) });
}
