import { OfficeError } from "./errors.js";
import { partName } from "./package-uri.js";
import {
  SelectionError,
  decodeSelectionToken,
  readSelectionIndex,
  type SelectionContext,
  type SelectionRecord
} from "./selectors.js";
import type { Diagnostic, OfficeResult, Scope } from "./contracts.js";
import { inspectSchema } from "./command-schema.js";

export interface PptxCommandEngineOptions {
  readonly context: Omit<SelectionContext, "signal">;
  readonly maxArgumentBytes: number;
  readonly maxOutputBytes: number;
}
export interface PptxCommandRequest {
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
  "Usage: pptx inspect INPUT [--slide N] [--shape NAME] [--all] [--json]\n       pptx inspect INPUT --part URI [--scope SCOPE] [--json]\n       pptx inspect INPUT --select TOKEN [--json]\n       pptx schema [inspect] [--json]\n       pptx capabilities [--json]\nSlide positions are one-based. Shape names are exact; numeric strings are names.\nDuplicate names require --all. Default scope: slides.\nScopes: slides, notes, layouts, masters, notes-master, handout-master,\n        presentation, shared.\nUse --json to obtain reusable fingerprinted selector tokens.\nInput '-' reads stdin; '--' ends options. Inspection is read-only.\n";

interface Arguments {
  operation: "inspect" | "schema" | "capabilities" | "help" | "version";
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

const scalarOptions = ["--slide", "--shape", "--part", "--select", "--scope"];

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
    } else if (hintValue) hintValue = false;
    else if (hintOptions) {
      if (argument === "--") hintOptions = false;
      else if (argument === "--json") output.json = true;
      else if (scalarOptions.includes(argument)) hintValue = true;
    }
  }
  if (invalidUtf8) usage("Arguments must be UTF-8.");
  const command = args[0] ?? "help";
  const operation =
    command === "--help" || command === "-h"
      ? "help"
      : command === "--version"
        ? "version"
        : command;
  if (!["inspect", "schema", "capabilities", "help", "version"].includes(operation))
    usage("Unsupported operation.");
  const result: Arguments = { operation: operation as Arguments["operation"], json: false };
  const positionals: string[] = [];
  const seen = new Set<string>();
  let options = true;
  for (let index = 1; index < args.length; index++) {
    const argument = args[index]!;
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (!options || !argument.startsWith("-") || argument === "-") {
      positionals.push(argument);
      continue;
    }
    if (seen.has(argument)) usage("Repeated option.");
    seen.add(argument);
    if (argument === "--json") {
      result.json = true;
      continue;
    }
    if (argument === "--all") {
      result.all = true;
      continue;
    }
    if (!scalarOptions.includes(argument)) usage("Unsupported option.");
    const value = args[++index];
    if (value === undefined || value.length === 0) usage("Missing option value.");
    if (argument === "--slide") {
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
    else {
      if (!scopes.includes(value as Scope)) usage("Unknown scope.");
      result.scope = value as Scope;
    }
  }
  if (operation !== "inspect") {
    if ([...seen].some((option) => option !== "--json"))
      usage("Selection options require inspect.");
    if (operation === "schema" && positionals.length === 1 && positionals[0] === "inspect")
      return result;
    if (positionals.length) usage("Unexpected input.");
    return result;
  }
  if (positionals.length !== 1) usage("Inspection requires exactly one input.");
  result.input = positionals[0]!;
  if (result.input.length === 0) usage("Input path must not be empty.");
  if (result.token && seen.size > (result.json ? 2 : 1))
    usage("Opaque and simple selectors cannot be combined.");
  if (result.part && result.slide !== undefined)
    usage("Part and slide selectors cannot be combined.");
  if (result.shape && result.slide === undefined && !result.part)
    usage("Shape selection requires an owning slide or part.");
  if (result.slide !== undefined && result.scope !== undefined && result.scope !== "slides")
    usage("Slide positions require slides scope.");
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
): OfficeResult<unknown> {
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

async function execute(
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<PptxCommandOutput> {
  const output = { json: false, operation: "inspect" };
  let result: OfficeResult<unknown>;
  let exitCode = 0;
  let human: string | undefined;
  try {
    request.signal.throwIfAborted();
    if (!Array.isArray(request.args)) usage("Arguments must be byte arrays.");
    const args = parse(request.args, options.maxArgumentBytes, output);
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
      result = success(operation, { version: 1, operations: { inspect: inspectSchema } });
    else if (args.operation === "capabilities")
      result = success(operation, {
        features: {
          selectors: { level: "read", subset: "slide, part and drawing object locations" },
          editing: { level: "reject", reason: "This command profile exposes inspection only." }
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
      const records = selected(index, args);
      result = success(operation, { fingerprint: index.fingerprint, records }, records);
      human = records
        .map(
          (record) =>
            `${record.kind} ${record.position} ${JSON.stringify(record.name)} id=${JSON.stringify(record.id)} owner=${JSON.stringify(record.part)}\n`
        )
        .join("");
    }
  } catch (error) {
    if (request.signal.aborted)
      return { exitCode: 130, stdout: new Uint8Array(), stderr: new Uint8Array() };
    const office = error instanceof OfficeError ? error : undefined;
    const limit = office?.code === "resource-limit";
    exitCode = limit
      ? 4
      : office?.code === "cancelled"
        ? 130
        : office?.phase === "usage" || office?.code === "invalid-selection"
          ? 2
          : office?.code === "io-failure" || !office
            ? 3
            : 1;
    const diagnostic: Diagnostic = {
      code: limit ? "resource-limit" : (office?.code ?? "io-failure"),
      message: limit
        ? "Input or argument limit exceeded."
        : (office?.message ?? "Input could not be read."),
      context: {
        phase: office?.phase ?? "admit",
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
  const encoded = new TextEncoder().encode(
    json ? `${JSON.stringify(result)}\n` : (human ?? `${JSON.stringify(result.data, null, 2)}\n`)
  );
  if (encoded.length > options.maxOutputBytes) {
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
      relationshipLimits: { ...options.context.relationshipLimits }
    }
  };
  return Object.freeze({ execute: (request: PptxCommandRequest) => execute(request, owned) });
}
