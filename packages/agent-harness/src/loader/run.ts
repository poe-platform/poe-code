import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, parse, resolve, sep } from "node:path";

import { resolveRunLogDir } from "@poe-code/agent-harness-tools";
import {
  lint,
  FileSnapshotBackend,
  createSpawnUsageAccumulator,
  makeTimeModule,
  parseModule,
  run,
  splitFrontmatter,
  runWithSpawnUsageAccumulator,
  type Diagnostic,
  type OtelSink,
  type RunClock,
  type RunClockSnapshot,
  type RunRandom,
  type SnapshotBackend,
  type SpawnUsageTotal
} from "@poe-code/agent-script";
import type { AnySchema } from "toolcraft-schema";

import { hasOwnErrorCode } from "../error-codes.js";
import { makeSchemaModule } from "../modules/schema.js";
import { extractSchema } from "./extract-schema.js";
import { resolvePair } from "./pair.js";
import { validateFrontmatter } from "./validate.js";

type RunOptions = NonNullable<Parameters<typeof run>[1]>;
type LintOptions = NonNullable<Parameters<typeof lint>[1]>;
export type RunResult = Awaited<ReturnType<typeof run>> & { usage: SpawnUsageTotal };
export type ModuleExports = ReadonlyMap<string, unknown> | Record<string, unknown>;
export type ModuleRegistry = ReadonlyMap<string, ModuleExports> | Record<string, ModuleExports>;

export type HarnessRunEvent = {
  name: "harness.usage.totalled";
  payload: SpawnUsageTotal;
};

export type HarnessImportMeta = {
  kind: string | undefined;
  version: number | undefined;
  filename: string;
  dirname: string;
  body: string;
};

export type RunHarnessPairOptions = {
  allowedGlobals?: LintOptions["allowedGlobals"];
  clock?: {
    now: () => number;
  };
  fix?: boolean;
  frontmatterOverrides?: Record<string, unknown>;
  modulesFor: (frontmatter: Record<string, unknown>, meta: HarnessImportMeta) => ModuleRegistry;
  onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
  onEvent?: (event: HarnessRunEvent) => void;
  otelSink?: OtelSink;
  preserveSnapshotOnSuccess?: boolean;
  randomSeed?: number;
  resume?: boolean;
  signal?: AbortSignal;
  snapshotBackend?: SnapshotBackend;
  snapshotIntervalMs?: number;
  snapshotPath?: string;
  snapshotPathIsDefault?: boolean;
};

export class LintError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(diagnostics: readonly Diagnostic[]) {
    super(formatLintErrorMessage(diagnostics));
    this.name = "LintError";
    this.diagnostics = diagnostics;
  }
}

