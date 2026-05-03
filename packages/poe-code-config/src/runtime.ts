import { existsSync } from "node:fs";
import path from "node:path";
import type { ResolvedConfig, SchemaField, ScopeDefinition } from "./types.js";

export interface RuntimeMount {
  source: string;
  target: string;
  readonly?: boolean;
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
  dockerfile?: string;
  build_context?: string;
  cpu?: number;
  memory_mb?: number;
  timeout_minutes?: number;
  preserve_after_exit_hours?: number;
  api_key_env?: string;
}

export type RuntimeConfig = HostRuntime | DockerRuntime | E2bRuntime;
export type RuntimeRunner = RuntimeConfig["type"];

export interface RuntimeResolveResult {
  runtime: RuntimeConfig;
  runner: RuntimeRunner;
  dockerfilePath: string | null;
  buildContext: string | null;
}

export const runtimeConfigScope = {
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
    },
    api_key_env: {
      type: "string",
      default: "",
      doc: "Environment variable name containing the E2B API key"
    }
  }
} satisfies ScopeDefinition<Record<string, SchemaField>>;

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
  const type = parseRuntimeType(record.type);
  const shared = parseSharedRuntimeFields(record);

  if (type === "docker") {
    return omitUndefined({
      ...shared,
      type,
      image: parseOptionalString(record.image),
      dockerfile: parseOptionalString(record.dockerfile),
      build_context: parseOptionalString(record.build_context),
      engine: parseEngine(record.engine),
      network: parseOptionalString(record.network),
      extra_args: parseOptionalStringArray(record.extra_args)
    });
  }

  if (type === "e2b") {
    const preserveAfterExitHours = parseOptionalNumber(record.preserve_after_exit_hours) ?? 24;
    if (preserveAfterExitHours < 0 || preserveAfterExitHours > 168) {
      throw new Error("preserve_after_exit_hours: expected a number from 0 to 168.");
    }

    return omitUndefined({
      ...shared,
      type,
      template_id: parseOptionalString(record.template_id),
      dockerfile: parseOptionalString(record.dockerfile),
      build_context: parseOptionalString(record.build_context),
      cpu: parseOptionalNumber(record.cpu),
      memory_mb: parseOptionalNumber(record.memory_mb),
      timeout_minutes: parseOptionalNumber(record.timeout_minutes),
      preserve_after_exit_hours: preserveAfterExitHours,
      api_key_env: parseOptionalString(record.api_key_env) ?? "E2B_API_KEY"
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
  config: ResolvedConfig;
}): RuntimeResolveResult {
  const runtime = config.runtime;
  if (runtime.type === "host") {
    return {
      runtime,
      runner: "host",
      dockerfilePath: null,
      buildContext: null
    };
  }

  const dockerfilePath = path.resolve(
    cwd,
    runtime.dockerfile ?? path.join(".poe-code", "Dockerfile")
  );
  const buildContext = path.resolve(cwd, runtime.build_context ?? ".");

  if (runtime.type === "docker") {
    if (runtime.image !== undefined) {
      return {
        runtime,
        runner: "docker",
        dockerfilePath: null,
        buildContext: null
      };
    }
    if (!existsSync(dockerfilePath)) {
      throw new Error(`Docker runtime requires image or a Dockerfile at ${dockerfilePath}.`);
    }
    return {
      runtime,
      runner: "docker",
      dockerfilePath,
      buildContext
    };
  }

  if (runtime.template_id !== undefined) {
    return {
      runtime,
      runner: "e2b",
      dockerfilePath: null,
      buildContext: null
    };
  }
  if (!existsSync(dockerfilePath)) {
    throw new Error(`E2B runtime requires template_id or a Dockerfile at ${dockerfilePath}.`);
  }
  return {
    runtime,
    runner: "e2b",
    dockerfilePath,
    buildContext
  };
}

function parseSharedRuntimeFields(record: Record<string, unknown>): SharedRuntimeFields {
  return omitUndefined({
    build_args: parseBuildArgs(record.build_args),
    mounts: parseMounts(record.mounts),
    link: parseOptionalString(record.link)
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
    if (typeof entry !== "string") {
      throw new Error(`build_args.${key}: expected a string.`);
    }
    parsed[key] = entry;
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
    const source = record.source;
    const target = record.target;
    if (typeof source !== "string") {
      throw new Error(`mounts[${index}].source: expected a string.`);
    }
    if (typeof target !== "string") {
      throw new Error(`mounts[${index}].target: expected a string.`);
    }

    return omitUndefined({
      source,
      target,
      readonly: parseOptionalBoolean(record.readonly, `mounts[${index}].readonly`)
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

function parseOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("expected an array.");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`[${index}]: expected a string.`);
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

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("expected a finite number.");
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

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
