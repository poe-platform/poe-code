import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ResolvedConfig, SchemaField, ScopeDefinition } from "./types.js";

export interface RuntimeMount {
  source: string;
  target: string;
  readonly?: boolean;
}

export interface RunnerScope {
  detach: boolean;
  upload_max_file_mb: number;
  download_conflict: "refuse" | "overwrite";
  sync: "both" | "upload" | "none";
  workspace?: {
    exclude?: string[];
  };
}

interface SharedRuntimeFields {
  build_args: Record<string, string>;
  mounts: RuntimeMount[];
  link?: string;
}

export interface HostRuntime extends SharedRuntimeFields {
  type: "host";
}

export interface DockerRuntime extends SharedRuntimeFields {
  type: "docker";
  image?: string;
  dockerfile?: string;
  build_context?: string;
  engine?: "docker" | "podman";
  network?: string;
  extra_args?: string[];
}

export interface E2bRuntime extends SharedRuntimeFields {
  type: "e2b";
  template_id?: string;
  from_template?: string;
  dockerfile?: string;
  build_context?: string;
  workspace_dir?: string;
  cpu?: number;
  memory_mb?: number;
  timeout_minutes?: number;
  preserve_after_exit_hours?: number;
}

export type RuntimeConfig = HostRuntime | DockerRuntime | E2bRuntime;
export type RuntimeRunner = RuntimeConfig["type"];

const defaultWorkspaceExclude = [
  ".git",
  "node_modules",
  "dist",
  ".turbo",
  ".next",
  ".poe-code/state.json"
];

export interface RuntimeResolveResult {
  runtime: RuntimeConfig;
  runner: RuntimeRunner;
  dockerfilePath: string | null;
  buildContext: string | null;
}

type RuntimeResolver = (input: { cwd: string; runtime: RuntimeConfig }) => RuntimeResolveResult;

export const runtimeConfigScope = deepFreeze({
  scope: "runtime",
  schema: {
    type: {
      type: "string",
      default: "host",
      doc: "Runtime backend: host, docker, or e2b"
    },
    build_args: {
      type: "json",
      default: {} as Record<string, string>,
      parse: parseBuildArgs,
      doc: "Build arguments passed to the runtime image build"
    },
    mounts: {
      type: "json",
      default: [] as RuntimeMount[],
      parse: parseMounts,
      doc: "Additional runtime mounts"
    },
    runner: {
      type: "json",
      default: createDefaultRunnerScope(),
      parse: parseRunner,
      doc: "Runner process and workspace transfer settings"
    },
    link: {
      type: "string",
      default: "",
      doc: "Informational link for the runtime definition"
    },
    image: {
      type: "string",
      default: "",
      doc: "Prebuilt Docker image"
    },
    dockerfile: {
      type: "string",
      default: "",
      doc: "Path to the Dockerfile used for docker or e2b builds"
    },
    build_context: {
      type: "string",
      default: "",
      doc: "Path to the Docker build context"
    },
    workspace_dir: {
      type: "string",
      default: "/workspace",
      doc: "Sandbox-local workspace directory for E2B runtime upload, execution, and download"
    },
    engine: {
      type: "string",
      default: "",
      doc: "Container engine for Docker runtime"
    },
    network: {
      type: "string",
      default: "",
      doc: "Docker network"
    },
    extra_args: {
      type: "json",
      default: undefined as string[] | undefined,
      parse: parseOptionalStringArray,
      doc: "Extra Docker runtime arguments"
    },
    template_id: {
      type: "string",
      default: "",
      doc: "Prebuilt E2B template id"
    },
    from_template: {
      type: "string",
      default: "",
      doc: "Existing E2B template alias to extend instead of using the Dockerfile FROM image"
    },
    cpu: {
      type: "json",
      default: undefined as number | undefined,
      parse: parseOptionalNumber,
      doc: "E2B CPU count"
    },
    memory_mb: {
      type: "json",
      default: undefined as number | undefined,
      parse: parseOptionalNumber,
      doc: "E2B memory in megabytes"
    },
    timeout_minutes: {
      type: "json",
      default: undefined as number | undefined,
      parse: parseOptionalNumber,
      doc: "E2B timeout in minutes"
    },
    preserve_after_exit_hours: {
      type: "json",
      default: undefined as number | undefined,
      parse: parseOptionalNumber,
      doc: "Hours to keep an E2B sandbox alive after job exit"
    }
  }
} satisfies ScopeDefinition<Record<string, SchemaField>>);

