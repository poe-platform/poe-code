import type {
  PptxCommandEngineOptions,
  PptxCommandRequest,
  PptxCommandOutput
} from "./command-engine.js";
import type { OfficeResult } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { comparePresentations, type DiffMode } from "./diff.js";
import { diffModes, diffUsage } from "./diff-schema.js";

export async function executeDiffCommand(
  request: PptxCommandRequest,
  options: PptxCommandEngineOptions
): Promise<PptxCommandOutput> {
  const encoder = new TextEncoder();
  let json = false;
  let maxOutputBytes = options.maxOutputBytes;
  let result: OfficeResult<unknown>;
  let human = "";
  let exitCode = 0;
  const failure = (error: unknown): OfficeResult<unknown> => {
    const office = error instanceof OfficeError ? error : undefined;
    const code = request.signal.aborted
      ? "cancelled"
      : (office?.code ??
        (error && typeof error === "object" && "code" in error && error.code === "resource-limit"
          ? "resource-limit"
          : "io-failure"));
    exitCode = code === "cancelled" ? 130 : 2;
    const message =
      office?.message ??
      (code === "cancelled" ? "Comparison cancelled." : "Comparison input could not be read.");
    human = `pptx: ${code}: ${message}\n`;
    return {
      version: 1,
      operation: "diff",
      ok: false,
      data: null,
      affected: 0,
      locations: [],
      warnings: [],
      errors: [{ code, message, context: { phase: office?.phase ?? "admit" } }]
    };
  };
  const usage = (message: string): never => {
    throw new OfficeError("invalid-value", message, "usage");
  };
  try {
    let byteCount = 0;
    const args = request.args.map((bytes) => {
      if (!(bytes instanceof Uint8Array)) usage("Arguments must be byte arrays.");
      byteCount += bytes.byteLength;
      if (byteCount > options.maxArgumentBytes)
        throw new OfficeError("resource-limit", "Argument limit exceeded.", "admit");
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return usage("Arguments must be UTF-8.");
      }
    });
    const delimiter = args.indexOf("--");
    json = args.slice(0, delimiter < 0 ? args.length : delimiter).includes("--json");
    request.signal.throwIfAborted();
    let mode: DiffMode = "structural";
    const positionals: string[] = [];
    const seen = new Set<string>();
    const limits: Record<string, number> = {};
    let positionalOnly = false;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i] === "-h" ? "--help" : args[i]!;
      if (!positionalOnly && arg === "--") {
        positionalOnly = true;
        continue;
      }
      if (!positionalOnly && arg.startsWith("-") && arg !== "-") {
        if (!["--json", "--mode", "--limit", "--help"].includes(arg))
          usage("Unknown comparison option.");
        if (seen.has(arg) && arg !== "--limit") usage("Duplicate comparison option.");
        seen.add(arg);
        if (arg === "--json" || arg === "--help") continue;
        const value = args[++i];
        if (!value) usage("Comparison option requires a value.");
        if (arg === "--mode") {
          if (!diffModes.includes(value as DiffMode)) usage("Unsupported comparison mode.");
          mode = value as DiffMode;
        } else {
          const parts = value!.split("=");
          const name = parts[0]!;
          const number = Number(parts[1]);
          if (
            parts.length !== 2 ||
            !["maxBytes", "maxNodes", "maxDepth", "maxOutputBytes"].includes(name) ||
            !parts[1] ||
            ![...parts[1]].every((c) => c >= "0" && c <= "9") ||
            !Number.isSafeInteger(number) ||
            number <= 0 ||
            Object.hasOwn(limits, name)
          )
            usage("Invalid comparison limit.");
          limits[name] = number;
        }
      } else {
        if (!arg || arg.includes("\0")) usage("Invalid comparison input.");
        positionals.push(arg);
      }
    }
    if (seen.has("--help")) {
      if (positionals.length || [...seen].some((flag) => flag !== "--help" && flag !== "--json"))
        usage("Comparison help does not accept inputs or options.");
      result = {
        version: 1,
        operation: "help",
        ok: true,
        data: { usage: diffUsage },
        affected: 0,
        warnings: [],
        errors: [],
        locations: []
      };
      human = diffUsage;
    } else {
      if (positionals.length !== 2 || positionals.every((path) => path === "-"))
        usage("Comparison requires two inputs and at most one stdin consumer.");
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
        maxOutputBytes
      };
      for (const [name, value] of Object.entries(limits))
        if (value > ceilings[name]! || (name === "maxOutputBytes" && value < 512))
          usage("Limits must lower trusted ceilings; output requires at least 512 bytes.");
      maxOutputBytes = limits.maxOutputBytes ?? maxOutputBytes;
      const context = {
        ...options.context,
        signal: request.signal,
        limits: {
          ...options.context.limits,
          maxBytes: limits.maxBytes ?? options.context.limits.maxBytes
        },
        xmlLimits: {
          ...options.context.xmlLimits,
          maxBytes: limits.maxBytes ?? options.context.xmlLimits.maxBytes,
          maxNodes: limits.maxNodes ?? options.context.xmlLimits.maxNodes,
          maxDepth: limits.maxDepth ?? options.context.xmlLimits.maxDepth
        }
      };
      if (mode === "effective-formatting")
        throw new OfficeError(
          "unsupported-profile",
          "Effective formatting comparison is not supported.",
          "usage"
        );
      const maxBytes = Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes);
      const left = await request.readInput(positionals[0]!, maxBytes);
      request.signal.throwIfAborted();
      const right = await request.readInput(positionals[1]!, maxBytes);
      const data = await comparePresentations(left, right, { mode }, context);
      result = {
        version: 1,
        operation: "diff",
        ok: true,
        data,
        affected: 0,
        warnings: [],
        errors: [],
        locations: []
      };
      exitCode = data.equal ? 0 : 1;
      human =
        `${data.equal ? "Equal" : "Different"} (${data.mode}; ${data.formatting} formatting)\n` +
        data.changes
          .map(
            (change) =>
              `${change.category} ${change.kind} ${change.id}\n  before: ${JSON.stringify(change.before)}\n  after: ${JSON.stringify(change.after)}\n`
          )
          .join("");
    }
  } catch (error) {
    result = failure(error);
  }
  let bytes = encoder.encode(json ? JSON.stringify(result) + "\n" : human);
  if (bytes.length > maxOutputBytes) {
    result = failure(
      new OfficeError("resource-limit", "Comparison output limit exceeded.", "admit")
    );
    bytes = encoder.encode(json ? JSON.stringify(result) + "\n" : human);
  }
  return {
    exitCode,
    stdout: json || result.ok ? bytes : new Uint8Array(),
    stderr: json || result.ok ? new Uint8Array() : bytes
  };
}
