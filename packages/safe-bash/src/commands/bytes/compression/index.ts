import { gzip as pakoGzip, ungzip as pakoUngzip } from "pako";
import zstdFactory from "safe-bash-compression-engine/native/generated/zstd";
import { PublicDiagnostic } from "../../../diagnostics.js";
import { type CommandDefinition } from "../../../contracts/index.js";
import { codeOf, define, diagnostic, output } from "../../internal.js";
import { planOperands, verifyOperandDestinations } from "./files.js";
import { parseOptions, profiles } from "safe-bash-compression-engine/options";
import { createXzCommands } from "safe-bash-command-xz";
import { runOperand } from "safe-bash-compression-engine/operand";
import { DecodedBudget, type CompressionCommandOptions } from "./stream.js";
import { CompressedDataError } from "./errors.js";

export function createCompressionCommands(config: CompressionCommandOptions = {}): readonly CommandDefinition[] {
  const maxDecodedBytes = config.maxDecodedBytes;
  if (maxDecodedBytes !== undefined && maxDecodedBytes !== Infinity && (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer or Infinity");
  }
  const commands = profiles.flatMap(profile => profile.names).map((name) => define(name, async (context) => {
    const options = parseOptions(name, context.args);
    if (options.help) {
      await output(context, `Usage: ${name} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n${options.format === "zstd" ? "-1..-9, --best\nHigher levels and --fast[=NUM] are unsupported by the bounded codec.\n" : "-1..-9, --fast, --best\n"}${options.format === "zstd" ? "-q, --quiet (repeat to suppress errors)\n" : ""}${options.format === "gzip" ? "-q, --quiet (suppress warnings)\n-r, --recursive (traverse directories without following symlinks)\n-n, --no-name (always enabled)\n" : `Default compression level: ${options.level}.\n`}-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`);
      return { exitCode: 0 };
    }
    let plans;
    let planningFailed = false;
    try {
      if (options.operands.length > 1) {
        plans = [];
        for (const name of options.operands) {
          try {
            plans.push(...await planOperands(context, { ...options, operands: [name] }));
          } catch (error) {
            context.signal.throwIfAborted();
            if (codeOf(error) === "EROFS") throw error;
            planningFailed = true;
            if (options.quiet < 2) await diagnostic(context, error);
          }
        }
        if (plans.length > 1) await verifyOperandDestinations(context, plans);
      } else plans = await planOperands(context, options);
    }
    catch (error) {
      context.signal.throwIfAborted();
      if (options.quiet < 2) throw error;
      return { exitCode: 1 };
    }
    const decodedBudget = new DecodedBudget(maxDecodedBytes);
    let exitCode = planningFailed ? 1 : 0;
    for (const plan of plans) {
      try {
        const warned = await runOperand(context, plan, options, decodedBudget);
        if (warned) {
          if (!options.quiet) await diagnostic(context, new PublicDiagnostic(`${plan.source}: decompression OK, trailing garbage ignored`));
          if (exitCode === 0) exitCode = 2;
        }
      } catch (error) {
        context.signal.throwIfAborted();
        if (options.quiet < 2) await diagnostic(context, error);
        const failureCode = options.format === "bzip2" && error instanceof CompressedDataError ? 2 : 1;
        exitCode = options.format === "bzip2" ? Math.max(exitCode, failureCode) : failureCode;
        if (decodedBudget.exceeded) break;
      }
    }
    return { exitCode };
  }));
  return [...commands.slice(0, 6), ...createXzCommands(config), ...commands.slice(6)];
}

function zstdUnavailable(): never {
  throw new Error("codec attempted an unavailable host operation");
}

const syncZstdWasi = Object.freeze({
  fd_prestat_get: () => 8,
  fd_prestat_dir_name: zstdUnavailable,
  fd_write: zstdUnavailable,
  fd_read: zstdUnavailable,
  fd_close: zstdUnavailable,
  fd_seek: zstdUnavailable,
  fd_fdstat_get: zstdUnavailable,
  fd_fdstat_set_flags: zstdUnavailable,
  fd_filestat_get: zstdUnavailable,
  environ_get: zstdUnavailable,
  environ_sizes_get: zstdUnavailable,
  random_get: zstdUnavailable,
  clock_time_get: zstdUnavailable,
  proc_exit: zstdUnavailable,
});

function zstdDecompressPortableSync(srcBytes: Uint8Array): Uint8Array | undefined {
  const module = zstdFactory(syncZstdWasi);
  try {
    module._initialize?.();
    if (module.bridge_create(1, 3, 0, 30, 0, 0, 0, 0, 0) !== 0) return undefined;
    const inputPointer = module.bridge_input();
    const outputPointer = module.bridge_output();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let offset = 0;
    for (let step = 0; step < 64; step++) {
      const slice = srcBytes.subarray(offset, Math.min(srcBytes.byteLength, offset + 65536));
      new Uint8Array(module.memory.buffer, inputPointer, slice.byteLength).set(slice);
      const status = module.bridge_step(
        inputPointer,
        slice.byteLength,
        outputPointer,
        65536,
        offset + slice.byteLength >= srcBytes.byteLength ? 1 : 0,
      );
      if (status !== 1 && status !== 2 && status !== 3 && status !== 4) return undefined;
      const consumed = module.bridge_consumed();
      const produced = module.bridge_produced();
      offset += consumed;
      if (produced > 0) {
        total += produced;
        if (total > 131072) return undefined;
        chunks.push(new Uint8Array(module.memory.buffer, outputPointer, produced).slice());
      }
      if (status === 1 && offset >= srcBytes.byteLength) break;
    }
    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0]!;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.byteLength;
    }
    return out;
  } finally {
    module.bridge_destroy();
  }
}

