import { parseZipDate, zipDateMatches } from "./zip/dates.js";
import { zipEnvironmentArguments } from "./zip/environment.js";
import { readZipComment } from "./zip/comments.js";
import { collectBytes, dirname, getCommandArguments, writeBytes, type CommandDefinition, type FileStat } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { createOutputOperation } from "../../contracts/output.js";
import { yieldTurn } from "../../contracts/yield.js";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { escapeText } from "../../escaping.js";
import { Budget, checkPath, display, fail, hasIdentity, sameIdentity, settings, text, vfsPath, type ArchiveCommandsOptions, type ArchiveLimits } from "./internal.js";
import { decodeZipEntry, makeZipEntry, readZipArchive, writeZipArchive, streamZipArchive, updateZipExtras, type ZipArchive, type ZipEntry } from "./zip-format.js";
import { publishZip, ZipScope, type ZipPublication } from "./zip/safety.js";
import { Selection } from "./unzip/arguments.js";
import { normalizeZipOption, ZipFailure } from "./zip/options.js";

interface ZipOptions {
  readonly args: readonly string[];
  readonly action: "add" | "delete" | "update" | "freshen" | "copy";
  readonly archive: string;
  readonly output: string | undefined;
  readonly recursive: boolean;
  readonly recursivePatterns: boolean;
  readonly noWild: boolean;
  readonly stopAtDirectories: boolean;
  readonly quiet: boolean;
  readonly junkPaths: boolean;
  readonly omitDirectories: boolean;
  readonly storeLinks: boolean;
  readonly test: boolean;
  readonly mustMatch: boolean;
  readonly filesync: boolean;
  readonly archiveComment: boolean;
  readonly fromDate: number | undefined;
  readonly beforeDate: number | undefined;
  readonly descriptors: boolean;
  readonly zip64: boolean | undefined;
  readonly metadata: "default" | "strip" | "all";
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly level: number;
  readonly method: "store" | "deflate";
  readonly suffixes: readonly string[];
  readonly operands: readonly string[];
  readonly firstOperand: number;
}

const defaultStoreSuffixes = [".Z", ".zip", ".zoo", ".arc", ".lzh", ".arj"];