export function parseRunner(raw: unknown): RunnerScope {
  if (raw === undefined) {
    return createDefaultRunnerScope();
  }
  const record = asRecord(raw);
  if (record === undefined) {
    throw new Error("runner: expected an object.");
  }

  const uploadMaxFileMb =
    parseOptionalNumber(getOwnEntry(record, "upload_max_file_mb"), "runner.upload_max_file_mb") ??
    100;
  if (uploadMaxFileMb <= 0) {
    throw new Error("runner.upload_max_file_mb: expected a positive finite number.");
  }

  return omitUndefined({
    detach: parseOptionalBoolean(getOwnEntry(record, "detach"), "runner.detach") ?? false,
    upload_max_file_mb: uploadMaxFileMb,
    download_conflict: parseDownloadConflict(getOwnEntry(record, "download_conflict")),
    sync: parseRunnerSync(getOwnEntry(record, "sync")),
    workspace: parseRunnerWorkspace(getOwnEntry(record, "workspace"))
  });
}

export function parseRuntime(raw: unknown): RuntimeConfig {
  if (raw === undefined) {
    return {
      type: "host",
      build_args: {},
      mounts: []
    };
  }
  const record = asRecord(raw);
  if (record === undefined) {
    throw new Error("runtime: expected an object.");
  }
  const type = parseRuntimeType(getOwnEntry(record, "type"));
  const shared = parseSharedRuntimeFields(record);

  if (type === "docker") {
    return omitUndefined({
      ...shared,
      type,
      image: parseOptionalNonEmptyString(getOwnEntry(record, "image"), "image"),
      dockerfile: parseOptionalString(getOwnEntry(record, "dockerfile")),
      build_context: parseOptionalString(getOwnEntry(record, "build_context")),
      engine: parseEngine(getOwnEntry(record, "engine")),
      network: parseOptionalString(getOwnEntry(record, "network")),
      extra_args: parseOptionalStringArray(getOwnEntry(record, "extra_args"))
    });
  }

  if (type === "e2b") {
    const preserveAfterExitHours =
      parseOptionalNumber(getOwnEntry(record, "preserve_after_exit_hours")) ?? 24;
    if (preserveAfterExitHours < 0 || preserveAfterExitHours > 168) {
      throw new Error("preserve_after_exit_hours: expected a number from 0 to 168.");
    }
    const cpu = parseOptionalNumber(getOwnEntry(record, "cpu"));
    if (cpu !== undefined && cpu <= 0) {
      throw new Error("cpu: expected a positive finite number.");
    }
    const memoryMb = parseOptionalNumber(getOwnEntry(record, "memory_mb"));
    if (memoryMb !== undefined && memoryMb <= 0) {
      throw new Error("memory_mb: expected a positive finite number.");
    }
    const timeoutMinutes = parseOptionalNumber(getOwnEntry(record, "timeout_minutes"));
    if (timeoutMinutes !== undefined && timeoutMinutes < 0) {
      throw new Error("timeout_minutes: expected a non-negative finite number.");
    }

    return omitUndefined({
      ...shared,
      type,
      template_id: parseOptionalNonEmptyString(getOwnEntry(record, "template_id"), "template_id"),
      from_template: parseOptionalString(getOwnEntry(record, "from_template")),
      dockerfile: parseOptionalString(getOwnEntry(record, "dockerfile")),
      build_context: parseOptionalString(getOwnEntry(record, "build_context")),
      workspace_dir: parseWorkspaceDir(getOwnEntry(record, "workspace_dir")),
      cpu,
      memory_mb: memoryMb,
      timeout_minutes: timeoutMinutes,
      preserve_after_exit_hours: preserveAfterExitHours
    });
  }

  return {
    ...shared,
    type
  };
}

export function resolveRuntime({
  cwd,
  config
}: {
  cwd: string;
  config: Pick<ResolvedConfig, "runtime">;
}): RuntimeResolveResult {
  const runtime = getOwnEntry(config as unknown as Record<string, unknown>, "runtime");
  if (!isRuntimeConfig(runtime)) {
    throw new Error("runtime config is required.");
  }
  const type = getRuntimeType(runtime);
  return runtimeResolvers[type]({ cwd, runtime });
}

