import { publicDiagnosticMessage } from "../../diagnostics.js";
import { dirname, resolvePath, writeBytes, type CommandContext } from "../../contracts/index.js";
import { Budget, ToolError, definition, host, inspect, integer, type DiffPatchOptions } from "./shared.js";
import { applyHunks, reversePatch, type FilePatch, type HunkOutcome } from "./unified.js";
import { safeTarget } from "./patch-path.js";
import { unwrapPatch } from "./patch-envelope.js";
import { parsePatch, type PatchFormat, type ParseProgress } from "./patch-formats.js";
import { authorizeOutputs, authorizePaths, backupName, candidateStat, ensureParents, pruneDirectories, pruneParents, regular, rejectName, selectTarget, type AuthorizedPatch, type BackupOptions, type PathOptions } from "./patch-gnu-paths.js";
import { rejectText } from "./patch-gnu-reject.js";

interface PatchFlags extends BackupOptions { strip?: number; input: string; reverse: boolean; dryRun: boolean; atomic: boolean; quiet: boolean; force: boolean; backup: boolean; alwaysBackup?: boolean; forward?: boolean; output?: string; directory?: string; reject?: string; fuzz: number; ignoreWhitespace: boolean; removeEmpty: boolean; format?: PatchFormat; target?: string }

function flags(args: readonly string[]): PatchFlags {
  const result: PatchFlags = { input: "-", reverse: false, dryRun: false, atomic: false, quiet: false, force: false, backup: true, fuzz: 2, ignoreWhitespace: false, removeEmpty: false };
  const operands: string[] = [];
  const select = (format: PatchFormat) => {
    result.format = format;
  };
  const versionControl = (parameter: string) => {
    if (["simple", "never"].includes(parameter)) result.versionControl = "simple";
    else if (["numbered", "t"].includes(parameter)) result.versionControl = "numbered";
    else if (["existing", "nil"].includes(parameter)) result.versionControl = "existing";
    else throw new ToolError(`invalid version control: ${parameter}`);
  };
  let literal = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const value = (attached: string | undefined, name: string) => {
      const next = attached ?? args[++index];
      if (next === undefined) throw new ToolError(`${name} requires an argument`);
      return next;
    };
    if (literal || arg === "-" || !arg.startsWith("-")) operands.push(arg);
    else if (arg === "--") literal = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--atomic") result.atomic = true;
    else if (arg === "--quiet" || arg === "--silent") result.quiet = true;
    else if (arg === "--force") result.force = true;
    else if (arg === "--batch") continue;
    else if (arg === "--binary") continue;
    else if (arg === "--backup") result.alwaysBackup = true;
    else if (arg === "--forward") result.forward = true;
    else if (arg === "--no-backup-if-mismatch") result.backup = false;
    else if (arg === "--backup-if-mismatch") result.backup = true;
    else if (arg === "--reverse") result.reverse = true;
    else if (arg === "--remove-empty-files") result.removeEmpty = true;
    else if (arg === "--ignore-whitespace" || arg === "--ignore-white-space") result.ignoreWhitespace = true;
    else if (arg === "--unified") select("unified");
    else if (arg === "--context") select("context");
    else if (arg === "--normal") select("normal");
    else if (["--strip", "--input", "--fuzz", "--reject-file", "--output", "--directory", "--get", "--suffix", "--prefix", "--basename-prefix", "--version-control"].includes(arg.split("=")[0]!)) {
      const [name] = arg.split("=");
      const parameter = value(arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : undefined, name!);
      if (name === "--strip") result.strip = integer(parameter, "strip count");
      else if (name === "--fuzz") result.fuzz = integer(parameter, "fuzz");
      else if (name === "--reject-file") result.reject = parameter;
      else if (name === "--output") result.output = parameter;
      else if (name === "--directory") result.directory = parameter;
      else if (name === "--suffix") result.suffix = parameter;
      else if (name === "--prefix") result.prefix = parameter;
      else if (name === "--basename-prefix") result.basenamePrefix = parameter;
      else if (name === "--version-control") versionControl(parameter);
      else if (name === "--get") { if (parameter !== "0") throw new ToolError("version-control acquisition is unsupported; use --get=0"); }
      else result.input = parameter;
    } else if (arg.startsWith("--")) throw new ToolError(`unsupported option: ${arg}`);
    else for (let offset = 1; offset < arg.length; offset++) {
      const flag = arg[offset]!;
      if (flag === "R") result.reverse = true;
      else if (flag === "s") result.quiet = true;
      else if (flag === "f") result.force = true;
      else if (flag === "t") continue;
      else if (flag === "b") result.alwaysBackup = true;
      else if (flag === "N") result.forward = true;
      else if (flag === "E") result.removeEmpty = true;
      else if (flag === "l") result.ignoreWhitespace = true;
      else if (flag === "u") select("unified");
      else if (flag === "c") select("context");
      else if (flag === "n") select("normal");
      else if (["p", "i", "F", "r", "o", "d", "g", "z", "B", "Y", "V"].includes(flag)) {
        const parameter = value(arg.slice(offset + 1) || undefined, `-${flag}`);
        if (flag === "p") result.strip = integer(parameter, "strip count");
        else if (flag === "F") result.fuzz = integer(parameter, "fuzz");
        else if (flag === "r") result.reject = parameter;
        else if (flag === "o") result.output = parameter;
        else if (flag === "d") result.directory = parameter;
        else if (flag === "z") result.suffix = parameter;
        else if (flag === "B") result.prefix = parameter;
        else if (flag === "Y") result.basenamePrefix = parameter;
        else if (flag === "V") versionControl(parameter);
        else if (flag === "g") { if (parameter !== "0") throw new ToolError("version-control acquisition is unsupported; use -g0"); }
        else result.input = parameter;
        break;
      } else throw new ToolError(`unsupported option: -${flag}`);
    }
  }
  if (operands.length > 2) throw new ToolError("expected at most a target file and a patch input file");
  if (operands.length) result.target = operands[0]!;
  if (operands.length === 2) result.input = operands[1]!;
  if (!result.input || result.input.includes("\0")) throw new ToolError("invalid patch input path");
  for (const path of [result.output, result.directory]) if (path !== undefined && (!path || path.includes("\0"))) throw new ToolError("invalid patch option path");
  return result;
}

