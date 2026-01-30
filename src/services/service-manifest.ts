import path from "node:path";
import type { CliEnvironment } from "../cli/environment.js";
import type { CommandContext } from "../cli/context.js";
import type { FileSystem } from "../utils/file-system.js";
import { createBackup } from "../utils/backup.js";
import { renderTemplate } from "../utils/templates.js";
import {
  deepMergeJson,
  isJsonObject,
  pruneJsonByShape,
  type JsonObject
} from "../utils/json.js";
import {
  parseTomlDocument,
  serializeTomlDocument,
  mergeTomlTables,
  type TomlTable,
  type TomlMergeOptions
} from "../utils/toml.js";

type ValueResolver<Options, Value> =
  | Value
  | ((context: MutationContext<Options>) => Value);

type TargetPathResolver<Options> = ValueResolver<Options, string>;

type TargetDirectoryResolver<Options> = ValueResolver<Options, string>;

type TargetFileResolver<Options> = ValueResolver<Options, string>;

export type TargetLocation<Options> =
  | {
      target: TargetPathResolver<Options>;
      targetDirectory?: never;
      targetFile?: never;
    }
  | {
      target?: never;
      targetDirectory: TargetDirectoryResolver<Options>;
      targetFile?: TargetFileResolver<Options>;
    };

interface MutationContext<Options> {
  options: Options;
  fs: FileSystem;
  env: CliEnvironment;
}

export interface ServiceManifestPathMapper {
  mapTargetDirectory: (input: {
    targetDirectory: string;
    env: CliEnvironment;
  }) => string;
}

interface TransformResult {
  content: string | null;
  changed: boolean;
}

interface TransformFileMutation<Options> {
  kind: "transformFile";
  label?: ValueResolver<Options, string | undefined>;
  target: TargetLocation<Options>;
  transform(
    input: { content: string | null; context: MutationContext<Options> }
  ): Promise<TransformResult> | TransformResult;
}

interface EnsureDirectoryMutation<Options> {
  kind: "ensureDirectory";
  label?: ValueResolver<Options, string | undefined>;
  targetDirectory: TargetDirectoryResolver<Options>;
}

interface CreateBackupMutation<Options> {
  kind: "createBackup";
  label?: ValueResolver<Options, string | undefined>;
  target: TargetLocation<Options>;
  timestamp?: ValueResolver<Options, (() => string) | undefined>;
}

interface WriteTemplateMutation<Options> {
  kind: "writeTemplate";
  label?: ValueResolver<Options, string | undefined>;
  target: TargetLocation<Options>;
  templateId: string;
  context?: ValueResolver<Options, JsonObject | undefined>;
}

interface RemoveFileMutation<Options> {
  kind: "removeFile";
  label?: ValueResolver<Options, string | undefined>;
  target: TargetLocation<Options>;
  whenEmpty?: boolean;
  whenContentMatches?: RegExp;
}

interface ChmodMutation<Options> {
  kind: "chmod";
  label?: ValueResolver<Options, string | undefined>;
  target: TargetLocation<Options>;
  mode: number;
}

export type ServiceMutation<Options> =
  | TransformFileMutation<Options>
  | EnsureDirectoryMutation<Options>
  | CreateBackupMutation<Options>
  | WriteTemplateMutation<Options>
  | RemoveFileMutation<Options>
  | ChmodMutation<Options>;

export interface ServiceManifestDefinition<
  ConfigureOptions,
  UnconfigureOptions = ConfigureOptions
> {
  id: string;
  summary: string;
  configure: ServiceMutation<ConfigureOptions>[];
  unconfigure?: ServiceMutation<UnconfigureOptions>[];
}

export interface ServiceManifest<
  ConfigureOptions,
  UnconfigureOptions = ConfigureOptions
> {
  id: string;
  summary: string;
  configureMutations: ServiceMutation<ConfigureOptions>[];
  unconfigureMutations?: ServiceMutation<UnconfigureOptions>[];
  configure(
    context: ServiceExecutionContext<ConfigureOptions>,
    runOptions?: ServiceRunOptions
  ): Promise<void>;
  unconfigure: (
    context: ServiceExecutionContext<UnconfigureOptions>,
    runOptions?: ServiceRunOptions
  ) => Promise<boolean>;
}