const runtimeResolvers: Record<RuntimeConfig["type"], RuntimeResolver> = {
  host({ runtime }) {
    return {
      runtime,
      runner: "host",
      dockerfilePath: null,
      buildContext: null
    };
  },
  docker({ cwd, runtime }) {
    const dockerRuntime = runtime as DockerRuntime;
    if (getOptionalRuntimeString(dockerRuntime, "image") !== undefined) {
      return {
        runtime: dockerRuntime,
        runner: "docker",
        dockerfilePath: null,
        buildContext: null
      };
    }

    const { dockerfilePath, buildContext } = resolveRuntimeBuildPaths(cwd, dockerRuntime);
    if (!existsSync(dockerfilePath)) {
      throw new Error(`Docker runtime requires image or a Dockerfile at ${dockerfilePath}.`);
    }
    if (!existsSync(buildContext)) {
      throw new Error(`runtime.build_context does not exist: ${buildContext}.`);
    }
    assertRuntimePathInsideCwd(cwd, dockerfilePath, "runtime.dockerfile");
    assertRuntimePathInsideCwd(cwd, buildContext, "runtime.build_context");
    return {
      runtime: dockerRuntime,
      runner: "docker",
      dockerfilePath,
      buildContext
    };
  },
  e2b({ cwd, runtime }) {
    const e2bRuntime = runtime as E2bRuntime;
    if (getOptionalRuntimeString(e2bRuntime, "template_id") !== undefined) {
      return {
        runtime: e2bRuntime,
        runner: "e2b",
        dockerfilePath: null,
        buildContext: null
      };
    }

    const { dockerfilePath, buildContext } = resolveRuntimeBuildPaths(cwd, e2bRuntime);
    if (!existsSync(dockerfilePath)) {
      throw new Error(`E2B runtime requires template_id or a Dockerfile at ${dockerfilePath}.`);
    }
    if (!existsSync(buildContext)) {
      throw new Error(`runtime.build_context does not exist: ${buildContext}.`);
    }
    assertRuntimePathInsideCwd(cwd, dockerfilePath, "runtime.dockerfile");
    assertRuntimePathInsideCwd(cwd, buildContext, "runtime.build_context");
    return {
      runtime: e2bRuntime,
      runner: "e2b",
      dockerfilePath,
      buildContext
    };
  }
};

function resolveRuntimeBuildPaths(
  cwd: string,
  runtime: DockerRuntime | E2bRuntime
): { dockerfilePath: string; buildContext: string } {
  return {
    dockerfilePath: path.resolve(
      cwd,
      getOptionalRuntimeString(runtime, "dockerfile") ?? path.join(".poe-code", "Dockerfile")
    ),
    buildContext: path.resolve(cwd, getOptionalRuntimeString(runtime, "build_context") ?? ".")
  };
}

function assertRuntimePathInsideCwd(cwd: string, targetPath: string, fieldName: string): void {
  const canonicalCwd = realpathSync(cwd);
  const canonicalTarget = realpathSync(targetPath);
  if (!isPathInsideOrEqual(canonicalCwd, canonicalTarget)) {
    throw new Error(`${fieldName} must remain inside runtime cwd ${canonicalCwd}.`);
  }
}

