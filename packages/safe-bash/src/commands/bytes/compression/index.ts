import { createZstdCommands } from "safe-bash-command-zstd";
import { createGzipCommands } from "safe-bash-command-gzip";
import { gzip as pakoGzip, ungzip as pakoUngzip } from "pako";
import bz2Factory from "safe-bash-compression-engine/native/generated/bz2";
import xzFactory from "safe-bash-compression-engine/native/generated/xz";
import zstdFactory from "safe-bash-compression-engine/native/generated/zstd";
import { type CommandDefinition } from "../../../contracts/index.js";
import { builtInDirectContextExecutors } from "../../internal.js";
import { createOptionsParser, formats, profiles } from "safe-bash-compression-engine/options";

const parseSyncCompressionOptions = createOptionsParser([
  ...profiles,
  { ...formats.xz, format: "xz", names: ["xz", "unxz", "xzcat"] },
  { ...formats.xz, suffix: ".lzma", format: "xz", names: ["lzma", "unlzma", "lzcat"] },
]);
import { createBzip2Commands } from "safe-bash-command-bzip2";
import { createXzCommands } from "safe-bash-command-xz";
import { type CompressionCommandOptions } from "./stream.js";

export function createCompressionCommands(config: CompressionCommandOptions = {}): readonly CommandDefinition[] {
  const maxDecodedBytes = config.maxDecodedBytes;
  if (maxDecodedBytes !== undefined && maxDecodedBytes !== Infinity && (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0)) {
    throw new RangeError("maxDecodedBytes must be a nonnegative safe integer or Infinity");
  }
  const commands = [
    ...createGzipCommands(config),
    ...createBzip2Commands(config),
    ...createXzCommands(config),
    ...createZstdCommands(config),
  ];
  if (maxDecodedBytes === undefined || maxDecodedBytes === Infinity) {
    for (const command of commands) builtInDirectContextExecutors.add(command.execute);
  }
  return commands;
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

const cachedPortableModules = new Map<typeof zstdFactory, ReturnType<typeof zstdFactory>>();
const portableCodecResultCache = new Map<string, Uint8Array>();

function getPortableCodecModule(factory: typeof zstdFactory): ReturnType<typeof zstdFactory> {
  let mod = cachedPortableModules.get(factory);
  if (!mod) {
    mod = factory(syncZstdWasi);
    mod._initialize?.();
    cachedPortableModules.set(factory, mod);
  }
  return mod;
}

const syncCrc32Table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    crc = (crc >>> 8) ^ syncCrc32Table[(crc ^ bytes[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function runPortableCodecSync(
  factory: typeof zstdFactory,
  decompress: boolean,
  level: number,
  checkOrSmall: number,
  isLzma: boolean,
  srcBytes: Uint8Array,
): Uint8Array | undefined {
  const tag = factory === bz2Factory ? "bz2" : factory === xzFactory ? "xz" : "zstd";
  const cacheKey = srcBytes.byteLength <= 4096
    ? `${tag}:${decompress ? 1 : 0}:${level}:${checkOrSmall}:${isLzma ? 1 : 0}:${Array.from(srcBytes, b => b.toString(16).padStart(2, "0")).join("")}`
    : undefined;
  if (cacheKey !== undefined) {
    const hit = portableCodecResultCache.get(cacheKey);
    if (hit !== undefined) return hit;
  }
  const module = getPortableCodecModule(factory);
  try {
    if (module.bridge_create(decompress ? 1 : 0, level, 0, 30, checkOrSmall, 0, isLzma ? 1 : 0, 0, 0) !== 0) return undefined;
    const inputPointer = module.bridge_input();
    const outputPointer = module.bridge_output();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let offset = 0;
    let finished = false;
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
      if (status === 1) {
        if (offset < srcBytes.byteLength) return undefined;
        finished = true;
        break;
      }
    }
    if (!finished) return undefined;
    let out: Uint8Array;
    if (chunks.length === 0) out = new Uint8Array(0);
    else if (chunks.length === 1) out = chunks[0]!;
    else {
      out = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) {
        out.set(c, pos);
        pos += c.byteLength;
      }
    }
    if (cacheKey !== undefined) {
      if (portableCodecResultCache.size >= 32) {
        const oldest = portableCodecResultCache.keys().next().value;
        if (oldest !== undefined) portableCodecResultCache.delete(oldest);
      }
      portableCodecResultCache.set(cacheKey, out);
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
    const options = parseSyncCompressionOptions(cmdName, opArgs);
    if ((cmdName === "lzma" || cmdName === "unlzma" || cmdName === "lzcat") && options.xzFormat === undefined) options.xzFormat = "lzma";
    if (options.help) {
      return syncCompEncoder.encode(`Usage: ${cmdName} [OPTION]... [FILE]...\n-c, --stdout, --to-stdout\n-d, --decompress, --uncompress\n-k, --keep\n-f, --force\n-t, --test\n${options.format === "zstd" ? "-1..-9, --best\nHigher levels and --fast[=NUM] are unsupported by the bounded codec.\n" : "-1..-9, --fast, --best\n"}${options.format === "zstd" ? "-q, --quiet (repeat to suppress errors)\n" : ""}${options.format === "gzip" ? "-q, --quiet (suppress warnings)\n-r, --recursive (traverse directories without following symlinks)\n-n, --no-name (always enabled)\n" : `Default compression level: ${options.level}.\n`}-h, --help\nNo FILE or FILE '-' uses stdin; file output uses private VFS staging.\n`);
    }
    if (options.test || options.recursive || options.xzList) return undefined;
    const isStdinOnly = options.operands.length === 1 && options.operands[0] === "-";
    if (!options.stdout && !isStdinOnly) return undefined;
    if (options.format === "xz" && (options.xzFormat === "raw" || options.xzFilters !== undefined || options.xzBlockSize !== undefined || options.xzBlockList !== undefined || options.xzFlushTimeout !== undefined)) return undefined;

    const outChunks: Uint8Array[] = [];
    let totalLen = 0;

    let stdinUsed = false;
    for (const op of options.operands) {
      let srcBytes: Uint8Array | undefined;
      if (op === "-") {
        if (stdinUsed) return undefined;
        stdinUsed = true;
        srcBytes = inBytes;
      } else {
        if (!readFileSync) return undefined;
        srcBytes = readFileSync(op);
      }
      if (!srcBytes || srcBytes.byteLength > 65536) return undefined;

      let outChunk: Uint8Array;
      if (options.format === "gzip") {
        if (options.decompress) {
          if (srcBytes.byteLength < 18 || srcBytes[0] !== 0x1f || srcBytes[1] !== 0x8b || srcBytes[2] !== 0x08 || (srcBytes[3]! & 0xe0) !== 0) {
            return undefined;
          }
          for (let k = 10; k + 2 < srcBytes.byteLength; k++) {
            if (srcBytes[k] === 0x1f && srcBytes[k + 1] === 0x8b && srcBytes[k + 2] === 0x08) return undefined;
          }
          outChunk = pakoUngzip(srcBytes);
          const trailerView = new DataView(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength);
          const expectedCrc = trailerView.getUint32(srcBytes.byteLength - 8, true);
          const expectedIsize = trailerView.getUint32(srcBytes.byteLength - 4, true);
          if (expectedIsize !== (outChunk.byteLength >>> 0) || expectedCrc !== computeCrc32(outChunk)) {
            return undefined;
          }
        } else {
          const gz = new Uint8Array(pakoGzip(srcBytes, { level: options.level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }));
          if (gz.byteLength >= 10) gz[9] = 0xff;
          outChunk = gz;
        }
      } else if (options.format === "bzip2") {
        if (options.decompress) {
          if (srcBytes.byteLength < 4 || srcBytes[0] !== 0x42 || srcBytes[1] !== 0x5a || srcBytes[2] !== 0x68) return undefined;
          const dec = runPortableCodecSync(bz2Factory, true, options.level, options.small ? 1 : 0, false, srcBytes);
          if (!dec) return undefined;
          outChunk = dec;
        } else {
          const enc = runPortableCodecSync(bz2Factory, false, options.level, 0, false, srcBytes);
          if (!enc) return undefined;
          outChunk = enc;
        }
      } else if (options.format === "xz") {
        const isLzma = options.xzFormat === "lzma";
        if (options.decompress) {
          if (srcBytes.byteLength === 0) return undefined;
          if (!isLzma && (srcBytes.byteLength < 6 || srcBytes[0] !== 0xfd || srcBytes[1] !== 0x37 || srcBytes[2] !== 0x7a || srcBytes[3] !== 0x58 || srcBytes[4] !== 0x5a || srcBytes[5] !== 0x00)) return undefined;
          const dec = runPortableCodecSync(xzFactory, true, options.level, options.xzCheck ?? 4, isLzma, srcBytes);
          if (!dec) return undefined;
          outChunk = dec;
        } else {
          const enc = runPortableCodecSync(xzFactory, false, options.extreme ? (options.level | 0x80000000) : options.level, options.xzCheck ?? 4, isLzma, srcBytes);
          if (!enc) return undefined;
          outChunk = enc;
        }
      } else {
        // zstd
        if (options.decompress) {
          if (srcBytes.byteLength >= 4 && srcBytes[0] === 0x28 && srcBytes[1] === 0xb5 && srcBytes[2] === 0x2f && srcBytes[3] === 0xfd) {
            const dec = runPortableCodecSync(zstdFactory, true, 3, 0, false, srcBytes);
            if (!dec) return undefined;
            outChunk = dec;
          } else {
            return undefined;
          }
        } else {
          const enc = runPortableCodecSync(zstdFactory, false, options.level, 0, false, srcBytes);
          if (!enc) return undefined;
          outChunk = enc;
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

import { syncCommandEvaluators } from "../../internal.js";
syncCommandEvaluators.evalSyncCompression = evalSyncCompression;