export interface ServiceExecutionContext<Options> {
  fs: FileSystem;
  env: CliEnvironment;
  command: CommandContext;
  options: Options;
  pathMapper?: ServiceManifestPathMapper;
}

export interface MutationLogDetails {
  manifestId: string;
  kind: ServiceMutationKind;
  label: string;
  targetPath?: string;
}

export type MutationDetail =
  | "create"
  | "update"
  | "delete"
  | "noop"
  | "backup";

export interface ServiceMutationOutcome {
  changed: boolean;
  effect: MutationEffect;
  detail?: MutationDetail;
}

export type MutationEffect =
  | "none"
  | "mkdir"
  | "copy"
  | "write"
  | "delete"
  | "chmod";

export interface ServiceMutationObservers {
  onStart?(details: MutationLogDetails): void;
  onComplete?(
    details: MutationLogDetails,
    outcome: ServiceMutationOutcome
  ): void;
  onError?(details: MutationLogDetails, error: unknown): void;
}

export function ensureDirectory<Options>(config: {
  path?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  const targetDirectory = config.targetDirectory ?? config.path;
  if (!targetDirectory) {
    throw new Error("ensureDirectory requires a path or targetDirectory.");
  }
  return {
    kind: "ensureDirectory",
    targetDirectory,
    label: config.label
  };
}

export function createBackupMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  timestamp?: ValueResolver<Options, (() => string) | undefined>;
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "createBackup",
    target: normalizeTargetLocation(config),
    timestamp: config.timestamp,
    label: config.label
  };
}

export function writeTemplateMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  templateId: string;
  context?: ValueResolver<Options, JsonObject | undefined>;
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "writeTemplate",
    target: normalizeTargetLocation(config),
    templateId: config.templateId,
    context: config.context,
    label: config.label
  };
}

export function chmodMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  mode: number;
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "chmod",
    target: normalizeTargetLocation(config),
    mode: config.mode,
    label: config.label
  };
}

export function jsonMergeMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  value: ValueResolver<Options, JsonObject>;
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "transformFile",
    target: normalizeTargetLocation(config),
    label: config.label,
    async transform({ content, context }) {
      const targetPath = resolveTargetPath(config, context);
      const current = await parseJsonWithRecovery({
        content,
        fs: context.fs,
        targetPath
      });
      const desired = resolveValue(config.value, context);
      const merged = deepMergeJson(current, desired);
      const serialized = serializeJson(merged);
      return {
        content: serialized,
        changed: serialized !== content
      };
    }
  };
}

export function jsonPruneMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  shape: ValueResolver<Options, JsonObject>;
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "transformFile",
    target: normalizeTargetLocation(config),
    label: config.label,
    async transform({ content, context }) {
      if (content == null) {
        return { content: null, changed: false };
      }
      const targetPath = resolveTargetPath(config, context);
      const current = await parseJsonWithRecovery({
        content,
        fs: context.fs,
        targetPath
      });
      const shape = resolveValue(config.shape, context);
      const { changed, result } = pruneJsonByShape(current, shape);
      if (!changed) {
        return { content, changed: false };
      }
      if (Object.keys(result).length === 0) {
        return { content: null, changed: true };
      }
      const serialized = serializeJson(result);
      return {
        content: serialized,
        changed: serialized !== content
      };
    }
  };
}

export function tomlMergeMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  value: ValueResolver<Options, TomlTable>;
  pruneByPrefix?: TomlMergeOptions["pruneByPrefix"];
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "transformFile",
    target: normalizeTargetLocation(config),
    label: config.label,
    async transform({ content, context }) {
      const targetPath = resolveTargetPath(config, context);
      const current = await parseTomlWithRecovery({
        content,
        fs: context.fs,
        targetPath
      });
      const desired = resolveValue(config.value, context);
      const mergeOptions: TomlMergeOptions = config.pruneByPrefix
        ? { pruneByPrefix: config.pruneByPrefix }
        : {};
      const merged = mergeTomlTables(current, desired, mergeOptions);
      const serialized = serializeTomlDocument(merged);
      const previous = content ?? "";
      return {
        content: serialized,
        changed: serialized !== previous
      };
    }
  };
}

