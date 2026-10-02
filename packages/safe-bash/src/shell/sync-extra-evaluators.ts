import { hasYieldCheckpoint, runYieldCheckpoint } from "../contracts/yield.js";
import { ShellSyntaxError } from "./types.js";
import { tryGetMemoryDirectoryEntryNamesSync, tryMkdirMemorySync, tryRmRfMemorySync, tryWriteMemoryFileSync } from "@poe-code/safe-fs/core";
import { tryMatchesPatternSync } from "./pattern.js";
import { byteLocale, cCollation } from "./locale.js";
import { defaultEchoExecutors, printfCommand, tryFastEcho, tryFastPrintf } from "../commands/basic.js";
import { gnuInformationSync } from "../commands/gnu-information.js";
import { executionCommands, evalSyncEnv, evalSyncXargs } from "../commands/execution.js";
import { evalSyncLs, evalSyncReadlink, evalSyncRealpath } from "../commands/filesystem.js";
import { builtInDirectContextExecutors } from "../commands/internal.js";
import { arrayStore, guestArrays } from "./arrays/state.js";
import type { Command, WordPart } from "./parser.js";
import type { CommandDefinition } from "../contracts/index.js";
import { customRegisteredCommands, customRegisteredRegistries, hasActiveExtensions, hasNonNamerefAttributes, hasShellFunction, fastSubScratchArgs, EMPTY_BYTES, syncPurePipelineSlotState } from "./runtime.js";

syncCommandEvaluators.executionCommands = executionCommands;
syncCommandEvaluators.gnuInformationSync = gnuInformationSync;
syncCommandEvaluators.evalSyncEnv = evalSyncEnv;
syncCommandEvaluators.evalSyncXargs = evalSyncXargs;

const evalSyncChecksum = (...args: any[]) => syncCommandEvaluators.evalSyncChecksum?.(...args);
const evalSyncBase32 = (...args: any[]) => syncCommandEvaluators.evalSyncBase32?.(...args);
const evalSyncCsvcut = (...args: any[]) => syncCommandEvaluators.evalSyncCsvcut?.(...args);
const evalSyncCsvgrep = (...args: any[]) => syncCommandEvaluators.evalSyncCsvgrep?.(...args);
const evalSyncGetopt = (...args: any[]) => syncCommandEvaluators.evalSyncGetopt?.(...args);
const evalSyncLineEndings = (...args: any[]) => syncCommandEvaluators.evalSyncLineEndings?.(...args);
const evalSyncIconv = (...args: any[]) => syncCommandEvaluators.evalSyncIconv?.(...args);
const evalSyncHtmlq = (...args: any[]) => syncCommandEvaluators.evalSyncHtmlq?.(...args);
const evalSyncXmllint = (...args: any[]) => syncCommandEvaluators.evalSyncXmllint?.(...args);
const evalSyncMdq = (...args: any[]) => syncCommandEvaluators.evalSyncMdq?.(...args);
const evalSyncShuf = (...args: any[]) => syncCommandEvaluators.evalSyncShuf?.(...args);
const evalSyncHtmlToMarkdown = (...args: any[]) => syncCommandEvaluators.evalSyncHtmlToMarkdown?.(...args);
const evalSyncUnrtf = (...args: any[]) => syncCommandEvaluators.evalSyncUnrtf?.(...args);
const evalSyncPr = (...args: any[]) => syncCommandEvaluators.evalSyncPr?.(...args);
const evalSyncPathchk = (...args: any[]) => syncCommandEvaluators.evalSyncPathchk?.(...args);
const evalSyncFile = (...args: any[]) => syncCommandEvaluators.evalSyncFile?.(...args);
const evalSyncDiff3 = (...args: any[]) => syncCommandEvaluators.evalSyncDiff3?.(...args);
const evalSyncCmp = (...args: any[]) => syncCommandEvaluators.evalSyncCmp?.(...args);
const evalSyncWhich = (...args: any[]) => syncCommandEvaluators.evalSyncWhich?.(...args);
const evalSyncFind = (...args: any[]) => syncCommandEvaluators.evalSyncFind?.(...args);
const evalSyncCompression = (...args: any[]) => syncCommandEvaluators.evalSyncCompression?.(...args);
const evalSyncTar = (...args: any[]) => syncCommandEvaluators.evalSyncTar?.(...args);
const evalSyncUnzip = (...args: any[]) => syncCommandEvaluators.evalSyncUnzip?.(...args);
const evalSyncZip = (...args: any[]) => syncCommandEvaluators.evalSyncZip?.(...args);
const evalSyncDd = (...args: any[]) => syncCommandEvaluators.evalSyncDd?.(...args);
const evalSyncDiff = (...args: any[]) => syncCommandEvaluators.evalSyncDiff?.(...args);
const evalSyncXan = (...args: any[]) => syncCommandEvaluators.evalSyncXan?.(...args);
const evalSyncDate = (...args: any[]) => syncCommandEvaluators.evalSyncDate?.(...args);
const evalSyncPrintenv = (...args: any[]) => syncCommandEvaluators.evalSyncPrintenv?.(...args);
const evalSyncLess = (...args: any[]) => syncCommandEvaluators.evalSyncLess?.(...args);
const evalSyncDf = (...args: any[]) => syncCommandEvaluators.evalSyncDf?.(...args);
const evalSyncDu = (...args: any[]) => syncCommandEvaluators.evalSyncDu?.(...args);
const evalSyncTree = (...args: any[]) => syncCommandEvaluators.evalSyncTree?.(...args);
const evalSyncStat = (...args: any[]) => syncCommandEvaluators.evalSyncStat?.(...args);
const evalSyncFd = (...args: any[]) => syncCommandEvaluators.evalSyncFd?.(...args);
const evalSyncRg = (...args: any[]) => syncCommandEvaluators.evalSyncRg?.(...args);
import { syncPosixRegexSource } from "./sync-posix-regex.js";
import { syncCommandEvaluators } from "../commands/internal.js";
import { compareSyncJqStrings, splitSyncJqExpression } from "./sync-jq-expression.js";
import { text as awkValueText, compare as awkCompare, inputValue as awkInputValue, numeric as awkNumeric, number as awkNumber, string as awkString } from "../commands/text-programs/awk-values.js";
import { shellValueByteLength } from "../contracts/value.js";
import { stateMonitor } from "./arrays/state.js";
import type { State } from "./session-state.js";
import { Runtime } from "./runtime.js";

const createFmtEngine = (...args: any[]) => syncCommandEvaluators.createFmtEngine!(...args);
const parseFmtArguments = (...args: any[]) => syncCommandEvaluators.parseFmtArguments!(...args);
const evalSyncCal = (...args: any[]) => syncCommandEvaluators.evalSyncCal?.(...args);
const evalSyncXq = (...args: any[]) => syncCommandEvaluators.evalSyncXq?.(...args);
const evalSyncYqPrep = (...args: any[]) => syncCommandEvaluators.evalSyncYqPrep?.(...args);
const formatSyncYqYamlLines = (...args: any[]) => syncCommandEvaluators.formatSyncYqYamlLines!(...args);

const fastSharedTextEncoder = new TextEncoder();
const sharedSyncPipeDecoder = new TextDecoder("utf-8", { ignoreBOM: true });

const syncAwkArithAtom = `(?:\\$(?:[0-9]+|NF)|NR|NF|-?[0-9]+(?:\\.[0-9]+)?|[a-zA-Z_][a-zA-Z0-9_]*)`;
const syncAwkArithPat = `(?:${syncAwkArithAtom}(?:\\s*[+*\\/%-]\\s*${syncAwkArithAtom})+)`;
const syncAwkTernaryPat = `(?:(?:\\$(?:[0-9]+|NF)|NR|NF)\\s*(?:==|!=|>=|<=|>|<)\\s*(?:-?[0-9]+(?:\\.[0-9]+)?|"[^"$\\\\]*")\\s*\\?\\s*(?:\\$(?:[0-9]+|NF)|"[^"$\\\\]*"|-?[0-9]+(?:\\.[0-9]+)?)\\s*:\\s*(?:\\$(?:[0-9]+|NF)|"[^"$\\\\]*"|-?[0-9]+(?:\\.[0-9]+)?))`;
const syncAwkItemPat = `(?:${syncAwkTernaryPat}|int\\(\\$(?:[0-9]+|NF)\\)|(?:toupper|tolower)\\(\\$(?:[0-9]+|NF)\\)|substr\\(\\$(?:[0-9]+|NF)\\s*,\\s*[0-9]+(?:\\s*,\\s*[0-9]+)?\\)|index\\(\\$(?:[0-9]+|NF)\\s*,\\s*"[^"$\\\\]*"\\)|${syncAwkArithPat}|\\$(?:[0-9]+|NF)|\\$\\(NF\\s*-\\s*[0-9]+\\)|length(?:\\(\\$(?:[0-9]+|NF)\\))?|NR|NF|[a-zA-Z_][a-zA-Z0-9_]*\\[[1-9][0-9]{0,3}\\]|[a-zA-Z_][a-zA-Z0-9_]*|"[^"$\\\\]*")`;
const syncAwkPrintRe = new RegExp(`^\\{\\s*(?:(g?sub)\\(\\s*\\/(\\^?(?:[a-zA-Z0-9_ :;,=-]|\\[[0-9a-zA-Z_ \\t-]+\\][+*?]?)+\\$?)\\/\\s*,\\s*"([^"\\\\]*)"(?:\\s*,\\s*\\$([0-9]+|NF))?\\s*\\)\\s*;\\s*)?(?:(?:([a-zA-Z_][a-zA-Z0-9_]*)\\s*=\\s*)?split\\(\\s*\\$([0-9]+|NF)\\s*,\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*,\\s*"([^"\\\\])"\\s*\\)\\s*;\\s*)?(?:print(?:\\s+(${syncAwkItemPat}(?:\\s*,?\\s*${syncAwkItemPat})*))?|printf\\s+"([^"$\\\\]*(?:\\\\[nt\\\\"][^"$\\\\]*)*)"\\s*,\\s*(${syncAwkItemPat}(?:\\s*,\\s*${syncAwkItemPat})*))\\s*;?\\s*\\}\\s*$`);
const syncAwkTokenRe = new RegExp(`(${syncAwkTernaryPat})|int\\(\\$([0-9]+|NF)\\)|(toupper|tolower)\\(\\$([0-9]+|NF)\\)|substr\\(\\$([0-9]+|NF)\\s*,\\s*([0-9]+)(?:\\s*,\\s*([0-9]+))?\\)|index\\(\\$([0-9]+|NF)\\s*,\\s*"([^"$\\\\]*)"\\)|(${syncAwkArithPat})|\\$\\(NF\\s*-\\s*([0-9]+)\\)|\\$([0-9]+|NF)|length\\b(?:\\(\\$([0-9]+|NF)\\))?|(NR|NF)\\b|"([^"$\\\\]*)"|([a-zA-Z_][a-zA-Z0-9_]*)\\[([1-9][0-9]{0,3})\\]|([a-zA-Z_][a-zA-Z0-9_]*)|(,)`, "g");

export const syncExtraRuntimeMethods = {
  tryFastPureSubstitution(this: any, part: Extract<WordPart, { kind: "substitution" }>, state: State, rawState: State, io: IO): string | undefined {
    // Cached and pipeline substitutions may contain echo as well as direct calls.
    if (rawState.xpg_echo) return undefined;
    if (!cCollation(rawState.variables.LC_ALL || rawState.variables.LC_COLLATE || rawState.variables.LANG || "C")) return undefined;
    if (this.budget.limits.maxPipelineBytes !== Infinity) return undefined;
    // Synchronous evaluators do not expose cumulative source-read accounting.
    // Use the command context whenever the caller has set an input ceiling.
    if (this.budget.limits.maxInputBytes !== Infinity) return undefined;
    const cachedInv = this._syncLoopInvariantSubMap?.get(part);
    if (cachedInv !== undefined) {
      if (!cachedInv.dynamic) {
        const nextTotalBytes = this.budget.bytes + cachedInv.outBytes;
        if (nextTotalBytes > this.budget.maxOutputBytesSmi && cachedInv.outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
        this.budget.bytes = nextTotalBytes;
        this.budget.tick();
        rawState.substitutionStatus = cachedInv.exitStatus;
        rawState.status = cachedInv.exitStatus;
        return cachedInv.text;
      }
      const cmd = part.script.lists[0]!.pipelines[0]!.commands[0] as Extract<Command, { kind: "simple" }>;
      const w0Plain = cmd.words[0]!.plain!;
      if (w0Plain === "echo" && cmd.words.length === 2) {
        const wVal = this.fastValueWord(cmd.words[1]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof wVal === "string" && !wVal.startsWith("-") && !wVal.includes("\0")) {
          const byteLength = wVal.length + 1;
          const nextBytes = this.budget.bytes + byteLength;
          if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          let end = wVal.length;
          while (end > 0 && wVal.charCodeAt(end - 1) === 10) end--;
          return end === wVal.length ? wVal : wVal.slice(0, end);
        }
      }
      fastSubScratchArgs.length = 0;
      for (let i = 1; i < cmd.words.length; i++) {
        const val = this.fastValueWord(cmd.words[i]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof val !== "string") { fastSubScratchArgs.length = 0; return undefined; }
        fastSubScratchArgs.push(val);
      }
      const formatted = w0Plain === "printf" ? tryFastPrintf(fastSubScratchArgs) : tryFastEcho(fastSubScratchArgs);
      fastSubScratchArgs.length = 0;
      if (formatted !== undefined) {
        const byteLength = formatted.length;
        const nextBytes = this.budget.bytes + byteLength;
        if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
        this.budget.bytes = nextBytes;
        this.budget.tick();
        rawState.substitutionStatus = 0;
        rawState.status = 0;
        let end = formatted.length;
        while (end > 0 && formatted.charCodeAt(end - 1) === 10) end--;
        return end === formatted.length ? formatted : formatted.slice(0, end);
      }
    }
    if (this.middleware.length > 0) return undefined;
    if (rawState.depth >= this.budget.maxSubstitutionDepthSmi && rawState.depth >= this.budget.limits.maxSubstitutionDepth) this.budget.fail("maxSubstitutionDepth");
    this.signal.throwIfAborted();
    const parameterDepth = io.parameterDepth ?? 0;
    if (parameterDepth > 0 && rawState.depth + parameterDepth + 1 > this.budget.limits.maxSyntaxDepth) throw new ShellSyntaxError(`Syntax nesting exceeds ${this.budget.limits.maxSyntaxDepth}`, 0);
    if ( rawState.noexec || hasActiveExtensions(rawState) || rawState.extensions?.checkpoints.length || hasNonNamerefAttributes(rawState) || (guestArrays(state) && (guestArrays(state)!.watches.size > 0 || this.budget.limits.maxExpansionBytes < 65536)) || rawState.redirectAssignments?.size) {
      return undefined;
    }
    if (((this.budget.commands + 1) & 127) === 0) {
      if (hasYieldCheckpoint(this.signal) || (this._syncReturnDepth === 0 && ((this.budget.commands + 1) & 8191) === 0)) return undefined;
      runYieldCheckpoint(this.signal);
    }
    if (part.script.lists.length !== 1) return undefined;
    const list = part.script.lists[0]!;
    if (list.terminator || list.pipelines.length !== 1) return undefined;
    const pipeline = list.pipelines[0]!;
    if (pipeline.negate) return undefined;
    const isCustomReg = customRegisteredRegistries.has(this.commands);
    for (const command of pipeline.commands) {
      if (command.kind !== "simple") continue;
      const name = command.words[0]?.plain;
      if (!name) continue;
      if (name === "fmt" && command === pipeline.commands[0] && command.redirects.length === 0 && !io.stdinIsDefault) return undefined;
      const definition = this.commands.get(name);
      if (definition && customRegisteredCommands.has(definition.execute)) return undefined;
      if (isCustomReg && (!definition || (name === "echo" ? !defaultEchoExecutors.has(definition.execute) : name === "printf" ? definition.execute !== printfCommand.execute : !builtInDirectContextExecutors.has(definition.execute)))) return undefined;
      if (name === "uname" || name === "nproc" || name === "hostname" || name === "id" || name === "whoami") {
        if (!definition || !builtInDirectContextExecutors.has(definition.execute)) return undefined;
      }
    }
    // Range-aware tr and Buffer-free 76-col base64 are supported below.
    if (pipeline.commands.length >= 2 && pipeline.commands.length <= 5) {
      if (
        syncPurePipelineSlotState.inUse ||
        !this.budget.canSyncPurePipe ||
        hasYieldCheckpoint(this.signal) ||
        rawState.errexit ||
        rawState.nounset ||
        (this.budget.commands + pipeline.commands.length) > this.budget.limits.maxCommands
      ) {
        return undefined;
      }
      const cmd0 = pipeline.commands[0]!;
      const cmd0StdinRedir =
        cmd0.kind === "simple" &&
        cmd0.redirects.length === 1 &&
        cmd0.redirects[0]!.operator === "<" &&
        (cmd0.redirects[0]!.descriptor === undefined || cmd0.redirects[0]!.descriptor === 0) &&
        cmd0.redirects[0]!.target.plain !== undefined;
      const cmd0HereStringRedir =
        cmd0.kind === "simple" &&
        cmd0.redirects.length === 1 &&
        cmd0.redirects[0]!.operator === "<<<" &&
        (cmd0.redirects[0]!.descriptor === undefined || cmd0.redirects[0]!.descriptor === 0) &&
        this.isPureSyncValueWord(cmd0.redirects[0]!.target, rawState);
      if (cmd0.kind !== "simple" || (cmd0.redirects.length !== 0 && !cmd0StdinRedir && !cmd0HereStringRedir)) return undefined;
      const w0Plain0 = cmd0.words[0]?.plain;
      const cmd0YesStage = !cmd0StdinRedir && !cmd0HereStringRedir && w0Plain0 === "yes" && pipeline.commands[1]?.kind === "simple" && pipeline.commands[1]?.words[0]?.plain === "head";
      const cmd0SysStage = !cmd0StdinRedir && !cmd0HereStringRedir && (w0Plain0 === "uname" || w0Plain0 === "id" || w0Plain0 === "whoami" || w0Plain0 === "hostname" || w0Plain0 === "nproc" || w0Plain0 === "getconf" || w0Plain0 === "locale" || w0Plain0 === "cal" || w0Plain0 === "ncal" || w0Plain0 === "date" || w0Plain0 === "printenv" || w0Plain0 === "env" || w0Plain0 === "pwd" || w0Plain0 === "dirname" || w0Plain0 === "basename" || w0Plain0 === "expr" || w0Plain0 === "getopt" || w0Plain0 === "pathchk" || (w0Plain0 === "awk" && cmd0.words.some(w => w.plain?.includes("BEGIN"))));
      const cmd0FileStage = !cmd0StdinRedir && !cmd0HereStringRedir && (w0Plain0 === "paste" || w0Plain0 === "comm" || w0Plain0 === "join" || w0Plain0 === "nl" || w0Plain0 === "factor" || w0Plain0 === "tsort" || w0Plain0 === "envsubst" || w0Plain0 === "bc" || w0Plain0 === "xxd" || w0Plain0 === "od" || w0Plain0 === "hexdump" || w0Plain0 === "hd" || w0Plain0 === "md5sum" || w0Plain0 === "sha1sum" || w0Plain0 === "sha224sum" || w0Plain0 === "sha256sum" || w0Plain0 === "sha384sum" || w0Plain0 === "sha512sum" || w0Plain0 === "cksum" || w0Plain0 === "base32" || w0Plain0 === "csvcut" || w0Plain0 === "csvgrep" || w0Plain0 === "dos2unix" || w0Plain0 === "unix2dos" || w0Plain0 === "iconv" || w0Plain0 === "gzip" || w0Plain0 === "gunzip" || w0Plain0 === "zcat" || w0Plain0 === "unzstd" || w0Plain0 === "zstdcat" || w0Plain0 === "zstd" || w0Plain0 === "bzip2" || w0Plain0 === "bunzip2" || w0Plain0 === "bzcat" || w0Plain0 === "xz" || w0Plain0 === "unxz" || w0Plain0 === "xzcat" || w0Plain0 === "lzma" || w0Plain0 === "unlzma" || w0Plain0 === "lzcat" || w0Plain0 === "htmlq" || w0Plain0 === "xmllint" || w0Plain0 === "xq" || w0Plain0 === "yq" || w0Plain0 === "mdq" || w0Plain0 === "shuf" || w0Plain0 === "html-to-markdown" || w0Plain0 === "unrtf" || w0Plain0 === "fmt" || w0Plain0 === "pr" || w0Plain0 === "file" || w0Plain0 === "diff3" || w0Plain0 === "cmp" || w0Plain0 === "which" || w0Plain0 === "diff" || w0Plain0 === "xan" || w0Plain0 === "less" || w0Plain0 === "more" || w0Plain0 === "df" || w0Plain0 === "du" || w0Plain0 === "tree" || w0Plain0 === "stat" || w0Plain0 === "fd" || w0Plain0 === "rg" || w0Plain0 === "readlink" || w0Plain0 === "realpath" || w0Plain0 === "ls" || w0Plain0 === "find" || w0Plain0 === "csvlook" || w0Plain0 === "csvjson" || w0Plain0 === "csvsort" || w0Plain0 === "csvformat" || w0Plain0 === "csvstat" || w0Plain0 === "in2csv" || w0Plain0 === "csvstack" || w0Plain0 === "csvjoin" || w0Plain0 === "dd" || w0Plain0 === "xargs" || w0Plain0 === "openssl" || w0Plain0 === "sqlite3" || w0Plain0 === "gpg" || w0Plain0 === "ssh" || w0Plain0 === "ssh-keygen" || w0Plain0 === "pdfinfo" || w0Plain0 === "pdffonts" || w0Plain0 === "pdftotext" || w0Plain0 === "pdftohtml" || w0Plain0 === "exiftool" || w0Plain0 === "qpdf" || w0Plain0 === "pdftk" || w0Plain0 === "sips" || w0Plain0 === "identify" || w0Plain0 === "magick" || w0Plain0 === "convert" || w0Plain0 === "pdfimages" || w0Plain0 === "pdfdetach" || w0Plain0 === "ffprobe" || w0Plain0 === "ffmpeg" || w0Plain0 === "gh" || w0Plain0 === "pdftoppm" || w0Plain0 === "pdftocairo" || w0Plain0 === "mmdc" || w0Plain0 === "pandoc" || w0Plain0 === "soffice" || w0Plain0 === "libreoffice" || w0Plain0 === "ssconvert" || w0Plain0 === "wkhtmltopdf" || w0Plain0 === "op" || w0Plain0 === "git" || w0Plain0 === "tar" || w0Plain0 === "unzip" || w0Plain0 === "zip" || w0Plain0 === "timeout" || w0Plain0 === "split" || w0Plain0 === "csplit" || w0Plain0 === "curl" || w0Plain0 === "wget" || w0Plain0 === "sponge" || w0Plain0 === "truncate" || w0Plain0 === "install" || w0Plain0 === "apply_patch" || w0Plain0 === "mktemp" || w0Plain0 === "tee" || w0Plain0 === "touch" || w0Plain0 === "cp" || w0Plain0 === "mv" || w0Plain0 === "rmdir" || w0Plain0 === "sleep" || w0Plain0 === "chmod" || w0Plain0 === "patch" || w0Plain0 === "mkdir" || w0Plain0 === "rm" || w0Plain0 === "grep" || w0Plain0 === "egrep" || w0Plain0 === "fgrep" || w0Plain0 === "jq" || ((w0Plain0 === "head" || w0Plain0 === "tail" || w0Plain0 === "wc" || w0Plain0 === "sort" || w0Plain0 === "cut" || w0Plain0 === "sed" || w0Plain0 === "awk" || w0Plain0 === "rev" || w0Plain0 === "tac" || w0Plain0 === "uniq" || w0Plain0 === "base64" || w0Plain0 === "column" || w0Plain0 === "fold" || w0Plain0 === "expand" || w0Plain0 === "unexpand" || w0Plain0 === "strings" || w0Plain0 === "numfmt") && cmd0.words.length >= 2 && !cmd0.words.slice(1).some(w => w.plain === "-") && cmd0.words.slice(1).some(w => w.plain !== undefined && !w.plain.startsWith("-"))));
      if (!w0Plain0 || (w0Plain0 !== "echo" && w0Plain0 !== "printf" && w0Plain0 !== "seq" && w0Plain0 !== "cat" && !cmd0YesStage && !cmd0SysStage && !cmd0StdinRedir && !cmd0HereStringRedir && !cmd0FileStage) || hasShellFunction(rawState, w0Plain0) || rawState.extensions?.builtins.has(w0Plain0)) {
        return undefined;
      }
      if (cmd0HereStringRedir && w0Plain0 === "cat" && cmd0.words.length !== 1) return undefined;
      if (!cmd0StdinRedir && !cmd0HereStringRedir && w0Plain0 === "cat" && cmd0.words.length < 2) return undefined;
      const def0 = this.commands.get(w0Plain0);
      if (!def0 || (w0Plain0 === "printf" ? def0.execute !== printfCommand.execute : w0Plain0 === "echo" ? !defaultEchoExecutors.has(def0.execute) : (w0Plain0 === "cat" || w0Plain0 === "seq" || cmd0YesStage || cmd0SysStage || cmd0StdinRedir || cmd0HereStringRedir || cmd0FileStage) ? (w0Plain0 !== "rev" && w0Plain0 !== "tac" && w0Plain0 !== "nl" && w0Plain0 !== "paste" && w0Plain0 !== "comm" && w0Plain0 !== "join" && w0Plain0 !== "jq" && w0Plain0 !== "strings" && w0Plain0 !== "bc" && w0Plain0 !== "factor" && w0Plain0 !== "tsort" && w0Plain0 !== "envsubst" && w0Plain0 !== "xxd" && w0Plain0 !== "od" && w0Plain0 !== "hexdump" && w0Plain0 !== "hd" && w0Plain0 !== "fmt" && w0Plain0 !== "md5sum" && w0Plain0 !== "sha1sum" && w0Plain0 !== "sha224sum" && w0Plain0 !== "sha256sum" && w0Plain0 !== "sha384sum" && w0Plain0 !== "sha512sum" && w0Plain0 !== "cksum" && w0Plain0 !== "base32" && w0Plain0 !== "base64" && w0Plain0 !== "csvcut" && w0Plain0 !== "csvgrep" && w0Plain0 !== "dos2unix" && w0Plain0 !== "unix2dos" && w0Plain0 !== "iconv" && w0Plain0 !== "gzip" && w0Plain0 !== "gunzip" && w0Plain0 !== "zcat" && w0Plain0 !== "unzstd" && w0Plain0 !== "zstdcat" && w0Plain0 !== "htmlq" && w0Plain0 !== "xmllint" && w0Plain0 !== "xq" && w0Plain0 !== "yq" && w0Plain0 !== "mdq" && w0Plain0 !== "shuf" && w0Plain0 !== "html-to-markdown" && w0Plain0 !== "unrtf" && w0Plain0 !== "pr" && w0Plain0 !== "file" && w0Plain0 !== "diff3" && w0Plain0 !== "cmp" && w0Plain0 !== "which" && w0Plain0 !== "diff" && w0Plain0 !== "xan" && w0Plain0 !== "less" && w0Plain0 !== "more" && w0Plain0 !== "df" && w0Plain0 !== "du" && w0Plain0 !== "tree" && w0Plain0 !== "stat" && w0Plain0 !== "fd" && w0Plain0 !== "rg" && w0Plain0 !== "readlink" && w0Plain0 !== "realpath" && w0Plain0 !== "ls" && w0Plain0 !== "find" && w0Plain0 !== "csvlook" && w0Plain0 !== "csvjson" && w0Plain0 !== "csvsort" && w0Plain0 !== "csvformat" && w0Plain0 !== "csvstat" && w0Plain0 !== "in2csv" && w0Plain0 !== "csvstack" && w0Plain0 !== "csvjoin" && w0Plain0 !== "dd" && w0Plain0 !== "env" && w0Plain0 !== "xargs" && w0Plain0 !== "openssl" && w0Plain0 !== "sqlite3" && w0Plain0 !== "gpg" && w0Plain0 !== "ssh" && w0Plain0 !== "ssh-keygen" && w0Plain0 !== "pdfinfo" && w0Plain0 !== "pdffonts" && w0Plain0 !== "pdftotext" && w0Plain0 !== "pdftohtml" && w0Plain0 !== "exiftool" && w0Plain0 !== "qpdf" && w0Plain0 !== "pdftk" && w0Plain0 !== "sips" && w0Plain0 !== "identify" && w0Plain0 !== "magick" && w0Plain0 !== "convert" && w0Plain0 !== "pdfimages" && w0Plain0 !== "pdfdetach" && w0Plain0 !== "ffprobe" && w0Plain0 !== "ffmpeg" && w0Plain0 !== "gh" && w0Plain0 !== "pdftoppm" && w0Plain0 !== "pdftocairo" && w0Plain0 !== "mmdc" && w0Plain0 !== "pandoc" && w0Plain0 !== "soffice" && w0Plain0 !== "libreoffice" && w0Plain0 !== "ssconvert" && w0Plain0 !== "wkhtmltopdf" && w0Plain0 !== "op" && w0Plain0 !== "date" && w0Plain0 !== "printenv" && w0Plain0 !== "egrep" && w0Plain0 !== "fgrep" && w0Plain0 !== "yes" && w0Plain0 !== "cal" && w0Plain0 !== "ncal" && w0Plain0 !== "expr" && w0Plain0 !== "getopt" && w0Plain0 !== "pathchk" && !builtInDirectContextExecutors.has(def0.execute)) : (customRegisteredCommands.has(def0.execute) || customRegisteredRegistries.has(this.commands)))) return undefined;
      if (!this.arePureArgWords(cmd0.words, rawState)) return undefined;
      const n = pipeline.commands.length;
      const stageDefs: CommandDefinition[] = [];
      const stageNames: string[] = [];
      const stageArgsList: string[][] = [];
      const startStageIdx = ((cmd0HereStringRedir || cmd0StdinRedir) && (w0Plain0 !== "cat" || cmd0.words.length > 1)) || cmd0FileStage ? 0 : 1;
      for (let i = startStageIdx; i < n; i++) {
        const sCmd = pipeline.commands[i]!;
        if (sCmd.kind !== "simple" || (i > 0 ? sCmd.redirects.length !== 0 : (!cmd0StdinRedir && !cmd0HereStringRedir && !cmd0FileStage)) || sCmd.words.length === 0) return undefined;
        const sName = sCmd.words[0]!.plain;
        if (!sName || hasShellFunction(rawState, sName) || rawState.extensions?.builtins.has(sName)) return undefined;
        const extDef = this.commands.get(sName);
        if (!extDef || ((sName !== "cat" || startStageIdx === 0) && sName !== "rev" && sName !== "tac" && sName !== "nl" && sName !== "paste" && sName !== "column" && sName !== "fold" && sName !== "expand" && sName !== "unexpand" && sName !== "strings" && sName !== "comm" && sName !== "join" && sName !== "jq" && sName !== "bc" && sName !== "factor" && sName !== "tsort" && sName !== "envsubst" && sName !== "xxd" && sName !== "od" && sName !== "hexdump" && sName !== "hd" && sName !== "fmt" && sName !== "md5sum" && sName !== "sha1sum" && sName !== "sha224sum" && sName !== "sha256sum" && sName !== "sha384sum" && sName !== "sha512sum" && sName !== "cksum" && sName !== "base32" && sName !== "base64" && sName !== "csvcut" && sName !== "csvgrep" && sName !== "dos2unix" && sName !== "unix2dos" && sName !== "iconv" && sName !== "gzip" && sName !== "gunzip" && sName !== "zcat" && sName !== "unzstd" && sName !== "zstdcat" && sName !== "htmlq" && sName !== "xmllint" && sName !== "xq" && sName !== "yq" && sName !== "mdq" && sName !== "shuf" && sName !== "html-to-markdown" && sName !== "unrtf" && sName !== "pr" && sName !== "file" && sName !== "diff3" && sName !== "cmp" && sName !== "which" && sName !== "diff" && sName !== "xan" && sName !== "less" && sName !== "more" && sName !== "df" && sName !== "du" && sName !== "tree" && sName !== "stat" && sName !== "fd" && sName !== "rg" && sName !== "readlink" && sName !== "realpath" && sName !== "ls" && sName !== "find" && sName !== "csvlook" && sName !== "csvjson" && sName !== "csvsort" && sName !== "csvformat" && sName !== "csvstat" && sName !== "in2csv" && sName !== "csvstack" && sName !== "csvjoin" && sName !== "dd" && sName !== "xargs" && sName !== "openssl" && sName !== "sqlite3" && sName !== "gpg" && sName !== "ssh" && sName !== "ssh-keygen" && sName !== "pdfinfo" && sName !== "pdffonts" && sName !== "pdftotext" && sName !== "pdftohtml" && sName !== "exiftool" && sName !== "qpdf" && sName !== "pdftk" && sName !== "sips" && sName !== "identify" && sName !== "magick" && sName !== "convert" && sName !== "pdfimages" && sName !== "pdfdetach" && sName !== "ffprobe" && sName !== "ffmpeg" && sName !== "gh" && sName !== "pdftoppm" && sName !== "pdftocairo" && sName !== "mmdc" && sName !== "pandoc" && sName !== "soffice" && sName !== "libreoffice" && sName !== "ssconvert" && sName !== "wkhtmltopdf" && sName !== "op" && sName !== "date" && sName !== "cal" && sName !== "ncal" && sName !== "getopt" && sName !== "pathchk" && sName !== "printenv" && sName !== "env" && sName !== "egrep" && sName !== "fgrep" && !builtInDirectContextExecutors.has(extDef.execute)) || customRegisteredCommands.has(extDef.execute)) return undefined;
        if ((sName === "xxd" || sName === "od") && !builtInDirectContextExecutors.has(extDef.execute)) return undefined;
        if (!this.arePureArgWords(sCmd.words, rawState)) return undefined;
        const sArgs: string[] = [];
        for (let w = 1; w < sCmd.words.length; w++) {
          const v = this.fastValueWord(sCmd.words[w]!, state, io, true, false, false, true, undefined, part.line);
          if (typeof v !== "string") return undefined;
          sArgs.push(v);
        }
        if (sName === "cut") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("cut", sArgs, rawState.cwd, byteLocale(rawState.variables), true) === undefined : this.evalSyncCut([], sArgs, byteLocale(rawState.variables), true) === undefined) return undefined;
        } else if (sName === "tr") {
          if (this.evalSyncTr("", sArgs) === undefined) return undefined;
        } else if (sName === "uniq") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("uniq", sArgs, rawState.cwd, byteLocale(rawState.variables), true) === undefined : this.evalSyncUniq([], sArgs, false, true) === undefined) return undefined;
        } else if (sName === "sort") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("sort", sArgs, rawState.cwd, byteLocale(rawState.variables), true) === undefined : this.evalSyncSort([], sArgs, byteLocale(rawState.variables), true) === undefined) return undefined;
        } else if ((sName === "head" || sName === "tail") && !(i === 0 && cmd0FileStage)) {
          if (sArgs.length === 0) {
            sArgs.push("-n", "10");
          } else if (sArgs.length === 1 && (/^-(?:n|c)?[0-9]+$/.test(sArgs[0]!) || /^--(?:lines|bytes)=[0-9]+$/.test(sArgs[0]!) || (sName === "tail" && /^(?:-n|--lines=)\+[0-9]+$/.test(sArgs[0]!)) || (sName === "head" && /^(?:-n|--lines=)-[0-9]+$/.test(sArgs[0]!)))) {
            const flag = (sArgs[0]!.startsWith("-c") || sArgs[0]!.startsWith("--bytes=")) ? "-c" : "-n";
            const numStr = sArgs[0]!.startsWith("--") ? sArgs[0]!.slice(sArgs[0]!.indexOf("=") + 1) : ((sArgs[0]!.startsWith("-n") || sArgs[0]!.startsWith("-c")) ? sArgs[0]!.slice(2) : sArgs[0]!.slice(1));
            sArgs.length = 0;
            sArgs.push(flag, numStr);
          }
          const validNum = sArgs.length === 2 && ((sArgs[0] === "-n" && (/^[0-9]+$/.test(sArgs[1]!) || (sName === "tail" && /^\+[0-9]+$/.test(sArgs[1]!)) || (sName === "head" && /^-[0-9]+$/.test(sArgs[1]!)))) || (sArgs[0] === "-c" && /^[0-9]+$/.test(sArgs[1]!)));
          if (!validNum && syncCommandEvaluators.evalSyncHeadTail?.(sName, EMPTY_BYTES, sArgs) === undefined) return undefined;
        } else if (sName === "wc") {
          const normWc = !(i === 0 && cmd0FileStage) && sArgs.length === 1 ? this.normalizeSyncWcFlag(sArgs[0]) : undefined;
          if (normWc) {
            sArgs[0] = normWc;
          } else if (syncCommandEvaluators.evalSyncWc?.(i === 0 && cmd0FileStage ? undefined : EMPTY_BYTES, sArgs, byteLocale(rawState.variables), (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) {
            return undefined;
          }
        } else if (sName === "sed") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("sed", sArgs, rawState.cwd, byteLocale(rawState.variables), true) === undefined : this.evalSyncSed([], sArgs, true) === undefined) return undefined;
        } else if (sName === "rev") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("rev", sArgs, rawState.cwd, false) === undefined : sArgs.length !== 0) return undefined;
        } else if (sName === "awk") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("awk", sArgs, rawState.cwd, byteLocale(rawState.variables)) === undefined : this.evalSyncAwk([], sArgs) === undefined) return undefined;
        } else if (sName === "grep" || sName === "egrep" || sName === "fgrep") {
          if (sName === "egrep") sArgs.unshift("-E");
          else if (sName === "fgrep") sArgs.unshift("-F");
          const grepOk = (i === 0 && cmd0FileStage)
            ? this.evalSyncGrepWithFiles(sArgs, false, false, Boolean(rawState.errexit), rawState.cwd, undefined, true) !== undefined
            : (this.evalSyncGrep([], sArgs, Boolean(rawState.errexit)) !== undefined || this.evalSyncGrepWithFiles(sArgs, false, false, Boolean(rawState.errexit), rawState.cwd, [], true) !== undefined);
          if (!grepOk) return undefined;
        } else if (sName === "jq") {
          const jqPreOk = (i === 0 && cmd0FileStage)
            ? this.evalSyncJq(undefined, sArgs, rawState.cwd) !== undefined
            : (this.evalSyncJq("null", sArgs, rawState.cwd) !== undefined ||
               this.evalSyncJq("{}", sArgs, rawState.cwd) !== undefined ||
               this.evalSyncJq("[]", sArgs, rawState.cwd) !== undefined ||
               this.evalSyncJq("\"\"", sArgs, rawState.cwd) !== undefined ||
               this.evalSyncJq("0", sArgs, rawState.cwd) !== undefined);
          if (!jqPreOk) return undefined;
        } else if (sName === "base64") {
          if (this.evalSyncBase64(EMPTY_BYTES, (i === 0 && cmd0FileStage) ? sArgs.slice(0, -1) : sArgs) === undefined) return undefined;
        } else if (sName === "tac") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("tac", sArgs, rawState.cwd, false) === undefined : sArgs.length !== 0) return undefined;
        } else if (sName === "nl") {
          if (this.evalSyncNl([], sArgs, (i === 0 && cmd0FileStage) ? rawState.cwd : undefined) === undefined) return undefined;
        } else if (sName === "paste") {
          if (this.evalSyncPaste([], sArgs, (i === 0 && cmd0FileStage) ? rawState.cwd : undefined, true) === undefined) return undefined;
        } else if (sName === "numfmt") {
          if (this.evalSyncNumfmt([], sArgs) === undefined) return undefined;
        } else if (sName === "column") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("column", sArgs, rawState.cwd, false) === undefined : this.evalSyncColumn([], sArgs) === undefined) return undefined;
        } else if (sName === "fold") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("fold", sArgs, rawState.cwd, false) === undefined : this.evalSyncFold([], sArgs) === undefined) return undefined;
        } else if (sName === "expand") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("expand", sArgs, rawState.cwd, false) === undefined : this.evalSyncExpand([], sArgs) === undefined) return undefined;
        } else if (sName === "unexpand") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("unexpand", sArgs, rawState.cwd, false) === undefined : this.evalSyncUnexpand([], sArgs) === undefined) return undefined;
        } else if (sName === "strings") {
          if ((i === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("strings", sArgs, rawState.cwd, false) === undefined : this.evalSyncStrings([], sArgs) === undefined) return undefined;
        } else if (sName === "comm") {
          if (this.evalSyncComm([], sArgs, rawState.cwd, true) === undefined) return undefined;
        } else if (sName === "join") {
          if (this.evalSyncJoin([], sArgs, rawState.cwd) === undefined) return undefined;
        } else if (sName === "bc") {
          if (this.evalSyncBc("0", sArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (sName === "xxd") {
          if (this.evalSyncXxd(EMPTY_BYTES, sArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (sName === "od") {
          if (this.evalSyncOd(EMPTY_BYTES, sArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (sName === "factor") {
          if (this.evalSyncFactor(["2"], sArgs) === undefined) return undefined;
        } else if (sName === "tsort") {
          if (this.evalSyncTsort(["a b"], sArgs, rawState.cwd) === undefined) return undefined;
        } else if (sName === "envsubst") {
          if (this.evalSyncEnvsubst("", sArgs, rawState) === undefined) return undefined;
        } else if (sName === "hexdump" || sName === "hd") {
          if (this.evalSyncHexdump(new Uint8Array([97]), sArgs, sName === "hd", (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (sName === "fmt") {
          if (this.evalSyncFmt(EMPTY_BYTES, sArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (sName === "md5sum" || sName === "sha1sum" || sName === "sha224sum" || sName === "sha256sum" || sName === "sha384sum" || sName === "sha512sum" || sName === "cksum") {
          if (evalSyncChecksum(sName, EMPTY_BYTES, sArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (sName === "base32") {
          if (evalSyncBase32(EMPTY_BYTES, sArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (sName === "cat") {
          if (syncCommandEvaluators.evalSyncCat?.(EMPTY_BYTES, sArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (i === 0 && cmd0FileStage && (sName === "head" || sName === "tail")) {
          if (syncCommandEvaluators.evalSyncHeadTail?.(sName, undefined, sArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false, true)) === undefined) return undefined;
        } else if (sName === "csvcut" || sName === "csvgrep" || sName === "dos2unix" || sName === "unix2dos" || sName === "iconv" || sName === "gzip" || sName === "gunzip" || sName === "zcat" || sName === "unzstd" || sName === "zstdcat" || sName === "zstd" || sName === "bzip2" || sName === "bunzip2" || sName === "bzcat" || sName === "xz" || sName === "unxz" || sName === "xzcat" || sName === "lzma" || sName === "unlzma" || sName === "lzcat" || sName === "htmlq" || sName === "xmllint" || sName === "xq" || sName === "yq" || sName === "mdq" || sName === "shuf" || sName === "html-to-markdown" || sName === "unrtf" || sName === "pr" || sName === "file" || sName === "diff3" || sName === "cmp" || sName === "which" || sName === "diff" || sName === "xan" || sName === "less" || sName === "more" || sName === "df" || sName === "du" || sName === "tree" || sName === "stat" || sName === "fd" || sName === "rg" || sName === "readlink" || sName === "realpath" || sName === "ls" || sName === "find" || sName === "csvlook" || sName === "csvjson" || sName === "csvsort" || sName === "csvformat" || sName === "csvstat" || sName === "in2csv" || sName === "csvstack" || sName === "csvjoin" || sName === "dd" || sName === "xargs" || sName === "openssl" || sName === "sqlite3" || sName === "gpg" || sName === "ssh" || sName === "ssh-keygen" || sName === "pdfinfo" || sName === "pdffonts" || sName === "pdftotext" || sName === "pdftohtml" || sName === "exiftool" || sName === "qpdf" || sName === "pdftk" || sName === "sips" || sName === "identify" || sName === "magick" || sName === "convert" || sName === "pdfimages" || sName === "pdfdetach" || sName === "ffprobe" || sName === "ffmpeg" || sName === "gh" || sName === "pdftoppm" || sName === "pdftocairo" || sName === "mmdc" || sName === "pandoc" || sName === "soffice" || sName === "libreoffice" || sName === "ssconvert" || sName === "wkhtmltopdf" || sName === "op" || sName === "git" || sName === "tar" || sName === "unzip" || sName === "zip" || sName === "timeout" || sName === "split" || sName === "csplit" || sName === "curl" || sName === "wget" || sName === "sponge" || sName === "truncate" || sName === "install" || sName === "apply_patch" || sName === "mktemp" || sName === "tee" || sName === "touch" || sName === "cp" || sName === "mv" || sName === "rmdir" || sName === "sleep" || sName === "chmod" || sName === "patch" || sName === "mkdir" || sName === "rm" || sName === "ln" || sName === "date" || sName === "cal" || sName === "ncal" || sName === "getopt" || sName === "pathchk" || sName === "printenv" || sName === "env" || ((sArgs.includes("--help") || sArgs.includes("--version")) && gnuInformationSync(sName, sArgs) !== undefined)) {
          // Validated on stage bytes in loop
        } else {
          return undefined;
        }
        stageDefs.push(extDef);
        stageNames.push(sName === "egrep" || sName === "fgrep" ? "grep" : sName);
        stageArgsList.push(sArgs);
      }
      const subArgs0: string[] = [];
      for (let i = 1; i < cmd0.words.length; i++) {
        const val = this.fastValueWord(cmd0.words[i]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof val !== "string") return undefined;
        subArgs0.push(val);
      }
      let stage0Formatted: string | undefined;
      if (cmd0YesStage) {
        let yesOk = true;
        let yesWords = subArgs0;
        if (subArgs0[0] === "--") {
          yesWords = subArgs0.slice(1);
        } else {
          for (const a of subArgs0) {
            if (a.startsWith("-") && a !== "-") { yesOk = false; break; }
          }
        }
        const headArgs = stageArgsList[0];
        if (yesOk && headArgs && headArgs.length === 2) {
          const yesLine = (yesWords.length === 0 ? "y" : yesWords.join(" ")) + "\n";
          if (headArgs[0] === "-n" && /^[0-9]+$/.test(headArgs[1]!)) {
            const k = Number(headArgs[1]!);
            if (k >= 0 && k <= 256 && yesLine.length * k <= 8192) stage0Formatted = yesLine.repeat(k);
          } else if (headArgs[0] === "-c" && /^[0-9]+$/.test(headArgs[1]!)) {
            const b = Number(headArgs[1]!);
            const reps = Math.ceil(b / Math.max(1, yesLine.length)) + 1;
            if (b >= 0 && b <= 4096 && yesLine.length * reps <= 8192) stage0Formatted = yesLine.repeat(reps);
          }
        }
      } else if (cmd0SysStage) {
        if (w0Plain0 === "date") {
          stage0Formatted = evalSyncDate(subArgs0, rawState.exported.has("TZ") ? rawState.variables.TZ : undefined, def0.execute, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true), (p: string) => this.tryInspectMemoryNodeSync(resolvePath(rawState.cwd, p), true, true)?.mtimeMs);
        } else if (w0Plain0 === "printenv") {
          stage0Formatted = evalSyncPrintenv(subArgs0, rawState.exported, rawState.variables, def0.execute);
        } else if (w0Plain0 === "env") {
          stage0Formatted = evalSyncEnv(subArgs0, rawState.exported, rawState.variables);
        } else if (w0Plain0 === "pwd") {
          if (subArgs0.length === 0 || (subArgs0.length === 1 && (subArgs0[0] === "-L" || subArgs0[0] === "--logical"))) {
            stage0Formatted = rawState.cwd + "\n";
          }
        } else if (w0Plain0 === "awk") {
          const awk0 = this.evalSyncAwk([], subArgs0);
          if (awk0 !== undefined) stage0Formatted = awk0.join("\n") + (awk0.length > 0 ? "\n" : "");
        } else if (w0Plain0 === "dirname") {
          const d0 = this.evalSyncDirname(subArgs0, true);
          if (d0 !== undefined) stage0Formatted = d0.endsWith("\0") ? d0 : d0 + "\n";
        } else if (w0Plain0 === "basename") {
          const b0 = this.evalSyncBasename(subArgs0, true);
          if (b0 !== undefined) stage0Formatted = b0.endsWith("\0") ? b0 : b0 + "\n";
        } else if (w0Plain0 === "expr") {
          const e0 = this.evalSyncExpr(subArgs0);
          if (e0 !== undefined && e0.status <= 1) stage0Formatted = e0.value + "\n";
        } else if (w0Plain0 === "getopt") {
          const g0 = evalSyncGetopt(subArgs0, {
            GETOPT_COMPATIBLE: (rawState.exported.has("GETOPT_COMPATIBLE") || rawState.allexport) ? rawState.variables.GETOPT_COMPATIBLE : undefined,
            POSIXLY_CORRECT: (rawState.exported.has("POSIXLY_CORRECT") || rawState.allexport) ? rawState.variables.POSIXLY_CORRECT : undefined,
          });
          if (g0 !== undefined) stage0Formatted = g0.endsWith("\n") ? g0 : g0 + "\n";
        } else if (w0Plain0 === "pathchk") {
          stage0Formatted = evalSyncPathchk(subArgs0, rawState.cwd, (p: string) => this.tryStatMemoryNodeTypeSync(p, true));
        } else {
          const sys0 = this.evalSyncSysinfo(w0Plain0, subArgs0, rawState);
          if (sys0 !== undefined) stage0Formatted = sys0 + "\n";
        }
      } else if (cmd0FileStage) {
        stage0Formatted = "";
      } else if (cmd0StdinRedir && (w0Plain0 !== "cat" || subArgs0.length > 0)) {
        const redirTarget = cmd0.redirects[0]!.target.plain!;
        if (!redirTarget.startsWith("-") && redirTarget !== "/dev/stdin") {
          const view = this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, redirTarget));
          if (view && view.byteLength <= 16384 && !view.includes(0)) {
            stage0Formatted = sharedSyncPipeDecoder.decode(view);
          }
        }
      } else if (cmd0HereStringRedir) {
        const hv = this.fastValueWord(cmd0.redirects[0]!.target, state, io, false, false, false, false, undefined, part.line);
        if (typeof hv === "string" && hv.length <= 16384 && !hv.includes("\0")) stage0Formatted = hv + "\n";
      } else if (w0Plain0 === "printf") {
        stage0Formatted = tryFastPrintf(subArgs0, true);
      } else if (w0Plain0 === "seq") {
        stage0Formatted = this.evalSyncSeq(subArgs0);
      } else if (w0Plain0 === "cat") {
        if (!cmd0StdinRedir && (subArgs0.length > 1 || subArgs0[0]?.startsWith("-"))) {
          stage0Formatted = syncCommandEvaluators.evalSyncCat?.(undefined, subArgs0, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true));
        } else {
          const catTarget = cmd0StdinRedir ? cmd0.redirects[0]!.target.plain! : subArgs0[0];
          if (catTarget && !catTarget.startsWith("-") && catTarget !== "/dev/stdin") {
            const view = this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, catTarget));
            if (view && view.byteLength <= 16384 && !view.includes(0)) {
              stage0Formatted = sharedSyncPipeDecoder.decode(view);
            }
          }
        }
      } else if (w0Plain0 === "echo") {
        stage0Formatted = tryFastEcho(subArgs0);
      } else if (!subArgs0[0]?.startsWith("-")) {
        stage0Formatted = `${subArgs0.join(" ")}\n`;
        if (stage0Formatted.includes("\0")) stage0Formatted = undefined;
      }
      if (stage0Formatted === undefined || stage0Formatted.length > 8192) return undefined;
      const stage0ByteLen = shellValueByteLength(stage0Formatted);
      if (stage0ByteLen > 65536) return undefined;
      const sharedSyncPipeBuf0 = new Uint8Array(65536);
      const sharedSyncPipeBuf1 = new Uint8Array(65536);
      const nextBytes0 = this.budget.bytes + stage0ByteLen;
      if (nextBytes0 > this.budget.maxOutputBytesSmi && stage0ByteLen > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
      const previousBytes = this.budget.bytes;
      const previousCommands = this.budget.commands;
      let completed = false;
      let stageStatus = 0;
      let failureStatus = 0;
      this.budget.bytes = nextBytes0;
      syncPurePipelineSlotState.inUse = true;
      this.budget.enterPipelineStages(n);
      this.budget.commands += n;
      let prevBuf = sharedSyncPipeBuf0;
      let prevLen = fastSharedTextEncoder.encodeInto(stage0Formatted, sharedSyncPipeBuf0).written;
      try {
        for (let sIdx = 0; sIdx < stageNames.length; sIdx++) {
          stageStatus = 0;
          const index = sIdx + 1;
          const firstName = stageNames[sIdx]!;
          const extDef = stageDefs[sIdx]!;
          const stageArgs = stageArgsList[sIdx]!;
          let nextBuf = (index & 1) === 0 ? sharedSyncPipeBuf0 : sharedSyncPipeBuf1;
          const isInlineCutField = firstName === "cut";
          const isInlineTr = firstName === "tr";
          const isInlineAwk = firstName === "awk";
          const isInlineGrep = firstName === "grep";
          const isInlineJq = firstName === "jq";
          const isInlineBase64 = firstName === "base64";
          const isInlineTac = firstName === "tac";
          const isInlineNl = firstName === "nl";
          const isInlinePaste = firstName === "paste";
          const isInlineNumfmt = firstName === "numfmt";
          const isInlineColumn = firstName === "column";
          const isInlineFold = firstName === "fold";
          const isInlineExpand = firstName === "expand";
          const isInlineUnexpand = firstName === "unexpand";
          const isInlineStrings = firstName === "strings";
          const isInlineComm = firstName === "comm";
          const isInlineJoin = firstName === "join";
          const isInlineSort = firstName === "sort" && !byteLocale(rawState.variables);
          const isInlineUniq = firstName === "uniq";
          const inlineSedMatch = firstName === "sed";
          if (
            firstName === "rev" ||
            ((firstName === "head" || firstName === "tail") && !(sIdx === 0 && cmd0FileStage) && stageArgs.length === 2 && (stageArgs[0] === "-n" || stageArgs[0] === "-c") && /^[+-]?\d+$/.test(stageArgs[1]!)) ||
            (firstName === "wc" && !(sIdx === 0 && cmd0FileStage) && stageArgs.length === 1 && (stageArgs[0] === "-l" || stageArgs[0] === "-w" || stageArgs[0] === "-m" || stageArgs[0] === "-L" || stageArgs[0] === "-c")) ||
            (firstName === "cut" && stageArgs.length === 2 && stageArgs[0] === "-c") ||
            isInlineCutField ||
            isInlineTr ||
            isInlineSort ||
            isInlineUniq ||
            inlineSedMatch ||
            isInlineAwk ||
            isInlineGrep ||
            isInlineJq ||
            firstName === "bc" ||
            firstName === "xxd" ||
            firstName === "od" ||
            firstName === "factor" ||
            firstName === "tsort" ||
            firstName === "envsubst" ||
            firstName === "hexdump" ||
            firstName === "hd" ||
            firstName === "fmt" ||
            firstName === "md5sum" ||
            firstName === "sha1sum" ||
            firstName === "sha224sum" ||
            firstName === "sha256sum" ||
            firstName === "sha384sum" ||
            firstName === "sha512sum" ||
            firstName === "cksum" ||
            firstName === "base32" ||
            firstName === "csvcut" ||
            firstName === "csvgrep" ||
            firstName === "dos2unix" ||
            firstName === "unix2dos" ||
            firstName === "iconv" ||
            firstName === "gzip" ||
            firstName === "gunzip" ||
            firstName === "zcat" ||
            firstName === "unzstd" ||
            firstName === "zstdcat" || firstName === "zstd" || firstName === "bzip2" || firstName === "bunzip2" || firstName === "bzcat" || firstName === "xz" || firstName === "unxz" || firstName === "xzcat" || firstName === "lzma" || firstName === "unlzma" || firstName === "lzcat" ||
            firstName === "htmlq" ||
            firstName === "xmllint" ||
            firstName === "xq" ||
            firstName === "yq" ||
            firstName === "mdq" ||
            firstName === "shuf" ||
            firstName === "html-to-markdown" ||
            firstName === "unrtf" ||
            firstName === "pr" ||
            firstName === "file" ||
            firstName === "diff3" ||
            firstName === "cmp" ||
            firstName === "which" ||
            firstName === "diff" ||
            firstName === "xan" ||
            firstName === "less" ||
            firstName === "more" ||
            firstName === "df" ||
            firstName === "du" ||
            firstName === "tree" ||
            firstName === "stat" ||
            firstName === "fd" ||
            firstName === "rg" ||
            firstName === "readlink" ||
            firstName === "realpath" ||
            firstName === "ls" ||
            firstName === "find" ||
            firstName === "csvlook" ||
            firstName === "csvjson" ||
            firstName === "csvsort" ||
            firstName === "csvformat" ||
            firstName === "csvstat" ||
            firstName === "in2csv" ||
            firstName === "csvstack" ||
            firstName === "csvjoin" ||
            firstName === "dd" ||
            firstName === "xargs" ||
            firstName === "openssl" ||
            firstName === "sqlite3" ||
            firstName === "gpg" ||
            firstName === "ssh" ||
            firstName === "ssh-keygen" ||
            firstName === "pdfinfo" ||
            firstName === "pdffonts" ||
            firstName === "pdftotext" ||
            firstName === "pdftohtml" ||
            firstName === "exiftool" ||
            firstName === "qpdf" ||
            firstName === "pdftk" ||
            firstName === "sips" ||
            firstName === "identify" ||
            firstName === "magick" ||
            firstName === "convert" ||
            firstName === "pdfimages" ||
            firstName === "pdfdetach" ||
            firstName === "ffprobe" ||
            firstName === "ffmpeg" ||
            firstName === "gh" ||
            firstName === "pdftoppm" ||
            firstName === "pdftocairo" ||
            firstName === "mmdc" ||
            firstName === "pandoc" ||
            firstName === "soffice" ||
            firstName === "libreoffice" ||
            firstName === "ssconvert" ||
            firstName === "wkhtmltopdf" ||
            firstName === "op" ||
            firstName === "git" ||
            firstName === "tar" ||
            firstName === "unzip" ||
            firstName === "zip" ||
            firstName === "timeout" ||
            firstName === "split" ||
            firstName === "csplit" ||
            firstName === "curl" ||
            firstName === "wget" ||
            firstName === "sponge" ||
            firstName === "truncate" ||
            firstName === "install" ||
            firstName === "apply_patch" ||
            firstName === "mktemp" ||
            firstName === "tee" ||
            firstName === "touch" ||
            firstName === "cp" ||
            firstName === "mv" ||
            firstName === "rmdir" ||
            firstName === "sleep" ||
            firstName === "chmod" ||
            firstName === "patch" ||
            firstName === "mkdir" ||
            firstName === "rm" ||
            firstName === "ln" ||
            firstName === "head" ||
            firstName === "tail" ||
            firstName === "wc" ||
            firstName === "cat" ||
            firstName === "date" ||
            firstName === "cal" ||
            firstName === "ncal" ||
            firstName === "getopt" ||
            firstName === "pathchk" ||
            firstName === "printenv" ||
            firstName === "env" ||
            ((stageArgs.includes("--help") || stageArgs.includes("--version")) && gnuInformationSync(firstName, stageArgs) !== undefined) ||
            isInlineBase64 ||
            isInlineTac ||
            isInlineNl ||
            isInlinePaste ||
            isInlineNumfmt ||
            isInlineColumn ||
            isInlineFold ||
            isInlineExpand ||
            isInlineUnexpand ||
            isInlineStrings ||
            isInlineComm ||
            isInlineJoin
          ) {
            const inStr = prevLen === 0 ? "" : sharedSyncPipeDecoder.decode(prevBuf.subarray(0, prevLen));
            const isZeroTermStage = (firstName === "sort" || firstName === "uniq" || firstName === "cut" || firstName === "paste" || firstName === "comm" || firstName === "sed") && this.hasZeroTerminatedFlag(firstName, stageArgs);
            const isGrepZeroOut = firstName === "grep" && this.hasZeroTerminatedFlag("grep", stageArgs);
            const stageLineSep = isZeroTermStage ? "\0" : "\n";
            const rawLines = inStr.length === 0 ? [] : (inStr.endsWith(stageLineSep) ? inStr.slice(0, -1).split(stageLineSep) : inStr.split(stageLineSep));
            let outLines: string[] = [];
            let sedTerminated = false;
            if (firstName === "rev") {
              if (sIdx === 0 && cmd0FileStage) {
                const revRes = this.evalSyncMultiFileText("rev", stageArgs, rawState.cwd, false);
                if (revRes === undefined) return undefined;
                outLines = revRes;
                sedTerminated = true;
              } else {
                outLines = rawLines.map(l => Array.from(l).reverse().join(""));
              }
            } else if ((firstName === "head" || firstName === "tail") && !(sIdx === 0 && cmd0FileStage) && stageArgs.length === 2 && (stageArgs[0] === "-n" || stageArgs[0] === "-c") && /^[+-]?\d+$/.test(stageArgs[1]!)) {
              const count = Number(stageArgs[1]!);
              if (stageArgs[0] === "-c") {
                const sub = firstName === "head"
                  ? prevBuf.subarray(0, Math.min(prevLen, count))
                  : (count === 0 ? prevBuf.subarray(0, 0) : prevBuf.subarray(Math.max(0, prevLen - count), prevLen));
                const nextTotalBytes = this.budget.bytes + sub.byteLength;
                if (nextTotalBytes > this.budget.maxOutputBytesSmi && sub.byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
                this.budget.bytes = nextTotalBytes;
                if (sub.byteLength > nextBuf.byteLength) nextBuf = new Uint8Array(sub.byteLength);
                nextBuf.set(sub, 0);
                prevBuf = nextBuf;
                prevLen = sub.byteLength;
                continue;
              }
              if (firstName === "tail" && stageArgs[1]!.startsWith("+")) {
                outLines = rawLines.slice(Math.max(0, count - 1));
              } else if (firstName === "head" && stageArgs[1]!.startsWith("-")) {
                const drop = Math.abs(count);
                outLines = drop === 0 ? [...rawLines] : rawLines.slice(0, Math.max(0, rawLines.length - drop));
              } else {
                outLines = firstName === "head" ? rawLines.slice(0, count) : (count === 0 ? [] : rawLines.slice(-count));
              }
            } else if (firstName === "wc" && !(sIdx === 0 && cmd0FileStage) && stageArgs.length === 1 && (stageArgs[0] === "-l" || stageArgs[0] === "-w" || stageArgs[0] === "-m" || stageArgs[0] === "-L" || stageArgs[0] === "-c")) {
              if (stageArgs[0] === "-l") {
                let nl = 0;
                for (let k = 0; k < inStr.length; k++) if (inStr.charCodeAt(k) === 10) nl++;
                outLines = [String(nl)];
              } else if (stageArgs[0] === "-w") {
                // The split shortcut covers printable ASCII and its whitespace only.
                // Delegate controls and locale-sensitive bytes to the wc command.
                if (prevBuf.subarray(0, prevLen).some(byte => byte < 9 || (byte > 13 && byte < 32) || byte >= 127)) return undefined;
                outLines = [String(inStr.split(/[ \t\n\r\f\v]+/).filter(Boolean).length)];
              } else if (stageArgs[0] === "-m") {
                outLines = [String(byteLocale(rawState.variables) ? prevLen : Array.from(inStr).length)];
              } else if (stageArgs[0] === "-L") {
                outLines = [String(this.wcMaxLineWidth(inStr, byteLocale(rawState.variables)))];
              } else {
                outLines = [String(prevLen)];
              }
            } else if (isInlineCutField) {
              const cutRes = (sIdx === 0 && cmd0FileStage)
                ? this.evalSyncMultiFileText("cut", stageArgs, rawState.cwd, byteLocale(rawState.variables), true)
                : this.evalSyncCut(rawLines, stageArgs, byteLocale(rawState.variables), true);
              if (cutRes === undefined) return undefined;
              outLines = cutRes;
            } else if (isInlineTr) {
              const transformed = this.evalSyncTr(inStr, stageArgs);
              if (transformed === undefined) return undefined;
              const outByteLen = shellValueByteLength(transformed);
              const nextTotalBytes = this.budget.bytes + outByteLen;
              if (nextTotalBytes > this.budget.maxOutputBytesSmi && outByteLen > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
              this.budget.bytes = nextTotalBytes;
              if (outByteLen > nextBuf.byteLength) nextBuf = new Uint8Array(outByteLen);
              const written = transformed.length === 0 ? 0 : fastSharedTextEncoder.encodeInto(transformed, nextBuf).written;
              prevBuf = nextBuf;
              prevLen = written;
              continue;
            } else if (isInlineSort) {
              outLines = ((sIdx === 0 && cmd0FileStage)
                ? this.evalSyncMultiFileText("sort", stageArgs, rawState.cwd, byteLocale(rawState.variables), true)
                : this.evalSyncSort(rawLines, stageArgs, false, true)) ?? [];
            } else if (isInlineUniq) {
              const uniqRes = (sIdx === 0 && cmd0FileStage)
                ? this.evalSyncMultiFileText("uniq", stageArgs, rawState.cwd, byteLocale(rawState.variables), true)
                : this.evalSyncUniq(rawLines, stageArgs, byteLocale(rawState.variables), true);
              if (uniqRes === undefined) return undefined;
              outLines = uniqRes;
            } else if (inlineSedMatch) {
              if (sIdx === 0 && cmd0FileStage) {
                const sedLines = this.evalSyncMultiFileText("sed", stageArgs, rawState.cwd, byteLocale(rawState.variables), true);
                if (sedLines === undefined) return undefined;
                outLines = sedLines;
                sedTerminated = true;
              } else {
                const sedRes = this.evalSyncSed(rawLines, stageArgs, true);
                if (sedRes === undefined) return undefined;
                outLines = sedRes.lines;
                sedTerminated = sedRes.lastInputIndex < rawLines.length - 1;
              }
            } else if (isInlineAwk) {
              const awkRes = (sIdx === 0 && cmd0FileStage)
                ? this.evalSyncMultiFileText("awk", stageArgs, rawState.cwd, byteLocale(rawState.variables))
                : this.evalSyncAwk(rawLines, stageArgs);
              if (awkRes === undefined) return undefined;
              outLines = awkRes;
            } else if (isInlineGrep) {
              const grepRes = (sIdx === 0 && cmd0FileStage)
                ? this.evalSyncGrepWithFiles(stageArgs, false, false, Boolean(rawState.errexit), rawState.cwd, undefined, true)
                : (this.evalSyncGrep(rawLines, stageArgs, Boolean(rawState.errexit)) ?? this.evalSyncGrepWithFiles(stageArgs, false, false, Boolean(rawState.errexit), rawState.cwd, rawLines, true));
              if (grepRes === undefined) return undefined;
              stageStatus = grepRes.status;
              if (stageStatus !== 0) failureStatus = stageStatus;
              outLines = grepRes.lines;
            } else if (isInlineTac) {
              if (sIdx === 0 && cmd0FileStage) {
                const tacRes = this.evalSyncMultiFileText("tac", stageArgs, rawState.cwd, false);
                if (tacRes === undefined) return undefined;
                outLines = tacRes;
                sedTerminated = true;
              } else {
                outLines = [...rawLines].reverse();
                if (!inStr.endsWith("\n") && outLines.length > 1) {
                  outLines.splice(0, 2, outLines[0]! + outLines[1]!);
                }
              }
            } else if (isInlineNl) {
              const nlRes = this.evalSyncNl(rawLines, stageArgs, rawState.cwd);
              if (nlRes === undefined) return undefined;
              outLines = nlRes;
            } else if (isInlinePaste) {
              const pasteRes = this.evalSyncPaste(rawLines, stageArgs, rawState.cwd, true);
              if (pasteRes === undefined) return undefined;
              outLines = pasteRes;
            } else if (isInlineNumfmt) {
              const nmRes = this.evalSyncNumfmt(rawLines, stageArgs);
              if (nmRes === undefined) return undefined;
              outLines = nmRes;
            } else if (isInlineColumn) {
              const colRes = (sIdx === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("column", stageArgs, rawState.cwd, false) : this.evalSyncColumn(rawLines, stageArgs);
              if (colRes === undefined) return undefined;
              outLines = colRes;
            } else if (isInlineFold) {
              const foldRes = (sIdx === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("fold", stageArgs, rawState.cwd, false) : this.evalSyncFold(rawLines, stageArgs);
              if (foldRes === undefined) return undefined;
              outLines = foldRes;
            } else if (isInlineExpand) {
              const expRes = (sIdx === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("expand", stageArgs, rawState.cwd, false) : this.evalSyncExpand(rawLines, stageArgs);
              if (expRes === undefined) return undefined;
              outLines = expRes;
            } else if (isInlineUnexpand) {
              const unexpRes = (sIdx === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("unexpand", stageArgs, rawState.cwd, false) : this.evalSyncUnexpand(rawLines, stageArgs);
              if (unexpRes === undefined) return undefined;
              outLines = unexpRes;
            } else if (isInlineStrings) {
              const strRes = (sIdx === 0 && cmd0FileStage) ? this.evalSyncMultiFileText("strings", stageArgs, rawState.cwd, false) : this.evalSyncStrings(rawLines, stageArgs);
              if (strRes === undefined) return undefined;
              outLines = strRes;
            } else if (isInlineComm) {
              const commRes = this.evalSyncComm(rawLines, stageArgs, rawState.cwd, true);
              if (commRes === undefined) return undefined;
              outLines = commRes;
            } else if (isInlineJoin) {
              const joinRes = this.evalSyncJoin(rawLines, stageArgs, rawState.cwd);
              if (joinRes === undefined) return undefined;
              outLines = joinRes;
            } else if (isInlineBase64) {
              let b64In: Uint8Array = prevBuf.subarray(0, prevLen);
              let b64Args = stageArgs;
              if (sIdx === 0 && cmd0FileStage) {
                const fPath = stageArgs[stageArgs.length - 1]!;
                const fView = this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, fPath), true, true);
                if (!fView || fView.byteLength > 16384) return undefined;
                b64In = fView;
                b64Args = stageArgs.slice(0, -1);
              }
              const b64Out = this.evalSyncBase64(b64In, b64Args);
              if (b64Out === undefined) return undefined;
              const encoded = fastSharedTextEncoder.encode(b64Out);
              const nextTotalBytes = this.budget.bytes + encoded.byteLength;
              if (nextTotalBytes > this.budget.maxOutputBytesSmi && encoded.byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
              this.budget.bytes = nextTotalBytes;
              if (encoded.byteLength > nextBuf.byteLength) nextBuf = new Uint8Array(encoded.byteLength);
              nextBuf.set(encoded, 0);
              prevBuf = nextBuf;
              prevLen = encoded.byteLength;
              continue;
            } else if (isInlineJq) {
              const jqRes = this.evalSyncJq((sIdx === 0 && cmd0FileStage) ? undefined : inStr.trim(), stageArgs, rawState.cwd, (sIdx === 0 && cmd0FileStage) ? undefined : inStr);
              if (jqRes === undefined) return undefined;
              outLines = jqRes;
            } else if (firstName === "bc") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const bcRes = this.evalSyncBc(inStr.trim(), stageArgs, readFile);
              if (bcRes === undefined) return undefined;
              outLines = bcRes;
            } else if (firstName === "factor") {
              const fRes = this.evalSyncFactor(rawLines, stageArgs);
              if (fRes === undefined) return undefined;
              outLines = fRes;
            } else if (firstName === "tsort") {
              const tsRes = this.evalSyncTsort(rawLines, stageArgs, rawState.cwd);
              if (tsRes === undefined) return undefined;
              outLines = tsRes;
            } else if (firstName === "base32" || firstName === "dos2unix" || firstName === "unix2dos" || firstName === "iconv" || firstName === "gzip" || firstName === "gunzip" || firstName === "zcat" || firstName === "unzstd" || firstName === "zstdcat" || firstName === "zstd" || firstName === "bzip2" || firstName === "bunzip2" || firstName === "bzcat" || firstName === "xz" || firstName === "unxz" || firstName === "xzcat" || firstName === "lzma" || firstName === "unlzma" || firstName === "lzcat") {
              const rawSlice = prevBuf.subarray(0, prevLen);
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const b32Bytes = firstName === "base32"
                ? evalSyncBase32(rawSlice, stageArgs, readFile)
                : firstName === "iconv"
                  ? evalSyncIconv(sIdx === 0 && cmd0FileStage ? undefined : rawSlice, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : (firstName === "gzip" || firstName === "gunzip" || firstName === "zcat" || firstName === "unzstd" || firstName === "zstdcat" || firstName === "zstd" || firstName === "bzip2" || firstName === "bunzip2" || firstName === "bzcat" || firstName === "xz" || firstName === "unxz" || firstName === "xzcat" || firstName === "lzma" || firstName === "unlzma" || firstName === "lzcat")
                    ? evalSyncCompression(firstName, sIdx === 0 && cmd0FileStage ? undefined : rawSlice, stageArgs, readFile)
                    : evalSyncLineEndings(firstName, sIdx === 0 && cmd0FileStage ? undefined : rawSlice, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
              if (b32Bytes === undefined) return undefined;
              const nextTotalBytes = this.budget.bytes + b32Bytes.byteLength;
              if (nextTotalBytes > this.budget.maxOutputBytesSmi && b32Bytes.byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
              this.budget.bytes = nextTotalBytes;
              if (b32Bytes.byteLength > nextBuf.byteLength) nextBuf = new Uint8Array(b32Bytes.byteLength);
              nextBuf.set(b32Bytes, 0);
              prevBuf = nextBuf;
              prevLen = b32Bytes.byteLength;
              continue;
            } else if (firstName === "md5sum" || firstName === "sha1sum" || firstName === "sha224sum" || firstName === "sha256sum" || firstName === "sha384sum" || firstName === "sha512sum" || firstName === "cksum") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const ckStr = evalSyncChecksum(firstName, prevBuf.subarray(0, prevLen), stageArgs, readFile);
              if (ckStr === undefined) return undefined;
              const encoded = fastSharedTextEncoder.encode(ckStr);
              const nextTotalBytes = this.budget.bytes + encoded.byteLength;
              if (nextTotalBytes > this.budget.maxOutputBytesSmi && encoded.byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
              this.budget.bytes = nextTotalBytes;
              if (encoded.byteLength > nextBuf.byteLength) nextBuf = new Uint8Array(encoded.byteLength);
              nextBuf.set(encoded, 0);
              prevBuf = nextBuf;
              prevLen = encoded.byteLength;
              continue;
            } else if (firstName === "envsubst" || firstName === "xxd" || firstName === "od" || firstName === "hexdump" || firstName === "hd" || firstName === "fmt" || firstName === "csvcut" || firstName === "csvgrep" || firstName === "htmlq" || firstName === "xmllint" || firstName === "xq" || firstName === "yq" || firstName === "mdq" || firstName === "shuf" || firstName === "html-to-markdown" || firstName === "unrtf" || firstName === "pr" || firstName === "file" || firstName === "diff3" || firstName === "cmp" || firstName === "which" || firstName === "diff" || firstName === "xan" || firstName === "less" || firstName === "more" || firstName === "df" || firstName === "du" || firstName === "tree" || firstName === "stat" || firstName === "fd" || firstName === "rg" || firstName === "readlink" || firstName === "realpath" || firstName === "ls" || firstName === "find" || firstName === "csvlook" || firstName === "csvjson" || firstName === "csvsort" || firstName === "csvformat" || firstName === "csvstat" || firstName === "in2csv" || firstName === "csvstack" || firstName === "csvjoin" || firstName === "dd" || firstName === "xargs" || firstName === "openssl" || firstName === "sqlite3" || firstName === "gpg" || firstName === "ssh" || firstName === "ssh-keygen" || firstName === "pdfinfo" || firstName === "pdffonts" || firstName === "pdftotext" || firstName === "pdftohtml" || firstName === "exiftool" || firstName === "qpdf" || firstName === "pdftk" || firstName === "sips" || firstName === "identify" || firstName === "magick" || firstName === "convert" || firstName === "pdfimages" || firstName === "pdfdetach" || firstName === "ffprobe" || firstName === "ffmpeg" || firstName === "gh" || firstName === "pdftoppm" || firstName === "pdftocairo" || firstName === "mmdc" || firstName === "pandoc" || firstName === "soffice" || firstName === "libreoffice" || firstName === "ssconvert" || firstName === "wkhtmltopdf" || firstName === "op" || firstName === "git" || firstName === "tar" || firstName === "unzip" || firstName === "zip" || firstName === "date" || firstName === "timeout" || firstName === "split" || firstName === "csplit" || firstName === "curl" || firstName === "wget" ||
            firstName === "sponge" ||
            firstName === "truncate" ||
            firstName === "install" ||
            firstName === "apply_patch" ||
            firstName === "head" || firstName === "tail" || firstName === "wc" || firstName === "cat" || firstName === "date" || firstName === "cal" || firstName === "ncal" || firstName === "getopt" || firstName === "pathchk" || firstName === "printenv" || firstName === "env" || firstName === "mktemp" || firstName === "tee" || firstName === "touch" || firstName === "cp" || firstName === "mv" || firstName === "rmdir" || firstName === "sleep" || firstName === "chmod" || firstName === "patch" || firstName === "mkdir" || firstName === "rm" || firstName === "ln" || ((stageArgs.includes("--help") || stageArgs.includes("--version")) && gnuInformationSync(firstName, stageArgs) !== undefined)) {
              const rawBytes = prevBuf.subarray(0, prevLen);
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const outStr = ((stageArgs.includes("--help") || stageArgs.includes("--version")) ? gnuInformationSync(firstName, stageArgs, false, (rawState.exported.has("POSIXLY_CORRECT") || rawState.allexport) && rawState.variables.POSIXLY_CORRECT !== undefined) : undefined) ?? (firstName === "envsubst"
                ? this.evalSyncEnvsubst(inStr, stageArgs, rawState)
                : firstName === "fmt"
                  ? this.evalSyncFmt(rawBytes, stageArgs, readFile)
                  : firstName === "date"
                    ? evalSyncDate(stageArgs, rawState.exported.has("TZ") ? rawState.variables.TZ : undefined, stageDefs[sIdx]!.execute, readFile, (p: string) => this.tryInspectMemoryNodeSync(resolvePath(rawState.cwd, p), true, true)?.mtimeMs, sIdx === 0 && cmd0FileStage ? undefined : rawBytes)
                  : firstName === "mdq"
                    ? evalSyncMdq(rawBytes, stageArgs, readFile)
                  : firstName === "shuf"
                    ? evalSyncShuf(rawBytes, stageArgs, readFile)
                  : firstName === "html-to-markdown"
                    ? evalSyncHtmlToMarkdown(rawBytes, stageArgs, readFile)
                  : firstName === "unrtf"
                    ? evalSyncUnrtf(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "pr"
                    ? evalSyncPr(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "file"
                    ? evalSyncFile(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), true))
                  : firstName === "diff3"
                    ? evalSyncDiff3(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "cmp"
                    ? evalSyncCmp(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "which"
                    ? evalSyncWhich(stageArgs, rawState.cwd, typeof rawState.variables.PATH === "string" ? rawState.variables.PATH : undefined, (p: string) => this.tryCheckMemoryExecutableFileSync(p, true))
                  : firstName === "diff"
                    ? evalSyncDiff(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "xan"
                    ? evalSyncXan(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : (firstName === "less" || firstName === "more")
                    ? evalSyncLess(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "df"
                    ? evalSyncDf(stageArgs, rawState.cwd, rawState.variables, (p: string) => this.tryInspectMemoryNodeSync(p, true), extDef.execute)
                  : firstName === "du"
                    ? evalSyncDu(stageArgs, rawState.cwd, rawState.variables, (p: string) => this.tryInspectMemoryNodeSync(p, true), true)
                  : firstName === "tree"
                    ? evalSyncTree(stageArgs, rawState.cwd, (p: string) => this.tryInspectMemoryNodeSync(p, true))
                  : firstName === "stat"
                    ? evalSyncStat(stageArgs, rawState.cwd, rawState.variables.QUOTING_STYLE, (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, true, follow))
                  : firstName === "fd"
                    ? evalSyncFd(stageArgs, rawState.cwd, (p: string) => this.tryInspectMemoryNodeSync(p, true), true)
                  : firstName === "rg"
                    ? evalSyncRg(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, true)
                  : firstName === "readlink"
                    ? evalSyncReadlink(stageArgs, rawState.cwd, (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, true, follow))
                  : firstName === "realpath"
                    ? evalSyncRealpath(stageArgs, rawState.cwd, (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, true, follow))
                  : firstName === "ls"
                    ? evalSyncLs(stageArgs, rawState.cwd, (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, true, follow))
                  : firstName === "find"
                    ? evalSyncFind(stageArgs, rawState.cwd, (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, true, follow), true)
                  : firstName === "csvlook"
                    ? syncCommandEvaluators.evalSyncCsvlook?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "csvjson"
                    ? syncCommandEvaluators.evalSyncCsvjson?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "csvsort"
                    ? syncCommandEvaluators.evalSyncCsvsort?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "csvformat"
                    ? syncCommandEvaluators.evalSyncCsvformat?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "csvstat"
                    ? syncCommandEvaluators.evalSyncCsvstat?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "in2csv"
                    ? syncCommandEvaluators.evalSyncIn2csv?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "csvstack"
                    ? syncCommandEvaluators.evalSyncCsvstack?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "csvjoin"
                    ? syncCommandEvaluators.evalSyncCsvjoin?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "dd"
                    ? evalSyncDd(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, sIdx < stageNames.length - 1)
                  : firstName === "xargs"
                    ? evalSyncXargs(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "openssl"
                    ? syncCommandEvaluators.evalSyncOpenssl?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "sqlite3"
                    ? syncCommandEvaluators.evalSyncSqlite3?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "gpg"
                    ? syncCommandEvaluators.evalSyncGpg?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "ssh"
                    ? syncCommandEvaluators.evalSyncSsh?.(stageArgs)
                  : firstName === "ssh-keygen"
                    ? syncCommandEvaluators.evalSyncSshKeygen?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "pdfinfo"
                    ? syncCommandEvaluators.evalSyncPdfinfo?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "pdftotext"
                    ? syncCommandEvaluators.evalSyncPdftotext?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "exiftool"
                    ? syncCommandEvaluators.evalSyncExiftool?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "pdffonts"
                    ? syncCommandEvaluators.evalSyncPdffonts?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "pdftohtml"
                    ? syncCommandEvaluators.evalSyncPdftohtml?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "qpdf"
                    ? syncCommandEvaluators.evalSyncQpdf?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "pdftk"
                    ? syncCommandEvaluators.evalSyncPdftk?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "sips"
                    ? syncCommandEvaluators.evalSyncSips?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : (firstName === "identify" || firstName === "magick" || firstName === "convert")
                    ? syncCommandEvaluators.evalSyncIdentify?.(firstName, sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "pdfimages"
                    ? syncCommandEvaluators.evalSyncPdfimages?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "pdfdetach"
                    ? syncCommandEvaluators.evalSyncPdfdetach?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "ffprobe"
                    ? syncCommandEvaluators.evalSyncFfprobe?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "ffmpeg"
                    ? syncCommandEvaluators.evalSyncFfmpeg?.(stageArgs)
                  : firstName === "gh"
                    ? syncCommandEvaluators.evalSyncGh?.(stageDefs[sIdx]!.execute, stageArgs, rawState.variables, rawState.cwd, readFile)
                  : firstName === "pdftoppm"
                    ? syncCommandEvaluators.evalSyncPdftoppm?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "pdftocairo"
                    ? syncCommandEvaluators.evalSyncPdftocairo?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "mmdc"
                    ? syncCommandEvaluators.evalSyncMmdc?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "pandoc"
                    ? syncCommandEvaluators.evalSyncPandoc?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : (firstName === "soffice" || firstName === "libreoffice")
                    ? syncCommandEvaluators.evalSyncSoffice?.(stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "ssconvert"
                    ? syncCommandEvaluators.evalSyncSsconvert?.(stageDefs[sIdx]!.execute, stageArgs, sIdx === 0 && cmd0FileStage ? undefined : rawBytes, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "wkhtmltopdf"
                    ? syncCommandEvaluators.evalSyncWkhtmltopdf?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "op"
                    ? syncCommandEvaluators.evalSyncOp?.(stageDefs[sIdx]!.execute, stageArgs, rawState.variables)
                  : firstName === "git"
                    ? syncCommandEvaluators.evalSyncGit?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, rawState.cwd, (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, p === "/", follow), (p: string) => this.tryReadMemoryFileViewSync(p, false, true), stageDefs[sIdx]!.execute)
                  : firstName === "tar"
                    ? evalSyncTar(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } })
                  : firstName === "unzip"
                    ? evalSyncUnzip(stageArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } })
                  : firstName === "zip"
                    ? evalSyncZip(stageArgs)
                  : firstName === "timeout"
                    ? syncCommandEvaluators.evalSyncTimeout?.(stageArgs)
                  : firstName === "split"
                    ? syncCommandEvaluators.evalSyncSplit?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
                  : firstName === "csplit"
                    ? syncCommandEvaluators.evalSyncCsplit?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
                  : firstName === "curl"
                    ? syncCommandEvaluators.evalSyncCurl?.(stageArgs)
                  : firstName === "wget"
                    ? syncCommandEvaluators.evalSyncWget?.(stageArgs)
                  : firstName === "sponge"
                    ? syncCommandEvaluators.evalSyncSponge?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
                  : firstName === "truncate"
                    ? syncCommandEvaluators.evalSyncTruncate?.(stageArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
                  : firstName === "install"
                    ? syncCommandEvaluators.evalSyncInstall?.(stageArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } })
                  : firstName === "apply_patch"
                    ? syncCommandEvaluators.evalSyncApplyPatch?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
                  : firstName === "mktemp"
                    ? syncCommandEvaluators.evalSyncMktemp?.(stageArgs, rawState.variables, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o600 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), false, 0o700 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "tee"
                    ? syncCommandEvaluators.evalSyncTee?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "touch"
                    ? syncCommandEvaluators.evalSyncTouch?.(stageArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), readFile, (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, (p: string, upd) => this.tryUtimesMemoryNodeSync(resolvePath(rawState.cwd, p), upd, false), rawState.exported.has("TZ") ? rawState.variables.TZ : undefined)
                  : firstName === "cp"
                    ? syncCommandEvaluators.evalSyncCp?.(stageArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), readFile, (p: string, b: Uint8Array, app: boolean, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string) => this.tryStatMemoryNodeModeSync(resolvePath(rawState.cwd, p), false), rawState.umask ?? 0o022)
                  : firstName === "mv"
                    ? syncCommandEvaluators.evalSyncMv?.(stageArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), readFile, (p: string, b: Uint8Array, app: boolean, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } }, (p: string) => this.tryStatMemoryNodeModeSync(resolvePath(rawState.cwd, p), false))
                  : firstName === "rmdir"
                    ? syncCommandEvaluators.evalSyncRmdir?.(stageArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string) => tryGetMemoryDirectoryEntryNamesSync(this.backingFs, resolvePath(rawState.cwd, p)), (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } })
                  : firstName === "sleep"
                    ? syncCommandEvaluators.evalSyncSleep?.(stageArgs)
                  : firstName === "chmod"
                    ? syncCommandEvaluators.evalSyncChmod?.(stageArgs, rawState.umask ?? 0o022, (p: string, chg) => this.tryChmodMemoryNodeSync(resolvePath(rawState.cwd, p), chg, false))
                  : (firstName === "cal" || firstName === "ncal")
                    ? (() => { const c = evalSyncCal(firstName, stageArgs, (rawState.exported.has("SOURCE_DATE_EPOCH") || rawState.allexport) ? rawState.variables.SOURCE_DATE_EPOCH : undefined); return c !== undefined ? (c.endsWith("\n") ? c : c + "\n") : undefined; })()
                  : firstName === "getopt"
                    ? (() => { const g = evalSyncGetopt(stageArgs, { GETOPT_COMPATIBLE: (rawState.exported.has("GETOPT_COMPATIBLE") || rawState.allexport) ? rawState.variables.GETOPT_COMPATIBLE : undefined, POSIXLY_CORRECT: (rawState.exported.has("POSIXLY_CORRECT") || rawState.allexport) ? rawState.variables.POSIXLY_CORRECT : undefined }); return g !== undefined ? (g.endsWith("\n") ? g : g + "\n") : undefined; })()
                  : firstName === "pathchk"
                    ? evalSyncPathchk(stageArgs, rawState.cwd, (p: string) => this.tryStatMemoryNodeTypeSync(p, true))
                  : firstName === "printenv"
                    ? evalSyncPrintenv(stageArgs, rawState.exported, rawState.variables, stageDefs[sIdx]!.execute)
                  : firstName === "env"
                    ? evalSyncEnv(stageArgs, rawState.exported, rawState.variables)
                  : firstName === "patch"
                    ? syncCommandEvaluators.evalSyncPatch?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile, (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                  : firstName === "mkdir"
                    ? syncCommandEvaluators.evalSyncMkdir?.(stageArgs, rawState.umask ?? 0o022, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string, rec: boolean, m: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), rec, m, this.commandSignal); } catch { return false; } })
                  : firstName === "rm"
                    ? syncCommandEvaluators.evalSyncRm?.(stageArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string) => tryGetMemoryDirectoryEntryNamesSync(this.backingFs, resolvePath(rawState.cwd, p)), (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } })
                  : firstName === "ln"
                    ? syncCommandEvaluators.evalSyncLn?.(stageArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } }, (s: string, d: string, sym: boolean) => this.tryLinkMemoryNodeSync(sym ? s : resolvePath(rawState.cwd, s), resolvePath(rawState.cwd, d), sym))
                  : firstName === "cat"
                    ? syncCommandEvaluators.evalSyncCat?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : (firstName === "head" || firstName === "tail")
                    ? syncCommandEvaluators.evalSyncHeadTail?.(firstName, sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, readFile)
                  : firstName === "wc"
                    ? syncCommandEvaluators.evalSyncWc?.(sIdx === 0 && cmd0FileStage ? undefined : rawBytes, stageArgs, byteLocale(rawState.variables), readFile)
                  : (firstName === "xq" || firstName === "yq")
                    ? this.evalSyncXqOrYq(firstName, rawBytes, stageArgs, readFile)
                  : firstName === "xmllint"
                    ? evalSyncXmllint(rawBytes, stageArgs, readFile)
                    : firstName === "htmlq"
                      ? evalSyncHtmlq(rawBytes, stageArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
                    : firstName === "csvcut"
                      ? evalSyncCsvcut(rawBytes, stageArgs, readFile)
                      : firstName === "csvgrep"
                        ? evalSyncCsvgrep(rawBytes, stageArgs, readFile)
                      : firstName === "xxd"
                        ? this.evalSyncXxd(rawBytes, stageArgs, readFile)
                        : firstName === "od"
                          ? this.evalSyncOd(rawBytes, stageArgs, readFile)
                          : this.evalSyncHexdump(rawBytes, stageArgs, firstName === "hd", readFile));
              if (outStr === undefined) return undefined;
              const encoded = fastSharedTextEncoder.encode(outStr);
              const nextTotalBytes = this.budget.bytes + encoded.byteLength;
              if (nextTotalBytes > this.budget.maxOutputBytesSmi && encoded.byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
              this.budget.bytes = nextTotalBytes;
              if (encoded.byteLength > nextBuf.byteLength) nextBuf = new Uint8Array(encoded.byteLength);
              nextBuf.set(encoded, 0);
              prevBuf = nextBuf;
              prevLen = encoded.byteLength;
              continue;
            }
            // These filters preserve the terminator of the final selected input line.
            const preservesTerminator = firstName === "head" || firstName === "tail" || firstName === "rev" || firstName === "sed";
            const outJoinSep = isGrepZeroOut ? "\0" : stageLineSep;
            const terminated = isInlineTac ? (sedTerminated || inStr.includes("\n")) : sedTerminated || !preservesTerminator || inStr.endsWith(stageLineSep) || firstName === "head" && outLines.length < rawLines.length;
            const outStr = outLines.length > 0 ? outLines.join(outJoinSep) + (terminated ? outJoinSep : "") : "";
            const outByteLen = shellValueByteLength(outStr);
            const nextTotalBytes = this.budget.bytes + outByteLen;
            if (nextTotalBytes > this.budget.maxOutputBytesSmi && outByteLen > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
            this.budget.bytes = nextTotalBytes;
            if (outByteLen > nextBuf.byteLength) nextBuf = new Uint8Array(outByteLen);
            const written = outStr.length === 0 ? 0 : fastSharedTextEncoder.encodeInto(outStr, nextBuf).written;
            prevBuf = nextBuf;
            prevLen = written;
            continue;
          }
          // A command executor may suspend. Decline before invoking it so the
          // ordinary pipeline owns its context and executes every stage once.
          return undefined;
        }
        if (prevBuf.subarray(0, prevLen).includes(0)) return undefined;
        completed = true;
      } finally {
        // Speculative stages are replayed by normal execution on any bailout.
        if (!completed) {
          this.budget.bytes = previousBytes;
          this.budget.commands = previousCommands;
        }
        syncPurePipelineSlotState.inUse = false;
        this.budget.leavePipelineStages(n);
      }
      const outStr = sharedSyncPipeDecoder.decode(prevBuf.subarray(0, prevLen));
      const status = rawState.pipefail ? failureStatus : stageStatus;
      rawState.substitutionStatus = status;
      rawState.status = status;
      let end = outStr.length;
      while (end > 0 && outStr.charCodeAt(end - 1) === 10) end--;
      return end === outStr.length ? outStr : outStr.slice(0, end);
    }
    if (pipeline.commands.length !== 1) return undefined;
    let cmd = pipeline.commands[0]!;
    if ((cmd.kind === "if" || cmd.kind === "case") && this.isPureSyncSubIfOrCase(cmd, rawState)) {
      const monitor = stateMonitor(state);
      if (!monitor) return undefined;
      let selectedBody: Script | undefined;
      if (cmd.kind === "if") {
        for (const br of cmd.branches) {
          const bc = br.condition.lists[0]!.pipelines[0]!.commands[0]!;
          let condOk = false;
          if (bc.kind === "arithmetic") {
            condOk = this.evalSyncLoopArithStmt(bc.expression, rawState, io, this._syncArithTouched ?? new Set(), bc.line ?? part.line) === true;
          } else if (bc.kind === "conditional") {
            const st = this.tryEvalConditionalSync(bc.expression, rawState, monitor, arrayStore(rawState), io, bc.line ?? part.line);
            if (st === undefined) return undefined;
            condOk = st === 0;
          } else {
            const bExpr = this.extractPosixBracketCondExpr(bc, rawState, true, br.body);
            if (!bExpr) return undefined;
            const st = this.tryEvalConditionalSync(bExpr, rawState, monitor, arrayStore(rawState), io, bc.line ?? part.line);
            if (st === undefined) return undefined;
            condOk = st === 0;
          }
          if (condOk) {
            selectedBody = br.body;
            break;
          }
        }
        if (!selectedBody) selectedBody = cmd.otherwise;
      } else {
        const subj = this.fastValueWord(cmd.subject, rawState, io, false, false, false, false, undefined, part.line);
        if (typeof subj !== "string") return undefined;
        const work = { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: (): never => this.budget.fail("maxExpansionBytes") };
        for (const cl of cmd.clauses) {
          let matched = false;
          for (const pw of cl.patterns) {
            if (pw.plain !== undefined && !pw.plain.startsWith("~") && tryMatchesPatternSync(pw.plain, subj, work, false, false) === true) {
              matched = true;
              break;
            }
          }
          if (matched) {
            selectedBody = cl.body;
            break;
          }
        }
      }
      if (!selectedBody) {
        rawState.substitutionStatus = 0;
        rawState.status = 0;
        return "";
      }
      cmd = selectedBody.lists[0]!.pipelines[0]!.commands[0]!;
    }
    const hasSingleStdinRedir =
      cmd.kind === "simple" &&
      cmd.redirects.length === 1 &&
      cmd.redirects[0]!.operator === "<" &&
      (cmd.redirects[0]!.descriptor === undefined || cmd.redirects[0]!.descriptor === 0) &&
      !cmd.redirects[0]!.move &&
      !cmd.redirects[0]!.document &&
      this.isPureArgWord(cmd.redirects[0]!.target, rawState);
    const hasSingleHereStringRedir =
      cmd.kind === "simple" &&
      cmd.redirects.length === 1 &&
      cmd.redirects[0]!.operator === "<<<" &&
      (cmd.redirects[0]!.descriptor === undefined || cmd.redirects[0]!.descriptor === 0) &&
      !cmd.redirects[0]!.move &&
      !cmd.redirects[0]!.document &&
      this.isPureSyncValueWord(cmd.redirects[0]!.target, rawState);
    if (cmd.kind !== "simple" || (cmd.redirects.length > 0 && !hasSingleStdinRedir && !hasSingleHereStringRedir) || cmd.words.length === 0) return undefined;
    let w0Plain = cmd.words[0]!.plain;
    if (!w0Plain || rawState.extensions?.builtins.has(w0Plain)) return undefined;
    if (w0Plain === "fmt" && !hasSingleStdinRedir && !hasSingleHereStringRedir && !io.stdinIsDefault) return undefined;
    if (w0Plain === "xxd" || w0Plain === "od" || w0Plain === "mktemp" || w0Plain === "chmod" || w0Plain === "uname" || w0Plain === "nproc" || w0Plain === "hostname" || w0Plain === "id" || w0Plain === "whoami") {
      const definition = this.commands.get(w0Plain);
      if (!definition || !builtInDirectContextExecutors.has(definition.execute)) return undefined;
    }
    if (cmd.words.length === 2 && cmd.redirects.length === 0 && (cmd.words[1]?.plain === "--help" || cmd.words[1]?.plain === "--version")) {
      const gnuInfo = gnuInformationSync(w0Plain, [cmd.words[1]!.plain!], false, (rawState.exported.has("POSIXLY_CORRECT") || rawState.allexport) && rawState.variables.POSIXLY_CORRECT !== undefined);
      if (gnuInfo !== undefined) {
        const extDef = this.commands.get(w0Plain);
        if (!extDef || !builtInDirectContextExecutors.has(extDef.execute)) return undefined;
        return gnuInfo.replace(/\n+$/, "");
      }
    }
    const isSingleFileTool =
      w0Plain === "cat" ||
      w0Plain === "head" ||
      w0Plain === "tail" ||
      w0Plain === "jq" ||
      w0Plain === "awk" ||
      w0Plain === "grep" ||
      w0Plain === "egrep" ||
      w0Plain === "fgrep" ||
      w0Plain === "sed" ||
      w0Plain === "cut" ||
      w0Plain === "wc" ||
      w0Plain === "sort" ||
      w0Plain === "uniq" ||
      w0Plain === "tr" ||
      (w0Plain === "base64" || w0Plain === "rev" || w0Plain === "tac" || w0Plain === "nl" || w0Plain === "paste" || w0Plain === "numfmt" || w0Plain === "column" || w0Plain === "fold" || w0Plain === "expand" || w0Plain === "unexpand" || w0Plain === "strings" || w0Plain === "comm" || w0Plain === "join") || w0Plain === "comm" || w0Plain === "join" || w0Plain === "paste" || w0Plain === "numfmt" || w0Plain === "nl" || w0Plain === "expr" || w0Plain === "bc" || w0Plain === "xxd" || w0Plain === "od" || w0Plain === "factor" || w0Plain === "tsort" || w0Plain === "envsubst" || w0Plain === "hexdump" || w0Plain === "hd" || w0Plain === "fmt" || w0Plain === "uname" || w0Plain === "id" || w0Plain === "whoami" || w0Plain === "hostname" || w0Plain === "nproc" || w0Plain === "getconf" || w0Plain === "locale" || w0Plain === "csvcut" || w0Plain === "csvgrep" || w0Plain === "getopt" || w0Plain === "dos2unix" || w0Plain === "unix2dos" || w0Plain === "iconv" || w0Plain === "gzip" || w0Plain === "gunzip" || w0Plain === "zcat" || w0Plain === "unzstd" || w0Plain === "zstdcat" || w0Plain === "zstd" || w0Plain === "bzip2" || w0Plain === "bunzip2" || w0Plain === "bzcat" || w0Plain === "xz" || w0Plain === "unxz" || w0Plain === "xzcat" || w0Plain === "lzma" || w0Plain === "unlzma" || w0Plain === "lzcat" || w0Plain === "htmlq" || w0Plain === "xmllint" || w0Plain === "xq" || w0Plain === "yq" || w0Plain === "mdq" || w0Plain === "shuf" || w0Plain === "html-to-markdown" || w0Plain === "unrtf" || w0Plain === "pr" || w0Plain === "pathchk" || w0Plain === "file" || w0Plain === "diff3" || w0Plain === "cmp" || w0Plain === "which" || w0Plain === "diff" || w0Plain === "xan" || w0Plain === "less" || w0Plain === "more" || w0Plain === "df" || w0Plain === "du" || w0Plain === "tree" || w0Plain === "stat" || w0Plain === "fd" || w0Plain === "rg" || w0Plain === "readlink" || w0Plain === "realpath" || w0Plain === "ls" || w0Plain === "find" || w0Plain === "csvlook" || w0Plain === "csvjson" || w0Plain === "csvsort" || w0Plain === "csvformat" || w0Plain === "csvstat" || w0Plain === "in2csv" || w0Plain === "csvstack" || w0Plain === "csvjoin" || w0Plain === "dd" || w0Plain === "env" || w0Plain === "xargs" || w0Plain === "openssl" || w0Plain === "sqlite3" || w0Plain === "gpg" || w0Plain === "ssh" || w0Plain === "ssh-keygen" || w0Plain === "pdfinfo" || w0Plain === "pdffonts" || w0Plain === "pdftotext" || w0Plain === "pdftohtml" || w0Plain === "exiftool" || w0Plain === "qpdf" || w0Plain === "pdftk" || w0Plain === "sips" || w0Plain === "identify" || w0Plain === "magick" || w0Plain === "convert" || w0Plain === "mogrify" || w0Plain === "composite" || w0Plain === "montage" || w0Plain === "compare" || w0Plain === "pdfimages" || w0Plain === "pdfdetach" || w0Plain === "ffprobe" || w0Plain === "ffmpeg" || w0Plain === "gh" || w0Plain === "pdftoppm" || w0Plain === "pdftocairo" || w0Plain === "mmdc" || w0Plain === "pandoc" || w0Plain === "soffice" || w0Plain === "libreoffice" || w0Plain === "ssconvert" || w0Plain === "wkhtmltopdf" || w0Plain === "op" || w0Plain === "git" || w0Plain === "tar" || w0Plain === "unzip" || w0Plain === "zip" || w0Plain === "timeout" || w0Plain === "split" || w0Plain === "csplit" || w0Plain === "curl" || w0Plain === "wget" || w0Plain === "sponge" || w0Plain === "truncate" || w0Plain === "install" || w0Plain === "apply_patch" || w0Plain === "mktemp" || w0Plain === "tee" || w0Plain === "touch" || w0Plain === "cp" || w0Plain === "mv" || w0Plain === "rmdir" || w0Plain === "sleep" || w0Plain === "chmod" || w0Plain === "patch" || w0Plain === "mkdir" || w0Plain === "rm" || w0Plain === "ln" || w0Plain === "date" || w0Plain === "printenv" || w0Plain === "egrep" || w0Plain === "fgrep" || w0Plain === "cal" || w0Plain === "ncal" || w0Plain === "md5sum" || w0Plain === "sha1sum" || w0Plain === "sha224sum" || w0Plain === "sha256sum" || w0Plain === "sha384sum" || w0Plain === "sha512sum" || w0Plain === "cksum" || w0Plain === "base32";
    if (isSingleFileTool && !hasShellFunction(rawState, w0Plain) && (this.commands.has(w0Plain) || ((w0Plain === "base64" || w0Plain === "rev" || w0Plain === "tac" || w0Plain === "nl" || w0Plain === "paste" || w0Plain === "column" || w0Plain === "fold" || w0Plain === "expand" || w0Plain === "unexpand" || w0Plain === "strings" || w0Plain === "comm" || w0Plain === "join" || w0Plain === "expr" || w0Plain === "bc" || w0Plain === "xxd" || w0Plain === "od" || w0Plain === "factor" || w0Plain === "tsort" || w0Plain === "envsubst" || w0Plain === "hexdump" || w0Plain === "hd" || w0Plain === "fmt" || w0Plain === "uname" || w0Plain === "id" || w0Plain === "whoami" || w0Plain === "hostname" || w0Plain === "nproc" || w0Plain === "getconf" || w0Plain === "locale" || w0Plain === "csvcut" || w0Plain === "csvgrep" || w0Plain === "getopt" || w0Plain === "dos2unix" || w0Plain === "unix2dos" || w0Plain === "iconv" || w0Plain === "gzip" || w0Plain === "gunzip" || w0Plain === "zcat" || w0Plain === "unzstd" || w0Plain === "zstdcat" || w0Plain === "zstd" || w0Plain === "bzip2" || w0Plain === "bunzip2" || w0Plain === "bzcat" || w0Plain === "xz" || w0Plain === "unxz" || w0Plain === "xzcat" || w0Plain === "lzma" || w0Plain === "unlzma" || w0Plain === "lzcat" || w0Plain === "htmlq" || w0Plain === "xmllint" || w0Plain === "xq" || w0Plain === "yq" || w0Plain === "mdq" || w0Plain === "shuf" || w0Plain === "html-to-markdown" || w0Plain === "unrtf" || w0Plain === "pr" || w0Plain === "pathchk" || w0Plain === "file" || w0Plain === "diff3" || w0Plain === "cmp" || w0Plain === "which" || w0Plain === "diff" || w0Plain === "xan" || w0Plain === "less" || w0Plain === "more" || w0Plain === "df" || w0Plain === "du" || w0Plain === "tree" || w0Plain === "stat" || w0Plain === "fd" || w0Plain === "rg" || w0Plain === "readlink" || w0Plain === "realpath" || w0Plain === "ls" || w0Plain === "find" || w0Plain === "csvlook" || w0Plain === "csvjson" || w0Plain === "csvsort" || w0Plain === "csvformat" || w0Plain === "csvstat" || w0Plain === "in2csv" || w0Plain === "csvstack" || w0Plain === "csvjoin" || w0Plain === "dd" || w0Plain === "env" || w0Plain === "xargs" || w0Plain === "openssl" || w0Plain === "sqlite3" || w0Plain === "gpg" || w0Plain === "ssh" || w0Plain === "ssh-keygen" || w0Plain === "pdfinfo" || w0Plain === "pdffonts" || w0Plain === "pdftotext" || w0Plain === "pdftohtml" || w0Plain === "exiftool" || w0Plain === "qpdf" || w0Plain === "pdftk" || w0Plain === "sips" || w0Plain === "identify" || w0Plain === "magick" || w0Plain === "convert" || w0Plain === "mogrify" || w0Plain === "composite" || w0Plain === "montage" || w0Plain === "compare" || w0Plain === "pdfimages" || w0Plain === "pdfdetach" || w0Plain === "ffprobe" || w0Plain === "ffmpeg" || w0Plain === "gh" || w0Plain === "pdftoppm" || w0Plain === "pdftocairo" || w0Plain === "mmdc" || w0Plain === "pandoc" || w0Plain === "soffice" || w0Plain === "libreoffice" || w0Plain === "ssconvert" || w0Plain === "wkhtmltopdf" || w0Plain === "op" || w0Plain === "git" || w0Plain === "tar" || w0Plain === "unzip" || w0Plain === "zip" || w0Plain === "timeout" || w0Plain === "split" || w0Plain === "csplit" || w0Plain === "curl" || w0Plain === "wget" || w0Plain === "sponge" || w0Plain === "truncate" || w0Plain === "install" || w0Plain === "apply_patch" || w0Plain === "mktemp" || w0Plain === "tee" || w0Plain === "touch" || w0Plain === "cp" || w0Plain === "mv" || w0Plain === "rmdir" || w0Plain === "sleep" || w0Plain === "chmod" || w0Plain === "patch" || w0Plain === "mkdir" || w0Plain === "rm" || w0Plain === "ln" || w0Plain === "date" || w0Plain === "printenv" || w0Plain === "egrep" || w0Plain === "fgrep" || w0Plain === "cal" || w0Plain === "ncal" || w0Plain === "md5sum" || w0Plain === "sha1sum" || w0Plain === "sha224sum" || w0Plain === "sha256sum" || w0Plain === "sha384sum" || w0Plain === "sha512sum" || w0Plain === "cksum" || w0Plain === "base32") && Boolean(this.commands.get(w0Plain))))) {
      const allArgs: string[] = [];
      let fOk = true;
      for (let i = 1; i < cmd.words.length; i++) {
        if (!this.isPureArgWord(cmd.words[i]!, rawState)) { fOk = false; break; }
        const val = this.fastValueWord(cmd.words[i]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof val !== "string") { fOk = false; break; }
        allArgs.push(val);
      }
      let redirTarget: string | undefined;
      let hereStrVal: string | undefined;
      if (fOk && hasSingleStdinRedir) {
        const rv = this.fastValueWord(cmd.redirects[0]!.target, state, io, true, false, false, true, undefined, part.line);
        if (typeof rv === "string") redirTarget = rv;
        else fOk = false;
      } else if (fOk && hasSingleHereStringRedir) {
        const hv = this.fastValueWord(cmd.redirects[0]!.target, state, io, false, false, false, false, undefined, part.line);
        if (typeof hv === "string" && hv.length <= 16384 && !hv.includes("\0")) hereStrVal = hv + "\n";
        else fOk = false;
      }
      if (fOk && (w0Plain === "uname" || w0Plain === "id" || w0Plain === "whoami" || w0Plain === "hostname" || w0Plain === "nproc" || w0Plain === "getconf" || w0Plain === "locale" || w0Plain === "cal" || w0Plain === "ncal") && !hasSingleStdinRedir && !hasSingleHereStringRedir) {
        const sysRes = this.evalSyncSysinfo(w0Plain, allArgs, rawState);
        if (sysRes !== undefined) {
          const outBytes = shellValueByteLength(sysRes) + 1;
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return sysRes;
        }
      }
      if (fOk && w0Plain === "getopt" && !hasSingleStdinRedir && !hasSingleHereStringRedir) {
        const getEnvVar = (name: string): string | undefined => {
          if (rawState.exported.has(name) || rawState.allexport) return rawState.variables[name];
          return undefined;
        };
        const goOut = evalSyncGetopt(allArgs, {
          GETOPT_COMPATIBLE: getEnvVar("GETOPT_COMPATIBLE"),
          POSIXLY_CORRECT: getEnvVar("POSIXLY_CORRECT"),
        });
        if (goOut !== undefined) {
          const outBytes = shellValueByteLength(goOut) + 1;
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return goOut;
        }
      }
      if (fOk && (w0Plain === "dos2unix" || w0Plain === "unix2dos" || w0Plain === "iconv" || w0Plain === "gzip" || w0Plain === "gunzip" || w0Plain === "zcat" || w0Plain === "unzstd" || w0Plain === "zstdcat" || w0Plain === "zstd" || w0Plain === "bzip2" || w0Plain === "bunzip2" || w0Plain === "bzcat" || w0Plain === "xz" || w0Plain === "unxz" || w0Plain === "xzcat" || w0Plain === "lzma" || w0Plain === "unlzma" || w0Plain === "lzcat") && !hasSingleStdinRedir) {
        const inBytes = hasSingleHereStringRedir ? fastSharedTextEncoder.encode(hereStrVal!) : undefined;
        const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
        const writeFile = (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } };
        const convBytes = w0Plain === "iconv"
          ? evalSyncIconv(inBytes, allArgs, readFile, writeFile)
          : (w0Plain === "gzip" || w0Plain === "gunzip" || w0Plain === "zcat" || w0Plain === "unzstd" || w0Plain === "zstdcat" || w0Plain === "zstd" || w0Plain === "bzip2" || w0Plain === "bunzip2" || w0Plain === "bzcat" || w0Plain === "xz" || w0Plain === "unxz" || w0Plain === "xzcat" || w0Plain === "lzma" || w0Plain === "unlzma" || w0Plain === "lzcat")
            ? evalSyncCompression(w0Plain, inBytes, allArgs, readFile)
            : evalSyncLineEndings(w0Plain, inBytes, allArgs, readFile, writeFile);
        if (convBytes !== undefined && !convBytes.includes(0)) {
          let convStr = sharedSyncPipeDecoder.decode(convBytes);
          const outBytes = convBytes.byteLength;
          let end = convStr.length;
          while (end > 0 && convStr.charCodeAt(end - 1) === 10) end--;
          if (end < convStr.length) convStr = convStr.slice(0, end);
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return convStr;
        }
      }
      if (fOk && w0Plain === "awk" && !hasSingleStdinRedir && !hasSingleHereStringRedir && allArgs.some(a => a.includes("BEGIN"))) {
        const awkBegin = this.evalSyncAwk([], allArgs);
        if (awkBegin !== undefined) {
          let res = awkBegin.join("\n") + (awkBegin.length > 0 ? "\n" : "");
          const outBytes = shellValueByteLength(res);
          let end = res.length;
          while (end > 0 && res.charCodeAt(end - 1) === 10) end--;
          if (end < res.length) res = res.slice(0, end);
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return res;
        }
      }
      if (fOk && w0Plain === "pathchk" && !hasSingleStdinRedir && !hasSingleHereStringRedir) {
        const statType = (p: string) => this.tryStatMemoryNodeTypeSync(p, true);
        const pOut = evalSyncPathchk(allArgs, rawState.cwd, statType);
        if (pOut !== undefined) {
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return pOut;
        }
      }
      if (fOk && (w0Plain === "date" || w0Plain === "printenv" || w0Plain === "env") && !hasSingleStdinRedir && !hasSingleHereStringRedir) {
        const ext = this.commands.get(w0Plain);
        const dpOut = w0Plain === "date"
          ? evalSyncDate(allArgs, rawState.exported.has("TZ") ? rawState.variables.TZ : undefined, ext?.execute, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true), (p: string) => this.tryInspectMemoryNodeSync(resolvePath(rawState.cwd, p), true, true)?.mtimeMs)
          : w0Plain === "env"
            ? evalSyncEnv(allArgs, rawState.exported, rawState.variables)
            : evalSyncPrintenv(allArgs, rawState.exported, rawState.variables, ext?.execute);
        if (dpOut !== undefined && !dpOut.includes("\0")) {
          let res = dpOut;
          const outBytes = shellValueByteLength(res);
          let end = res.length;
          while (end > 0 && res.charCodeAt(end - 1) === 10) end--;
          if (end < res.length) res = res.slice(0, end);
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return res;
        }
      }
      if (fOk && (w0Plain === "df" || w0Plain === "du" || w0Plain === "tree" || w0Plain === "stat" || w0Plain === "fd" || w0Plain === "readlink" || w0Plain === "realpath" || w0Plain === "ls" || w0Plain === "find") && !hasSingleStdinRedir && !hasSingleHereStringRedir) {
        const inspectNode = (p: string) => this.tryInspectMemoryNodeSync(p, true);
        const inspectStat = (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, true, follow);
        const vfsOut = w0Plain === "df"
          ? evalSyncDf(allArgs, rawState.cwd, rawState.variables, inspectNode, this.commands.get("df")?.execute)
          : w0Plain === "du"
            ? evalSyncDu(allArgs, rawState.cwd, rawState.variables, inspectNode)
            : w0Plain === "tree"
              ? evalSyncTree(allArgs, rawState.cwd, inspectNode)
              : w0Plain === "stat"
                ? evalSyncStat(allArgs, rawState.cwd, rawState.variables.QUOTING_STYLE, inspectStat)
                : w0Plain === "fd"
                  ? evalSyncFd(allArgs, rawState.cwd, inspectNode)
                  : w0Plain === "readlink"
                    ? evalSyncReadlink(allArgs, rawState.cwd, inspectStat)
                    : w0Plain === "realpath"
                      ? evalSyncRealpath(allArgs, rawState.cwd, inspectStat)
                      : w0Plain === "find"
                        ? evalSyncFind(allArgs, rawState.cwd, inspectStat)
                        : evalSyncLs(allArgs, rawState.cwd, inspectStat);
        if (vfsOut !== undefined && !vfsOut.includes("\0")) {
          let res = vfsOut;
          const outBytes = shellValueByteLength(res);
          let end = res.length;
          while (end > 0 && res.charCodeAt(end - 1) === 10) end--;
          if (end < res.length) res = res.slice(0, end);
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return res;
        }
      }
      if (fOk && w0Plain === "which" && !hasSingleStdinRedir && !hasSingleHereStringRedir) {
        const wOut = evalSyncWhich(allArgs, rawState.cwd, typeof rawState.variables.PATH === "string" ? rawState.variables.PATH : undefined, (p: string) => this.tryCheckMemoryExecutableFileSync(p, true));
        if (wOut !== undefined) {
          let res = wOut;
          const outBytes = shellValueByteLength(res);
          let end = res.length;
          while (end > 0 && res.charCodeAt(end - 1) === 10) end--;
          if (end < res.length) res = res.slice(0, end);
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return res;
        }
      }
      if (fOk && (w0Plain === "csvcut" || w0Plain === "csvgrep" || w0Plain === "csvlook" || w0Plain === "csvjson" || w0Plain === "csvsort" || w0Plain === "csvformat" || w0Plain === "csvstat" || w0Plain === "in2csv" || w0Plain === "csvstack" || w0Plain === "csvjoin" || w0Plain === "dd" || w0Plain === "xargs" || w0Plain === "openssl" || w0Plain === "sqlite3" || w0Plain === "gpg" || w0Plain === "ssh" || w0Plain === "ssh-keygen" || w0Plain === "pdfinfo" || w0Plain === "pdffonts" || w0Plain === "pdftotext" || w0Plain === "pdftohtml" || w0Plain === "exiftool" || w0Plain === "qpdf" || w0Plain === "pdftk" || w0Plain === "sips" || w0Plain === "identify" || w0Plain === "magick" || w0Plain === "convert" || w0Plain === "mogrify" || w0Plain === "composite" || w0Plain === "montage" || w0Plain === "compare" || w0Plain === "pdfimages" || w0Plain === "pdfdetach" || w0Plain === "ffprobe" || w0Plain === "ffmpeg" || w0Plain === "gh" || w0Plain === "pdftoppm" || w0Plain === "pdftocairo" || w0Plain === "mmdc" || w0Plain === "pandoc" || w0Plain === "soffice" || w0Plain === "libreoffice" || w0Plain === "ssconvert" || w0Plain === "wkhtmltopdf" || w0Plain === "op" || w0Plain === "git" || w0Plain === "tar" || w0Plain === "unzip" || w0Plain === "zip" || w0Plain === "timeout" || w0Plain === "split" || w0Plain === "csplit" || w0Plain === "curl" || w0Plain === "wget" || w0Plain === "sponge" || w0Plain === "truncate" || w0Plain === "install" || w0Plain === "apply_patch" || w0Plain === "mktemp" || w0Plain === "tee" || w0Plain === "touch" || w0Plain === "cp" || w0Plain === "mv" || w0Plain === "rmdir" || w0Plain === "sleep" || w0Plain === "chmod" || w0Plain === "patch" || w0Plain === "mkdir" || w0Plain === "rm" || w0Plain === "ln" || w0Plain === "wc" || w0Plain === "htmlq" || w0Plain === "xmllint" || w0Plain === "xq" || w0Plain === "yq" || w0Plain === "mdq" || w0Plain === "shuf" || w0Plain === "html-to-markdown" || w0Plain === "unrtf" || w0Plain === "fmt" || w0Plain === "pr" || w0Plain === "file" || w0Plain === "diff3" || w0Plain === "cmp" || w0Plain === "diff" || w0Plain === "xan" || w0Plain === "less" || w0Plain === "more" || w0Plain === "rg" || w0Plain === "md5sum" || w0Plain === "sha1sum" || w0Plain === "sha224sum" || w0Plain === "sha256sum" || w0Plain === "sha384sum" || w0Plain === "sha512sum" || w0Plain === "cksum" || w0Plain === "base32") && !hasSingleStdinRedir && (hasSingleHereStringRedir || w0Plain === "shuf" || w0Plain === "dd" || w0Plain === "xargs" || w0Plain === "openssl" || w0Plain === "sqlite3" || w0Plain === "gpg" || w0Plain === "ssh" || w0Plain === "ssh-keygen" || w0Plain === "pdfinfo" || w0Plain === "pdffonts" || w0Plain === "pdftotext" || w0Plain === "pdftohtml" || w0Plain === "exiftool" || w0Plain === "qpdf" || w0Plain === "pdftk" || w0Plain === "sips" || w0Plain === "identify" || w0Plain === "magick" || w0Plain === "convert" || w0Plain === "mogrify" || w0Plain === "composite" || w0Plain === "montage" || w0Plain === "compare" || w0Plain === "pdfimages" || w0Plain === "pdfdetach" || w0Plain === "ffprobe" || w0Plain === "ffmpeg" || w0Plain === "gh" || w0Plain === "pdftoppm" || w0Plain === "pdftocairo" || w0Plain === "mmdc" || w0Plain === "pandoc" || w0Plain === "soffice" || w0Plain === "libreoffice" || w0Plain === "ssconvert" || w0Plain === "wkhtmltopdf" || w0Plain === "op" || w0Plain === "git" || w0Plain === "tar" || w0Plain === "unzip" || w0Plain === "zip" || w0Plain === "timeout" || w0Plain === "split" || w0Plain === "csplit" || w0Plain === "curl" || w0Plain === "wget" || w0Plain === "sponge" || w0Plain === "truncate" || w0Plain === "install" || w0Plain === "apply_patch" || w0Plain === "mktemp" || w0Plain === "tee" || w0Plain === "touch" || w0Plain === "cp" || w0Plain === "mv" || w0Plain === "rmdir" || w0Plain === "sleep" || w0Plain === "chmod" || w0Plain === "patch" || w0Plain === "mkdir" || w0Plain === "rm" || w0Plain === "ln" || allArgs.some(a => (a !== "-" && !a.startsWith("-")) || a.startsWith("--files0-from") || a === "-n" || a === "--null-input"))) {
        const inBytes = hasSingleHereStringRedir ? fastSharedTextEncoder.encode(hereStrVal!) : EMPTY_BYTES;
        const optInBytes = hasSingleHereStringRedir ? inBytes : undefined;
        const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
        let csvOut = w0Plain === "csvcut"
          ? evalSyncCsvcut(optInBytes, allArgs, readFile)
          : w0Plain === "csvgrep"
            ? evalSyncCsvgrep(optInBytes, allArgs, readFile)
          : w0Plain === "csvlook"
            ? syncCommandEvaluators.evalSyncCsvlook?.(optInBytes, allArgs, readFile)
          : w0Plain === "csvjson"
            ? syncCommandEvaluators.evalSyncCsvjson?.(optInBytes, allArgs, readFile)
          : w0Plain === "csvsort"
            ? syncCommandEvaluators.evalSyncCsvsort?.(optInBytes, allArgs, readFile)
          : w0Plain === "csvformat"
            ? syncCommandEvaluators.evalSyncCsvformat?.(optInBytes, allArgs, readFile)
          : w0Plain === "csvstat"
            ? syncCommandEvaluators.evalSyncCsvstat?.(optInBytes, allArgs, readFile)
          : w0Plain === "in2csv"
            ? syncCommandEvaluators.evalSyncIn2csv?.(optInBytes, allArgs, readFile)
          : w0Plain === "csvstack"
            ? syncCommandEvaluators.evalSyncCsvstack?.(optInBytes, allArgs, readFile)
          : w0Plain === "csvjoin"
            ? syncCommandEvaluators.evalSyncCsvjoin?.(optInBytes, allArgs, readFile)
          : w0Plain === "dd"
            ? evalSyncDd(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "xargs"
            ? evalSyncXargs(optInBytes, allArgs, readFile)
          : w0Plain === "openssl"
            ? syncCommandEvaluators.evalSyncOpenssl?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "sqlite3"
            ? syncCommandEvaluators.evalSyncSqlite3?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "gpg"
            ? syncCommandEvaluators.evalSyncGpg?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "ssh"
            ? syncCommandEvaluators.evalSyncSsh?.(allArgs)
          : w0Plain === "ssh-keygen"
            ? syncCommandEvaluators.evalSyncSshKeygen?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, rawState.cwd)
          : w0Plain === "pdfinfo"
            ? syncCommandEvaluators.evalSyncPdfinfo?.(optInBytes, allArgs, readFile)
          : w0Plain === "pdftotext"
            ? syncCommandEvaluators.evalSyncPdftotext?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "exiftool"
            ? syncCommandEvaluators.evalSyncExiftool?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "pdffonts"
            ? syncCommandEvaluators.evalSyncPdffonts?.(optInBytes, allArgs, readFile)
          : w0Plain === "pdftohtml"
            ? syncCommandEvaluators.evalSyncPdftohtml?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "qpdf"
            ? syncCommandEvaluators.evalSyncQpdf?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "pdftk"
            ? syncCommandEvaluators.evalSyncPdftk?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "sips"
            ? syncCommandEvaluators.evalSyncSips?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : (w0Plain === "identify" || w0Plain === "magick" || w0Plain === "convert" || w0Plain === "mogrify" || w0Plain === "composite" || w0Plain === "montage" || w0Plain === "compare")
            ? syncCommandEvaluators.evalSyncIdentify?.(w0Plain, optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "pdfimages"
            ? syncCommandEvaluators.evalSyncPdfimages?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "pdfdetach"
            ? syncCommandEvaluators.evalSyncPdfdetach?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "ffprobe"
            ? syncCommandEvaluators.evalSyncFfprobe?.(optInBytes, allArgs, readFile)
          : w0Plain === "ffmpeg"
            ? syncCommandEvaluators.evalSyncFfmpeg?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "gh"
            ? syncCommandEvaluators.evalSyncGh?.(this.commands.get("gh")!.execute, allArgs, rawState.variables, rawState.cwd, readFile)
          : w0Plain === "pdftoppm"
            ? syncCommandEvaluators.evalSyncPdftoppm?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "pdftocairo"
            ? syncCommandEvaluators.evalSyncPdftocairo?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "mmdc"
            ? syncCommandEvaluators.evalSyncMmdc?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "pandoc"
            ? syncCommandEvaluators.evalSyncPandoc?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : (w0Plain === "soffice" || w0Plain === "libreoffice")
            ? syncCommandEvaluators.evalSyncSoffice?.(allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "ssconvert"
            ? syncCommandEvaluators.evalSyncSsconvert?.(this.commands.get("ssconvert")!.execute, allArgs, optInBytes, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "wkhtmltopdf"
            ? syncCommandEvaluators.evalSyncWkhtmltopdf?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "op"
            ? syncCommandEvaluators.evalSyncOp?.(this.commands.get("op")!.execute, allArgs, rawState.variables)
          : w0Plain === "git"
            ? syncCommandEvaluators.evalSyncGit?.(optInBytes, allArgs, rawState.cwd, (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, p === "/", follow), (p: string) => this.tryReadMemoryFileViewSync(p, false, true), this.commands.get("git")!.execute, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const dir = p.slice(0, p.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, p, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, p, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, p, this.commandSignal); } catch { return false; } })
          : w0Plain === "tar"
            ? evalSyncTar(optInBytes, allArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } })
          : w0Plain === "unzip"
            ? evalSyncUnzip(allArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } })
          : w0Plain === "zip"
            ? evalSyncZip(allArgs)
          : w0Plain === "timeout"
            ? syncCommandEvaluators.evalSyncTimeout?.(allArgs)
          : w0Plain === "split"
            ? syncCommandEvaluators.evalSyncSplit?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
          : w0Plain === "csplit"
            ? syncCommandEvaluators.evalSyncCsplit?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
          : w0Plain === "curl"
            ? syncCommandEvaluators.evalSyncCurl?.(allArgs)
          : w0Plain === "wget"
            ? syncCommandEvaluators.evalSyncWget?.(allArgs)
          : w0Plain === "sponge"
            ? syncCommandEvaluators.evalSyncSponge?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
          : w0Plain === "truncate"
            ? syncCommandEvaluators.evalSyncTruncate?.(allArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
          : w0Plain === "install"
            ? syncCommandEvaluators.evalSyncInstall?.(allArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } })
          : w0Plain === "apply_patch"
            ? syncCommandEvaluators.evalSyncApplyPatch?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } })
          : w0Plain === "mktemp"
            ? syncCommandEvaluators.evalSyncMktemp?.(allArgs, rawState.variables, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o600 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), false, 0o700 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "tee"
            ? syncCommandEvaluators.evalSyncTee?.(optInBytes, allArgs, (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "touch"
            ? syncCommandEvaluators.evalSyncTouch?.(allArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), readFile, (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, (p: string, upd) => this.tryUtimesMemoryNodeSync(resolvePath(rawState.cwd, p), upd, false), rawState.exported.has("TZ") ? rawState.variables.TZ : undefined)
          : w0Plain === "cp"
            ? syncCommandEvaluators.evalSyncCp?.(allArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), readFile, (p: string, b: Uint8Array, app: boolean, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string) => this.tryStatMemoryNodeModeSync(resolvePath(rawState.cwd, p), false), rawState.umask ?? 0o022)
          : w0Plain === "mv"
            ? syncCommandEvaluators.evalSyncMv?.(allArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), readFile, (p: string, b: Uint8Array, app: boolean, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } }, (p: string) => this.tryStatMemoryNodeModeSync(resolvePath(rawState.cwd, p), false))
          : w0Plain === "rmdir"
            ? syncCommandEvaluators.evalSyncRmdir?.(allArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string) => tryGetMemoryDirectoryEntryNamesSync(this.backingFs, resolvePath(rawState.cwd, p)), (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } })
          : w0Plain === "sleep"
            ? syncCommandEvaluators.evalSyncSleep?.(allArgs)
          : w0Plain === "chmod"
            ? syncCommandEvaluators.evalSyncChmod?.(allArgs, rawState.umask ?? 0o022, (p: string, chg) => this.tryChmodMemoryNodeSync(resolvePath(rawState.cwd, p), chg, false))
          : w0Plain === "patch"
            ? syncCommandEvaluators.evalSyncPatch?.(optInBytes, allArgs, readFile, (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } })
          : w0Plain === "mkdir"
            ? syncCommandEvaluators.evalSyncMkdir?.(allArgs, rawState.umask ?? 0o022, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string, rec: boolean, m: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), rec, m, this.commandSignal); } catch { return false; } })
          : w0Plain === "rm"
            ? syncCommandEvaluators.evalSyncRm?.(allArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string) => tryGetMemoryDirectoryEntryNamesSync(this.backingFs, resolvePath(rawState.cwd, p)), (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } })
          : w0Plain === "wc"
            ? syncCommandEvaluators.evalSyncWc?.(optInBytes, allArgs, byteLocale(rawState.variables), readFile)
          : w0Plain === "ln"
            ? syncCommandEvaluators.evalSyncLn?.(allArgs, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } }, (s: string, d: string, sym: boolean) => this.tryLinkMemoryNodeSync(sym ? s : resolvePath(rawState.cwd, s), resolvePath(rawState.cwd, d), sym))
          : (allArgs.includes("--help") || allArgs.includes("--version")) && gnuInformationSync(w0Plain, allArgs, false, (rawState.exported.has("POSIXLY_CORRECT") || rawState.allexport) && rawState.variables.POSIXLY_CORRECT !== undefined) !== undefined
            ? gnuInformationSync(w0Plain, allArgs, false, (rawState.exported.has("POSIXLY_CORRECT") || rawState.allexport) && rawState.variables.POSIXLY_CORRECT !== undefined)
            : w0Plain === "mdq"
              ? evalSyncMdq(inBytes, allArgs, readFile)
            : w0Plain === "shuf"
              ? evalSyncShuf(inBytes, allArgs, readFile)
            : w0Plain === "html-to-markdown"
              ? evalSyncHtmlToMarkdown(inBytes, allArgs, readFile)
            : w0Plain === "unrtf"
              ? evalSyncUnrtf(optInBytes, allArgs, readFile)
            : w0Plain === "fmt"
              ? this.evalSyncFmt(inBytes, allArgs, readFile)
            : w0Plain === "pr"
              ? evalSyncPr(optInBytes, allArgs, readFile)
            : w0Plain === "file"
              ? evalSyncFile(optInBytes, allArgs, readFile, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), true))
            : w0Plain === "diff3"
              ? evalSyncDiff3(optInBytes, allArgs, readFile)
            : w0Plain === "cmp"
              ? evalSyncCmp(optInBytes, allArgs, readFile)
            : w0Plain === "diff"
              ? evalSyncDiff(optInBytes, allArgs, readFile)
            : w0Plain === "xan"
              ? evalSyncXan(optInBytes, allArgs, readFile)
            : (w0Plain === "less" || w0Plain === "more")
              ? evalSyncLess(optInBytes, allArgs, readFile)
            : w0Plain === "rg"
              ? evalSyncRg(optInBytes, allArgs, readFile)
            : (w0Plain === "md5sum" || w0Plain === "sha1sum" || w0Plain === "sha224sum" || w0Plain === "sha256sum" || w0Plain === "sha384sum" || w0Plain === "sha512sum" || w0Plain === "cksum")
              ? (() => { const cs = evalSyncChecksum(w0Plain, optInBytes, allArgs, readFile); return cs !== undefined && !cs.includes("\0") ? cs : undefined; })()
            : w0Plain === "base32"
              ? (() => { const b32 = evalSyncBase32(inBytes, allArgs, readFile); return b32 !== undefined ? sharedSyncPipeDecoder.decode(b32) : undefined; })()
            : (w0Plain === "xq" || w0Plain === "yq")
              ? this.evalSyncXqOrYq(w0Plain, inBytes, allArgs, readFile)
            : w0Plain === "xmllint"
              ? evalSyncXmllint(inBytes, allArgs, readFile)
              : evalSyncHtmlq(optInBytes, allArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
        if (csvOut !== undefined) {
          const outBytes = shellValueByteLength(csvOut);
          let end = csvOut.length;
          while (end > 0 && csvOut.charCodeAt(end - 1) === 10) end--;
          if (end < csvOut.length) csvOut = csvOut.slice(0, end);
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return csvOut;
        }
      }
      if (fOk && w0Plain === "expr" && !hasSingleStdinRedir && !hasSingleHereStringRedir) {
        const exprRes = this.evalSyncExpr(allArgs);
        if (exprRes !== undefined) {
          const outBytes = shellValueByteLength(exprRes.value) + 1;
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = exprRes.status;
          rawState.status = exprRes.status;
          return exprRes.value;
        }
      }
      if (fOk && (w0Plain === "comm" || w0Plain === "join" || w0Plain === "paste" || w0Plain === "factor" || w0Plain === "tsort" || (w0Plain === "jq" && !hasSingleHereStringRedir) || (w0Plain === "envsubst" && !hasSingleHereStringRedir) || (w0Plain === "numfmt" && !hasSingleHereStringRedir)) && !hasSingleStdinRedir) {
        const stdinLines = hasSingleHereStringRedir
          ? (hereStrVal!.endsWith("\n") ? hereStrVal!.slice(0, -1).split("\n") : (hereStrVal!.length === 0 ? [] : hereStrVal!.split("\n")))
          : undefined;
        let cjLines: string[] | undefined;
        if (w0Plain === "comm") cjLines = this.evalSyncComm(stdinLines, allArgs, rawState.cwd);
        else if (w0Plain === "join") cjLines = this.evalSyncJoin(stdinLines, allArgs, rawState.cwd);
        else if (w0Plain === "paste") cjLines = this.evalSyncPaste(stdinLines, allArgs, rawState.cwd);
        else if (w0Plain === "factor") cjLines = this.evalSyncFactor(stdinLines, allArgs);
        else if (w0Plain === "tsort") cjLines = this.evalSyncTsort(stdinLines, allArgs, rawState.cwd);
        else if (w0Plain === "jq") cjLines = this.evalSyncJq(undefined, allArgs, rawState.cwd);
        else if (w0Plain === "envsubst") {
          const esOut = this.evalSyncEnvsubst(undefined, allArgs, rawState);
          if (esOut !== undefined) cjLines = esOut.endsWith("\n") ? esOut.slice(0, -1).split("\n") : (esOut ? [esOut] : []);
        }
        else if (w0Plain === "numfmt") {
          const optArgs: string[] = [];
          const posArgs: string[] = [];
          let lit = false;
          for (const a of allArgs) {
            if (lit || !a.startsWith("-") || /^-[0-9.]/.test(a)) posArgs.push(a);
            else if (a === "--") lit = true;
            else optArgs.push(a);
          }
          if (posArgs.length > 0) cjLines = this.evalSyncNumfmt(posArgs, optArgs);
        }
        if (cjLines !== undefined) {
          let fileRes = cjLines.length === 0 ? "" : cjLines.join("\n") + "\n";
          const outBytes = shellValueByteLength(fileRes);
          let end = fileRes.length;
          while (end > 0 && fileRes.charCodeAt(end - 1) === 10) end--;
          if (end < fileRes.length) fileRes = fileRes.slice(0, end);
          const nextTotalBytes = this.budget.bytes + outBytes;
          if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextTotalBytes;
          this.budget.tick();
          rawState.substitutionStatus = 0;
          rawState.status = 0;
          return fileRes;
        }
      }
      if (fOk && (hasSingleStdinRedir || hasSingleHereStringRedir || allArgs.length >= 1)) {
        const fileArg = hasSingleStdinRedir ? redirTarget! : (hasSingleHereStringRedir ? "" : allArgs[allArgs.length - 1]!);
        const opArgs = (hasSingleStdinRedir || hasSingleHereStringRedir) ? allArgs : allArgs.slice(0, -1);
        if (hasSingleHereStringRedir || (!fileArg.startsWith("-") && fileArg !== "/dev/stdin")) {
          const view = hasSingleHereStringRedir ? fastSharedTextEncoder.encode(hereStrVal!) : this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, fileArg));
          // The text shortcut must not decode arbitrary file bytes or strip a BOM.
          // Non-ASCII file inputs use normal execution, which owns their raw ShellValue.
          const isBinaryViewTool = w0Plain === "xxd" || w0Plain === "od" || w0Plain === "hexdump" || w0Plain === "hd";
          if (view && view.byteLength <= 16384 && (isBinaryViewTool || (!view.includes(0) && (hasSingleHereStringRedir || view.every(byte => byte < 128))))) {
            const fileStr = hasSingleHereStringRedir ? hereStrVal! : sharedSyncPipeDecoder.decode(view);
            // Record-based shortcuts below serialize complete newline-terminated records.
            // Let normal commands preserve partial final records when reading files.
            if (fileStr.length > 0 && !fileStr.endsWith("\n") &&
                (w0Plain === "head" || w0Plain === "tail" || w0Plain === "sed" || w0Plain === "cut" || w0Plain === "uniq")) return undefined;
            const renderLines = (lines: readonly string[]): string => lines.length === 0 ? "" : lines.join("\n") + "\n";
            const rawLines = fileStr.endsWith("\n") ? fileStr.slice(0, -1).split("\n") : (fileStr.length === 0 ? [] : fileStr.split("\n"));
            let fileRes: string | undefined;
            let exitStatus = 0;
            if (w0Plain === "cat") {
              if (opArgs.length === 0) {
                fileRes = fileStr;
              } else {
                const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
                fileRes = syncCommandEvaluators.evalSyncCat?.(hasSingleHereStringRedir || hasSingleStdinRedir ? view : undefined, allArgs, readFile);
              }
            } else if (w0Plain === "head" || w0Plain === "tail") {
              if (opArgs.length <= 2 && !opArgs.some(a => a === "-q" || a === "-v" || a === "--quiet" || a === "--silent" || a === "--verbose" || (!a.startsWith("-") && a !== "-"))) {
              let count: number | undefined = opArgs.length === 0 ? 10 : undefined;
              let byteCount: number | undefined;
              let countRaw: string | undefined = opArgs.length === 0 ? "10" : undefined;
              if (opArgs.length === 1 && (opArgs[0]!.startsWith("-n") || opArgs[0]!.startsWith("--lines="))) {
                const sub = opArgs[0]!.startsWith("--lines=") ? opArgs[0]!.slice(8) : opArgs[0]!.slice(2);
                if (/^[0-9]{1,5}$/.test(sub) || (w0Plain === "tail" && /^\+[0-9]{1,5}$/.test(sub)) || (w0Plain === "head" && /^-[0-9]{1,5}$/.test(sub))) countRaw = sub;
              } else if (opArgs.length === 1 && (opArgs[0]!.startsWith("-c") || opArgs[0]!.startsWith("--bytes="))) {
                const sub = opArgs[0]!.startsWith("--bytes=") ? opArgs[0]!.slice(8) : opArgs[0]!.slice(2);
                if (/^[0-9]{1,5}$/.test(sub)) byteCount = Number(sub);
              }
              else if (opArgs.length === 1 && /^-[0-9]{1,5}$/.test(opArgs[0]!)) countRaw = opArgs[0]!.slice(1);
              else if (opArgs.length === 2 && opArgs[0] === "-n" && (/^[0-9]{1,5}$/.test(opArgs[1]!) || (w0Plain === "tail" && /^\+[0-9]{1,5}$/.test(opArgs[1]!)) || (w0Plain === "head" && /^-[0-9]{1,5}$/.test(opArgs[1]!)))) countRaw = opArgs[1]!;
              else if (opArgs.length === 2 && opArgs[0] === "-c" && /^[0-9]{1,5}$/.test(opArgs[1]!)) byteCount = Number(opArgs[1]!);
              if (countRaw !== undefined) {
                count = Number(countRaw);
                let sliced: string[];
                if (w0Plain === "tail" && countRaw.startsWith("+")) sliced = rawLines.slice(Math.max(0, count - 1));
                else if (w0Plain === "head" && countRaw.startsWith("-")) {
                  const drop = Math.abs(count);
                  sliced = drop === 0 ? [...rawLines] : rawLines.slice(0, Math.max(0, rawLines.length - drop));
                } else {
                  sliced = w0Plain === "head" ? rawLines.slice(0, count) : (count === 0 ? [] : rawLines.slice(-count));
                }
                fileRes = renderLines(sliced);
              } else if (byteCount !== undefined) {
                const slicedBytes = w0Plain === "head"
                  ? view.subarray(0, Math.min(view.byteLength, byteCount))
                  : (byteCount === 0 ? view.subarray(0, 0) : view.subarray(Math.max(0, view.byteLength - byteCount), view.byteLength));
                fileRes = sharedSyncPipeDecoder.decode(slicedBytes);
              }
              }
              if (fileRes === undefined) {
                const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
                fileRes = syncCommandEvaluators.evalSyncHeadTail?.(w0Plain, hasSingleHereStringRedir || hasSingleStdinRedir ? view : undefined, allArgs, readFile);
              }
            } else if (w0Plain === "jq") {
              const jqRes = this.evalSyncJq(fileStr.trim(), opArgs, rawState.cwd, fileStr) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncJq(undefined, allArgs, rawState.cwd) : undefined);
              if (jqRes !== undefined) fileRes = renderLines(jqRes);
            } else if (w0Plain === "awk") {
              const awkRes = this.evalSyncAwk(rawLines, opArgs) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("awk", allArgs, rawState.cwd, byteLocale(rawState.variables)) : undefined);
              if (awkRes !== undefined) fileRes = renderLines(awkRes);
            } else if (w0Plain === "grep" || w0Plain === "egrep" || w0Plain === "fgrep") {
              const grepArgs = w0Plain === "grep" ? opArgs : [w0Plain === "egrep" ? "-E" : "-F", ...opArgs];
              const grepRes = this.evalSyncGrep(rawLines, grepArgs, Boolean(rawState.errexit)) ?? this.evalSyncGrepWithFiles(allArgs, w0Plain === "egrep", w0Plain === "fgrep", Boolean(rawState.errexit), rawState.cwd, hasSingleHereStringRedir || hasSingleStdinRedir ? rawLines : undefined);
              if (grepRes !== undefined) {
                exitStatus = grepRes.status;
                fileRes = renderLines(grepRes.lines);
              }
            } else if (w0Plain === "sed") {
              const sedRes = this.evalSyncSed(rawLines, opArgs);
              const sedLines = sedRes !== undefined ? sedRes.lines : (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("sed", allArgs, rawState.cwd, byteLocale(rawState.variables)) : undefined);
              if (sedLines !== undefined) fileRes = renderLines(sedLines);
            } else if (w0Plain === "cut") {
              const cutRes = this.evalSyncCut(rawLines, opArgs, byteLocale(rawState.variables)) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("cut", allArgs, rawState.cwd, byteLocale(rawState.variables)) : undefined);
              if (cutRes !== undefined) fileRes = renderLines(cutRes);
            } else if (w0Plain === "wc") {
              if (opArgs.length === 1 && this.normalizeSyncWcFlag(opArgs[0]) !== undefined) {
                const wcMode = this.normalizeSyncWcFlag(opArgs[0])!;
                let count = 0;
                if (wcMode === "-l") {
                  for (let k = 0; k < view.byteLength; k++) if (view[k] === 10) count++;
                } else if (wcMode === "-c") {
                  count = view.byteLength;
                } else if (wcMode === "-m") {
                  count = byteLocale(rawState.variables) ? view.byteLength : Array.from(fileStr).length;
                } else if (wcMode === "-L") {
                  count = this.wcMaxLineWidth(fileStr, byteLocale(rawState.variables));
                } else {
                  if (view.some(byte => byte < 9 || (byte > 13 && byte < 32) || byte >= 127)) return undefined;
                  count = fileStr.split(/[ \t\n\r\f\v]+/).filter(Boolean).length;
                }
                fileRes = ((hasSingleStdinRedir || hasSingleHereStringRedir) ? String(count) : `${count} ${fileArg}`) + "\n";
              } else {
                const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
                fileRes = syncCommandEvaluators.evalSyncWc?.(hasSingleHereStringRedir || hasSingleStdinRedir ? view : undefined, allArgs, byteLocale(rawState.variables), readFile);
              }
            } else if (w0Plain === "sort" && !byteLocale(rawState.variables)) {
              const sortRes = this.evalSyncSort(rawLines, opArgs, false) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("sort", allArgs, rawState.cwd, false) : undefined);
              if (sortRes !== undefined) fileRes = renderLines(sortRes);
            } else if (w0Plain === "uniq") {
              const uniqRes = this.evalSyncUniq(rawLines, opArgs, byteLocale(rawState.variables)) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("uniq", allArgs, rawState.cwd, byteLocale(rawState.variables)) : undefined);
              if (uniqRes !== undefined) fileRes = renderLines(uniqRes);
            } else if (w0Plain === "rev") {
              if (opArgs.length === 0) fileRes = renderLines(rawLines.map(l => Array.from(l).reverse().join("")));
              else if (!hasSingleHereStringRedir && !hasSingleStdinRedir) {
                const revRes = this.evalSyncMultiFileText("rev", allArgs, rawState.cwd, false);
                if (revRes !== undefined) fileRes = renderLines(revRes);
              }
            } else if (w0Plain === "tac") {
              if (opArgs.length === 0) {
                const rev = [...rawLines].reverse();
                if (!fileStr.endsWith("\n") && rev.length > 1) rev.splice(0, 2, rev[0]! + rev[1]!);
                fileRes = renderLines(rev);
              } else if (!hasSingleHereStringRedir && !hasSingleStdinRedir) {
                const tacRes = this.evalSyncMultiFileText("tac", allArgs, rawState.cwd, false);
                if (tacRes !== undefined) fileRes = renderLines(tacRes);
              }
            } else if (w0Plain === "tr" && (hasSingleStdinRedir || hasSingleHereStringRedir)) {
              fileRes = this.evalSyncTr(fileStr, opArgs);
            } else if (w0Plain === "base64") {
              fileRes = this.evalSyncBase64(view, opArgs);
            } else if (w0Plain === "nl") {
              const nlRes = (!hasSingleHereStringRedir && !hasSingleStdinRedir && opArgs.some(a => !a.startsWith("-"))) ? this.evalSyncNl([], allArgs, rawState.cwd) : this.evalSyncNl(rawLines, opArgs, rawState.cwd);
              if (nlRes !== undefined) fileRes = renderLines(nlRes);
            } else if (w0Plain === "paste") {
              const pasteRes = (hasSingleHereStringRedir || hasSingleStdinRedir) ? this.evalSyncPaste(rawLines, opArgs, rawState.cwd) : this.evalSyncPaste(undefined, allArgs, rawState.cwd);
              if (pasteRes !== undefined) fileRes = renderLines(pasteRes);
            } else if (w0Plain === "comm") {
              const commRes = (hasSingleHereStringRedir || hasSingleStdinRedir) ? this.evalSyncComm(rawLines, opArgs, rawState.cwd) : this.evalSyncComm([], allArgs, rawState.cwd);
              if (commRes !== undefined) fileRes = renderLines(commRes);
            } else if (w0Plain === "join") {
              const joinRes = (hasSingleHereStringRedir || hasSingleStdinRedir) ? this.evalSyncJoin(rawLines, opArgs, rawState.cwd) : this.evalSyncJoin([], allArgs, rawState.cwd);
              if (joinRes !== undefined) fileRes = renderLines(joinRes);
            } else if (w0Plain === "numfmt") {
              const nmRes = (hasSingleHereStringRedir || hasSingleStdinRedir) ? this.evalSyncNumfmt(rawLines, opArgs) : this.evalSyncNumfmt([], allArgs);
              if (nmRes !== undefined) fileRes = renderLines(nmRes);
            } else if (w0Plain === "bc") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const bcRes = (hasSingleHereStringRedir || hasSingleStdinRedir)
                ? this.evalSyncBc(fileStr.trim(), opArgs, readFile)
                : this.evalSyncBc("", allArgs, readFile);
              if (bcRes !== undefined) fileRes = renderLines(bcRes);
            } else if (w0Plain === "xxd") {
              fileRes = this.evalSyncXxd(view, opArgs, undefined, !hasSingleHereStringRedir && !hasSingleStdinRedir ? fileArg : undefined);
            } else if (w0Plain === "od") {
              fileRes = this.evalSyncOd(view, opArgs);
            } else if (w0Plain === "hexdump" || w0Plain === "hd") {
              fileRes = this.evalSyncHexdump(view, opArgs, w0Plain === "hd");
            } else if (w0Plain === "fmt") {
              fileRes = this.evalSyncFmt(view, opArgs);
            } else if (w0Plain === "md5sum" || w0Plain === "sha1sum" || w0Plain === "sha224sum" || w0Plain === "sha256sum" || w0Plain === "sha384sum" || w0Plain === "sha512sum" || w0Plain === "cksum") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const csOut = evalSyncChecksum(w0Plain, view, opArgs, readFile, !hasSingleHereStringRedir && !hasSingleStdinRedir ? fileArg : undefined);
              if (csOut !== undefined && !csOut.includes("\0")) fileRes = csOut;
            } else if (w0Plain === "base32") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const b32Out = evalSyncBase32(view, opArgs, readFile);
              if (b32Out !== undefined) fileRes = sharedSyncPipeDecoder.decode(b32Out);
            } else if (w0Plain === "csvcut") {
              fileRes = evalSyncCsvcut(view, opArgs);
            } else if (w0Plain === "csvgrep") {
              fileRes = evalSyncCsvgrep(view, opArgs);
            } else if (w0Plain === "csvlook") {
              fileRes = syncCommandEvaluators.evalSyncCsvlook?.(view, opArgs);
            } else if (w0Plain === "csvjson") {
              fileRes = syncCommandEvaluators.evalSyncCsvjson?.(view, opArgs);
            } else if (w0Plain === "csvsort") {
              fileRes = syncCommandEvaluators.evalSyncCsvsort?.(view, opArgs);
            } else if (w0Plain === "csvformat") {
              fileRes = syncCommandEvaluators.evalSyncCsvformat?.(view, opArgs);
            } else if (w0Plain === "csvstat") {
              fileRes = syncCommandEvaluators.evalSyncCsvstat?.(view, opArgs);
            } else if (w0Plain === "in2csv") {
              fileRes = syncCommandEvaluators.evalSyncIn2csv?.(view, opArgs);
            } else if (w0Plain === "csvstack") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncCsvstack?.(view, opArgs, readFile);
            } else if (w0Plain === "csvjoin") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncCsvjoin?.(view, opArgs, readFile);
            } else if (w0Plain === "dd") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } };
              fileRes = evalSyncDd(view, opArgs, readFile, writeFile);
            } else if (w0Plain === "xargs") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncXargs(view, opArgs, readFile);
            } else if (w0Plain === "openssl") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncOpenssl?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "sqlite3") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncSqlite3?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "gpg") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncGpg?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "ssh") {
              fileRes = syncCommandEvaluators.evalSyncSsh?.(opArgs);
            } else if (w0Plain === "ssh-keygen") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncSshKeygen?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, rawState.cwd);
            } else if (w0Plain === "pdfinfo") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdfinfo?.(view, opArgs, readFile);
            } else if (w0Plain === "pdftotext") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdftotext?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "exiftool") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncExiftool?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "pdffonts") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdffonts?.(view, opArgs, readFile);
            } else if (w0Plain === "pdftohtml") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdftohtml?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "qpdf") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncQpdf?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "pdftk") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdftk?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "sips") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncSips?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "identify" || w0Plain === "magick" || w0Plain === "convert" || w0Plain === "mogrify" || w0Plain === "composite" || w0Plain === "montage" || w0Plain === "compare") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncIdentify?.(w0Plain, view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "pdfimages") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdfimages?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "pdfdetach") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdfdetach?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "ffprobe") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncFfprobe?.(view, opArgs, readFile);
            } else if (w0Plain === "ffmpeg") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncFfmpeg?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "gh") {
              fileRes = syncCommandEvaluators.evalSyncGh?.(this.commands.get("gh")!.execute, opArgs, rawState.variables, rawState.cwd, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), false));
            } else if (w0Plain === "pdftoppm") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdftoppm?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "pdftocairo") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPdftocairo?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "mmdc") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncMmdc?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "pandoc") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncPandoc?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "soffice" || w0Plain === "libreoffice") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncSoffice?.(opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "ssconvert") {
              fileRes = syncCommandEvaluators.evalSyncSsconvert?.(this.commands.get("ssconvert")!.execute, opArgs, view, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true), (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "wkhtmltopdf") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = syncCommandEvaluators.evalSyncWkhtmltopdf?.(view, opArgs, readFile, (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); const dir = fp.slice(0, fp.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "op") {
              fileRes = syncCommandEvaluators.evalSyncOp?.(this.commands.get("op")!.execute, opArgs, rawState.variables);
            } else if (w0Plain === "git") {
              fileRes = syncCommandEvaluators.evalSyncGit?.(view, opArgs, rawState.cwd, (p: string, follow: boolean) => this.tryInspectMemoryNodeSync(p, p === "/", follow), (p: string) => this.tryReadMemoryFileViewSync(p, false, true), this.commands.get("git")!.execute, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const dir = p.slice(0, p.lastIndexOf("/")) || "/"; tryMkdirMemorySync(this.backingFs, dir, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, p, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, p, true, 0o777 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, p, this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "tar") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncTar(view, opArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "unzip") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncUnzip(opArgs, readFile, (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } }, (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "zip") {
              fileRes = evalSyncZip(opArgs);
            } else if (w0Plain === "timeout") {
              fileRes = syncCommandEvaluators.evalSyncTimeout?.(opArgs);
            } else if (w0Plain === "split") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncSplit?.(view, opArgs, readFile, writeFile);
            } else if (w0Plain === "csplit") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncCsplit?.(view, opArgs, readFile, writeFile);
            } else if (w0Plain === "curl") {
              fileRes = syncCommandEvaluators.evalSyncCurl?.(opArgs);
            } else if (w0Plain === "wget") {
              fileRes = syncCommandEvaluators.evalSyncWget?.(opArgs);
            } else if (w0Plain === "sponge") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncSponge?.(view, opArgs, readFile, writeFile);
            } else if (w0Plain === "truncate") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncTruncate?.(opArgs, readFile, writeFile);
            } else if (w0Plain === "install") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncInstall?.(opArgs, readFile, writeFile, (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false), (p: string, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, m ?? 0o755, this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "apply_patch") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); const fp = resolvePath(rawState.cwd, p); if (m !== undefined) tryRmRfMemorySync(this.backingFs, fp, this.commandSignal); return tryWriteMemoryFileSync(this.backingFs, fp, b, false, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncApplyPatch?.(view, opArgs, readFile, writeFile, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } }, (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), true, 0o755, this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "mktemp") {
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false);
              const writeFile = (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o600 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } };
              const mkdirFn = (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), false, 0o700 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncMktemp?.(opArgs, rawState.variables, statType, writeFile, mkdirFn);
            } else if (w0Plain === "tee") {
              const writeFile = (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncTee?.(view, opArgs, writeFile);
            } else if (w0Plain === "touch") {
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false);
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncTouch?.(opArgs, statType, readFile, writeFile, (p: string, upd) => this.tryUtimesMemoryNodeSync(resolvePath(rawState.cwd, p), upd, false), rawState.exported.has("TZ") ? rawState.variables.TZ : undefined);
            } else if (w0Plain === "cp") {
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false);
              const statMode = (p: string) => this.tryStatMemoryNodeModeSync(resolvePath(rawState.cwd, p), false);
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, app: boolean, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncCp?.(opArgs, statType, readFile, writeFile, statMode, rawState.umask ?? 0o022);
            } else if (w0Plain === "mv") {
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false);
              const statMode = (p: string) => this.tryStatMemoryNodeModeSync(resolvePath(rawState.cwd, p), false);
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, app: boolean, m?: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, m ?? (0o666 & ~(rawState.umask ?? 0o022)), this.commandSignal); } catch { return false; } };
              const rmFn = (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncMv?.(opArgs, statType, readFile, writeFile, rmFn, statMode);
            } else if (w0Plain === "rmdir") {
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false);
              const listDir = (p: string) => tryGetMemoryDirectoryEntryNamesSync(this.backingFs, resolvePath(rawState.cwd, p));
              const rmFn = (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncRmdir?.(opArgs, statType, listDir, rmFn);
            } else if (w0Plain === "sleep") {
              fileRes = syncCommandEvaluators.evalSyncSleep?.(opArgs);
            } else if (w0Plain === "chmod") {
              fileRes = syncCommandEvaluators.evalSyncChmod?.(opArgs, rawState.umask ?? 0o022, (p: string, chg) => this.tryChmodMemoryNodeSync(resolvePath(rawState.cwd, p), chg, false));
            } else if (w0Plain === "patch") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const writeFile = (p: string, b: Uint8Array, app: boolean) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, app, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncPatch?.(view, opArgs, readFile, writeFile);
            } else if (w0Plain === "mkdir") {
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false);
              const mkdirFn = (p: string, rec: boolean, m: number) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryMkdirMemorySync(this.backingFs, resolvePath(rawState.cwd, p), rec, m, this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncMkdir?.(opArgs, rawState.umask ?? 0o022, statType, mkdirFn);
            } else if (w0Plain === "rm") {
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false);
              const listDir = (p: string) => tryGetMemoryDirectoryEntryNamesSync(this.backingFs, resolvePath(rawState.cwd, p));
              const rmFn = (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } };
              fileRes = syncCommandEvaluators.evalSyncRm?.(opArgs, statType, listDir, rmFn);
            } else if (w0Plain === "ln") {
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), false);
              const rmFn = (p: string) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryRmRfMemorySync(this.backingFs, resolvePath(rawState.cwd, p), this.commandSignal); } catch { return false; } };
              const linkFn = (s: string, d: string, sym: boolean) => this.tryLinkMemoryNodeSync(sym ? s : resolvePath(rawState.cwd, s), resolvePath(rawState.cwd, d), sym);
              fileRes = syncCommandEvaluators.evalSyncLn?.(opArgs, statType, rmFn, linkFn);
            } else if (w0Plain === "dos2unix" || w0Plain === "unix2dos") {
              const leOut = evalSyncLineEndings(w0Plain, view, opArgs);
              if (leOut !== undefined) fileRes = sharedSyncPipeDecoder.decode(leOut);
            } else if (w0Plain === "iconv") {
              const icOut = evalSyncIconv(view, opArgs);
              if (icOut !== undefined) fileRes = sharedSyncPipeDecoder.decode(icOut);
            } else if (w0Plain === "gzip" || w0Plain === "gunzip" || w0Plain === "zcat" || w0Plain === "unzstd" || w0Plain === "zstdcat" || w0Plain === "zstd" || w0Plain === "bzip2" || w0Plain === "bunzip2" || w0Plain === "bzcat" || w0Plain === "xz" || w0Plain === "unxz" || w0Plain === "xzcat" || w0Plain === "lzma" || w0Plain === "unlzma" || w0Plain === "lzcat") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const cmpOut = evalSyncCompression(w0Plain, view, opArgs, readFile);
              if (cmpOut !== undefined && !cmpOut.includes(0)) fileRes = sharedSyncPipeDecoder.decode(cmpOut);
            } else if (w0Plain === "htmlq") {
              fileRes = evalSyncHtmlq(view, opArgs, (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true), (p: string, b: Uint8Array) => { try { if (this._inSyncLoopPreflight) return Boolean(this.canFastMemoryRedirect && this._isMemoryBackingFs); return tryWriteMemoryFileSync(this.backingFs, resolvePath(rawState.cwd, p), b, false, 0o666 & ~(rawState.umask ?? 0o022), this.commandSignal); } catch { return false; } });
            } else if (w0Plain === "xmllint") {
              fileRes = evalSyncXmllint(view, opArgs);
            } else if (w0Plain === "xq" || w0Plain === "yq") {
              fileRes = this.evalSyncXqOrYq(w0Plain, view, opArgs);
            } else if (w0Plain === "mdq") {
              fileRes = evalSyncMdq(view, opArgs);
            } else if (w0Plain === "shuf") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p));
              fileRes = evalSyncShuf(view, opArgs, readFile);
            } else if (w0Plain === "html-to-markdown") {
              fileRes = evalSyncHtmlToMarkdown(view, opArgs);
            } else if (w0Plain === "unrtf") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncUnrtf(view, opArgs, readFile);
            } else if (w0Plain === "pr") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncPr(view, opArgs, readFile);
            } else if (w0Plain === "file") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              const statType = (p: string) => this.tryStatMemoryNodeTypeSync(resolvePath(rawState.cwd, p), true);
              fileRes = evalSyncFile(view, opArgs, readFile, statType);
            } else if (w0Plain === "diff3") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncDiff3(view, opArgs, readFile);
            } else if (w0Plain === "cmp") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncCmp(view, opArgs, readFile);
            } else if (w0Plain === "diff") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncDiff(view, opArgs, readFile);
            } else if (w0Plain === "xan") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncXan(view, opArgs, readFile);
            } else if (w0Plain === "less" || w0Plain === "more") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncLess(view, opArgs, readFile);
            } else if (w0Plain === "rg") {
              const readFile = (p: string) => this.tryReadMemoryFileViewSync(resolvePath(rawState.cwd, p), true, true);
              fileRes = evalSyncRg(view, opArgs, readFile);
            } else if (w0Plain === "envsubst" && (hasSingleHereStringRedir || hasSingleStdinRedir)) {
              fileRes = this.evalSyncEnvsubst(fileStr, opArgs, rawState);
            } else if (w0Plain === "column") {
              const colRes = this.evalSyncColumn(rawLines, opArgs) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("column", allArgs, rawState.cwd, false) : undefined);
              if (colRes !== undefined) fileRes = renderLines(colRes);
            } else if (w0Plain === "fold") {
              const foldRes = this.evalSyncFold(rawLines, opArgs) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("fold", allArgs, rawState.cwd, false) : undefined);
              if (foldRes !== undefined) fileRes = renderLines(foldRes);
            } else if (w0Plain === "expand") {
              const expRes = this.evalSyncExpand(rawLines, opArgs) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("expand", allArgs, rawState.cwd, false) : undefined);
              if (expRes !== undefined) fileRes = renderLines(expRes);
            } else if (w0Plain === "unexpand") {
              const unexpRes = this.evalSyncUnexpand(rawLines, opArgs) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("unexpand", allArgs, rawState.cwd, false) : undefined);
              if (unexpRes !== undefined) fileRes = renderLines(unexpRes);
            } else if (w0Plain === "factor") {
              const facRes = this.evalSyncFactor(rawLines, opArgs);
              if (facRes !== undefined) fileRes = renderLines(facRes);
            } else if (w0Plain === "tsort") {
              const tsRes = this.evalSyncTsort(rawLines, opArgs, rawState.cwd);
              if (tsRes !== undefined) fileRes = renderLines(tsRes);
            } else if (w0Plain === "strings") {
              const strRes = this.evalSyncStrings(rawLines, opArgs) ?? (!hasSingleHereStringRedir && !hasSingleStdinRedir ? this.evalSyncMultiFileText("strings", allArgs, rawState.cwd, false) : undefined);
              if (strRes !== undefined) fileRes = renderLines(strRes);
            }
            if (fileRes !== undefined) {
              // Charge emitted bytes before substitution removes trailing newlines.
              const outBytes = shellValueByteLength(fileRes);
              let end = fileRes.length;
              while (end > 0 && fileRes.charCodeAt(end - 1) === 10) end--;
              if (end < fileRes.length) fileRes = fileRes.slice(0, end);
              const nextTotalBytes = this.budget.bytes + outBytes;
              if (nextTotalBytes > this.budget.maxOutputBytesSmi && outBytes > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
              this.budget.bytes = nextTotalBytes;
              this.budget.tick();
              rawState.substitutionStatus = exitStatus;
              rawState.status = exitStatus;
              return fileRes;
            }
          }
        }
      }
    }
    let fnPositional: string[] | undefined;
    if (rawState.functions.has(w0Plain)) {
      if (rawState.functionDepth >= this.budget.limits.maxFunctionDepth) return undefined;
      if (rawState.depth + 1 >= this.budget.limits.maxSubstitutionDepth) return undefined;
      const fnBody = rawState.functions.get(w0Plain)!;
      if (fnBody.kind !== "group" || fnBody.redirects.length !== 0) return undefined;
      for (let i = 0; i < cmd.words.length; i++) {
        if (!this.isPureArgWord(cmd.words[i]!, rawState)) return undefined;
      }
      fnPositional = [];
      for (let i = 1; i < cmd.words.length; i++) {
        const argVal = this.fastValueWord(cmd.words[i]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof argVal !== "string") return undefined;
        fnPositional.push(argVal);
      }
      const innerW0 = fnBody.body.lists[0]?.pipelines[0]?.commands[0]?.kind === "simple" ? fnBody.body.lists[0]!.pipelines[0]!.commands[0]!.words[0]?.plain : undefined;
      const isSingleEchoOrPrintf = fnBody.body.lists.length === 1 && !fnBody.body.lists[0]!.terminator && fnBody.body.lists[0]!.pipelines.length === 1 && !fnBody.body.lists[0]!.pipelines[0]!.negate && fnBody.body.lists[0]!.pipelines[0]!.commands.length === 1 && fnBody.body.lists[0]!.pipelines[0]!.commands[0]!.kind === "simple" && fnBody.body.lists[0]!.pipelines[0]!.commands[0]!.redirects.length === 0 && (innerW0 === "echo" || innerW0 === "printf" || innerW0 === "dirname" || innerW0 === "basename" || innerW0 === "pwd" || innerW0 === "command" || innerW0 === "type" || innerW0 === "seq") && !rawState.functions.has(innerW0!) && !rawState.extensions?.builtins.has(innerW0!);
      if (isSingleEchoOrPrintf) {
        cmd = fnBody.body.lists[0]!.pipelines[0]!.commands[0] as Extract<Command, { kind: "simple" }>;
        w0Plain = cmd.words[0]!.plain!;
      } else {
        // Complex bodies can mutate shared state or suspend after output.
        // Use the normal isolated substitution state from the outset.
        return undefined;
      }
    }
    const prevFastSubPos = this._fastSubPositional;
    if (fnPositional !== undefined) this._fastSubPositional = fnPositional;
    try {
    if (((w0Plain === "command" && cmd.words[1]?.plain === "-v") || (w0Plain === "type" && cmd.words[1]?.plain === "-t")) && cmd.words.length === 3 && !hasShellFunction(rawState, w0Plain) && !rawState.extensions?.builtins.has(w0Plain) && this.isPureArgWord(cmd.words[2]!, rawState)) {
      const targetName = cmd.words[2]!.plain ?? this.fastValueWord(cmd.words[2]!, state, io, true, false, false, true, undefined, part.line);
      const disc = typeof targetName === "string" ? this.tryResolveSyncDiscovery(w0Plain === "command" ? "name" : "kind", targetName, rawState) : undefined;
      if (disc !== undefined && (disc.status === 0 || !rawState.errexit)) {
        if (disc.status === 0) {
          const byteLength = shellValueByteLength(disc.text) + 1;
          const nextBytes = this.budget.bytes + byteLength;
          if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
          this.budget.bytes = nextBytes;
        }
        this.budget.tick();
        if (fnPositional !== undefined) this.budget.tick();
        rawState.substitutionStatus = disc.status;
        rawState.status = disc.status;
        return disc.text;
      }
    }
    if (w0Plain === "pwd" && (cmd.words.length === 1 || (cmd.words.length === 2 && (cmd.words[1]?.plain === "-L" || cmd.words[1]?.plain === "--logical"))) && !hasShellFunction(rawState, "pwd") && !rawState.extensions?.builtins.has("pwd") && !this.hasBuiltinOverride("pwd")) {
      let res = rawState.cwd;
      while (res.endsWith("\n")) res = res.slice(0, -1);
      const byteLength = shellValueByteLength(res) + 1;
      const nextBytes = this.budget.bytes + byteLength;
      if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
      this.budget.bytes = nextBytes;
      this.budget.tick();
      if (fnPositional !== undefined) this.budget.tick();
      rawState.substitutionStatus = 0;
      rawState.status = 0;
      return res;
    }
    if (w0Plain !== "printf" && w0Plain !== "echo" && w0Plain !== "dirname" && w0Plain !== "basename" && w0Plain !== "seq") return undefined;
    const def = this.commands.get(w0Plain);
    if (!def) return undefined;
    if (w0Plain === "printf" && def.execute !== printfCommand.execute) return undefined;
    if (w0Plain === "echo" && (rawState.xpg_echo || !defaultEchoExecutors.has(def.execute))) return undefined;
    if ((w0Plain === "dirname" || w0Plain === "basename") && (!builtInDirectContextExecutors.has(def.execute) || customRegisteredCommands.has(def.execute))) return undefined;
    if (w0Plain === "seq" && !builtInDirectContextExecutors.has(def.execute) && (customRegisteredCommands.has(def.execute) || customRegisteredRegistries.has(this.commands))) return undefined;
    if (cmd.words.length > this.budget.maxExpansionFieldsSmi && cmd.words.length > this.budget.limits.maxExpansionFields) return undefined;
    for (let i = 0; i < cmd.words.length; i++) {
      if (!this.isPureArgWord(cmd.words[i]!, rawState)) return undefined;
    }
    if (w0Plain === "dirname" || w0Plain === "basename") {
      const dbArgs: string[] = [];
      for (let i = 1; i < cmd.words.length; i++) {
        const v = this.fastValueWord(cmd.words[i]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof v !== "string") return undefined;
        dbArgs.push(v);
      }
      let res = w0Plain === "dirname" ? this.evalSyncDirname(dbArgs) : this.evalSyncBasename(dbArgs);
      if (res === undefined) return undefined;
      const byteLength = shellValueByteLength(res) + 1;
      while (res.endsWith("\n")) res = res.slice(0, -1);
      const nextBytes = this.budget.bytes + byteLength;
      if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
      this.budget.bytes = nextBytes;
      this.budget.tick();
      if (fnPositional !== undefined) this.budget.tick();
      rawState.substitutionStatus = 0;
      rawState.status = 0;
      return res;
    }
    if (w0Plain === "seq" && cmd.words.length >= 2 && cmd.words.length <= 8) {
      const seqArgs: string[] = [];
      for (let k = 1; k < cmd.words.length; k++) {
        const sv = this.fastValueWord(cmd.words[k]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof sv !== "string") return undefined;
        seqArgs.push(sv);
      }
      const rawSeq = this.evalSyncSeq(seqArgs);
      if (rawSeq === undefined) return undefined;
      const byteLength = shellValueByteLength(rawSeq);
      let res = rawSeq;
      while (res.endsWith("\n")) res = res.slice(0, -1);
      const nextBytes = this.budget.bytes + byteLength;
      if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
      this.budget.bytes = nextBytes;
      this.budget.tick();
      if (fnPositional !== undefined) this.budget.tick();
      rawState.substitutionStatus = 0;
      rawState.status = 0;
      return res;
    }
    if (w0Plain === "echo" && cmd.words.length <= 2) {
      let val: string | undefined = "";
      if (cmd.words.length === 2) {
        const wVal = this.fastValueWord(cmd.words[1]!, state, io, true, false, false, true, undefined, part.line);
        if (typeof wVal !== "string" || wVal.includes("\0")) return undefined;
        val = wVal.startsWith("-") ? undefined : wVal;
      }
      if (val !== undefined) {
        const byteLength = shellValueByteLength(val) + 1;
        const nextBytes = this.budget.bytes + byteLength;
        if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
        this.budget.bytes = nextBytes;
        this.budget.tick();
        if (fnPositional !== undefined) this.budget.tick();
        rawState.substitutionStatus = 0;
        rawState.status = 0;
        let end = val.length;
        while (end > 0 && val.charCodeAt(end - 1) === 10) end--;
        return end === val.length ? val : val.slice(0, end);
      }
    }
    if ( w0Plain === "printf" && cmd.words.length === 3 && cmd.words[1]!.parts.length === 1 && cmd.words[1]!.parts[0]!.kind === "text" && cmd.words[1]!.parts[0]!.value === "%d" && cmd.words[2]!.parts.length === 1 && cmd.words[2]!.parts[0]!.kind === "arithmetic") {
      const val = this.fastValueWord(cmd.words[2]!, state, io, true, false, false, true, undefined, part.line);
      if (typeof val !== "string") return undefined;
      const nextBytes = this.budget.bytes + val.length;
      if (nextBytes > this.budget.maxOutputBytesSmi && val.length > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
      this.budget.bytes = nextBytes;
      this.budget.tick();
      rawState.substitutionStatus = 0;
      rawState.status = 0;
      return val;
    }
    const subArgs: string[] = [];
    for (let i = 1; i < cmd.words.length; i++) {
      const val = this.fastValueWord(cmd.words[i]!, state, io, true, false, false, true, undefined, part.line);
      if (typeof val !== "string") return undefined;
      subArgs.push(val);
    }
    let formatted: string | undefined;
    if (w0Plain === "printf") formatted = tryFastPrintf(subArgs);
    else if (w0Plain === "echo") formatted = tryFastEcho(subArgs);
    else {
      if (subArgs[0]?.startsWith("-")) return undefined;
      formatted = `${subArgs.join(" ")}\n`;
      if (formatted.includes("\0")) return undefined;
    }
    if (formatted === undefined) return undefined;
    const byteLength = shellValueByteLength(formatted);
    const nextBytes = this.budget.bytes + byteLength;
    if (nextBytes > this.budget.maxOutputBytesSmi && byteLength > this.budget.limits.maxOutputBytes - this.budget.bytes) this.budget.fail("maxOutputBytes");
    this.budget.bytes = nextBytes;
    this.budget.tick();
    rawState.substitutionStatus = 0;
    rawState.status = 0;
    if (fnPositional !== undefined) this.budget.tick();
    let end = formatted.length;
    while (end > 0 && formatted.charCodeAt(end - 1) === 10) end--;
    return end === formatted.length ? formatted : formatted.slice(0, end);
    } finally {
      this._fastSubPositional = prevFastSubPos;
    }
  },
  splitTopLevelJqOp(this: any, expr: string, mode: "or" | "and" | "cmp" | "add" | "mul"): { lhs: string; op: string; rhs: string } | undefined {
    let depth = 0;
    let inStr = false;
    let bestIdx = -1;
    let bestOp = "";
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i]!;
      if (inStr) {
        if (ch === "\\") { i++; continue; }
        if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") { inStr = true; continue; }
      if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
      if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
      if (depth !== 0) continue;
      if (mode === "or") {
        if (i > 0 && /\s/.test(expr[i - 1]!) && expr.slice(i, i + 2) === "or" && /\s/.test(expr[i + 2] ?? "")) {
          bestIdx = i;
          bestOp = "or";
        }
      } else if (mode === "and") {
        if (i > 0 && /\s/.test(expr[i - 1]!) && expr.slice(i, i + 3) === "and" && /\s/.test(expr[i + 3] ?? "")) {
          bestIdx = i;
          bestOp = "and";
        }
      } else if (mode === "cmp") {
        const two = expr.slice(i, i + 2);
        if (two === "==" || two === "!=" || two === ">=" || two === "<=") {
          return { lhs: expr.slice(0, i).trim(), op: two, rhs: expr.slice(i + 2).trim() };
        }
        if ((ch === ">" || ch === "<") && expr[i + 1] !== "=") {
          return { lhs: expr.slice(0, i).trim(), op: ch, rhs: expr.slice(i + 1).trim() };
        }
      } else if (mode === "add") {
        if ((ch === "+" || ch === "-") && expr[i + 1] !== "=") {
          if (ch === "-" && i > 0 && /[eE]/.test(expr[i - 1]!) && i >= 2 && /[0-9]/.test(expr[i - 2]!)) continue;
          const prev = expr.slice(0, i).trimEnd();
          if (prev.length === 0 || /[|+\-*/%=<>!,(?:\[]$/.test(prev)) continue;
          bestIdx = i;
          bestOp = ch;
        }
      } else if (mode === "mul") {
        if ((ch === "*" || ch === "/" || ch === "%") && expr[i + 1] !== "=") {
          if (ch === "/" && (expr[i + 1] === "/" || expr[i - 1] === "/")) continue;
          const prev = expr.slice(0, i).trimEnd();
          if (prev.length === 0) continue;
          bestIdx = i;
          bestOp = ch;
        }
      }
    }
    if (bestIdx > 0 && bestOp) {
      const lhs = expr.slice(0, bestIdx).trim();
      const rhs = expr.slice(bestIdx + bestOp.length).trim();
      if (lhs.length > 0 && rhs.length > 0) return { lhs, op: bestOp, rhs };
    }
    return undefined;
  }
,
  evalSyncJqPathOps(this: any, item: unknown, expr: string): unknown[] | undefined {
    let st = expr.trim();
    let pipeSplit = splitSyncJqExpression(st, "|");
    if (!pipeSplit) return undefined;
    while (pipeSplit.wrapped) {
      st = st.slice(1, -1).trim();
      pipeSplit = splitSyncJqExpression(st, "|");
      if (!pipeSplit) return undefined;
    }
    if (pipeSplit.parts.length > 1) {
      let cur: unknown[] = [item];
      for (const pStage of pipeSplit.parts) {
        const next: unknown[] = [];
        for (const it of cur) {
          const r = this.evalSyncJqPathOps(it, pStage);
          if (r === undefined) return undefined;
          for (const rv of r) next.push(rv);
        }
        cur = next;
      }
      return cur;
    }
    const commaSplit = splitSyncJqExpression(st, ",");
    if (!commaSplit) return undefined;
    if (commaSplit.parts.length > 1) {
      const out: unknown[] = [];
      for (const cPart of commaSplit.parts) {
        const r = this.evalSyncJqPathOps(item, cPart);
        if (r === undefined) return undefined;
        for (const rv of r) out.push(rv);
      }
      return out;
    }
    const alternatives = splitSyncJqExpression(st, "//");
    if (!alternatives) return undefined;
    if (alternatives.parts.length > 1) {
      const lhs = alternatives.parts[0]!;
      const rhs = alternatives.parts.slice(1).join("//");
      const lVals = this.evalSyncJqPathOps(item, lhs);
      if (lVals === undefined) return undefined;
      // Validate both sides before admitting the fast path, even if lhs wins.
      let rVals = this.evalSyncJqPathOps(item, rhs);
      if (rVals === undefined) {
        try { rVals = [JSON.parse(rhs)]; } catch { return undefined; }
      }
      const truthy = lVals.filter(v => v !== null && v !== undefined && v !== false);
      return truthy.length > 0 ? truthy : rVals;
    }
    if (st === ".") return [item];
    if (/^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(st)) {
      const vn = st.slice(1);
      return this._syncJqVars?.has(vn) ? [this._syncJqVars.get(vn)] : undefined;
    }
    if (st === "true") return [true];
    if (st === "false") return [false];
    if (st === "null") return [null];
    if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(st)) return [Number(st)];
    const fieldUpdM = /^\.([a-zA-Z_][a-zA-Z0-9_]*)\s*(\|=|\+=|-=|\*=|=)\s*(.+)$/.exec(st);
    if (fieldUpdM && item && typeof item === "object" && !Array.isArray(item)) {
      const k = fieldUpdM[1]!;
      const op = fieldUpdM[2]!;
      const rhsExpr = fieldUpdM[3]!.trim();
      const clone = { ...(item as Record<string, unknown>) };
      const curVal = Object.hasOwn(clone, k) ? clone[k] ?? null : null;
      if (op === "|=") {
        const r = this.evalSyncJqPathOps(curVal, rhsExpr);
        if (!r || r.length !== 1) return undefined;
        clone[k] = r[0];
        return [clone];
      }
      const r = this.evalSyncJqPathOps(item, rhsExpr);
      if (!r || r.length !== 1) return undefined;
      const rv = r[0];
      if (op === "=") {
        clone[k] = rv;
        return [clone];
      }
      if (op === "+=") {
        if (typeof curVal === "number" && typeof rv === "number") { clone[k] = curVal + rv; return [clone]; }
        if (typeof curVal === "string" && typeof rv === "string") { clone[k] = curVal + rv; return [clone]; }
        if (Array.isArray(curVal) && Array.isArray(rv)) { clone[k] = [...curVal, ...rv]; return [clone]; }
        if (curVal === null) { clone[k] = rv; return [clone]; }
        if (rv === null) { clone[k] = curVal; return [clone]; }
        return undefined;
      }
      if (op === "-=" && typeof curVal === "number" && typeof rv === "number") { clone[k] = curVal - rv; return [clone]; }
      if (op === "*=" && typeof curVal === "number" && typeof rv === "number") { clone[k] = curVal * rv; return [clone]; }
      return undefined;
    }
    const withEntriesM = /^with_entries\(\s*(.+)\s*\)$/.exec(st);
    if (withEntriesM && item && typeof item === "object" && !Array.isArray(item)) {
      const subExpr = withEntriesM[1]!;
      const outObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        const subRes = this.evalSyncJqPathOps({ key, value }, subExpr);
        if (!subRes) return undefined;
        for (const el of subRes) {
          if (!el || typeof el !== "object" || Array.isArray(el)) return undefined;
          const rec = el as Record<string, unknown>;
          const k = [rec.key, rec.Key, rec.name, rec.Name].find(v => v !== undefined && v !== null && v !== false);
          if (typeof k !== "string") return undefined;
          outObj[k] = Object.hasOwn(rec, "value") ? rec.value : (Object.hasOwn(rec, "Value") ? rec.Value : null);
        }
      }
      return [outObj];
    }
    const dotArithM = /^\.\s*([+*\/%-])\s*(-?[0-9]+(?:\.[0-9]+)?)$/.exec(st);
    if (dotArithM && typeof item === "number") {
      const op = dotArithM[1]!;
      const rhs = Number(dotArithM[2]!);
      if ((op === "/" || op === "%") && rhs === 0) return undefined;
      return [op === "+" ? item + rhs : op === "-" ? item - rhs : op === "*" ? item * rhs : op === "/" ? item / rhs : item % rhs];
    }
    if (st === "floor") return typeof item === "number" ? [Math.floor(item)] : undefined;
    if (st === "ceil") return typeof item === "number" ? [Math.ceil(item)] : undefined;
    if (st === "round") return typeof item === "number" ? [Math.sign(item) * Math.round(Math.abs(item))] : undefined;
    if (st === "abs") return typeof item === "number" ? [Math.abs(item)] : undefined;
    if (st === "utf8bytelength") return typeof item === "string" ? [fastSharedTextEncoder.encode(item).byteLength] : undefined;
    if (st === "explode") return typeof item === "string" ? [Array.from(item, c => c.codePointAt(0)!)] : undefined;
    if (st === "implode") {
      if (!Array.isArray(item) || !item.every(x => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0x10ffff)) return undefined;
      return [(item as number[]).map(cp => String.fromCodePoint(cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp)).join("")];
    }
    if (st === "transpose") {
      if (!Array.isArray(item) || !item.every(row => Array.isArray(row))) return undefined;
      const rows = item as unknown[][];
      const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
      const trans: unknown[][] = [];
      for (let c = 0; c < maxCols; c++) {
        trans.push(rows.map(r => c < r.length ? r[c] : null));
      }
      return [trans];
    }
    const idxFnM = /^(index|rindex|indices)\(\s*"([^"\\]*)"\s*\)$/.exec(st);
    if (idxFnM && (typeof item === "string" || Array.isArray(item))) {
      const fn = idxFnM[1]!;
      const sub = idxFnM[2]!;
      const found: number[] = [];
      if (Array.isArray(item)) {
        for (let i = 0; i < item.length; i++) {
          if (item[i] === sub) found.push(i);
        }
      } else if (sub.length > 0) {
        let pos = 0;
        while ((pos = item.indexOf(sub, pos)) !== -1) {
          found.push(fastSharedTextEncoder.encode(item.slice(0, pos)).byteLength);
          pos += 1;
        }
      }
      if (fn === "indices") return [found];
      if (fn === "index") return [found.length > 0 ? found[0]! : null];
      return [found.length > 0 ? found[found.length - 1]! : null];
    }
    if (st === "length") {
      if (item === null || item === undefined) return [0];
      if (typeof item === "string") return [Array.from(item).length];
      if (typeof item === "number") return [Math.abs(item)];
      if (Array.isArray(item)) return [item.length];
      if (typeof item === "object") return [Object.keys(item).length];
      return undefined;
    }
    if (st === "keys") {
      if (Array.isArray(item)) return [item.map((_, idx) => idx)];
      if (item && typeof item === "object") return [Object.keys(item).sort()];
      return undefined;
    }
    if (st === "keys[]") {
      if (Array.isArray(item)) return item.map((_, idx) => idx);
      if (item && typeof item === "object") return Object.keys(item).sort();
      return undefined;
    }
    if (st === "values") {
      return item === null || item === undefined ? [] : [item];
    }
    if (st === "empty") return [];
    if (st === "not") return [!(item !== false && item !== null && item !== undefined)];
    if (st === "any") return Array.isArray(item) ? [item.some(x => x !== false && x !== null && x !== undefined)] : undefined;
    if (st === "all") return Array.isArray(item) ? [item.every(x => x !== false && x !== null && x !== undefined)] : undefined;
    if (st === "keys_unsorted") {
      if (Array.isArray(item)) return [item.map((_, idx) => idx)];
      if (item && typeof item === "object") return [Object.keys(item)];
      return undefined;
    }
    if (st === "flatten") return Array.isArray(item) ? [item.flat(Infinity)] : undefined;
    const flatM = /^flatten\(\s*([0-9]{1,2})\s*\)$/.exec(st);
    if (flatM) return Array.isArray(item) ? [item.flat(Number(flatM[1]!))] : undefined;
    if (st === "sort") {
      if (!Array.isArray(item)) return undefined;
      if (item.every(x => typeof x === "number")) return [[...(item as number[])].sort((a, b) => a - b)];
      if (item.every(x => typeof x === "string")) return [[...(item as string[])].sort(compareSyncJqStrings)];
      return undefined;
    }
    if (st === "tojson") return [JSON.stringify(item)];
    if (st === "fromjson") {
      if (typeof item !== "string") return undefined;
      try { return [JSON.parse(item)]; } catch { return undefined; }
    }
    const mvM = /^map_values\(\s*(.+)\s*\)$/.exec(st);
    if (mvM && item && typeof item === "object") {
      const subExpr = mvM[1]!;
      if (Array.isArray(item)) {
        const outArr: unknown[] = [];
        for (const el of item) {
          const r = this.evalSyncJqPathOps(el, subExpr);
          if (!r || r.length !== 1) return undefined;
          outArr.push(r[0]);
        }
        return [outArr];
      }
      const outObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        const r = this.evalSyncJqPathOps(v, subExpr);
        if (!r || r.length !== 1) return undefined;
        outObj[k] = r[0];
      }
      return [outObj];
    }
    const firstLastFnM = /^(first|last)\(\s*(.+)\s*\)$/.exec(st);
    if (firstLastFnM) {
      const genVals = this.evalSyncJqPathOps(item, firstLastFnM[2]!.trim());
      if (!genVals) return undefined;
      if (genVals.length === 0) return [];
      return [firstLastFnM[1] === "first" ? genVals[0] : genVals[genVals.length - 1]];
    }
    const limitFnM = /^limit\(\s*([0-9]+)\s*;\s*(.+)\s*\)$/.exec(st);
    if (limitFnM) {
      const n = Number(limitFnM[1]!);
      const genVals = this.evalSyncJqPathOps(item, limitFnM[2]!.trim());
      if (!genVals) return undefined;
      return genVals.slice(0, n);
    }
    const isEmptyFnM = /^isempty\(\s*(.+)\s*\)$/.exec(st);
    if (isEmptyFnM) {
      const genVals = this.evalSyncJqPathOps(item, isEmptyFnM[1]!.trim());
      if (!genVals) return undefined;
      return [genVals.length === 0];
    }
    const byM = /^(sort_by|unique_by|group_by|min_by|max_by)\(\s*(.+)\s*\)$/.exec(st);
    if (byM && Array.isArray(item)) {
      const fn = byM[1]!;
      const kPath = byM[2]!;
      const keyed: Array<{ el: unknown; k: string | number | boolean | null }> = [];
      for (const el of item) {
        const kv = this.evalSyncJqPathOps(el, kPath);
        if (!kv || kv.length !== 1) return undefined;
        const k0 = kv[0];
        if (typeof k0 !== "string" && typeof k0 !== "number" && typeof k0 !== "boolean" && k0 !== null) return undefined;
        keyed.push({ el, k: k0 });
      }
      const cmpK = (a: string | number | boolean | null, b: string | number | boolean | null): number => {
        const rank = (value: string | number | boolean | null): number =>
          value === null ? 0 : value === false ? 1 : value === true ? 2 : typeof value === "number" ? 3 : 4;
        const typeOrder = rank(a) - rank(b);
        if (typeOrder !== 0) return typeOrder;
        if (typeof a === "number" && typeof b === "number") return a - b;
        const sa = String(a);
        const sb = String(b);
        return compareSyncJqStrings(sa, sb);
      };
      keyed.sort((a, b) => cmpK(a.k, b.k));
      if (fn === "min_by") return [keyed.length > 0 ? keyed[0]!.el : null];
      if (fn === "max_by") return [keyed.length > 0 ? keyed[keyed.length - 1]!.el : null];
      if (fn === "sort_by") return [keyed.map(p => p.el)];
      if (fn === "unique_by") {
        const u: unknown[] = [];
        for (let i = 0; i < keyed.length; i++) {
          if (i === 0 || cmpK(keyed[i]!.k, keyed[i - 1]!.k) !== 0) u.push(keyed[i]!.el);
        }
        return [u];
      }
      const groups: unknown[][] = [];
      for (let i = 0; i < keyed.length; i++) {
        if (i === 0 || cmpK(keyed[i]!.k, keyed[i - 1]!.k) !== 0) groups.push([keyed[i]!.el]);
        else groups[groups.length - 1]!.push(keyed[i]!.el);
      }
      return [groups];
    }
    if (st === "first") {
      return Array.isArray(item) ? [item.length > 0 ? item[0] : null] : undefined;
    }
    if (st === "last") {
      return Array.isArray(item) ? [item.length > 0 ? item[item.length - 1] : null] : undefined;
    }
    if (st === "reverse") {
      return Array.isArray(item) ? [[...item].reverse()] : undefined;
    }
    // Use the jq engine for its complete type ordering and equality semantics.
    if (st === "unique") return undefined;
    if (st === "add") {
      if (!Array.isArray(item)) return undefined;
      if (item.length === 0) return [null];
      if (item.every(x => typeof x === "number")) return [(item as number[]).reduce((a, b) => a + b, 0)];
      if (item.every(x => typeof x === "string")) return [(item as string[]).join("")];
      if (item.every(x => Array.isArray(x))) return [(item as unknown[][]).flat()];
      return undefined;
    }
    if (st === "min" || st === "max") {
      if (!Array.isArray(item)) return undefined;
      if (item.length === 0) return [null];
      if (item.every(x => typeof x === "number")) {
        return [st === "min" ? Math.min(...(item as number[])) : Math.max(...(item as number[]))];
      }
      if (item.every(x => typeof x === "string")) {
        const sorted = [...(item as string[])].sort(compareSyncJqStrings);
        return [st === "min" ? sorted[0] : sorted[sorted.length - 1]];
      }
      return undefined;
    }
    if (st === "to_entries") {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return [Object.entries(item as Record<string, unknown>).map(([key, value]) => ({ key, value }))];
      }
      return undefined;
    }
    if (st === "@text") return [typeof item === "string" ? item : JSON.stringify(item)];
    if (st === "@json") return [JSON.stringify(item)];
    if (st === "@uri") return typeof item === "string" ? [encodeURIComponent(item)] : undefined;
    if (st === "@base64") {
      return typeof item === "string" ? [this.syncBase64Encode(fastSharedTextEncoder.encode(item)).replace(/\n/g, "")] : undefined;
    }
    if (st === "@base64d") {
      if (typeof item !== "string") return undefined;
      const cleaned = item.replace(/[ \t\r\n]+/g, "");
      if (cleaned.length % 4 !== 0 || (cleaned.length > 0 && !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned))) return undefined;
      const dec = this.syncBase64DecodeBytes(cleaned);
      if (dec.some(b => b === 0 || b >= 128)) return undefined;
      return [sharedSyncPipeDecoder.decode(dec)];
    }
    if (st === "@sh") {
      if (typeof item === "string") return ["'" + item.replace(/'/g, "'\\''") + "'"];
      if (Array.isArray(item) && item.every(x => typeof x === "string" || typeof x === "number" || typeof x === "boolean")) {
        return [item.map(x => typeof x === "string" ? "'" + x.replace(/'/g, "'\\''") + "'" : String(x)).join(" ")];
      }
      return undefined;
    }
    if (st === "@tsv") {
      if (!Array.isArray(item) || !item.every(x => typeof x === "string" || typeof x === "number" || typeof x === "boolean" || x === null)) return undefined;
      return [item.map(x => x === null ? "" : typeof x === "string" ? x.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n") : String(x)).join("\t")];
    }
    if (st === "@csv") {
      if (!Array.isArray(item) || !item.every(x => typeof x === "string" || typeof x === "number" || typeof x === "boolean" || x === null)) return undefined;
      return [item.map(x => x === null ? "" : typeof x === "string" ? "\"" + x.replace(/"/g, "\"\"") + "\"" : String(x)).join(",")];
    }
    const withEntM = /^with_entries\(\s*(.+)\s*\)$/.exec(st);
    if (withEntM) {
      return this.evalSyncJqPathOps(item, `to_entries | map(${withEntM[1]!}) | from_entries`);
    }
    if (st.startsWith("[") && st.endsWith("]") && !st.startsWith("[].[")) {
      const innerArr = st.slice(1, -1).trim();
      if (innerArr.length === 0) return [[]];
      const elemSplit = splitSyncJqExpression(innerArr, ",");
      if (!elemSplit) return undefined;
      const outArr: unknown[] = [];
      for (const elSpec of elemSplit.parts) {
        const vals = this.evalSyncJqPathOps(item, elSpec.trim());
        if (!vals) return undefined;
        for (const v of vals) outArr.push(v);
      }
      return [outArr];
    }
    if (st === "from_entries") {
      if (!Array.isArray(item)) return undefined;
      const obj: Record<string, unknown> = {};
      for (const el of item) {
        if (!el || typeof el !== "object" || Array.isArray(el)) return undefined;
        const rec = el as Record<string, unknown>;
        const k = [rec.key, rec.Key, rec.name, rec.Name].find(value => value !== undefined && value !== null && value !== false);
        if (typeof k !== "string") return undefined;
        obj[k] = Object.hasOwn(rec, "value") ? rec.value : (Object.hasOwn(rec, "Value") ? rec.Value : null);
      }
      return [obj];
    }
    if (st === "tonumber") {
      if (typeof item === "number") return [item];
      if (typeof item === "string" && /^[ \t]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[ \t]*$/.test(item)) return [Number(item)];
      return undefined;
    }
    if (st === "tostring") {
      return [typeof item === "string" ? item : JSON.stringify(item)];
    }
    if (st === "type") {
      return [item === null ? "null" : Array.isArray(item) ? "array" : typeof item];
    }
    if (st === "ascii_upcase") {
      return typeof item === "string" ? [item.replace(/[a-z]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 32))] : undefined;
    }
    if (st === "ascii_downcase") {
      return typeof item === "string" ? [item.replace(/[A-Z]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 32))] : undefined;
    }
    const strFnM = /^(join|split|ltrimstr|rtrimstr|startswith|endswith|contains)\(\s*"([^"\\]*)"\s*\)$/.exec(st);
    if (strFnM) {
      const fn = strFnM[1]!;
      const arg = strFnM[2]!;
      if (fn === "join") {
        if (!Array.isArray(item) || !item.every(x => typeof x === "string" || typeof x === "number" || typeof x === "boolean" || x === null)) return undefined;
        return [item.map(x => x === null ? "" : String(x)).join(arg)];
      }
      if (fn === "split") return typeof item === "string" ? [arg === "" ? Array.from(item) : item.split(arg)] : undefined;
      if (fn === "ltrimstr") return typeof item === "string" ? [item.startsWith(arg) ? item.slice(arg.length) : item] : undefined;
      if (fn === "rtrimstr") return typeof item === "string" ? [arg.length > 0 && item.endsWith(arg) ? item.slice(0, -arg.length) : item] : undefined;
      if (fn === "startswith") return typeof item === "string" ? [item.startsWith(arg)] : undefined;
      if (fn === "endswith") return typeof item === "string" ? [item.endsWith(arg)] : undefined;
      if (fn === "contains") {
        if (typeof item === "string") return [item.includes(arg)];
        return undefined;
      }
    }
    const hasM = /^has\(\s*"([^"\\]+)"\s*\)$/.exec(st);
    if (hasM) {
      if (item && typeof item === "object" && !Array.isArray(item)) return [Object.hasOwn(item, hasM[1]!)];
      return undefined;
    }
    const mapM = /^map\(\s*(.+)\s*\)$/.exec(st);
    if (mapM) {
      if (!Array.isArray(item)) return undefined;
      const mapped: unknown[] = [];
      for (const el of item) {
        const subRes = this.evalSyncJqPathOps(el, mapM[1]!);
        if (subRes === undefined) return undefined;
        for (const v of subRes) mapped.push(v);
      }
      return [mapped];
    }
    const selM = /^select\(\s*(\.[a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:(==|!=|>=|<=|>|<)\s*(.+))?\s*\)$/.exec(st);
    if (selM && (!selM[3] || (!/\b(?:and|or)\b/.test(selM[3])))) {
      const fVals = this.evalSyncJqPathOps(item, selM[1]!);
      if (!fVals || fVals.length !== 1) return undefined;
      const lv = fVals[0];
      if (!selM[2]) {
        return lv !== null && lv !== undefined && lv !== false ? [item] : [];
      }
      let rv: unknown;
      const rhsTrim = selM[3]!.trim();
      const rhsEval = this.evalSyncJqPathOps(item, rhsTrim);
      if (rhsEval && rhsEval.length === 1) {
        rv = rhsEval[0];
      } else {
        try {
          rv = JSON.parse(rhsTrim);
        } catch {
          return undefined;
        }
      }
      // The full jq evaluator owns structural equality and jq ordering.
      if ((typeof lv === "object" && lv !== null) || (typeof rv === "object" && rv !== null)) return undefined;
      const op = selM[2]!;
      let ok = false;
      if (op === "==") ok = lv === rv;
      else if (op === "!=") ok = lv !== rv;
      else if (typeof lv === "number" && typeof rv === "number") {
        if (op === ">") ok = lv > rv;
        else if (op === ">=") ok = lv >= rv;
        else if (op === "<") ok = lv < rv;
        else if (op === "<=") ok = lv <= rv;
      } else return undefined;
      return ok ? [item] : [];
    }
    const genSelM = /^select\(\s*(.+)\s*\)$/.exec(st);
    if (genSelM) {
      const condVals = this.evalSyncJqPathOps(item, genSelM[1]!);
      if (!condVals) return undefined;
      return condVals.filter(v => v !== null && v !== undefined && v !== false).map(() => item);
    }
    const delGenM = /^del\(\s*(.+)\s*\)$/.exec(st);
    if (delGenM && item && typeof item === "object") {
      const delSpecs = splitSyncJqExpression(delGenM[1]!, ",");
      if (delSpecs && delSpecs.parts.length > 0) {
        if (!Array.isArray(item)) {
          const clone: Record<string, unknown> = { ...(item as Record<string, unknown>) };
          let okDel = true;
          for (const rawSpec of delSpecs.parts) {
            const m = /^\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?$/.exec(rawSpec.trim());
            if (!m) { okDel = false; break; }
            const k1 = m[1]!;
            const k2 = m[2];
            if (k2 === undefined) {
              delete clone[k1];
            } else if (clone[k1] && typeof clone[k1] === "object" && !Array.isArray(clone[k1])) {
              const subClone = { ...(clone[k1] as Record<string, unknown>) };
              delete subClone[k2];
              clone[k1] = subClone;
            } else if (clone[k1] !== null && clone[k1] !== undefined) {
              return undefined;
            }
          }
          if (okDel) return [clone];
        } else {
          const idxsToDelete = new Set<number>();
          let okDel = true;
          for (const rawSpec of delSpecs.parts) {
            const m = /^\.\[\s*(-?[0-9]+)\s*\]$/.exec(rawSpec.trim());
            if (!m) { okDel = false; break; }
            let idx = Number(m[1]!);
            if (idx < 0) idx = item.length + idx;
            if (idx >= 0 && idx < item.length) idxsToDelete.add(idx);
          }
          if (okDel) return [item.filter((_, idx) => !idxsToDelete.has(idx))];
        }
      }
    }
    const rangeFnM = /^range\(\s*(.+)\s*\)$/.exec(st);
    if (rangeFnM) {
      const argSplit = splitSyncJqExpression(rangeFnM[1]!, ";");
      if (!argSplit || argSplit.parts.length < 1 || argSplit.parts.length > 3) return undefined;
      const evalNum = (e: string): number | undefined => {
        const v = this.evalSyncJqPathOps(item, e.trim());
        return v && v.length === 1 && typeof v[0] === "number" && Number.isFinite(v[0]) ? v[0] : undefined;
      };
      const start = argSplit.parts.length === 1 ? 0 : evalNum(argSplit.parts[0]!);
      const end = evalNum(argSplit.parts[argSplit.parts.length === 1 ? 0 : 1]!);
      const step = argSplit.parts.length === 3 ? evalNum(argSplit.parts[2]!) : 1;
      if (start === undefined || end === undefined || step === undefined || step === 0) return undefined;
      const count = Math.max(0, Math.ceil((end - start) / step));
      if (!Number.isFinite(count) || count > 10000) return undefined;
      const outRange: unknown[] = [];
      for (let cur = start; step > 0 ? cur < end : cur > end; cur += step) {
        outRange.push(cur);
      }
      return outRange;
    }
    const anyAllFnM = /^(any|all)\(\s*(.+)\s*\)$/.exec(st);
    if (anyAllFnM) {
      const argSplit = splitSyncJqExpression(anyAllFnM[2]!, ";");
      if (argSplit && (argSplit.parts.length === 1 ? Array.isArray(item) : argSplit.parts.length === 2)) {
        const isAny = anyAllFnM[1] === "any";
        const sourceItems = argSplit.parts.length === 1 ? (item as unknown[]) : this.evalSyncJqPathOps(item, argSplit.parts[0]!.trim());
        if (!sourceItems) return undefined;
        const predExpr = argSplit.parts[argSplit.parts.length === 1 ? 0 : 1]!.trim();
        for (const el of sourceItems) {
          const r = this.evalSyncJqPathOps(el, predExpr);
          if (!r) return undefined;
          for (const rv of r) {
            const truthy = rv !== false && rv !== null && rv !== undefined;
            if (isAny && truthy) return [true];
            if (!isAny && !truthy) return [false];
          }
        }
        return [isAny ? false : true];
      }
    }
    if (st === "paths" || st === "leaf_paths" || st === "paths(scalars)") {
      if (!item || typeof item !== "object") return [];
      const leavesOnly = st !== "paths";
      const outPaths: unknown[] = [];
      const walkPaths = (cur: unknown, prefix: Array<string | number>): void => {
        if (Array.isArray(cur)) {
          for (let i = 0; i < cur.length; i++) {
            const nextP = [...prefix, i];
            const val = cur[i];
            const isScalar = val === null || typeof val !== "object";
            if (!leavesOnly || isScalar) outPaths.push(nextP);
            if (!isScalar) walkPaths(val, nextP);
          }
        } else if (cur && typeof cur === "object") {
          for (const k of Object.keys(cur as Record<string, unknown>)) {
            const nextP = [...prefix, k];
            const val = (cur as Record<string, unknown>)[k];
            const isScalar = val === null || typeof val !== "object";
            if (!leavesOnly || isScalar) outPaths.push(nextP);
            if (!isScalar) walkPaths(val, nextP);
          }
        }
      };
      walkPaths(item, []);
      return outPaths;
    }
    const getPathM = /^getpath\(\s*(.+)\s*\)$/.exec(st);
    if (getPathM) {
      const pVals = this.evalSyncJqPathOps(item, getPathM[1]!.trim());
      if (!pVals || pVals.length !== 1 || !Array.isArray(pVals[0])) return undefined;
      let cur: unknown = item;
      for (const stepKey of pVals[0] as unknown[]) {
        if (cur === null || cur === undefined) {
          if (typeof stepKey === "string" || (typeof stepKey === "number" && Number.isInteger(stepKey))) {
            cur = null;
            continue;
          }
          return undefined;
        }
        if (Array.isArray(cur) && typeof stepKey === "number" && Number.isInteger(stepKey)) {
          const idx = stepKey < 0 ? cur.length + stepKey : stepKey;
          cur = idx >= 0 && idx < cur.length ? cur[idx] : null;
        } else if (cur && typeof cur === "object" && !Array.isArray(cur) && typeof stepKey === "string") {
          cur = Object.hasOwn(cur, stepKey) ? (cur as Record<string, unknown>)[stepKey] : null;
        } else {
          return undefined;
        }
      }
      return [cur];
    }
    const subFnM = /^(g?sub)\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*;\s*"([^"\\]*(?:\\.[^"\\]*)*)"(?:\s*;\s*"([gi]*)")?\s*\)$/.exec(st);
    if (subFnM && typeof item === "string" && !subFnM[3]!.includes("\\(")) {
      try {
        const patStr = JSON.parse("\"" + subFnM[2]! + "\"") as string;
        const repStr = JSON.parse("\"" + subFnM[3]! + "\"") as string;
        const flags = (subFnM[1] === "gsub" ? "g" : "") + ((subFnM[4] ?? "").includes("i") ? "i" : "");
        const re = new RegExp(patStr, flags);
        return [item.replace(re, () => repStr)];
      } catch {
        return undefined;
      }
    }
    const scanFnM = /^scan\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"(?:\s*;\s*"([i]*)")?\s*\)$/.exec(st);
    if (scanFnM && typeof item === "string") {
      try {
        const patStr = JSON.parse("\"" + scanFnM[1]! + "\"") as string;
        if (patStr.length === 0) return undefined;
        const re = new RegExp(patStr, "g" + ((scanFnM[2] ?? "").includes("i") ? "i" : ""));
        const matches: unknown[] = [];
        for (const m of item.matchAll(re)) {
          if (m[0].length === 0) return undefined;
          matches.push(m.length > 1 ? m.slice(1).map(g => g ?? null) : m[0]);
        }
        return matches;
      } catch {
        return undefined;
      }
    }
    const testFnM = /^test\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"(?:\s*;\s*"([im]*)")?\s*\)$/.exec(st);
    if (testFnM && typeof item === "string") {
      try {
        const patStr = JSON.parse("\"" + testFnM[1]! + "\"") as string;
        const re = new RegExp(patStr, testFnM[2] ?? "");
        return [re.test(item)];
      } catch {
        return undefined;
      }
    }
    if (st.startsWith("{") && st.endsWith("}")) {
      const innerObj = st.slice(1, -1).trim();
      if (innerObj.length === 0) return [{}];
      const fieldsSplit = splitSyncJqExpression(innerObj, ",");
      if (!fieldsSplit) return undefined;
      const outObj: Record<string, unknown> = {};
      for (const fieldSpec of fieldsSplit.parts) {
        const fs = fieldSpec.trim();
        const shortM = /^\.([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(fs);
        if (shortM) {
          const k = shortM[1]!;
          const v = this.evalSyncJqPathOps(item, "." + k);
          if (!v || v.length !== 1) return undefined;
          outObj[k] = v[0];
          continue;
        }
        const shortVarM = /^\$([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(fs);
        if (shortVarM) {
          const k = shortVarM[1]!;
          if (!this._syncJqVars?.has(k)) return undefined;
          outObj[k] = this._syncJqVars.get(k);
          continue;
        }
        const dynKvM = /^\(\s*([^)]+)\s*\)\s*:\s*(.+)$/.exec(fs);
        if (dynKvM) {
          const kRes = this.evalSyncJqPathOps(item, dynKvM[1]!.trim());
          if (!kRes || kRes.length !== 1 || typeof kRes[0] !== "string") return undefined;
          const vRes = this.evalSyncJqPathOps(item, dynKvM[2]!);
          if (!vRes || vRes.length !== 1) return undefined;
          outObj[kRes[0]] = vRes[0];
          continue;
        }
        const kvM = /^(?:"([^"\\]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s*:\s*(.+)$/.exec(fs);
        if (!kvM) return undefined;
        const k = (kvM[1] ?? kvM[2])!;
        const v = this.evalSyncJqPathOps(item, kvM[3]!);
        if (!v || v.length !== 1) return undefined;
        outObj[k] = v[0];
      }
      return [outObj];
    }
    if (st.startsWith("\"") && st.endsWith("\"") && st.length >= 2) {
      const body = st.slice(1, -1);
      if (!body.includes("\\(")) {
        try { return [JSON.parse(st)]; } catch { return undefined; }
      }
      let outStr = "";
      let pos = 0;
      while (pos < body.length) {
        const idx = body.indexOf("\\(", pos);
        if (idx === -1) {
          const tail = body.slice(pos);
          if (tail.includes("\\")) return undefined;
          outStr += tail;
          break;
        }
        const lit = body.slice(pos, idx);
        if (lit.includes("\\")) return undefined;
        outStr += lit;
        let depth = 1;
        let end = idx + 2;
        while (end < body.length && depth > 0) {
          if (body[end] === "(") depth++;
          else if (body[end] === ")") depth--;
          if (depth > 0) end++;
        }
        if (depth !== 0) return undefined;
        const subExpr = body.slice(idx + 2, end).trim();
        const v = this.evalSyncJqPathOps(item, subExpr);
        if (!v || v.length !== 1) return undefined;
        const val = v[0];
        outStr += val === null ? "null" : typeof val === "string" ? val : JSON.stringify(val);
        pos = end + 1;
      }
      return [outStr];
    }
    const ifM = /^if\s+(.+?)\s+then\s+(.+?)\s+(?:elif\s+(.+)\s+end|else\s+(.+)\s+end)$/.exec(st);
    if (ifM) {
      const cVals = this.evalSyncJqPathOps(item, ifM[1]!);
      const tVals = this.evalSyncJqPathOps(item, ifM[2]!);
      const eVals = ifM[3] !== undefined ? this.evalSyncJqPathOps(item, "if " + ifM[3] + " end") : this.evalSyncJqPathOps(item, ifM[4]!);
      if (!cVals || cVals.length !== 1 || !tVals || !eVals) return undefined;
      const truthy = cVals[0] !== false && cVals[0] !== null && cVals[0] !== undefined;
      return truthy ? tVals : eVals;
    }
    for (const mode of ["or", "and", "cmp", "add", "mul"] as const) {
      const bin = this.splitTopLevelJqOp(st, mode);
      if (!bin) continue;
      const lVals = this.evalSyncJqPathOps(item, bin.lhs);
      const rVals = this.evalSyncJqPathOps(item, bin.rhs);
      if (!lVals || lVals.length !== 1 || !rVals || rVals.length !== 1) return undefined;
      const lv = lVals[0];
      const rv = rVals[0];
      const op = bin.op;
      if (mode === "or" || mode === "and") {
        const lTruthy = lv !== false && lv !== null && lv !== undefined;
        const rTruthy = rv !== false && rv !== null && rv !== undefined;
        return [mode === "or" ? (lTruthy || rTruthy) : (lTruthy && rTruthy)];
      }
      if (mode === "cmp") {
        if ((typeof lv === "object" && lv !== null) || (typeof rv === "object" && rv !== null)) return undefined;
        if (op === "==") return [lv === rv];
        if (op === "!=") return [lv !== rv];
        if (typeof lv === "number" && typeof rv === "number") {
          return [op === ">" ? lv > rv : op === ">=" ? lv >= rv : op === "<" ? lv < rv : lv <= rv];
        }
        return undefined;
      }
      if (op === "+") {
        if (typeof lv === "number" && typeof rv === "number") return [lv + rv];
        if (typeof lv === "string" && typeof rv === "string") return [lv + rv];
        if (Array.isArray(lv) && Array.isArray(rv)) return [[...lv, ...rv]];
        if (lv && typeof lv === "object" && !Array.isArray(lv) && rv && typeof rv === "object" && !Array.isArray(rv)) {
          return [{ ...(lv as Record<string, unknown>), ...(rv as Record<string, unknown>) }];
        }
        if (lv === null) return [rv];
        if (rv === null) return [lv];
        return undefined;
      }
      if (op === "-" && typeof lv === "number" && typeof rv === "number") return [lv - rv];
      if (op === "*" && typeof lv === "number" && typeof rv === "number") return [lv * rv];
      if (op === "/" && typeof lv === "number" && typeof rv === "number") return rv !== 0 ? [lv / rv] : undefined;
      if (op === "%" && typeof lv === "number" && typeof rv === "number") return rv !== 0 ? [Math.trunc(lv) % Math.trunc(rv)] : undefined;
      return undefined;
    }
    if (!st.startsWith(".")) return undefined;
    let rest = st.slice(1);
    const ops: Array<{ kind: "prop"; key: string } | { kind: "index"; idx: number } | { kind: "iter" }> = [];
    while (rest.length > 0) {
      if (rest.startsWith(".")) rest = rest.slice(1);
      const propM = /^([a-zA-Z_][a-zA-Z0-9_]*)/.exec(rest);
      if (propM) {
        ops.push({ kind: "prop", key: propM[1]! });
        rest = rest.slice(propM[1]!.length);
        continue;
      }
      if (rest.startsWith("[]")) {
        ops.push({ kind: "iter" });
        rest = rest.slice(2);
        continue;
      }
      const idxM = /^\[(-?[0-9]+)\]/.exec(rest);
      if (idxM) {
        ops.push({ kind: "index", idx: Number(idxM[1]!) });
        rest = rest.slice(idxM[0]!.length);
        continue;
      }
      return undefined;
    }
    let cur: unknown[] = [item];
    for (const op of ops) {
      const next: unknown[] = [];
      for (const it of cur) {
        if (op.kind === "prop") {
          if (it === null || it === undefined) next.push(null);
          else if (typeof it === "object" && !Array.isArray(it)) next.push(Object.hasOwn(it, op.key) ? (it as Record<string, unknown>)[op.key] ?? null : null);
          else return undefined;
        } else if (op.kind === "index") {
          if (it === null || it === undefined) next.push(null);
          else if (Array.isArray(it)) {
            const i = op.idx < 0 ? it.length + op.idx : op.idx;
            next.push(i >= 0 && i < it.length ? it[i] : null);
          } else return undefined;
        } else if (op.kind === "iter") {
          if (Array.isArray(it)) {
            for (const el of it) next.push(el);
          } else if (it && typeof it === "object") {
            for (const k of Object.keys(it)) next.push((it as Record<string, unknown>)[k]);
          } else return undefined;
        }
      }
      cur = next;
    }
    return cur;
  }
,
  evalSyncXqOrYq(this: any, 
    name: "xq" | "yq",
    rawBytes: Uint8Array,
    args: readonly string[],
    readFile?: (p: string) => Uint8Array | undefined,
  ): string | undefined {
    if (name === "xq") {
      const prep = evalSyncXq(rawBytes, args, readFile);
      if (!prep) return undefined;
      const jqLines = this.evalSyncJq(prep.jsonStr, prep.jqArgs);
      if (!jqLines) return undefined;
      return jqLines.length > 0 ? jqLines.join("\n") + "\n" : "";
    }
    const prep = evalSyncYqPrep(rawBytes, args, readFile);
    if (!prep) return undefined;
    const jqLines = this.evalSyncJq(prep.jsonStr, prep.jqArgs);
    if (!jqLines) return undefined;
    if (prep.format === "json") {
      return jqLines.length > 0 ? jqLines.join("\n") + "\n" : "";
    }
    return formatSyncYqYamlLines(jqLines);
  }
,
  evalSyncJq(this: any, input: string | undefined, opArgs: readonly string[], cwd?: string, rawInputText?: string): string[] | undefined {
    let rawOut = false;
    let joinOut = false;
    let rawInput = false;
    let sortKeys = false;
    let compactOut = false;
    let nullInput = false;
    let slurp = false;
    let useTab = false;
    let indentCount = 2;
    let filter: string | undefined;
    let ended = false;
    const fileOperands: string[] = [];
    const vars = new Map<string, unknown>();
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (ended || !a.startsWith("-") || a === "-") {
        if (filter === undefined) {
          filter = a;
        } else {
          if (a === "-") return undefined;
          fileOperands.push(a);
        }
        continue;
      }
      if (a === "--") { ended = true; continue; }
      if (a === "--raw-output") { rawOut = true; continue; }
      if (a === "--join-output") { rawOut = true; joinOut = true; continue; }
      if (a === "--raw-input") { rawInput = true; continue; }
      if (a === "--sort-keys") { sortKeys = true; continue; }
      if (a === "--compact-output") { compactOut = true; continue; }
      if (a === "--null-input") { nullInput = true; continue; }
      if (a === "--slurp") { slurp = true; continue; }
      if (a === "--tab") { useTab = true; continue; }
      if (a === "--indent") {
        if (i + 1 >= opArgs.length) return undefined;
        const n = Number(opArgs[++i]!);
        if (!Number.isInteger(n) || n < 0 || n > 8) return undefined;
        indentCount = n;
        continue;
      }
      if (a === "--arg") {
        if (i + 2 >= opArgs.length) return undefined;
        const k = opArgs[++i]!;
        const v = opArgs[++i]!;
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) return undefined;
        vars.set(k, v);
        continue;
      }
      if (a === "--argjson") {
        if (i + 2 >= opArgs.length) return undefined;
        const k = opArgs[++i]!;
        const vRaw = opArgs[++i]!;
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) return undefined;
        try {
          vars.set(k, JSON.parse(vRaw));
        } catch {
          return undefined;
        }
        continue;
      }
      if (a.startsWith("-") && !a.startsWith("--")) {
        for (let j = 1; j < a.length; j++) {
          const ch = a[j]!;
          if (ch === "r") rawOut = true;
          else if (ch === "j") { rawOut = true; joinOut = true; }
          else if (ch === "R") rawInput = true;
          else if (ch === "S") sortKeys = true;
          else if (ch === "c") compactOut = true;
          else if (ch === "n") nullInput = true;
          else if (ch === "s") slurp = true;
          else return undefined;
        }
        continue;
      }
      return undefined;
    }
    if (filter === undefined) return undefined;
    const sortJsonKeysDeep = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(sortJsonKeysDeep);
      if (v && typeof v === "object") {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(v as Record<string, unknown>).sort(compareSyncJqStrings)) {
          sorted[k] = sortJsonKeysDeep((v as Record<string, unknown>)[k]);
        }
        return sorted;
      }
      return v;
    };
    const indentArg: string | number | undefined = compactOut ? undefined : (useTab ? "\t" : indentCount);
    const formatJqVal = (val: unknown): string => {
      if (rawOut && typeof val === "string") return val;
      const target = sortKeys ? sortJsonKeysDeep(val ?? null) : (val ?? null);
      return JSON.stringify(target, null, indentArg);
    };
    const finalizeOut = (items: unknown[]): string[] => {
      const rendered = items.map(formatJqVal);
      if (joinOut) return rendered.length > 0 ? [rendered.join("")] : [];
      return rendered;
    };
    const parseJsonStream = (src: string, target: unknown[]): boolean => {
      try {
        target.push(JSON.parse(src));
        return true;
      } catch {
        if (!src.includes("\n")) return false;
        const before = target.length;
        try {
          for (const line of src.split("\n")) {
            const t = line.trim();
            if (t.length > 0) target.push(JSON.parse(t));
          }
          return target.length > before;
        } catch {
          return false;
        }
      }
    };
    let current: unknown[] = [];
    if (nullInput) {
      current = [null];
    } else if (rawInput) {
      let rawCombined = "";
      if (fileOperands.length > 0) {
        if (!cwd) return undefined;
        let totalB = 0;
        const chunks: string[] = [];
        for (const fPath of fileOperands) {
          const fView = this.tryReadMemoryFileViewSync(resolvePath(cwd, fPath), true, true);
          if (!fView || fView.includes(0)) return undefined;
          totalB += fView.byteLength;
          if (totalB > 16384) return undefined;
          chunks.push(sharedSyncPipeDecoder.decode(fView));
        }
        rawCombined = chunks.join("");
      } else {
        const srcText = rawInputText ?? input;
        if (srcText === undefined) return undefined;
        rawCombined = srcText;
      }
      if (slurp) {
        current = [rawCombined];
      } else {
        if (rawCombined.length === 0) {
          current = [];
        } else {
          const stripped = rawCombined.endsWith("\n") ? rawCombined.slice(0, -1) : rawCombined;
          current = stripped.split("\n").map(l => l.endsWith("\r") ? l.slice(0, -1) : l);
        }
      }
    } else if (fileOperands.length > 0) {
      if (!cwd) return undefined;
      let totalB = 0;
      for (const fPath of fileOperands) {
        const fView = this.tryReadMemoryFileViewSync(resolvePath(cwd, fPath), true, true);
        if (!fView || fView.includes(0)) return undefined;
        totalB += fView.byteLength;
        if (totalB > 16384) return undefined;
        const fStr = sharedSyncPipeDecoder.decode(fView).trim();
        if (!parseJsonStream(fStr, current)) return undefined;
      }
    } else {
      if (input === undefined) return undefined;
      if (!parseJsonStream(input, current)) return undefined;
    }
    if (slurp && !nullInput && !rawInput) {
      current = [current];
    }
    const prevVars = this._syncJqVars;
    this._syncJqVars = vars.size > 0 ? vars : undefined;
    try {
    const trimmedFilter = filter.trim();
    if (trimmedFilter.startsWith("[") && trimmedFilter.endsWith("]") && splitSyncJqExpression(trimmedFilter, "|")?.parts.length === 1) {
      const innerFilter = trimmedFilter.slice(1, -1).trim();
      const outArrays: unknown[] = [];
      for (const item of current) {
        const innerStages = splitSyncJqExpression(innerFilter, "|");
        if (!innerStages) return undefined;
        let subCur: unknown[] = [item];
        for (const st of innerStages.parts) {
          const commas = splitSyncJqExpression(st, ",");
          if (!commas) return undefined;
          const commaParts = commas.parts;
          const next: unknown[] = [];
          for (const it of subCur) {
            for (const part of commaParts) {
              const res = this.evalSyncJqPathOps(it, part);
              if (res === undefined) return undefined;
              for (const v of res) next.push(v);
            }
          }
          subCur = next;
        }
        outArrays.push(subCur);
      }
      return finalizeOut(outArrays);
    }
    const stages = splitSyncJqExpression(filter, "|");
    if (!stages) return undefined;
    for (const st of stages.parts) {
      const commas = splitSyncJqExpression(st, ",");
      if (!commas) return undefined;
      const commaParts = commas.parts;
      const next: unknown[] = [];
      for (const item of current) {
        for (const part of commaParts) {
          const res = this.evalSyncJqPathOps(item, part);
          if (res === undefined) return undefined;
          for (const v of res) next.push(v);
        }
      }
      current = next;
    }
    return finalizeOut(current);
    } finally {
      this._syncJqVars = prevVars;
    }
  },
  evalSyncSeq(this: any, args: readonly string[]): string | undefined {
    let sep = "\n";
    let equalWidth = false;
    let fmt: string | undefined;
    let ended = false;
    const nums: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (ended || !a.startsWith("-") || /^-[0-9.]/.test(a)) {
        const normNum = a.startsWith("+") ? a.slice(1) : a;
        if (!/^-?[0-9]{1,7}(?:\.[0-9]{1,4})?$/.test(normNum)) return undefined;
        nums.push(normNum);
        continue;
      }
      if (a === "--") { ended = true; continue; }
      if (a === "-w" || a === "--equal-width") { equalWidth = true; continue; }
      if (a === "-s" || a === "--separator" || a === "-ws" || a === "-sw") {
        if (a.includes("w")) equalWidth = true;
        if (i + 1 >= args.length) return undefined;
        sep = args[++i]!;
        continue;
      }
      if ((a.startsWith("-s") || a.startsWith("-ws")) && a.length > (a.startsWith("-ws") ? 3 : 2)) {
        if (a.startsWith("-ws")) equalWidth = true;
        sep = a.slice(a.startsWith("-ws") ? 3 : 2);
        continue;
      }
      if (a.startsWith("--separator=")) {
        sep = a.slice(12);
        continue;
      }
      if (a === "-f" || a === "--format" || a === "-wf" || a === "-fw") {
        if (a.includes("w")) equalWidth = true;
        if (i + 1 >= args.length) return undefined;
        fmt = args[++i]!;
        continue;
      }
      if ((a.startsWith("-f") || a.startsWith("-wf")) && a.length > (a.startsWith("-wf") ? 3 : 2)) {
        if (a.startsWith("-wf")) equalWidth = true;
        fmt = a.slice(a.startsWith("-wf") ? 3 : 2);
        continue;
      }
      if (a.startsWith("--format=")) {
        fmt = a.slice(9);
        continue;
      }
      return undefined;
    }
    if (nums.length < 1 || nums.length > 3 || (equalWidth && fmt !== undefined)) return undefined;
    if (sep.includes("\0") || (fmt !== undefined && fmt.includes("\0"))) return undefined;
    let fmtPrefix = "";
    let fmtLeft = false;
    let fmtZeroPad = false;
    let fmtWidth = 0;
    let fmtPrec: number | undefined;
    let fmtSpec: "g" | "f" = "g";
    let fmtSuffix = "";
    if (fmt !== undefined) {
      const m = /^([^%]*?)%(-?)(0?)([0-9]{0,2})(?:\.([0-9]{1,2}))?([gf])([^%]*)$/.exec(fmt);
      if (!m) return undefined;
      fmtPrefix = m[1]!;
      fmtLeft = m[2] === "-";
      fmtZeroPad = !fmtLeft && m[3] === "0";
      fmtWidth = m[4] ? Number(m[4]) : 0;
      fmtPrec = m[5] !== undefined ? Number(m[5]) : undefined;
      fmtSpec = m[6] as "g" | "f";
      if (fmtSpec === "g" && fmtPrec !== undefined) return undefined;
      fmtSuffix = m[7]!;
    }
    const fracLen = (s: string): number => {
      const dot = s.indexOf(".");
      return dot < 0 ? 0 : s.length - dot - 1;
    };
    const firstStr = nums.length === 1 ? "1" : nums[0]!;
    const incrStr = nums.length === 3 ? nums[1]! : "1";
    const lastStr = nums[nums.length - 1]!;
    const scalePow = Math.max(fracLen(firstStr), fracLen(incrStr), fracLen(lastStr));
    const outPrec = Math.max(fracLen(firstStr), fracLen(incrStr));
    const scaleFactor = 10 ** scalePow;
    const firstInt = Math.round(Number(firstStr) * scaleFactor);
    const incrInt = Math.round(Number(incrStr) * scaleFactor);
    const lastInt = Math.round(Number(lastStr) * scaleFactor);
    if (incrInt === 0 || Math.abs((lastInt - firstInt) / incrInt) > 1024) return undefined;
    const formatScaled = (valInt: number): string => {
      const num = valInt / scaleFactor;
      return outPrec > 0 ? num.toFixed(outPrec) : String(Math.round(num));
    };
    const padWidth = equalWidth ? Math.max(formatScaled(firstInt).length, formatScaled(lastInt).length) : 0;
    const seqLines: string[] = [];
    for (let curInt = firstInt; incrInt > 0 ? curInt <= lastInt : curInt >= lastInt; curInt += incrInt) {
      const cur = curInt / scaleFactor;
      if (fmt !== undefined) {
        const rawNum = fmtSpec === "f" ? cur.toFixed(fmtPrec ?? 6) : String(cur);
        let body = rawNum;
        if (fmtWidth > rawNum.length) {
          if (fmtLeft) body = rawNum.padEnd(fmtWidth, " ");
          else if (fmtZeroPad && rawNum.startsWith("-")) body = "-" + rawNum.slice(1).padStart(fmtWidth - 1, "0");
          else body = rawNum.padStart(fmtWidth, fmtZeroPad ? "0" : " ");
        }
        seqLines.push(fmtPrefix + body + fmtSuffix);
      } else if (equalWidth) {
        const raw = formatScaled(curInt);
        const body = raw.startsWith("-")
          ? "-" + raw.slice(1).padStart(Math.max(0, padWidth - 1), "0")
          : raw.padStart(padWidth, "0");
        seqLines.push(body);
      } else {
        seqLines.push(formatScaled(curInt));
      }
    }
    return seqLines.length > 0 ? seqLines.join(sep) + "\n" : "";
  }
,
  evalSyncBase64(this: any, inBytes: Uint8Array, opArgs: readonly string[]): string | undefined {
    let decode = false;
    let ignoreGarbage = false;
    let wrapCols = 76;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-d" || a === "--decode") { decode = true; continue; }
      if (a === "-i" || a === "--ignore-garbage") { ignoreGarbage = true; continue; }
      if (a === "-di" || a === "-id") { decode = true; ignoreGarbage = true; continue; }
      if (a === "-w" || a === "--wrap") {
        if (i + 1 >= opArgs.length || !/^[0-9]{1,5}$/.test(opArgs[i + 1]!)) return undefined;
        wrapCols = Number(opArgs[++i]!);
        continue;
      }
      if (a.startsWith("-w") && /^[0-9]{1,5}$/.test(a.slice(2))) {
        wrapCols = Number(a.slice(2));
        continue;
      }
      if (a.startsWith("--wrap=") && /^[0-9]{1,5}$/.test(a.slice(7))) {
        wrapCols = Number(a.slice(7));
        continue;
      }
      return undefined;
    }
    if (decode) {
      const fileStr = sharedSyncPipeDecoder.decode(inBytes);
      const cleaned = ignoreGarbage ? fileStr.replace(/[^A-Za-z0-9+/=]+/g, "") : fileStr.replace(/[ \t\r\n]+/g, "");
      if (cleaned.length % 4 !== 0 || (cleaned.length > 0 && !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned))) return undefined;
      const decoded = this.syncBase64DecodeBytes(cleaned);
      if (decoded.some(byte => byte === 0 || byte >= 128)) return undefined;
      return sharedSyncPipeDecoder.decode(decoded);
    }
    const rawB64 = this.syncBase64Encode(inBytes).replace(/\n/g, "");
    if (rawB64.length === 0) return "";
    if (wrapCols === 0) return rawB64 + "\n";
    const lines: string[] = [];
    for (let i = 0; i < rawB64.length; i += wrapCols) {
      lines.push(rawB64.slice(i, i + wrapCols));
    }
    return lines.join("\n") + "\n";
  }
,
  parseSyncCutSpec(this: any, spec: string): ((len: number) => number[]) | undefined {
    if (!/^(?:[1-9][0-9]{0,4}|[1-9][0-9]{0,4}-[1-9][0-9]{0,4}|[1-9][0-9]{0,4}-|-[1-9][0-9]{0,4})(?:,(?:[1-9][0-9]{0,4}|[1-9][0-9]{0,4}-[1-9][0-9]{0,4}|[1-9][0-9]{0,4}-|-[1-9][0-9]{0,4}))*$/.test(spec)) {
      return undefined;
    }
    const ranges: Array<[number, number]> = [];
    for (const part of spec.split(",")) {
      const dash = part.indexOf("-");
      if (dash === -1) {
        const n = Number(part);
        ranges.push([n, n]);
      } else if (dash === 0) {
        const end = Number(part.slice(1));
        ranges.push([1, end]);
      } else if (dash === part.length - 1) {
        const start = Number(part.slice(0, -1));
        ranges.push([start, Infinity]);
      } else {
        const start = Number(part.slice(0, dash));
        const end = Number(part.slice(dash + 1));
        if (start > end) return undefined;
        ranges.push([start, end]);
      }
    }
    return (len: number): number[] => {
      const out: number[] = [];
      for (let i = 1; i <= len; i++) {
        for (let r = 0; r < ranges.length; r++) {
          const [s, e] = ranges[r]!;
          if (i >= s && i <= e) {
            out.push(i - 1);
            break;
          }
        }
      }
      return out;
    };
  }
,
  evalSyncCut(this: any, rawLines: readonly string[], opArgs: readonly string[], byteLocaleMode: boolean, allowZero = false): string[] | undefined {
    const norm: string[] = [];
    let suppressNoDelim = false;
    let isComplement = false;
    let outDelim: string | undefined;
    for (let ci = 0; ci < opArgs.length; ci++) {
      const ca = opArgs[ci]!;
      if (ca === "-s" || ca === "--only-delimited") {
        suppressNoDelim = true;
      } else if (ca === "-z" || ca === "--zero-terminated") {
        if (!allowZero) return undefined;
      } else if (ca === "--complement") {
        isComplement = true;
      } else if (ca.startsWith("--output-delimiter=")) {
        outDelim = ca.slice("--output-delimiter=".length);
        if (outDelim.length === 0 || outDelim.includes("\0")) return undefined;
      } else if (ca === "--output-delimiter") {
        if (ci + 1 >= opArgs.length) return undefined;
        outDelim = opArgs[++ci]!;
        if (outDelim.length === 0 || outDelim.includes("\0")) return undefined;
      } else if (/^-[snz]+$/.test(ca)) {
        if (ca.includes("z") && !allowZero) return undefined;
        if (ca.includes("s")) suppressNoDelim = true;
      } else if (/^-[snz]+([dfbc])(.*)$/.test(ca)) {
        const cm = /^(-[snz]+)([dfbc])(.*)$/.exec(ca)!;
        if (cm[1]!.includes("z") && !allowZero) return undefined;
        if (cm[1]!.includes("s")) suppressNoDelim = true;
        const flagChar = cm[2]!;
        const rest = cm[3]!;
        if (rest.length > 0) norm.push("-" + flagChar + rest);
        else if (ci + 1 < opArgs.length) norm.push("-" + flagChar + opArgs[++ci]!);
        else return undefined;
      } else if ((ca === "-d" || ca === "-f" || ca === "-c" || ca === "-b") && ci + 1 < opArgs.length) {
        norm.push(ca + opArgs[++ci]!);
      } else if (ca.startsWith("--delimiter=")) {
        norm.push("-d" + ca.slice(12));
      } else if (ca === "--delimiter" && ci + 1 < opArgs.length) {
        norm.push("-d" + opArgs[++ci]!);
      } else if (ca.startsWith("--fields=")) {
        norm.push("-f" + ca.slice(9));
      } else if (ca === "--fields" && ci + 1 < opArgs.length) {
        norm.push("-f" + opArgs[++ci]!);
      } else if (ca.startsWith("--characters=")) {
        norm.push("-c" + ca.slice(13));
      } else if (ca === "--characters" && ci + 1 < opArgs.length) {
        norm.push("-c" + opArgs[++ci]!);
      } else if (ca.startsWith("--bytes=")) {
        norm.push("-b" + ca.slice(8));
      } else if (ca === "--bytes" && ci + 1 < opArgs.length) {
        norm.push("-b" + opArgs[++ci]!);
      } else {
        norm.push(ca);
      }
    }
    if (!suppressNoDelim && norm.length === 1 && (norm[0]!.startsWith("-c") || norm[0]!.startsWith("-b"))) {
      const isByteMode = norm[0]!.startsWith("-b");
      if (!isByteMode && byteLocaleMode) return undefined;
      if (isByteMode && rawLines.some(l => { for (let i = 0; i < l.length; i++) if (l.charCodeAt(i) >= 128) return true; return false; })) return undefined;
      const basePicker = this.parseSyncCutSpec(norm[0]!.slice(2));
      if (!basePicker) return undefined;
      const picker = isComplement ? (len: number) => { const s = new Set(basePicker(len)); const r: number[] = []; for (let i = 0; i < len; i++) if (!s.has(i)) r.push(i); return r; } : basePicker;
      if (outDelim === undefined) {
        return rawLines.map(l => {
          const chars = isByteMode ? l.split("") : Array.from(l);
          const idxs = picker(chars.length);
          return idxs.map(i => chars[i]!).join("");
        });
      }
      if (isComplement) return undefined;
      const rawRanges = norm[0]!.slice(2).split(",").map(part => {
        const dash = part.indexOf("-");
        return dash === -1 ? [Number(part), Number(part)] as [number, number]
          : dash === 0 ? [1, Number(part.slice(1))] as [number, number]
          : dash === part.length - 1 ? [Number(part.slice(0, -1)), Infinity] as [number, number]
          : [Number(part.slice(0, dash)), Number(part.slice(dash + 1))] as [number, number];
      }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (let ri = 1; ri < rawRanges.length; ri++) {
        if (rawRanges[ri]![0] <= rawRanges[ri - 1]![1]) return undefined;
      }
      return rawLines.map(l => {
        const chars = isByteMode ? l.split("") : Array.from(l);
        const segs: string[] = [];
        for (const [rs, re] of rawRanges) {
          if (rs <= chars.length) segs.push(chars.slice(rs - 1, Math.min(chars.length, re)).join(""));
        }
        return segs.join(outDelim);
      });
    }
    let delim = "\t";
    let fArg: string | undefined;
    if (norm.length === 1 && norm[0]!.startsWith("-f")) {
      fArg = norm[0]!;
    } else if (norm.length === 2) {
      const dCandidate = norm[0]!.startsWith("-d") ? norm[0]! : (norm[1]!.startsWith("-d") ? norm[1]! : undefined);
      const fCandidate = norm[0]!.startsWith("-f") ? norm[0]! : (norm[1]!.startsWith("-f") ? norm[1]! : undefined);
      if (dCandidate && dCandidate.length === 3 && fCandidate) {
        delim = dCandidate[2]!;
        fArg = fCandidate;
      }
    }
    if (!fArg || !fArg.startsWith("-f")) return undefined;
    const basePicker = this.parseSyncCutSpec(fArg.slice(2));
    if (!basePicker) return undefined;
    const picker = isComplement ? (len: number) => { const s = new Set(basePicker(len)); const r: number[] = []; for (let i = 0; i < len; i++) if (!s.has(i)) r.push(i); return r; } : basePicker;
    const joinDelim = outDelim ?? delim;
    const out: string[] = [];
    for (let li = 0; li < rawLines.length; li++) {
      const l = rawLines[li]!;
      if (!l.includes(delim)) {
        if (!suppressNoDelim) out.push(l);
        continue;
      }
      const parts = l.split(delim);
      const idxs = picker(parts.length);
      out.push(idxs.map(i => parts[i]!).join(joinDelim));
    }
    return out;
  }
,
  evalSyncSed(this: any, rawLines: readonly string[], opArgs: readonly string[], allowZero = false): { lines: string[]; lastInputIndex: number } | undefined {
    let quiet = false;
    let isExtended = false;
    const rawExprs: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-n" || a === "--quiet" || a === "--silent") quiet = true;
      else if (a === "-E" || a === "-r" || a === "--regexp-extended") isExtended = true;
      else if (a === "-z" || a === "--null-data") { if (!allowZero) return undefined; }
      else if (/^-[nErz]+$/.test(a)) {
        if (a.includes("z") && !allowZero) return undefined;
        if (a.includes("n")) quiet = true;
        if (a.includes("E") || a.includes("r")) isExtended = true;
      } else if (a === "-e" || a === "--expression") {
        if (i + 1 >= opArgs.length) return undefined;
        rawExprs.push(opArgs[++i]!);
      } else if (a.startsWith("--expression=")) {
        rawExprs.push(a.slice(13));
      } else if (a.startsWith("-e") && a.length > 2) {
        rawExprs.push(a.slice(2));
      } else if (/^-[nErz]+e(.*)$/.test(a)) {
        const cm = /^(-[nErz]+)e(.*)$/.exec(a)!;
        if (cm[1]!.includes("z") && !allowZero) return undefined;
        if (cm[1]!.includes("n")) quiet = true;
        if (cm[1]!.includes("E") || cm[1]!.includes("r")) isExtended = true;
        if (cm[2]!.length > 0) rawExprs.push(cm[2]!);
        else if (i + 1 < opArgs.length) rawExprs.push(opArgs[++i]!);
        else return undefined;
      } else if (!a.startsWith("-") && rawExprs.length === 0 && i === opArgs.length - 1) {
        rawExprs.push(a);
      } else {
        return undefined;
      }
    }
    if (rawExprs.length === 0) return undefined;
    const splitUnescaped = (str: string, delim: string): string[] | undefined => {
      const out: string[] = [];
      let cur = "";
      for (let i = 0; i < str.length; i++) {
        const ch = str[i]!;
        if (ch === "\\" && i + 1 < str.length) {
          const next = str[++i]!;
          cur += next === delim ? delim : "\\" + next;
          continue;
        }
        if (ch === delim) {
          out.push(cur);
          cur = "";
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out;
    };
    const subExprs: string[] = [];
    for (const re of rawExprs) {
      let cur = "";
      let i = 0;
      while (i < re.length) {
        const ch = re[i]!;
        if (ch === "\\" && i + 1 < re.length) {
          cur += ch + re[++i]!;
          i++;
          continue;
        }
        const trimmedCur = cur.trimStart();
        if (ch === "/" && (trimmedCur.length === 0 || trimmedCur.endsWith(","))) {
          cur += ch;
          i++;
          while (i < re.length) {
            const rc = re[i]!;
            cur += rc;
            i++;
            if (rc === "\\" && i < re.length) { cur += re[i++]!; continue; }
            if (rc === "/") break;
          }
          continue;
        }
        if ((ch === "s" || ch === "y") && i + 1 < re.length && "/#|:@,;%!".includes(re[i + 1]!) && /(?:^|[!\s/0-9$~])$/.test(trimmedCur)) {
          const d = re[i + 1]!;
          cur += ch + d;
          i += 2;
          let dCount = 0;
          while (i < re.length && dCount < 2) {
            const sc = re[i]!;
            cur += sc;
            i++;
            if (sc === "\\" && i < re.length) { cur += re[i++]!; continue; }
            if (sc === d) dCount++;
          }
          continue;
        }
        if (ch === ";" || ch === "\n") {
          const t = cur.trim();
          if (t.length > 0) subExprs.push(t);
          cur = "";
          i++;
          continue;
        }
        cur += ch;
        i++;
      }
      const tailT = cur.trim();
      if (tailT.length > 0) subExprs.push(tailT);
    }
    if (subExprs.length === 0) return undefined;
    const compileSedAddrRe = (patSpec: string): RegExp | undefined => {
      if (patSpec.length === 0 || patSpec.includes("[.") || patSpec.includes("[=") || /\\[1-9]/.test(patSpec)) return undefined;
      const normPat = syncPosixRegexSource(patSpec);
      if (normPat === undefined) return undefined;
      let jsPat = normPat;
      if (!isExtended) {
        jsPat = "";
        let inBracket = false;
        for (let i = 0; i < normPat.length; i++) {
          const ch = normPat[i]!;
          if (ch === "\\") {
            const next = normPat[++i];
            if (next === undefined) return undefined;
            jsPat += !inBracket && "+?(){}|".includes(next) ? next : "\\" + next;
          } else {
            if (ch === "[") inBracket = true;
            else if (ch === "]") inBracket = false;
            jsPat += !inBracket && "+?(){}|".includes(ch) ? "\\" + ch : ch;
          }
        }
      }
      try { return new RegExp(jsPat); } catch { return undefined; }
    };
    type SedAddrFn = (l: string, idx1: number, total: number) => boolean;
    type SedStep = { addr: SedAddrFn | undefined; negated: boolean } & (
      | { kind: "d" }
      | { kind: "p" }
      | { kind: "q" }
      | { kind: "=" }
      | (({ kind: "a" } | { kind: "i" } | { kind: "c" }) & { text: string })
      | { kind: "y"; map: Map<string, string> }
      | { kind: "s"; re: RegExp; rep: string; printOnMatch: boolean; nth: number });
    const steps: SedStep[] = [];
    for (const rawE of subExprs) {
      let rest = rawE;
      let addr: SedAddrFn | undefined;
      let negated = false;
      let isRangeAddr = false;
      const stepAddrM = /^([1-9][0-9]{0,4})~([1-9][0-9]{0,4})\s*/.exec(rest);
      if (stepAddrM) {
        const first = Number(stepAddrM[1]!);
        const step = Number(stepAddrM[2]!);
        rest = rest.slice(stepAddrM[0]!.length);
        addr = (_l: string, idx1: number): boolean => idx1 >= first && (idx1 - first) % step === 0;
      } else {
        const addrM = /^(?:([1-9][0-9]{0,4}|\$)|\/([^/\\]*(?:\\.[^/\\]*)*)\/)(?:\s*,\s*(?:([1-9][0-9]{0,4}|\$)|\/([^/\\]*(?:\\.[^/\\]*)*)\/))?\s*/.exec(rest);
        if (addrM) {
          const sNumSpec = addrM[1];
          const sPatSpec = addrM[2];
          const eNumSpec = addrM[3];
          const ePatSpec = addrM[4];
          rest = rest.slice(addrM[0]!.length);
          const sRe = sPatSpec !== undefined ? compileSedAddrRe(sPatSpec) : undefined;
          if (sPatSpec !== undefined && !sRe) return undefined;
          const eRe = ePatSpec !== undefined ? compileSedAddrRe(ePatSpec) : undefined;
          if (ePatSpec !== undefined && !eRe) return undefined;
          if (eNumSpec === undefined && ePatSpec === undefined) {
            addr = (l: string, idx1: number, total: number): boolean => {
              if (sRe !== undefined) return sRe.test(l);
              const sNum = sNumSpec === "$" ? total : Number(sNumSpec!);
              return idx1 === sNum;
            };
          } else {
            isRangeAddr = true;
            if (sNumSpec !== undefined && eNumSpec !== undefined) {
              addr = (_l: string, idx1: number, total: number): boolean => {
                const sNum = sNumSpec === "$" ? total : Number(sNumSpec);
                const eNum = eNumSpec === "$" ? total : Number(eNumSpec);
                return idx1 >= sNum && idx1 <= Math.max(sNum, eNum);
              };
            } else {
              let inRange = false;
              addr = (l: string, idx1: number, total: number): boolean => {
                const matchStart = sRe !== undefined ? sRe.test(l) : idx1 === (sNumSpec === "$" ? total : Number(sNumSpec!));
                const eNum = eNumSpec !== undefined ? (eNumSpec === "$" ? total : Number(eNumSpec)) : undefined;
                if (!inRange) {
                  if (!matchStart) return false;
                  if (eNum !== undefined && idx1 >= eNum) return true;
                  inRange = true;
                  return true;
                }
                const matchEnd = eRe !== undefined ? eRe.test(l) : idx1 >= eNum!;
                if (matchEnd) inRange = false;
                return true;
              };
            }
          }
        }
      }
      if (rest.startsWith("!")) {
        negated = true;
        rest = rest.slice(1).trim();
      }
      if (rest === "d") {
        steps.push({ addr, negated, kind: "d" });
        continue;
      }
      if (rest === "p") {
        steps.push({ addr, negated, kind: "p" });
        continue;
      }
      if (rest === "q") {
        steps.push({ addr, negated, kind: "q" });
        continue;
      }
      if (rest === "=") {
        steps.push({ addr, negated, kind: "=" });
        continue;
      }
      if (rest.startsWith("i") || rest.startsWith("a") || rest.startsWith("c")) {
        const aicM = /^([aic])(?:\s+|\\\s*)(.+)$/.exec(rest);
        if (!aicM || isRangeAddr || aicM[2]!.includes("\\")) return undefined;
        steps.push({ addr, negated, kind: aicM[1] as "a" | "i" | "c", text: aicM[2]! });
        continue;
      }
      if (rest.startsWith("y") && rest.length >= 4) {
        const delim = rest[1]!;
        if (!"/#|:@,;%!".includes(delim)) return undefined;
        const parts = rest.slice(2).split(delim);
        if (parts.length !== 3 || parts[2] !== "") return undefined;
        const srcStr = parts[0]!;
        const dstStr = parts[1]!;
        if (srcStr.includes("\\") || dstStr.includes("\\")) return undefined;
        const srcChars = Array.from(srcStr);
        const dstChars = Array.from(dstStr);
        if (srcChars.length !== dstChars.length) return undefined;
        const map = new Map<string, string>();
        for (let i = 0; i < srcChars.length; i++) {
          if (!map.has(srcChars[i]!)) map.set(srcChars[i]!, dstChars[i]!);
        }
        steps.push({ addr, negated, kind: "y", map });
        continue;
      }
      if (rest.startsWith("s") && rest.length >= 4) {
        const delim = rest[1]!;
        if (!"/#|:@,;%!".includes(delim)) return undefined;
        const parts = splitUnescaped(rest.slice(2), delim);
        if (!parts || parts.length !== 3) return undefined;
        const [pat, rep, flags] = parts as [string, string, string];
        if (!/^[giIp1-9]*$/.test(flags) || /\n/.test(rep) || !/^(?:[^\\]|\\[1-9&\\tn])*$/.test(rep)) return undefined;
        const nthDigits = flags.match(/[1-9]/g);
        if (nthDigits && (nthDigits.length > 1 || flags.includes("g"))) return undefined;
        const nth = nthDigits ? Number(nthDigits[0]!) : 0;
        const global = flags.includes("g") || nth > 0;
        const ignoreCase = flags.includes("i") || flags.includes("I");
        const printOnMatch = flags.includes("p");
        const anchorStart = pat.startsWith("^");
        const core1 = anchorStart ? pat.slice(1) : pat;
        const anchorEnd = core1.endsWith("$");
        const core = anchorEnd ? core1.slice(0, -1) : core1;
        if (core.length === 0 && !anchorStart && !anchorEnd) return undefined;
        // POSIX-only brackets and leftmost-longest alternatives belong to sed's matcher.
        if (core.includes("[:") || core.includes("[.") || core.includes("[=") ||
            core.includes("[]") || core.includes("[^]") || core.includes("^") ||
            (isExtended ? core.includes("|") : core.includes("\\|") || core.includes("[") && core.includes("\\"))) return undefined;
        let reSrc: string | undefined;
        if (/^[a-zA-Z0-9_ /:;,=-]*$/.test(core)) {
          reSrc = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        } else if (
          core === "[ \t]*" || core === "[ \t]+" || core === "[ \\t]*" || core === "[ \\t]+" ||
          core === "[[:space:]]*" || core === "[[:space:]]+" ||
          core === "[0-9]+" || core === "[0-9]*" ||
          core === "[a-zA-Z]+" || core === "[a-zA-Z0-9_]+"
        ) {
          reSrc = core.replace("[[:space:]]", "[ \\t\\r\\n\\v\\f]");
        } else if (isExtended && /^[a-zA-Z0-9_ :;,=.+*?|()^\-[\]]+$/.test(core) && !/\([^)]*[+*][^)]*\)[+*?]/.test(core)) {
          try {
            const expanded = core.replace(/\[:space:\]/g, " \\t\\r\\n\\v\\f");
            void new RegExp(expanded);
            reSrc = expanded;
          } catch {
            reSrc = undefined;
          }
        } else if (!isExtended && /^[a-zA-Z0-9_ :;,=.*^\-[\]\\()+?|]+$/.test(core)) {
          try {
            let bre = "";
            let okBre = true;
            for (let bi = 0; bi < core.length; bi++) {
              const ch = core[bi]!;
              if (ch === "\\") {
                const nxt = core[++bi];
                if (nxt === "(" || nxt === ")" || nxt === "+" || nxt === "?" || nxt === "|") bre += nxt;
                else if (nxt === "." || nxt === "*" || nxt === "[" || nxt === "]" || nxt === "^" || nxt === "$" || nxt === "\\") bre += "\\" + nxt;
                else { okBre = false; break; }
              } else if (ch === "(" || ch === ")" || ch === "+" || ch === "?" || ch === "|") {
                bre += "\\" + ch;
              } else {
                bre += ch;
              }
            }
            if (okBre && !/\([^)]*[+*][^)]*\)[+*?]/.test(bre)) {
              const expanded = bre.replace(/\[:space:\]/g, " \\t\\r\\n\\v\\f");
              void new RegExp(expanded);
              reSrc = expanded;
            }
          } catch {
            reSrc = undefined;
          }
        }
        if (reSrc === undefined) return undefined;
        const numGroups = (new RegExp(reSrc + "|").exec("")?.length ?? 1) - 1;
        for (let ri = 0; ri < rep.length; ri++) {
          if (rep[ri] === "\\") {
            const nxt = rep[++ri]!;
            if (nxt >= "1" && nxt <= "9" && Number(nxt) > numGroups) return undefined;
          }
        }
        const fullRe = new RegExp((anchorStart ? "^" : "") + reSrc + (anchorEnd ? "$" : ""), (global ? "g" : "") + (ignoreCase ? "i" : ""));
        steps.push({ addr, negated, kind: "s", re: fullRe, rep, printOnMatch, nth });
        continue;
      }
      return undefined;
    }
    const out: string[] = [];
    const total = rawLines.length;
    let lastInputIndex = -1;
    for (let i = 0; i < total; i++) {
      let l = rawLines[i]!;
      const idx1 = i + 1;
      let deleted = false;
      let quitNow = false;
      const appendedAfter: string[] = [];
      for (let si = 0; si < steps.length; si++) {
        const st = steps[si]!;
        const addrMatched = st.addr ? st.addr(l, idx1, total) : true;
        if (st.negated ? addrMatched : !addrMatched) continue;
        if (st.kind === "d") {
          deleted = true;
          break;
        }
        if (st.kind === "p") {
          out.push(l);
          lastInputIndex = i;
          continue;
        }
        if (st.kind === "=") {
          out.push(String(idx1));
          lastInputIndex = -1;
          continue;
        }
        if (st.kind === "i") {
          out.push(st.text);
          lastInputIndex = -1;
          continue;
        }
        if (st.kind === "a") {
          appendedAfter.push(st.text);
          continue;
        }
        if (st.kind === "c") {
          out.push(st.text);
          lastInputIndex = -1;
          deleted = true;
          break;
        }
        if (st.kind === "q") {
          if (!quiet) {
            out.push(l);
            lastInputIndex = i;
          }
          quitNow = true;
          break;
        }
        if (st.kind === "y") {
          l = Array.from(l).map(c => st.map.get(c) ?? c).join("");
          continue;
        }
        let matchedOnce = false;
        let matchIdx = 0;
        let previousEnd = -1;
        l = l.replace(st.re, (matched: string, ...groups: unknown[]) => {
          const offset = groups[groups.length - 2] as number;
          if (matched.length === 0 && offset === previousEnd) return "";
          previousEnd = offset + matched.length;
          matchIdx++;
          if (st.nth > 0 && matchIdx !== st.nth) return matched;
          matchedOnce = true;
          // Expand only replacement tokens; inserted match bytes are literal.
          let replacement = "";
          for (let ri = 0; ri < st.rep.length; ri++) {
            const c = st.rep[ri]!;
            if (c === "&") replacement += matched;
            else if (c === "\\" && ri + 1 < st.rep.length) {
              const next = st.rep[++ri]!;
              if (next >= "1" && next <= "9") {
                const group = groups[Number(next) - 1];
                replacement += typeof group === "string" ? group : "";
              } else if (next === "t") {
                replacement += "\t";
              } else if (next === "n") {
                replacement += "\n";
              } else {
                replacement += next;
              }
            } else replacement += c;
          }
          return replacement;
        });
        if (matchedOnce && st.printOnMatch) {
          out.push(l);
          lastInputIndex = i;
        }
      }
      if (quitNow) {
        break;
      }
      if (!deleted && !quiet) {
        out.push(l);
        lastInputIndex = i;
      }
      if (appendedAfter.length > 0) {
        out.push(...appendedAfter);
        lastInputIndex = -1;
      }
    }
    return { lines: out, lastInputIndex };
  }
,
  evalSyncGrep(this: any, rawLines: readonly string[], opArgs: readonly string[], errexit: boolean): { lines: string[]; status: number } | undefined {
    if (errexit || opArgs.length < 1 || opArgs.length > 24) return undefined;
    let mode = "";
    let maxCount = Infinity;
    let beforeCtx = 0;
    let afterCtx = 0;
    const rawPatterns: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if ((a === "-A" || a === "--after-context" || a === "-B" || a === "--before-context" || a === "-C" || a === "--context") && i + 1 < opArgs.length && /^[0-9]{1,4}$/.test(opArgs[i + 1]!)) {
        const n = Number(opArgs[++i]!);
        if (a === "-A" || a === "--after-context" || a === "-C" || a === "--context") afterCtx = n;
        if (a === "-B" || a === "--before-context" || a === "-C" || a === "--context") beforeCtx = n;
      } else if (/^-[ABC][0-9]{1,4}$/.test(a)) {
        const n = Number(a.slice(2));
        if (a[1] === "A" || a[1] === "C") afterCtx = n;
        if (a[1] === "B" || a[1] === "C") beforeCtx = n;
      } else if (/^--(?:after-context|before-context|context)=[0-9]{1,4}$/.test(a)) {
        const eq = a.indexOf("=");
        const n = Number(a.slice(eq + 1));
        if (a.startsWith("--after") || a.startsWith("--context")) afterCtx = n;
        if (a.startsWith("--before") || a.startsWith("--context")) beforeCtx = n;
      } else if (a === "-e" || a === "--regexp") {
        if (i + 1 >= opArgs.length) return undefined;
        rawPatterns.push(opArgs[++i]!);
      } else if (a.startsWith("--regexp=")) {
        rawPatterns.push(a.slice(9));
      } else if (a.startsWith("-e") && a.length > 2) {
        rawPatterns.push(a.slice(2));
      } else if (a === "-m" || a === "--max-count") {
        if (i + 1 >= opArgs.length || !/^[1-9][0-9]{0,5}$/.test(opArgs[i + 1]!)) return undefined;
        maxCount = Number(opArgs[++i]!);
      } else if (a.startsWith("-m") && /^[1-9][0-9]{0,5}$/.test(a.slice(2))) {
        maxCount = Number(a.slice(2));
      } else if (a.startsWith("--max-count=") && /^[1-9][0-9]{0,5}$/.test(a.slice(12))) {
        maxCount = Number(a.slice(12));
      } else if (/^-[vicFEonxwqhsHa]+e(.*)$/.test(a)) {
        const cm = /^(-[vicFEonxwqhsHa]+)e(.*)$/.exec(a)!;
        mode += cm[1]!.slice(1).replace(/a/g, "");
        if (cm[2]!.length > 0) rawPatterns.push(cm[2]!);
        else if (i + 1 < opArgs.length) rawPatterns.push(opArgs[++i]!);
        else return undefined;
      } else if (/^-[vicFEonxwqhsHa]+m([1-9][0-9]{0,5})?$/.test(a)) {
        const cm = /^(-[vicFEonxwqhsHa]+)m([1-9][0-9]{0,5})?$/.exec(a)!;
        mode += cm[1]!.slice(1).replace(/a/g, "");
        if (cm[2] && cm[2].length > 0) maxCount = Number(cm[2]);
        else if (i + 1 < opArgs.length && /^[1-9][0-9]{0,5}$/.test(opArgs[i + 1]!)) maxCount = Number(opArgs[++i]!);
        else return undefined;
      } else if (a.startsWith("--") && a !== "--") {
        if (a === "--extended-regexp") mode += "E";
        else if (a === "--fixed-strings") mode += "F";
        else if (a === "--ignore-case") mode += "i";
        else if (a === "--invert-match") mode += "v";
        else if (a === "--only-matching") mode += "o";
        else if (a === "--line-number") mode += "n";
        else if (a === "--count") mode += "c";
        else if (a === "--word-regexp") mode += "w";
        else if (a === "--line-regexp") mode += "x";
        else if (a === "--quiet" || a === "--silent") mode += "q";
        else if (a === "--no-filename") mode += "h";
        else if (a === "--with-filename") mode += "H";
        else if (a === "--no-messages") mode += "s";
        else if (a === "--text" || a === "--color=never" || a === "--colour=never") { /* ignore */ }
        else return undefined;
      } else if (a.startsWith("-") && a !== "-" && a !== "--") {
        mode += a.slice(1).replace(/a/g, "");
      } else if (!a.startsWith("-") && rawPatterns.length === 0) {
        rawPatterns.push(a);
      } else {
        return undefined;
      }
    }
    if (rawPatterns.length === 0 || !/^[vicFEonxwqhsH]*$/.test(mode)) return undefined;
    const isQuiet = mode.includes("q");
    const isWithFilename = mode.includes("H") && !mode.includes("h");
    const isLineNumber = mode.includes("n");
    const isLineRegexp = mode.includes("x");
    const isWordRegexp = mode.includes("w");
    const isCaseInsensitive = mode.includes("i");
    const foldCase = (value: string): string => value.replace(/[A-Z]/g, ch => ch.toLowerCase());
    const isInvert = mode.includes("v");
    const isCount = mode.includes("c");
    const isExtended = mode.includes("E");
    const isFixed = mode.includes("F");
    const isOnlyMatching = mode.includes("o");
    const compileGrepCoreRegex = (core: string): string | undefined => {
      if (core.length === 0 || /\\[1-9]/.test(core)) return undefined;
      if (isExtended) {
        if (!/^(?:[a-zA-Z0-9_ /:;,=.+*?^\-[\]()|{}]|\\[.*+?^${}()|[\]\\/-])+$/.test(core) || /\([^)]*[+*][^)]*\)[+*?]/.test(core)) {
          return undefined;
        }
        return core;
      }
      if (!/^(?:[a-zA-Z0-9_ /:;,=.*^\-[\]]|\\[.+*?{}()|[\]\\^$/-])+$/.test(core)) {
        return undefined;
      }
      let out = "";
      let inBr = false;
      for (let i = 0; i < core.length; i++) {
        const ch = core[i]!;
        if (inBr) {
          out += ch;
          if (ch === "]") inBr = false;
          continue;
        }
        if (ch === "[") {
          inBr = true;
          out += ch;
          continue;
        }
        if (ch === "\\" && i + 1 < core.length) {
          const nxt = core[++i]!;
          if ("+?{}()|".includes(nxt)) out += nxt;
          else out += "\\" + nxt;
          continue;
        }
        if ("+?{}()|".includes(ch)) {
          out += "\\" + ch;
          continue;
        }
        out += ch;
      }
      if (inBr || /\([^)]*[+*][^)]*\)[+*?]/.test(out)) return undefined;
      return out;
    };
    // POSIX bracket classes, collating symbols and equivalence classes have
    // different meanings in JS RegExp. Let the command matcher parse them.
    if (!isFixed && rawPatterns.some(pattern =>
      pattern.includes("[:") || pattern.includes("[.") || pattern.includes("[=") ||
      pattern.includes("[]") || pattern.includes("[^]") ||
      isExtended && pattern.includes("[") && pattern.includes("|"))) return undefined;
    if (isCount && (isLineNumber || isOnlyMatching || beforeCtx > 0 || afterCtx > 0)) return undefined;
    if (isOnlyMatching && (beforeCtx > 0 || afterCtx > 0)) return undefined;
    if (isOnlyMatching) {
      if (rawPatterns.length !== 1 || isInvert || isLineRegexp) return undefined;
      const pat = rawPatterns[0]!;
      const reFlags = isCaseInsensitive ? "gi" : "g";
      let re: RegExp | undefined;
      const wrapWord = (src: string): string => isWordRegexp ? `\\b(?:${src})\\b` : src;
      if (isFixed) {
        if (pat.length > 0 && !pat.includes("\n")) {
          const esc = pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          re = new RegExp(wrapWord(esc), reFlags);
        }
      } else if (!pat.includes("|")) {
        const compiledSrc = compileGrepCoreRegex(pat);
        if (compiledSrc !== undefined) {
          try { re = new RegExp(wrapWord(compiledSrc), reFlags); } catch { re = undefined; }
        }
      } else {
        const branches = isExtended ? pat.split("|") : [pat];
        if (branches.every(b => b.length > 0 && /^[a-zA-Z0-9_ :;,/-]+$/.test(b))) {
          branches.sort((a, b) => b.length - a.length);
          re = new RegExp(wrapWord(branches.join("|")), reFlags);
        }
      }
      if (!re) return undefined;
      const out: string[] = [];
      let matchedLines = 0;
      for (let li = 0; li < rawLines.length; li++) {
        const matches = rawLines[li]!.match(re);
        if (matches) {
          matchedLines++;
          if (isQuiet) return { lines: [], status: 0 };
          for (let mi = 0; mi < matches.length; mi++) {
            if (matches[mi]!.length === 0) continue;
            const pfx = (isWithFilename ? "(standard input):" : "") + (isLineNumber ? `${li + 1}:` : "");
            out.push(pfx + matches[mi]!);
          }
          if (matchedLines >= maxCount) break;
        }
      }
      return { lines: out, status: matchedLines > 0 ? 0 : 1 };
    }
    if (isExtended && isFixed) return undefined;
    const branches: string[] = [];
    for (const rp of rawPatterns) {
      for (const b of (isFixed ? rp.split("\n") : (isExtended && !rp.includes("(") && !rp.includes("[") ? rp.split("|") : [rp]))) {
        branches.push(b);
      }
    }
    const compiledBranches: Array<{ anchorStart: boolean; anchorEnd: boolean; needle: string; re: RegExp | undefined }> = [];
    for (const br of branches) {
      if (br.length === 0) return undefined;
      if (isFixed) {
        if (br.includes("\0")) return undefined;
        compiledBranches.push({ anchorStart: isLineRegexp, anchorEnd: isLineRegexp, needle: isCaseInsensitive ? foldCase(br) : br, re: undefined });
      } else {
        const anchorStart = isLineRegexp || br.startsWith("^");
        const c1 = br.startsWith("^") ? br.slice(1) : br;
        const anchorEnd = isLineRegexp || c1.endsWith("$");
        const core = c1.endsWith("$") ? c1.slice(0, -1) : c1;
        if (core.length > 0 && /^[a-zA-Z0-9_ :;,/-]+$/.test(core)) {
          compiledBranches.push({ anchorStart, anchorEnd, needle: isCaseInsensitive ? foldCase(core) : core, re: undefined });
        } else {
          const compiledSrc = compileGrepCoreRegex(core);
          if (compiledSrc === undefined) return undefined;
          try {
            const wrapped = isWordRegexp ? `\\b(?:${compiledSrc})\\b` : compiledSrc;
            const fullSrc = (anchorStart ? "^" : "") + wrapped + (anchorEnd ? "$" : "");
            compiledBranches.push({ anchorStart, anchorEnd, needle: "", re: new RegExp(fullSrc, isCaseInsensitive ? "i" : "") });
          } catch {
            return undefined;
          }
        }
      }
    }
    const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /^[a-zA-Z0-9_]$/.test(ch);
    const hasWordMatch = (hay: string, needle: string, aStart: boolean, aEnd: boolean): boolean => {
      if (aStart && aEnd) return hay === needle;
      if (aStart) return hay.startsWith(needle) && !isWordChar(hay[needle.length]);
      if (aEnd) return hay.endsWith(needle) && !isWordChar(hay[hay.length - needle.length - 1]);
      let from = 0;
      while (from <= hay.length - needle.length) {
        const idx = hay.indexOf(needle, from);
        if (idx === -1) return false;
        if (!isWordChar(hay[idx - 1]) && !isWordChar(hay[idx + needle.length])) return true;
        from = idx + 1;
      }
      return false;
    };
    const matched: string[] = [];
    const matchedIndices: number[] = [];
    for (let li = 0; li < rawLines.length; li++) {
      const l = rawLines[li]!;
      const hay = isCaseInsensitive ? foldCase(l) : l;
      let hit = false;
      for (let bi = 0; bi < compiledBranches.length; bi++) {
        const b = compiledBranches[bi]!;
        const ok = b.re !== undefined
          ? b.re.test(l)
          : isWordRegexp
            ? hasWordMatch(hay, b.needle, b.anchorStart, b.anchorEnd)
            : b.anchorStart && b.anchorEnd
              ? hay === b.needle
              : b.anchorStart
                ? hay.startsWith(b.needle)
                : b.anchorEnd
                  ? hay.endsWith(b.needle)
                  : hay.includes(b.needle);
        if (ok) { hit = true; break; }
      }
      if (isInvert ? !hit : hit) {
        if (isQuiet) return { lines: [], status: 0 };
        matchedIndices.push(li);
        const pfx = (isWithFilename ? "(standard input):" : "") + (isLineNumber ? `${li + 1}:` : "");
        matched.push(pfx + l);
        if (matched.length >= maxCount) break;
      }
    }
    if ((beforeCtx > 0 || afterCtx > 0) && matchedIndices.length > 0) {
      const matchedSet = new Set(matchedIndices);
      const outCtx: string[] = [];
      let prevEnd = -1;
      for (const mIdx of matchedIndices) {
        const start = Math.max(0, mIdx - beforeCtx);
        const end = Math.min(rawLines.length - 1, mIdx + afterCtx);
        if (prevEnd !== -1 && start > prevEnd + 1) {
          outCtx.push("--");
        }
        const from = prevEnd !== -1 ? Math.max(start, prevEnd + 1) : start;
        for (let k = from; k <= end; k++) {
          const lineText = rawLines[k]!;
          if (isLineNumber) {
            outCtx.push(`${k + 1}${matchedSet.has(k) ? ":" : "-"}${lineText}`);
          } else {
            outCtx.push(lineText);
          }
        }
        prevEnd = Math.max(prevEnd, end);
      }
      return { lines: outCtx, status: 0 };
    }
    return {
      lines: isCount ? [String(matched.length)] : matched,
      status: matched.length > 0 ? 0 : 1,
    };
  }
,
  evalSyncGrepWithFiles(this: any, 
    allArgs: readonly string[],
    isEgrep: boolean,
    isFgrep: boolean,
    errexit: boolean,
    cwd: string,
    stdinLines?: readonly string[],
    allowZero = false,
  ): { lines: string[]; status: number } | undefined {
    if (errexit) return undefined;
    const coreArgs: string[] = [];
    if (isEgrep) coreArgs.push("-E");
    if (isFgrep) coreArgs.push("-F");
    let withFilename = false;
    let noFilename = false;
    let filesWithMatches = false;
    let filesWithoutMatch = false;
    let nullFileSep = false;
    let quiet = false;
    let hasExplicitPattern = false;
    let hasContext = false;
    let ended = false;
    const fileOperands: string[] = [];
    const loadPatternFile = (pFile: string | undefined): boolean => {
      if (!pFile) return false;
      const pfView = this.tryReadMemoryFileViewSync(resolvePath(cwd, pFile), true, true);
      if (!pfView || pfView.byteLength === 0 || pfView.byteLength > 4096 || pfView.includes(0)) return false;
      const pfStr = sharedSyncPipeDecoder.decode(pfView);
      const pfLines = pfStr.endsWith("\n") ? pfStr.slice(0, -1).split("\n") : pfStr.split("\n");
      if (pfLines.length === 0 || pfLines.some(l => l.length === 0)) return false;
      hasExplicitPattern = true;
      for (const pl of pfLines) coreArgs.push("-e", pl);
      return true;
    };
    for (let i = 0; i < allArgs.length; i++) {
      const a = allArgs[i]!;
      if (ended || !a.startsWith("-") || a === "-") {
        if (!hasExplicitPattern) {
          hasExplicitPattern = true;
          coreArgs.push("-e", a);
        } else {
          if (a === "-") return undefined;
          fileOperands.push(a);
        }
        continue;
      }
      if (a === "--") { ended = true; continue; }
      if (a === "-e" || a === "--regexp") {
        if (i + 1 >= allArgs.length) return undefined;
        hasExplicitPattern = true;
        coreArgs.push("-e", allArgs[++i]!);
        continue;
      }
      if (a.startsWith("--regexp=")) {
        hasExplicitPattern = true;
        coreArgs.push("-e", a.slice(9));
        continue;
      }
      if (a.startsWith("-e") && a.length > 2) {
        hasExplicitPattern = true;
        coreArgs.push(a);
        continue;
      }
      if (a === "-f" || a === "--file" || a.startsWith("-f") || a.startsWith("--file=")) {
        const pFile = (a === "-f" || a === "--file") ? allArgs[++i] : (a.startsWith("--file=") ? a.slice(7) : a.slice(2));
        if (!loadPatternFile(pFile)) return undefined;
        continue;
      }
      if ((a === "-m" || a === "--max-count" || a === "-A" || a === "--after-context" || a === "-B" || a === "--before-context" || a === "-C" || a === "--context") && i + 1 < allArgs.length) {
        if (a !== "-m" && a !== "--max-count") hasContext = true;
        coreArgs.push(a, allArgs[++i]!);
        continue;
      }
      if (/^-[ABC][0-9]{1,4}$/.test(a) || /^--(?:after-context|before-context|context)=[0-9]{1,4}$/.test(a)) {
        hasContext = true;
        coreArgs.push(a);
        continue;
      }
      if (a === "--with-filename") { withFilename = true; continue; }
      if (a === "--no-filename") { noFilename = true; continue; }
      if (a === "--files-with-matches") { filesWithMatches = true; continue; }
      if (a === "--files-without-match") { filesWithoutMatch = true; continue; }
      if (a === "--null") { if (!allowZero) return undefined; nullFileSep = true; continue; }
      if (a === "--quiet" || a === "--silent") { quiet = true; continue; }
      if (a === "--no-messages" || a === "--text" || a === "--color=never" || a === "--colour=never") continue;
      if (a.startsWith("--")) {
        coreArgs.push(a);
        continue;
      }
      let remFlags = "";
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]!;
        if (ch === "H") { withFilename = true; noFilename = false; }
        else if (ch === "h") { noFilename = true; withFilename = false; }
        else if (ch === "l") { filesWithMatches = true; filesWithoutMatch = false; }
        else if (ch === "L") { filesWithoutMatch = true; filesWithMatches = false; }
        else if (ch === "Z") { if (!allowZero) return undefined; nullFileSep = true; }
        else if (ch === "q") { quiet = true; }
        else if (ch === "s" || ch === "a") { /* ignore */ }
        else if (ch === "e") {
          hasExplicitPattern = true;
          const rest = a.slice(j + 1);
          if (rest.length > 0) coreArgs.push("-e", rest);
          else if (i + 1 < allArgs.length) coreArgs.push("-e", allArgs[++i]!);
          else return undefined;
          break;
        } else if (ch === "f") {
          const rest = a.slice(j + 1);
          const pFile = rest.length > 0 ? rest : allArgs[++i];
          if (!loadPatternFile(pFile)) return undefined;
          break;
        } else if (ch === "m") {
          const rest = a.slice(j + 1);
          const mVal = rest.length > 0 ? rest : allArgs[++i];
          if (!mVal || !/^[1-9][0-9]{0,5}$/.test(mVal)) return undefined;
          coreArgs.push("-m", mVal);
          break;
        } else remFlags += ch;
      }
      if (remFlags.length > 0) coreArgs.push("-" + remFlags);
    }
    if (!hasExplicitPattern) return undefined;
    const fDelim = nullFileSep ? "\0" : ":";
    if (fileOperands.length === 0) {
      if (stdinLines === undefined) return undefined;
      const res = this.evalSyncGrep(stdinLines, coreArgs, false);
      if (!res) return undefined;
      if (quiet) return { lines: [], status: res.status };
      if (filesWithMatches) return { lines: res.status === 0 ? ["(standard input)"] : [], status: res.status };
      if (filesWithoutMatch) return { lines: res.status !== 0 ? ["(standard input)"] : [], status: res.status !== 0 ? 0 : 1 };
      return {
        lines: withFilename ? res.lines.map(l => `(standard input)${fDelim}${l}`) : res.lines,
        status: res.status,
      };
    }
    const showFile = withFilename ? true : noFilename ? false : fileOperands.length > 1;
    if (showFile && hasContext) return undefined;
    const outLines: string[] = [];
    let anyMatch = false;
    let anyWithoutMatch = false;
    let totalBytes = 0;
    for (const fPath of fileOperands) {
      const fView = this.tryReadMemoryFileViewSync(resolvePath(cwd, fPath), true, true);
      if (!fView || fView.includes(0)) return undefined;
      totalBytes += fView.byteLength;
      if (totalBytes > 16384) return undefined;
      const fStr = sharedSyncPipeDecoder.decode(fView);
      const fLines = fStr.endsWith("\n") ? fStr.slice(0, -1).split("\n") : (fStr.length === 0 ? [] : fStr.split("\n"));
      const res = this.evalSyncGrep(fLines, coreArgs, false);
      if (!res) return undefined;
      if (res.status === 0) {
        anyMatch = true;
        if (quiet) return { lines: [], status: 0 };
        if (filesWithMatches) {
          outLines.push(fPath);
          continue;
        }
      } else if (filesWithoutMatch) {
        anyWithoutMatch = true;
        outLines.push(fPath);
        continue;
      }
      if (!filesWithMatches && !filesWithoutMatch) {
        for (const ln of res.lines) {
          outLines.push(showFile ? `${fPath}${fDelim}${ln}` : ln);
        }
      }
    }
    const status = filesWithoutMatch ? (anyWithoutMatch ? 0 : 1) : (anyMatch ? 0 : 1);
    return { lines: outLines, status };
  }
,
  evalSyncMultiFileText(this: any, 
    cmd: "sort" | "sed" | "cut" | "awk" | "rev" | "tac" | "uniq" | "column" | "fold" | "expand" | "unexpand" | "strings" | "numfmt",
    allArgs: readonly string[],
    cwd: string,
    isByteLocale: boolean,
    allowZero = false,
  ): string[] | undefined {
    const optArgs: string[] = [];
    const fileOperands: string[] = [];
    let ended = false;
    let hasScriptOrProg = false;
    for (let i = 0; i < allArgs.length; i++) {
      const a = allArgs[i]!;
      if (ended || !a.startsWith("-") || a === "-") {
        if (a === "-") return undefined;
        if ((cmd === "sed" || cmd === "awk") && !hasScriptOrProg) {
          if (cmd === "awk" && (a.includes("FNR") || a.includes("FILENAME"))) return undefined;
          hasScriptOrProg = true;
          optArgs.push(a);
        } else {
          if (cmd === "awk" && a.includes("=")) return undefined;
          fileOperands.push(a);
        }
        continue;
      }
      if (a === "--") { ended = true; continue; }
      if (cmd === "sort") {
        if (a === "-o" || a.startsWith("-o") || a.startsWith("--output") || a === "-m" || a === "-c" || a === "-C") return undefined;
        if ((a === "-k" || a === "--key" || a === "-t" || a === "--field-separator" || a === "-S" || a === "-T" || /^-[runfbgsvVhMdz]+[kt]$/.test(a)) && i + 1 < allArgs.length) {
          optArgs.push(a, allArgs[++i]!);
          continue;
        }
        optArgs.push(a);
      } else if (cmd === "cut") {
        if ((a === "-d" || a === "-f" || a === "-b" || a === "-c" || a === "--delimiter" || a === "--fields" || a === "--characters" || a === "--bytes" || a === "--output-delimiter" || /^-[snz]+[dfbc]$/.test(a)) && i + 1 < allArgs.length) {
          optArgs.push(a, allArgs[++i]!);
          continue;
        }
        optArgs.push(a);
      } else if (cmd === "sed") {
        if (a === "-i" || a.startsWith("-i") || a.startsWith("--in-place") || a === "-f" || a.startsWith("-f") || a === "--file" || a.startsWith("--file=")) return undefined;
        if ((a === "-e" || a === "--expression" || /^-[nErz]+e$/.test(a)) && i + 1 < allArgs.length) {
          hasScriptOrProg = true;
          optArgs.push(a, allArgs[++i]!);
          continue;
        }
        if ((a.startsWith("-e") && a.length > 2) || a.startsWith("--expression=") || /^-[nErz]+e.+$/.test(a)) {
          hasScriptOrProg = true;
          optArgs.push(a);
          continue;
        }
        optArgs.push(a);
      } else if (cmd === "awk") {
        if (a === "-f" || a.startsWith("-f") || a === "--file" || a.startsWith("--file=")) return undefined;
        if ((a === "-F" || a === "--field-separator" || a === "-v" || a === "--assign") && i + 1 < allArgs.length) {
          optArgs.push(a, allArgs[++i]!);
          continue;
        }
        optArgs.push(a);
      } else if (cmd === "uniq") {
        if ((a === "-f" || a === "-s" || a === "-w" || a === "--skip-fields" || a === "--skip-chars" || a === "--check-chars" || /^-[cduiDz]+[fsw]$/.test(a)) && i + 1 < allArgs.length) {
          optArgs.push(a, allArgs[++i]!);
          continue;
        }
        optArgs.push(a);
      } else if (cmd === "rev" || cmd === "tac") {
        return undefined;
      } else if (cmd === "numfmt") {
        if ((a === "-d" || a === "--delimiter" || a === "--field" || a === "--format" || a === "--padding" || a === "--round" || a === "--suffix" || a === "--to" || a === "--from" || a === "--to-unit" || a === "--from-unit" || a === "--header") && i + 1 < allArgs.length) {
          optArgs.push(a, allArgs[++i]!);
          continue;
        }
        optArgs.push(a);
      } else if (cmd === "column" || cmd === "fold" || cmd === "expand" || cmd === "unexpand" || cmd === "strings") {
        if ((a === "-s" || a === "--separator" || a === "-o" || a === "--output-separator" || a === "-N" || a === "--table-columns" || a === "-R" || a === "--table-right" || a === "-H" || a === "--table-hide" || a === "-O" || a === "--table-order" || a === "--table-name" || a === "-w" || a === "--width" || a === "-t" && cmd !== "column" || a === "--tabs" || a === "-n" || a === "--bytes" || a === "--radix") && i + 1 < allArgs.length) {
          optArgs.push(a, allArgs[++i]!);
          continue;
        }
        optArgs.push(a);
      }
    }
    if (fileOperands.length === 0) return undefined;
    if (cmd === "uniq" && fileOperands.length > 1) return undefined;
    if (cmd === "sort" && isByteLocale) return undefined;
    if (cmd === "rev" || cmd === "tac") {
      const out: string[] = [];
      let totalB = 0;
      for (const fPath of fileOperands) {
        const fView = this.tryReadMemoryFileViewSync(resolvePath(cwd, fPath), true, true);
        if (!fView || fView.includes(0)) return undefined;
        totalB += fView.byteLength;
        if (totalB > 16384) return undefined;
        const fStr = sharedSyncPipeDecoder.decode(fView);
        const fLines = fStr.endsWith("\n") ? fStr.slice(0, -1).split("\n") : (fStr.length === 0 ? [] : fStr.split("\n"));
        if (cmd === "rev") {
          for (const l of fLines) out.push(Array.from(l).reverse().join(""));
        } else {
          const rev = [...fLines].reverse();
          if (!fStr.endsWith("\n") && rev.length > 1) rev.splice(0, 2, rev[0]! + rev[1]!);
          out.push(...rev);
        }
      }
      return out;
    }
    const zeroTerm = allowZero && (cmd === "sort" || cmd === "uniq" || cmd === "cut" || cmd === "sed") && this.hasZeroTerminatedFlag(cmd, optArgs);
    const lineSep = zeroTerm ? "\0" : "\n";
    let totalBytes = 0;
    if (cmd === "cut") {
      const out: string[] = [];
      for (const fPath of fileOperands) {
        const fView = this.tryReadMemoryFileViewSync(resolvePath(cwd, fPath), true, true);
        if (!fView || (!zeroTerm && fView.includes(0))) return undefined;
        totalBytes += fView.byteLength;
        if (totalBytes > 16384) return undefined;
        const fStr = sharedSyncPipeDecoder.decode(fView);
        const fLines = fStr.endsWith(lineSep) ? fStr.slice(0, -1).split(lineSep) : (fStr.length === 0 ? [] : fStr.split(lineSep));
        const res = this.evalSyncCut(fLines, optArgs, isByteLocale, allowZero);
        if (!res) return undefined;
        out.push(...res);
      }
      return out;
    }
    const combinedLines: string[] = [];
    for (const fPath of fileOperands) {
      const fView = this.tryReadMemoryFileViewSync(resolvePath(cwd, fPath), true, true);
      if (!fView || (!zeroTerm && fView.includes(0))) return undefined;
      totalBytes += fView.byteLength;
      if (totalBytes > 16384) return undefined;
      const fStr = sharedSyncPipeDecoder.decode(fView);
      if (fStr.length > 0 && !fStr.endsWith(lineSep) && (cmd === "fold" || cmd === "expand" || cmd === "unexpand" || cmd === "sed")) return undefined;
      const fLines = fStr.endsWith(lineSep) ? fStr.slice(0, -1).split(lineSep) : (fStr.length === 0 ? [] : fStr.split(lineSep));
      combinedLines.push(...fLines);
    }
    if (cmd === "sort") return this.evalSyncSort(combinedLines, optArgs, false, allowZero);
    if (cmd === "sed") return this.evalSyncSed(combinedLines, optArgs, allowZero)?.lines;
    if (cmd === "awk") return this.evalSyncAwk(combinedLines, optArgs);
    if (cmd === "uniq") return this.evalSyncUniq(combinedLines, optArgs, isByteLocale, allowZero);
    if (cmd === "column") return this.evalSyncColumn(combinedLines, optArgs);
    if (cmd === "fold") return this.evalSyncFold(combinedLines, optArgs);
    if (cmd === "expand") return this.evalSyncExpand(combinedLines, optArgs);
    if (cmd === "unexpand") return this.evalSyncUnexpand(combinedLines, optArgs);
    if (cmd === "strings") return this.evalSyncStrings(combinedLines, optArgs);
    if (cmd === "numfmt") return this.evalSyncNumfmt(combinedLines, optArgs);
    return undefined;
  }
,
  evalSyncAwk(this: any, rawLines: readonly string[], opArgs: readonly string[]): string[] | undefined {
    // The standalone runtime operates on UTF-8 bytes. Keep this text fast path
    // ASCII-only so partial byte substrings and case folding use that runtime.
    for (const text of [...rawLines, ...opArgs]) {
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) > 127) return undefined;
      }
    }
    if (opArgs.length < 1 || opArgs.length > 8) return undefined;
    let awkSep: string | undefined;
    let awkProg: string | undefined;
    let ofs = " ";
    const userVars = new Map<string, string>();
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-F" || a === "--field-separator") {
        if (i + 1 >= opArgs.length || opArgs[i + 1]!.length !== 1 || opArgs[i + 1] === "\\") return undefined;
        awkSep = opArgs[++i]!;
      } else if (a.startsWith("--field-separator=") && a.length === 19 && a[18] !== "\\") {
        awkSep = a.slice(18);
      } else if (a.startsWith("-F") && a.length === 3 && a[2] !== "\\") {
        awkSep = a.slice(2);
      } else if (a === "-v" || a === "--assign") {
        if (i + 1 >= opArgs.length) return undefined;
        const kv = opArgs[++i]!;
        const eq = kv.indexOf("=");
        if (eq <= 0 || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(kv.slice(0, eq))) return undefined;
        const k = kv.slice(0, eq);
        const v = kv.slice(eq + 1);
        if (v.includes("\\")) return undefined;
        if (k === "OFS") ofs = v;
        else if (k === "FS") { if (v.length !== 1) return undefined; awkSep = v; }
        else userVars.set(k, v);
      } else if ((a.startsWith("-v") && a.length > 2) || (a.startsWith("--assign=") && a.length > 9)) {
        const kv = a.startsWith("--assign=") ? a.slice(9) : a.slice(2);
        const eq = kv.indexOf("=");
        if (eq <= 0 || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(kv.slice(0, eq))) return undefined;
        const k = kv.slice(0, eq);
        const v = kv.slice(eq + 1);
        if (v.includes("\\")) return undefined;
        if (k === "OFS") ofs = v;
        else if (k === "FS") { if (v.length !== 1) return undefined; awkSep = v; }
        else userVars.set(k, v);
      } else if (!a.startsWith("-") && i === opArgs.length - 1) {
        awkProg = a;
      } else {
        return undefined;
      }
    }
    if (!awkProg) return undefined;
    let progRest = awkProg.trim();
    if (/^BEGIN\s*\{[^}]*\}$/.test(progRest)) {
      progRest = progRest.replace(/^BEGIN\s*/, "");
      rawLines = [""];
    }
    const beginFsM = /^BEGIN\s*\{([^}]*)\}\s*/.exec(progRest);
    let initVarName: string | undefined;
    let initVarVal = 0;
    if (beginFsM) {
      const bStmts = beginFsM[1]!.split(";").map(s => s.trim()).filter(Boolean);
      for (const bs of bStmts) {
        const ofsM = /^OFS\s*=\s*"([^"\\]*)"$/.exec(bs);
        if (ofsM) { ofs = ofsM[1]!; continue; }
        const fsM = /^FS\s*=\s*"([^"\\])"$/.exec(bs);
        if (fsM) { awkSep = fsM[1]!; continue; }
        const numInitM = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)$/.exec(bs);
        if (numInitM) { initVarName = numInitM[1]!; initVarVal = Number(numInitM[2]!); continue; }
        return undefined;
      }
      progRest = progRest.slice(beginFsM[0]!.length).trim();
    }
    const sumEndM = /^\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(\+=|-=)\s*(?:\$([0-9]+|NF)|(-?[0-9]+(?:\.[0-9]+)?))\s*;?\s*\}\s*END\s*\{\s*print\s+\1\s*;?\s*\}$/.exec(progRest);
    if (sumEndM) {
      const varName = sumEndM[1]!;
      if (["NR", "NF", "FNR", "OFS", "FS", "ORS", "RS", "OFMT", "CONVFMT", "ARGC", "ARGIND", "FILENAME", "RSTART", "RLENGTH", "SUBSEP", "IGNORECASE", "FIELDWIDTHS", "FPAT", "BINMODE", "TEXTDOMAIN"].includes(varName)) return undefined;
      if (initVarName !== undefined && initVarName !== varName) return undefined;
      const op = sumEndM[2]!;
      const fTok = sumEndM[3];
      const constVal = sumEndM[4] !== undefined ? Number(sumEndM[4]) : undefined;
      const initial = userVars.get(varName);
      if (initial !== undefined && !Number.isFinite(Number(initial))) return undefined;
      let acc = initVarName === varName ? initVarVal : Number(initial ?? 0);
      let touched = initVarName === varName || initial !== undefined;
      for (let li = 0; li < rawLines.length; li++) {
        const l = rawLines[li]!;
        const fields = awkSep === undefined || awkSep === " "
          ? l.split(/[ \t]+/).filter(Boolean)
          : (l.length === 0 ? [] : l.split(awkSep));
        let delta = 0;
        if (constVal !== undefined) {
          delta = constVal;
        } else {
          const idx = fTok === "NF" ? fields.length : Number(fTok!);
          const rawField = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
          delta = awkNumber(awkInputValue(rawField));
        }
        acc = op === "+=" ? acc + delta : acc - delta;
        touched = true;
      }
      return [touched ? awkValueText({ kind: "number", number: acc }) : ""];
    }
    if (initVarName !== undefined) return undefined;
    const endPrintM = /^END\s*\{\s*print\s+(NR|NF|\$(?:[0-9]+|NF))\s*;?\s*\}$/.exec(progRest);
    if (endPrintM) {
      const tok = endPrintM[1]!;
      if (tok === "NR") return [String(rawLines.length)];
      if (rawLines.length === 0) return [tok === "NF" ? "0" : ""];
      const lastLine = rawLines[rawLines.length - 1]!;
      const lastFields = awkSep === undefined || awkSep === " "
        ? lastLine.split(/[ \t]+/).filter(Boolean)
        : (lastLine.length === 0 ? [] : lastLine.split(awkSep));
      if (tok === "NF") return [String(lastFields.length)];
      const fIdx = tok === "$NF" ? lastFields.length : Number(tok.slice(1));
      return [fIdx === 0 ? lastLine : (fIdx >= 1 && fIdx <= lastFields.length ? lastFields[fIdx - 1]! : "")];
    }
    let rowPred: ((l: string, fields: readonly string[], nr: number) => boolean) | undefined;
    if (!progRest.startsWith("{")) {
      const braceIdx = progRest.indexOf("{");
      if (braceIdx === 0) return undefined;
      const condHead = (braceIdx === -1 ? progRest : progRest.slice(0, braceIdx)).trim();
      const buildAtomPred = (atomStr: string): ((l: string, fields: readonly string[], nr: number) => boolean) | undefined => {
        const a = atomStr.trim();
        const patM = /^(!?)\/([a-zA-Z0-9_ :;,=.*+?^$()|[\]-]+)\/$/.exec(a);
        if (patM) {
          const inv = patM[1] === "!";
          let re: RegExp;
          const source = syncPosixRegexSource(patM[2]!);
          if (source === undefined) return undefined;
          try { re = new RegExp(source); } catch { return undefined; }
          return (l: string) => inv ? !re.test(l) : re.test(l);
        }
        const fPatM = /^\$([0-9]+|NF)\s*(~|!~)\s*\/([a-zA-Z0-9_ :;,=.*+?^$()|[\]-]+)\/$/.exec(a);
        if (fPatM) {
          const fTok = fPatM[1]!;
          const inv = fPatM[2] === "!~";
          let re: RegExp;
          const source = syncPosixRegexSource(fPatM[3]!);
          if (source === undefined) return undefined;
          try { re = new RegExp(source); } catch { return undefined; }
          return (l: string, fields: readonly string[]) => {
            const idx = fTok === "NF" ? fields.length : Number(fTok);
            const val = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
            return inv ? !re.test(val) : re.test(val);
          };
        }
        const cmpM = /^(?:(NR|NF)|\$([0-9]+|NF))\s*(==|!=|>=|<=|>|<)\s*(?:"([^"\\]*)"|(-?[0-9]+(?:\.[0-9]+)?)|([a-zA-Z_][a-zA-Z0-9_]*))$/.exec(a);
        if (cmpM) {
          const nrNf = cmpM[1] as "NR" | "NF" | undefined;
          const fTok = cmpM[2];
          const op = cmpM[3]!;
          const varRhs = cmpM[6] !== undefined ? userVars.get(cmpM[6]!) : undefined;
          if (cmpM[6] !== undefined && varRhs === undefined) return undefined;
          const varValue = varRhs !== undefined ? awkInputValue(varRhs) : undefined;
          const varAsNum = varValue !== undefined && varValue.kind !== "string" ? awkNumber(varValue) : undefined;
          const strRhs = cmpM[4] ?? (varAsNum === undefined ? varRhs : undefined);
          const numRhs = cmpM[5] !== undefined ? Number(cmpM[5]) : varAsNum;
          if (strRhs !== undefined && op !== "==" && op !== "!=") return undefined;
          return (l: string, fields: readonly string[], nr: number) => {
            let rawVal: string | number;
            if (nrNf !== undefined) rawVal = nrNf === "NR" ? nr : fields.length;
            else {
              const idx = fTok === "NF" ? fields.length : Number(fTok!);
              rawVal = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
            }
            const left = typeof rawVal === "number" ? awkNumeric(rawVal) : awkInputValue(rawVal);
            const right = strRhs !== undefined ? awkString(strRhs) : awkNumeric(numRhs!);
            const comparison = awkCompare(left, right, "%.6g");
            return op === "==" ? comparison === 0 : op === "!=" ? comparison !== 0 : op === ">=" ? comparison >= 0 : op === "<=" ? comparison <= 0 : op === ">" ? comparison > 0 : comparison < 0;
          };
        }
        return undefined;
      };
      const orParts = condHead.split("||");
      const orClauses: Array<Array<(l: string, fields: readonly string[], nr: number) => boolean>> = [];
      for (let oi = 0; oi < orParts.length; oi++) {
        const andParts = orParts[oi]!.split("&&");
        const andPreds: Array<(l: string, fields: readonly string[], nr: number) => boolean> = [];
        for (let ai = 0; ai < andParts.length; ai++) {
          const p = buildAtomPred(andParts[ai]!);
          if (!p) return undefined;
          andPreds.push(p);
        }
        orClauses.push(andPreds);
      }
      rowPred = (l: string, fields: readonly string[], nr: number) => {
        for (let oi = 0; oi < orClauses.length; oi++) {
          const andPreds = orClauses[oi]!;
          let allOk = true;
          for (let ai = 0; ai < andPreds.length; ai++) {
            if (!andPreds[ai]!(l, fields, nr)) { allOk = false; break; }
          }
          if (allOk) return true;
        }
        return false;
      };
      progRest = braceIdx === -1 ? "{ print $0 }" : progRest.slice(braceIdx).trim();
    }
    type AwkPreAssign = {
      targetKind: "field" | "var";
      target: string;
      rhs:
        | { kind: "str"; text: string }
        | { kind: "field"; token: string }
        | { kind: "case"; fn: "upper" | "lower"; token: string }
        | { kind: "arith"; tokens: string[] };
    };
    const preAssigns: AwkPreAssign[] = [];
    const rowVarSet = new Set<string>();
    if (progRest.startsWith("{") && progRest.endsWith("}") && progRest.includes(";")) {
      const body = progRest.slice(1, -1).trim();
      const stmts: string[] = [];
      let curS = "";
      let inQ = false;
      let inR = false;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i]!;
        if (inQ) {
          curS += ch;
          if (ch === "\\" && i + 1 < body.length) curS += body[++i]!;
          else if (ch === "\"") inQ = false;
          continue;
        }
        if (inR) {
          curS += ch;
          if (ch === "\\" && i + 1 < body.length) curS += body[++i]!;
          else if (ch === "/") inR = false;
          continue;
        }
        if (ch === "\"") { inQ = true; curS += ch; continue; }
        if (ch === "/") { inR = true; curS += ch; continue; }
        if (ch === ";") {
          if (curS.trim().length > 0) stmts.push(curS.trim());
          curS = "";
          continue;
        }
        curS += ch;
      }
      if (curS.trim().length > 0) stmts.push(curS.trim());
      let consumed = 0;
      while (consumed < stmts.length - 1) {
        const s = stmts[consumed]!;
        if (/^(?:g?sub|split|print|printf)\b/.test(s)) break;
        const asgM = /^(?:\$([1-9][0-9]?|NF)|([a-zA-Z_][a-zA-Z0-9_]*))\s*=\s*(.+)$/.exec(s);
        if (!asgM) break;
        const fLhs = asgM[1];
        const vLhs = asgM[2];
        const rhsRaw = asgM[3]!.trim();
        if (rhsRaw.startsWith("split(")) break;
        if (vLhs !== undefined && ["NR", "NF", "FNR", "OFS", "FS", "ORS", "RS", "OFMT", "CONVFMT", "ARGC", "ARGIND", "FILENAME", "RSTART", "RLENGTH", "SUBSEP", "IGNORECASE", "FIELDWIDTHS", "FPAT", "BINMODE", "TEXTDOMAIN"].includes(vLhs)) {
          return undefined;
        }
        let parsedRhs: AwkPreAssign["rhs"] | undefined;
        const strM = /^"([^"$\\]*)"$/.exec(rhsRaw);
        const fldM = /^\$([0-9]+|NF)$/.exec(rhsRaw);
        const caseM = /^(toupper|tolower)\(\$([0-9]+|NF)\)$/.exec(rhsRaw);
        if (strM) parsedRhs = { kind: "str", text: strM[1]! };
        else if (fldM) parsedRhs = { kind: "field", token: fldM[1]! };
        else if (caseM) parsedRhs = { kind: "case", fn: caseM[1] === "toupper" ? "upper" : "lower", token: caseM[2]! };
        else {
          const aToks = rhsRaw.split(/\s*([+*\/%-])\s*/);
          let okA = aToks.length >= 1 && aToks.length % 2 === 1;
          for (let ti = 0; okA && ti < aToks.length; ti += 2) {
            const at = aToks[ti]!;
            if (!at.startsWith("$") && at !== "NR" && at !== "NF" && !/^-?[0-9]+(?:\.[0-9]+)?$/.test(at) && !userVars.has(at) && !rowVarSet.has(at)) okA = false;
          }
          for (let ti = 1; okA && ti < aToks.length; ti += 2) {
            if (aToks[ti] === "/" || aToks[ti] === "%") {
              const div = Number(aToks[ti + 1]);
              if (!Number.isFinite(div) || div === 0) okA = false;
            }
          }
          if (okA) parsedRhs = { kind: "arith", tokens: aToks };
        }
        if (!parsedRhs) break;
        if (vLhs !== undefined) {
          rowVarSet.add(vLhs);
          if (!userVars.has(vLhs)) userVars.set(vLhs, "0");
          preAssigns.push({ targetKind: "var", target: vLhs, rhs: parsedRhs });
        } else {
          preAssigns.push({ targetKind: "field", target: fLhs!, rhs: parsedRhs });
        }
        consumed++;
      }
      if (consumed > 0) {
        progRest = "{ " + stmts.slice(consumed).join("; ") + " }";
      }
    }
    const awkM = syncAwkPrintRe.exec(progRest);
    if (!awkM) return undefined;
    const subFn = awkM[1] as "sub" | "gsub" | undefined;
    const subPat = awkM[2];
    const subRep = awkM[3] ?? "";
    const subTarget = awkM[4] ?? "0";
    // printf must consume typed values before OFMT string conversion and use
    // the complete formatter, including integer precision and exponent parsing.
    const splitCntVar = awkM[5];
    if (
      splitCntVar !== undefined &&
      (["NR", "NF", "FNR", "OFS", "FS", "ORS", "RS", "OFMT", "CONVFMT", "ARGC", "ARGIND", "FILENAME", "RSTART", "RLENGTH", "SUBSEP", "IGNORECASE", "FIELDWIDTHS", "FPAT", "BINMODE", "TEXTDOMAIN"].includes(splitCntVar) ||
       userVars.has(splitCntVar) ||
       rowVarSet.has(splitCntVar))
    ) {
      return undefined;
    }
    const splitFieldTok = awkM[6];
    const splitArrName = awkM[7];
    const splitSep = awkM[8];
    const printfFmtRaw = awkM[10];
    let printfSpecs: Array<{ lit: string; width: number; zeroPad: boolean; leftAlign: boolean; kind: "s" | "d" }> | undefined;
    let printfTailLit = "";
    if (printfFmtRaw !== undefined) {
      const unesc = printfFmtRaw.replace(/\\([nt\\"])/g, (_, c: string) => c === "n" ? "\n" : c === "t" ? "\t" : c);
      printfSpecs = [];
      let curLit = "";
      let fi = 0;
      while (fi < unesc.length) {
        if (unesc[fi] !== "%") {
          curLit += unesc[fi++]!;
          continue;
        }
        if (unesc[fi + 1] === "%") {
          curLit += "%";
          fi += 2;
          continue;
        }
        const spM = /^%(-)?(0)?([1-9][0-9]{0,2})?([sdi])/.exec(unesc.slice(fi));
        if (!spM) return undefined;
        printfSpecs.push({
          lit: curLit,
          leftAlign: spM[1] === "-",
          zeroPad: spM[2] === "0" && spM[1] !== "-",
          width: spM[3] ? Number(spM[3]) : 0,
          kind: spM[4] === "s" ? "s" : "d",
        });
        curLit = "";
        fi += spM[0]!.length;
      }
      printfTailLit = curLit;
    }
    const exprBody = (printfFmtRaw !== undefined ? awkM[11] : awkM[9])?.trim();
    let subRe: RegExp | undefined;
    if (subFn && subPat !== undefined) {
      const aS = subPat.startsWith("^");
      const c1 = aS ? subPat.slice(1) : subPat;
      const aE = c1.endsWith("$");
      const core = aE ? c1.slice(0, -1) : c1;
      const esc = core.includes("[") ? core : core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      try {
        subRe = new RegExp((aS ? "^" : "") + esc + (aE ? "$" : ""), subFn === "gsub" ? "g" : "");
      } catch {
        return undefined;
      }
    }
    const parts: Array<
      | { kind: "field"; token: string }
      | { kind: "nf_minus"; offset: number }
      | { kind: "length"; token: string }
      | { kind: "case"; fn: "upper" | "lower"; token: string }
      | { kind: "substr"; token: string; start: number; len: number | undefined }
      | { kind: "index"; token: string; sub: string }
      | { kind: "int"; token: string }
      | { kind: "ternary"; lhs: string; op: string; rhs: string; yes: string; no: string }
      | { kind: "arith"; tokens: string[] }
      | { kind: "var"; name: "NR" | "NF" }
      | { kind: "split_cnt" }
      | { kind: "split_el"; idx1: number }
      | { kind: "row_var"; name: string }
      | { kind: "lit"; text: string }
    > = [];
    if (!exprBody) {
      parts.push({ kind: "field", token: "0" });
    } else {
      syncAwkTokenRe.lastIndex = 0;
      const tokenRe = syncAwkTokenRe;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(exprBody)) !== null) {
        if (m[1] !== undefined) {
          const tm = /^(\$(?:[0-9]+|NF)|NR|NF)\s*(==|!=|>=|<=|>|<)\s*(-?[0-9]+(?:\.[0-9]+)?|"[^"$\\]*")\s*\?\s*(\$(?:[0-9]+|NF)|"[^"$\\]*"|-?[0-9]+(?:\.[0-9]+)?)\s*:\s*(\$(?:[0-9]+|NF)|"[^"$\\]*"|-?[0-9]+(?:\.[0-9]+)?)$/.exec(m[1]!.trim());
          if (!tm) return undefined;
          if (tm[2] === ">") return undefined; // Unparenthesized print > is output redirection.
          parts.push({ kind: "ternary", lhs: tm[1]!, op: tm[2]!, rhs: tm[3]!, yes: tm[4]!, no: tm[5]! });
        }
        else if (m[2] !== undefined) parts.push({ kind: "int", token: m[2]! });
        else if (m[3] !== undefined) parts.push({ kind: "case", fn: m[3] === "toupper" ? "upper" : "lower", token: m[4]! });
        else if (m[5] !== undefined) parts.push({ kind: "substr", token: m[5]!, start: Number(m[6]!), len: m[7] !== undefined ? Number(m[7]!) : undefined });
        else if (m[8] !== undefined) parts.push({ kind: "index", token: m[8]!, sub: m[9]! });
        else if (m[10] !== undefined) {
          const aToks = m[10]!.trim().split(/\s*([+*\/%-])\s*/);
          for (let ti = 0; ti < aToks.length; ti += 2) {
            const at = aToks[ti]!;
            if (!at.startsWith("$") && at !== "NR" && at !== "NF" && !/^-?[0-9]+(?:\.[0-9]+)?$/.test(at) && !userVars.has(at) && !rowVarSet.has(at)) return undefined;
          }
          for (let ti = 1; ti < aToks.length; ti += 2) {
            if (aToks[ti] === "/" || aToks[ti] === "%") {
              const divRaw = userVars.get(aToks[ti + 1]!) ?? aToks[ti + 1];
              const divisor = Number(divRaw);
              if (!Number.isFinite(divisor) || divisor === 0) return undefined;
            }
          }
          parts.push({ kind: "arith", tokens: aToks });
        }
        else if (m[11] !== undefined) {
          const offset = Number(m[11]!);
          // Refuse potentially fatal fields before loop iterations mutate state.
          if (offset > 0) return undefined;
          parts.push({ kind: "nf_minus", offset });
        }
        else if (m[12] !== undefined) parts.push({ kind: "field", token: m[12]! });
        else if (m[0] === "length" || m[0].startsWith("length(")) parts.push({ kind: "length", token: m[13] ?? "0" });
        else if (m[14] !== undefined) parts.push({ kind: "var", name: m[14] as "NR" | "NF" });
        else if (m[15] !== undefined) parts.push({ kind: "lit", text: m[15]! });
        else if (m[16] !== undefined) {
          if (!splitArrName || m[16] !== splitArrName) return undefined;
          parts.push({ kind: "split_el", idx1: Number(m[17]!) });
        }
        else if (m[18] !== undefined) {
          if (splitCntVar && m[18] === splitCntVar) {
            parts.push({ kind: "split_cnt" });
          } else if (rowVarSet.has(m[18]!)) {
            parts.push({ kind: "row_var", name: m[18]! });
          } else {
            const uv = userVars.get(m[18]!);
            if (uv === undefined) return undefined;
            parts.push({ kind: "lit", text: uv });
          }
        }
        else if (m[19] !== undefined) parts.push({ kind: "lit", text: printfSpecs ? "\0" : ofs });
      }
    }
    if (printfSpecs && parts.filter(p => p.kind === "lit" && p.text === "\0").length + 1 !== printfSpecs.length) {
      return undefined;
    }
    const outLines: string[] = [];
    for (let li = 0; li < rawLines.length; li++) {
      let l = rawLines[li]!;
      let fields = awkSep === undefined || awkSep === " "
        ? l.split(/[ \t]+/).filter(Boolean)
        : (l.length === 0 ? [] : l.split(awkSep));
      if (rowPred && !rowPred(l, fields, li + 1)) continue;
      if (preAssigns.length > 0) {
        for (let ai = 0; ai < preAssigns.length; ai++) {
          const pa = preAssigns[ai]!;
          let valStr = "";
          if (pa.rhs.kind === "str") valStr = pa.rhs.text;
          else if (pa.rhs.kind === "field") {
            const idx = pa.rhs.token === "NF" ? fields.length : Number(pa.rhs.token);
            valStr = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
          } else if (pa.rhs.kind === "case") {
            const idx = pa.rhs.token === "NF" ? fields.length : Number(pa.rhs.token);
            const s = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
            valStr = pa.rhs.fn === "upper" ? s.toUpperCase() : s.toLowerCase();
          } else if (pa.rhs.kind === "arith") {
            const vals: number[] = [];
            const ops: string[] = [];
            for (let ti = 0; ti < pa.rhs.tokens.length; ti++) {
              const tk = pa.rhs.tokens[ti]!;
              if (ti % 2 === 1) ops.push(tk);
              else {
                let v = 0;
                if (tk === "NR") v = li + 1;
                else if (tk === "NF") v = fields.length;
                else if (tk.startsWith("$")) {
                  const fSub = tk.slice(1);
                  const idx = fSub === "NF" ? fields.length : Number(fSub);
                  const rawF = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
                  v = awkNumber(awkInputValue(rawF));
                } else if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(tk)) {
                  v = Number(tk);
                } else {
                  v = awkNumber(awkInputValue(userVars.get(tk) ?? ""));
                }
                vals.push(v);
              }
            }
            const addVals: number[] = [vals[0]!];
            const addOps: string[] = [];
            for (let oi = 0; oi < ops.length; oi++) {
              const op = ops[oi]!;
              const rhs = vals[oi + 1]!;
              if (op === "*" || op === "/" || op === "%") {
                if ((op === "/" || op === "%") && rhs === 0) return undefined;
                const lhs = addVals.pop()!;
                addVals.push(op === "*" ? lhs * rhs : op === "/" ? lhs / rhs : lhs % rhs);
              } else {
                addOps.push(op);
                addVals.push(rhs);
              }
            }
            let acc = addVals[0]!;
            for (let oi = 0; oi < addOps.length; oi++) {
              acc = addOps[oi] === "+" ? acc + addVals[oi + 1]! : acc - addVals[oi + 1]!;
            }
            valStr = awkValueText(awkNumeric(acc));
          }
          if (pa.targetKind === "var") {
            userVars.set(pa.target, valStr);
          } else {
            const fIdx = pa.target === "NF" ? fields.length : Number(pa.target);
            if (fIdx < 1 || fIdx > 128) return undefined;
            fields = [...fields];
            while (fields.length < fIdx) fields.push("");
            fields[fIdx - 1] = valStr;
            l = fields.join(ofs);
          }
        }
      }
      if (subRe) {
        if (subTarget === "0") {
          l = l.replace(subRe, matched => subRep.split("&").join(matched));
          fields = awkSep === undefined || awkSep === " "
            ? l.split(/[ \t]+/).filter(Boolean)
            : (l.length === 0 ? [] : l.split(awkSep));
        } else {
          const tIdx = subTarget === "NF" ? fields.length : Number(subTarget);
          if (tIdx >= 1 && tIdx <= fields.length) {
            fields = [...fields];
            let replaced = false;
            fields[tIdx - 1] = fields[tIdx - 1]!.replace(subRe, matched => {
              replaced = true;
              return subRep.split("&").join(matched);
            });
            if (replaced) l = fields.join(ofs);
          }
        }
      }
      if (parts.length === 1 && parts[0]!.kind === "field" && parts[0]!.token === "0") {
        outLines.push(l);
        continue;
      }
      let splitEls: string[] | undefined;
      if (splitFieldTok !== undefined && splitSep !== undefined) {
        const sIdx = splitFieldTok === "NF" ? fields.length : Number(splitFieldTok);
        const sVal = sIdx === 0 ? l : (sIdx >= 1 && sIdx <= fields.length ? fields[sIdx - 1]! : "");
        splitEls = sVal.length === 0 ? [] : (splitSep === " " ? sVal.split(/[ \t]+/).filter(Boolean) : sVal.split(splitSep));
      }
      let out = "";
      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi]!;
        if (p.kind === "lit") out += p.text;
        else if (p.kind === "row_var") out += userVars.get(p.name) ?? "";
        else if (p.kind === "var") out += String(p.name === "NR" ? li + 1 : fields.length);
        else if (p.kind === "split_cnt") out += String(splitEls ? splitEls.length : 0);
        else if (p.kind === "split_el") out += splitEls && p.idx1 >= 1 && p.idx1 <= splitEls.length ? splitEls[p.idx1 - 1]! : "";
        else if (p.kind === "nf_minus") {
          const idx = fields.length - p.offset;
          if (idx < 0) return undefined;
          out += idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
        } else if (p.kind === "case") {
          const idx = p.token === "NF" ? fields.length : Number(p.token);
          const s = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
          out += p.fn === "upper" ? s.toUpperCase() : s.toLowerCase();
        } else if (p.kind === "substr") {
          const idx = p.token === "NF" ? fields.length : Number(p.token);
          const s = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
          const chars = Array.from(s);
          const s0 = Math.max(0, p.start - 1);
          out += (p.len !== undefined ? chars.slice(s0, s0 + Math.max(0, p.len)) : chars.slice(s0)).join("");
        } else if (p.kind === "index") {
          const idx = p.token === "NF" ? fields.length : Number(p.token);
          const s = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
          const pos = s.indexOf(p.sub);
          out += String(pos === -1 ? 0 : pos + 1);
        } else if (p.kind === "int") {
          const idx = p.token === "NF" ? fields.length : Number(p.token);
          const s = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
          const n = awkNumber(awkInputValue(s));
          if (!Number.isFinite(n)) return undefined;
          out += awkValueText(awkNumeric(Math.trunc(n)));
        } else if (p.kind === "ternary") {
          const resolveAtom = (tok: string): string => {
            if (tok.startsWith("\"") && tok.endsWith("\"")) return tok.slice(1, -1);
            if (tok === "NR") return String(li + 1);
            if (tok === "NF") return String(fields.length);
            if (tok.startsWith("$")) {
              const fIdx = tok === "$NF" ? fields.length : Number(tok.slice(1));
              return fIdx === 0 ? l : (fIdx >= 1 && fIdx <= fields.length ? fields[fIdx - 1]! : "");
            }
            return tok;
          };
          const lv = resolveAtom(p.lhs);
          const rv = resolveAtom(p.rhs);
          const left = p.lhs === "NR" || p.lhs === "NF" ? awkNumeric(Number(lv)) : awkInputValue(lv);
          const right = p.rhs.startsWith('"') ? awkString(rv) : awkNumeric(Number(rv));
          const comparison = awkCompare(left, right, "%.6g");
          const cond = p.op === "==" ? comparison === 0 : p.op === "!=" ? comparison !== 0 : p.op === ">" ? comparison > 0 : p.op === "<" ? comparison < 0 : p.op === ">=" ? comparison >= 0 : comparison <= 0;
          out += resolveAtom(cond ? p.yes : p.no);
        } else if (p.kind === "arith") {
          const vals: number[] = [];
          const ops: string[] = [];
          for (let ti = 0; ti < p.tokens.length; ti++) {
            const tk = p.tokens[ti]!;
            if (ti % 2 === 1) {
              ops.push(tk);
            } else {
              let v = 0;
              if (tk === "NR") v = li + 1;
              else if (tk === "NF") v = fields.length;
              else if (tk.startsWith("$")) {
                const fSub = tk.slice(1);
                const idx = fSub === "NF" ? fields.length : Number(fSub);
                const rawF = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
                v = awkNumber(awkInputValue(rawF));
              } else if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(tk)) {
                v = Number(tk);
              } else {
                const uv = userVars.get(tk) ?? "";
                v = awkNumber(awkInputValue(uv));
              }
              vals.push(v);
            }
          }
          const addVals: number[] = [vals[0]!];
          const addOps: string[] = [];
          for (let oi = 0; oi < ops.length; oi++) {
            const op = ops[oi]!;
            const rhs = vals[oi + 1]!;
            if (op === "*" || op === "/" || op === "%") {
              if ((op === "/" || op === "%") && rhs === 0) return undefined;
              const lhs = addVals.pop()!;
              addVals.push(op === "*" ? lhs * rhs : op === "/" ? lhs / rhs : lhs % rhs);
            } else {
              addOps.push(op);
              addVals.push(rhs);
            }
          }
          let acc = addVals[0]!;
          for (let oi = 0; oi < addOps.length; oi++) {
            acc = addOps[oi] === "+" ? acc + addVals[oi + 1]! : acc - addVals[oi + 1]!;
          }
          out += awkValueText(awkNumeric(acc));
        } else if (p.kind === "length") {
          const idx = p.token === "NF" ? fields.length : Number(p.token);
          const s = idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
          out += String(Array.from(s).length);
        } else if (p.token === "0") out += l;
        else {
          const idx = p.token === "NF" ? fields.length : Number(p.token);
          out += idx === 0 ? l : (idx >= 1 && idx <= fields.length ? fields[idx - 1]! : "");
        }
      }
      if (printfSpecs) {
        const argVals = out.split("\0");
        if (argVals.length !== printfSpecs.length) return undefined;
        let fmtRow = "";
        for (let si = 0; si < printfSpecs.length; si++) {
          const sp = printfSpecs[si]!;
          fmtRow += sp.lit;
          let rendered = argVals[si]!;
          if (sp.kind === "d") {
            const n = Math.trunc(awkNumber(awkInputValue(rendered)));
            const neg = n < 0;
            let digits = String(Math.abs(n));
            if (sp.zeroPad && sp.width > digits.length + (neg ? 1 : 0)) {
              digits = digits.padStart(sp.width - (neg ? 1 : 0), "0");
            }
            rendered = (neg ? "-" : "") + digits;
          }
          if (sp.width > rendered.length) {
            rendered = sp.leftAlign ? rendered.padEnd(sp.width, " ") : rendered.padStart(sp.width, " ");
          }
          fmtRow += rendered;
        }
        fmtRow += printfTailLit;
        outLines.push(fmtRow);
      } else {
        outLines.push(out);
      }
    }
    if (printfSpecs) {
      const joined = outLines.join("");
      if (joined.length === 0) return [];
      return (joined.endsWith("\n") ? joined.slice(0, -1) : joined).split("\n");
    }
    return outLines;
  }
,
  compareSyncVersion(this: any, a: string, b: string): number {
    let ia = 0;
    let ib = 0;
    while (ia < a.length || ib < b.length) {
      while ((ia < a.length && !(a[ia]! >= "0" && a[ia]! <= "9")) || (ib < b.length && !(b[ib]! >= "0" && b[ib]! <= "9"))) {
        const ca = ia < a.length ? a[ia] : undefined;
        const cb = ib < b.length ? b[ib] : undefined;
        const da = ca !== undefined && ca >= "0" && ca <= "9";
        const db = cb !== undefined && cb >= "0" && cb <= "9";
        if (da && db) break;
        if (ca !== cb) {
          if (ca === undefined) return -1;
          if (cb === undefined) return 1;
          if (da) return 1;
          if (db) return -1;
          return ca < cb ? -1 : 1;
        }
        ia++;
        ib++;
      }
      const sa = ia;
      while (ia < a.length && a[ia]! >= "0" && a[ia]! <= "9") ia++;
      const sb = ib;
      while (ib < b.length && b[ib]! >= "0" && b[ib]! <= "9") ib++;
      if (sa < ia || sb < ib) {
        const na = BigInt(sa < ia ? a.slice(sa, ia) : "0");
        const nb = BigInt(sb < ib ? b.slice(sb, ib) : "0");
        if (na !== nb) return na < nb ? -1 : 1;
      }
    }
    return 0;
  }
,
  evalSyncNl(this: any, rawLines: readonly string[], opArgs: readonly string[], cwd?: string): string[] | undefined {
    type NlSecSpec = { style: "a" | "t" | "n" };
    let headerSpec: NlSecSpec = { style: "n" };
    let bodySpec: NlSecSpec = { style: "t" };
    let footerSpec: NlSecSpec = { style: "n" };
    let format: "ln" | "rn" | "rz" = "rn";
    let width = 6;
    let sep = "\t";
    let start = 1;
    let inc = 1;
    let noRenumber = false;
    let joinBlanks = 1;
    let hasFileOperand = false;
    const parseSecSpec = (v: string): NlSecSpec | undefined => {
      if (v === "a" || v === "t" || v === "n") return { style: v };
      // Pattern numbering uses the command's bounded, byte-oriented BRE engine.
      // JavaScript RegExp cannot preserve that dialect or its execution limits.
      return undefined;
    };
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if ((a === "-b" || a === "--body-numbering") && i + 1 < opArgs.length) {
        const sp = parseSecSpec(opArgs[++i]!); if (!sp) return undefined; bodySpec = sp;
      } else if (a.startsWith("--body-numbering=")) {
        const sp = parseSecSpec(a.slice(17)); if (!sp) return undefined; bodySpec = sp;
      } else if (a.startsWith("-b") && a.length > 2) {
        const sp = parseSecSpec(a.slice(2)); if (!sp) return undefined; bodySpec = sp;
      } else if ((a === "-h" || a === "--header-numbering") && i + 1 < opArgs.length) {
        const sp = parseSecSpec(opArgs[++i]!); if (!sp) return undefined; headerSpec = sp;
      } else if (a.startsWith("--header-numbering=")) {
        const sp = parseSecSpec(a.slice(19)); if (!sp) return undefined; headerSpec = sp;
      } else if (a.startsWith("-h") && a.length > 2) {
        const sp = parseSecSpec(a.slice(2)); if (!sp) return undefined; headerSpec = sp;
      } else if ((a === "-f" || a === "--footer-numbering") && i + 1 < opArgs.length) {
        const sp = parseSecSpec(opArgs[++i]!); if (!sp) return undefined; footerSpec = sp;
      } else if (a.startsWith("--footer-numbering=")) {
        const sp = parseSecSpec(a.slice(19)); if (!sp) return undefined; footerSpec = sp;
      } else if (a.startsWith("-f") && a.length > 2) {
        const sp = parseSecSpec(a.slice(2)); if (!sp) return undefined; footerSpec = sp;
      } else if (a === "-p" || a === "--no-renumber") {
        noRenumber = true;
      } else if ((a === "-l" || a === "--join-blank-lines") && i + 1 < opArgs.length && /^[1-9][0-9]{0,3}$/.test(opArgs[i + 1]!)) {
        joinBlanks = Number(opArgs[++i]!);
      } else if (/^--join-blank-lines=[1-9][0-9]{0,3}$/.test(a)) {
        joinBlanks = Number(a.slice(19));
      } else if (/^-l[1-9][0-9]{0,3}$/.test(a)) {
        joinBlanks = Number(a.slice(2));
      } else if ((a === "-n" || a === "--number-format") && i + 1 < opArgs.length) {
        const v = opArgs[++i]!;
        if (v !== "ln" && v !== "rn" && v !== "rz") return undefined;
        format = v;
      } else if (a.startsWith("--number-format=")) {
        const v = a.slice(16);
        if (v !== "ln" && v !== "rn" && v !== "rz") return undefined;
        format = v;
      } else if (a === "-nln" || a === "-nrn" || a === "-nrz") {
        format = a.slice(2) as "ln" | "rn" | "rz";
      } else if ((a === "-w" || a === "--number-width") && i + 1 < opArgs.length && /^[1-9][0-9]{0,2}$/.test(opArgs[i + 1]!)) {
        width = Number(opArgs[++i]!);
      } else if (/^--number-width=[1-9][0-9]{0,2}$/.test(a)) {
        width = Number(a.slice(15));
      } else if (/^-w[1-9][0-9]{0,2}$/.test(a)) {
        width = Number(a.slice(2));
      } else if ((a === "-s" || a === "--number-separator") && i + 1 < opArgs.length) {
        sep = opArgs[++i]!;
      } else if (a.startsWith("--number-separator=")) {
        sep = a.slice(19);
      } else if (a.startsWith("-s") && a.length > 2) {
        sep = a.slice(2);
      } else if ((a === "-v" || a === "--starting-line-number") && i + 1 < opArgs.length && /^-?[0-9]{1,9}$/.test(opArgs[i + 1]!)) {
        start = Number(opArgs[++i]!);
      } else if (/^--starting-line-number=-?[0-9]{1,9}$/.test(a)) {
        start = Number(a.slice(23));
      } else if (/^-v-?[0-9]{1,9}$/.test(a)) {
        start = Number(a.slice(2));
      } else if ((a === "-i" || a === "--line-increment") && i + 1 < opArgs.length && /^-?[0-9]{1,9}$/.test(opArgs[i + 1]!)) {
        inc = Number(opArgs[++i]!);
      } else if (/^--line-increment=-?[0-9]{1,9}$/.test(a)) {
        inc = Number(a.slice(17));
      } else if (/^-i-?[0-9]{1,9}$/.test(a)) {
        inc = Number(a.slice(2));
      } else if (!a.startsWith("-")) {
        if (cwd === undefined) return undefined;
        const fl = this.readSyncMemoryLines(resolvePath(cwd, a));
        if (!fl) return undefined;
        if (!hasFileOperand) rawLines = [];
        hasFileOperand = true;
        rawLines = [...rawLines, ...fl];
      } else {
        return undefined;
      }
    }
    const out: string[] = [];
    let curSpec = bodySpec;
    let num = start;
    let blankCount = 0;
    const unnumberedPrefix = " ".repeat(width + shellValueByteLength(sep));
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i]!;
      if (l === "\\:" || l === "\\:\\:" || l === "\\:\\:\\:") {
        curSpec = l === "\\:\\:\\:" ? headerSpec : l === "\\:\\:" ? bodySpec : footerSpec;
        if (!noRenumber) num = start;
        blankCount = 0;
        out.push("");
        continue;
      }
      let numbered = false;
      if (curSpec.style === "a") {
        if (l.length === 0) {
          blankCount++;
          if (blankCount >= joinBlanks) {
            numbered = true;
            blankCount = 0;
          }
        } else {
          blankCount = 0;
          numbered = true;
        }
      } else {
        blankCount = 0;
        numbered = curSpec.style === "t" && l.length > 0;
      }
      if (!numbered) {
        out.push(l.length === 0 && sep === "\t" ? " ".repeat(width + 1) : unnumberedPrefix + l);
        continue;
      }
      const label = String(num);
      const pad = Math.max(0, width - label.length);
      let prefix: string;
      if (format === "ln") prefix = label + " ".repeat(pad);
      else if (format === "rz") prefix = num < 0 ? "-" + "0".repeat(pad) + label.slice(1) : "0".repeat(pad) + label;
      else prefix = " ".repeat(pad) + label;
      out.push(prefix + sep + l);
      num += inc;
    }
    return out;
  }
,
  evalSyncPaste(this: any, rawLines: readonly string[] | undefined, opArgs: readonly string[], cwd?: string, allowZero = false): string[] | undefined {
    let serial = false;
    let zeroTerm = false;
    let delims: string[] = ["\t"];
    let literal = false;
    const files: string[] = [];
    const parseDelims = (s: string): string[] | undefined => {
      if (s.length === 0) return [""];
      const res: string[] = [];
      const chars = Array.from(s);
      const escapes: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "0": "" };
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]!;
        if (ch === "\\") {
          if (i + 1 >= chars.length) return undefined;
          const esc = chars[++i]!;
          res.push(escapes[esc] ?? esc);
        } else {
          res.push(ch);
        }
      }
      return res.length > 0 ? res : [""];
    };
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (literal || a === "-" || !a.startsWith("-")) { files.push(a); continue; }
      if (a === "--") { literal = true; continue; }
      if (a === "--serial") { serial = true; continue; }
      if (a === "--zero-terminated") { if (!allowZero) return undefined; zeroTerm = true; continue; }
      if (a === "--delimiters" && i + 1 < opArgs.length) {
        const d = parseDelims(opArgs[++i]!);
        if (!d) return undefined;
        delims = d;
        continue;
      }
      if (a.startsWith("--delimiters=")) {
        const d = parseDelims(a.slice(13));
        if (!d) return undefined;
        delims = d;
        continue;
      }
      if (a.startsWith("--")) return undefined;
      for (let k = 1; k < a.length; k++) {
        const f = a[k]!;
        if (f === "s") serial = true;
        else if (f === "z") {
          if (!allowZero) return undefined;
          zeroTerm = true;
        } else if (f === "d") {
          const rest = a.slice(k + 1);
          const rawD = rest.length > 0 ? rest : (i + 1 < opArgs.length ? opArgs[++i] : undefined);
          if (rawD === undefined) return undefined;
          const d = parseDelims(rawD);
          if (!d) return undefined;
          delims = d;
          break;
        } else return undefined;
      }
    }
    if (files.length === 0) files.push("-");
    if (rawLines === undefined) {
      if (files.includes("-")) return undefined;
      rawLines = [];
    }
    if (!files.every(f => f === "-")) {
      if (cwd === undefined) return rawLines.length === 0 ? [] : undefined;
      const stdinCount = files.filter(f => f === "-").length;
      if (stdinCount > 1) return undefined;
      const streams: (readonly string[])[] = [];
      for (const f of files) {
        if (f === "-") {
          streams.push(rawLines);
        } else {
          const fl = this.readSyncMemoryLines(resolvePath(cwd, f), zeroTerm);
          if (!fl) return undefined;
          streams.push(fl);
        }
      }
      if (serial) {
        const out: string[] = [];
        for (const colLines of streams) {
          if (colLines.length === 0) continue;
          let joined = colLines[0]!;
          for (let i = 1; i < colLines.length; i++) {
            joined += delims[(i - 1) % delims.length]! + colLines[i]!;
          }
          for (const seg of joined.split("\n")) out.push(seg);
        }
        return out;
      }
      const maxRows = streams.reduce((m, s) => Math.max(m, s.length), 0);
      const out: string[] = [];
      for (let r = 0; r < maxRows; r++) {
        let row = streams[0]![r] ?? "";
        for (let c = 1; c < streams.length; c++) {
          row += delims[(c - 1) % delims.length]! + (streams[c]![r] ?? "");
        }
        out.push(row);
      }
      return out;
    }
    if (serial) {
      if (files.length !== 1) return undefined;
      if (rawLines.length === 0) return [];
      let joined = rawLines[0]!;
      for (let i = 1; i < rawLines.length; i++) {
        joined += delims[(i - 1) % delims.length]! + rawLines[i]!;
      }
      return joined.split("\n");
    }
    const cols = files.length;
    const out: string[] = [];
    for (let i = 0; i < rawLines.length; i += cols) {
      let row = rawLines[i] ?? "";
      for (let c = 1; c < cols; c++) {
        row += delims[(c - 1) % delims.length]! + (rawLines[i + c] ?? "");
      }
      out.push(row);
    }
    return out;
  }



,
  readSyncMemoryLines(this: any, filePath: string, zeroTerm = false): string[] | undefined {
    const view = this.tryReadMemoryFileViewSync(filePath);
    if (!view || view.byteLength > 16384 || (!zeroTerm && view.includes(0)) || !view.every(b => b < 128)) return undefined;
    const str = sharedSyncPipeDecoder.decode(view);
    const sep = zeroTerm ? "\0" : "\n";
    if (str.length > 0 && !str.endsWith(sep)) return undefined;
    return str.length === 0 ? [] : str.slice(0, -1).split(sep);
  }
,
  evalSyncComm(this: any, stdinLines: readonly string[] | undefined, opArgs: readonly string[], cwd: string, allowZero = false): string[] | undefined {
    let sup1 = false, sup2 = false, sup3 = false;
    let zeroTerm = false;
    let outDelim = "\t";
    let noCheckOrder = false;
    let showTotal = false;
    let literal = false;
    const files: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (literal || a === "-" || !a.startsWith("-")) {
        files.push(a);
        continue;
      }
      if (a === "--") { literal = true; continue; }
      if (a === "--nocheck-order") { noCheckOrder = true; continue; }
      if (a === "--check-order") { noCheckOrder = false; continue; }
      if (a === "--total") { showTotal = true; continue; }
      if (a === "--zero-terminated") { if (!allowZero) return undefined; zeroTerm = true; continue; }
      if (a === "--output-delimiter" && i + 1 < opArgs.length) {
        outDelim = opArgs[++i]!;
        if (outDelim.length === 0 || /[^\x09\x20-\x7e]/.test(outDelim)) return undefined;
        continue;
      }
      if (a.startsWith("--output-delimiter=")) {
        outDelim = a.slice(19);
        if (outDelim.length === 0 || /[^\x09\x20-\x7e]/.test(outDelim)) return undefined;
        continue;
      }
      if (/^-[123z]+$/.test(a)) {
        if (a.includes("z")) {
          if (!allowZero) return undefined;
          zeroTerm = true;
        }
        if (a.includes("1")) sup1 = true;
        if (a.includes("2")) sup2 = true;
        if (a.includes("3")) sup3 = true;
        continue;
      }
      return undefined;
    }
    if (files.length !== 2) return undefined;
    if (files[0] === "-" && files[1] === "-") return undefined;
    const lines1 = files[0] === "-" ? stdinLines : this.readSyncMemoryLines(resolvePath(cwd, files[0]!), zeroTerm);
    const lines2 = files[1] === "-" ? stdinLines : this.readSyncMemoryLines(resolvePath(cwd, files[1]!), zeroTerm);
    if (!lines1 || !lines2) return undefined;
    if (!noCheckOrder) {
      for (let i = 1; i < lines1.length; i++) if (lines1[i]! < lines1[i - 1]!) return undefined;
      for (let i = 1; i < lines2.length; i++) if (lines2[i]! < lines2[i - 1]!) return undefined;
    }
    const p2 = sup1 ? "" : outDelim;
    const p3 = (sup1 ? "" : outDelim) + (sup2 ? "" : outDelim);
    const out: string[] = [];
    let i = 0, j = 0, c1 = 0, c2 = 0, c3 = 0;
    while (i < lines1.length && j < lines2.length) {
      const l1 = lines1[i]!, l2 = lines2[j]!;
      if (l1 < l2) {
        if (!sup1) out.push(l1);
        c1++; i++;
      } else if (l1 > l2) {
        if (!sup2) out.push(p2 + l2);
        c2++; j++;
      } else {
        if (!sup3) out.push(p3 + l1);
        c3++; i++; j++;
      }
    }
    while (i < lines1.length) {
      if (!sup1) out.push(lines1[i]!);
      c1++; i++;
    }
    while (j < lines2.length) {
      if (!sup2) out.push(p2 + lines2[j]!);
      c2++; j++;
    }
    if (showTotal) out.push(`${c1}${outDelim}${c2}${outDelim}${c3}${outDelim}total`);
    return out;
  }
,
  evalSyncJoin(this: any, stdinLines: readonly string[] | undefined, opArgs: readonly string[], cwd: string): string[] | undefined {
    let sep: string | undefined;
    let f1 = 0, f2 = 0;
    let unp1 = false, unp2 = false, paired = true;
    let ignoreCase = false, headerMode = false, noCheckOrder = false;
    let emptyRep = "";
    let outSpec: Array<{ file: 0 | 1 | 2; idx: number }> | undefined;
    let literal = false;
    const files: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (literal || a === "-" || !a.startsWith("-")) {
        files.push(a);
        continue;
      }
      if (a === "--") { literal = true; continue; }
      if (a === "-i" || a === "--ignore-case") { ignoreCase = true; continue; }
      if (a === "--header") { headerMode = true; continue; }
      if (a === "--nocheck-order") { noCheckOrder = true; continue; }
      if (a === "--check-order") { noCheckOrder = false; continue; }
      if (a === "-t" || a.startsWith("-t")) {
        const v = a === "-t" ? opArgs[++i] : a.slice(2);
        if (!v || v.length !== 1 || /[^\x09\x20-\x7e]/.test(v)) return undefined;
        sep = v;
      } else if (/^-(?:1|2|j)[1-9][0-9]{0,2}$/.test(a)) {
        const idx = Number(a.slice(2)) - 1;
        if (a[1] !== "2") f1 = idx;
        if (a[1] !== "1") f2 = idx;
      } else if (a === "-1" || a === "-2" || a === "-j") {
        if (i + 1 >= opArgs.length || !/^[1-9][0-9]{0,2}$/.test(opArgs[i + 1]!)) return undefined;
        const idx = Number(opArgs[++i]!) - 1;
        if (a !== "-2") f1 = idx;
        if (a !== "-1") f2 = idx;
      } else if (a === "-a1" || a === "-a2" || a === "-v1" || a === "-v2") {
        if (a[2] === "1") unp1 = true; else unp2 = true;
        if (a[1] === "v") paired = false;
      } else if (a === "-a" || a === "-v") {
        if (i + 1 >= opArgs.length || (opArgs[i + 1] !== "1" && opArgs[i + 1] !== "2")) return undefined;
        const side = opArgs[++i]!;
        if (side === "1") unp1 = true; else unp2 = true;
        if (a === "-v") paired = false;
      } else if (a === "-e" || (a.startsWith("-e") && a.length > 2)) {
        if (a === "-e" && i + 1 >= opArgs.length) return undefined;
        emptyRep = a === "-e" ? opArgs[++i]! : a.slice(2);
      } else if (a === "-o" || (a.startsWith("-o") && a.length > 2)) {
        const rawO = a === "-o" ? opArgs[++i] : a.slice(2);
        if (!rawO) return undefined;
        if (rawO === "auto") {
          outSpec = [{ file: 0, idx: -1 }];
        } else {
          const parts = rawO.split(/[ ,]+/).filter(Boolean);
          if (parts.length === 0) return undefined;
          outSpec = [];
          for (const p of parts) {
            if (p === "0") outSpec.push({ file: 0, idx: 0 });
            else {
              const m = /^([12])\.([1-9][0-9]{0,2})$/.exec(p);
              if (!m) return undefined;
              outSpec.push({ file: Number(m[1]!) as 1 | 2, idx: Number(m[2]!) - 1 });
            }
          }
        }
      } else {
        return undefined;
      }
    }
    if (files.length !== 2 || (files[0] === "-" && files[1] === "-")) return undefined;
    const raw1 = files[0] === "-" ? stdinLines : this.readSyncMemoryLines(resolvePath(cwd, files[0]!));
    const raw2 = files[1] === "-" ? stdinLines : this.readSyncMemoryLines(resolvePath(cwd, files[1]!));
    if (!raw1 || !raw2) return undefined;
    const splitRow = (line: string): string[] => sep !== undefined ? line.split(sep) : (line.trim().length === 0 ? [] : line.trim().split(/[ \t]+/));
    const normKey = (k: string): string => ignoreCase ? k.toLowerCase() : k;
    let rows1 = raw1.map(l => { const fs = splitRow(l); const k = fs[f1] ?? ""; return { fields: fs, key: k, cmpKey: normKey(k) }; });
    let rows2 = raw2.map(l => { const fs = splitRow(l); const k = fs[f2] ?? ""; return { fields: fs, key: k, cmpKey: normKey(k) }; });
    let headerRow: { r1: (typeof rows1)[0] | undefined; r2: (typeof rows2)[0] | undefined } | undefined;
    if (headerMode && (rows1.length > 0 || rows2.length > 0)) {
      headerRow = { r1: rows1[0], r2: rows2[0] };
      rows1 = rows1.slice(1);
      rows2 = rows2.slice(1);
    }
    if (outSpec && outSpec.length === 1 && outSpec[0]!.file === 0 && outSpec[0]!.idx === -1) {
      const first1 = headerRow?.r1 ?? rows1[0];
      const first2 = headerRow?.r2 ?? rows2[0];
      const c1 = first1 ? first1.fields.length : 0;
      const c2 = first2 ? first2.fields.length : 0;
      outSpec = [{ file: 0, idx: 0 }];
      for (let k = 0; k < c1; k++) if (k !== f1) outSpec.push({ file: 1, idx: k });
      for (let k = 0; k < c2; k++) if (k !== f2) outSpec.push({ file: 2, idx: k });
    }
    if (!noCheckOrder) {
      for (let i = 1; i < rows1.length; i++) if (rows1[i]!.cmpKey < rows1[i - 1]!.cmpKey) return undefined;
      for (let i = 1; i < rows2.length; i++) if (rows2[i]!.cmpKey < rows2[i - 1]!.cmpKey) return undefined;
    }
    const outSep = sep ?? " ";
    const formatJoin = (key: string, r1: readonly string[] | undefined, r2: readonly string[] | undefined): string => {
      if (outSpec) {
        return outSpec.map(s => {
          if (s.file === 0) return key === "" ? emptyRep : key;
          const src = s.file === 1 ? r1 : r2;
          const val = src ? src[s.idx] : undefined;
          return val !== undefined && val !== "" ? val : emptyRep;
        }).join(outSep);
      }
      const parts = [key];
      if (r1) for (let k = 0; k < r1.length; k++) if (k !== f1) parts.push(r1[k]!);
      if (r2) for (let k = 0; k < r2.length; k++) if (k !== f2) parts.push(r2[k]!);
      return parts.join(outSep);
    };
    const out: string[] = [];
    if (headerRow) {
      out.push(formatJoin(headerRow.r1?.key ?? headerRow.r2?.key ?? "", headerRow.r1?.fields, headerRow.r2?.fields));
    }
    let i = 0, j = 0;
    while (i < rows1.length && j < rows2.length) {
      const ck1 = rows1[i]!.cmpKey, ck2 = rows2[j]!.cmpKey;
      if (ck1 < ck2) {
        if (unp1) out.push(formatJoin(rows1[i]!.key, rows1[i]!.fields, undefined));
        i++;
      } else if (ck1 > ck2) {
        if (unp2) out.push(formatJoin(rows2[j]!.key, undefined, rows2[j]!.fields));
        j++;
      } else {
        let iEnd = i + 1;
        while (iEnd < rows1.length && rows1[iEnd]!.cmpKey === ck1) iEnd++;
        let jEnd = j + 1;
        while (jEnd < rows2.length && rows2[jEnd]!.cmpKey === ck2) jEnd++;
        if (paired) {
          for (let ii = i; ii < iEnd; ii++) {
            for (let jj = j; jj < jEnd; jj++) {
              out.push(formatJoin(rows1[ii]!.key, rows1[ii]!.fields, rows2[jj]!.fields));
            }
          }
        }
        i = iEnd;
        j = jEnd;
      }
    }
    while (i < rows1.length) {
      if (unp1) out.push(formatJoin(rows1[i]!.key, rows1[i]!.fields, undefined));
      i++;
    }
    while (j < rows2.length) {
      if (unp2) out.push(formatJoin(rows2[j]!.key, undefined, rows2[j]!.fields));
      j++;
    }
    return out;
  }
,
  evalSyncStrings(this: any, rawLines: readonly string[], opArgs: readonly string[]): string[] | undefined {
    let minLen = 4;
    let sep: string | undefined;
    let radix: "d" | "o" | "x" | undefined;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-a" || a === "--all") continue;
      else if (a === "-o") radix = "o";
      else if (a === "-t" || a === "--radix") {
        if (i + 1 >= opArgs.length) return undefined;
        const r = opArgs[++i]!;
        if (r !== "d" && r !== "o" && r !== "x") return undefined;
        radix = r;
      } else if (a === "-td" || a === "-to" || a === "-tx") {
        radix = a.slice(2) as "d" | "o" | "x";
      } else if (a === "--radix=d" || a === "--radix=o" || a === "--radix=x") {
        radix = a.slice(8) as "d" | "o" | "x";
      } else if (a === "-n" || a === "--bytes") {
        if (i + 1 >= opArgs.length || !/^[1-9][0-9]{0,3}$/.test(opArgs[i + 1]!)) return undefined;
        minLen = Number(opArgs[++i]!);
      } else if (a.startsWith("-n") && /^[1-9][0-9]{0,3}$/.test(a.slice(2))) {
        minLen = Number(a.slice(2));
      } else if (a.startsWith("--bytes=") && /^[1-9][0-9]{0,3}$/.test(a.slice(8))) {
        minLen = Number(a.slice(8));
      } else if (/^-[1-9][0-9]{0,3}$/.test(a)) {
        minLen = Number(a.slice(1));
      } else if (a === "-s" || a === "--output-separator") {
        if (i + 1 >= opArgs.length) return undefined;
        sep = opArgs[++i]!;
      } else if (a.startsWith("-s") && a.length > 2) {
        sep = a.slice(2);
      } else if (a.startsWith("--output-separator=")) {
        sep = a.slice(19);
      } else {
        return undefined;
      }
    }
    if (sep !== undefined && (sep.includes("\n") || /[^\x20-\x7e]/.test(sep))) return undefined;
    const full = rawLines.join("\n");
    const runs: string[] = [];
    let cur = "";
    let runStart = 0;
    const pushRun = (): void => {
      if (cur.length >= minLen) {
        const loc = radix === undefined ? "" : `${runStart.toString(radix === "x" ? 16 : radix === "o" ? 8 : 10).padStart(7, " ")} `;
        runs.push(loc + cur);
      }
      cur = "";
    };
    for (let i = 0; i < full.length; i++) {
      const code = full.charCodeAt(i);
      if (code >= 128) return undefined;
      if (code === 9 || (code >= 32 && code <= 126)) {
        if (cur.length === 0) runStart = i;
        cur += full[i]!;
      } else {
        pushRun();
      }
    }
    pushRun();
    if (sep !== undefined) return runs.length === 0 ? [] : [runs.join(sep) + sep];
    return runs;
  }
,
  evalSyncColumn(this: any, rawLines: readonly string[], opArgs: readonly string[]): string[] | undefined {
    let tableMode = false;
    let jsonMode = false;
    let noHeadings = false;
    let tableName = "table";
    let sepChars: Set<string> | undefined;
    let outSep = "  ";
    let emptyLines = false;
    let headers: string[] | undefined;
    let rightSpec: string | undefined;
    let hideSpec: string | undefined;
    let orderSpec: string | undefined;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-t" || a === "--table") tableMode = true;
      else if (a === "-J" || a === "--json") { jsonMode = true; tableMode = true; }
      else if (a === "-d" || a === "--table-noheadings") noHeadings = true;
      else if (a === "-e" || a === "--table-empty-lines") emptyLines = true;
      else if (a === "-n" || a === "--table-name") {
        if (i + 1 >= opArgs.length || !opArgs[i + 1]) return undefined;
        tableName = opArgs[++i]!;
      } else if (a.startsWith("-n") && a.length > 2) {
        tableName = a.slice(2);
      } else if (a.startsWith("--table-name=") && a.length > 13) {
        tableName = a.slice(13);
      } else if (a === "-s" || a === "--separator") {
        if (i + 1 >= opArgs.length || !opArgs[i + 1]) return undefined;
        sepChars = new Set(Array.from(opArgs[++i]!));
      } else if (a.startsWith("-s") && a.length > 2) {
        sepChars = new Set(Array.from(a.slice(2)));
      } else if (a.startsWith("--separator=") && a.length > 12) {
        sepChars = new Set(Array.from(a.slice(12)));
      } else if (a === "-o" || a === "--output-separator") {
        if (i + 1 >= opArgs.length) return undefined;
        outSep = opArgs[++i]!;
      } else if (a.startsWith("-o") && a.length > 2) {
        outSep = a.slice(2);
      } else if (a.startsWith("--output-separator=")) {
        outSep = a.slice(19);
      } else if (a === "-N" || a === "--table-columns") {
        if (i + 1 >= opArgs.length || !opArgs[i + 1]) return undefined;
        headers = opArgs[++i]!.split(",");
      } else if (a.startsWith("-N") && a.length > 2) {
        headers = a.slice(2).split(",");
      } else if (a.startsWith("--table-columns=") && a.length > 16) {
        headers = a.slice(16).split(",");
      } else if (a === "-R" || a === "--table-right") {
        if (i + 1 >= opArgs.length || !opArgs[i + 1]) return undefined;
        rightSpec = rightSpec ? rightSpec + "," + opArgs[++i]! : opArgs[++i]!;
      } else if (a.startsWith("-R") && a.length > 2) {
        rightSpec = rightSpec ? rightSpec + "," + a.slice(2) : a.slice(2);
      } else if (a.startsWith("--table-right=") && a.length > 14) {
        rightSpec = rightSpec ? rightSpec + "," + a.slice(14) : a.slice(14);
      } else if (a === "-H" || a === "--table-hide") {
        if (i + 1 >= opArgs.length || !opArgs[i + 1]) return undefined;
        hideSpec = hideSpec ? hideSpec + "," + opArgs[++i]! : opArgs[++i]!;
      } else if (a.startsWith("-H") && a.length > 2) {
        hideSpec = hideSpec ? hideSpec + "," + a.slice(2) : a.slice(2);
      } else if (a.startsWith("--table-hide=") && a.length > 13) {
        hideSpec = hideSpec ? hideSpec + "," + a.slice(13) : a.slice(13);
      } else if (a === "-O" || a === "--table-order") {
        if (i + 1 >= opArgs.length || !opArgs[i + 1]) return undefined;
        orderSpec = orderSpec ? orderSpec + "," + opArgs[++i]! : opArgs[++i]!;
      } else if (a.startsWith("-O") && a.length > 2) {
        orderSpec = orderSpec ? orderSpec + "," + a.slice(2) : a.slice(2);
      } else if (a.startsWith("--table-order=") && a.length > 14) {
        orderSpec = orderSpec ? orderSpec + "," + a.slice(14) : a.slice(14);
      } else if (a.startsWith("-ts") || a.startsWith("-st")) {
        tableMode = true;
        const rest = a.slice(3);
        const sVal = rest.length > 0 ? rest : (i + 1 < opArgs.length ? opArgs[++i] : undefined);
        if (!sVal) return undefined;
        sepChars = new Set(Array.from(sVal));
      } else if (/^-[tedJ]+$/.test(a)) {
        if (a.includes("t")) tableMode = true;
        if (a.includes("J")) { jsonMode = true; tableMode = true; }
        if (a.includes("e")) emptyLines = true;
        if (a.includes("d")) noHeadings = true;
      } else {
        return undefined;
      }
    }
    if (!tableMode || /[^\x20-\x7e]/.test(outSep)) return undefined;
    if (jsonMode && (!headers || headers.length === 0)) return undefined;
    if (sepChars) {
      for (const ch of sepChars) if (ch.length !== 1 || (ch !== "\t" && (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) >= 0x7f))) return undefined;
    }
    if (headers && headers.some(h => !h || /[^\x20-\x7e]/.test(h))) return undefined;
    const rows: string[][] = [];
    let maxCols = headers ? headers.length : 0;
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i]!;
      if (/[^\x20-\x7e\t]/.test(l) || (l.includes("\t") && sepChars !== undefined && !sepChars.has("\t"))) return undefined;
      if (l.length === 0) {
        if (emptyLines) rows.push([]);
        continue;
      }
      const row: string[] = [];
      let start = 0;
      for (let k = 0; k < l.length; k++) {
        const ch = l[k]!;
        const isSep = sepChars ? sepChars.has(ch) : (ch === " " || ch === "\t");
        if (isSep) {
          if (sepChars || k > start) row.push(l.slice(start, k));
          start = k + 1;
        }
      }
      if (sepChars || l.length > start) row.push(l.slice(start));
      if (row.length === 0) continue;
      if (row.length > maxCols) maxCols = row.length;
      rows.push(row);
    }
    if (rows.length === 0) return [];
    const resolveColSpec = (spec: string | undefined): number[] | undefined => {
      if (!spec) return [];
      const res: number[] = [];
      for (const tok of spec.split(",")) {
        if (!tok) return undefined;
        let idx = -1;
        if (/^[1-9][0-9]*$/.test(tok)) idx = Number(tok) - 1;
        else if (headers) idx = headers.indexOf(tok);
        if (idx < 0 || idx >= maxCols) return undefined;
        if (!res.includes(idx)) res.push(idx);
      }
      return res;
    };
    const rightIndices = resolveColSpec(rightSpec);
    const hideIndices = resolveColSpec(hideSpec);
    const orderIndices = resolveColSpec(orderSpec);
    if (!rightIndices || !hideIndices || !orderIndices) return undefined;
    const rightSet = new Set(rightIndices);
    const hideSet = new Set(hideIndices);
    const ordered: number[] = [...orderIndices];
    for (let c = 0; c < maxCols; c++) if (!ordered.includes(c)) ordered.push(c);
    const visibleCols = ordered.filter(c => !hideSet.has(c));
    if (jsonMode) {
      const lower = (s: string) => s.toLowerCase();
      const keys = visibleCols.map(c => JSON.stringify(lower(headers?.[c] ?? "")));
      let jStr = `{\n   ${JSON.stringify(lower(tableName))}: [\n`;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r]!;
        jStr += r ? "{\n" : "      {\n";
        if (!keys.length) jStr += "\n";
        for (let k = 0; k < keys.length; k++) {
          const val = row[visibleCols[k]!] ?? "";
          jStr += `         ${keys[k]}: ${val ? JSON.stringify(val) : "null"}${k + 1 < keys.length ? "," : ""}\n`;
        }
        jStr += `      }${r + 1 < rows.length ? "," : "\n"}`;
      }
      jStr += `${rows.length ? "" : "\n"}   ]\n}`;
      return jStr.split("\n");
    }
    const allRows = (headers && !noHeadings) ? [headers, ...rows] : rows;
    const widths = new Array<number>(maxCols).fill(0);
    if (headers) {
      for (let c = 0; c < headers.length; c++) widths[c] = headers[c]!.length;
    }
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      for (let c = 0; c < row.length; c++) {
        if (row[c]!.length > widths[c]!) widths[c] = row[c]!.length;
      }
    }
    const out: string[] = [];
    for (let r = 0; r < allRows.length; r++) {
      const row = allRows[r]!;
      if (row.length === 0) { out.push(""); continue; }
      let line = "";
      for (let p = 0; p < visibleCols.length; p++) {
        const c = visibleCols[p]!;
        const val = row[c] ?? "";
        const w = widths[c] ?? 0;
        const pad = Math.max(0, w - val.length);
        const isLast = p + 1 === visibleCols.length;
        const isRight = rightSet.has(c);
        if (isRight) {
          line += (val.length > 0 ? " ".repeat(pad) + val : (isLast ? "" : " ".repeat(pad))) + (isLast ? "" : outSep);
        } else {
          line += val + (isLast ? "" : " ".repeat(pad) + outSep);
        }
      }
      out.push(line);
    }
    return out;
  }
,
  evalSyncFold(this: any, rawLines: readonly string[], opArgs: readonly string[]): string[] | undefined {
    let width = 80;
    let breakSpaces = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-s" || a === "--spaces") breakSpaces = true;
      else if (a === "-b" || a === "--bytes" || a === "-c" || a === "--characters") { /* ASCII printable */ }
      else if (a === "-w" || a === "--width") {
        if (i + 1 >= opArgs.length || !/^[1-9][0-9]{0,4}$/.test(opArgs[i + 1]!)) return undefined;
        width = Number(opArgs[++i]!);
      } else if (a.startsWith("-w") && /^[1-9][0-9]{0,4}$/.test(a.slice(2))) {
        width = Number(a.slice(2));
      } else if (a.startsWith("--width=") && /^[1-9][0-9]{0,4}$/.test(a.slice(8))) {
        width = Number(a.slice(8));
      } else if (/^-[sbc]+w([1-9][0-9]{0,4})?$/.test(a)) {
        if (a.includes("s")) breakSpaces = true;
        const wIdx = a.indexOf("w");
        const wRest = a.slice(wIdx + 1);
        if (wRest) width = Number(wRest);
        else {
          if (i + 1 >= opArgs.length || !/^[1-9][0-9]{0,4}$/.test(opArgs[i + 1]!)) return undefined;
          width = Number(opArgs[++i]!);
        }
      } else if (/^-[sbc]*[1-9][0-9]{0,4}$/.test(a)) {
        if (a.includes("s")) breakSpaces = true;
        const m = /[1-9][0-9]{0,4}$/.exec(a)!;
        width = Number(m[0]!);
      } else if (/^-[sbc]+$/.test(a)) {
        if (a.includes("s")) breakSpaces = true;
      } else {
        return undefined;
      }
    }
    const out: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      let l = rawLines[i]!;
      if (/[^\x20-\x7e]/.test(l)) return undefined;
      if (l.length <= width) {
        out.push(l);
        continue;
      }
      if (!breakSpaces) {
        for (let pos = 0; pos < l.length; pos += width) out.push(l.slice(pos, pos + width));
      } else {
        while (l.length > width) {
          const sp = l.slice(0, width).lastIndexOf(" ");
          const cut = sp >= 0 ? sp + 1 : width;
          out.push(l.slice(0, cut));
          l = l.slice(cut);
        }
        out.push(l);
      }
    }
    return out;
  }
,
  parseSyncTabList(this: any, spec: string): { tabStop: number; tabList?: number[] } | undefined {
    if (/^[1-9][0-9]{0,2}$/.test(spec)) {
      const n = Number(spec);
      return n >= 1 && n <= 64 ? { tabStop: n } : undefined;
    }
    if (/^[1-9][0-9]{0,2}(?:,[1-9][0-9]{0,2})+$/.test(spec)) {
      const list = spec.split(",").map(Number);
      for (let i = 1; i < list.length; i++) {
        if (list[i]! <= list[i - 1]! || list[i]! > 256) return undefined;
      }
      return { tabStop: 8, tabList: list };
    }
    return undefined;
  }
,
  evalSyncExpand(this: any, rawLines: readonly string[], opArgs: readonly string[]): string[] | undefined {
    let tabStop = 8;
    let tabList: number[] | undefined;
    let initialOnly = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-i" || a === "--initial") initialOnly = true;
      else if (a === "-t" || a === "--tabs") {
        if (i + 1 >= opArgs.length) return undefined;
        const parsed = this.parseSyncTabList(opArgs[++i]!);
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
      } else if (a.startsWith("-t") && a.length > 2) {
        const parsed = this.parseSyncTabList(a.slice(2));
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
      } else if (a.startsWith("--tabs=")) {
        const parsed = this.parseSyncTabList(a.slice(7));
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
      } else if (/^-(?:it|ti)(.*)$/.test(a)) {
        initialOnly = true;
        const rest = a.slice(3);
        const rawSpec = rest.length > 0 ? rest : (i + 1 < opArgs.length ? opArgs[++i]! : "");
        const parsed = this.parseSyncTabList(rawSpec);
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
      } else if (/^-[1-9][0-9]{0,2}(?:,[1-9][0-9]{0,2})*$/.test(a)) {
        const parsed = this.parseSyncTabList(a.slice(1));
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
      } else {
        return undefined;
      }
    }
    const out: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i]!;
      if (/[^\x20-\x7e\t]/.test(l)) return undefined;
      if (!l.includes("\t")) { out.push(l); continue; }
      let res = "";
      let col = 0;
      let initial = true;
      for (let k = 0; k < l.length; k++) {
        const ch = l[k]!;
        if (ch === "\t" && (!initialOnly || initial)) {
          let pad = 1;
          if (tabList) {
            const nextStop = tabList.find((s) => s > col);
            pad = nextStop !== undefined ? nextStop - col : 1;
          } else {
            pad = tabStop - (col % tabStop);
          }
          res += " ".repeat(pad);
          col += pad;
        } else {
          if (ch !== " " && ch !== "\t") initial = false;
          res += ch;
          col++;
        }
      }
      out.push(res);
    }
    return out;
  }
,
  evalSyncUnexpand(this: any, rawLines: readonly string[], opArgs: readonly string[]): string[] | undefined {
    let tabStop = 8;
    let tabList: number[] | undefined;
    let flagA = false;
    let flagT = false;
    let firstOnly = false;
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "-a" || a === "--all") flagA = true;
      else if (a === "--first-only") firstOnly = true;
      else if (a === "-t" || a === "--tabs") {
        if (i + 1 >= opArgs.length) return undefined;
        const parsed = this.parseSyncTabList(opArgs[++i]!);
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
        flagT = true;
      } else if (a.startsWith("-t") && a.length > 2) {
        const parsed = this.parseSyncTabList(a.slice(2));
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
        flagT = true;
      } else if (a.startsWith("--tabs=")) {
        const parsed = this.parseSyncTabList(a.slice(7));
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
        flagT = true;
      } else if (/^-(?:at|ta)(.*)$/.test(a)) {
        flagA = true;
        flagT = true;
        const rest = a.slice(3);
        const rawSpec = rest.length > 0 ? rest : (i + 1 < opArgs.length ? opArgs[++i]! : "");
        const parsed = this.parseSyncTabList(rawSpec);
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
      } else if (/^-[1-9][0-9]{0,2}(?:,[1-9][0-9]{0,2})*$/.test(a)) {
        const parsed = this.parseSyncTabList(a.slice(1));
        if (!parsed) return undefined;
        tabStop = parsed.tabStop; tabList = parsed.tabList;
        flagT = true;
      } else {
        return undefined;
      }
    }
    const nextStopFn = (pos: number): number => {
      if (tabList) {
        const ns = tabList.find((s) => s > pos);
        return ns !== undefined ? ns : Infinity;
      }
      return pos + tabStop - (pos % tabStop);
    };
    const all = !firstOnly && (flagA || flagT);
    const out: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i]!;
      if (/[^\x20-\x7e\t]/.test(l)) return undefined;
      let res = "";
      let column = 0, initial = true, active = true;
      let pendingStart = 0, pendingCount = 0, pendingTab = false;
      const flushBlanks = (): void => {
        if (!pendingCount) return;
        let position = pendingStart;
        const convertSingle = initial || pendingCount > 1 || pendingTab;
        while (position < column) {
          const stop = nextStopFn(position);
          if (stop <= column && (stop - position > 1 || convertSingle)) {
            res += "\t";
            position = stop;
          } else {
            res += " ";
            position++;
          }
        }
        pendingCount = 0;
        pendingTab = false;
      };
      for (let k = 0; k < l.length; k++) {
        const ch = l[k]!;
        if (active && (ch === " " || ch === "\t")) {
          const stop = nextStopFn(column);
          if (ch === "\t" && !Number.isFinite(stop)) return undefined;
          if (!pendingCount) pendingStart = column;
          pendingCount++;
          pendingTab ||= ch === "\t";
          column = ch === "\t" ? stop : column + 1;
          continue;
        }
        if (pendingCount) flushBlanks();
        res += ch;
        if (active) {
          column++;
          initial = false;
          if (!all) active = false;
        }
      }
      if (pendingCount) flushBlanks();
      out.push(res);
    }
    return out;
  }
,
  evalSyncExpr(this: any, args: readonly string[]): { value: string; status: number } | undefined {
    if (args.length === 0 || args[0] === "--help" || args[0] === "--version") return undefined;
    const ops = args[0] === "--" ? args.slice(1) : args;
    if (ops.length === 0) return undefined;
    let pos = 0;
    const isInt = (s: string): boolean => /^[+-]?[0-9]{1,18}$/.test(s);
    const isTruthy = (s: string): boolean => s !== "" && !/^[+-]?0+$/.test(s);
    const evalRegexMatch = (targetStr: string, rawPat: string): string | undefined => {
      if (/\\[2-9]/.test(rawPat) || rawPat.includes("[:") || rawPat.includes("[.") || rawPat.includes("[=")) return undefined;
      let jsPat = "";
      let hasCap = false;
      let inBr = false;
      for (let i = 0; i < rawPat.length; i++) {
        const ch = rawPat[i]!;
        if (inBr) {
          jsPat += ch;
          if (ch === "]") inBr = false;
          continue;
        }
        if (ch === "[") { inBr = true; jsPat += ch; continue; }
        if (ch === "\\" && i + 1 < rawPat.length) {
          const nxt = rawPat[++i]!;
          if (nxt === "(") { hasCap = true; jsPat += "("; }
          else if (nxt === ")") jsPat += ")";
          else if ("+?{}|".includes(nxt)) jsPat += nxt;
          else jsPat += "\\" + nxt;
          continue;
        }
        if ("+?{}()|".includes(ch)) { jsPat += "\\" + ch; continue; }
        jsPat += ch;
      }
      if (inBr) return undefined;
      try {
        const re = new RegExp("^(?:" + (jsPat.startsWith("^") ? jsPat.slice(1) : jsPat) + ")");
        const m = re.exec(targetStr);
        if (!m) return hasCap ? "" : "0";
        if (hasCap) return m[1] ?? "";
        return String(Array.from(m[0]).length);
      } catch {
        return undefined;
      }
    };
    const parsePrimary = (): string | undefined => {
      if (pos >= ops.length) return undefined;
      const tok = ops[pos]!;
      if (tok === "+") {
        pos++;
        if (pos >= ops.length) return undefined;
        return ops[pos++]!;
      }
      if (tok === "(") {
        pos++;
        const v = parseOr();
        if (v === undefined || pos >= ops.length || ops[pos] !== ")") return undefined;
        pos++;
        return v;
      }
      if (tok === "length") {
        pos++;
        const s = parsePrimary();
        if (s === undefined) return undefined;
        return String(Array.from(s).length);
      }
      if (tok === "substr") {
        pos++;
        const s = parsePrimary();
        const pStr = parsePrimary();
        const lStr = parsePrimary();
        if (s === undefined || pStr === undefined || lStr === undefined) return undefined;
        if (!isInt(pStr) || !isInt(lStr)) return undefined;
        const p = Number(pStr), l = Number(lStr);
        const chars = Array.from(s);
        return (p < 1 || l <= 0 || p > chars.length) ? "" : chars.slice(p - 1, p - 1 + l).join("");
      }
      if (tok === "index") {
        pos++;
        const s = parsePrimary();
        const cStr = parsePrimary();
        if (s === undefined || cStr === undefined) return undefined;
        const chars = Array.from(s);
        const set = new Set(Array.from(cStr));
        let idx = 0;
        for (let i = 0; i < chars.length; i++) {
          if (set.has(chars[i]!)) { idx = i + 1; break; }
        }
        return String(idx);
      }
      if (tok === "match") {
        pos++;
        const s = parsePrimary();
        const pat = parsePrimary();
        if (s === undefined || pat === undefined) return undefined;
        return evalRegexMatch(s, pat);
      }
      pos++;
      return tok;
    };
    const parseColon = (): string | undefined => {
      let left = parsePrimary();
      if (left === undefined) return undefined;
      while (pos < ops.length && ops[pos] === ":") {
        pos++;
        const right = parsePrimary();
        if (right === undefined) return undefined;
        const m = evalRegexMatch(left, right);
        if (m === undefined) return undefined;
        left = m;
      }
      return left;
    };
    const parseMul = (): string | undefined => {
      let left = parseColon();
      if (left === undefined) return undefined;
      while (pos < ops.length && (ops[pos] === "*" || ops[pos] === "/" || ops[pos] === "%")) {
        const op = ops[pos++]!;
        const right = parseColon();
        if (right === undefined || !isInt(left) || !isInt(right)) return undefined;
        const l: bigint = BigInt(left), r: bigint = BigInt(right);
        if ((op === "/" || op === "%") && r === 0n) return undefined;
        left = String(op === "*" ? l * r : op === "/" ? l / r : l % r);
      }
      return left;
    };
    const parseAdd = (): string | undefined => {
      let left = parseMul();
      if (left === undefined) return undefined;
      while (pos < ops.length && (ops[pos] === "+" || ops[pos] === "-")) {
        const op = ops[pos++]!;
        const right = parseMul();
        if (right === undefined || !isInt(left) || !isInt(right)) return undefined;
        const l: bigint = BigInt(left), r: bigint = BigInt(right);
        left = String(op === "+" ? l + r : l - r);
      }
      return left;
    };
    const parseCmp = (): string | undefined => {
      let left = parseAdd();
      if (left === undefined) return undefined;
      while (pos < ops.length && ["=", "==", "!=", "<", "<=", ">", ">="].includes(ops[pos]!)) {
        const op = ops[pos++]!;
        const right = parseAdd();
        if (right === undefined) return undefined;
        let ok: boolean;
        if (isInt(left) && isInt(right)) {
          const l: bigint = BigInt(left), r: bigint = BigInt(right);
          ok = (op === "=" || op === "==") ? l === r : op === "!=" ? l !== r : op === "<" ? l < r : op === "<=" ? l <= r : op === ">" ? l > r : l >= r;
        } else {
          ok = (op === "=" || op === "==") ? left === right : op === "!=" ? left !== right : op === "<" ? left < right : op === "<=" ? left <= right : op === ">" ? left > right : left >= right;
        }
        left = ok ? "1" : "0";
      }
      return left;
    };
    const parseAnd = (): string | undefined => {
      let left = parseCmp();
      if (left === undefined) return undefined;
      while (pos < ops.length && ops[pos] === "&") {
        pos++;
        const right = parseCmp();
        if (right === undefined) return undefined;
        left = (isTruthy(left) && isTruthy(right)) ? left : "0";
      }
      return left;
    };
    const parseOr = (): string | undefined => {
      let left = parseAnd();
      if (left === undefined) return undefined;
      while (pos < ops.length && ops[pos] === "|") {
        pos++;
        const right = parseAnd();
        if (right === undefined) return undefined;
        left = isTruthy(left) ? left : (isTruthy(right) ? right : "0");
      }
      return left;
    };
    const res = parseOr();
    if (res === undefined || pos !== ops.length) return undefined;
    return { value: res, status: isTruthy(res) ? 0 : 1 };
  }
,
  evalSyncBc(this: any, 
    input: string,
    opArgs: readonly string[],
    readFileSync?: (p: string) => Uint8Array | undefined,
  ): string[] | undefined {
    let scale = 0;
    let ibase = 10;
    let obase = 10;
    const files: string[] = [];
    let ended = false;
    for (const a of opArgs) {
      if (!ended && a === "--") { ended = true; continue; }
      if (!ended && (a === "-q" || a === "--quiet")) continue;
      if (!ended && (a === "-l" || a === "--mathlib")) { scale = 20; continue; }
      if (!ended && (a === "-ql" || a === "-lq")) { scale = 20; continue; }
      if (!ended && a.startsWith("-")) return undefined;
      files.push(a);
    }
    let fullInput = "";
    for (const f of files) {
      if (!readFileSync) return undefined;
      const fb = readFileSync(f);
      if (!fb || fb.includes(0)) return undefined;
      fullInput += sharedSyncPipeDecoder.decode(fb) + "\n";
    }
    fullInput += input;
    type DecVal = { c: bigint; s: number };
    const tenPow = (n: number): bigint => 10n ** BigInt(n);
    const isqrt = (n: bigint): bigint => {
      if (n < 2n) return n;
      let x0 = n;
      let x1 = (x0 + 1n) >> 1n;
      while (x1 < x0) {
        x0 = x1;
        x1 = (x0 + n / x0) >> 1n;
      }
      return x0;
    };
    const vars = new Map<string, DecVal>();
    const evalExpr = (expr: string): DecVal | undefined => {
      const e = expr.trim();
      if (e.length === 0) return undefined;
      if (e.startsWith("(") && e.endsWith(")")) {
        let d = 0;
        let wrap = true;
        for (let i = 0; i < e.length; i++) {
          if (e[i] === "(") d++;
          else if (e[i] === ")") {
            d--;
            if (d === 0 && i < e.length - 1) { wrap = false; break; }
          }
        }
        if (wrap && d === 0) return evalExpr(e.slice(1, -1));
      }
      let d = 0;
      for (let i = 0; i < e.length - 1; i++) {
        const ch = e[i]!;
        if (ch === "(") d++;
        else if (ch === ")") d--;
        else if (d === 0 && e.slice(i, i + 2) === "||") {
          const l = evalExpr(e.slice(0, i));
          const r = evalExpr(e.slice(i + 2));
          if (!l || !r) return undefined;
          return { c: (l.c !== 0n || r.c !== 0n) ? 1n : 0n, s: 0 };
        }
      }
      d = 0;
      for (let i = 0; i < e.length - 1; i++) {
        const ch = e[i]!;
        if (ch === "(") d++;
        else if (ch === ")") d--;
        else if (d === 0 && e.slice(i, i + 2) === "&&") {
          const l = evalExpr(e.slice(0, i));
          const r = evalExpr(e.slice(i + 2));
          if (!l || !r) return undefined;
          return { c: (l.c !== 0n && r.c !== 0n) ? 1n : 0n, s: 0 };
        }
      }
      if (e.startsWith("!") && !e.startsWith("!=")) {
        const sub = evalExpr(e.slice(1));
        if (!sub) return undefined;
        return { c: sub.c === 0n ? 1n : 0n, s: 0 };
      }
      d = 0;
      for (let i = 0; i < e.length; i++) {
        const ch = e[i]!;
        if (ch === "(") d++;
        else if (ch === ")") d--;
        else if (d === 0) {
          const two = e.slice(i, i + 2);
          const opLen = (two === "==" || two === "!=" || two === "<=" || two === ">=") ? 2 : ((ch === "<" || ch === ">") ? 1 : 0);
          if (opLen > 0) {
            const op = e.slice(i, i + opLen);
            const l = evalExpr(e.slice(0, i));
            const r = evalExpr(e.slice(i + opLen));
            if (!l || !r) return undefined;
            const ms = Math.max(l.s, r.s);
            const lc = l.c * tenPow(ms - l.s);
            const rc = r.c * tenPow(ms - r.s);
            const ok = op === "==" ? lc === rc : op === "!=" ? lc !== rc : op === "<=" ? lc <= rc : op === ">=" ? lc >= rc : op === "<" ? lc < rc : lc > rc;
            return { c: ok ? 1n : 0n, s: 0 };
          }
        }
      }
      d = 0;
      let addIdx = -1;
      for (let i = 0; i < e.length; i++) {
        const ch = e[i]!;
        if (ch === "(") d++;
        else if (ch === ")") d--;
        else if (d === 0 && (ch === "+" || ch === "-")) {
          const prev = e.slice(0, i).trimEnd();
          if (prev.length > 0 && !/[+\-*/%^]$/.test(prev)) addIdx = i;
        }
      }
      if (addIdx > 0) {
        const l = evalExpr(e.slice(0, addIdx));
        const r = evalExpr(e.slice(addIdx + 1));
        if (!l || !r) return undefined;
        const ms = Math.max(l.s, r.s);
        const lc = l.c * tenPow(ms - l.s);
        const rc = r.c * tenPow(ms - r.s);
        return { c: e[addIdx] === "+" ? lc + rc : lc - rc, s: ms };
      }
      let mulIdx = -1;
      for (let i = 0; i < e.length; i++) {
        const ch = e[i]!;
        if (ch === "(") d++;
        else if (ch === ")") d--;
        else if (d === 0 && (ch === "*" || ch === "/" || ch === "%")) mulIdx = i;
      }
      if (mulIdx > 0) {
        const l = evalExpr(e.slice(0, mulIdx));
        const r = evalExpr(e.slice(mulIdx + 1));
        if (!l || !r) return undefined;
        const op = e[mulIdx]!;
        if (op === "*") {
          const rawC = l.c * r.c;
          const rawS = l.s + r.s;
          const targetS = Math.min(rawS, Math.max(scale, l.s, r.s));
          return { c: rawC / tenPow(rawS - targetS), s: targetS };
        }
        if (r.c === 0n) return undefined;
        if (op === "/") {
          const num = l.c * tenPow(scale + r.s);
          const den = r.c * tenPow(l.s);
          return { c: num / den, s: scale };
        }
        if (op === "%" && scale === 0 && l.s === 0 && r.s === 0) {
          return { c: l.c % r.c, s: 0 };
        }
        return undefined;
      }
      let powIdx = -1;
      for (let i = 0; i < e.length; i++) {
        const ch = e[i]!;
        if (ch === "(") d++;
        else if (ch === ")") d--;
        else if (d === 0 && ch === "^") { powIdx = i; break; }
      }
      if (powIdx > 0) {
        const l = evalExpr(e.slice(0, powIdx));
        const r = evalExpr(e.slice(powIdx + 1));
        if (!l || !r || r.s !== 0 || r.c < 0n || r.c > 64n) return undefined;
        const exp = Number(r.c);
        if (l.s === 0) return { c: l.c ** r.c, s: 0 };
        if (l.s * exp > 40) return undefined;
        const rawC = l.c ** r.c;
        const rawS = l.s * exp;
        const targetS = Math.min(rawS, Math.max(scale, l.s));
        return { c: rawC / tenPow(rawS - targetS), s: targetS };
      }
      const fnM = /^(sqrt|length|scale)\s*\(([\s\S]+)\)$/.exec(e);
      if (fnM) {
        const arg = evalExpr(fnM[2]!);
        if (!arg) return undefined;
        const fnName = fnM[1]!;
        if (fnName === "scale") return { c: BigInt(arg.s), s: 0 };
        if (fnName === "length") {
          const absC = arg.c < 0n ? -arg.c : arg.c;
          const len = absC === 0n ? Math.max(1, arg.s) : Math.max(absC.toString().length, arg.s);
          return { c: BigInt(len), s: 0 };
        }
        if (fnName === "sqrt") {
          if (arg.c < 0n) return undefined;
          const targetS = Math.max(scale, arg.s);
          const scaledArg = arg.c * tenPow(2 * targetS - arg.s);
          return { c: isqrt(scaledArg), s: targetS };
        }
      }
      if (ibase !== 10 && /^[+-]?[0-9A-F]+$/.test(e)) {
        const neg = e.startsWith("-");
        const rawDigits = (neg || e.startsWith("+")) ? e.slice(1) : e;
        let acc = 0n;
        const bBig = BigInt(ibase);
        for (const ch of rawDigits) {
          const dv = ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 55;
          if (dv < 0 || dv >= ibase) return undefined;
          acc = acc * bBig + BigInt(dv);
        }
        return { c: neg ? -acc : acc, s: 0 };
      }
      const numM = /^([+-]?\d+)(?:\.(\d+))?$/.exec(e);
      if (numM) {
        const intPart = numM[1]!;
        const fracPart = numM[2] ?? "";
        const neg = intPart.startsWith("-");
        const digits = (neg ? intPart.slice(1) : intPart.startsWith("+") ? intPart.slice(1) : intPart) + fracPart;
        return { c: (neg ? -1n : 1n) * BigInt(digits), s: fracPart.length };
      }
      if (/^[a-z][a-z0-9_]*$/.test(e)) {
        return vars.get(e) ?? { c: 0n, s: 0 };
      }
      return undefined;
    };
    const formatDec = (v: DecVal): string => {
      if (obase !== 10) {
        if (v.s !== 0) return "";
        const neg = v.c < 0n;
        const absVal = neg ? -v.c : v.c;
        return (neg && v.c !== 0n ? "-" : "") + absVal.toString(obase).toUpperCase();
      }
      if (v.c === 0n || v.s === 0) return v.c.toString();
      const neg = v.c < 0n;
      const absStr = (neg ? -v.c : v.c).toString().padStart(v.s + 1, "0");
      const intStr = absStr.slice(0, absStr.length - v.s);
      const fracStr = absStr.slice(absStr.length - v.s);
      return (neg && v.c !== 0n ? "-" : "") + (intStr === "0" ? "" : intStr) + "." + fracStr;
    };
    const stmts = fullInput.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
    const out: string[] = [];
    for (const st of stmts) {
      const scaleM = /^scale\s*=\s*([0-9]{1,2})$/.exec(st);
      if (scaleM) {
        scale = Number(scaleM[1]!);
        if (scale > 20) return undefined;
        continue;
      }
      const baseM = /^(ibase|obase)\s*=\s*([0-9]{1,2})$/.exec(st);
      if (baseM) {
        const bVal = Number(baseM[2]!);
        if (bVal < 2 || bVal > 16) return undefined;
        if (baseM[1] === "ibase") ibase = bVal;
        else obase = bVal;
        continue;
      }
      const compM = /^([a-z][a-z0-9_]*)\s*([+\-*/%])=\s*(.+)$/.exec(st);
      if (compM) {
        const val = evalExpr(`${compM[1]!} ${compM[2]!} (${compM[3]!})`);
        if (!val) return undefined;
        vars.set(compM[1]!, val);
        continue;
      }
      const varM = /^([a-z][a-z0-9_]*)\s*=\s*(.+)$/.exec(st);
      if (varM && !st.includes("==")) {
        const val = evalExpr(varM[2]!);
        if (!val) return undefined;
        vars.set(varM[1]!, val);
        continue;
      }
      const val = evalExpr(st);
      if (!val || (obase !== 10 && val.s !== 0)) return undefined;
      out.push(formatDec(val));
    }
    return out;
  }
,
  evalSyncXxd(this: any, 
    view: Uint8Array,
    opArgs: readonly string[],
    readFileSync?: (p: string) => Uint8Array | undefined,
    fileOperandName?: string,
  ): string | undefined {
    let plain = false;
    let reverse = false;
    let upper = false;
    let binary = false;
    let include = false;
    let decimalAddress = false;
    let explicitCols: number | undefined;
    let explicitGroup: number | undefined;
    let includeName: string | undefined;
    let maxLen: number | undefined;
    let seekOff = 0;
    let ended = false;
    const files: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (ended) { files.push(a); continue; }
      if (a === "--") { ended = true; continue; }
      if (a === "-p" || a === "-ps" || a === "-plain" || a === "-postscript") plain = true;
      else if (a === "-r" || a === "-revert") reverse = true;
      else if (a === "-rp" || a === "-pr") { reverse = true; plain = true; }
      else if (a === "-u") upper = true;
      else if (a === "-pu" || a === "-up") { plain = true; upper = true; }
      else if (a === "-b" || a === "-bits") binary = true;
      else if (a === "-i" || a === "-include") include = true;
      else if (a === "-d") decimalAddress = true;
      else if ((a === "-c" || a === "-cols") && i + 1 < opArgs.length && /^[0-9]{1,4}$/.test(opArgs[i + 1]!)) {
        explicitCols = Number(opArgs[++i]!);
      } else if (/^-c[0-9]{1,4}$/.test(a)) {
        explicitCols = Number(a.slice(2));
      } else if ((a === "-g" || a === "-groupsize") && i + 1 < opArgs.length && /^[0-9]{1,4}$/.test(opArgs[i + 1]!)) {
        explicitGroup = Number(opArgs[++i]!);
      } else if (/^-g[0-9]{1,4}$/.test(a)) {
        explicitGroup = Number(a.slice(2));
      } else if ((a === "-n" || a === "-name") && i + 1 < opArgs.length) {
        includeName = opArgs[++i]!;
      } else if (a.startsWith("-n") && a.length > 2) {
        includeName = a.slice(2);
      } else if ((a === "-l" || a === "-len") && i + 1 < opArgs.length && /^[0-9]{1,6}$/.test(opArgs[i + 1]!)) {
        maxLen = Number(opArgs[++i]!);
      } else if (/^-l[0-9]{1,6}$/.test(a)) {
        maxLen = Number(a.slice(2));
      } else if ((a === "-s" || a === "-seek") && i + 1 < opArgs.length && /^[+-]?[0-9]{1,6}$/.test(opArgs[i + 1]!)) {
        seekOff = Number(opArgs[++i]!);
      } else if (/^-s[+-]?[0-9]{1,6}$/.test(a)) {
        seekOff = Number(a.slice(2));
      } else if (!a.startsWith("-") || a === "-") {
        files.push(a);
      } else {
        return undefined;
      }
    }
    if ((plain && (binary || include)) || (binary && include) || (reverse && !plain)) return undefined;
    if (files.length > 1) return undefined;
    let effFile = fileOperandName;
    if (files.length === 1 && files[0] !== "-") {
      if (!readFileSync) return undefined;
      const fb = readFileSync(files[0]!);
      if (!fb || fb.byteLength > 16384) return undefined;
      view = fb;
      effFile = files[0]!;
    }
    const cols = explicitCols ?? (plain ? 30 : include ? 12 : binary ? 6 : 16);
    const group = explicitGroup ?? (binary ? 1 : 2);
    if (!plain && cols < 1) return undefined;
    if (!reverse && (seekOff !== 0 || maxLen !== undefined)) {
      const start = seekOff < 0 ? Math.max(0, view.byteLength + seekOff) : Math.min(view.byteLength, seekOff);
      const end = maxLen !== undefined ? Math.min(view.byteLength, start + maxLen) : view.byteLength;
      view = view.subarray(start, end);
    }
    if (include) {
      const effName = includeName ?? effFile;
      let ident = "";
      if (effName !== undefined) {
        for (const ch of effName) {
          const c = ch.charCodeAt(0);
          ident += (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ? ch : "_";
        }
        if (ident[0] && ident[0] >= "0" && ident[0] <= "9") ident = "__" + ident;
      }
      const pfx = upper ? "0X" : "0x";
      const rows: string[] = [];
      for (let off = 0; off < view.byteLength; off += cols) {
        const sl = view.subarray(off, Math.min(view.byteLength, off + cols));
        rows.push("  " + Array.from(sl, b => pfx + (upper ? b.toString(16).toUpperCase() : b.toString(16)).padStart(2, "0")).join(", "));
      }
      let out = effName !== undefined ? `unsigned char ${ident}[] = {\n` : "";
      if (rows.length > 0) out += rows.join(",\n") + "\n";
      if (effName !== undefined) out += `};\nunsigned int ${ident}_len = ${view.byteLength};\n`;
      return out;
    }
    if (!plain) {
      const startAddr = seekOff < 0 ? Math.max(0, view.byteLength + seekOff) : seekOff;
      const width = cols * (binary ? 8 : 2) + (group ? Math.floor((cols - 1) / group) : 0);
      let out = "";
      for (let off = 0; off < view.byteLength; off += cols) {
        const sl = view.subarray(off, Math.min(view.byteLength, off + cols));
        let data = "";
        let ascii = "";
        for (let idx = 0; idx < sl.length; idx++) {
          if (group && idx && idx % group === 0) data += " ";
          const b = sl[idx]!;
          data += binary ? b.toString(2).padStart(8, "0") : (upper ? b.toString(16).toUpperCase() : b.toString(16)).padStart(2, "0");
          ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : ".";
        }
        const addr = (startAddr + off).toString(decimalAddress ? 10 : 16).padStart(8, "0");
        out += `${addr}: ${data.padEnd(width, " ")}  ${ascii}\n`;
      }
      return out;
    }
    if (reverse) {
      const bytes: number[] = [];
      let high = -1;
      for (let i = 0; i < view.byteLength; i++) {
        const b = view[i]!;
        if (b === 32 || (b >= 9 && b <= 13)) continue;
        const d = b >= 48 && b <= 57 ? b - 48 : b >= 65 && b <= 70 ? b - 55 : b >= 97 && b <= 102 ? b - 87 : -1;
        if (d < 0) return undefined;
        if (high < 0) high = d;
        else {
          const outB = (high << 4) | d;
          if (outB === 0 || outB >= 128) return undefined;
          bytes.push(outB);
          high = -1;
        }
      }
      if (high >= 0) return undefined;
      return sharedSyncPipeDecoder.decode(new Uint8Array(bytes));
    }
    if (view.byteLength === 0) return "";
    let hex = "";
    for (let i = 0; i < view.byteLength; i++) {
      const h = view[i]!.toString(16).padStart(2, "0");
      hex += upper ? h.toUpperCase() : h;
      if (cols > 0 && (i + 1) % cols === 0 && i + 1 < view.byteLength) hex += "\n";
    }
    return hex + "\n";
  }
,
  evalSyncFmt(this: any, inBytes: Uint8Array, opArgs: readonly string[], readFile?: (path: string) => Uint8Array | undefined): string | undefined {
    if (inBytes.byteLength > 4096) return undefined;
    try {
      const cacheKey = opArgs.join("\x1f");
      let parsed = (this._syncFmtParsedCache ??= new Map()).get(cacheKey);
      if (!parsed) {
        const argBytes = opArgs.map(a => fastSharedTextEncoder.encode(a));
        parsed = parseFmtArguments(argBytes) as { files?: readonly unknown[]; information?: unknown };
        if ((this._syncFmtParsedCache ??= new Map()).size < 64) (this._syncFmtParsedCache ??= new Map()).set(cacheKey, parsed);
      }
      if ((parsed as { information?: unknown }).information !== undefined) return undefined;
      const files = (parsed.files as readonly { name: string }[] | undefined) ?? [{ name: "-" }];
      let out = "";
      let stdinDone = false;
      for (const f of files) {
        if (f.name === "-" && stdinDone) continue;
        let srcBytes = inBytes;
        if (f.name === "-") {
          stdinDone = true;
        } else {
          if (!readFile) return undefined;
          const fBytes = readFile(f.name);
          if (!fBytes || fBytes.byteLength > 4096) return undefined;
          srcBytes = fBytes;
        }
        if (srcBytes.byteLength === 0) continue;
        const engine = createFmtEngine(parsed as Parameters<typeof createFmtEngine>[0], {}, { aborted: false } as AbortSignal);
        const gen = engine.run();
        let step = gen.next();
        let sent = false;
        while (!step.done) {
          if (step.value === "input") {
            if (!sent) {
              sent = true;
              step = gen.next(srcBytes);
            } else {
              step = gen.next(null);
            }
          } else if (step.value instanceof Uint8Array) {
            out += sharedSyncPipeDecoder.decode(step.value);
            step = gen.next();
          } else {
            step = gen.next();
          }
        }
      }
      return out;
    } catch {
      return undefined;
    }
  }
,
  evalSyncSysinfo(this: any, cmdName: string, opArgs: readonly string[], rawState: State): string | undefined {
    const raw = (stateMonitor(rawState)?.raw ?? rawState) as State & { _exported?: Set<string> };
    const isRestrictedEnv = raw._exported === undefined && "_exported" in raw;
    const getEnv = (name: string): string | undefined => {
      if (isRestrictedEnv) return name === "PWD" ? raw.variables.PWD : undefined;
      if (raw.exported.has(name) || raw.allexport) return raw.variables[name];
      return undefined;
    };
    if (cmdName === "uname") {
      let flagAll = false, flagS = false, flagN = false, flagR = false, flagV = false, flagM = false, flagP = false, flagI = false, flagO = false;
      let endOfOptions = false;
      for (let i = 0; i < opArgs.length; i++) {
        const arg = opArgs[i]!;
        if (!endOfOptions && arg === "--") { endOfOptions = true; continue; }
        if (!endOfOptions && (arg === "--help" || arg === "--version")) return undefined;
        if (!endOfOptions && arg.startsWith("--") && arg.length > 2) {
          if (arg === "--all") flagAll = true;
          else if (arg === "--kernel-name" || arg === "--sysname") flagS = true;
          else if (arg === "--nodename") flagN = true;
          else if (arg === "--kernel-release" || arg === "--release") flagR = true;
          else if (arg === "--kernel-version") flagV = true;
          else if (arg === "--machine") flagM = true;
          else if (arg === "--processor") flagP = true;
          else if (arg === "--hardware-platform") flagI = true;
          else if (arg === "--operating-system") flagO = true;
          else return undefined;
          continue;
        }
        if (!endOfOptions && arg.startsWith("-") && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const ch = arg[j]!;
            if (ch === "a") flagAll = true;
            else if (ch === "s") flagS = true;
            else if (ch === "n") flagN = true;
            else if (ch === "r") flagR = true;
            else if (ch === "v") flagV = true;
            else if (ch === "m") flagM = true;
            else if (ch === "p") flagP = true;
            else if (ch === "i") flagI = true;
            else if (ch === "o") flagO = true;
            else return undefined;
          }
          continue;
        }
        return undefined;
      }
      if (!flagAll && !flagS && !flagN && !flagR && !flagV && !flagM && !flagP && !flagI && !flagO) flagS = true;
      const kernelName = getEnv("UNAME_S") ?? "Linux";
      const nodename = getEnv("UNAME_N") ?? getEnv("HOSTNAME") ?? "sandbox";
      const kernelRelease = getEnv("UNAME_R") ?? "6.6.0-sandbox-vfs";
      const kernelVersion = getEnv("UNAME_V") ?? "#1 SMP Sandbox VFS-ish/GNU";
      const machine = getEnv("UNAME_M") ?? "x86_64";
      const processor = getEnv("UNAME_P") ?? "unknown";
      const hardwarePlatform = getEnv("UNAME_I") ?? "unknown";
      const operatingSystem = getEnv("UNAME_O") ?? "GNU/Linux";
      const fields: string[] = [];
      if (flagAll || flagS) fields.push(kernelName);
      if (flagAll || flagN) fields.push(nodename);
      if (flagAll || flagR) fields.push(kernelRelease);
      if (flagAll || flagV) fields.push(kernelVersion);
      if (flagAll || flagM) fields.push(machine);
      if (flagP || (flagAll && processor !== "unknown")) fields.push(processor);
      if (flagI || (flagAll && hardwarePlatform !== "unknown")) fields.push(hardwarePlatform);
      if (flagAll || flagO) fields.push(operatingSystem);
      return fields.join(" ");
    }
    if (cmdName === "whoami") {
      if (opArgs.length !== 0 || this.tryReadMemoryFileViewSync("/etc/passwd", false) !== undefined) return undefined;
      if (getEnv("ID_EUID") !== undefined || getEnv("EUID") !== undefined || getEnv("ID_UID") !== undefined || getEnv("UID") !== undefined) return undefined;
      return getEnv("WHOAMI") ?? getEnv("USER") ?? getEnv("LOGNAME") ?? "sandbox";
    }
    if (cmdName === "id") {
      if (this.tryReadMemoryFileViewSync("/etc/passwd", false) !== undefined || this.tryReadMemoryFileViewSync("/etc/group", false) !== undefined) return undefined;
      for (const k of ["ID_UID", "UID", "ID_EUID", "EUID", "ID_GID", "GID", "ID_EGID", "EGID", "ID_USER", "USER", "LOGNAME", "GROUP", "ID_GROUPS", "SELINUX_CONTEXT"]) {
        if (getEnv(k) !== undefined) return undefined;
      }
      if (opArgs.length === 0) return "uid=1000(sandbox) gid=1000(sandbox) groups=1000(sandbox)";
      if (opArgs.length === 1) {
        const a = opArgs[0]!;
        if (a === "-u" || a === "-g" || a === "-G") return "1000";
        if (a === "-un" || a === "-nu" || a === "-gn" || a === "-ng" || a === "-Gn" || a === "-nG") return "sandbox";
      }
      return undefined;
    }
    if (cmdName === "hostname") {
      if (this.tryReadMemoryFileViewSync("/etc/hostname", false) !== undefined || getEnv("HOSTNAME_DOMAIN") !== undefined || getEnv("HOSTNAME_IP") !== undefined) return undefined;
      const host = getEnv("HOSTNAME") || "sandbox";
      if (opArgs.length === 0) return host;
      if (opArgs.length === 1 && (opArgs[0] === "-f" || opArgs[0] === "--fqdn" || opArgs[0] === "--long")) return host.includes(".") ? host : `${host}.vfs.local`;
      if (opArgs.length === 1 && (opArgs[0] === "-s" || opArgs[0] === "--short")) return host.split(".")[0]!;
      if (opArgs.length === 1 && (opArgs[0] === "-i" || opArgs[0] === "--ip-address")) return "127.0.0.1";
      if (opArgs.length === 1 && (opArgs[0] === "-I" || opArgs[0] === "--all-ip-addresses")) return "127.0.0.1 ";
      return undefined;
    }
    if (cmdName === "nproc") {
      if (getEnv("OMP_NUM_THREADS") !== undefined || getEnv("OMP_THREAD_LIMIT") !== undefined || getEnv("NPROC") !== undefined) return undefined;
      if (opArgs.length === 0 || (opArgs.length === 1 && opArgs[0] === "--all")) return "4";
      return undefined;
    }
    if (cmdName === "getconf") {
      const GETCONF_TABLE: Readonly<Record<string, string>> = {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        CS_PATH: "/usr/local/bin:/usr/bin:/bin",
        ARG_MAX: "2097152",
        _POSIX_ARG_MAX: "4096",
        NAME_MAX: "255",
        _POSIX_NAME_MAX: "14",
        PATH_MAX: "4096",
        _POSIX_PATH_MAX: "256",
        PAGE_SIZE: "4096",
        PAGESIZE: "4096",
        _SC_PAGE_SIZE: "4096",
        _SC_PAGESIZE: "4096",
        NPROCESSORS_ONLN: "4",
        _NPROCESSORS_ONLN: "4",
        NPROCESSORS_CONF: "4",
        _NPROCESSORS_CONF: "4",
        CLK_TCK: "100",
        OPEN_MAX: "1024",
        _POSIX_OPEN_MAX: "20",
        CHILD_MAX: "256",
        _POSIX_CHILD_MAX: "25",
        LINE_MAX: "2048",
        _POSIX2_LINE_MAX: "2048",
        PIPE_BUF: "4096",
        _POSIX_PIPE_BUF: "512",
        LINK_MAX: "65000",
        _POSIX_LINK_MAX: "8",
        MAX_CANON: "255",
        _POSIX_MAX_CANON: "255",
        MAX_INPUT: "255",
        _POSIX_MAX_INPUT: "255",
        FILESIZEBITS: "64",
        SYMLINK_MAX: "4095",
        SYMLOOP_MAX: "40",
        _POSIX_SYMLOOP_MAX: "8",
        HOST_NAME_MAX: "64",
        _POSIX_HOST_NAME_MAX: "255",
        LOGIN_NAME_MAX: "256",
        _POSIX_LOGIN_NAME_MAX: "9",
        NGROUPS_MAX: "65536",
        _POSIX_NGROUPS_MAX: "8",
        TZNAME_MAX: "6",
        _POSIX_TZNAME_MAX: "6",
        CHAR_BIT: "8",
        WORD_BIT: "32",
        LONG_BIT: "64",
        INT_MAX: "2147483647",
        INT_MIN: "-2147483648",
        UINT_MAX: "4294967295",
        LONG_MAX: "9223372036854775807",
        ULONG_MAX: "18446744073709551615",
        LLONG_MAX: "9223372036854775807",
        ULLONG_MAX: "18446744073709551615",
        SSIZE_MAX: "9223372036854775807",
        POSIX_VERSION: "200809",
        _POSIX_VERSION: "200809",
        POSIX2_VERSION: "200809",
        _POSIX2_VERSION: "200809",
        XOPEN_VERSION: "700",
        _XOPEN_VERSION: "700",
        POSIX_V7_LP64_OFF64: "1",
        POSIX_V6_LP64_OFF64: "1",
        XBS5_LP64_OFF64: "1",
        _POSIX_CHOWN_RESTRICTED: "1",
        _POSIX_NO_TRUNC: "1",
        _POSIX_VDISABLE: "0",
        BC_BASE_MAX: "99",
        BC_DIM_MAX: "2048",
        BC_SCALE_MAX: "99",
        BC_STRING_MAX: "1000",
        COLL_WEIGHTS_MAX: "255",
        EXPR_NEST_MAX: "32",
        RE_DUP_MAX: "32767",
        GNU_LIBC_VERSION: "glibc 2.39",
        GNU_LIBPTHREAD_VERSION: "NPTL 2.39",
        LFS_CFLAGS: "-D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64",
        LFS_LDFLAGS: "",
        LFS_LIBS: "",
      };
      let allMode = false;
      const operands: string[] = [];
      let endOfOptions = false;
      for (let i = 0; i < opArgs.length; i++) {
        const arg = opArgs[i]!;
        if (!endOfOptions && arg === "--") { endOfOptions = true; continue; }
        if (!endOfOptions && (arg === "--help" || arg === "--version")) return undefined;
        if (!endOfOptions && arg === "-a") { allMode = true; continue; }
        if (!endOfOptions && arg === "-v") {
          if (opArgs[++i] === undefined) return undefined;
          continue;
        }
        if (!endOfOptions && arg.startsWith("-")) return undefined;
        operands.push(arg);
      }
      if (allMode) {
        if (operands.length !== 0 && !(operands.length === 1 && operands[0] === "/")) return undefined;
        return Object.entries(GETCONF_TABLE).map(([k, v]) => `${k.padEnd(31, " ")}${v}`).join("\n");
      }
      if (operands.length !== 1 && !(operands.length === 2 && operands[1] === "/")) return undefined;
      const varName = operands[0]!;
      const normalized = varName.startsWith("_CS_") ? varName.slice(4) : varName.startsWith("_PC_") ? varName.slice(4) : varName;
      return GETCONF_TABLE[varName] ?? GETCONF_TABLE[normalized];
    }
    if (cmdName === "locale") {
      if (opArgs.length === 0) {
        const lang = getEnv("LANG") ?? "C.UTF-8";
        const lcAll = getEnv("LC_ALL");
        const lines: string[] = [`LANG=${lang}`];
        for (const cat of [
          "LC_CTYPE", "LC_NUMERIC", "LC_TIME", "LC_COLLATE", "LC_MONETARY", "LC_MESSAGES",
          "LC_PAPER", "LC_NAME", "LC_ADDRESS", "LC_TELEPHONE", "LC_MEASUREMENT", "LC_IDENTIFICATION"
        ]) {
          if (lcAll) lines.push(`${cat}="${lcAll}"`);
          else if (getEnv(cat)) lines.push(`${cat}=${getEnv(cat)!}`);
          else lines.push(`${cat}="${lang || "C.UTF-8"}"`);
        }
        lines.push(`LC_ALL=${lcAll ?? ""}`);
        return lines.join("\n");
      }
      if (opArgs.length === 1) {
        const a0 = opArgs[0]!;
        if (a0 === "-a" || a0 === "--all-locales") return "C\nC.utf8\nC.UTF-8\nPOSIX\nen_US.utf8\nen_US.UTF-8\nUTF-8";
        if (a0 === "-m" || a0 === "--charmaps") return "ANSI_X3.4-1968\nASCII\nISO-8859-1\nUTF-8";
        if (a0 === "charmap") {
          const ctype = getEnv("LC_ALL") || getEnv("LC_CTYPE") || getEnv("LANG") || "C.UTF-8";
          return /utf-?8/i.test(ctype) ? "UTF-8" : "ANSI_X3.4-1968";
        }
      }
      return undefined;
    }
    if (cmdName === "cal" || cmdName === "ncal") {
      return evalSyncCal(cmdName, opArgs, getEnv("SOURCE_DATE_EPOCH"));
    }
    return undefined;
  }
,
  evalSyncFactor(this: any, rawLines: readonly string[] | undefined, opArgs: readonly string[]): string[] | undefined {
    let optionsEnded = false;
    let exponents = false;
    const operands: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!optionsEnded && a === "--") { optionsEnded = true; continue; }
      if (!optionsEnded && (a === "-h" || a === "--exponents")) { exponents = true; continue; }
      if (!optionsEnded && a.startsWith("-")) return undefined;
      operands.push(a);
    }
    const tokens: string[] = [];
    if (operands.length > 0) {
      for (const op of operands) tokens.push(op);
    } else {
      if (rawLines === undefined) return undefined;
      for (const line of rawLines) {
        for (const t of line.split(/[ \t\r\n\f\v]+/)) {
          if (t.length > 0) tokens.push(t);
        }
      }
    }
    if (tokens.length > 64) return undefined;
    const out: string[] = [];
    for (let ti = 0; ti < tokens.length; ti++) {
      const tok = tokens[ti]!;
      let s = 0;
      while (s < tok.length && tok[s] === " ") s++;
      if (tok[s] === "+") s++;
      const clean = s > 0 ? tok.slice(s) : tok;
      if (clean.length === 0 || clean.length > 18 || !/^[0-9]+$/.test(clean)) return undefined;
      const nVal = BigInt(clean);
      let rem = nVal;
      const factors: bigint[] = [];
      while (rem > 1n && (rem & 1n) === 0n) {
        factors.push(2n);
        rem >>= 1n;
      }
      for (let d = 3n; d * d <= rem; d += 2n) {
        while (rem % d === 0n) {
          factors.push(d);
          rem /= d;
        }
      }
      if (rem > 1n) factors.push(rem);
      let rec = `${nVal}:`;
      for (let idx = 0; idx < factors.length; idx++) {
        const f = factors[idx]!;
        let exp = 1;
        if (exponents) {
          while (factors[idx + 1] === f) { exp++; idx++; }
        }
        rec += ` ${f}${exp > 1 ? `^${exp}` : ""}`;
      }
      out.push(rec);
    }
    return out;
  }
,
  evalSyncTsort(this: any, rawLines: readonly string[] | undefined, opArgs: readonly string[], cwd: string): string[] | undefined {
    let optionsEnded = false;
    const files: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!optionsEnded && a === "--") { optionsEnded = true; continue; }
      if (!optionsEnded && a.startsWith("-") && a !== "-") return undefined;
      files.push(a);
    }
    if (files.length > 1) return undefined;
    let linesToRead = rawLines;
    if (files.length === 1 && files[0] !== "-") {
      const memLines = this.readSyncMemoryLines(resolvePath(cwd ?? "/", files[0]!));
      if (memLines === undefined) return undefined;
      linesToRead = memLines;
    }
    if (linesToRead === undefined) return undefined;
    const tokens: string[] = [];
    for (const line of linesToRead) {
      for (const t of line.split(/[ \t\r\n\f\v]+/)) {
        if (t.length > 0) tokens.push(t);
      }
    }
    if ((tokens.length & 1) !== 0 || tokens.length > 512) return undefined;
    type TNode = { name: string; count: number; printed: boolean; edges: TNode[] };
    const nodes = new Map<string, TNode>();
    const ordered: TNode[] = [];
    const getNode = (name: string): TNode => {
      let n = nodes.get(name);
      if (!n) {
        n = { name, count: 0, printed: false, edges: [] };
        nodes.set(name, n);
        ordered.push(n);
      }
      return n;
    };
    for (let i = 0; i < tokens.length; i += 2) {
      const u = getNode(tokens[i]!);
      const v = getNode(tokens[i + 1]!);
      if (u !== v && !u.edges.includes(v)) {
        v.count++;
        u.edges.unshift(v);
      }
    }
    let remaining = ordered.length;
    const out: string[] = [];
    while (remaining > 0) {
      const queue: TNode[] = [];
      for (let i = 0; i < ordered.length; i++) {
        const n = ordered[i]!;
        if (!n.printed && n.count === 0) queue.push(n);
      }
      if (queue.length === 0) return undefined;
      for (let q = 0; q < queue.length; q++) {
        const n = queue[q]!;
        out.push(n.name);
        n.printed = true;
        remaining--;
        for (let e = 0; e < n.edges.length; e++) {
          const target = n.edges[e]!;
          if (--target.count === 0) queue.push(target);
        }
      }
    }
    return out;
  }
,
  evalSyncEnvsubst(this: any, inStr: string | undefined, opArgs: readonly string[], rawState: State): string | undefined {
    let endOfOptions = false;
    let variablesMode = false;
    const operands: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (!endOfOptions && a === "--") { endOfOptions = true; continue; }
      if (!endOfOptions && (a === "-v" || a === "--variables")) { variablesMode = true; continue; }
      if (!endOfOptions && a.startsWith("-")) return undefined;
      operands.push(a);
    }
    if (operands.length > 1) return undefined;
    const extractVars = (fmt: string): string[] => {
      const vars: string[] = [];
      const re = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(fmt)) !== null) {
        vars.push((m[1] ?? m[2])!);
      }
      return vars;
    };
    if (variablesMode) {
      if (operands.length !== 1) return undefined;
      const vars = extractVars(operands[0]!);
      return vars.length > 0 ? vars.join("\n") + "\n" : "";
    }
    if (inStr === undefined) return undefined;
    const allowedVars = operands.length === 1 ? new Set(extractVars(operands[0]!)) : undefined;
    const raw = (stateMonitor(rawState)?.raw ?? rawState) as State & { _exported?: Set<string> };
    const isRestrictedEnv = raw._exported === undefined && "_exported" in raw;
    return inStr.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (full, braced, bare) => {
      const name = (braced ?? bare) as string;
      if (allowedVars !== undefined && !allowedVars.has(name)) return full;
      if (isRestrictedEnv) return name === "PWD" ? (raw.variables.PWD ?? "") : "";
      if (raw.exported.has(name) || raw.allexport) return raw.variables[name] ?? "";
      return "";
    });
  }
,
  evalSyncHexdump(this: any, 
    inBytes: Uint8Array,
    opArgs: readonly string[],
    isHd = false,
    readFileSync?: (p: string) => Uint8Array | undefined,
  ): string | undefined {
    let canonical = isHd;
    let verbose = false;
    let ended = false;
    let skip = 0;
    let count = Infinity;
    const files: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (ended) { files.push(a); continue; }
      if (a === "--") { ended = true; continue; }
      if (a === "-C") { canonical = true; continue; }
      if (a === "-v") { verbose = true; continue; }
      if (a === "-Cv" || a === "-vC") { canonical = true; verbose = true; continue; }
      if (a === "-n" || a === "-s" || a === "--length" || a === "--skip") {
        if (i + 1 >= opArgs.length || !/^[0-9]+$/.test(opArgs[i + 1]!)) return undefined;
        const val = Number(opArgs[++i]!);
        if (a === "-n" || a === "--length") count = val; else skip = val;
        continue;
      }
      if (/^-[ns][0-9]+$/.test(a)) {
        const val = Number(a.slice(2));
        if (a[1] === "n") count = val; else skip = val;
        continue;
      }
      if (!a.startsWith("-")) { files.push(a); continue; }
      return undefined;
    }
    if (files.length > 0) {
      if (!readFileSync) return undefined;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (const f of files) {
        const b = readFileSync(f);
        if (!b || total + b.byteLength > 4096) return undefined;
        chunks.push(b);
        total += b.byteLength;
      }
      const merged = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) { merged.set(c, pos); pos += c.byteLength; }
      inBytes = merged;
    }
    if (!canonical || inBytes.byteLength > 4096 || count === 0) return undefined;
    const start = Math.min(inBytes.byteLength, skip);
    const end = Math.min(inBytes.byteLength, start + count);
    let address = start;
    let out = "";
    let prevSlice: Uint8Array | undefined;
    let squeezed = false;
    for (let pos = start; pos < end; pos += 16) {
      const used = Math.min(16, end - pos);
      const block = inBytes.subarray(pos, pos + used);
      let same = prevSlice !== undefined && prevSlice.byteLength === used && used === 16;
      if (same && prevSlice) {
        for (let k = 0; k < used; k++) {
          if (block[k] !== prevSlice[k]) { same = false; break; }
        }
      }
      if (!verbose && same) {
        if (!squeezed) out += "*\n";
        squeezed = true;
        address += used;
        continue;
      }
      prevSlice = block;
      squeezed = false;
      let line = address.toString(16).padStart(8, "0") + "  ";
      for (let k = 0; k < 16; k++) {
        if (k === 8) line += " ";
        line += k < used ? block[k]!.toString(16).padStart(2, "0") : "  ";
        if (k !== 15) line += " ";
      }
      line += "  |";
      for (let k = 0; k < used; k++) {
        const b = block[k]!;
        line += (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".";
      }
      line += "|\n";
      out += line;
      address += used;
    }
    if (address > 0) {
      out += address.toString(16).padStart(8, "0") + "\n";
    }
    return out;
  }
,
  evalSyncOd(this: any, 
    view: Uint8Array,
    opArgs: readonly string[],
    readFileSync?: (p: string) => Uint8Array | undefined,
  ): string | undefined {
    let addrRadix: "o" | "x" | "d" | "n" = "o";
    let typeSpec: "x1" | "u1" | "o1" | "c" | undefined;
    let verbose = false;
    let skipBytes = 0;
    let readBytes: number | undefined;
    let width = 16;
    let ended = false;
    const files: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (ended) { files.push(a); continue; }
      if (a === "--") { ended = true; continue; }
      if (a === "-An" || a === "-Ax" || a === "-Ao" || a === "-Ad") addrRadix = a[2] as "o" | "x" | "d" | "n";
      else if (a === "-A" && i + 1 < opArgs.length && ["o", "x", "d", "n"].includes(opArgs[i + 1]!)) {
        addrRadix = opArgs[++i] as "o" | "x" | "d" | "n";
      } else if (a === "-tx1" || a === "-tu1" || a === "-to1" || a === "-tc") {
        if (typeSpec !== undefined) return undefined;
        typeSpec = a.slice(2) as "x1" | "u1" | "o1" | "c";
      } else if (a === "-c") {
        if (typeSpec !== undefined) return undefined;
        typeSpec = "c";
      } else if (a === "-b") {
        if (typeSpec !== undefined) return undefined;
        typeSpec = "o1";
      } else if (a === "-t" && i + 1 < opArgs.length && ["x1", "u1", "o1", "c"].includes(opArgs[i + 1]!)) {
        if (typeSpec !== undefined) return undefined;
        typeSpec = opArgs[++i] as "x1" | "u1" | "o1" | "c";
      } else if (a === "-v" || a === "--output-duplicates") verbose = true;
      else if (a === "-w" && i + 1 < opArgs.length && /^[1-9][0-9]{0,3}$/.test(opArgs[i + 1]!)) width = Number(opArgs[++i]!);
      else if (/^-w[1-9][0-9]{0,3}$/.test(a)) width = Number(a.slice(2));
      else if (/^--width=[1-9][0-9]{0,3}$/.test(a)) width = Number(a.slice(8));
      else if (a === "-j" && i + 1 < opArgs.length && /^[0-9]{1,6}$/.test(opArgs[i + 1]!)) skipBytes = Number(opArgs[++i]!);
      else if (/^-j[0-9]{1,6}$/.test(a)) skipBytes = Number(a.slice(2));
      else if (/^--skip-bytes=[0-9]{1,6}$/.test(a)) skipBytes = Number(a.slice(13));
      else if (a === "-N" && i + 1 < opArgs.length && /^[0-9]{1,6}$/.test(opArgs[i + 1]!)) readBytes = Number(opArgs[++i]!);
      else if (/^-N[0-9]{1,6}$/.test(a)) readBytes = Number(a.slice(2));
      else if (/^--read-bytes=[0-9]{1,6}$/.test(a)) readBytes = Number(a.slice(13));
      else if (!a.startsWith("-") || a === "-") files.push(a);
      else return undefined;
    }
    if (!typeSpec) return undefined;
    if (files.length > 0) {
      if (!readFileSync) return undefined;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (const f of files) {
        const b = f === "-" ? view : readFileSync(f);
        if (!b || total + b.byteLength > 16384) return undefined;
        chunks.push(b);
        total += b.byteLength;
      }
      const merged = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) { merged.set(c, pos); pos += c.byteLength; }
      view = merged;
    }
    if (skipBytes > view.byteLength) return undefined;
    if (skipBytes > 0 || readBytes !== undefined) {
      const sOff = Math.min(view.byteLength, skipBytes);
      const eOff = readBytes !== undefined ? Math.min(view.byteLength, sOff + readBytes) : view.byteLength;
      view = view.subarray(sOff, eOff);
    }
    const fmtAddr = (off: number): string =>
      addrRadix === "n" ? "" : off.toString(addrRadix === "o" ? 8 : addrRadix === "x" ? 16 : 10).padStart(addrRadix === "x" ? 6 : 7, "0");
    if (view.byteLength === 0) return addrRadix === "n" ? "" : fmtAddr(skipBytes) + "\n";
    const escMap: Record<number, string> = { 0: "\\0", 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r" };
    const rows: string[] = [];
    let prevRow = "";
    let starEmitted = false;
    for (let off = 0; off < view.byteLength; off += width) {
      const slice = view.subarray(off, Math.min(off + width, view.byteLength));
      let row = "";
      for (let i = 0; i < slice.length; i++) {
        const b = slice[i]!;
        if (typeSpec === "x1") row += " " + b.toString(16).padStart(2, "0");
        else if (typeSpec === "o1") row += " " + b.toString(8).padStart(3, "0");
        else if (typeSpec === "c") {
          const ch = escMap[b] ?? (b >= 32 && b <= 126 ? String.fromCharCode(b) : b.toString(8).padStart(3, "0"));
          row += " " + ch.padStart(3, " ");
        } else row += " " + b.toString(10).padStart(3, " ");
      }
      if (!verbose && off > 0 && slice.length === width && row === prevRow) {
        if (!starEmitted) { rows.push("*"); starEmitted = true; }
      } else {
        rows.push(fmtAddr(skipBytes + off) + row);
        prevRow = row;
        starEmitted = false;
      }
    }
    if (addrRadix !== "n") rows.push(fmtAddr(skipBytes + view.byteLength));
    return rows.join("\n") + "\n";
  }
,
  evalSyncNumfmt(this: any, rawLines: readonly string[], opArgs: readonly string[]): string[] | undefined {
    let fromScale: "none" | "iec" | "iec-i" | "si" | "auto" = "none";
    let toScale: "none" | "iec" | "iec-i" | "si" = "none";
    let roundMode: "up" | "down" | "from-zero" | "towards-zero" | "nearest" = "from-zero";
    let padding = 0;
    let suffix = "";
    let formatStr: string | undefined;
    let headerLines = 0;
    let delim: string | undefined;
    let fieldIdx = 1;
    let fromUnit = 1;
    let toUnit = 1;
    const applyRound = (x: number): number => {
      if (roundMode === "up") return Math.ceil(x - 1e-12);
      if (roundMode === "down") return Math.floor(x + 1e-12);
      if (roundMode === "towards-zero") return x >= 0 ? Math.floor(x + 1e-12) : -Math.floor(Math.abs(x) + 1e-12);
      if (roundMode === "nearest") return Math.sign(x) * Math.round(Math.abs(x));
      return x >= 0 ? Math.ceil(x - 1e-12) : -Math.ceil(Math.abs(x) - 1e-12);
    };
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a.startsWith("--from=") || (a === "--from" && i + 1 < opArgs.length)) {
        const v = a === "--from" ? opArgs[++i]! : a.slice(7);
        if (v === "none" || v === "iec" || v === "iec-i" || v === "si" || v === "auto") fromScale = v;
        else return undefined;
      } else if (a.startsWith("--to=") || (a === "--to" && i + 1 < opArgs.length)) {
        const v = a === "--to" ? opArgs[++i]! : a.slice(5);
        if (v === "none" || v === "iec" || v === "iec-i" || v === "si") toScale = v;
        else return undefined;
      } else if (a.startsWith("--round=") || (a === "--round" && i + 1 < opArgs.length)) {
        const v = a === "--round" ? opArgs[++i]! : a.slice(8);
        if (v === "up" || v === "down" || v === "from-zero" || v === "towards-zero" || v === "nearest") roundMode = v;
        else return undefined;
      } else if (a.startsWith("--padding=") || (a === "--padding" && i + 1 < opArgs.length)) {
        const v = a === "--padding" ? opArgs[++i]! : a.slice(10);
        if (!/^-?[1-9][0-9]{0,2}$/.test(v)) return undefined;
        padding = Number(v);
      } else if (a.startsWith("--suffix=") || (a === "--suffix" && i + 1 < opArgs.length)) {
        suffix = a === "--suffix" ? opArgs[++i]! : a.slice(9);
      } else if (a.startsWith("--format=") || (a === "--format" && i + 1 < opArgs.length)) {
        formatStr = a === "--format" ? opArgs[++i]! : a.slice(9);
      } else if (a === "--header") {
        if (i + 1 < opArgs.length && /^[1-9][0-9]{0,2}$/.test(opArgs[i + 1]!)) headerLines = Number(opArgs[++i]!);
        else headerLines = 1;
      } else if (/^--header=[1-9][0-9]{0,2}$/.test(a)) {
        headerLines = Number(a.slice(9));
      } else if (a === "-d" && i + 1 < opArgs.length && opArgs[i + 1]!.length === 1) {
        delim = opArgs[++i]!;
      } else if (a.startsWith("-d") && a.length === 3) {
        delim = a.slice(2);
      } else if (a.startsWith("--delimiter=") && a.length === 13) {
        delim = a.slice(12);
      } else if (a.startsWith("--field=") || (a === "--field" && i + 1 < opArgs.length)) {
        const v = a === "--field" ? opArgs[++i]! : a.slice(8);
        if (!/^[1-9][0-9]{0,2}$/.test(v)) return undefined;
        fieldIdx = Number(v);
      } else if (a.startsWith("--from-unit=") || (a === "--from-unit" && i + 1 < opArgs.length)) {
        const v = a === "--from-unit" ? opArgs[++i]! : a.slice(12);
        if (!/^[1-9][0-9]{0,8}$/.test(v)) return undefined;
        fromUnit = Number(v);
      } else if (a.startsWith("--to-unit=") || (a === "--to-unit" && i + 1 < opArgs.length)) {
        const v = a === "--to-unit" ? opArgs[++i]! : a.slice(10);
        if (!/^[1-9][0-9]{0,8}$/.test(v)) return undefined;
        toUnit = Number(v);
      } else if (!a.startsWith("-") && rawLines.length === 0) {
        rawLines = [...rawLines, ...opArgs.slice(i)];
        break;
      } else {
        return undefined;
      }
    }
    let fmtParsed: { prefix: string; zeroPad: boolean; leftAlign: boolean; width: number; prec: number | undefined; suffix: string } | undefined;
    if (formatStr !== undefined) {
      const fm = /^([^%]*?)%([-0]*)(\d+)?(?:\.(\d+))?f([^%]*)$/.exec(formatStr);
      if (!fm) return undefined;
      fmtParsed = {
        prefix: fm[1]!,
        zeroPad: fm[2]!.includes("0") && !fm[2]!.includes("-"),
        leftAlign: fm[2]!.includes("-"),
        width: fm[3] ? Number(fm[3]) : 0,
        prec: fm[4] !== undefined ? Number(fm[4]) : undefined,
        suffix: fm[5]!,
      };
    }
    const units = "KMGTPEZY";
    const out: string[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i]!;
      if (i < headerLines) {
        out.push(line);
        continue;
      }
      let fields: string[] | undefined;
      let wsTokens: Array<{ ws: string; tok: string }> | undefined;
      let trailingWs = "";
      let raw: string;
      if (delim !== undefined) {
        fields = line.split(delim);
        if (fieldIdx > fields.length) return undefined;
        raw = fields[fieldIdx - 1]!.trim();
        if (fields[fieldIdx - 1] !== raw) return undefined;
      } else if (fieldIdx > 1 || /\s/.test(line.trim())) {
        wsTokens = [];
        let pos = 0;
        const re = /(\s*)(\S+)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          wsTokens.push({ ws: m[1]!, tok: m[2]! });
          pos = re.lastIndex;
        }
        trailingWs = line.slice(pos);
        if (fieldIdx > wsTokens.length) return undefined;
        raw = wsTokens[fieldIdx - 1]!.tok;
      } else {
        raw = line.trim();
        if (line !== raw) return undefined;
      }
      if (raw.length === 0) { out.push(""); continue; }
      if (suffix && raw.length > suffix.length && raw.endsWith(suffix)) raw = raw.slice(0, -suffix.length);
      const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([KMGTPEZYkmgtpezy]i?)?$/.exec(raw);
      if (!m) return undefined;
      if (toScale === "none" && fmtParsed?.prec === undefined && m[1]!.includes(".") && !m[2]) return undefined;
      let val = Number(m[1]!);
      const suf = m[2] ?? "";
      if (suf.length > 0) {
        if (fromScale === "none") return undefined;
        const uChar = suf[0]!.toUpperCase();
        const pIdx = units.indexOf(uChar) + 1;
        if (pIdx <= 0) return undefined;
        const hasI = suf.length === 2 && suf[1]!.toLowerCase() === "i";
        if (fromScale === "iec-i" && !hasI) return undefined;
        if ((fromScale === "iec" || fromScale === "si") && hasI) return undefined;
        const fBase = (fromScale === "iec" || fromScale === "iec-i" || (fromScale === "auto" && hasI)) ? 1024 : 1000;
        val = val * Math.pow(fBase, pIdx);
      }
      val = (val * fromUnit) / toUnit;
      let rendered: string;
      if (toScale === "none") {
        if (fmtParsed?.prec !== undefined) {
          const factor = Math.pow(10, fmtParsed.prec);
          const rVal = applyRound(val * factor) / factor;
          rendered = rVal.toFixed(fmtParsed.prec);
        } else {
          rendered = String(Math.trunc(applyRound(val)));
        }
      } else {
        const tBase = (toScale === "iec" || toScale === "iec-i") ? 1024 : 1000;
        let pIdx = 0;
        let scaled = val;
        while (Math.abs(scaled) >= tBase && pIdx < units.length) {
          scaled /= tBase;
          pIdx++;
        }
        if (pIdx === 0) {
          rendered = fmtParsed?.prec !== undefined ? scaled.toFixed(fmtParsed.prec) : String(Math.trunc(applyRound(scaled)));
        } else {
          const prec = fmtParsed?.prec !== undefined ? fmtParsed.prec : (Math.abs(scaled) < 10 ? 1 : 0);
          const factor = Math.pow(10, prec);
          scaled = applyRound(scaled * factor) / factor;
          if (Math.abs(scaled) >= tBase && pIdx < units.length) {
            scaled /= tBase;
            pIdx++;
          }
          const numText = scaled.toFixed(prec);
          const uText = (toScale === "si" && pIdx === 1 ? "k" : units[pIdx - 1]!) + (toScale === "iec-i" ? "i" : "");
          rendered = numText + uText;
        }
      }
      rendered += suffix;
      if (fmtParsed) {
        if (fmtParsed.width > rendered.length) {
          const padLen = fmtParsed.width - rendered.length;
          if (fmtParsed.leftAlign) {
            rendered = rendered + " ".repeat(padLen);
          } else if (fmtParsed.zeroPad) {
            const neg = rendered.startsWith("-");
            const body = neg ? rendered.slice(1) : rendered;
            rendered = (neg ? "-" : "") + "0".repeat(padLen) + body;
          } else {
            rendered = " ".repeat(padLen) + rendered;
          }
        }
        rendered = fmtParsed.prefix + rendered + fmtParsed.suffix;
      }
      if (padding !== 0) {
        const w = Math.abs(padding);
        if (rendered.length < w) {
          const pad = " ".repeat(w - rendered.length);
          rendered = padding < 0 ? rendered + pad : pad + rendered;
        }
      }
      if (fields !== undefined && delim !== undefined) {
        fields[fieldIdx - 1] = rendered;
        out.push(fields.join(delim));
      } else if (wsTokens !== undefined) {
        wsTokens[fieldIdx - 1]!.tok = rendered;
        if (wsTokens[fieldIdx - 1]!.ws.length === 0 && fieldIdx > 1) wsTokens[fieldIdx - 1]!.ws = " ";
        out.push(wsTokens.map(t => t.ws + t.tok).join("") + trailingWs);
      } else {
        out.push(rendered);
      }
    }
    return out;
  }
,
  evalSyncSort(this: any, rawLines: readonly string[], opArgs: readonly string[], isByteLocale: boolean, allowZero = false): string[] | undefined {
    if (isByteLocale) return undefined;
    let rev = false;
    let num = false;
    let genNum = false;
    let human = false;
    let month = false;
    let dict = false;
    let uniq = false;
    let fold = false;
    let blanks = false;
    let stable = false;
    let ver = false;
    let sep: string | undefined;
    const keySpecs: string[] = [];
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (/^-[runfbgsVhMdz]+$/.test(a)) {
        if (a.includes("z") && !allowZero) return undefined;
        if (a.includes("r")) rev = true;
        if (a.includes("n")) num = true;
        if (a.includes("g")) genNum = true;
        if (a.includes("h")) human = true;
        if (a.includes("M")) month = true;
        if (a.includes("d")) dict = true;
        if (a.includes("u")) uniq = true;
        if (a.includes("f")) fold = true;
        if (a.includes("b")) blanks = true;
        if (a.includes("s")) stable = true;
        if (a.includes("V")) ver = true;
      } else if (a === "--reverse") rev = true;
      else if (a === "--numeric-sort" || a === "--sort=numeric") num = true;
      else if (a === "--general-numeric-sort" || a === "--sort=general-numeric") genNum = true;
      else if (a === "--human-numeric-sort" || a === "--sort=human-numeric") human = true;
      else if (a === "--month-sort" || a === "--sort=month") month = true;
      else if (a === "--dictionary-order") dict = true;
      else if (a === "--unique") uniq = true;
      else if (a === "--ignore-case") fold = true;
      else if (a === "--ignore-leading-blanks") blanks = true;
      else if (a === "--stable") stable = true;
      else if (a === "--version-sort" || a === "--sort=version") ver = true;
      else if (a === "--zero-terminated") {
        if (!allowZero) return undefined;
      } else if ((a === "-t" || a === "--field-separator") && i + 1 < opArgs.length && opArgs[i + 1]!.length === 1) {
        sep = opArgs[++i]!;
      } else if (a.startsWith("-t") && a.length === 3) {
        sep = a[2]!;
      } else if (a.startsWith("--field-separator=") && a.length === 19) {
        sep = a[18]!;
      } else if ((a === "-k" || a === "--key") && i + 1 < opArgs.length) {
        keySpecs.push(opArgs[++i]!);
      } else if (a.startsWith("-k") && a.length > 2) {
        keySpecs.push(a.slice(2));
      } else if (a.startsWith("--key=") && a.length > 6) {
        keySpecs.push(a.slice(6));
      } else if (/^-[runfbgsVhMdz]+k(.*)$/.test(a)) {
        const cm = /^(-[runfbgsVhMdz]+)k(.*)$/.exec(a)!;
        const pfx = cm[1]!;
        if (pfx.includes("z") && !allowZero) return undefined;
        if (pfx.includes("r")) rev = true;
        if (pfx.includes("n")) num = true;
        if (pfx.includes("g")) genNum = true;
        if (pfx.includes("h")) human = true;
        if (pfx.includes("M")) month = true;
        if (pfx.includes("d")) dict = true;
        if (pfx.includes("u")) uniq = true;
        if (pfx.includes("f")) fold = true;
        if (pfx.includes("b")) blanks = true;
        if (pfx.includes("s")) stable = true;
        if (pfx.includes("V")) ver = true;
        if (cm[2]!.length > 0) keySpecs.push(cm[2]!);
        else if (i + 1 < opArgs.length) keySpecs.push(opArgs[++i]!);
        else return undefined;
      } else if (/^-[runfbgsVhMdz]+t(.?)$/.test(a)) {
        const cm = /^(-[runfbgsVhMdz]+)t(.?)$/.exec(a)!;
        const pfx = cm[1]!;
        if (pfx.includes("z") && !allowZero) return undefined;
        if (pfx.includes("r")) rev = true;
        if (pfx.includes("n")) num = true;
        if (pfx.includes("g")) genNum = true;
        if (pfx.includes("h")) human = true;
        if (pfx.includes("M")) month = true;
        if (pfx.includes("d")) dict = true;
        if (pfx.includes("u")) uniq = true;
        if (pfx.includes("f")) fold = true;
        if (pfx.includes("b")) blanks = true;
        if (pfx.includes("s")) stable = true;
        if (pfx.includes("V")) ver = true;
        if (cm[2]!.length === 1) sep = cm[2]!;
        else if (cm[2]!.length === 0 && i + 1 < opArgs.length && opArgs[i + 1]!.length === 1) sep = opArgs[++i]!;
        else return undefined;
      } else {
        return undefined;
      }
    }
    if (ver || keySpecs.some(ks => ks.includes("V"))) return undefined;
    const keySpec = keySpecs[0];
    let startField = 1;
    let startChar = 1;
    let endField: number | undefined;
    let endChar: number | undefined;
    let keyNum = num;
    let keyGenNum = genNum;
    let keyHuman = human;
    let keyMonth = month;
    let keyDict = dict;
    let keyRev = rev;
    let keyFold = fold;
    let keyBlanks = blanks;
    let keyVer = ver;
    if (keySpec !== undefined) {
      const km = /^([1-9][0-9]{0,2})(?:\.([1-9][0-9]{0,2}))?([nrbfgVhMd]*)(?:,([1-9][0-9]{0,2})(?:\.([0-9]{1,3}))?([nrbfgVhMd]*))?$/.exec(keySpec);
      if (!km) return undefined;
      startField = Number(km[1]!);
      startChar = km[2] !== undefined ? Number(km[2]!) : 1;
      endField = km[4] !== undefined ? Number(km[4]!) : undefined;
      endChar = km[5] !== undefined ? Number(km[5]!) : undefined;
      if (endField !== undefined && endField < startField) return undefined;
      if ((startChar > 1 || (endChar !== undefined && endChar > 0)) && endField !== undefined && endField !== startField) return undefined;
      const kf = (km[3] ?? "") + (km[6] ?? "");
      if (kf.length > 0) {
        keyNum = kf.includes("n");
        keyGenNum = kf.includes("g");
        keyHuman = kf.includes("h");
        keyMonth = kf.includes("M");
        keyDict = kf.includes("d");
        keyRev = kf.includes("r");
        keyFold = kf.includes("f");
        keyBlanks = kf.includes("b");
        keyVer = kf.includes("V");
      }
    }
    // Defer invalid effective ordering modes to the command for its usage status
    // and diagnostic. Explicit key modifiers replace the global modifiers.
    if (Number(keyNum) + Number(keyGenNum) + Number(keyHuman) + Number(keyMonth) > 1 ||
        keyDict && (keyNum || keyGenNum || keyHuman || keyMonth)) return undefined;
    const extractKey = (l: string): string => {
      let raw = keySpec === undefined
        ? l
        : (() => {
            if (sep !== undefined) {
              const fields = l.split(sep);
              return fields.slice(startField - 1, endField).join(sep);
            }
            // Default fields include their leading blanks; retain exact bytes.
            let offset = 0;
            let start = l.length;
            let end = l.length;
            for (let field = 1; offset < l.length; field++) {
              if (field === startField) start = offset;
              while (l[offset] === " " || l[offset] === "\t") offset++;
              while (offset < l.length && l[offset] !== " " && l[offset] !== "\t") offset++;
              if (field === endField) { end = offset; break; }
            }
            return l.slice(start, end);
          })();
      if (keyBlanks) raw = raw.replace(/^[ \t]+/, "");
      if (startChar > 1 || (endChar !== undefined && endChar > 0)) {
        raw = raw.slice(startChar - 1, endChar !== undefined && endChar > 0 ? endChar : undefined);
      }
      if (keyDict) raw = raw.replace(/[^a-zA-Z0-9 \t]+/g, "");
      if (!keyFold) return raw;
      let folded = "";
      for (let i = 0; i < raw.length; i++) {
        const code = raw.charCodeAt(i);
        folded += code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : raw[i];
      }
      return folded;
    };
    const parseNum = (s: string): number => {
      const m = /^[ \t]*(-?(?:\d+(?:\.\d*)?|\.\d+))/.exec(s);
      return m ? Number(m[1]!) : 0;
    };
    const compareGenNum = (sa: string, sb: string): number => {
      const parseG = (s: string): { rank: number; value: number } => {
        let start = 0;
        while (start < s.length && (s.charCodeAt(start) === 32 || (s.charCodeAt(start) >= 9 && s.charCodeAt(start) <= 13))) start++;
        const text = s.slice(start);
        const lower = text.toLowerCase();
        const unsigned = lower[0] === "+" || lower[0] === "-" ? lower.slice(1) : lower;
        if (unsigned.startsWith("nan")) return { rank: 1, value: 0 };
        if (unsigned.startsWith("inf")) return { rank: 2, value: lower[0] === "-" ? -Infinity : Infinity };
        if (unsigned.startsWith("0x")) {
          let offset = 2, value = 0, scale = 1, fractional = false, digits = 0;
          while (offset < unsigned.length) {
            const character = unsigned[offset]!;
            if (character === "." && !fractional) { fractional = true; offset++; continue; }
            const digit = "0123456789abcdef".indexOf(character);
            if (digit < 0) break;
            digits++;
            if (fractional) { scale /= 16; value += digit * scale; }
            else value = value * 16 + digit;
            offset++;
          }
          if (digits) {
            if (unsigned[offset] === "p") {
              const exponent = Number.parseInt(unsigned.slice(offset + 1), 10);
              if (!Number.isNaN(exponent) && value !== 0) value *= 2 ** exponent;
            }
            return { rank: 2, value: lower[0] === "-" ? -value : value };
          }
        }
        const value = Number.parseFloat(text);
        return { rank: Number.isNaN(value) ? 0 : 2, value: Number.isNaN(value) ? 0 : value };
      };
      const ga = parseG(sa), gb = parseG(sb);
      return ga.rank - gb.rank || (ga.value < gb.value ? -1 : ga.value > gb.value ? 1 : 0);
    };
    const compareHuman = (sa: string, sb: string): number => {
      const parseH = (s: string): { sign: number; unit: number; val: number } => {
        const m = /^[ \t]*(-?(?:\d+(?:\.\d*)?|\.\d+))([kKMGTPEZYRQ])?/.exec(s);
        if (!m) return { sign: 0, unit: 0, val: 0 };
        const val = Number(m[1]!);
        if (val === 0) return { sign: 0, unit: 0, val: 0 };
        const uChar = m[2] === "k" ? "K" : m[2] ?? "";
        const unit = uChar === "" ? 0 : "KMGTPEZYRQ".indexOf(uChar) + 1;
        return { sign: val < 0 ? -1 : 1, unit, val };
      };
      const ha = parseH(sa);
      const hb = parseH(sb);
      if (ha.sign !== hb.sign) return ha.sign - hb.sign;
      if (ha.unit !== hb.unit) return ha.sign < 0 ? hb.unit - ha.unit : ha.unit - hb.unit;
      return ha.val - hb.val;
    };
    const parseMonth = (s: string): number => {
      const m = /^[ \t]*([a-zA-Z]{3})/.exec(s);
      if (!m) return 0;
      const idx = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].indexOf(m[1]!.toUpperCase());
      return idx === -1 ? 0 : idx + 1;
    };
    const encoded = new Map<string, Uint8Array>();
    const bytesOf = (line: string): Uint8Array => {
      let bytes = encoded.get(line);
      if (bytes === undefined) {
        bytes = fastSharedTextEncoder.encode(line);
        encoded.set(line, bytes);
      }
      return bytes;
    };
    const compareBytes = (left: string, right: string): number => {
      const a = bytesOf(left);
      const b = bytesOf(right);
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] !== b[i]) return a[i]! - b[i]!;
      }
      return a.length - b.length;
    };
    const extraCompares: Array<(a: string, b: string) => number> = [];
    for (let ki = 1; ki < keySpecs.length; ki++) {
      const ks = keySpecs[ki]!;
      const km = /^([1-9][0-9]{0,2})(?:,([1-9][0-9]{0,2}))?([nrbfgVhMd]*)$/.exec(ks);
      if (!km) return undefined;
      const sf = Number(km[1]!);
      const ef = km[2] !== undefined ? Number(km[2]!) : undefined;
      if (ef !== undefined && ef < sf) return undefined;
      const kf = km[3] ?? "";
      const kNum = kf.length > 0 ? kf.includes("n") : num;
      const kGen = kf.length > 0 ? kf.includes("g") : genNum;
      const kHum = kf.length > 0 ? kf.includes("h") : human;
      const kMon = kf.length > 0 ? kf.includes("M") : month;
      const kDic = kf.length > 0 ? kf.includes("d") : dict;
      const kRev = kf.length > 0 ? kf.includes("r") : rev;
      const kFld = kf.length > 0 ? kf.includes("f") : fold;
      const kBlk = kf.length > 0 ? kf.includes("b") : blanks;
      if (Number(kNum) + Number(kGen) + Number(kHum) + Number(kMon) > 1 || (kDic && (kNum || kGen || kHum || kMon))) return undefined;
      const extK = (l: string): string => {
        let raw = sep !== undefined
          ? l.split(sep).slice(sf - 1, ef).join(sep)
          : (() => {
              let offset = 0, start = l.length, end = l.length;
              for (let field = 1; offset < l.length; field++) {
                if (field === sf) start = offset;
                while (l[offset] === " " || l[offset] === "\t") offset++;
                while (offset < l.length && l[offset] !== " " && l[offset] !== "\t") offset++;
                if (field === ef) { end = offset; break; }
              }
              return l.slice(start, end);
            })();
        if (kBlk) raw = raw.replace(/^[ \t]+/, "");
        if (kDic) raw = raw.replace(/[^a-zA-Z0-9 \t]+/g, "");
        if (!kFld) return raw;
        return raw.toUpperCase();
      };
      extraCompares.push((a: string, b: string): number => {
        const ka = extK(a), kb = extK(b);
        if (kHum) { const hc = compareHuman(ka, kb); return hc !== 0 ? (kRev ? -hc : hc) : 0; }
        if (kGen) { const gc = compareGenNum(ka, kb); return gc !== 0 ? (kRev ? -gc : gc) : 0; }
        if (kMon) { const ma = parseMonth(ka), mb = parseMonth(kb); return ma !== mb ? (kRev ? mb - ma : ma - mb) : 0; }
        if (kNum) { const na = parseNum(ka), nb = parseNum(kb); return na !== nb ? (kRev ? nb - na : na - nb) : 0; }
        if (ka !== kb) { const c = compareBytes(ka, kb); return kRev ? -c : c; }
        return 0;
      });
    }
    const compareKeys = (a: string, b: string): number => {
      const ka = extractKey(a);
      const kb = extractKey(b);
      if (keyHuman) {
        const hc = compareHuman(ka, kb);
        if (hc !== 0) return keyRev ? -hc : hc;
      } else if (keyGenNum) {
        const gc = compareGenNum(ka, kb);
        if (gc !== 0) return keyRev ? -gc : gc;
      } else if (keyMonth) {
        const ma = parseMonth(ka);
        const mb = parseMonth(kb);
        if (ma !== mb) return keyRev ? mb - ma : ma - mb;
      } else if (keyNum) {
        const na = parseNum(ka);
        const nb = parseNum(kb);
        if (na !== nb) return keyRev ? nb - na : na - nb;
      } else if (keyVer) {
        const vc = this.compareSyncVersion(ka, kb);
        if (vc !== 0) return keyRev ? -vc : vc;
      } else if (ka !== kb) {
        const comparison = compareBytes(ka, kb);
        return keyRev ? -comparison : comparison;
      }
      for (let ki = 0; ki < extraCompares.length; ki++) {
        const ec = extraCompares[ki]!(a, b);
        if (ec !== 0) return ec;
      }
      return 0;
    };
    const sorted = [...rawLines].sort((a, b) => {
      const kc = compareKeys(a, b);
      if (kc !== 0) return kc;
      if (uniq || stable) return 0;
      const comparison = compareBytes(a, b);
      return rev ? -comparison : comparison;
    });
    if (!uniq) return sorted;
    const dedup: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i === 0 || compareKeys(sorted[i]!, sorted[i - 1]!) !== 0) {
        dedup.push(sorted[i]!);
      }
    }
    return dedup;
  }
,
  evalSyncUniq(this: any, rawLines: readonly string[], opArgs: readonly string[], isByteLocale = false, allowZero = false): string[] | undefined {
    let ignoreCase = false;
    let hasCount = false;
    let onlyRepeated = false;
    let allRepeated: "none" | "prepend" | "separate" | undefined;
    let groupMode: "separate" | "prepend" | "append" | "both" | undefined;
    let onlyUnique = false;
    let skipFields = 0;
    let skipChars = 0;
    let checkChars = Infinity;
    const applyShortUniqFlags = (flags: string): boolean => {
      for (let k = 0; k < flags.length; k++) {
        const ch = flags[k]!;
        if (ch === "z") { if (!allowZero) return false; }
        else if (ch === "i") ignoreCase = true;
        else if (ch === "c") hasCount = true;
        else if (ch === "d") onlyRepeated = true;
        else if (ch === "D") { onlyRepeated = true; allRepeated = "none"; }
        else if (ch === "u") onlyUnique = true;
        else return false;
      }
      return true;
    };
    for (let i = 0; i < opArgs.length; i++) {
      const a = opArgs[i]!;
      if (a === "--ignore-case") ignoreCase = true;
      else if (a === "--count") hasCount = true;
      else if (a === "--repeated") onlyRepeated = true;
      else if (a === "--zero-terminated") { if (!allowZero) return undefined; }
      else if (a === "-D" || a === "--all-repeated" || a === "--all-repeated=none") { onlyRepeated = true; allRepeated = "none"; }
      else if (a === "--all-repeated=prepend") { onlyRepeated = true; allRepeated = "prepend"; }
      else if (a === "--all-repeated=separate") { onlyRepeated = true; allRepeated = "separate"; }
      else if (a === "--group" || a === "--group=separate") groupMode = "separate";
      else if (a === "--group=prepend") groupMode = "prepend";
      else if (a === "--group=append") groupMode = "append";
      else if (a === "--group=both") groupMode = "both";
      else if (a === "--unique") onlyUnique = true;
      else if (/^--skip-fields=[0-9]{1,4}$/.test(a)) skipFields = Number(a.slice(14));
      else if (/^--skip-chars=[0-9]{1,4}$/.test(a)) skipChars = Number(a.slice(13));
      else if (/^--check-chars=[0-9]{1,4}$/.test(a)) checkChars = Number(a.slice(14));
      else if ((a === "-f" || a === "--skip-fields" || a === "-s" || a === "--skip-chars" || a === "-w" || a === "--check-chars") && i + 1 < opArgs.length && /^[0-9]{1,4}$/.test(opArgs[i + 1]!)) {
        const n = Number(opArgs[++i]!);
        if (a === "-f" || a === "--skip-fields") skipFields = n;
        else if (a === "-s" || a === "--skip-chars") skipChars = n;
        else checkChars = n;
      } else if (/^-[cduiDz]*[fsw][0-9]{1,4}$/.test(a)) {
        const m = /^-([cduiDz]*)([fsw])([0-9]{1,4})$/.exec(a)!;
        if (!applyShortUniqFlags(m[1]!)) return undefined;
        const n = Number(m[3]!);
        if (m[2] === "f") skipFields = n;
        else if (m[2] === "s") skipChars = n;
        else checkChars = n;
      } else if (/^-[cduiDz]+[fsw]$/.test(a) && i + 1 < opArgs.length && /^[0-9]{1,4}$/.test(opArgs[i + 1]!)) {
        const pfx = a.slice(1, -1);
        const fch = a[a.length - 1]!;
        if (!applyShortUniqFlags(pfx)) return undefined;
        const n = Number(opArgs[++i]!);
        if (fch === "f") skipFields = n;
        else if (fch === "s") skipChars = n;
        else checkChars = n;
      } else if (/^-[cduiDz]+$/.test(a)) {
        if (!applyShortUniqFlags(a.slice(1))) return undefined;
      } else {
        return undefined;
      }
    }
    if (isByteLocale && (skipChars !== 0 || checkChars !== Infinity) && rawLines.some(line => {
      for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) > 127) return true;
      return false;
    })) return undefined;
    const foldAscii = (value: string): string => {
      let folded = "";
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        folded += code >= 97 && code <= 122 ? String.fromCharCode(code - 32) : value[i]!;
      }
      return folded;
    };
    const keyOf = (l: string): string => {
      let offset = 0;
      for (let f = 0; f < skipFields; f++) {
        while (offset < l.length && (l[offset] === " " || l[offset] === "\t")) offset++;
        while (offset < l.length && l[offset] !== " " && l[offset] !== "\t") offset++;
      }
      if (skipChars === 0 && checkChars === Infinity) {
        const sub = l.slice(offset);
        return ignoreCase ? foldAscii(sub) : sub;
      }
      const chars = Array.from(l.slice(offset));
      const sub = (checkChars === Infinity ? chars.slice(skipChars) : chars.slice(skipChars, skipChars + checkChars)).join("");
      return ignoreCase ? foldAscii(sub) : sub;
    };
    const outLines: string[] = [];
    let uIdx = 0;
    while (uIdx < rawLines.length) {
      const k0 = keyOf(rawLines[uIdx]!);
      let uEnd = uIdx + 1;
      while (uEnd < rawLines.length && keyOf(rawLines[uEnd]!) === k0) uEnd++;
      if (allRepeated !== undefined && (hasCount || onlyUnique)) return undefined;
      if (groupMode !== undefined && (hasCount || onlyRepeated || onlyUnique || allRepeated !== undefined)) return undefined;
      const count = uEnd - uIdx;
      if (groupMode !== undefined) {
        if (groupMode === "prepend" || (groupMode === "both" && uIdx === 0) || ((groupMode === "separate" || groupMode === "both") && outLines.length > 0)) {
          outLines.push("");
        }
        for (let ri = uIdx; ri < uEnd; ri++) outLines.push(rawLines[ri]!);
        if (groupMode === "append" || (groupMode === "both" && uEnd === rawLines.length)) {
          outLines.push("");
        }
      } else if (allRepeated !== undefined) {
        if (count > 1) {
          if (allRepeated === "prepend" || (allRepeated === "separate" && outLines.length > 0)) outLines.push("");
          for (let ri = uIdx; ri < uEnd; ri++) outLines.push(rawLines[ri]!);
        }
      } else if ((!onlyRepeated || count > 1) && (!onlyUnique || count === 1)) {
        outLines.push(hasCount ? `${String(count).padStart(7, " ")} ${rawLines[uIdx]!}` : rawLines[uIdx]!);
      }
      uIdx = uEnd;
    }
    return outLines;
  }
,
  sortSyncLines(this: any, rawLines: readonly string[], flag: string | undefined): string[] {
    return this.evalSyncSort(rawLines, flag !== undefined ? [flag] : [], false) ?? [...rawLines];
  }
,
  syncBase64Encode(this: any, bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!);
    const raw = globalThis.btoa(bin);
    if (raw.length <= 76) return raw;
    const chunks: string[] = [];
    for (let i = 0; i < raw.length; i += 76) chunks.push(raw.slice(i, i + 76));
    return chunks.join("\n");
  },
  syncBase64DecodeBytes(this: any, b64: string): Uint8Array {
    const clean = b64.replace(/\s+/g, "");
    const bin = globalThis.atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  },
};

Object.assign(Runtime.prototype, syncExtraRuntimeMethods);
