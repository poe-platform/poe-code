import { ZipStateList, ZipStateMap } from "./state.js";
import { createZipScratchFactory } from "safe-bash-zip-engine/zip/scratch";
import { withInputByteBudget } from "safe-bash-contracts";
import { collectBytes,dirname,getCommandArguments,writeBytes,type ByteSource,type CommandDefinition,type FileStat } from "safe-bash-contracts";
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { escapeText } from "safe-bash-contracts/escaping";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output";
import { createOutputOperation } from "safe-bash-contracts/output";
import { shellValueByteLength,shellValueBytes } from "safe-bash-contracts/value";
import { yieldTurn } from "safe-bash-contracts/yield";
import { byteLength,encodeBytes } from "safe-bash-io-engine/byte-encoding";
import { Budget,checkPath,display,fail,invocationLimits,settings,text,vfsPath,type ArchiveCommandsOptions,type ArchiveLimits } from "safe-bash-io-engine/commands/archive/internal";
import { Selection } from "safe-bash-zip-engine/unzip/arguments";
import { makeZipEntry,makeZipEntryFromSource,readZipArchive,readZipIndexedArchive,setZipEntryComment,streamZipArchive,updateZipExtras,type ZipArchive,type ZipIndexedArchive,type ZipMetadataSpool,type ZipReadSource,type ZipEntry } from "safe-bash-zip-engine/zip-format";
import { zipEncryptionProfile,type ZipAes } from "safe-bash-zip-engine/zip/aes";
import { readZipComment,ZipCommentInput } from "safe-bash-zip-engine/zip/comments";
import { readZipPassword,ZipHostFailure,type ZipEncryption } from "safe-bash-zip-engine/zip/crypto";
import { parseZipDate,zipDateMatches,zipLatestTime } from "safe-bash-zip-engine/zip/dates";
import { zipEnvironmentArguments } from "safe-bash-zip-engine/zip/environment";
import { zipGrowRecords } from "safe-bash-zip-engine/zip/grow";
import { zipExtendedHelp,zipHelp,zipLicense,zipVersion } from "safe-bash-zip-engine/zip/help";
import { zipFromCrlf,zipToCrlf,zipLineEndingStream } from "safe-bash-zip-engine/zip/line-endings";
import { ZipLog } from "safe-bash-zip-engine/zip/log";
import { inspectZipMoveSource,removeZipSources,type ZipMoveSource } from "safe-bash-zip-engine/zip/move";
import { zipDosName } from "safe-bash-zip-engine/zip/names";
import { normalizeZipOption,parseZipDotSize,reservedZipShortOptions,zipDisplaySize,ZipFailure,zipLongOptions,zipNegatableOptions,zipPasswordArgument,zipPublicText } from "safe-bash-zip-engine/zip/options";
import { adjustZipRanges,repairZip } from "safe-bash-zip-engine/zip/repair";
import { hasZipIdentity as hasIdentity,openZipSource,publishZip,safeZipFile,sameZipIdentity as sameIdentity,stageZip,unchangedZipSource as unchanged,ZipScope,type ZipPublication } from "safe-bash-zip-engine/zip/safety";
import { readZipSfx } from "safe-bash-zip-engine/zip/sfx";
import { parseZipTestCommand,testZipCommand } from "safe-bash-zip-engine/zip/test-command";
import { publishZipVolumes,openZipVolumes,splitSize,splitZipRanges,splitZipVolumes,volumeName } from "safe-bash-zip-engine/zip/volumes";

interface ZipOptions {
  readonly split: number | undefined;
  readonly splitPause: boolean;
  readonly splitVerbose: boolean;
  readonly splitBell: boolean;
  password: Uint8Array | undefined;
  encrypt: boolean;
  encryption?: ZipEncryption;
  aes?: ZipAes;
  readonly args: readonly string[];
  readonly action: "add" | "delete" | "update" | "freshen" | "copy";
  readonly archive: string;
  readonly output: string | undefined;
  readonly recursive: boolean;
  readonly recursivePatterns: boolean;
  readonly noWild: boolean;
  readonly stopAtDirectories: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly showFiles: boolean | undefined;
  readonly debug: boolean;
  readonly displayBytes: boolean;
  readonly displayCounts: boolean;
  readonly displayUsize: boolean;
  readonly displayVolume: boolean;
  readonly dotSize: number;
  readonly globalDots: boolean;
  readonly junkPaths: boolean;
  readonly dosNames: boolean;
  readonly fifo: boolean;
  readonly omitDirectories: boolean;
  readonly storeLinks: boolean;
  readonly test: boolean;
  readonly testCommand: readonly string[] | undefined;
  readonly difference: boolean;
  readonly grow: boolean;
  readonly tempPath: string | undefined;
  readonly junkSfx: boolean;
  readonly repair: "F" | "FF" | undefined;
  readonly adjust: boolean;
  readonly logPath: string | undefined;
  readonly logAppend: boolean;
  readonly logInfo: boolean;
  readonly mustMatch: boolean;
  readonly filesync: boolean;
  readonly archiveComment: boolean;
  readonly entryComments: boolean;
  readonly latestTime: boolean;
  readonly toCrlf: boolean;
  readonly fromCrlf: boolean;
  readonly move: boolean;
  readonly fromDate: number | undefined;
  readonly beforeDate: number | undefined;
  readonly descriptors: boolean;
  readonly zip64: boolean | undefined;
  readonly metadata: "default" | "strip" | "all";
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly level: number;
  readonly method: "store" | "deflate" | "bzip2" | "lzma";
  readonly suffixes: readonly string[];
  readonly operands: readonly string[];
  readonly firstOperand: number;
}

const defaultStoreSuffixes = [".Z", ".zip", ".zoo", ".arc", ".lzh", ".arj"];