export function tomlPruneMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  prune: (
    document: TomlTable,
    context: MutationContext<Options>
  ) => { changed: boolean; result: TomlTable | null };
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "transformFile",
    target: normalizeTargetLocation(config),
    label: config.label,
    async transform({ content, context }) {
      if (content == null) {
        return { content: null, changed: false };
      }
      let document: TomlTable;
      try {
        document = parseTomlDocument(content);
      } catch {
        return { content, changed: false };
      }
      const outcome = config.prune(document, context);
      if (!outcome.changed) {
        return { content, changed: false };
      }
      if (!outcome.result || Object.keys(outcome.result).length === 0) {
        return { content: null, changed: true };
      }
      const serialized = serializeTomlDocument(outcome.result);
      return {
        content: serialized,
        changed: serialized !== content
      };
    }
  };
}

export function tomlTemplateMergeMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  templateId: string;
  context?: ValueResolver<Options, JsonObject | undefined>;
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "transformFile",
    target: normalizeTargetLocation(config),
    label: config.label,
    async transform({ content, context }) {
      const targetPath = resolveTargetPath(config, context);
      const current = await parseTomlWithRecovery({
        content,
        fs: context.fs,
        targetPath
      });
      const templateContext = config.context
        ? resolveValue(config.context, context)
        : undefined;
      const rendered = await renderTemplate(
        config.templateId,
        templateContext ?? {}
      );
      const templateDocument = parseTomlDocument(rendered);
      const merged = mergeTomlTables(current, templateDocument);
      const serialized = serializeTomlDocument(merged);
      const previous = content ?? "";
      return {
        content: serialized,
        changed: serialized !== previous
      };
    }
  };
}

export function removePatternMutation<Options>(config: {
  target: ValueResolver<Options, string>;
  pattern: RegExp;
  replacement?:
    | string
    | ((
        match: string,
        context: MutationContext<Options>
      ) => string);
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "transformFile",
    target: { target: config.target },
    label: config.label,
    transform({ content, context }) {
      if (content == null) {
        return { content: null, changed: false };
      }
      let next: string;
      if (typeof config.replacement === "function") {
        const replacementFn = config.replacement;
        const replacer = (match: string, ..._args: any[]) =>
          replacementFn(match, context);
        next = content.replace(config.pattern, replacer);
      } else {
        next = content.replace(config.pattern, config.replacement ?? "");
      }
      return {
        content: next,
        changed: next !== content
      };
    }
  };
}

export function removeFileMutation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
  whenEmpty?: boolean;
  whenContentMatches?: RegExp;
  label?: ValueResolver<Options, string | undefined>;
}): ServiceMutation<Options> {
  return {
    kind: "removeFile",
    target: normalizeTargetLocation(config),
    whenEmpty: config.whenEmpty,
    whenContentMatches: config.whenContentMatches,
    label: config.label
  };
}

export function createServiceManifest<
  ConfigureOptions,
  UnconfigureOptions = ConfigureOptions
>(definition: ServiceManifestDefinition<ConfigureOptions, UnconfigureOptions>): ServiceManifest<ConfigureOptions, UnconfigureOptions> {
  const configureMutations = definition.configure;
  const unconfigureMutations = definition.unconfigure;

  return {
    id: definition.id,
    summary: definition.summary,
    configureMutations,
    unconfigureMutations,
    async configure(context, runOptions) {
      await runMutations(configureMutations, context, {
        trackChanges: false,
        observers: runOptions?.observers,
        manifestId: definition.id
      });
    },
    async unconfigure(context, runOptions) {
      if (!unconfigureMutations) {
        return false;
      }
      return runMutations(unconfigureMutations, context, {
        trackChanges: true,
        observers: runOptions?.observers,
        manifestId: definition.id
      });
    }
  };
}

