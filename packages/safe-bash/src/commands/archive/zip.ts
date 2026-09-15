import { collectBytes, dirname, getCommandArguments, writeBytes, type CommandDefinition, type FileStat } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { yieldTurn } from "../../contracts/yield.js";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { escapeText } from "../../escaping.js";
import { Budget, checkPath, display, fail, hasIdentity, sameIdentity, settings, text, vfsPath, type ArchiveCommandsOptions, type ArchiveLimits } from "./internal.js";
import { decodeZipEntry, makeZipEntry, readZipArchive, writeZipArchive, type ZipArchive, type ZipEntry } from "./zip-format.js";
import { publishZip, ZipScope } from "./zip/safety.js";
import { Selection } from "./unzip/arguments.js";

interface ZipOptions {
  readonly action: "add" | "delete";
  readonly archive: string;
  readonly recursive: boolean;
  readonly quiet: boolean;
  readonly junkPaths: boolean;
  readonly omitDirectories: boolean;
  readonly storeLinks: boolean;
  readonly test: boolean;
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
  readonly level: number;
  readonly operands: readonly string[];
  readonly firstOperand: number;
}

class ZipFailure extends Error {
  constructor(readonly status: number, readonly label: string, detail: string) { super(detail); }
}

async function parse(scope: ZipScope, limits: ArchiveLimits): Promise<ZipOptions> {
  const context = scope.context;
  if (context.args.length > limits.maxArgumentBytes) fail("argument count limit exceeded");
  let bytes = 0;
  for (const argument of context.args) {
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
  let action: ZipOptions["action"] = "add";
  let recursive = false;
  let quiet = false;
  let junkPaths = false;
  let omitDirectories = false;
  let storeLinks = false;
  let test = false;
  let level = 6;
  let stdinNames = false;
  let literal = false;
  let firstOperand = -1;
  const operands: string[] = [];
  const includes: string[] = [];
  const excludes: string[] = [];
  for (let index = 0; index < context.args.length; index++) {
    const argument = context.args[index]!;
    checkPath(argument, limits);
    if (!literal && argument === "--") {
      if (archive === undefined) throw new ZipFailure(16, "Invalid command arguments", "can't use -- before archive name");
      literal = true;
    } else if (!literal && argument.startsWith("-") && argument !== "-") {
      for (let offset = 1; offset < argument.length; offset++) {
        const flag = argument[offset];
        if (flag === "r") recursive = true;
        else if (flag === "d") action = "delete";
        else if (flag === "q") quiet = true;
        else if (flag === "j") junkPaths = true;
        else if (flag === "D") omitDirectories = true;
        else if (flag === "y") storeLinks = true;
        else if (flag === "T") test = true;
        else if (flag === "@") stdinNames = true;
        else if (flag !== undefined && flag >= "0" && flag <= "9") level = Number(flag);
        else if (flag === "i" || flag === "x") {
          const patterns = flag === "i" ? includes : excludes;
          const before = patterns.length;
          const append = (pattern: string) => {
            checkPath(pattern, limits);
            if (includes.length + excludes.length >= limits.maxMembers) fail("pattern count limit exceeded");
            patterns.push(pattern);
          };
          if (offset + 1 < argument.length) append(argument.slice(offset + 1));
          while (index + 1 < context.args.length) {
            const next = context.args[index + 1]!;
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
  if (archive === undefined) throw new ZipFailure(16, "Invalid command arguments", "expected zip [-r] [-q] [-j] [-@] [-0..-9] ARCHIVE FILES... [-i PATTERNS...] [-x PATTERNS...]");
  if (archive === "-" || operands.includes("-")) throw new ZipFailure(16, "Invalid command arguments", "standard input/output archives are unsupported");
  if (!archive.slice(archive.lastIndexOf("/") + 1).includes(".")) archive += ".zip";
  checkPath(archive, limits);
  const names: string[] = [];
  if (stdinNames) {
    const input = await collectBytes(scope.source(context.stdin), { maxBytes: limits.maxFilesFromBytes, signal: context.signal });
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
  return { action, archive, recursive, quiet, junkPaths, omitDirectories, storeLinks, test, includes, excludes, level, operands: [...names, ...operands], firstOperand };
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
  const outputName = vfsPath(context.cwd, parsed.archive);
  const parentName = dirname(outputName);
  const parent = await scope.operation(() => context.fs.realpath(parentName, { signal: context.signal }));
  const parentStat = await scope.operation(() => context.fs.lstat(parent, { signal: context.signal }));
  const output = `${parent === "/" ? "" : parent}/${outputName.slice(outputName.lastIndexOf("/") + 1)}`;
  checkPath(output, limits);
  const existing = await scope.stat(output);
  if (existing && (existing.type !== "file" || !hasIdentity(existing) || existing.nlink !== 1)) fail("updating archive requires a regular, single-link file with known backing identity; archive aliases are unsupported");
  let archive: ZipArchive = { entries: [], comment: new Uint8Array() };
  if (existing) {
    if (!Number.isSafeInteger(existing.size) || existing.size < 0 || existing.size > limits.maxArchiveBytes) fail("archive byte limit exceeded");
    const bytes = await collectBytes(scope.input(output), { maxBytes: limits.maxArchiveBytes, signal: context.signal });
    if (bytes.length !== existing.size) fail("archive changed while reading");
    archive = await readZipArchive(bytes, limits, context.signal);
    const current = await scope.stat(output);
    if (!current || !unchanged(existing, current)) fail("archive changed while reading");
  }
  const old = new Map(archive.entries.map(entry => [entry.name, entry]));
  const selected = new Map<string, { entry: ZipEntry; source: string }>();
  const deleted = new Set<string>();
  const selection = new Selection([...parsed.includes, ...parsed.excludes], limits, context.signal);
  const ancestors: { path: string; stat: FileStat }[] = [];
  let visits = 0;
  let work = 0;
  let compressedBytes = 0;
  const visit = async (source: string, name: string, depth: number): Promise<void> => {
    context.signal.throwIfAborted();
    if (++visits > limits.maxMembers) fail("traversal member limit exceeded");
    if (++work > limits.maxPatternSteps) fail("archive work limit exceeded");
    if (visits % 128 === 0) await yieldTurn(context.signal);
    if (depth > limits.maxDepth) fail("archive recursion depth limit exceeded");
    const path = vfsPath(context.cwd, source);
    checkPath(path, limits);
    let canonical: string;
    let stat: FileStat;
    try {
      ({ canonical, stat } = await inspectSource(scope, path, parsed.storeLinks));
    } catch (error) {
      context.signal.throwIfAborted();
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
      if (!parsed.quiet && !old.has(name)) await budget.output(`\tzip warning: name not matched: ${source}\n`);
      return;
    }
    checkPath(canonical, limits);
    if (canonical === output || (existing && sameIdentity(existing, stat))) return;
    const symlink = parsed.storeLinks && stat.type === "symlink";
    if (stat.type !== "file" && stat.type !== "directory" && !symlink) {
      if (!parsed.quiet) await budget.output(`\tzip warning: ignoring special file: ${source}\n`);
      return;
    }
    if (existing && !hasIdentity(stat)) fail("cannot exclude archive aliases when source backing identity is unknown");
    const directory = stat.type === "directory";
    if (directory && name && !name.endsWith("/")) name += "/";
    const included = await filterName(name, selection, parsed.includes.length);
    const sourceName = name;
    if (parsed.junkPaths) name = directory ? "" : name.slice(name.lastIndexOf("/") + 1);
    if (name && included && !(directory && parsed.omitDirectories)) {
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
        } else bytes = await collectBytes(scope.input(path), { maxBytes: stat.size, signal: context.signal });
        if (!directory && bytes.length !== stat.size) fail(`source changed while reading: ${source}`);
        const current = await inspectSource(scope, path, parsed.storeLinks);
        if (current.canonical !== canonical || !unchanged(stat, current.stat)) fail(`source changed while reading: ${source}`);
        let entry = await makeZipEntry(name, bytes, { modified: new Date(stat.mtimeMs), mode: stat.mode, directory, symlink }, limits, context.signal, parsed.level);
        if ([".z", ".zip", ".zoo", ".arc", ".lzh", ".arj"].some(suffix => name.toLowerCase().endsWith(suffix))) entry = { ...entry, method: 0, data: bytes };
        const prior = old.get(name);
        if (prior?.comment) entry = { ...entry, comment: prior.comment };
        if (entry.data.length > limits.maxArchiveBytes - compressedBytes) fail("archive byte limit exceeded");
        compressedBytes += entry.data.length;
        selected.set(name, { entry, source });
      }
    }
    if (directory && parsed.recursive) {
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
  if (parsed.action === "delete") {
    if (!parsed.quiet && parsed.recursive) await budget.output("\tzip warning: invalid option(s) used with -d; ignored.\n");
    if (!parsed.quiet && !archive.entries.length) await budget.output(`\tzip warning: ${parsed.archive} not found or empty\n`);
    const operands = new Selection(parsed.operands, limits, context.signal);
    if (parsed.operands.length) {
      for (const entry of archive.entries) {
        if (await operands.matches(entry.name) && await filterName(entry.name, selection, parsed.includes.length)) deleted.add(entry.name);
      }
    }
    if (!parsed.quiet) {
      for (const [index, operand] of parsed.operands.entries()) {
        if (!operands.matched.has(index)) await budget.output(`\tzip warning: name not matched: ${operand}\n`);
      }
    }
  } else {
    for (const operand of parsed.operands) await visit(operand, memberName(operand, limits), 0);
  }
  if (!selected.size && !deleted.size && (parsed.action === "delete" || !parsed.includes.length)) {
    const detail = parsed.action !== "delete" && parsed.recursive && parsed.firstOperand >= 0
      ? `try: zip ${context.args.slice(0, parsed.firstOperand).join(" ")} . -i ${context.args.slice(parsed.firstOperand).join(" ")}`
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
    queue(`${update ? "updating:" : "  adding:"} ${entry.name} (${entry.method === 8 ? `deflated ${percentage}%` : "stored 0%"})\n`);
  };
  for (const entry of archive.entries) {
    if (++work > limits.maxPatternSteps) fail("archive work limit exceeded");
    if (deleted.has(entry.name)) { queue(`deleting: ${entry.name}\n`); continue; }
    const replacement = selected.get(entry.name);
    if (replacement) { entries.push(replacement.entry); append(replacement.entry, true); selected.delete(entry.name); }
    else { await budget.member(entry.size); entries.push(entry); }
  }
  for (const { entry } of selected.values()) { entries.push(entry); append(entry, false); }
  if (!entries.length) queue("\tzip warning: zip file empty\n");
  const bytes = await writeZipArchive({ entries, comment: archive.comment }, limits, context.signal);
  if (parsed.test) {
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
  return { output, parentName, parent, parentStat, existing, bytes, progress };
}

export function createZipCommand(options: ArchiveCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "zip", description: "Create or update bounded ZIP archives in the virtual filesystem", async execute(original) {
    original.signal.throwIfAborted();
    const scope = new ZipScope(original, limits);
    const context = scope.context;
    const budget = new Budget(context, limits);
    try {
      const parsed = await parse(scope, limits);
      const prepared = await prepare(scope, parsed, budget);
      await writeFileOutput(context, prepared.bytes, () => scope.operation(() => publishZip(scope, prepared)));
      for (const message of prepared.progress) await budget.output(message);
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