async function parse(scope: ZipScope, limits: ArchiveLimits, defaults?: ArchiveCommandsOptions["zip"]): Promise<ZipOptions | { information: "help" | "more-help" | "version" | "license" | "options" | "command"; command?: readonly string[]; debug?: boolean }> {
  const context = scope.context;
  const args = zipEnvironmentArguments(context.env, context.args, limits);
  const rawArguments = context.argumentValues ? getCommandArguments(context) : undefined;
  const passwordArguments = new Set<number>();
  const defaultsCount = args.length - context.args.length;
  const validateArgumentText = (): void => {
    if (rawArguments) for (const [index, value] of rawArguments.values.entries()) {
      if (!passwordArguments.has(index)) text(shellValueBytes(value));
    }
  };
  if (args.length > limits.maxArgumentBytes) fail("argument count limit exceeded");
  let bytes = 0;
  for (const argument of args) {
    const size = byteLength(argument);
    if (size > limits.maxArgumentBytes - bytes) fail("argument byte limit exceeded");
    bytes += size;
  }
  if (context.argumentValues) {
    const argumentsValue = getCommandArguments(context);
    let rawBytes = 0;
    for (const value of argumentsValue.values) {
      const size = shellValueByteLength(value);
      if (size > limits.maxArgumentBytes - rawBytes) fail("argument byte limit exceeded");
      rawBytes += size;
    }
  }
  let archive: string | undefined;
  let password: Uint8Array | undefined;
  let encrypt = defaults?.encryption !== undefined;
  let aes = zipEncryptionProfile(defaults?.encryption ?? "zipcrypto");
  let output: string | undefined;
  let action: ZipOptions["action"] = "add";
  let recursive = false;
  let recursivePatterns = false;
  let noWild = false;
  let stopAtDirectories = false;
  let quiet = false;
  let verbose = false;
  let showFiles: boolean | undefined;
  let showCommand = false;
  let showOptions = false;
  let debug = false;
  let displayBytes = false;
  let displayCounts = false;
  let displayUsize = false;
  let displayVolume = false;
  let dotSize = 0;
  let dotsSet = false;
  let globalDots = false;
  const commandOptions: string[] = [];
  const commandPaths: string[] = [];
  let junkPaths = false;
  let dosNames = false;
  let fifo = false;
  let omitDirectories = false;
  let storeLinks = false;
  let test = false;
  let testCommand: readonly string[] | undefined;
  let difference = false;
  let grow = false;
  let tempPath: string | undefined;
  let junkSfx = false;
  let repair: "F" | "FF" | undefined;
  let adjust = false;
  let logPath: string | undefined;
  let logAppend = false;
  let logInfo = false;
  let mustMatch = false;
  let filesync = false;
  let archiveComment = false;
  let entryComments = false;
  let latestTime = false;
  let toCrlf = false;
  let fromCrlf = false;
  let move = false;
  let fromDate: number | undefined;
  let beforeDate: number | undefined;
  let descriptors = false;
  let split: number | undefined;
  let splitPause = false, splitVerbose = false, splitBell = false;
  let zip64: boolean | undefined;
  let metadata: ZipOptions["metadata"] = "default";
  let level = 6;
  let method: ZipOptions["method"] = defaults?.compression ?? "deflate";
  if (method !== "store" && method !== "deflate" && method !== "bzip2" && method !== "lzma") fail("ZIP unsupported compression method");
  let suffixes: readonly string[] = defaultStoreSuffixes;
  let stdinNames = false;
  let literal = false;
  let firstOperand = -1;
  const operands: string[] = [];
  const includes: string[] = [];
  const excludes: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const startIndex = index;
    let listOption = false;
    const original = args[index]!;
    checkPath(original, limits);
    if (!literal && (original === "--encryption" || original.startsWith("--encryption="))) {
      const value = original === "--encryption" ? args[++index] : original.slice(13);
      if (value === undefined) fail("ZIP encryption option requires a profile");
      aes = zipEncryptionProfile(value);
      encrypt = true;
      commandOptions.push(...args.slice(startIndex, index + 1));
      continue;
    }
    const argument = literal ? original : normalizeZipOption(original);
    if (!literal && argument === "--") {
      if (archive === undefined) throw new ZipFailure(16, "Invalid command arguments", "can't use -- before archive name");
      literal = true;
      commandPaths.push(original);
    } else if (!literal && argument.startsWith("-") && argument !== "-") {
      commandOptions.push(original);
      if (argument === "--version") { validateArgumentText(); return { information: "version" }; }
      for (let offset = 1; offset < argument.length; offset++) {
        if (reservedZipShortOptions.has(argument.slice(offset, offset + 2))) {
          throw new ZipFailure(16, "Invalid command arguments", `unsupported option: -${argument.slice(offset, offset + 2)}`);
        }
        const flag = argument[offset];
        const pair = argument.slice(offset, offset + 2);
        if (pair === "sp" || pair === "sv" || pair === "sb") {
          if (pair === "sp") { splitPause = true; descriptors = true; }
          if (pair === "sv") splitVerbose = true;
          if (pair === "sb") splitBell = true;
          offset++;
        } else if (flag === "s" && !["sc", "sd", "sf", "so"].includes(pair)) {
          let value = argument.slice(offset + 1) || args[++index];
          if (value?.startsWith("=")) value = value.slice(1);
          if (!value) throw new ZipFailure(16, "Invalid command arguments", "split size requires a value");
          split = splitSize(value);
          break;
        } else if (pair === "FI") {
          fifo = argument[offset + 2] !== "-";
          offset += fifo ? 1 : 2;
        } else if (pair === "RE") {
          // Unix bracket lists are already enabled in the bounded glob matcher.
          if (argument[offset + 2] === "-") throw new ZipFailure(16, "Invalid command arguments", "option RE is not negatable");
          offset++;
        } else if (flag === "k") {
          if (argument[offset + 1] === "-") throw new ZipFailure(16, "Invalid command arguments", "option k is not negatable");
          dosNames = true;
        } else if (pair === "DF") { difference = true; offset++; }
        else if (pair === "la" || pair === "li") {
          if (pair === "la") logAppend = true; else logInfo = true;
          offset++;
        } else if (pair === "TT" || pair === "lf" || flag === "b") {
          const option = flag === "b" ? "b" : pair;
          if (option !== "b") offset++;
          let value = argument.slice(offset + 1) || args[++index];
          if (value?.startsWith("=")) value = value.slice(1);
          if (!value) throw new ZipFailure(16, "Invalid command arguments", `option ${option} requires a value`);
          if (option === "b") tempPath = value;
          else if (option === "lf") logPath = value;
          else testCommand = parseZipTestCommand(value);
          break;
        } else if (flag === "g") grow = true;
        else if (flag === "J") junkSfx = true;
        else if (flag === "A") adjust = true;
        else if (flag === "F" && pair !== "FS" && pair !== "FI") { repair = pair === "FF" ? "FF" : "F"; if (pair === "FF") offset++; }
        else if (flag === "P") {
          let value = argument.slice(offset + 1);
          const attached = value.length > 0;
          if (!value) {
            value = args[++index]!;
            if (value === undefined) throw new ZipFailure(16, "Invalid command arguments", "password option requires a value");
          } else if (value.startsWith("=")) value = value.slice(1);
          const rawIndex = index - defaultsCount;
          passwordArguments.add(rawIndex);
          const raw = rawArguments?.bytes(rawIndex);
          const prefix = attached ? original.startsWith("--") ? original.indexOf("=") + 1 : offset + 1 + (original[offset + 1] === "=" ? 1 : 0) : 0;
          password = raw ? new Uint8Array(raw.subarray(prefix)) : encodeBytes(value);
          if (password.includes(0)) fail("ZIP invalid password bytes");
          if (!password.length) throw new ZipFailure(16, "Invalid command arguments", "zero length password not allowed");
          encrypt = true;
          break;
        } else if (flag === "e") encrypt = true;
        else if (["db", "dc", "dd", "dg", "du", "dv", "ds", "sc", "sd", "sf", "so"].includes(pair)) {
          offset++;
          const negated = argument[offset + 1] === "-";
          if (negated && !zipNegatableOptions.has(pair)) throw new ZipFailure(16, "Invalid command arguments", `option ${pair} is not negatable`);
          if (negated) offset++;
          if (pair === "ds") {
            let value = argument.slice(offset + 1) || args[++index];
            if (value === undefined) throw new ZipFailure(16, "Invalid command arguments", "option ds requires a value");
            if (value.startsWith("=")) value = value.slice(1);
            dotSize = parseZipDotSize(value);
            dotsSet = true;
            break;
          }
          if (pair === "db") displayBytes = !negated;
          else if (pair === "dc") displayCounts = !negated;
          else if (pair === "du") displayUsize = !negated;
          else if (pair === "dv") displayVolume = !negated;
          else if (pair === "sf") showFiles = !negated;
          else if (pair === "sc") showCommand = true;
          else if (pair === "sd") debug = true;
          else if (pair === "so") showOptions = true;
          else if (pair === "dd") {
            globalDots = false;
            if (negated) dotsSet = false;
            else { if (!dotsSet) dotSize = 10 * 1024 ** 2; dotsSet = true; }
          } else if (pair === "dg") {
            globalDots = !negated;
            if (!negated) { if (!dotsSet) dotSize = 10 * 1024 ** 2; dotsSet = true; }
          }
        }
        else if (flag === "L" || flag === "v") {
          if (argument[offset + 1] === "-") throw new ZipFailure(16, "Invalid command arguments", `option ${flag} is not negatable`);
          if (flag === "L") { validateArgumentText(); return { information: "license" }; }
          if (args.length === 1 && original === "-v") { validateArgumentText(); return { information: "version" }; }
          verbose = true;
          quiet = false;
        }
        else if (flag === "h") {
          if (argument[offset + 1] === "-") throw new ZipFailure(16, "Invalid command arguments", "option h is not negatable");
          if (argument[offset + 1] === "2") {
            if (argument[offset + 2] === "-") throw new ZipFailure(16, "Invalid command arguments", "option h2 is not negatable");
            validateArgumentText();
            return { information: "more-help" };
          }
          validateArgumentText();
          return { information: "help" };
        }
        else if (flag === "r" || flag === "R") {
          if (flag === "r") recursive = true;
          else recursivePatterns = true;
          if (recursive && recursivePatterns) throw new ZipFailure(16, "Invalid command arguments", "do not specify both -r and -R");
        }
        else if (flag === "f" && argument[offset + 1] === "d") {
          if (argument[offset + 2] === "-") throw new ZipFailure(16, "Invalid command arguments", "option fd is not negatable");
          descriptors = true;
          offset++;
        }
        else if (flag === "f" && argument[offset + 1] === "z") {
          zip64 = argument[offset + 2] !== "-";
          offset += zip64 ? 1 : 2;
        }
        else if (flag === "d" || flag === "u" || flag === "f" || flag === "U") {
          const next = flag === "d" ? "delete" : flag === "u" ? "update" : flag === "U" ? "copy" : "freshen";
          if (action !== "add" && action !== next) throw new ZipFailure(16, "Invalid command arguments", "specify just one action");
          action = next;
        }
        else if (flag === "n" && argument[offset + 1] === "w" || flag === "w" && argument[offset + 1] === "s") {
          if (argument[offset + 2] === "-") throw new ZipFailure(16, "Invalid command arguments", "wildcard control is not negatable");
          if (flag === "n") noWild = true;
          else stopAtDirectories = true;
          offset++;
        }
        else if (flag === "M" && argument[offset + 1] === "M") {
          if (argument[offset + 2] === "-") throw new ZipFailure(16, "Invalid command arguments", "option MM is not negatable");
          mustMatch = true;
          offset++;
        }
        else if (flag === "F" && argument[offset + 1] === "S") {
          if (argument[offset + 2] === "-") throw new ZipFailure(16, "Invalid command arguments", "option FS is not negatable");
          filesync = true;
          offset++;
        }
        else if (flag === "q") quiet = true;
        else if (flag === "z") archiveComment = true;
        else if (flag === "c") entryComments = true;
        else if (flag === "o") latestTime = true;
        else if (flag === "l") {
          fromCrlf = argument[offset + 1] === "l";
          toCrlf = !fromCrlf;
          if (fromCrlf) offset++;
        }
        else if (flag === "m") move = true;
        else if (flag === "p") {
          if (argument[offset + 1] === "-") throw new ZipFailure(16, "Invalid command arguments", "option p is not negatable");
          // Native Unix procname accepts -p for compatibility without undoing -j.
        }
        else if (flag === "j") junkPaths = true;
        else if (flag === "X") {
          metadata = argument[offset + 1] === "-" ? "all" : "strip";
          if (metadata === "all") offset++;
        }
        else if (flag === "D") omitDirectories = true;
        else if (flag === "y") storeLinks = true;
        else if (flag === "T") test = true;
        else if (flag === "@") stdinNames = true;
        else if (flag !== undefined && flag >= "0" && flag <= "9") {
          level = Number(flag);
          if (level === 0) method = "store";
        }
        else if (flag === "O") {
          let value = argument.slice(offset + 1) || args[++index];
          if (value?.startsWith("=")) value = value.slice(1);
          if (value === undefined) throw new ZipFailure(16, "Invalid command arguments", "option O requires a value");
          output = value;
          break;
        }
        else if (flag === "t") {
          const option = argument[offset + 1] === "t" ? "tt" : "t";
          if (option === "tt") offset++;
          let value = argument.slice(offset + 1);
          if (!value) value = args[++index] ?? "";
          if (value.startsWith("=")) value = value.slice(1);
          const date = parseZipDate(value, option);
          if (option === "t") fromDate = date;
          else beforeDate = date;
          break;
        }
        else if (flag === "n" || flag === "Z") {
          let value = argument.slice(offset + 1);
          if (!value) {
            const next = args[index + 1];
            if (next === undefined || next.startsWith("-") && next !== "-") throw new ZipFailure(16, "Invalid command arguments", `option '${flag}' requires a value`);
            value = next;
            index++;
          }
          if (value.startsWith("=")) value = value.slice(1);
          if (flag === "n") {
            suffixes = value ? value.split(":").filter(suffix => suffix.length > 0) : defaultStoreSuffixes;
            if (value && suffixes.length > limits.maxMembers) fail("suffix count limit exceeded");
          } else {
            const matches = (["store", "deflate", "bzip2", "lzma"] as const).filter(name => name.startsWith(value.toLowerCase()));
            const selected = matches.length === 1 ? matches[0] : undefined;
            if (!selected) throw new ZipFailure(16, "Invalid command arguments", "Option -Z (--compression-method):  unknown method");
            method = selected;
          }
          break;
        }
        else if (flag === "i" || flag === "x") {
          listOption = offset + 1 === argument.length;
          const patterns = flag === "i" ? includes : excludes;
          const before = patterns.length;
          const append = (pattern: string) => {
            if (pattern) checkPath(pattern, limits);
            if (includes.length + excludes.length >= limits.maxMembers) fail("pattern count limit exceeded");
            patterns.push(dosNames ? zipDosName(pattern) : pattern);
          };
          const attached = offset + 1 < argument.length;
          if (attached) {
            const value = argument.slice(offset + 1);
            append(value.startsWith("=") ? value.slice(1) : value);
          }
          while (!attached && index + 1 < args.length) {
            const next = args[index + 1]!;
            if (next === "@") { index++; break; }
            if (next.startsWith("-") && next !== "-") break;
            append(next);
            index++;
          }
          if (patterns.length === before) throw new ZipFailure(16, "Invalid command arguments", `option '${flag}' requires a value`);
          break;
        }
        else throw new ZipFailure(16, "Invalid command arguments", `unsupported option: -${flag}`);
      }
      commandOptions.push(...args.slice(startIndex + 1, index + 1));
      if (listOption && args[index] !== "@") commandOptions.push("@");
    } else if (archive === undefined) { archive = argument; commandPaths.push(original); }
    else {
      if (operands.length >= limits.maxMembers) fail("operand limit exceeded");
      if (firstOperand < 0) firstOperand = index;
      operands.push(argument);
      commandPaths.push(original);
    }
  }
  validateArgumentText();
  if (repair || adjust) {
    if (repair && adjust || junkSfx || grow || move || split !== undefined || operands.length || stdinNames || includes.length || excludes.length || action !== "add" || archiveComment || entryComments || latestTime || filesync || encrypt || showFiles !== undefined || difference || toCrlf || fromCrlf || recursive || recursivePatterns) throw new ZipFailure(16, "Invalid command arguments", "repair/adjust cannot be combined with archive modification or selection");
    if (!archive || archive === "-" || repair && (!output || output === "-")) throw new ZipFailure(16, "Invalid command arguments", "recovery requires a named source and a separate --out file");
  }
  if (showCommand) return { information: "command", command: [context.command, ...commandOptions, ...commandPaths], debug };
  if (showOptions) return { information: "options", debug };
  if (verbose && !dotsSet && !dotSize) dotSize = 10 * 1024 ** 2;
  if (archive === undefined) {
    if (includes.length || excludes.length) throw new ZipFailure(16, "Invalid command arguments", "nothing to select from");
    if (action !== "add") throw new ZipFailure(16, "Invalid command arguments", "expected archive name");
    archive = "-";
    if (!stdinNames) operands.push("-");
  }
  if (archive !== "-" && !archive.slice(archive.lastIndexOf("/") + 1).includes(".")) archive += ".zip";
  checkPath(archive, limits);
  if (output !== undefined) {
    if (!output.slice(output.lastIndexOf("/") + 1).includes(".")) output += ".zip";
    checkPath(output, limits);
    if (action === "add" && archive !== "-" && !operands.length && !stdinNames) action = "copy";
  }
  if (showFiles !== undefined && !operands.length && !stdinNames && (includes.length || excludes.length)) throw new ZipFailure(16, "Invalid command arguments", "nothing to select from");
  if (action === "copy" && output === undefined && showFiles === undefined) throw new ZipFailure(16, "Invalid command arguments", "-U (--copy) requires -O (--out)");
  const names: string[] = [];
  if (stdinNames) {
    const input = await collectBytes(scope.stdin, { ...(Number.isFinite(limits.maxFilesFromBytes) ? { maxBytes: limits.maxFilesFromBytes } : {}), signal: context.signal });
    let start = 0;
    let lines = 0;
    for (let end = 0; end <= input.length; end++) {
      if (end !== input.length && input[end] !== 10) continue;
      if (++lines > limits.maxPatternSteps) fail("stdin filename work limit exceeded");
      if (lines % 128 === 0) await yieldTurn(context.signal);
      let last = end;
      while (last > start && input[last - 1] === 13) last--;
      if (last > start) {
        if (names.length + operands.length >= limits.maxMembers) fail("operand limit exceeded");
        if (last - start > limits.maxPathBytes) fail("path byte limit exceeded");
        const name = text(input.subarray(start, last));
        checkPath(name, limits);
        names.push(name);
      }
      start = end + 1;
    }
  }
  if (recursivePatterns && !names.length && !operands.length) throw new ZipFailure(16, "Invalid command arguments", "nothing to select from");
  if (difference && (archive === "-" || output === undefined || action === "copy" || action === "delete")) throw new ZipFailure(16, "Invalid command arguments", "difference archive requires separate output and cannot use delete or copy");
  if (logPath !== undefined && !logPath.slice(logPath.lastIndexOf("/") + 1).includes(".")) logPath += ".log";
  if (filesync && (action !== "add" || grow)) throw new ZipFailure(16, "Invalid command arguments", "can't use -d, -f, -u, -U, or -g with filesync -FS\n");
  const diagnosticArgs = args.map((value, index) => passwordArguments.has(index - defaultsCount) ? "[redacted]" : zipPublicText(value));
  if (split && (archive === "-" || grow)) throw new ZipFailure(16, "Invalid command arguments", "split output requires a file and cannot grow");
  return { repair, adjust, split, splitPause, splitVerbose, splitBell, password, encrypt, ...(aes ? { aes } : {}), args: diagnosticArgs, action, archive, output, recursive, recursivePatterns, noWild, stopAtDirectories, quiet, verbose, showFiles, debug, displayBytes, displayCounts, displayUsize, displayVolume, dotSize, globalDots, junkPaths, dosNames, fifo, omitDirectories, storeLinks: storeLinks && !dosNames, test, testCommand, difference, grow, tempPath, junkSfx, logPath, logAppend, logInfo, mustMatch, filesync, archiveComment, entryComments, latestTime, toCrlf, fromCrlf, move, fromDate, beforeDate, descriptors, zip64, metadata, includes, excludes, level, method, suffixes, operands: [...names, ...operands], firstOperand };
}