export async function runHarnessPair(
  mdPath: string,
  options: RunHarnessPairOptions
): Promise<RunResult> {
  const pair = await resolvePair(mdPath);
  {
    const [ajsSource, mdSource] = await Promise.all([
      readTextFile(pair.ajsPath),
      readTextFile(pair.mdPath)
    ]);
    const { frontmatter, body } = splitFrontmatter(mdSource);
    const merged =
      options.frontmatterOverrides === undefined
        ? frontmatter
        : deepMergeFrontmatter(frontmatter, options.frontmatterOverrides);
    const schema = await extractSchema(ajsSource, pair.ajsPath);
    const validated = (
      schema === undefined ? merged : validateFrontmatter(schema, merged, pair.mdPath)
    ) as Record<string, unknown>;
    const meta: HarnessImportMeta = {
      kind: readString(validated.kind),
      version: readNumber(validated.version),
      filename: pair.mdPath,
      dirname: dirname(pair.mdPath),
      body
    };
    const snapshotPath = resolveSnapshotPath(pair.mdPath, options.snapshotPath);
    const guardDefaultSnapshotPath =
      options.snapshotPath === undefined || options.snapshotPathIsDefault === true;
    if (guardDefaultSnapshotPath) {
      await assertDefaultSnapshotPathIsRegular(snapshotPath);
    }
    const snapshotBackend = options.snapshotBackend ?? new FileSnapshotBackend(snapshotPath);
    const shouldResume = options.resume ?? true;
    if (!shouldResume) {
      await cleanupCompletedSnapshot(snapshotBackend, snapshotPath);
    }
    const snapshot = shouldResume ? await snapshotBackend.read() : undefined;
    const runtimeClock = createReplayableClock({
      now: options.clock?.now,
      snapshot: snapshot?.clock
    });
    const runtimeRandom = createReplayableRandom({
      seed: options.randomSeed,
      snapshot
    });
    const hostCallReplay = await createHostCallReplay(snapshotPath, {
      "time.now": {
        restore: restoreClockState(runtimeClock),
        snapshot: runtimeClock.snapshot
      },
      ...(runtimeRandom === undefined
        ? {}
        : {
            "time.random": {
              restore: restoreRandomState(runtimeRandom),
              snapshot: runtimeRandom.snapshot
            },
            "time.uuid": {
              restore: restoreRandomState(runtimeRandom),
              snapshot: runtimeRandom.snapshot
            }
          })
    }, { guardDefaultSnapshotPath });
    const modules = hostCallReplay.wrapModules(
      withBuiltinModules(
        options.modulesFor(validated, meta),
        makeTimeModule({
          now: runtimeClock.now,
          random: runtimeRandom?.next
        })
      )
    );

    let executableSource = ajsSource;
    const lintOptions = {
      allowedExportNames: ["schema"],
      allowedGlobals: options.allowedGlobals,
      filename: pair.ajsPath,
      frontmatterFields: readSchemaTopLevelFields(schema),
      modules: createLintModules(modules)
    };
    const lintDiagnostics = options.fix
      ? lint(ajsSource, { ...lintOptions, fix: true })
      : lint(ajsSource, lintOptions);

    if (!Array.isArray(lintDiagnostics)) {
      executableSource = lintDiagnostics.fixed;
      if (executableSource !== ajsSource) {
        await writeTextFileAtomically(pair.ajsPath, executableSource);
      }
    }

    const diagnostics = [
      ...(Array.isArray(lintDiagnostics) ? lintDiagnostics : lintDiagnostics.diagnostics),
      ...missingDefaultExportDiagnostics(executableSource, pair.ajsPath)
    ];
    options.onDiagnostics?.(diagnostics);
    throwOnLintErrors(diagnostics);

    const usageAccumulator = createSpawnUsageAccumulator();
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await runWithSpawnUsageAccumulator(usageAccumulator, () =>
        run(executableSource, {
          clock: runtimeClock,
          importMeta: meta,
          entryPointArgs: [validated],
          filename: pair.ajsPath,
          modules: modules as RunOptions["modules"],
          otelSink: options.otelSink,
          random: runtimeRandom,
          signal: options.signal,
          snapshot,
          snapshotBackend,
          snapshotIntervalMs: options.snapshotIntervalMs,
          snapshotPath
        })
      );
    } catch (error) {
      await hostCallReplay.flush().catch(() => undefined);
      throw error;
    }

    await hostCallReplay.flush();
    if (result.ok && options.preserveSnapshotOnSuccess !== true) {
      await cleanupCompletedSnapshot(snapshotBackend, snapshotPath);
    }

    const usage = usageAccumulator.snapshot();
    options.onEvent?.({
      name: "harness.usage.totalled",
      payload: usage
    });

    return {
      ...result,
      usage
    };
  }
}

function throwOnLintErrors(diagnostics: readonly Diagnostic[]): void {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new LintError(errors);
  }
}

function missingDefaultExportDiagnostics(source: string, filename: string): Diagnostic[] {
  const module = parseModule(source, filename);
  const hasDefaultExport = module.body.some(
    (statement) => statement.type === "ExportDefaultDeclaration"
  );
  if (hasDefaultExport) {
    return [];
  }

  return [
    {
      code: "AS-EXPORT-DEFAULT-MISSING",
      severity: "error",
      message: "Module must export a default entry point.",
      filename,
      line: module.span.start.line,
      column: module.span.start.column,
      span: module.span
    }
  ];
}

function readSchemaTopLevelFields(schema: AnySchema | undefined): string[] | undefined {
  if (schema?.kind !== "object") {
    return undefined;
  }

  return Object.keys(schema.shape);
}

function withBuiltinModules(modules: ModuleRegistry, time: ModuleExports): ModuleRegistry {
  if (modules instanceof Map) {
    const merged = new Map(modules);
    if (!merged.has("time")) {
      merged.set("time", time);
    }
    merged.set("schema", makeSchemaModule() as ModuleExports);
    return merged as ModuleRegistry;
  }

  return {
    time,
    ...modules,
    schema: makeSchemaModule()
  } as ModuleRegistry;
}

type ReplayableClock = RunClock & {
  now: () => number;
  restore: (snapshot: RunClockSnapshot) => void;
};