async function runMutations<Options>(
  mutations: ServiceMutation<Options>[],
  context: ServiceExecutionContext<Options>,
  options: {
    trackChanges: boolean;
    observers?: ServiceMutationObservers;
    manifestId: string;
  }
): Promise<boolean> {
  let touched = false;
  for (const mutation of mutations) {
    const changed = await applyMutation(
      mutation,
      context,
      options.manifestId,
      options.observers
    );
    if (options.trackChanges && changed) {
      touched = true;
    }
  }
  return touched;
}

async function applyMutation<Options>(
  mutation: ServiceMutation<Options>,
  context: ServiceExecutionContext<Options>,
  manifestId: string,
  observers?: ServiceMutationObservers
): Promise<boolean> {
  switch (mutation.kind) {
    case "ensureDirectory": {
      validateHomeRelativePath(mutation.targetDirectory, context);
      const targetPath = resolvePath(
        { targetDirectory: mutation.targetDirectory },
        context
      );
      const details = createMutationDetails(
        mutation,
        manifestId,
        targetPath,
        context
      );
      observers?.onStart?.(details);
      try {
        const existed = await pathExists(context.fs, targetPath);
        await context.fs.mkdir(targetPath, { recursive: true });
        observers?.onComplete?.(details, {
          changed: !existed,
          effect: "mkdir",
          detail: existed ? "noop" : "create"
        });
        flushCommandDryRun(context);
        return !existed;
      } catch (error) {
        observers?.onError?.(details, error);
        throw error;
      }
    }
    case "createBackup": {
      validateHomeRelativePath(mutation.target, context);
      const targetPath = resolvePath(mutation.target, context);
      const timestamp = mutation.timestamp
        ? resolveValue(mutation.timestamp, mutationContext(context))
        : undefined;
      const details = createMutationDetails(
        mutation,
        manifestId,
        targetPath,
        context
      );
      observers?.onStart?.(details);
      try {
        const backupPath = await createBackup(context.fs, targetPath, timestamp);
        observers?.onComplete?.(details, {
          changed: backupPath != null,
          effect: backupPath ? "copy" : "none",
          detail: backupPath ? "backup" : "noop"
        });
        flushCommandDryRun(context);
      } catch (error) {
        observers?.onError?.(details, error);
        throw error;
      }
      return false;
    }
    case "writeTemplate": {
      validateHomeRelativePath(mutation.target, context);
      const targetPath = resolvePath(mutation.target, context);
      const renderContext = mutation.context
        ? resolveValue(mutation.context, mutationContext(context))
        : undefined;
      const rendered = await renderTemplate(
        mutation.templateId,
        renderContext ?? {}
      );
      const details = createMutationDetails(
        mutation,
        manifestId,
        targetPath,
        context
      );
      observers?.onStart?.(details);
      try {
        const existed = await pathExists(context.fs, targetPath);
        await context.fs.writeFile(targetPath, rendered, { encoding: "utf8" });
        observers?.onComplete?.(details, {
          changed: true,
          effect: "write",
          detail: existed ? "update" : "create"
        });
        flushCommandDryRun(context);
      } catch (error) {
        observers?.onError?.(details, error);
        throw error;
      }
      return true;
    }
    case "chmod": {
      validateHomeRelativePath(mutation.target, context);
      const targetPath = resolvePath(mutation.target, context);
      const details = createMutationDetails(
        mutation,
        manifestId,
        targetPath,
        context
      );
      observers?.onStart?.(details);
      try {
        if (typeof context.fs.chmod !== "function") {
          observers?.onComplete?.(details, {
            changed: false,
            effect: "none",
            detail: "noop"
          });
          flushCommandDryRun(context);
          return false;
        }

        const stat = await context.fs.stat(targetPath);
        const currentMode =
          typeof stat.mode === "number" ? stat.mode & 0o777 : null;
        if (currentMode === mutation.mode) {
          observers?.onComplete?.(details, {
            changed: false,
            effect: "none",
            detail: "noop"
          });
          flushCommandDryRun(context);
          return false;
        }

        await context.fs.chmod(targetPath, mutation.mode);
        observers?.onComplete?.(details, {
          changed: true,
          effect: "chmod",
          detail: "update"
        });
        flushCommandDryRun(context);
        return true;
      } catch (error) {
        if (isNotFound(error)) {
          observers?.onComplete?.(details, {
            changed: false,
            effect: "none",
            detail: "noop"
          });
          flushCommandDryRun(context);
          return false;
        }
        observers?.onError?.(details, error);
        throw error;
      }
    }
    case "removeFile": {
      validateHomeRelativePath(mutation.target, context);
      const targetPath = resolvePath(mutation.target, context);
      const details = createMutationDetails(
        mutation,
        manifestId,
        targetPath,
        context
      );
      observers?.onStart?.(details);
      try {
        const raw = await context.fs.readFile(targetPath, "utf8");
        const trimmed = raw.trim();
        if (
          mutation.whenContentMatches &&
          !mutation.whenContentMatches.test(trimmed)
        ) {
          observers?.onComplete?.(details, {
            changed: false,
            effect: "none",
            detail: "noop"
          });
          flushCommandDryRun(context);
          return false;
        }
        if (mutation.whenEmpty && trimmed.length > 0) {
          observers?.onComplete?.(details, {
            changed: false,
            effect: "none",
            detail: "noop"
          });
          flushCommandDryRun(context);
          return false;
        }
        await context.fs.unlink(targetPath);
        observers?.onComplete?.(details, {
          changed: true,
          effect: "delete",
          detail: "delete"
        });
        flushCommandDryRun(context);
        return true;
      } catch (error) {
        if (isNotFound(error)) {
          observers?.onComplete?.(details, {
            changed: false,
            effect: "none",
            detail: "noop"
          });
          flushCommandDryRun(context);
          return false;
        }
        observers?.onError?.(details, error);
        throw error;
      }
    }
    case "transformFile": {
      validateHomeRelativePath(mutation.target, context);
      const targetPath = resolvePath(mutation.target, context);
      const current = await readFileIfExists(context.fs, targetPath);
      const details = createMutationDetails(
        mutation,
        manifestId,
        targetPath,
        context
      );
      observers?.onStart?.(details);
      try {
        const result = await mutation.transform({
          content: current,
          context: mutationContext(context)
        });
        const transformOutcome = await persistTransformResult({
          fs: context.fs,
          targetPath,
          previousContent: current,
          result
        });
        observers?.onComplete?.(details, transformOutcome);
        flushCommandDryRun(context);
        return transformOutcome.changed;
      } catch (error) {
        observers?.onError?.(details, error);
        throw error;
      }
    }
    default: {
      const neverMutation: never = mutation;
      throw new Error(`Unsupported mutation kind: ${(neverMutation as any).kind}`);
    }
  }
}

