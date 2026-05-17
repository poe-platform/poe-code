import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";

import { lockWorkflow, resolveRunLogDir } from "@poe-code/agent-harness-tools";
import { lint, parseModule, run, splitFrontmatter, type Diagnostic } from "@poe-code/agent-script";
import type { AnySchema } from "toolcraft-schema";

import { makeSchemaModule } from "../modules/schema.js";
import { extractSchema } from "./extract-schema.js";
import { resolvePair } from "./pair.js";
import { validateFrontmatter } from "./validate.js";

type RunOptions = NonNullable<Parameters<typeof run>[1]>;
type LintOptions = NonNullable<Parameters<typeof lint>[1]>;
export type RunResult = Awaited<ReturnType<typeof run>>;
export type ModuleExports = ReadonlyMap<string, unknown> | Record<string, unknown>;
export type ModuleRegistry = ReadonlyMap<string, ModuleExports> | Record<string, ModuleExports>;

export type HarnessImportMeta = {
  kind: string | undefined;
  version: number | undefined;
  filename: string;
  dirname: string;
  body: string;
};

export type RunHarnessPairOptions = {
  allowedGlobals?: LintOptions["allowedGlobals"];
  modulesFor: (frontmatter: Record<string, unknown>, meta: HarnessImportMeta) => ModuleRegistry;
  onDiagnostics?: (diagnostics: readonly Diagnostic[]) => void;
  resume?: boolean;
  signal?: AbortSignal;
  snapshotPath?: string;
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
  const releaseLock = await acquireHarnessLock(pair.mdPath);

  try {
    const [ajsSource, mdSource] = await Promise.all([
      readTextFile(pair.ajsPath),
      readTextFile(pair.mdPath)
    ]);
    const { frontmatter, body } = splitFrontmatter(mdSource);
    const schema = await extractSchema(ajsSource, pair.ajsPath);
    const validated = (
      schema === undefined ? frontmatter : validateFrontmatter(schema, frontmatter, pair.mdPath)
    ) as Record<string, unknown>;
    const meta: HarnessImportMeta = {
      kind: readString(validated.kind),
      version: readNumber(validated.version),
      filename: pair.mdPath,
      dirname: dirname(pair.mdPath),
      body
    };
    const snapshotPath = resolveSnapshotPath(pair.mdPath, options.snapshotPath);
    const shouldResume = options.resume ?? true;
    if (!shouldResume) {
      await cleanupCompletedSnapshot(snapshotPath);
    }
    const hostCallReplay = await createHostCallReplay(snapshotPath);
    const modules = withSchemaModule(
      hostCallReplay.wrapModules(options.modulesFor(validated, meta))
    );

    const diagnostics = [
      ...lint(ajsSource, {
        allowedExportNames: ["schema"],
        allowedGlobals: options.allowedGlobals,
        filename: pair.ajsPath,
        frontmatterFields: readSchemaTopLevelFields(schema),
        modules: createLintModules(modules)
      }),
      ...missingDefaultExportDiagnostics(ajsSource, pair.ajsPath)
    ];
    options.onDiagnostics?.(diagnostics);
    throwOnLintErrors(diagnostics);

    const snapshot = shouldResume ? await readSnapshot(snapshotPath) : undefined;

    let result: RunResult;
    try {
      result = await run(ajsSource, {
        importMeta: meta,
        entryPointArgs: [validated],
        filename: pair.ajsPath,
        modules: modules as RunOptions["modules"],
        signal: options.signal,
        snapshot,
        snapshotPath
      });
    } catch (error) {
      await hostCallReplay.flush().catch(() => undefined);
      throw error;
    }

    await hostCallReplay.flush();
    if (result.ok) {
      await cleanupCompletedSnapshot(snapshotPath);
    }

    return result;
  } finally {
    await releaseLock();
  }
}

async function acquireHarnessLock(mdPath: string): Promise<() => Promise<void>> {
  try {
    return await lockWorkflow(mdPath, {
      retries: 0
    });
  } catch (error) {
    if (error instanceof Error && error.name === "LockTimeoutError") {
      Object.assign(error, { code: "EEXIST" });
    }

    throw error;
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

function withSchemaModule(modules: ModuleRegistry): ModuleRegistry {
  if (modules instanceof Map) {
    const merged = new Map(modules);
    merged.set("schema", makeSchemaModule() as ModuleExports);
    return merged as ModuleRegistry;
  }

  return {
    ...modules,
    schema: makeSchemaModule()
  } as ModuleRegistry;
}

type HostCallRecord = {
  key: string;
  args: readonly unknown[];
  result: unknown;
};

type HostCallReplay = {
  flush(): Promise<void>;
  wrapModules(modules: ModuleRegistry): ModuleRegistry;
};

async function createHostCallReplay(snapshotPath: string): Promise<HostCallReplay> {
  const storePath = hostCallStorePath(snapshotPath);
  const records = await readHostCallRecords(storePath);
  const pendingWrites = new Set<Promise<void>>();
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
      result
    });
    cursor = records.length;
    const write = writeHostCallRecords(storePath, records);
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
  await writeFile(storePath, serialized);
}

async function cleanupCompletedSnapshot(snapshotPath: string): Promise<void> {
  await Promise.all([
    unlinkIfExists(snapshotPath),
    unlinkIfExists(hostCallStorePath(snapshotPath))
  ]);
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
  return (
    snapshotPath ??
    join(
      resolveRunLogDir({
        planPath: mdPath,
        runner: "harness",
        homeDir: os.homedir()
      }),
      "snapshot.json"
    )
  );
}

async function readSnapshot(snapshotPath: string): Promise<RunOptions["snapshot"]> {
  try {
    return JSON.parse(await readFile(snapshotPath, "utf8")) as RunOptions["snapshot"];
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
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
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