function memberName(path: string, limits: ArchiveLimits): string {
  if (path.startsWith("//") && !path.startsWith("///")) fail("UNC source paths are unsupported");
  let start = 0;
  while (path[start] === "/") start++;
  while (path.slice(start, start + 2) === "./") start += 2;
  const name = path.slice(start);
  if (name.split("/").includes("..")) fail("parent-component archive names are unsupported");
  if (name && name !== ".") checkPath(name, limits);
  return name === "." ? "" : name;
}

async function inspectSource(scope: ZipScope, path: string, storeLinks: boolean): Promise<{ canonical: string; stat: FileStat }> {
  const { fs, signal } = scope.context;
  if (storeLinks) {
    const stat = await scope.operation(() => fs.lstat(path, { signal }));
    if (stat.type === "symlink") {
      const parent = await scope.operation(() => fs.realpath(dirname(path), { signal }));
      const canonical = `${parent === "/" ? "" : parent}/${path.slice(path.lastIndexOf("/") + 1)}`;
      return { canonical, stat };
    }
  }
  const canonical = await scope.operation(() => fs.realpath(path, { signal }));
  const stat = await scope.operation(() => fs.stat(path, { signal }));
  return { canonical, stat };
}

async function filterName(name: string, selection: Selection, includeCount: number): Promise<boolean> {
  selection.matched.clear();
  await selection.matches(name);
  let included = includeCount === 0;
  for (const pattern of selection.matched) {
    if (pattern >= includeCount) return false;
    included = true;
  }
  return included;
}

