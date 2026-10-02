import type { CommandContext, CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import type { OutputOperation } from "safe-bash-contracts/output";
import { createPrCommand } from "./command.js";
import { Formatter } from "./format.js";
import { Budget, settings, type PrCommandsOptions } from "./internal.js";
import { Lifecycle, Reader } from "./io.js";
import { parseOptions } from "./options.js";
import { formatDate } from "safe-bash-calendar-engine/time-env/format";
import { TimeZone } from "safe-bash-calendar-engine/time-env/calendar";

export { createPrCommand } from "./command.js";
export type { PrCommandsOptions, PrLimits } from "./internal.js";

export function createPrCommands(options: PrCommandsOptions = {}): readonly CommandDefinition[] {
  return [createPrCommand(options)];
}

export function prCommands(options: PrCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPrCommands(options);
  return { name: "pr-commands", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}

let _syncPrSignal: AbortSignal | undefined;
const getSyncPrSignal = (): AbortSignal => (_syncPrSignal ??= new AbortController().signal);
const syncPrLimits = settings({});
const getSyncPrDummyOutput = (): OutputOperation => ({
  signal: getSyncPrSignal(),
  output: { async write() {} },
  registerCleanup() {},
  async close() {},
} as unknown as OutputOperation);
const getSyncPrDummyContext = (): CommandContext => ({
  args: [] as string[],
  cwd: "/",
  env: { LC_ALL: "C" },
  signal: getSyncPrSignal(),
} as unknown as CommandContext);

const prSyncDecoder = new TextDecoder("utf-8", { fatal: true });
const prSyncCache = new Map<string, string>();

export function evalSyncPr(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  try {
    const budget = new Budget(getSyncPrDummyContext(), syncPrLimits, getSyncPrSignal());
    const parsed = parseOptions([...opArgs], budget);
    if (parsed.information !== undefined) return undefined;
    let cacheKey: string | undefined;
    if (inBytes !== undefined && !inBytes.includes(0) && parsed.files.length === 0 && !parsed.extremities) {
      cacheKey = `${opArgs.join("\x00")}|\x00${prSyncDecoder.decode(inBytes)}`;
      const cached = prSyncCache.get(cacheKey);
      if (cached !== undefined) return cached;
    }
    const names = parsed.files.length ? parsed.files : ["-"];
    if (!parsed.files.length) parsed.merge = false;
    const groups = parsed.merge ? [names] : names.map(name => [name]);
    const lifecycle = new Lifecycle(budget, getSyncPrDummyOutput());
    const nowMs = Date.now();
    const formatStamp = (): string => {
      const value = new Date(nowMs);
      if (parsed.dateFormat !== undefined) {
        return formatDate(parsed.dateFormat, BigInt(Math.trunc(nowMs)) * 1_000_000n, new TimeZone("UTC"), {
          maxArguments: syncPrLimits.maxArguments, maxArgumentBytes: syncPrLimits.maxArgumentBytes,
          maxOutputBytes: Math.min(syncPrLimits.maxBufferedBytes, syncPrLimits.maxOutputBytes),
          maxEnvironmentEntries: 1, maxFormatWidth: syncPrLimits.maxPageWidth,
        }).slice(0, -1);
      }
      const year = String(value.getUTCFullYear()).padStart(4, "0");
      const month = String(value.getUTCMonth() + 1).padStart(2, "0");
      const day = String(value.getUTCDate()).padStart(2, "0");
      const time = `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
      return `${year}-${month}-${day} ${time}`;
    };
    let totalOut = "";
    let stdinUsed = false;
    for (const group of groups) {
      const formatter = new Formatter({ ...parsed }, lifecycle, group.length);
      const readers: Reader[] = [];
      for (const name of group) {
        let srcBytes: Uint8Array | undefined;
        if (name === "-") {
          if (inBytes === undefined) return undefined;
          srcBytes = stdinUsed ? new Uint8Array(0) : inBytes;
          stdinUsed = true;
        } else {
          if (parsed.extremities && (parsed.dateFormat === undefined || parsed.dateFormat.includes("%"))) return undefined;
          if (!readFileSync) return undefined;
          srcBytes = readFileSync(name);
        }
        if (!srcBytes || srcBytes.byteLength > 16384 || srcBytes.includes(12)) return undefined;
        const reader = new Reader(name, lifecycle);
        reader.initFromBytes(srcBytes);
        readers.push(reader);
      }
      const title = parsed.header ?? (parsed.merge || readers[0]!.name === "-" ? "" : readers[0]!.name);
      const stamp = parsed.extremities ? formatStamp() : "";
      if (!formatter.runSync(readers, stamp, title)) return undefined;
      totalOut += lifecycle.takeStdoutSync();
    }
    const res = totalOut;
    if (cacheKey !== undefined) {
      if (prSyncCache.size >= 8) prSyncCache.clear();
      prSyncCache.set(cacheKey, res);
    }
    return res;
  } catch {
    return undefined;
  }
}

import { syncCommandEvaluators } from "safe-bash-contracts/runtime-control";
syncCommandEvaluators.evalSyncPr = evalSyncPr;