function createReplayableClock(input: {
  now: (() => number) | undefined;
  snapshot: RunClockSnapshot | undefined;
}): ReplayableClock {
  const snapshot = isClockState(input.snapshot) ? input.snapshot : undefined;
  let next = snapshot?.next;
  let replaying = snapshot !== undefined;
  const hostNow = input.now ?? Date.now;

  return {
    now() {
      if (replaying && next !== undefined) {
        const value = next;
        next = value + 1;
        return value;
      }

      const current = hostNow();
      const value = next === undefined ? current : Math.max(current, next);
      next = value + 1;
      return value;
    },
    restore(snapshot) {
      next = snapshot.next;
      replaying = true;
    },
    snapshot() {
      return next === undefined
        ? undefined
        : {
            next
          };
    }
  };
}

type ReplayableRandom = RunRandom & {
  restore: (state: number) => void;
};

function createReplayableRandom(input: {
  seed: number | undefined;
  snapshot: RunOptions["snapshot"] | undefined;
}): ReplayableRandom | undefined {
  if (input.snapshot?.random !== undefined) {
    const generator = createSeededRandom(input.snapshot.random.state);
    return {
      seed: input.snapshot.random.seed,
      next: generator.next,
      restore: generator.restore,
      snapshot: generator.snapshot
    };
  }

  if (input.seed === undefined) {
    return undefined;
  }

  const generator = createSeededRandom(input.seed);
  return {
    seed: Math.trunc(input.seed),
    next: generator.next,
    restore: generator.restore,
    snapshot: generator.snapshot
  };
}

function createSeededRandom(seed: number): Omit<ReplayableRandom, "seed"> {
  let state = normalizeSeed(seed);

  return {
    next: () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 4_294_967_296;
    },
    restore: (nextState) => {
      state = normalizeSeed(nextState);
    },
    snapshot: () => state
  };
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new TypeError("Seeded random requires a finite numeric seed.");
  }

  return Math.trunc(seed) >>> 0;
}

function restoreClockState(clock: ReplayableClock): (state: unknown) => void {
  return (state) => {
    if (isClockState(state)) {
      clock.restore(state);
    }
  };
}

function restoreRandomState(random: ReplayableRandom): (state: unknown) => void {
  return (state) => {
    if (typeof state === "number") {
      random.restore(state);
    }
  };
}

function isClockState(value: unknown): value is RunClockSnapshot {
  if (!hasOwnProperty(value, "next")) return false;
  return typeof value.next === "number" && Number.isFinite(value.next);
}

function hasOwnProperty<Name extends PropertyKey>(
  value: unknown,
  name: Name
): value is Record<Name, unknown> {
  return typeof value === "object" && value !== null && Object.hasOwn(value, name);
}

type HostCallRecord = {
  key: string;
  args: readonly unknown[];
  result: unknown;
  state?: unknown;
};

type HostCallReplay = {
  flush(): Promise<void>;
  wrapModules(modules: ModuleRegistry): ModuleRegistry;
};

type StatefulHostBinding = {
  restore: (state: unknown) => void;
  snapshot: () => unknown;
};

async function createHostCallReplay(
  snapshotPath: string,
  statefulBindings: Record<string, StatefulHostBinding> = {},
  opts: { guardDefaultSnapshotPath?: boolean } = {}
): Promise<HostCallReplay> {
  const storePath = hostCallStorePath(snapshotPath);
  if (opts.guardDefaultSnapshotPath === true) {
    await assertDefaultSnapshotPathIsRegular(storePath);
  }
  const records = await readHostCallRecords(storePath);
  const pendingWrites = new Set<Promise<void>>();
  let writeQueue = Promise.resolve();
  let cursor = 0;

  return {
    async flush() {
      while (pendingWrites.size > 0) {
        await Promise.all([...pendingWrites]);
      }
    },
    wrapModules(modules) {
      if (modules instanceof Map) {
        return new Map(
          [...modules.entries()].map(([moduleName, moduleExports]) => [
            moduleName,
            wrapModuleExports(moduleName, moduleExports)
          ])
        ) as ModuleRegistry;
      }

      return Object.fromEntries(
        Object.entries(modules).map(([moduleName, moduleExports]) => [
          moduleName,
          wrapModuleExports(moduleName, moduleExports)
        ])
      ) as ModuleRegistry;
    }
  };

  function wrapModuleExports(moduleName: string, moduleExports: ModuleExports): ModuleExports {
    if (moduleExports instanceof Map) {
      return new Map(
        [...moduleExports.entries()].map(([exportName, value]) => [
          exportName,
          wrapHostBinding(`${moduleName}.${exportName}`, value)
        ])
      ) as ModuleExports;
    }

    return Object.fromEntries(
      Object.entries(moduleExports).map(([exportName, value]) => [
        exportName,
        wrapHostBinding(`${moduleName}.${exportName}`, value)
      ])
    ) as ModuleExports;
  }

  function wrapHostBinding(key: string, value: unknown): unknown {
    if (typeof value !== "function") {
      return value;
    }

    return (...args: readonly unknown[]) => {
      const replay = records[cursor];
      if (replay !== undefined && replay.key === key && sameJsonValue(replay.args, args)) {
        const stateful = statefulBindings[key];
        if (stateful !== undefined && replay.state !== undefined) {
          stateful.restore(replay.state);
        }
        cursor += 1;
        return replay.result;
      }

      const result = Reflect.apply(value, undefined, args) as unknown;
      if (isPromiseLike(result)) {
        return Promise.resolve(result).then(async (resolved) => {
          await recordHostCall(key, args, resolved);
          return resolved;
        });
      }

      void recordHostCall(key, args, result);
      return result;
    };
  }

  async function recordHostCall(
    key: string,
    args: readonly unknown[],
    result: unknown
  ): Promise<void> {
    records.push({
      key,
      args,
      result,
      state: statefulBindings[key]?.snapshot()
    });
    cursor = records.length;
    const write = writeQueue.then(() => writeHostCallRecords(storePath, records));
    writeQueue = write.catch(() => undefined);
    pendingWrites.add(write);
    try {
      await write;
    } finally {
      pendingWrites.delete(write);
    }
  }
}