async function prepare(scope: ZipScope, parsed: ZipOptions, budget: Budget, log?: ZipLog, host?: ArchiveCommandsOptions["zipHost"]) {
  const context = scope.context;
  const limits = budget.limits;
  if (parsed.archive === "-" && parsed.action !== "add") throw new ZipFailure(16, "Invalid command arguments", "can't use -d, -f, -u, -U, or -g on stdout\n");
  let temporary: { name: string; parent: string; parentStat: FileStat } | undefined;
  if (parsed.tempPath !== undefined && parsed.showFiles === undefined) {
    const name = vfsPath(context.cwd, parsed.tempPath);
    checkPath(name, limits);
    const parent = await scope.operation(() => context.fs.realpath(name, { signal: context.signal }));
    const parentStat = await scope.operation(() => context.fs.lstat(parent, { signal: context.signal }));
    if (parentStat.type !== "directory" || !hasIdentity(parentStat)) fail("ZIP temporary path requires a directory with known backing identity");
    temporary = { name, parent, parentStat };
  }
  let publication: Omit<ZipPublication, "bytes" | "source"> | undefined;
  if (parsed.archive !== "-" && parsed.showFiles === undefined) {
    const outputName = vfsPath(context.cwd, parsed.output ?? parsed.archive);
    const parentName = dirname(outputName);
    const parent = await scope.operation(() => context.fs.realpath(parentName, { signal: context.signal }));
    const parentStat = await scope.operation(() => context.fs.lstat(parent, { signal: context.signal }));
    const output = `${parent === "/" ? "" : parent}/${outputName.slice(outputName.lastIndexOf("/") + 1)}`;
    checkPath(output, limits);
    const existing = await scope.stat(output);
    publication = { output, parentName, parent, parentStat, existing };
    if (temporary) publication = { ...publication, stagingName: temporary.name, stagingParent: temporary.parent, stagingParentStat: temporary.parentStat };
  }
  const output = publication?.output ?? (parsed.output === undefined ? undefined : vfsPath(context.cwd, parsed.output));
  let input = publication?.output;
  let existing = publication?.existing;
  if (parsed.showFiles !== undefined && parsed.archive !== "-") {
    input = vfsPath(context.cwd, parsed.archive);
    existing = await scope.stat(input);
  }
  if (parsed.output !== undefined && parsed.showFiles === undefined) {
    if (parsed.archive === "-") { input = undefined; existing = undefined; }
    else {
      const name = vfsPath(context.cwd, parsed.archive);
      try {
        const parent = await scope.operation(() => context.fs.realpath(dirname(name), { signal: context.signal }));
        input = `${parent === "/" ? "" : parent}/${name.slice(name.lastIndexOf("/") + 1)}`;
        existing = await scope.stat(input);
      } catch (error) {
        context.signal.throwIfAborted();
        if (typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "EACCES")) throw new ZipFailure(18, "File not found or no read permission", parsed.archive);
        throw error;
      }
      if (input === output || existing && publication?.existing && sameIdentity(existing, publication.existing)) throw new ZipFailure(16, "Invalid command arguments", `--out path must be different than in path: ${parsed.archive}`);
    }
  }
  if ((parsed.action === "copy" || parsed.showFiles !== undefined && !parsed.operands.length || parsed.output !== undefined && parsed.archive !== "-") && !existing) throw new ZipFailure(18, "File not found or no read permission", parsed.archive);
  const allowHardlinkedUpdate = !parsed.split && parsed.output === undefined;
  if (publication?.existing && !await safeZipFile(scope, publication.output, publication.existing, allowHardlinkedUpdate)) fail("output archive requires a regular, single-link file with known backing identity");
  if (parsed.archive === "-" && parsed.test && !parsed.quiet) await budget.output("\tzip warning: can't use -T on stdout, -T ignored\n");
  if (existing && !await safeZipFile(scope, input!, existing, allowHardlinkedUpdate)) fail("updating archive requires a regular, single-link file with known backing identity; archive aliases are unsupported");
  const scratchParent = temporary?.parent ?? publication?.parent ?? context.cwd;
  const directStdin = parsed.archive === "-" && parsed.operands.length === 1 && parsed.operands[0] === "-" && !parsed.archiveComment && !parsed.entryComments && parsed.tempPath === undefined;
  const scratchCapabilities = directStdin ? {} : await scope.operation(() => context.fs.capabilitiesFor?.(scratchParent, { signal: context.signal }) ?? context.fs.capabilities);
  const scratch = scratchCapabilities.retainedRead && scratchCapabilities.retainedStagingWrite && scratchCapabilities.retainedStagingCleanup
    ? createZipScratchFactory(scope, scratchParent) : undefined;
  if (scratch) scope.retain(scratch.close);
  let originalSource: ZipReadSource | undefined;
  let payloadSpool: ZipMetadataSpool | undefined;
  let payloadSource: ZipReadSource | undefined;
  let payloadSize = 0;
  type StoredEntry = ZipEntry & { bankOffset?: number; inputName?: string; inputStat?: FileStat | undefined; inputCanonical?: string | undefined; inputFifo?: boolean | undefined; selectedSource?: string; converted?: boolean };
  const identityScopes: unknown[] = [];
  const encodeState = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || value instanceof Uint8Array || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(encodeState);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "function" || key === "source" && typeof item !== "string") continue;
      if (key === "identityScope" && item !== undefined) {
        let id = identityScopes.indexOf(item);
        if (id < 0) { id = identityScopes.length; identityScopes.push(item); }
        result.identityScopeIndex = id;
      } else result[key] = encodeState(item);
    }
    return result;
  };
  const decodeState = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || value instanceof Uint8Array || value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(decodeState);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "identityScopeIndex") result.identityScope = identityScopes[item as number];
      else result[key] = decodeState(item);
    }
    if ("method" in result && "crc32" in result && "data" in result) {
      const entry = result as unknown as StoredEntry;
      if (entry.encryption && parsed.encryption) entry.encryption = parsed.encryption;
      if (entry.bankOffset !== undefined || entry.compressedOffset !== undefined) entry.compressedSource = () => (async function* () {
        const source = entry.bankOffset === undefined ? originalSource : payloadSource;
        if (!source) fail("ZIP missing retained payload storage");
        const start = entry.bankOffset ?? entry.compressedOffset!;
        for (let offset = 0; offset < entry.compressedSize!;) {
          const bytes = await source.read(start + offset, Math.min(limits.chunkSize, entry.compressedSize! - offset));
          if (!bytes.length) fail("ZIP truncated retained payload");
          offset += bytes.length; yield bytes;
        }
      })();
      if (entry.growStart !== undefined && originalSource) zipGrowRecords.set(entry, { length: entry.growLength!, version: entry.growVersion!, source: () => (async function* () {
        for (let offset = 0; offset < entry.growLength!;) {
          const bytes = await originalSource!.read(entry.growStart! + offset, Math.min(limits.chunkSize, entry.growLength! - offset));
          if (!bytes.length) fail("ZIP truncated grow record");
          offset += bytes.length; yield bytes;
        }
      })() });
      if (entry.inputName !== undefined) {
        const name = entry.inputName;
        const raw = (async function* (): ByteSource {
          if (name === "-") { yield* scope.stdin; return; }
          const path = vfsPath(context.cwd, name);
          try { yield* scope.input(path, entry.inputFifo, entry.inputFifo ? undefined : entry.inputStat); }
          catch (error) {
            context.signal.throwIfAborted();
            if (parsed.mustMatch && typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "EACCES")) throw new ZipFailure(18, "File not found or no read permission", `was zipping ${name}`);
            throw error;
          }
          const current = await inspectSource(scope, path, parsed.storeLinks);
          if (current.canonical !== entry.inputCanonical || !unchanged(entry.inputStat!, current.stat)) fail(`source changed while reading: ${name}`);
        })();
        entry.source = parsed.toCrlf || parsed.fromCrlf ? zipLineEndingStream(raw, parsed.fromCrlf, entry.method === 0, limits.maxEntryBytes, context.signal, entry.level, converted => { entry.converted = converted; }) : raw;
      }
    }
    return result;
  };
  const stateMap = <T>() => new ZipStateMap<T>(scratch, context.signal, value => encodeState(value), value => decodeState(value) as T);
  const moveBacking = scratch ? { createMap: stateMap, identityKey: (stat: FileStat) => {
    let scopeIndex = identityScopes.indexOf(stat.identityScope);
    if (scopeIndex < 0) { scopeIndex = identityScopes.length; identityScopes.push(stat.identityScope); }
    return JSON.stringify([scopeIndex, stat.dev, stat.ino, stat.opaqueIdentity]);
  } } : undefined;
  let archive: ZipArchive | ZipIndexedArchive = { entries: [], comment: new Uint8Array() };
  let inputPaths: readonly string[] = [];
  let inputSplit: number | undefined;
  if (existing && input) {
    if (!Number.isSafeInteger(existing.size) || existing.size < 0 || existing.size > limits.maxArchiveBytes) fail("archive byte limit exceeded");
    const retained = parsed.repair || parsed.adjust ? await openZipSource(scope, input) : await openZipVolumes(scope, input, host);
    scope.retain(retained.close);
    originalSource = retained.source;
    const resolved = "paths" in retained ? retained : { ...retained, paths: [input], disks: undefined };
    inputPaths = resolved.paths;
    await log?.protect(inputPaths);
    if (resolved.disks && resolved.disks.starts.length > 1) inputSplit = Math.max(65536, ...resolved.disks.lengths.slice(0, -1));
    if (publication && parsed.output !== undefined) for (const path of inputPaths) {
      const stat = await scope.stat(path);
      if (publication.output === path || stat && publication.existing && sameIdentity(stat, publication.existing)) fail("ZIP output aliases an input volume");
    }
    if ((parsed.split || resolved.disks) && parsed.output === undefined && parsed.showFiles === undefined) throw new ZipFailure(16, "Invalid command arguments", "split archives require a separate --out destination");
    if (parsed.repair || parsed.adjust) {
      if (!publication) fail("ZIP repair requires a file destination");
      let source: ByteSource, partial = false;
      if (parsed.repair) {
        const recovered = await repairZip(retained.source, parsed.repair, limits, context.signal, parsed.password, scratch);
        partial = recovered.partial;
        if ("close" in recovered.archive) scope.retain(recovered.archive.close);
        source = streamZipArchive(recovered.archive, limits, context.signal, false, false, true, scratch);
      } else {
        archive = scratch ? await readZipIndexedArchive(retained.source, limits, context.signal, scratch, { prefix: true }) : await readZipArchive(retained.source, limits, context.signal, { prefix: true });
        const adjusted = await adjustZipRanges(retained.source, archive, limits, context.signal, parsed.password, scratch);
        scope.retain(adjusted.close);
        source = (async function* (): ByteSource {
          for (let offset = 0; offset < adjusted.size;) {
            const chunk = await adjusted.read(offset, Math.min(limits.chunkSize, adjusted.size - offset));
            if (!chunk.length) fail("ZIP truncated adjusted archive");
            offset += chunk.length;
            yield chunk;
          }
        })();
      }
      const current = await scope.stat(input);
      if (!current || !unchanged(existing, current)) fail("archive changed while reading");
      const progress: string[] = [];
      if (!parsed.quiet) progress.push(parsed.repair ? `Fix archive (-${parsed.repair}) - verified recovered members\n` : "Zip entry offsets adjusted\n");
      if (partial) progress.push("\tzip warning: partial recovery; some entries were not recovered\n");
      return { kind: "staged-source" as const, inputSplit, inputPaths, publication: { ...publication, ...(parsed.test ? { validate: (path: string) => testZipCommand(scope, parsed.testCommand, path, budget, parsed.archive, parsed.quiet, parsed.password) } : {}) }, source, scratch, progress, exitCode: 0, moveBacking, moves: [] };
    }
    archive = parsed.junkSfx ? await readZipSfx(retained.source, limits, context.signal, parsed.password, scratch) : scratch ? await readZipIndexedArchive(retained.source, limits, context.signal, scratch, { grow: parsed.grow, ...(resolved.disks ? { disks: resolved.disks } : {}) }) : await readZipArchive(retained.source, limits, context.signal, { grow: parsed.grow, ...(resolved.disks ? { disks: resolved.disks } : {}) });
    const current = await scope.stat(input);
    if (!current || !unchanged(existing, current)) fail("archive changed while reading");
  }
  const logStat = parsed.logPath === undefined ? undefined : await scope.stat(vfsPath(context.cwd, parsed.logPath));
  const old = stateMap<ZipEntry>();
  for await (const entry of archive.entries) await await old.set(entry.name, entry);
  const convertedNames = stateMap<boolean>();
  if (!archive.entries.length && !parsed.quiet && (parsed.action === "update" || parsed.action === "freshen")) await budget.output(`\tzip warning: ${zipPublicText(parsed.archive)} not found or empty\n`);
  const dosConvertedNames = stateMap<boolean>();
  const selected = stateMap<{ entry: ZipEntry; source: string; sourceSize: number }>();
  const conversionWarnings = stateMap<string>();
  const listed = stateMap<{ name: string; size: number; source: string }>();
  const moves = stateMap<ZipMoveSource>();
  const deleted = stateMap<boolean>();
  const synchronized = stateMap<string>();
  const commentNames = stateMap<boolean>();
  const selection = new Selection([...parsed.includes, ...parsed.excludes], limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories });
  const recursiveSelection = parsed.recursivePatterns ? new Selection(parsed.dosNames ? parsed.operands.map(zipDosName) : parsed.operands, limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories, trailingComponents: true }) : undefined;
  const ancestors: { path: string; stat: FileStat }[] = [];
  let visits = 0;
  let work = 0;
  let compressedBytes = 0;
  const encodeSelected = async (source: string, name: string, input: Uint8Array | ByteSource, attributes: Pick<ZipEntry, "modified" | "mode" | "directory" | "symlink">, expectedSize?: number, sourceStat?: FileStat, sourceCanonical?: string, sourceFifo?: boolean) => {
    const live = !(input instanceof Uint8Array);
    let bytes = live ? new Uint8Array() : input;
    const sourceSize = live ? expectedSize ?? 0 : bytes.length;
    const originalBytes = bytes;
    const store = parsed.method === "store" || parsed.level !== 9 && parsed.suffixes.some(suffix => name.endsWith(suffix));
    if (!store && parsed.level === 0 && (bytes.length || expectedSize) && !attributes.directory && !attributes.symlink) throw new ZipFailure(5, "Internal logic error", "bad pack level");
    if (!live && (parsed.toCrlf || parsed.fromCrlf) && !attributes.directory && !attributes.symlink) {
      if (parsed.fromCrlf && parsed.method === "bzip2" && !store) fail("from-crlf BZIP2 native read profile unsupported");
      const originalSize = bytes.length;
      bytes = parsed.fromCrlf ? await zipFromCrlf(bytes, store, context.signal, parsed.level) : await zipToCrlf(bytes, store, Math.min(limits.maxEntryBytes, limits.maxTotalBytes - budget.totalBytes + originalSize), context.signal);
      budget.totalBytes += bytes.length - originalSize;
    }
    const level = store ? 0 : parsed.level;
    let entry: StoredEntry = await makeZipEntry(name, bytes, attributes, limits, context.signal, level, !store && (parsed.archive === "-" && parsed.tempPath === undefined || parsed.descriptors && bytes.length > 0), parsed.method === "store" ? "deflate" : parsed.method);
    if (live) {
      const converting = parsed.toCrlf || parsed.fromCrlf;
      if (parsed.fromCrlf && parsed.method === "bzip2" && !store) fail("from-crlf BZIP2 native read profile unsupported");
      const convertedInput = converting ? zipLineEndingStream(input as ByteSource, parsed.fromCrlf, store, Math.min(limits.maxEntryBytes, limits.maxTotalBytes), context.signal, level, converted => { entry.converted = converted; }) : input as ByteSource;
      entry = { ...entry, inputName: source, inputStat: sourceStat, inputCanonical: sourceCanonical, inputFifo: sourceFifo, data: new Uint8Array(), size: expectedSize ?? 0, source: convertedInput, level,
        method: store || expectedSize === 0 && parsed.archive !== "-" ? 0 : parsed.method === "lzma" ? 14 : parsed.method === "bzip2" ? 12 : 8, ...(parsed.method === "lzma" && !store && !(expectedSize === 0 && parsed.archive !== "-") ? { flags: 0x802 } : {}), ...(expectedSize === undefined ? {} : converting ? { maxSourceSize: expectedSize * (parsed.toCrlf ? 2 : 1) } : { expectedSize }) };
      const storage = directStdin ? {} : await scope.operation(() => context.fs.capabilitiesFor?.(temporary?.parent ?? publication?.parent ?? context.cwd, { signal: context.signal }) ?? context.fs.capabilities);
      if ((parsed.archive !== "-" || parsed.tempPath !== undefined || parsed.archiveComment || parsed.entryComments) && scratch && storage.retainedStagingWrite === true && storage.retainedStagingCleanup === true) {
        if (publication && ((storage.atomicFileMutation !== true && storage.trustedOwnedStaging !== true) || !context.fs.writeFileConditional)) fail("ZIP temporary path requires atomic conditional writes");
        const conversionEntry = entry;
        const memberSpools: ZipMetadataSpool[] = [];
        try {
          entry = await makeZipEntryFromSource(name, convertedInput, attributes, limits, context.signal, async (source, maximum) => {
            const spool = await scratch!(); memberSpools.push(spool);
            let size = 0;
            for await (const bytes of source) {
              if (bytes.length > maximum - size) fail("ZIP payload byte limit exceeded");
              size += bytes.length; await spool.append(bytes);
            }
            return spool.finish();
          }, level, parsed.descriptors && expectedSize !== 0, parsed.method === "store" ? "deflate" : parsed.method);
          if (conversionEntry.converted) await convertedNames.set(name, true);
          payloadSpool ??= await scratch!();
          entry.bankOffset = payloadSize;
          for await (const bytes of entry.compressedSource!()) { await payloadSpool.append(bytes); payloadSize += bytes.length; }
          delete entry.compressedSource;
        } finally { await Promise.all(memberSpools.map(spool => spool.close())); }
      }
    }
    if (parsed.fromCrlf && sourceSize > 0 && !store && entry.internalAttributes === 0 && !attributes.directory && !attributes.symlink && !parsed.quiet) {
      await conversionWarnings.set(name, `\tzip warning: ${live ? await convertedNames.has(name) ? "-ll used on binary file - corrupted?" : "has binary so -ll ignored" : bytes === originalBytes ? "has binary so -ll ignored" : "-ll used on binary file - corrupted?"}\n`);
    }
    if (parsed.descriptors || source === "-") entry.descriptors = true;
    if (parsed.zip64 === false) entry.zip64 = false;
    if (parsed.zip64 === true || parsed.zip64 === undefined && source === "-") entry.zip64 = true;
    const prior = await old.get(name);
    if (prior?.comment) entry = { ...entry, comment: prior.comment };
    if (parsed.metadata !== "default") entry = updateZipExtras(entry, prior, parsed.metadata, limits);
    if ((entry.compressedSize ?? entry.data.length) > limits.maxArchiveBytes - compressedBytes) fail("archive byte limit exceeded");
    compressedBytes += entry.compressedSize ?? entry.data.length;
    if (await dosConvertedNames.has(name)) {
      entry = { ...entry, mode: attributes.directory ? 0o040755 : 0o100644, versionMadeBy: 30, externalAttributes: attributes.directory ? 16 : 0, flags: (entry.flags ?? 0) & ~0x800 | (prior?.comment?.some(byte => byte >= 128) ? (prior.flags ?? 0) & 0x800 : 0) };
    }
    if (parsed.encryption && !entry.directory) entry.encryption = parsed.encryption;
    entry.selectedSource = source;
    await selected.set(name, { entry, source, sourceSize });
    if (parsed.entryComments) await commentNames.set(name, true);
  };
  const visit = async (source: string, name: string, depth: number, storedName = false): Promise<void> => {
    context.signal.throwIfAborted();
    if (++visits > limits.maxMembers) fail("traversal member limit exceeded");
    if (++work > limits.maxPatternSteps) fail("archive work limit exceeded");
    if (visits % 128 === 0) await yieldTurn(context.signal);
    if (depth > limits.maxDepth) fail("archive recursion depth limit exceeded");
    if (source === "-") {
      const previous = await selected.get(name) ?? await listed.get(name);
      if (previous && previous.source !== source) throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
      if (previous || !await filterName(name, selection, parsed.includes.length)) return;
      const prior = await old.get(name);
      const modified = new Date();
      if (parsed.entryComments && prior) await commentNames.set(name, true);
      if (!zipDateMatches(modified, parsed.fromDate, parsed.beforeDate)) return;
      if (parsed.filesync) {
        if (await synchronized.has(name) && await synchronized.get(name) !== source) throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
        await synchronized.set(name, source);
      }
      if (parsed.action === "freshen" && !prior || prior && (parsed.action === "update" || parsed.action === "freshen") && Math.floor(modified.getTime() / 1000) <= Math.floor(prior.modified.getTime() / 1000)) return;
      if (parsed.showFiles !== undefined) {
        await budget.member(0);
        await listed.set(name, { name, size: 0, source });
        return;
      }
      const live = true;
      const bytes = live ? scope.stdin : await collectBytes(scope.stdin, { ...(Number.isFinite(Math.min(limits.maxEntryBytes, limits.maxTotalBytes - budget.totalBytes)) ? { maxBytes: Math.min(limits.maxEntryBytes, limits.maxTotalBytes - budget.totalBytes) } : {}), signal: context.signal });
      await budget.member(bytes instanceof Uint8Array ? bytes.length : 0);
      await encodeSelected(source, name, bytes, { modified, mode: 0o010660, directory: false, symlink: false });
      return;
    }
    const path = vfsPath(context.cwd, source);
    checkPath(path, limits);
    let canonical: string;
    let stat: FileStat;
    try {
      ({ canonical, stat } = await inspectSource(scope, path, parsed.storeLinks));
    } catch (error) {
      context.signal.throwIfAborted();
      if (typeof error !== "object" || error === null || !("code" in error)) throw error;
      if (parsed.mustMatch && error.code === "EACCES") throw new ZipFailure(18, "File not found or no read permission", source);
      if (error.code !== "ENOENT") throw error;
      if (!storedName) {
        const operandName = memberName(source, limits);
        const pattern = new Selection([parsed.junkPaths ? operandName.slice(operandName.lastIndexOf("/") + 1) : operandName], limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories });
        let matched = false;
        for await (const entry of archive.entries) {
          if (await pattern.matches(entry.name, true)) {
            matched = true;
            await visit(entry.name, entry.name, depth, true);
          }
        }
        if (matched) return;
      }
      if (parsed.entryComments && await old.has(name) && await filterName(name, selection, parsed.includes.length)) await commentNames.set(name, true);
      if (parsed.mustMatch && !storedName) {
        if (!parsed.quiet) await budget.output(`\tzip warning: name not matched: ${zipPublicText(source)}\n`);
        throw new ZipFailure(18, "File not found or no read permission", source);
      }
      if (!parsed.quiet && !storedName) await budget.output(`\tzip warning: name not matched: ${zipPublicText(source)}\n`);
      return;
    }
    checkPath(canonical, limits);
    if (canonical === output || canonical === input || (existing && sameIdentity(existing, stat)) || (publication?.existing && sameIdentity(publication.existing, stat))) return;
    const symlink = parsed.storeLinks && stat.type === "symlink";
    const fifoSource = (stat.mode & 0o170000) === 0o010000;
    if (fifoSource && !parsed.fifo || stat.type !== "file" && stat.type !== "directory" && !symlink && !fifoSource) {
      if (!parsed.quiet) await budget.output(`\tzip warning: ignoring special file: ${zipPublicText(source)}\n`);
      return;
    }
    const directory = stat.type === "directory";
    if ((existing || publication?.existing) && !directory && !hasIdentity(stat)) fail("cannot exclude archive aliases when source backing identity is unknown");
    if (directory && name && !name.endsWith("/")) name += "/";
    const dateIncluded = zipDateMatches(new Date(stat.mtimeMs), parsed.fromDate, parsed.beforeDate);
    const nameIncluded = (dateIncluded || parsed.entryComments) && await filterName(name, selection, parsed.includes.length) && (!recursiveSelection || await recursiveSelection.matches(name, true));
    const included = dateIncluded && nameIncluded;
    if (logStat && included && (!hasIdentity(stat) || sameIdentity(logStat, stat))) {
      if (log) log.failed = true;
      throw new ZipFailure(16, "Invalid command arguments", "ZIP log may not alias a selected source");
    }
    const sourceName = name;
    if (parsed.junkPaths && !storedName) name = directory ? "" : name.slice(name.lastIndexOf("/") + 1);
    if (parsed.dosNames && !storedName && name && included) {
      name = zipDosName(name);
      if (!name || (directory ? name.slice(0, -1) : name).split("/").some(component => !component)) throw new ZipFailure(16, "Invalid command arguments", "DOS conversion produces an empty component");
      await dosConvertedNames.set(name, true);
    }
    const prior = await old.get(name);
    if (parsed.entryComments && prior && nameIncluded) await commentNames.set(name, true);
    if ((parsed.filesync || parsed.difference) && name && included && !(directory && parsed.omitDirectories)) {
      if (await synchronized.has(name) && await synchronized.get(name) !== source) throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
      await synchronized.set(name, source);
    }
    const current = !fifoSource && (parsed.filesync || parsed.difference) && prior && prior.size === (directory ? 0 : stat.size)
      && Math.ceil(Math.floor(stat.mtimeMs / 1000) / 2) === Math.ceil(Math.floor(prior.modified.getTime() / 1000) / 2);
    const eligible = parsed.action !== "update" && parsed.action !== "freshen"
      || (prior ? Math.floor(stat.mtimeMs / 1000) > Math.floor(prior.modified.getTime() / 1000) : parsed.action === "update");
    if (parsed.showFiles === undefined && parsed.move && (!parsed.difference || !current && eligible) && name && included && !(directory && parsed.omitDirectories) && (prior || parsed.action !== "freshen")) {
      if (!await moves.has(path)) await moves.set(path, await inspectZipMoveSource(scope, path, source));
    }
    if (name && included && eligible && (!current || parsed.showFiles !== undefined) && !(directory && parsed.omitDirectories)) {
      checkPath(name, limits);
      const previous = await selected.get(name) ?? await listed.get(name);
      if (previous && previous.source !== source) {
        if (!parsed.quiet) await budget.output(`\tzip warning:   first full name: ${zipPublicText(previous.source)}\n                      second full name: ${zipPublicText(source)}\n                     name in zip file repeated: ${zipPublicText(name)}\n`);
        throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
      }
      if (!previous) {
        if (fifoSource && parsed.move) fail("FIFO move is unsupported: producer streams have no removable file snapshot");
        await budget.member(directory || fifoSource ? 0 : stat.size);
        if (parsed.showFiles !== undefined) {
          await listed.set(name, { name, size: directory ? 0 : stat.size, source });
        } else {
          if (fifoSource) {
            const input = (async function* (): ByteSource {
              let size = 0;
              for await (const chunk of scope.input(path, true)) {
                if (chunk.length > Math.min(limits.maxEntryBytes, limits.maxTotalBytes - budget.totalBytes) - size) fail("input byte limit exceeded");
                size += chunk.length;
                yield chunk;
              }
              const current = await inspectSource(scope, path, parsed.storeLinks);
              if (current.canonical !== canonical || !unchanged(stat, current.stat)) fail(`source changed while reading: ${source}`);
              budget.totalBytes += size;
            })();
            await encodeSelected(source, name, input, { modified: new Date(stat.mtimeMs), mode: 0o100644, directory: false, symlink: false }, undefined, stat, canonical, true);
            return;
          }
          if (!directory && !symlink) {
            const input = (async function* (): ByteSource {
              try { yield* scope.input(path, false, stat); }
              catch (error) {
                context.signal.throwIfAborted();
                if (parsed.mustMatch && typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "EACCES")) throw new ZipFailure(18, "File not found or no read permission", `was zipping ${source}`);
                throw error;
              }
              const current = await inspectSource(scope, path, parsed.storeLinks);
              if (current.canonical !== canonical || !unchanged(stat, current.stat)) fail(`source changed while reading: ${source}`);
            })();
            await encodeSelected(source, name, input, { modified: new Date(stat.mtimeMs), mode: stat.mode, directory, symlink }, stat.size, stat, canonical);
            return;
          }
          let bytes: Uint8Array;
          if (directory) bytes = new Uint8Array();
          else if (symlink) {
            if (!context.fs.readlink) fail("filesystem does not support reading symbolic links");
            const target = await scope.operation(() => context.fs.readlink!(path, { signal: context.signal }));
            if (byteLength(target) > stat.size) fail(`source changed while reading: ${source}`);
            bytes = encodeBytes(target);
          } else {
            try { bytes = await collectBytes(scope.input(path, false, stat), { maxBytes: stat.size, signal: context.signal }); }
            catch (error) {
              context.signal.throwIfAborted();
              if (parsed.mustMatch && typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "EACCES")) throw new ZipFailure(18, "File not found or no read permission", `was zipping ${source}`);
              throw error;
            }
          }
          if (!directory && bytes.length !== stat.size) fail(`source changed while reading: ${source}`);
          const current = await inspectSource(scope, path, parsed.storeLinks);
          if (current.canonical !== canonical || !unchanged(stat, current.stat)) fail(`source changed while reading: ${source}`);
          await encodeSelected(source, name, bytes, { modified: new Date(stat.mtimeMs), mode: stat.mode, directory, symlink });
        }
      }
    }
    if (directory && !storedName && (parsed.recursive || parsed.recursivePatterns)) {
      if (ancestors.some(ancestor => ancestor.path === canonical || sameIdentity(ancestor.stat, stat))) fail(`directory cycle while archiving: ${source}`);
      ancestors.push({ path: canonical, stat });
      try {
        let children: Iterable<{ name: string }> | AsyncIterable<{ name: string }>;
        let ordered: ZipStateMap<{ name: string }> | undefined;
        if (scratch && context.fs.iterateDirectory) {
          await scratch.initialize();
          ordered = stateMap<{ name: string }>();
          const iterator = context.fs.iterateDirectory(path, { signal: context.signal })[Symbol.asyncIterator]();
          let count = 0;
          try {
            for (;;) {
              const next = await scope.operation(() => iterator.next());
              if (next.done) break;
              const child = next.value;
              if (scratch.ownsPath(`${canonical === "/" ? "" : canonical}/${child.name}`)) continue;
              if (++count > limits.maxMembers - visits) fail("traversal member limit exceeded");
              await ordered.set(child.name, child);
            }
          } finally { await iterator.return?.(); }
          children = { async *[Symbol.asyncIterator]() { for await (const [, child] of ordered!.sortedEntries()) yield child; } };
        } else {
          const listed = await scope.operation(() => context.fs.readdir(path, { signal: context.signal, ...(Number.isFinite(limits.maxMembers) ? { maxEntries: limits.maxMembers - visits } : {}) }));
          if (listed.length > limits.maxMembers - visits) fail("traversal member limit exceeded");
          children = listed;
        }
        try {
          for await (const child of children) {
            if (scratch?.ownsPath(`${canonical === "/" ? "" : canonical}/${child.name}`)) continue;
            if (!child.name || child.name === "." || child.name === ".." || child.name.includes("/") || child.name.includes("\0")) fail("invalid filesystem directory entry");
            const prefix = source === "." ? "" : source.endsWith("/") ? source : `${source}/`;
            await visit(`${prefix}${child.name}`, `${sourceName}${child.name}`, depth + 1);
          }
        } finally { await ordered?.close(); }
      } finally { ancestors.pop(); }
    }
  };
  const editComment = parsed.archiveComment && parsed.action !== "delete" && parsed.action !== "copy";
  const editEntries = parsed.entryComments && parsed.action !== "delete" && parsed.action !== "copy";
  if ((parsed.archiveComment || parsed.entryComments || parsed.move) && parsed.action === "copy" && !parsed.quiet) await budget.output("\tzip warning: can't set method, move, recurse, or comments with copy mode.\n");
  if (parsed.action === "copy") {
    const operands = new Selection(parsed.operands, limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories });
    for await (const entry of archive.entries) {
      if (await operands.matches(entry.name) && await filterName(entry.name, selection, parsed.includes.length) && zipDateMatches(entry.modified, parsed.fromDate, parsed.beforeDate)) {
        await budget.member(entry.size);
        await selected.set(entry.name, { entry, source: entry.name, sourceSize: entry.size });
      }
    }
  } else if (parsed.action === "delete") {
    if (!parsed.quiet && (parsed.recursive || parsed.archiveComment || parsed.entryComments || parsed.move)) await budget.output("\tzip warning: invalid option(s) used with -d; ignored.\n");
    if (!parsed.quiet && !archive.entries.length) await budget.output(`\tzip warning: ${zipPublicText(parsed.archive)} not found or empty\n`);
    const operands = new Selection(parsed.recursivePatterns ? [] : parsed.operands, limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories });
    if (parsed.operands.length && !parsed.recursivePatterns) {
      for await (const entry of archive.entries) {
        if (await operands.matches(entry.name) && await filterName(entry.name, selection, parsed.includes.length) && zipDateMatches(entry.modified, parsed.fromDate, parsed.beforeDate)) await deleted.set(entry.name, true);
      }
    }
    if (parsed.mustMatch && !parsed.recursivePatterns) {
      for (const [index, operand] of parsed.operands.entries()) {
        if (!operands.matched.has(index)) throw new ZipFailure(18, "File not found or no read permission", operand);
      }
    }
    if (!parsed.quiet) {
      for (const [index, operand] of parsed.operands.entries()) {
        if (!operands.matched.has(index)) await budget.output(`\tzip warning: name not matched: ${zipPublicText(operand)}\n`);
      }
    }
  } else {
    if (parsed.recursivePatterns) await visit(".", "", 0);
    else if (parsed.showFiles !== undefined && !parsed.operands.length) { /* Listing existing entries does not traverse sources. */ }
    else if (parsed.operands.length || parsed.action === "add") {
      for (const operand of parsed.operands) await visit(operand, memberName(operand, limits), 0);
    } else for await (const entry of archive.entries) await visit(entry.name, memberName(entry.name, limits), 0);
  }
  if (payloadSpool) payloadSource = await payloadSpool.finish();
  if (!publication || !(parsed.split ?? inputSplit)) await log?.start();
  if (parsed.showFiles !== undefined) {
    const contains = !parsed.operands.length && !parsed.includes.length && !parsed.excludes.length;
    const listing = (async function* (): AsyncIterable<{name: string; size: number}> {
      if (contains || parsed.action === "delete") {
        for await (const entry of archive.entries) if (contains || await deleted.has(entry.name)) yield entry;
      } else if (parsed.action === "copy") {
        for await (const value of selected.values()) yield value.entry;
      } else yield* listed.values();
    })();
    const title = contains ? "Archive contains" : parsed.action === "delete" ? "Would Delete" : parsed.action === "freshen" ? "Would Freshen" : parsed.action === "copy" ? "Would Copy" : "Would Add/Update";
    if (!parsed.quiet && parsed.showFiles) await budget.output(`${title}:\n`);
    let count = 0, size = 0;
    for await (const entry of listing) {
      count++; size += entry.size;
      if (!parsed.quiet && parsed.showFiles) await budget.output(`  ${escapeText(zipPublicText(entry.name), "display")}\n`);
    }
    await budget.output(`Total ${count} entries (${size} bytes)\n`);
    return { kind: "current" as const, exitCode: 0, moveBacking, moves: [] };
  }
  if (parsed.filesync) {
    if (!synchronized.size) throw new ZipFailure(12, "Nothing to do!", parsed.archive);
    for await (const entry of archive.entries) if (!await synchronized.has(entry.name)) await deleted.set(entry.name, true);
    if (!selected.size && !deleted.size) {
      if (!parsed.quiet) await budget.output("Archive is current\n");
      if (!parsed.latestTime) return { kind: "current" as const, exitCode: 0, moveBacking, moves: moves.values() };
    }
  }
  const changed = selected.size > 0 || deleted.size > 0;
  const testRequired = parsed.test && !(parsed.filesync && !changed);
  let exitCode = 0;
  if (!parsed.difference && !selected.size && !((editComment || editEntries || parsed.junkSfx || parsed.test) && archive.entries.length) && (parsed.action === "freshen" || parsed.action === "update" && (existing || !parsed.includes.length))) {
    if (!parsed.latestTime || !archive.entries.length) return moves.size ? { kind: "current" as const, exitCode: 12, moveBacking, moves: moves.values() } : undefined;
    exitCode = 12;
  }
  if (parsed.latestTime && !changed && !archive.entries.length && parsed.archive !== "-") throw new ZipFailure(13, "Missing or empty zip file", parsed.archive);
  if (!parsed.difference && !selected.size && !deleted.size && !((editComment || editEntries || parsed.junkSfx || parsed.latestTime || parsed.test) && archive.entries.length) && (parsed.action === "delete" || parsed.action === "copy" || parsed.recursivePatterns || parsed.fromDate !== undefined || parsed.beforeDate !== undefined || !parsed.includes.length)) {
    const detail = parsed.action !== "delete" && parsed.recursive && parsed.firstOperand >= 0
      ? `try: zip ${parsed.args.slice(0, parsed.firstOperand).join(" ")} . -i ${parsed.args.slice(parsed.firstOperand).join(" ")}`
      : parsed.archive;
    throw new ZipFailure(12, "Nothing to do!", detail);
  }
  const entries = new ZipStateList(stateMap<ZipEntry>());
  const progress = new ZipStateList(stateMap<string>());
  let progressBytes = 0;
  let progressRead = 0;
  const flushProgress = async () => {
    while (progressRead < progress.length) await budget.output(await progress.get(progressRead++));
    progressBytes = 0;
  };
  const queue = async (message: string) => {
    if (parsed.quiet) return;
    const size = byteLength(message);
    if (size > limits.maxTextBytes - budget.textBytes - progressBytes) fail("text output limit exceeded");
    progressBytes += size;
    await progress.push(message);
  };
  let countedLength = 0, remainingBytes = 0;
  if (parsed.action === "delete") {
    for await (const entry of archive.entries) if (await deleted.has(entry.name)) { countedLength++; remainingBytes += entry.compressedSize ?? entry.data.length; }
  } else for await (const {entry, sourceSize} of selected.values()) {
    countedLength++; remainingBytes += parsed.action === "copy" ? entry.compressedSize ?? entry.data.length : sourceSize;
  }
  let doneBytes = 0;
  let done = 0;
  const stats = async (entry: ZipEntry) => {
    let prefix = parsed.displayVolume ? "1>1: " : "";
    if (parsed.displayCounts) prefix += `${String(done).padStart(3)}/${String(countedLength - done).padStart(3)} `;
    if (parsed.displayBytes) prefix += `[${zipDisplaySize(doneBytes).padStart(4)}/${zipDisplaySize(remainingBytes).padStart(4)}] `;
    const size = parsed.action === "delete" || parsed.action === "copy" ? entry.compressedSize ?? entry.data.length : (await selected.get(entry.name))?.sourceSize ?? entry.size;
    done++;
    doneBytes += size;
    remainingBytes -= size;
    return prefix;
  };
  const append = async (entry: ZipEntry, update: boolean) => {
    if (parsed.quiet) return;
    const compressedSize = entry.compressedSize ?? entry.data.length;
    const percentage = entry.size ? Math.trunc((Math.trunc(200 * (entry.size - compressedSize) / entry.size) + 1) / 2) : 0;
    const prefix = await stats(entry);
    const usize = parsed.displayUsize ? ` (${zipDisplaySize((await selected.get(entry.name))?.sourceSize ?? entry.size)})` : "";
    const verbose = parsed.verbose ? `${entry.method === 0 ? "" : " "}\t(in=${entry.size}) (out=${compressedSize})` : "";
    const dotCount = !parsed.globalDots && parsed.dotSize ? Math.floor(entry.size / parsed.dotSize) : 0;
    if (dotCount > limits.maxTextBytes - budget.textBytes - progressBytes) fail("text output limit exceeded");
    const dots = ".".repeat(dotCount);
    if (entry.source && parsed.fromCrlf && entry.size > 0 && entry.method !== 0 && entry.internalAttributes === 0) await conversionWarnings.set(entry.name, `\tzip warning: ${await convertedNames.has(entry.name) ? "-ll used on binary file - corrupted?" : "has binary so -ll ignored"}\n`);
    const warning = await conversionWarnings.get(entry.name);
    await queue(`${prefix}${update ? parsed.action === "freshen" ? "freshening:" : "updating:" : "  adding:"} ${escapeText(zipPublicText(entry.name), "display")}${usize}${verbose}${warning ? `\n${warning}` : ""} ${dots ? `${dots} ` : ""}(${entry.method === 14 ? `lzma ${percentage}%` : entry.method === 12 ? `bzipped ${percentage}%` : entry.method === 8 ? `deflated ${percentage}%` : "stored 0%"})\n`);
  };
  const pendingProgress = stateMap<boolean>();
  let growReplaced = false;
  for await (const entry of archive.entries) {
    if (++work > limits.maxPatternSteps) fail("archive work limit exceeded");
    if (await deleted.has(entry.name)) { await queue(`${await stats(entry)}deleting: ${escapeText(zipPublicText(entry.name), "display")}\n`); continue; }
    const replacement = await selected.get(entry.name);
    if (parsed.action === "copy") {
      if (replacement) { growReplaced = true; await entries.push(replacement.entry); await queue(`${await stats(entry)} copying: ${escapeText(zipPublicText(entry.name), "display")}\n`); await selected.delete(entry.name); }
      continue;
    }
    if (replacement) { growReplaced = true; await entries.push(replacement.entry); if (replacement.entry.source) await pendingProgress.set(replacement.entry.name, true); else await append(replacement.entry, true); await selected.delete(entry.name); }
    else if (!parsed.difference) { await budget.member(entry.size); await entries.push(entry); }
  }
  if (parsed.grow && (parsed.zip64 !== undefined || deleted.size || growReplaced)) {
    for (let index = 0; index < entries.length; index++) {
      const entry = await entries.get(index);
      zipGrowRecords.delete(entry);
      delete entry.growStart; delete entry.growLength; delete entry.growVersion;
      if (parsed.zip64 === false) entry.zip64 = false;
      await entries.set(index, entry);
    }
  }
  for await (const { entry } of selected.values()) { await entries.push(entry); if (entry.source) await pendingProgress.set(entry.name, false); else await append(entry, false); }
  const summary = async () => {
    if (!parsed.verbose || parsed.quiet) return;
    let size = 0, compressed = 0;
    for await (const entry of entries) { size += entry.size; compressed += entry.compressedSize ?? entry.data.length; }
    await queue(`total bytes=${size}, compressed=${compressed} -> ${size ? Math.round(100 * (size - compressed) / size) : 0}% savings\n`);
  };
  let pendingFinished = false;
  const finishProgress = async () => {
    if (!pendingProgress.size || pendingFinished) return;
    for await (const entry of entries) if (await pendingProgress.has(entry.name)) await append(entry, (await pendingProgress.get(entry.name))!);
    pendingFinished = true;
    await summary();
  };
  if (!pendingProgress.size) await summary();
  if (!entries.length) await queue("\tzip warning: zip file empty\n");
  let comment = archive.comment;
  if (editComment || editEntries && commentNames.size) {
    await flushProgress();
    const commentInput = new ZipCommentInput(scope.stdin, limits, context.signal);
    if (editEntries) {
      for (let index = 0; index < entries.length; index++) {
        const entry = await entries.get(index);
        if (!await commentNames.has(entry.name)) continue;
        if (!parsed.quiet) await budget.output(`Enter comment for ${zipPublicText(entry.name)}:\n`);
        const line = await commentInput.readLine();
        if (line !== undefined) await entries.set(index, setZipEntryComment(entry, line.at(-1) === 10 ? line.subarray(0, -1) : line, limits));
      }
    }
    if (editComment && !parsed.quiet) {
      if (comment.length) {
        await budget.output("current zip file comment is:\n");
        await budget.output(comment);
        if (comment.at(-1) !== 10) await budget.output("\n");
      }
      await budget.output("enter new zip file comment (end with .):\n");
    }
    if (editComment) comment = await readZipComment(commentInput, limits, context.signal);
  }
  const outputArchive = async () => {
    const onEntry = async (index: number, entry: ZipEntry) => { await entries.set(index, entry); };
    if (scratch) return { entries, comment, onEntry };
    const buffered: ZipEntry[] = [];
    for await (const entry of entries) buffered.push(entry);
    return { entries: buffered, comment, onEntry };
  };
  if (!publication) return { kind: "stream" as const, temporary, archive: await outputArchive(), scratch, progress, finishProgress, flushProgress, moveBacking, moves: moves.values() };
  let latestWarning: string | undefined;
  if (parsed.latestTime) {
    const mtimeMs = await zipLatestTime(entries, context.signal);
    if (mtimeMs === undefined) latestWarning = entries.length
      ? "\tzip warning: zip file has only directories, can't make it as old as latest entry\n"
      : "\tzip warning: zip file is empty, can't make it as old as latest entry\n";
    else publication = { ...publication, mtimeMs };
  }
  if (!changed && existing && input && !editComment && !editEntries && !parsed.junkSfx && !parsed.difference && (parsed.output === undefined || parsed.action === "copy" && parsed.test) && (latestWarning !== undefined || parsed.test && !parsed.latestTime)) {
    if (testRequired) await testZipCommand(scope, parsed.testCommand, input, budget, parsed.archive, parsed.quiet, parsed.password);
    if (latestWarning !== undefined) await queue(latestWarning);
    await flushProgress();
    return { kind: "current" as const, exitCode, moveBacking, moves: moves.values() };
  }
  const sourcePaths = new ZipStateList(stateMap<string>());
  if ((parsed.split ?? inputSplit) && parsed.action !== "copy" && parsed.action !== "delete") for await (const entry of entries) {
    const source = (entry as StoredEntry).selectedSource;
    if (source === undefined || source === "-") continue;
    const path = vfsPath(context.cwd, source);
    if (entry.symlink) {
      const parent = await scope.operation(() => context.fs.realpath(dirname(path), { signal: context.signal }));
      await sourcePaths.push(`${parent === "/" ? "" : parent}/${path.slice(path.lastIndexOf("/") + 1)}`);
    } else await sourcePaths.push(await scope.operation(() => context.fs.realpath(path, { signal: context.signal })));
  }
  const publicationInputs = { async *[Symbol.asyncIterator]() { yield* inputPaths; yield* sourcePaths; } };
  if ((publication.existing?.nlink ?? 1) <= 1 || (await scope.operation(() => context.fs.capabilitiesFor?.(publication.output, { signal: context.signal }) ?? context.fs.capabilities)).atomicStagedFileMutation === true) {
    if (latestWarning !== undefined) await queue(latestWarning);
    return { kind: "staged-stream" as const, inputSplit, inputPaths: publicationInputs, publication: { ...publication, ...(testRequired ? { validate: async (path: string) => { await finishProgress(); await flushProgress(); await testZipCommand(scope, parsed.testCommand, path, budget, parsed.archive, parsed.quiet, parsed.password); } } : {}) }, archive: await outputArchive(), scratch, progress, finishProgress, flushProgress, exitCode, moveBacking, moves: moves.values() };
  }
  const bytes = await collectBytes(streamZipArchive(await outputArchive(), limits, context.signal, false, parsed.zip64 === true, parsed.zip64 !== false, scratch), { maxBytes: limits.maxArchiveBytes, signal: context.signal });
  if (testRequired && parsed.archive !== "-") {
    await flushProgress();
  }
  if (latestWarning !== undefined) await queue(latestWarning);
  return { kind: "file" as const, inputSplit, inputPaths: publicationInputs, testRequired, publication, bytes, progress, flushProgress, exitCode, moveBacking, moves: moves.values() };
}