function validateHomeRelativePath<Options>(
  resolver: ValueResolver<Options, string> | TargetLocation<Options>,
  context: ServiceExecutionContext<Options>
): void {
  const raw = resolveRawPathResolver(resolver, context);
  if (typeof raw !== "string" || raw.length === 0) {
    return;
  }
  if (raw.startsWith("~")) {
    return;
  }
  throw new Error(
    `Service manifest targets must live under home (~): received "${raw}".`
  );
}

function resolveRawPathResolver<Options>(
  resolver: ValueResolver<Options, string> | TargetLocation<Options>,
  context: ServiceExecutionContext<Options>
): string {
  const location = normalizeResolverToLocation(resolver);
  if ("target" in location && location.target !== undefined) {
    return resolveValue(location.target, mutationContext(context));
  }
  return resolveValue(location.targetDirectory, mutationContext(context));
}

function mutationContext<Options>(
  context: ServiceExecutionContext<Options>
): MutationContext<Options> {
  return {
    fs: context.fs,
    options: context.options,
    env: context.env
  };
}

function createMutationDetails<Options>(
  mutation: ServiceMutation<Options>,
  manifestId: string,
  targetPath: string | undefined,
  context: ServiceExecutionContext<Options>
): MutationLogDetails {
  const customLabel =
    mutation.label != null
      ? resolveValue(mutation.label, mutationContext(context))
      : undefined;
  const label =
    customLabel ?? describeMutationOperation(mutation.kind, targetPath);

  return {
    manifestId,
    kind: mutation.kind,
    label,
    targetPath
  };
}