interface Prepared {
  readonly path: string;
  readonly original: string | undefined;
  readonly sourcePath?: string;
  readonly sourceOriginal?: string;
  readonly result: string;
  readonly remove: boolean;
  readonly backup?: string;
  readonly backupPath?: string;
  readonly backupMode?: number;
  readonly rejectPath?: string;
  readonly reject?: string;
  readonly parents: readonly string[];
}

async function applyContent(sourcePatch: FilePatch, current: string, exists: boolean, options: PatchFlags, budget: Budget) {
  let reversed = options.reverse;
  let patch = reversed ? reversePatch(sourcePatch) : sourcePatch;
  const emptyOld = () => patch.hunks.every(hunk => hunk.oldCount === 0 && hunk.oldStart === 0);
  const creation = () => patch.oldPath === "/dev/null" || (emptyOld() && (patch.oldEpoch || !exists));
  let autoReversed = false;
  let reverseMismatch = false;
  const declaredCreation = patch.oldPath === "/dev/null" || (patch.oldEpoch && emptyOld());
  const declaredDeletion = patch.newPath === "/dev/null" || (patch.newEpoch && patch.hunks.every(hunk => hunk.newCount === 0));
  if (!options.force && ((declaredCreation && current !== "") || (declaredDeletion && !exists))) {
    patch = reversePatch(patch);
    reversed = !reversed;
    autoReversed = true;
  }
  if (!creation() && !exists) return undefined;
  let outcomes: HunkOutcome[] = [];
  let result = await applyHunks(current, patch, options.fuzz, budget, options.ignoreWhitespace, {
    partial: true, outcomes, rejectAll: creation() && current !== "",
  });
  if (!options.force && !autoReversed && (outcomes[0]?.failed || outcomes[0]?.fuzz)) {
    const opposite = reversePatch(patch);
    const probe: HunkOutcome[] = [];
    const reverseFuzz = outcomes[0]!.failed ? options.fuzz : outcomes[0]!.fuzz - 1;
    await applyHunks(current, { ...opposite, hunks: opposite.hunks.slice(0, 1) }, reverseFuzz, budget, options.ignoreWhitespace, { partial: true, outcomes: probe });
    if (!probe[0]?.failed) {
      patch = opposite;
      reversed = !reversed;
      autoReversed = true;
      reverseMismatch = true;
      outcomes = [];
      result = await applyHunks(current, patch, options.fuzz, budget, options.ignoreWhitespace, {
        partial: true, outcomes, rejectAll: creation() && current !== "",
      });
    }
  }
  const deletion = patch.newPath === "/dev/null" || (patch.newEpoch && patch.hunks.every(hunk => hunk.newCount === 0 && hunk.newStart === 0));
  if (autoReversed && options.forward) return { result: current, outcomes: [], reversed, autoReversed, reverseMismatch, deletion: false, skipped: true };
  return { result, outcomes, reversed, autoReversed, reverseMismatch, deletion };
}