async function readHostCallRecords(storePath: string): Promise<HostCallRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as HostCallRecord[]) : [];
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function writeHostCallRecords(
  storePath: string,
  records: readonly HostCallRecord[]
): Promise<void> {
  let serialized: string;
  try {
    serialized = JSON.stringify(records, null, 2);
  } catch {
    return;
  }

  await mkdir(dirname(storePath), { recursive: true });
  await writeTextFileAtomically(storePath, serialized);
}

async function writeTextFileAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryCreated = false;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    temporaryCreated = true;
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (temporaryCreated || !isAlreadyExistsError(error)) {
      await unlinkIfExists(temporaryPath).catch(() => undefined);
    }
    throw error;
  }
}

async function cleanupCompletedSnapshot(
  snapshotBackend: SnapshotBackend,
  snapshotPath: string
): Promise<void> {
  await Promise.all([snapshotBackend.remove(), unlinkIfExists(hostCallStorePath(snapshotPath))]);
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}

function hostCallStorePath(snapshotPath: string): string {
  return `${snapshotPath}.host-calls.json`;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value;
}

function createLintModules(modules: ModuleRegistry): NonNullable<LintOptions["modules"]> {
  const entries = modules instanceof Map ? [...modules.entries()] : Object.entries(modules);

  return new Map(
    entries.map(
      ([moduleName, moduleExports]) => [moduleName, listModuleExports(moduleExports)] as const
    )
  );
}

function listModuleExports(moduleExports: ModuleExports): string[] {
  const exportNames =
    moduleExports instanceof Map ? [...moduleExports.keys()] : Object.keys(moduleExports);
  return exportNames
    .filter((exportName) => exportName.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function resolveSnapshotPath(mdPath: string, snapshotPath: string | undefined): string {
  const documentKey = createHash("sha256").update(resolve(mdPath)).digest("hex").slice(0, 12);
  return (
    snapshotPath ??
    join(
      resolveRunLogDir({
        planPath: mdPath,
        runner: "harness",
        homeDir: os.homedir()
      }),
      `snapshot-${documentKey}.json`
    )
  );
}

async function assertDefaultSnapshotPathIsRegular(snapshotPath: string): Promise<void> {
  const absolutePath = resolve(snapshotPath);
  const rootPath = parse(absolutePath).root;
  let currentPath = rootPath;

  for (const segment of absolutePath.slice(rootPath.length).split(sep).filter(Boolean)) {
    currentPath = join(currentPath, segment);

    try {
      if ((await lstat(currentPath)).isSymbolicLink()) {
        throw new Error("Default harness snapshot path must not contain symbolic links.");
      }
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return;
      }

      throw error;
    }
  }
}

async function readTextFile(path: string): Promise<string> {
  const source = await readFile(path, "utf8");
  return source.startsWith("\uFEFF") ? source.slice(1) : source;
}

function formatLintErrorMessage(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.filename}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}: ${diagnostic.message}`
    )
    .join("\n");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return hasOwnErrorCode(error, code);
}

function deepMergeFrontmatter(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeFrontmatter(existing, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