function describeMutationOperation(
  kind: ServiceMutationKind,
  targetPath?: string
): string {
  const displayPath = targetPath ?? "target";
  switch (kind) {
    case "ensureDirectory":
      return `Create ${displayPath}`;
    case "createBackup":
      return `Backup ${displayPath}`;
    case "writeTemplate":
      return `Write ${displayPath}`;
    case "chmod":
      return `Set permissions on ${displayPath}`;
    case "removeFile":
      return `Remove ${displayPath}`;
    case "transformFile":
      return `Update ${displayPath}`;
    default:
      return "Operation";
  }
}

function resolveValue<Options, Value>(
  resolver: ValueResolver<Options, Value>,
  context: MutationContext<Options>
): Value {
  if (typeof resolver === "function") {
    return (resolver as (ctx: MutationContext<Options>) => Value)(context);
  }
  return resolver;
}

function resolvePath<Options>(
  resolver: ValueResolver<Options, string> | TargetLocation<Options>,
  context: ServiceExecutionContext<Options>
): string {
  const location = normalizeResolverToLocation(resolver);
  if ("target" in location && location.target !== undefined) {
    const raw = resolveValue(location.target, mutationContext(context));
    const expanded = expandHomeShortcut(raw, context.env);
    if (!context.pathMapper) {
      return expanded;
    }
    const rawDirectory = path.dirname(expanded);
    const mappedDirectory = context.pathMapper.mapTargetDirectory({
      targetDirectory: rawDirectory,
      env: context.env
    });
    const rawFile = path.basename(expanded);
    return rawFile.length === 0 ? mappedDirectory : path.join(mappedDirectory, rawFile);
  }

  const rawDirectory = resolveValue(
    location.targetDirectory,
    mutationContext(context)
  );
  const expandedDirectory = expandHomeShortcut(rawDirectory, context.env);
  const mappedDirectory = context.pathMapper
    ? context.pathMapper.mapTargetDirectory({
        targetDirectory: expandedDirectory,
        env: context.env
      })
    : expandedDirectory;
  if (location.targetFile === undefined) {
    return mappedDirectory;
  }
  const rawFile = resolveValue(location.targetFile, mutationContext(context));
  return rawFile.length === 0 ? mappedDirectory : path.join(mappedDirectory, rawFile);
}

function normalizeResolverToLocation<Options>(
  resolver: ValueResolver<Options, string> | TargetLocation<Options>
): TargetLocation<Options> {
  if (typeof resolver === "object" && resolver != null) {
    if ("target" in resolver || "targetDirectory" in resolver) {
      return resolver as TargetLocation<Options>;
    }
  }
  return {
    target: resolver as ValueResolver<Options, string>
  };
}

function normalizeTargetLocation<Options>(config: {
  target?: ValueResolver<Options, string>;
  targetDirectory?: ValueResolver<Options, string>;
  targetFile?: ValueResolver<Options, string>;
}): TargetLocation<Options> {
  if (config.target) {
    return { target: config.target };
  }
  if (config.targetDirectory) {
    return {
      targetDirectory: config.targetDirectory,
      targetFile: config.targetFile
    };
  }
  throw new Error("Missing target for service manifest mutation.");
}

function resolveTargetPath<Options>(
  config: {
    target?: ValueResolver<Options, string>;
    targetDirectory?: ValueResolver<Options, string>;
    targetFile?: ValueResolver<Options, string>;
  },
  context: MutationContext<Options>
): string {
  if (config.target) {
    return expandHomeShortcut(resolveValue(config.target, context), context.env);
  }
  if (!config.targetDirectory) {
    throw new Error("Missing targetDirectory.");
  }
  const directory = expandHomeShortcut(
    resolveValue(config.targetDirectory, context),
    context.env
  );
  if (!config.targetFile) {
    return directory;
  }
  const file = resolveValue(config.targetFile, context);
  return file.length === 0 ? directory : path.join(directory, file);
}