async function unchanged(item: Prepared, budget: Budget): Promise<void> {
  if (item.sourcePath !== undefined) {
    const source = await inspect(budget, item.sourcePath);
    regular(source, item.sourcePath);
    if ((source === undefined) !== (item.sourceOriginal === undefined) || (source && await budget.read(item.sourcePath) !== item.sourceOriginal)) throw new ToolError(`target changed during preflight: ${item.sourcePath}`, 1);
  }
  const stat = await inspect(budget, item.path);
  regular(stat, item.path);
  if ((stat === undefined) !== (item.original === undefined)
    || (item.original !== undefined && await budget.read(item.path) !== item.original)) {
    throw new ToolError(`target changed during preflight: ${item.path}`, 1);
  }
  for (const path of [item.backupPath, item.rejectPath]) {
    if (path !== undefined) regular(await inspect(budget, path), path);
  }
  for (const parent of item.parents) await inspect(budget, parent);
}

async function publish(item: Prepared, budget: Budget, rejects: Set<string>): Promise<void> {
  const context = budget.context;
  await unchanged(item, budget);
  const write = async (path: string, text: string, append = false, createParents = true, mode?: number) => {
    if (createParents) await ensureParents(path, budget);
    else if ((await inspect(budget, dirname(path)))?.type !== "directory") throw new ToolError(`reject parent does not exist: ${dirname(path)}`);
    const stat = await inspect(budget, path);
    regular(stat, path);
    const capabilities = mode === undefined ? undefined : await host(context, async () =>
      await context.fs.capabilitiesFor?.(path, { signal: context.signal, create: true }) ?? context.fs.capabilities);
    const preserveMode = mode !== undefined && capabilities?.permissions !== false;
    if (append) await host(context, () => context.fs.appendFile(path, Buffer.from(text), { signal: context.signal }));
    else await host(context, () => context.fs.writeFile(path, Buffer.from(text), { signal: context.signal, flag: stat ? "w" : "wx", ...(preserveMode ? { mode } : {}) }));
    if (preserveMode && context.fs.chmod) await host(context, () => context.fs.chmod!(path, mode, { signal: context.signal }));
  };
  if (item.backup !== undefined && item.backupPath !== undefined) await write(item.backupPath, item.backup, false, true, item.backupMode);
  if (item.remove) {
    if (item.original !== undefined) {
      regular(await inspect(budget, item.path), item.path);
      await host(context, () => context.fs.rm(item.path, { signal: context.signal }));
    }
  } else await write(item.path, item.result);
  if (item.rejectPath !== undefined && item.reject !== undefined) {
    await write(item.rejectPath, item.reject, rejects.has(item.rejectPath), false);
    rejects.add(item.rejectPath);
  }
}

