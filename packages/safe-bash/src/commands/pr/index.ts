import type { CommandContext, CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import type { OutputOperation } from "../../contracts/output.js";
import { createPrCommand } from "./command.js";
import { Formatter } from "./format.js";
import { Budget, settings, type PrCommandsOptions } from "./internal.js";
import { Lifecycle, Reader } from "./io.js";
import { parseOptions } from "./options.js";

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

const prSyncDecoder = new TextDecoder("utf-8", { fatal: false });
const prSyncCache = new Map<string, string>();

export function evalSyncPr(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  let cacheKey: string | undefined;
  if (inBytes !== undefined && opArgs.every(a => a.startsWith("-"))) {
    cacheKey = `${opArgs.join("\x00")}|\x00${prSyncDecoder.decode(inBytes)}`;
    const cached = prSyncCache.get(cacheKey);
    if (cached !== undefined) return cached;
  }
  try {
    const budget = new Budget(getSyncPrDummyContext(), syncPrLimits, getSyncPrSignal());
    const parsed = parseOptions([...opArgs], budget);
    if (parsed.information !== undefined) return undefined;
    if (parsed.extremities && parsed.length > 10) return undefined;
    const names = parsed.files.length ? parsed.files : ["-"];
    if (!parsed.files.length) parsed.merge = false;
    const groups = parsed.merge ? [names] : names.map(name => [name]);
    const lifecycle = new Lifecycle(budget, getSyncPrDummyOutput());
    let totalOut = "";
    for (const group of groups) {
      const formatter = new Formatter({ ...parsed }, lifecycle, group.length);
      const readers: Reader[] = [];
      for (const name of group) {
        let srcBytes: Uint8Array | undefined;
        if (name === "-") {
          srcBytes = inBytes;
        } else {
          if (!readFileSync) return undefined;
          srcBytes = readFileSync(name);
        }
        if (!srcBytes || srcBytes.byteLength > 16384 || srcBytes.includes(12)) return undefined;
        const reader = new Reader(name, lifecycle);
        reader.initFromBytes(srcBytes);
        readers.push(reader);
      }
      if (!formatter.runSync(readers, "", "")) return undefined;
      totalOut += lifecycle.takeStdoutSync();
    }
    const res = totalOut.endsWith("\n") ? totalOut.slice(0, -1) : totalOut;
    if (cacheKey !== undefined) {
      if (prSyncCache.size >= 8) prSyncCache.clear();
      prSyncCache.set(cacheKey, res);
    }
    return res;
  } catch {
    return undefined;
  }
}