function flushCommandDryRun<Options>(
  context: ServiceExecutionContext<Options>
): void {
  context.command.flushDryRun({ emitIfEmpty: false });
}

function expandHomeShortcut(
  targetPath: string,
  env?: CliEnvironment
): string {
  if (!targetPath?.startsWith("~")) {
    return targetPath;
  }
  if (targetPath.startsWith("~./")) {
    targetPath = `~/.${targetPath.slice(3)}`;
  }
  const homeDir = env?.homeDir ?? process.env.HOME ?? process.env.USERPROFILE;
  if (!homeDir) {
    return targetPath;
  }
  let remainder = targetPath.slice(1);
  if (remainder.startsWith("/")) {
    remainder = remainder.slice(1);
  } else if (remainder.startsWith("\\")) {
    remainder = remainder.slice(1);
  } else if (remainder.startsWith(".")) {
    remainder = remainder.slice(1);
    if (remainder.startsWith("/")) {
      remainder = remainder.slice(1);
    } else if (remainder.startsWith("\\")) {
      remainder = remainder.slice(1);
    }
  }
  return remainder.length === 0 ? homeDir : path.join(homeDir, remainder);
}

function parseJson(content: string | null): JsonObject {
  if (content == null) {
    return {};
  }
  const parsed = JSON.parse(content);
  if (!isJsonObject(parsed)) {
    throw new Error("Expected JSON object for manifest-managed file.");
  }
  return parsed;
}

async function parseJsonWithRecovery(input: {
  content: string | null;
  fs: FileSystem;
  targetPath: string;
}): Promise<JsonObject> {
  try {
    return parseJson(input.content);
  } catch {
    await backupInvalidJsonDocument(input);
    return {};
  }
}

async function parseTomlWithRecovery(input: {
  content: string | null;
  fs: FileSystem;
  targetPath: string;
}): Promise<TomlTable> {
  if (input.content == null) {
    return {};
  }
  try {
    return parseTomlDocument(input.content);
  } catch {
    await backupInvalidTomlDocument(input);
    return {};
  }
}

async function backupInvalidJsonDocument(input: {
  content: string | null;
  fs: FileSystem;
  targetPath: string;
}): Promise<void> {
  if (input.content == null) {
    return;
  }
  const backupPath = createInvalidDocumentBackupPath(input.targetPath);
  await input.fs.writeFile(backupPath, input.content, { encoding: "utf8" });
}

async function backupInvalidTomlDocument(input: {
  content: string | null;
  fs: FileSystem;
  targetPath: string;
}): Promise<void> {
  if (input.content == null) {
    return;
  }
  const backupPath = createInvalidDocumentBackupPath(input.targetPath);
  await input.fs.writeFile(backupPath, input.content, { encoding: "utf8" });
}

function createInvalidDocumentBackupPath(targetPath: string): string {
  return `${targetPath}.invalid-${createTimestamp()}.json`;
}

function createTimestamp(): string {
  return new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
}

function serializeJson(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function persistTransformResult(input: {
  fs: FileSystem;
  targetPath: string;
  previousContent: string | null;
  result: TransformResult;
}): Promise<ServiceMutationOutcome> {
  if (!input.result.changed) {
    return { changed: false, effect: "none", detail: "noop" };
  }
  if (input.result.content == null) {
    if (input.previousContent == null) {
      return { changed: false, effect: "none", detail: "noop" };
    }
    await input.fs.unlink(input.targetPath);
    return { changed: true, effect: "delete", detail: "delete" };
  }
  await input.fs.writeFile(input.targetPath, input.result.content, {
    encoding: "utf8"
  });
  return {
    changed: true,
    effect: "write",
    detail: input.previousContent == null ? "create" : "update"
  };
}

async function readFileIfExists(
  fs: FileSystem,
  target: string
): Promise<string | null> {
  try {
    return await fs.readFile(target, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function pathExists(fs: FileSystem, target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export interface ServiceRunOptions {
  observers?: ServiceMutationObservers;
}

export type ServiceMutationKind = ServiceMutation<unknown>["kind"];
