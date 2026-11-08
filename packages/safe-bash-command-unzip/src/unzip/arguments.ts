import { getCommandArguments,readBytes,type ByteSource,type CommandContext } from "safe-bash-contracts";
import { shellValueByteLength,shellValueBytes } from "safe-bash-contracts/value";
import { yieldTurn } from "safe-bash-contracts/yield";
import { byteLength,decodeBytes,encodeBytes } from "safe-bash-io-engine/byte-encoding";
import { checkPath,fail,text,type ArchiveLimits } from "safe-bash-io-engine/commands/archive/internal";

export function parseArguments(context: Pick<CommandContext, "args" | "argumentValues">, limits: ArchiveLimits) {
  const { args } = context;
  const rawArguments = context.argumentValues ? getCommandArguments(context) : undefined;
  const passwordArguments = new Set<number>();
  let bytes = 0;
  for (const argument of args) {
    bytes += byteLength(argument) + 1;
    if (bytes > limits.maxArgumentBytes) fail("argument byte limit exceeded");
    if (argument.includes("\0")) fail("NUL in argument");
  }
  if (context.argumentValues) {
    const argumentsValue = getCommandArguments(context);
    let rawBytes = 0;
    for (const value of argumentsValue.values) {
      const size = shellValueByteLength(value) + 1;
      if (size > limits.maxArgumentBytes - rawBytes) fail("argument byte limit exceeded");
      rawBytes += size;
    }
  }
  let list = false;
  let verbose = false;
  let caseInsensitive = false;
  let update = false;
  let freshen = false;
  let excluding = false;
  const exclusions: string[] = [];
  let zipinfo = false;
  let names = false;
  let archiveComment = false;
  let test = false;
  let quiet = 0;
  let password: Uint8Array | undefined;
  let pipe = false;
  let pipeHeaders = false;
  let overwrite = false;
  let neverOverwrite = false;
  let junkPaths = false;
  let destination: string | undefined;
  let archive: string | undefined;
  let ended = false;
  const patterns: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (!ended && argument === "--") { ended = true; continue; }
    if (!ended && argument.startsWith("-") && argument !== "-") {
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset];
        if (flag === "P") {
          const attached = offset + 1 < argument.length;
          const value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) fail("password option requires a value");
          passwordArguments.add(index);
          const raw = rawArguments?.bytes(index);
          password = raw ? new Uint8Array(raw.subarray(attached ? offset + 1 : 0)) : encodeBytes(value);
          break;
        } else if (flag === "Z" && index === 0 && offset === 1) zipinfo = true;
        else if (flag === "1" && zipinfo) names = true;
        else if (flag === "z") archiveComment = true;
        else if (flag === "t") test = true;
        else if (flag === "q") quiet++;
        else if (flag === "l") list = true;
        else if (flag === "v") { list = true; verbose = true; }
        else if (flag === "C") caseInsensitive = true;
        else if (flag === "u") { update = true; freshen = false; }
        else if (flag === "f") { update = true; freshen = true; }
        else if (flag === "x") {
          excluding = true;
          if (argument.length > offset + 1) exclusions.push(argument.slice(offset + 1));
          break;
        }
        else if (flag === "p") pipe = true;
        else if (flag === "c") pipeHeaders = true;
        else if (flag === "o") overwrite = true;
        else if (flag === "n") neverOverwrite = true;
        else if (flag === "j") junkPaths = true;
        else if (flag === "d") {
          if (destination !== undefined) fail("-d may only be specified once");
          destination = argument.slice(offset + 1) || args[++index];
          if (!destination) fail("must specify directory to which to extract with -d option");
          checkPath(destination, limits);
          break;
        } else fail(`unsupported option: -${flag}`);
      }
    } else if (archive === undefined) archive = argument;
    else (excluding ? exclusions : patterns).push(argument);
  }
  if (rawArguments) for (const [index, value] of rawArguments.values.entries()) {
    if (!passwordArguments.has(index)) text(shellValueBytes(value));
  }
  pipeHeaders = pipeHeaders && !pipe;
  pipe = pipe || pipeHeaders;
  if (archive === undefined) fail("usage: unzip [-l|-v] [-C] [-u|-f] [-p|-c] [-t] [-z] [-Z -1] [-q[q]] [-o] [-n] [-j] [-d DIR] ARCHIVE [FILES...] [-x PATTERNS...]");
  checkPath(archive, limits);
  if (zipinfo && (!names || list || test || pipe || archiveComment || overwrite || destination !== undefined || password !== undefined)) fail("supported zipinfo mode is unzip -Z -1 ARCHIVE [FILES...]");
  if (archiveComment && (list || test || pipe || overwrite || destination !== undefined)) fail("archive comment mode cannot be combined with extraction, listing or test options");
  if (test && (list || pipe || destination !== undefined)) fail("unzip test mode cannot be combined with listing, pipe or destination");
  return { test, quiet, password, names, archiveComment, list: list && !pipe, verbose, caseInsensitive, update, freshen, exclusions, pipe, pipeHeaders, overwrite, neverOverwrite, junkPaths, destination, archive, patterns };
}

export class Answers {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private chunk = new Uint8Array();
  private offset = 0;
  private bytes = 0;
  private pulls = 0;
  constructor(source: ByteSource, private readonly limits: ArchiveLimits, private readonly signal: AbortSignal) {
    this.iterator = readBytes(source, signal)[Symbol.asyncIterator]();
  }
  async read(maximum = 9): Promise<string | undefined> {
    const answer: number[] = [];
    while (answer.length < maximum) {
      this.signal.throwIfAborted();
      if (this.offset === this.chunk.length) {
        if (++this.pulls > this.limits.maxPatternSteps) fail("overwrite input work limit exceeded");
        if (this.pulls % 64 === 0) await yieldTurn(this.signal);
        const next = await this.iterator.next();
        if (next.done) break;
        if (next.value.length > this.limits.maxFilesFromBytes - this.bytes) fail("overwrite input byte limit exceeded");
        this.bytes += next.value.length;
        this.chunk = Uint8Array.from(next.value);
        this.offset = 0;
        if (!this.chunk.length) continue;
      }
      const byte = this.chunk[this.offset++]!;
      answer.push(byte);
      if (byte === 10) break;
    }
    return answer.length ? decodeBytes(encodeBytes(answer), "utf8") : undefined;
  }
  async close(): Promise<void> { await this.iterator.return?.(); }
}