export function createZipCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const configured = settings(options);
  return { name: "zip", description: "Create or update bounded ZIP archives in the virtual filesystem", execute: withInputByteBudget(async (original) => {
    const limits = invocationLimits(configured, original);
    original.signal.throwIfAborted();
    const scope = new ZipScope(original, limits);
    const context = scope.context;
    let budget = new Budget(context, limits);
    let log: ZipLog | undefined;
    try {
      let parsed = await parse(scope, limits, options.zip);
      if ("information" in parsed) {
        if (parsed.debug) await budget.output("sd: Command line read\n");
        if (parsed.information === "command") {
          await budget.output("command line:\n");
          let redactNext = false;
          for (const argument of parsed.command ?? []) {
            const value = zipPublicText(redactNext ? "[redacted]" : argument);
            redactNext = zipPasswordArgument(argument) === "separate";
            const escaped = escapeText(value, "display", size => { if (size > limits.maxTextBytes - budget.textBytes) fail("text output limit exceeded"); }).split("'").join("'\\''");
            await budget.output(`'${escaped}'  `);
          }
          await budget.output("\n\nzip error: Interrupted (show command line)\n");
          return { exitCode: 9 };
        }
        if (parsed.information === "options") {
          await budget.output("available options:\nVirtual implementation; unsupported native options are omitted.\n sh  long                 val  neg\n");
          for (const [name, short] of Object.entries(zipLongOptions)) {
            const value = ["i", "x"].includes(short) ? "list" : ["s", "P", "n", "Z", "t", "tt", "O", "ds", "b", "lf", "TT"].includes(short) ? "req" : "";
            await budget.output(` ${(short === "version" ? "" : short).padEnd(3)} ${name.padEnd(20)} ${value.padEnd(4)} ${zipNegatableOptions.has(short) ? "neg" : ""}\n`);
          }
        } else await budget.output(parsed.information === "more-help" ? zipExtendedHelp : parsed.information === "version" ? zipVersion : parsed.information === "license" ? zipLicense : zipHelp);
        return { exitCode: 0 };
      }
      if (parsed.logPath !== undefined) {
        log = new ZipLog(scope, parsed.logInfo);
        await log.open(parsed.logPath, parsed.logAppend, [parsed.archive, parsed.output, ...(parsed.action === "copy" || parsed.action === "delete" ? [] : parsed.operands)].filter((path): path is string => path !== undefined));
      }
      const quietDisplay = parsed.quiet;
      if (log && quietDisplay) parsed = { ...parsed, quiet: false };
      const progressContext = log ? { ...context, stdout: log.sink(context.stdout, quietDisplay), stderr: log.sink(context.stderr, quietDisplay) } : context;
      budget = new Budget(parsed.archive === "-" ? { ...progressContext, stdout: log ? log.sink(context.stderr, quietDisplay) : context.stderr } : progressContext, limits);
      if (parsed.encrypt) {
        if (parsed.password === undefined) parsed.password = await scope.operation(() => readZipPassword(options.zipHost, limits.maxArgumentBytes, context.signal, true));
        if (log) log.password = parsed.password;
        parsed.encryption = { ...(parsed.aes ? { aes: parsed.aes } : {}), password: parsed.password, entropy: (length, signal) => scope.operation(() => {
          if (!options.zipHost?.entropy) throw new ZipHostFailure("entropy");
          return options.zipHost.entropy(length, signal);
        }) };
      }

      if (parsed.debug) await budget.output("sd: Command line read\nsd: Reading virtual archive and selecting files\n");
      if (parsed.split && parsed.splitPause && !options.zipHost?.volumePrompt) throw new ZipFailure(16, "Invalid command arguments", "split pause requires an explicit volume prompt capability");
      const prepared = await prepare(scope, parsed, budget, log, options.zipHost);
      if (!prepared) return { exitCode: 12 };
      if (prepared.kind === "current") {
        await removeZipSources(scope, prepared.moves, budget, parsed.quiet, prepared.moveBacking);
        return { exitCode: prepared.exitCode };
      }
      if (parsed.debug) await budget.output("sd: Writing virtual archive\n");
      let globalBytes = 0;
      const dots = async (size: number) => {
        if (!parsed.globalDots || !parsed.dotSize) return;
        if (!globalBytes) await budget.output(" ");
        const count = Math.floor((globalBytes + size) / parsed.dotSize) - Math.floor(globalBytes / parsed.dotSize);
        globalBytes += size;
        for (let index = 0; index < count; index++) await budget.output(".");
      };
      if (prepared.kind === "file") {
        const publication = prepared.publication;
        if (!publication) fail("ZIP missing file publication");
        await dots(prepared.bytes.length);
        const split = parsed.split ?? prepared.inputSplit;
        if (split) {
          if (parsed.splitPause && !options.zipHost?.volumePrompt) throw new ZipFailure(16, "Invalid command arguments", "split pause requires an explicit volume prompt capability");
          const parts = await splitZipVolumes(prepared.bytes, split, limits, context.signal);
          await log?.protect(parts.map((_, disk) => volumeName(publication.output, disk, parts.length)));
          await log?.start();
          if (prepared.testRequired) {
            await scope.operation(() => stageZip(scope, { ...publication, bytes: prepared.bytes, reservedPath: publication.output }, staging => testZipCommand(scope, parsed.testCommand, staging.file.path, budget!, parsed.archive, parsed.quiet, parsed.password)));
          }
          await scope.operation(() => publishZipVolumes(scope, publication, parts, prepared.inputPaths, async (path, disk) => {
            if (parsed.splitVerbose) await budget!.output(`split ${disk + 1}/${parts.length}: ${zipPublicText(path)} (${parts[disk]!.length} bytes)\n`);
            if (disk && parsed.splitPause) {
              if (parsed.splitBell) await budget!.output("\u0007");
              if (!await scope.operation(() => options.zipHost!.volumePrompt!({ path, disk, disks: parts.length, signal: context.signal }))) fail("ZIP split volume prompt cancelled");
            }
          }));
        } else await writeFileOutput(context, prepared.bytes, () => scope.operation(() => publishZip(scope, { ...publication, bytes: prepared.bytes, ...(prepared.testRequired ? { validate: (path: string) => testZipCommand(scope, parsed.testCommand, path, budget, parsed.archive, parsed.quiet, parsed.password) } : {}) })));
        await prepared.flushProgress();
      } else if (prepared.kind === "staged-stream" || prepared.kind === "staged-source") {
        const source = (async function* (): ByteSource {
          for await (const chunk of prepared.kind === "staged-source" ? prepared.source : streamZipArchive(prepared.archive, limits, context.signal, false, parsed.zip64 === true, parsed.zip64 !== false, prepared.scratch)) {
            yield chunk;
            try { await dots(chunk.length); }
            catch (error) { void scope.closeInputs().catch(() => {}); throw error; }
          }
          if (prepared.kind === "staged-stream") await prepared.finishProgress();
        })();
        const split = parsed.split ?? prepared.inputSplit;
        if (split) {
          await scope.operation(() => stageZip(scope, { ...prepared.publication, source, reservedPath: prepared.publication.output }, async staging => {
            if (prepared.publication.validate) await prepared.publication.validate(staging.file.path);
            const retained = await openZipSource(scope, staging.file.path);
            try {
              const parts = await splitZipRanges(retained.source, split, limits, context.signal, prepared.scratch);
              await publishZipVolumes(scope, prepared.publication, parts, prepared.inputPaths, async (path, disk) => {
                if (parsed.splitVerbose) await budget.output(`split ${disk + 1}/${parts.length}: ${zipPublicText(path)} (${parts[disk]!.length} bytes)\n`);
                if (disk && parsed.splitPause) {
                  if (parsed.splitBell) await budget.output("\u0007");
                  if (!await scope.operation(() => options.zipHost!.volumePrompt!({ path, disk, disks: parts.length, signal: context.signal }))) fail("ZIP split volume prompt cancelled");
                }
              });
            } finally { await retained.close(); }
          }));
        } else await scope.operation(() => publishZip(scope, { ...prepared.publication, source }));
        if (prepared.kind === "staged-stream") await prepared.finishProgress();
        if ("flushProgress" in prepared) await prepared.flushProgress(); else for (const message of prepared.progress) await budget.output(message);
      } else {
        const output = createOutputOperation(context, context.stdout);
        try {
          const source = streamZipArchive(prepared.archive, limits, output.signal, !prepared.temporary || parsed.descriptors, parsed.zip64 === true, parsed.zip64 !== false, prepared.scratch);
          const emit = async (input: ByteSource) => {
            for await (const chunk of input) {
              try { await writeBytes(output.output, chunk, output.signal); await dots(chunk.length); }
              catch (error) { void scope.closeInputs().catch(() => {}); throw error; }
            }
          };
          if (prepared.temporary) {
            const temporary = prepared.temporary;
            await scope.operation(() => stageZip(scope, { ...temporary, source }, async staging => {
              const current = await scope.operation(() => context.fs.realpath(temporary.name, { signal: context.signal }));
              if (current !== temporary.parent) fail("ZIP temporary path changed before output");
              await emit(scope.input(staging.file.path));
            }));
          } else await emit(source);
        } finally { await output.close(); }
        await prepared.finishProgress();
        await prepared.flushProgress();
      }
      if (parsed.globalDots) await budget.output("\n");
      if (parsed.debug) await budget.output("sd: Virtual archive complete\n");
      await removeZipSources(scope, prepared.moves, budget, parsed.quiet, prepared.moveBacking);
      return { exitCode: prepared.kind === "file" || prepared.kind === "staged-stream" || prepared.kind === "staged-source" ? prepared.exitCode : 0 };
    } catch (error) {
      original.signal.throwIfAborted();
      context.signal.throwIfAborted();
      // Incomplete selection has not proved the log is disjoint from sources.
      // Report to the screen rather than mutating an unvisited source file.
      if (log && !log.started) log.failed = true;
      if (error instanceof ZipHostFailure && (error.code === "password-empty" || error.code === "password-confirm")) {
        await budget.output(`\nzip error: Invalid command arguments (${error.message})\n`);
        return { exitCode: 16 };
      }
      if (error instanceof ZipFailure) {
        const diagnostic = `\nzip error: ${error.label} (${zipPublicText(error.message)})\n`;
        if (log?.failed) await writeBytes(context.stderr, encodeBytes(diagnostic).subarray(0, limits.maxDiagnosticBytes), context.signal);
        else await budget.output(diagnostic);
        return { exitCode: error.status };
      }
      if (log?.failed) budget = new Budget(context, limits);
      const detail = display(publicDiagnosticMessage(error, context.onInternalError).slice(0, 1024));
      const message = escapeText(error instanceof ZipHostFailure ? detail : zipPublicText(detail), "diagnostic");
      await writeBytes(log && !log.failed ? log.sink(context.stderr) : context.stderr, encodeBytes(`zip: ${message}\n`).subarray(0, limits.maxDiagnosticBytes), context.signal);
      return { exitCode: 2 };
    } finally {
      try { await scope.close(); }
      finally { original.signal.throwIfAborted(); }
    }
  }) };
}