async function parse(scope: ZipScope, limits: ArchiveLimits): Promise<ZipOptions> {
  const context = scope.context;
  const args = zipEnvironmentArguments(context.env, context.args, limits);
  if (args.length > limits.maxArgumentBytes) fail("argument count limit exceeded");
  let bytes = 0;
  for (const argument of args) {
    const size = Buffer.byteLength(argument);
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
    for (const value of argumentsValue.values) text(shellValueBytes(value));
  }
  let archive: string | undefined;
  let output: string | undefined;
  let action: ZipOptions["action"] = "add";
  let recursive = false;
  let recursivePatterns = false;
  let noWild = false;
  let stopAtDirectories = false;
  let quiet = false;
  let junkPaths = false;
  let omitDirectories = false;
  let storeLinks = false;
  let test = false;
  let mustMatch = false;
  let filesync = false;
  let archiveComment = false;
  let fromDate: number | undefined;
  let beforeDate: number | undefined;
  let descriptors = false;
  let zip64: boolean | undefined;
  let metadata: ZipOptions["metadata"] = "default";
  let level = 6;
  let method: ZipOptions["method"] = "deflate";
  let suffixes: readonly string[] = defaultStoreSuffixes;
  let stdinNames = false;
  let literal = false;
  let firstOperand = -1;
  const operands: string[] = [];
  const includes: string[] = [];
  const excludes: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const original = args[index]!;
    checkPath(original, limits);
    const argument = literal ? original : normalizeZipOption(original);
    if (!literal && argument === "--") {
      if (archive === undefined) throw new ZipFailure(16, "Invalid command arguments", "can't use -- before archive name");
      literal = true;
    } else if (!literal && argument.startsWith("-") && argument !== "-") {
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset];
        if (flag === "r" || flag === "R") {
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
            const matches = ["store", "deflate", "bzip2"].filter(name => name.startsWith(value.toLowerCase()));
            const selected = matches.length === 1 ? matches[0] : undefined;
            if (!selected) throw new ZipFailure(16, "Invalid command arguments", "Option -Z (--compression-method):  unknown method");
            if (selected === "bzip2") throw new ZipFailure(19, "Not supported", "Compression method bzip2 not enabled");
            method = selected === "store" ? "store" : "deflate";
          }
          break;
        }
        else if (flag === "i" || flag === "x") {
          const patterns = flag === "i" ? includes : excludes;
          const before = patterns.length;
          const append = (pattern: string) => {
            if (pattern) checkPath(pattern, limits);
            if (includes.length + excludes.length >= limits.maxMembers) fail("pattern count limit exceeded");
            patterns.push(pattern);
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
        else throw new ZipFailure(16, "Invalid command arguments", `unsupported option: ${argument}`);
      }
    } else if (archive === undefined) archive = argument;
    else {
      if (operands.length >= limits.maxMembers) fail("operand limit exceeded");
      if (firstOperand < 0) firstOperand = index;
      operands.push(argument);
    }
  }
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
  if (action === "copy" && output === undefined) throw new ZipFailure(16, "Invalid command arguments", "-U (--copy) requires -O (--out)");
  const names: string[] = [];
  if (stdinNames) {
    const input = await collectBytes(scope.stdin, { maxBytes: limits.maxFilesFromBytes, signal: context.signal });
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
  if (filesync && action !== "add") throw new ZipFailure(16, "Invalid command arguments", "can't use -d, -f, -u, -U, or -g with filesync -FS\n");
  return { args, action, archive, output, recursive, recursivePatterns, noWild, stopAtDirectories, quiet, junkPaths, omitDirectories, storeLinks, test, mustMatch, filesync, archiveComment, fromDate, beforeDate, descriptors, zip64, metadata, includes, excludes, level, method, suffixes, operands: [...names, ...operands], firstOperand };
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

function unchanged(before: FileStat, after: FileStat): boolean {
  return before.type === after.type && before.size === after.size && before.mode === after.mode
    && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
    && before.nlink === after.nlink && (!hasIdentity(before) || sameIdentity(before, after));
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

async function prepare(scope: ZipScope, parsed: ZipOptions, budget: Budget) {
  const context = scope.context;
  const limits = budget.limits;
  if (parsed.archive === "-" && parsed.action !== "add") throw new ZipFailure(16, "Invalid command arguments", "can't use -d, -f, -u, -U, or -g on stdout\n");
  let publication: Omit<ZipPublication, "bytes"> | undefined;
  if (parsed.archive !== "-") {
    const outputName = vfsPath(context.cwd, parsed.output ?? parsed.archive);
    const parentName = dirname(outputName);
    const parent = await scope.operation(() => context.fs.realpath(parentName, { signal: context.signal }));
    const parentStat = await scope.operation(() => context.fs.lstat(parent, { signal: context.signal }));
    const output = `${parent === "/" ? "" : parent}/${outputName.slice(outputName.lastIndexOf("/") + 1)}`;
    checkPath(output, limits);
    const existing = await scope.stat(output);
    publication = { output, parentName, parent, parentStat, existing };
  }
  const output = publication?.output;
  let input = publication?.output;
  let existing = publication?.existing;
  if (parsed.output !== undefined) {
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
  if ((parsed.action === "copy" || parsed.output !== undefined && parsed.archive !== "-") && !existing) throw new ZipFailure(18, "File not found or no read permission", parsed.archive);
  if (publication?.existing && (publication.existing.type !== "file" || !hasIdentity(publication.existing) || publication.existing.nlink !== 1)) fail("output archive requires a regular, single-link file with known backing identity");
  if (parsed.archive === "-" && parsed.test && !parsed.quiet) await budget.output("\tzip warning: can't use -T on stdout, -T ignored\n");
  if (existing && (existing.type !== "file" || !hasIdentity(existing) || existing.nlink !== 1)) fail("updating archive requires a regular, single-link file with known backing identity; archive aliases are unsupported");
  let archive: ZipArchive = { entries: [], comment: new Uint8Array() };
  if (existing && input) {
    if (!Number.isSafeInteger(existing.size) || existing.size < 0 || existing.size > limits.maxArchiveBytes) fail("archive byte limit exceeded");
    const bytes = await collectBytes(scope.input(input), { maxBytes: limits.maxArchiveBytes, signal: context.signal });
    if (bytes.length !== existing.size) fail("archive changed while reading");
    archive = await readZipArchive(bytes, limits, context.signal);
    const current = await scope.stat(input);
    if (!current || !unchanged(existing, current)) fail("archive changed while reading");
  }
  const old = new Map(archive.entries.map(entry => [entry.name, entry]));
  if (!archive.entries.length && !parsed.quiet && (parsed.action === "update" || parsed.action === "freshen")) await budget.output(`\tzip warning: ${parsed.archive} not found or empty\n`);
  const selected = new Map<string, { entry: ZipEntry; source: string }>();
  const deleted = new Set<string>();
  const synchronized = new Map<string, string>();
  const selection = new Selection([...parsed.includes, ...parsed.excludes], limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories });
  const recursiveSelection = parsed.recursivePatterns ? new Selection(parsed.operands, limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories, trailingComponents: true }) : undefined;
  let archiveOperandMatches: Set<string> | undefined;
  const ancestors: { path: string; stat: FileStat }[] = [];
  let visits = 0;
  let work = 0;
  let compressedBytes = 0;
  const encodeSelected = async (source: string, name: string, bytes: Uint8Array, attributes: Pick<ZipEntry, "modified" | "mode" | "directory" | "symlink">) => {
    const store = parsed.method === "store" || parsed.level !== 9 && parsed.suffixes.some(suffix => name.endsWith(suffix));
    if (!store && parsed.level === 0 && bytes.length && !attributes.directory && !attributes.symlink) throw new ZipFailure(5, "Internal logic error", "bad pack level");
    const level = store ? 0 : parsed.level;
    let entry = await makeZipEntry(name, bytes, attributes, limits, context.signal, level, !store && (parsed.archive === "-" || parsed.descriptors && bytes.length > 0));
    if (parsed.descriptors) entry.descriptors = true;
    if (parsed.zip64 === true || parsed.zip64 === undefined && source === "-") entry.zip64 = true;
    const prior = old.get(name);
    if (prior?.comment) entry = { ...entry, comment: prior.comment };
    if (parsed.metadata !== "default") entry = updateZipExtras(entry, prior, parsed.metadata, limits);
    if (entry.data.length > limits.maxArchiveBytes - compressedBytes) fail("archive byte limit exceeded");
    compressedBytes += entry.data.length;
    selected.set(name, { entry, source });
  };
  const visit = async (source: string, name: string, depth: number): Promise<void> => {
    context.signal.throwIfAborted();
    if (++visits > limits.maxMembers) fail("traversal member limit exceeded");
    if (++work > limits.maxPatternSteps) fail("archive work limit exceeded");
    if (visits % 128 === 0) await yieldTurn(context.signal);
    if (depth > limits.maxDepth) fail("archive recursion depth limit exceeded");
    if (source === "-") {
      const previous = selected.get(name);
      if (previous && previous.source !== source) throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
      if (previous || !await filterName(name, selection, parsed.includes.length)) return;
      const prior = old.get(name);
      const modified = new Date();
      if (!zipDateMatches(modified, parsed.fromDate, parsed.beforeDate)) return;
      if (parsed.filesync) {
        if (synchronized.has(name) && synchronized.get(name) !== source) throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
        synchronized.set(name, source);
      }
      if (parsed.action === "freshen" && !prior || prior && (parsed.action === "update" || parsed.action === "freshen") && Math.floor(modified.getTime() / 1000) <= Math.floor(prior.modified.getTime() / 1000)) return;
      const bytes = await collectBytes(scope.stdin, { maxBytes: Math.min(limits.maxEntryBytes, limits.maxTotalBytes - budget.totalBytes), signal: context.signal });
      await budget.member(bytes.length);
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
      if (parsed.mustMatch && !old.has(name)) {
        if (!archiveOperandMatches) {
          const fallback = new Selection(parsed.operands.map(operand => {
            const pattern = memberName(operand, limits);
            return parsed.junkPaths ? pattern.slice(pattern.lastIndexOf("/") + 1) : pattern;
          }), limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories });
          for (const entry of archive.entries) await fallback.matches(entry.name);
          archiveOperandMatches = new Set([...fallback.matched].map(index => parsed.operands[index]!));
        }
        if (archiveOperandMatches.has(source)) return;
        if (!parsed.quiet) await budget.output(`\tzip warning: name not matched: ${source}\n`);
        throw new ZipFailure(18, "File not found or no read permission", source);
      }
      if (!parsed.quiet && !old.has(name)) await budget.output(`\tzip warning: name not matched: ${source}\n`);
      return;
    }
    checkPath(canonical, limits);
    if (canonical === output || canonical === input || (existing && sameIdentity(existing, stat)) || (publication?.existing && sameIdentity(publication.existing, stat))) return;
    const symlink = parsed.storeLinks && stat.type === "symlink";
    if (stat.type !== "file" && stat.type !== "directory" && !symlink) {
      if (!parsed.quiet) await budget.output(`\tzip warning: ignoring special file: ${source}\n`);
      return;
    }
    if ((existing || publication?.existing) && !hasIdentity(stat)) fail("cannot exclude archive aliases when source backing identity is unknown");
    const directory = stat.type === "directory";
    if (directory && name && !name.endsWith("/")) name += "/";
    const included = zipDateMatches(new Date(stat.mtimeMs), parsed.fromDate, parsed.beforeDate) && await filterName(name, selection, parsed.includes.length) && (!recursiveSelection || await recursiveSelection.matches(name, true));
    const sourceName = name;
    if (parsed.junkPaths) name = directory ? "" : name.slice(name.lastIndexOf("/") + 1);
    const prior = old.get(name);
    if (parsed.filesync && name && included && !(directory && parsed.omitDirectories)) {
      if (synchronized.has(name) && synchronized.get(name) !== source) throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
      synchronized.set(name, source);
    }
    const current = parsed.filesync && prior && prior.size === (directory ? 0 : stat.size)
      && Math.ceil(Math.floor(stat.mtimeMs / 1000) / 2) === Math.ceil(Math.floor(prior.modified.getTime() / 1000) / 2);
    const eligible = parsed.action !== "update" && parsed.action !== "freshen"
      || (prior ? Math.floor(stat.mtimeMs / 1000) > Math.floor(prior.modified.getTime() / 1000) : parsed.action === "update");
    if (name && included && eligible && !current && !(directory && parsed.omitDirectories)) {
      checkPath(name, limits);
      const previous = selected.get(name);
      if (previous && previous.source !== source) {
        if (!parsed.quiet) await budget.output(`\tzip warning:   first full name: ${previous.source}\n                      second full name: ${source}\n                     name in zip file repeated: ${name}\n`);
        throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
      }
      if (!previous) {
        await budget.member(directory ? 0 : stat.size);
        let bytes: Uint8Array;
        if (directory) bytes = new Uint8Array();
        else if (symlink) {
          if (!context.fs.readlink) fail("filesystem does not support reading symbolic links");
          const target = await scope.operation(() => context.fs.readlink!(path, { signal: context.signal }));
          if (Buffer.byteLength(target) > stat.size) fail(`source changed while reading: ${source}`);
          bytes = Buffer.from(target);
        } else {
          try { bytes = await collectBytes(scope.input(path), { maxBytes: stat.size, signal: context.signal }); }
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
    if (directory && (parsed.recursive || parsed.recursivePatterns)) {
      if (ancestors.some(ancestor => ancestor.path === canonical || sameIdentity(ancestor.stat, stat))) fail(`directory cycle while archiving: ${source}`);
      ancestors.push({ path: canonical, stat });
      try {
        const children = await scope.operation(() => context.fs.readdir(path, { signal: context.signal, maxEntries: limits.maxMembers - visits }));
        if (children.length > limits.maxMembers - visits) fail("traversal member limit exceeded");
        for (const child of children) {
          if (!child.name || child.name === "." || child.name === ".." || child.name.includes("/") || child.name.includes("\0")) fail("invalid filesystem directory entry");
          const prefix = source === "." ? "" : source.endsWith("/") ? source : `${source}/`;
          await visit(`${prefix}${child.name}`, `${sourceName}${child.name}`, depth + 1);
        }
      } finally { ancestors.pop(); }
    }
  };
  const editComment = parsed.archiveComment && parsed.action !== "delete" && parsed.action !== "copy";
  if (parsed.archiveComment && parsed.action === "copy" && !parsed.quiet) await budget.output("\tzip warning: can't set method, move, recurse, or comments with copy mode.\n");
  if (parsed.action === "copy") {
    const operands = new Selection(parsed.operands, limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories });
    for (const entry of archive.entries) {
      if (await operands.matches(entry.name) && await filterName(entry.name, selection, parsed.includes.length) && zipDateMatches(entry.modified, parsed.fromDate, parsed.beforeDate)) {
        await budget.member(entry.size);
        selected.set(entry.name, { entry, source: entry.name });
      }
    }
  } else if (parsed.action === "delete") {
    if (!parsed.quiet && (parsed.recursive || parsed.archiveComment)) await budget.output("\tzip warning: invalid option(s) used with -d; ignored.\n");
    if (!parsed.quiet && !archive.entries.length) await budget.output(`\tzip warning: ${parsed.archive} not found or empty\n`);
    const operands = new Selection(parsed.recursivePatterns ? [] : parsed.operands, limits, context.signal, { noWild: parsed.noWild, stopAtDirectories: parsed.stopAtDirectories });
    if (parsed.operands.length && !parsed.recursivePatterns) {
      for (const entry of archive.entries) {
        if (await operands.matches(entry.name) && await filterName(entry.name, selection, parsed.includes.length) && zipDateMatches(entry.modified, parsed.fromDate, parsed.beforeDate)) deleted.add(entry.name);
      }
    }
    if (parsed.mustMatch && !parsed.recursivePatterns) {
      for (const [index, operand] of parsed.operands.entries()) {
        if (!operands.matched.has(index)) throw new ZipFailure(18, "File not found or no read permission", operand);
      }
    }
    if (!parsed.quiet) {
      for (const [index, operand] of parsed.operands.entries()) {
        if (!operands.matched.has(index)) await budget.output(`\tzip warning: name not matched: ${operand}\n`);
      }
    }
  } else {
    const operands = parsed.operands.length || parsed.action === "add" ? parsed.operands : archive.entries.map(entry => entry.name);
    if (parsed.recursivePatterns) await visit(".", "", 0);
    else for (const operand of operands) await visit(operand, memberName(operand, limits), 0);
  }
  if (parsed.filesync) {
    if (!synchronized.size) throw new ZipFailure(12, "Nothing to do!", parsed.archive);
    for (const entry of archive.entries) if (!synchronized.has(entry.name)) deleted.add(entry.name);
    if (!selected.size && !deleted.size) {
      if (!parsed.quiet) await budget.output("Archive is current\n");
      return { kind: "current" as const };
    }
  }
  if (!selected.size && !(editComment && archive.entries.length) && (parsed.action === "freshen" || parsed.action === "update" && (existing || !parsed.includes.length))) return undefined;
  if (!selected.size && !deleted.size && !(editComment && archive.entries.length) && (parsed.action === "delete" || parsed.action === "copy" || parsed.recursivePatterns || parsed.fromDate !== undefined || parsed.beforeDate !== undefined || !parsed.includes.length)) {
    const detail = parsed.action !== "delete" && parsed.recursive && parsed.firstOperand >= 0
      ? `try: zip ${parsed.args.slice(0, parsed.firstOperand).join(" ")} . -i ${parsed.args.slice(parsed.firstOperand).join(" ")}`
      : parsed.archive;
    throw new ZipFailure(12, "Nothing to do!", detail);
  }
  const entries: ZipEntry[] = [];
  const progress: string[] = [];
  let progressBytes = 0;
  const queue = (message: string) => {
    if (parsed.quiet) return;
    const size = Buffer.byteLength(message);
    if (size > limits.maxTextBytes - budget.textBytes - progressBytes) fail("text output limit exceeded");
    progressBytes += size;
    progress.push(message);
  };
  const append = (entry: ZipEntry, update: boolean) => {
    const percentage = entry.size ? Math.trunc((Math.trunc(200 * (entry.size - entry.data.length) / entry.size) + 1) / 2) : 0;
    queue(`${update ? parsed.action === "freshen" ? "freshening:" : "updating:" : "  adding:"} ${entry.name} (${entry.method === 8 ? `deflated ${percentage}%` : "stored 0%"})\n`);
  };
  for (const entry of archive.entries) {
    if (++work > limits.maxPatternSteps) fail("archive work limit exceeded");
    if (deleted.has(entry.name)) { queue(`deleting: ${entry.name}\n`); continue; }
    const replacement = selected.get(entry.name);
    if (parsed.action === "copy") {
      if (replacement) { entries.push(replacement.entry); queue(` copying: ${entry.name}\n`); selected.delete(entry.name); }
      continue;
    }
    if (replacement) { entries.push(replacement.entry); append(replacement.entry, true); selected.delete(entry.name); }
    else { await budget.member(entry.size); entries.push(entry); }
  }
  for (const { entry } of selected.values()) { entries.push(entry); append(entry, false); }
  if (!entries.length) queue("\tzip warning: zip file empty\n");
  let comment = archive.comment;
  if (editComment) {
    for (const message of progress) await budget.output(message);
    progress.length = 0;
    progressBytes = 0;
    if (!parsed.quiet) {
      if (comment.length) {
        await budget.output("current zip file comment is:\n");
        await budget.output(comment);
        if (comment.at(-1) !== 10) await budget.output("\n");
      }
      await budget.output("enter new zip file comment (end with .):\n");
    }
    comment = await readZipComment(scope.stdin, limits, context.signal);
  }
  if (!publication) return { kind: "stream" as const, archive: { entries, comment }, progress };
  const bytes = await writeZipArchive({ entries, comment }, limits, context.signal, false, parsed.zip64 === true);
  if (parsed.test && parsed.archive !== "-") {
    for (const message of progress) await budget.output(message);
    progress.length = 0;
    progressBytes = 0;
    try {
      const tested = await readZipArchive(bytes, limits, context.signal);
      if (!tested.entries.length) fail("empty ZIP archive");
      let decoded = 0;
      for (const entry of tested.entries) {
        for await (const chunk of decodeZipEntry(entry, limits, context.signal)) {
          if (chunk.length > limits.maxTotalBytes - decoded) fail("actual decompressed byte limit exceeded");
          decoded += chunk.length;
        }
      }
    } catch {
      context.signal.throwIfAborted();
      if (!parsed.quiet) await budget.output(`test of ${parsed.archive} FAILED\n`);
      throw new ZipFailure(8, "Zip file invalid, could not spawn unzip, or wrong unzip", "original files unmodified");
    }
    if (!parsed.quiet) {
      queue(`test of ${parsed.archive} OK\n`);
    }
  }
  return { kind: "file" as const, publication, bytes, progress };
}

export function createZipCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "zip", description: "Create or update bounded ZIP archives in the virtual filesystem", async execute(original) {
    original.signal.throwIfAborted();
    const scope = new ZipScope(original, limits);
    const context = scope.context;
    let budget = new Budget(context, limits);
    try {
      const parsed = await parse(scope, limits);
      if (parsed.archive === "-") budget = new Budget({ ...context, stdout: context.stderr }, limits);
      const prepared = await prepare(scope, parsed, budget);
      if (!prepared) return { exitCode: 12 };
      if (prepared.kind === "current") return { exitCode: 0 };
      if (prepared.kind === "file") {
        const publication = prepared.publication;
        if (!publication) fail("ZIP missing file publication");
        await writeFileOutput(context, prepared.bytes, () => scope.operation(() => publishZip(scope, { ...publication, bytes: prepared.bytes })));
        for (const message of prepared.progress) await budget.output(message);
      } else {
        for (const message of prepared.progress) await budget.output(message);
        const output = createOutputOperation(context, context.stdout);
        try {
          for await (const chunk of streamZipArchive(prepared.archive, limits, output.signal, true, parsed.zip64 === true)) {
            await writeBytes(output.output, chunk, output.signal);
          }
        } finally { await output.close(); }
      }
      return { exitCode: 0 };
    } catch (error) {
      original.signal.throwIfAborted();
      context.signal.throwIfAborted();
      if (error instanceof ZipFailure) {
        await budget.output(`\nzip error: ${error.label} (${error.message})\n`);
        return { exitCode: error.status };
      }
      const message = escapeText(display(publicDiagnosticMessage(error, context.onInternalError).slice(0, 1024)), "diagnostic");
      await writeBytes(context.stderr, Buffer.from(`zip: ${message}\n`).subarray(0, limits.maxDiagnosticBytes), context.signal);
      return { exitCode: 2 };
    } finally {
      try { await scope.close(); }
      finally { original.signal.throwIfAborted(); }
    }
  } };
}