const syncCompEncoder = new TextEncoder();

export function evalSyncCompression(
  cmdName: string,
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
): Uint8Array | undefined {
  try {
    const options = parseOptions(cmdName, opArgs);
    if (options.help) {
      return syncCompEncoder.encode(`Usage: ${cmdName} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n${options.format === "zstd" ? "-1..-9, --best\nHigher levels and --fast[=NUM] are unsupported by the bounded codec.\n" : "-1..-9, --fast, --best\n"}${options.format === "zstd" ? "-q, --quiet (repeat to suppress errors)\n" : ""}${options.format === "gzip" ? "-q, --quiet (suppress warnings)\n-r, --recursive (traverse directories without following symlinks)\n-n, --no-name (always enabled)\n" : `Default compression level: ${options.level}.\n`}-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`);
    }
    if (options.test || options.recursive || options.xzList) return undefined;
    const isStdinOnly = options.operands.length === 1 && options.operands[0] === "-";
    if (!options.stdout && !isStdinOnly) return undefined;
    if (options.format !== "gzip" && options.format !== "zstd") return undefined;
    if (options.format === "zstd" && !options.decompress) return undefined;

    const outChunks: Uint8Array[] = [];
    let totalLen = 0;

    for (const op of options.operands) {
      let srcBytes: Uint8Array | undefined;
      if (op === "-") {
        srcBytes = inBytes;
      } else {
        if (!readFileSync) return undefined;
        srcBytes = readFileSync(op);
      }
      if (!srcBytes || srcBytes.byteLength > 65536) return undefined;

      let outChunk: Uint8Array;
      if (options.format === "gzip") {
        if (options.decompress) {
          if (srcBytes.byteLength === 0) {
            outChunk = new Uint8Array(0);
          } else {
            if (srcBytes.byteLength < 18 || srcBytes[0] !== 0x1f || srcBytes[1] !== 0x8b) return undefined;
            outChunk = pakoUngzip(srcBytes);
          }
        } else {
          const gz = new Uint8Array(pakoGzip(srcBytes, { level: options.level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }));
          if (gz.byteLength >= 10) gz[9] = 0xff;
          outChunk = gz;
        }
      } else {
        // zstd decompress (unzstd / zstdcat / zstd -d)
        if (srcBytes.byteLength === 0) {
          outChunk = new Uint8Array(0);
        } else if (srcBytes.byteLength >= 4 && srcBytes[0] === 0x28 && srcBytes[1] === 0xb5 && srcBytes[2] === 0x2f && srcBytes[3] === 0xfd) {
          const dec = zstdDecompressPortableSync(srcBytes);
          if (!dec) return undefined;
          outChunk = dec;
        } else if (cmdName === "zstdcat" && srcBytes.byteLength >= 18 && srcBytes[0] === 0x1f && srcBytes[1] === 0x8b) {
          outChunk = pakoUngzip(srcBytes);
        } else {
          return undefined;
        }
      }
      if (outChunk.byteLength > 131072) return undefined;
      outChunks.push(outChunk);
      totalLen += outChunk.byteLength;
      if (totalLen > 131072) return undefined;
    }

    if (outChunks.length === 1) return outChunks[0]!;
    const merged = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of outChunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  } catch {
    return undefined;
  }
}
