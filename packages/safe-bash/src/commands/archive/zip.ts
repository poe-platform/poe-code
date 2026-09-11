import { collectBytes, dirname, getCommandArguments, writeBytes, type CommandContext, type CommandDefinition, type FileStat } from "../../contracts/index.js";
import { shellValueByteLength, shellValueBytes } from "../../contracts/value.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { yieldTurn } from "../../contracts/yield.js";
import { publicDiagnosticMessage } from "../../diagnostics.js";
import { escapeText } from "../../escaping.js";
import { Budget, checkPath, display, fail, hasIdentity, sameIdentity, settings, text, vfsPath, type ArchiveCommandsOptions, type ArchiveLimits } from "./internal.js";
import { makeZipEntry, readZipArchive, writeZipArchive, type ZipArchive, type ZipEntry } from "./zip-format.js";
import { publishZip, ZipScope } from "./zip/safety.js";

interface ZipOptions {
  readonly archive: string;
  readonly recursive: boolean;
  readonly quiet: boolean;
  readonly operands: readonly string[];
  readonly firstOperand: number;
}

class ZipFailure extends Error {
  constructor(readonly status: number, readonly label: string, detail: string) { super(detail); }
}

function parse(context: CommandContext, limits: ArchiveLimits): ZipOptions {
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
  let recursive = false;
  let quiet = false;
  let literal = false;
  let firstOperand = -1;
  const operands: string[] = [];
  for (const [index, argument] of context.args.entries()) {
    checkPath(argument, limits);
    if (!literal && argument === "--") {
      if (archive === undefined) throw new ZipFailure(16, "Invalid command arguments", "can't use -- before archive name");
      literal = true;
    } else if (!literal && argument.startsWith("-") && argument !== "-") {
      for (const flag of argument.slice(1)) {
        if (flag === "r") recursive = true;
        else if (flag === "q") quiet = true;
        else throw new ZipFailure(16, "Invalid command arguments", `unsupported option: ${argument}`);
      }
    } else if (archive === undefined) archive = argument;
    else {
      if (operands.length >= limits.maxMembers) fail("operand limit exceeded");
      if (firstOperand < 0) firstOperand = index;
      operands.push(argument);
    }
  }
  if (archive === undefined) throw new ZipFailure(16, "Invalid command arguments", "expected zip [-r] [-q] ARCHIVE FILES...");
  if (archive === "-" || operands.includes("-")) throw new ZipFailure(16, "Invalid command arguments", "standard input/output archives are unsupported");
  if (!archive.slice(archive.lastIndexOf("/") + 1).includes(".")) archive += ".zip";
  checkPath(archive, limits);
  return { archive, recursive, quiet, operands, firstOperand };
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
      canonical = await scope.operation(() => context.fs.realpath(path, { signal: context.signal }));
      stat = await scope.operation(() => context.fs.stat(path, { signal: context.signal }));
    } catch (error) {
      context.signal.throwIfAborted();
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error;
      if (!parsed.quiet && !old.has(name)) await budget.output(`\tzip warning: name not matched: ${source}\n`);
      return;
    }
    checkPath(canonical, limits);
    if (canonical === output || (existing && sameIdentity(existing, stat))) return;
    if (stat.type !== "file" && stat.type !== "directory") {
      if (!parsed.quiet) await budget.output(`\tzip warning: ignoring special file: ${source}\n`);
      return;
    }
    if (existing && !hasIdentity(stat)) fail("cannot exclude archive aliases when source backing identity is unknown");
    const directory = stat.type === "directory";
    if (directory && name && !name.endsWith("/")) name += "/";
    if (name) {
      checkPath(name, limits);
      const previous = selected.get(name);
      if (previous && previous.source !== source) {
        if (!parsed.quiet) await budget.output(`\tzip warning:   first full name: ${previous.source}\n                      second full name: ${source}\n                     name in zip file repeated: ${name}\n`);
        throw new ZipFailure(16, "Invalid command arguments", "cannot repeat names in zip file");
      }
      if (!previous) {
        await budget.member(directory ? 0 : stat.size);
        const bytes = directory ? new Uint8Array() : await collectBytes(scope.input(path), { maxBytes: stat.size, signal: context.signal });
        if (!directory && bytes.length !== stat.size) fail(`source changed while reading: ${source}`);
        const current = await scope.operation(() => context.fs.stat(path, { signal: context.signal }));
        const currentPath = await scope.operation(() => context.fs.realpath(path, { signal: context.signal }));
        if (currentPath !== canonical || !unchanged(stat, current)) fail(`source changed while reading: ${source}`);
        let entry = await makeZipEntry(name, bytes, { modified: new Date(stat.mtimeMs), mode: stat.mode, directory, symlink: false }, limits, context.signal);
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
          await visit(`${prefix}${child.name}`, `${name}${child.name}`, depth + 1);
        }
      } finally { ancestors.pop(); }
    }
  };
  for (const operand of parsed.operands) await visit(operand, memberName(operand, limits), 0);
  if (!selected.size) {
    const detail = parsed.recursive && parsed.firstOperand >= 0
      ? `try: zip ${context.args.slice(0, parsed.firstOperand).join(" ")} . -i ${context.args.slice(parsed.firstOperand).join(" ")}`
      : parsed.archive;
    throw new ZipFailure(12, "Nothing to do!", detail);
  }
  const entries: ZipEntry[] = [];
  const progress: string[] = [];
  let progressBytes = 0;
  const append = (entry: ZipEntry, update: boolean) => {
    if (parsed.quiet) return;
    const percentage = entry.size ? Math.trunc((Math.trunc(200 * (entry.size - entry.data.length) / entry.size) + 1) / 2) : 0;
    const message = `${update ? "updating:" : "  adding:"} ${entry.name} (${entry.method === 8 ? `deflated ${percentage}%` : "stored 0%"})\n`;
    const size = Buffer.byteLength(message);
    if (size > limits.maxTextBytes - budget.textBytes - progressBytes) fail("text output limit exceeded");
    progressBytes += size;
    progress.push(message);
  };
  for (const entry of archive.entries) {
    if (++work > limits.maxPatternSteps) fail("archive work limit exceeded");
    const replacement = selected.get(entry.name);
    if (replacement) { entries.push(replacement.entry); append(replacement.entry, true); selected.delete(entry.name); }
    else { await budget.member(entry.size); entries.push(entry); }
  }
  for (const { entry } of selected.values()) { entries.push(entry); append(entry, false); }
  const bytes = await writeZipArchive({ entries, comment: archive.comment }, limits, context.signal);
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
      const parsed = parse(context, limits);
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