async function run(context: CommandContext, budget: Budget): Promise<number> {
  const options = flags(context.args);
  if (options.directory !== undefined) {
    const cwd = resolvePath(context.cwd, options.directory);
    if ((await inspect(budget, cwd))?.type !== "directory") throw new ToolError(`not a directory: ${options.directory}`);
    context = { ...context, cwd };
    budget = new Budget(context, budget.limits);
  }
  const output = options.output === undefined ? undefined : safeTarget(options.output, 0, true);
  if (options.output !== undefined && output === undefined) throw new ToolError("/dev/null is not an output file");
  const outputPath = output === undefined ? undefined : resolvePath(context.cwd, output);
  const explicit = options.target === undefined ? undefined : safeTarget(options.target, 0, true);
  if (options.target !== undefined && explicit === undefined) throw new ToolError("/dev/null is not an explicit target");
  if (options.input !== "-") {
    const stat = await inspect(budget, options.input);
    if (stat?.type !== "file") throw new ToolError("patch input must be a regular file");
  }
  const input = await budget.read(options.input === "-" ? "-" : resolvePath(context.cwd, options.input));
  const progress: ParseProgress | undefined = options.atomic ? undefined : {};
  const sections = await parsePatch(await unwrapPatch(input, budget), budget, options.format, explicit, progress);
  const parsed = options.format === "normal" ? sections : sections.filter(patch => !patch.unlocated);
  if (sections.length && !parsed.length) throw new ToolError("no identifiable patch; normal input requires a target, Index header, or -n");
  const reject = options.reject === undefined || options.reject === "-" ? options.reject : safeTarget(options.reject, 0, true);
  if (options.reject !== undefined && reject === undefined) throw new ToolError("/dev/null is not a reject file; use -r -");
  const paths: PathOptions = { strip: options.strip, explicit, reject,
    input: options.input === "-" ? undefined : resolvePath(context.cwd, options.input) };
  const preview = new Map<string, string | undefined>();
  const previewParents = new Set<string>();
  const authorized = await authorizePaths(parsed, paths, budget, !options.dryRun || options.atomic ? {
    reverse: options.atomic && options.reverse,
    exists: async path => preview.has(path) ? preview.get(path) !== undefined
      : previewParents.has(path) || await candidateStat(path, budget) !== undefined,
    advance: async item => {
      const path = resolvePath(context.cwd, item.selected!);
      const current = preview.has(path) ? preview.get(path) : await inspect(budget, path) ? await budget.read(path) : undefined;
      const applied = await applyContent(item.patch, current ?? "", current !== undefined, options, budget);
      if (!applied) return;
      const remove = applied.result === "" && (applied.deletion || options.removeEmpty);
      preview.set(path, remove ? undefined : applied.result);
      if (!remove) for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) previewParents.add(parent);
    },
  } : undefined);
  const targets = new Set(authorized.flatMap(item => item.selected === undefined ? [] : [resolvePath(context.cwd, item.selected)]));
  if (outputPath !== undefined) await authorizeOutputs([outputPath], targets, paths.input, budget);
  const staged = new Map<string, Prepared>();
  const stagedParents = new Set<string>();
  const touched = new Set<string>();
  const rejects = new Set<string>();
  const backupPaths = new Set<string>();
  const rejectPaths = new Set<string>();
  const parents = new Set<string>();
  const messages: string[] = [];
  let exitCode = 0;
  let committed = 0;
  let publishing = false;
  let activePath: string | undefined;
  let outputContents = "";
  const status = async (text: string) => {
    if (!text) return;
    budget.output(text);
    if (options.atomic) messages.push(text);
    else await writeBytes(context.stdout, Buffer.from(text), context.signal);
  };
  const applySection = async (authorizedPatch: AuthorizedPatch) => {
    const sourcePatch = authorizedPatch.patch;
    if (sourcePatch.unlocated) {
      if (options.atomic) throw new ToolError("no file to patch; provide a target or Index header", 1);
      await status(`No file to patch.  Skipping patch.\n${sourcePatch.hunks.length} out of ${sourcePatch.hunks.length} hunks ignored\n`);
      exitCode = 1;
      return;
    }
    const name = await selectTarget(authorizedPatch, async path => options.atomic && staged.has(path)
      ? !staged.get(path)!.remove : (options.atomic && stagedParents.has(path)) || await candidateStat(path, budget) !== undefined, budget);
    const path = resolvePath(context.cwd, name);
    activePath = path;
    if (path === paths.input || backupPaths.has(path) || rejectPaths.has(path)) throw new ToolError(`patch target aliases input or an earlier output: ${path}`);
    targets.add(path);
    const prior = options.atomic ? staged.get(path) : undefined;
    const stat = await inspect(budget, path);
    regular(stat, path);
    const exists = prior ? !prior.remove : stat !== undefined;
    const original = prior ? prior.original : stat ? await budget.read(path) : undefined;
    const current = prior ? prior.remove ? "" : prior.result : original ?? "";
    const applied = await applyContent(sourcePatch, current, exists, options, budget);
    if (!applied) {
      if (options.atomic) throw new ToolError(`patch target does not exist: ${path}`, 1);
      await status(`No file to patch.  Skipping patch ${name}.\n${sourcePatch.hunks.length} out of ${sourcePatch.hunks.length} hunks ignored\n`);
      exitCode = 1;
      return;
    }
    const { result, outcomes, reversed, autoReversed, reverseMismatch, deletion } = applied;
    if (applied.skipped) {
      await status(`Reversed (or previously applied) patch detected!  Skipping patch.\n${sourcePatch.hunks.length} out of ${sourcePatch.hunks.length} hunks ignored\n`);
      exitCode = 1;
      return;
    }
    const failed = outcomes.filter(outcome => outcome.failed);
    const conflict = failed.length > 0 || (deletion && result !== "");
    if (options.atomic && conflict) throw new ToolError(failed.length ? `hunk ${failed[0]!.index} does not match ${name}` : `deletion patch leaves content: ${name}`, 1);
    if (conflict) exitCode = 1;
    const mismatch = reverseMismatch || outcomes.some(outcome => outcome.failed || outcome.offset !== 0 || outcome.fuzz !== 0);
    const backup = !options.dryRun && (options.alwaysBackup || options.backup && mismatch) && !touched.has(path) ? original ?? "" : undefined;
    const backupPath = backup === undefined ? prior?.backupPath : await backupName(path, budget, options);
    const rejectDestination = rejectName(name, paths);
    const rejectPath = !options.dryRun && failed.length && rejectDestination !== undefined ? resolvePath(context.cwd, rejectDestination) : undefined;
    const rejected = rejectPath === undefined ? undefined : await rejectText(sourcePatch, outcomes, authorizedPatch.oldName, authorizedPatch.newName, authorizedPatch.indexName, reversed, budget);
    await authorizeOutputs([outputPath, backupPath, rejectPath], targets, paths.input, budget);
    if ((backupPath !== undefined && rejectPaths.has(backupPath)) || (rejectPath !== undefined && backupPaths.has(rejectPath))) {
      throw new ToolError("reject path aliases another section's backup");
    }
    if (backupPath !== undefined) backupPaths.add(backupPath);
    if (rejectPath !== undefined) rejectPaths.add(rejectPath);
    const remove = outputPath === undefined && result === "" && (deletion || options.removeEmpty);
    const outputPrior = outputPath === undefined ? undefined : staged.get(outputPath);
    const outputOriginal = outputPath === undefined ? original : outputPrior ? outputPrior.original : await inspect(budget, outputPath) ? await budget.read(outputPath) : undefined;
    if (outputPath !== undefined) outputContents += result;
    const item: Prepared = { path: outputPath ?? path, original: outputOriginal, result: outputPath === undefined ? result : outputContents, remove,
      ...(outputPath === undefined ? {} : { sourcePath: path, ...(original === undefined ? {} : { sourceOriginal: original }) }),
      ...(backup === undefined ? prior?.backup === undefined ? {} : { backup: prior.backup } : { backup }),
      ...(backupPath === undefined ? {} : { backupPath }),
      ...(prior?.backupMode !== undefined ? { backupMode: prior.backupMode } : backup !== undefined && stat ? { backupMode: stat.mode & 0o7777 } : {}),
      ...(rejectPath === undefined ? {} : { rejectPath, reject: rejected! }), parents: remove ? pruneParents(name, context.cwd) : [] };
    let message = options.quiet ? "" : `${options.dryRun ? "checking" : "patching"} file ${output === undefined ? name : `${output} (read from ${name})`}\n`;
    if (autoReversed) message += "Reversed (or previously applied) patch detected!  Assuming -R.\n";
    for (const outcome of outcomes) {
      if (outcome.misordered) message += "misordered hunks! output would be garbled\n";
      if (options.quiet) continue;
      if (outcome.failed) message += `Hunk #${outcome.index} FAILED at ${outcome.line}.\n`;
      else if (outcome.offset || outcome.fuzz) message += `Hunk #${outcome.index} succeeded at ${outcome.line}${outcome.fuzz ? ` with fuzz ${outcome.fuzz}` : ""}${outcome.offset ? ` (offset ${outcome.offset} ${outcome.offset === 1 ? "line" : "lines"})` : ""}.\n`;
    }
    if (failed.length) message += `${failed.length} out of ${outcomes.length} ${outcomes.length === 1 ? "hunk" : "hunks"} FAILED${options.dryRun || rejectPath === undefined ? "" : ` -- saving rejects to file ${rejectDestination}`}\n`;
    if (deletion && result !== "") message += `Not deleting file ${name} as content differs from patch\n`;
    budget.output(result);
    if (backup !== undefined) budget.output(backup);
    await status(message);
    touched.add(path);
    if (options.atomic) {
      staged.set(item.path, item);
      if (!remove) for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) stagedParents.add(parent);
    }
    else if (!options.dryRun) {
      publishing = true;
      await publish(item, budget, rejects);
      committed++;
      publishing = false;
      for (const parent of item.parents) parents.add(parent);
    }
  };
  for (const authorizedPatch of options.atomic && options.reverse ? authorized.slice().reverse() : authorized) {
    activePath = authorizedPatch.selected === undefined ? undefined : resolvePath(context.cwd, authorizedPatch.selected);
    try { await applySection(authorizedPatch); }
    catch (error) {
      context.signal.throwIfAborted();
      if (committed === 0 && !publishing) throw error;
      throw new ToolError(`commit stopped; ${committed}/${authorized.length} files committed; failing operation may have side effects; path ${activePath}: ${publicDiagnosticMessage(error, budget.context.onInternalError)}`);
    }
  }
  if (options.atomic && !options.dryRun) {
    const prepared = [...staged.values()].filter(item => !(item.remove && item.original === undefined));
    for (const item of prepared) await unchanged(item, budget);
    for (const item of prepared) {
      try { await publish(item, budget, rejects); committed++; }
      catch (error) {
        context.signal.throwIfAborted();
        throw new ToolError(`commit stopped; ${committed}/${prepared.length} files committed; failing operation may have side effects; path ${item.path}: ${publicDiagnosticMessage(error, budget.context.onInternalError)}`);
      }
      for (const parent of item.parents) parents.add(parent);
    }
  }
  if (!options.dryRun) await pruneDirectories(parents, budget);
  if (options.atomic && (!options.quiet || messages.length)) await writeBytes(context.stdout, Buffer.from(messages.join("")), context.signal);
  if (progress?.error) throw progress.error;
  return exitCode;
}

export function patchCommand(options: DiffPatchOptions) { return definition("patch", options, run); }