function isPathInsideOrEqual(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function parseSharedRuntimeFields(record: Record<string, unknown>): SharedRuntimeFields {
  return omitUndefined({
    build_args: parseBuildArgs(getOwnEntry(record, "build_args")),
    mounts: parseMounts(getOwnEntry(record, "mounts")),
    link: parseOptionalString(getOwnEntry(record, "link"))
  });
}

function parseRuntimeType(value: unknown): RuntimeConfig["type"] {
  if (value === undefined) {
    return "host";
  }
  if (value === "host" || value === "docker" || value === "e2b") {
    return value;
  }
  throw new Error('type: expected "host", "docker", or "e2b".');
}

function parseWorkspaceDir(value: unknown): string {
  const workspaceDir = parseOptionalString(value) ?? "/workspace";
  if (!path.posix.isAbsolute(workspaceDir)) {
    throw new Error("workspace_dir: expected an absolute sandbox path.");
  }
  let normalized = path.posix.normalize(workspaceDir);
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function createDefaultRunnerScope(): RunnerScope {
  return {
    detach: false,
    upload_max_file_mb: 100,
    download_conflict: "refuse",
    sync: "both",
    workspace: {
      exclude: [...defaultWorkspaceExclude]
    }
  };
}

function parseRunnerWorkspace(value: unknown): RunnerScope["workspace"] {
  if (value === undefined) {
    return {
      exclude: [...defaultWorkspaceExclude]
    };
  }
  const record = asRecord(value);
  if (record === undefined) {
    throw new Error("runner.workspace: expected an object.");
  }

  return {
    exclude: parseOptionalStringArray(getOwnEntry(record, "exclude"), "runner.workspace.exclude") ??
      [...defaultWorkspaceExclude]
  };
}

function parseDownloadConflict(value: unknown): RunnerScope["download_conflict"] {
  if (value === undefined) {
    return "refuse";
  }
  if (value === "refuse" || value === "overwrite") {
    return value;
  }
  throw new Error('runner.download_conflict: expected "refuse" or "overwrite".');
}

function parseRunnerSync(value: unknown): RunnerScope["sync"] {
  if (value === undefined) {
    return "both";
  }
  if (value === "both" || value === "upload" || value === "none") {
    return value;
  }
  throw new Error('runner.sync: expected "both", "upload", or "none".');
}

function parseBuildArgs(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  const record = asRecord(value);
  if (record === undefined) {
    throw new Error("build_args: expected an object.");
  }

  const parsed: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    assertBuildArgName(key);
    if (typeof entry !== "string") {
      throw new Error(`build_args.${key}: expected a string.`);
    }
    defineDataProperty(parsed, key, entry);
  }
  return parsed;
}

function parseMounts(value: unknown): RuntimeMount[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("mounts: expected an array.");
  }

  return value.map((entry, index) => {
    const record = asRecord(entry);
    if (record === undefined) {
      throw new Error(`mounts[${index}]: expected an object.`);
    }
    const source = getOwnEntry(record, "source");
    const target = getOwnEntry(record, "target");
    if (typeof source !== "string") {
      throw new Error(`mounts[${index}].source: expected a string.`);
    }
    if (source.trim().length === 0) {
      throw new Error(`mounts[${index}].source: expected a non-empty string.`);
    }
    if (typeof target !== "string") {
      throw new Error(`mounts[${index}].target: expected a string.`);
    }
    if (
      target.trim().length === 0 ||
      target !== target.trim() ||
      !path.posix.isAbsolute(target)
    ) {
      throw new Error(`mounts[${index}].target: expected a non-empty absolute sandbox path.`);
    }

    return omitUndefined({
      source,
      target,
      readonly: parseOptionalBoolean(getOwnEntry(record, "readonly"), `mounts[${index}].readonly`)
    });
  });
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("expected a string.");
  }
  if (value.length === 0) {
    return undefined;
  }
  return value;
}

function parseOptionalNonEmptyString(value: unknown, key: string): string | undefined {
  const parsed = parseOptionalString(value);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed.trim().length === 0) {
    throw new Error(`${key}: expected a non-empty string.`);
  }
  return parsed;
}

function assertBuildArgName(key: string): void {
  if (key.length === 0 || key !== key.trim()) {
    throw new Error(`build_args.${key}: expected an environment-style argument name.`);
  }
  for (let index = 0; index < key.length; index += 1) {
    const charCode = key.charCodeAt(index);
    const isUppercase = charCode >= 65 && charCode <= 90;
    const isLowercase = charCode >= 97 && charCode <= 122;
    const isDigit = charCode >= 48 && charCode <= 57;
    const isUnderscore = charCode === 95;
    if (!isUppercase && !isLowercase && !isDigit && !isUnderscore) {
      throw new Error(`build_args.${key}: expected an environment-style argument name.`);
    }
  }
}

function defineDataProperty(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const entry of Object.values(value)) {
    deepFreeze(entry);
  }

  return Object.freeze(value);
}

function parseOptionalStringArray(value: unknown, key = ""): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${key ? `${key}: ` : ""}expected an array.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${key}[${index}]: expected a string.`);
    }
    return entry;
  });
}

function parseEngine(value: unknown): "docker" | "podman" | undefined {
  const engine = parseOptionalString(value);
  if (engine === undefined || engine === "docker" || engine === "podman") {
    return engine;
  }
  throw new Error('engine: expected "docker" or "podman".');
}

function parseOptionalNumber(value: unknown, key = ""): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key ? `${key}: ` : ""}expected a finite number.`);
  }
  return value;
}

function parseOptionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${key}: expected a boolean.`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function isRuntimeConfig(value: unknown): value is RuntimeConfig {
  return asRecord(value) !== undefined;
}

function getRuntimeType(runtime: RuntimeConfig): RuntimeConfig["type"] {
  const type = getOwnEntry(runtime as unknown as Record<string, unknown>, "type");
  if (type === "host" || type === "docker" || type === "e2b") {
    return type;
  }
  throw new Error('runtime.type: expected "host", "docker", or "e2b".');
}

function getOptionalRuntimeString(
  runtime: DockerRuntime | E2bRuntime,
  key: "build_context" | "dockerfile" | "image" | "template_id"
): string | undefined {
  const value = getOwnEntry(runtime as unknown as Record<string, unknown>, key);
  return typeof value === "string" ? value : undefined;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
