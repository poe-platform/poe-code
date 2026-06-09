import path from "node:path";
import { pathExists, type FileSystem } from "@poe-code/config-mutations";
import { hasOwnErrorCode } from "./errors.js";
import { assertConfigPathSafe } from "./store.js";
import type { ConfigDocument, ConfigFieldType, ScopeDefinition, ScopeSchema } from "./types.js";

export interface EnvOverrides {
  entries: string[];
  document: ConfigDocument;
}

export interface EditTargetOptions {
  global?: boolean;
  project?: boolean;
}

export function collectEnvOverrides(
  scopes: ReadonlyArray<ScopeDefinition<ScopeSchema>>,
  env: Record<string, string | undefined>
): EnvOverrides {
  const document: ConfigDocument = {};
  const entries: string[] = [];

  for (const definition of scopes) {
    const scopeResult = collectScopeEnvOverrides(definition, env);
    if (Object.keys(scopeResult.values).length === 0) {
      continue;
    }

    defineDataProperty(document, definition.scope, scopeResult.values);
    entries.push(...scopeResult.entries);
  }

  return { entries, document };
}

export async function resolveEditTarget(
  fs: FileSystem,
  configPath: string,
  projectConfigPath: string,
  options: EditTargetOptions
): Promise<string> {
  if (options.global && options.project) {
    throw new Error("Choose either --global or --project, not both.");
  }

  if (options.global) {
    return configPath;
  }
  if (options.project) {
    return projectConfigPath;
  }
  if (await pathExists(fs, projectConfigPath)) {
    return projectConfigPath;
  }
  return configPath;
}

export async function initProjectConfig(
  fs: FileSystem,
  targetPath: string
): Promise<"created" | "already-exists"> {
  await assertConfigPathSafe(fs, targetPath);
  if (await pathExists(fs, targetPath)) {
    return "already-exists";
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await assertConfigPathSafe(fs, targetPath);
  try {
    await fs.writeFile(targetPath, EMPTY_DOCUMENT, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error) {
    if (isAlreadyExists(error)) {
      return "already-exists";
    }
    await fs.unlink(targetPath).catch(() => undefined);
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function collectScopeEnvOverrides<S extends ScopeSchema>(
  definition: ScopeDefinition<S>,
  env: Record<string, string | undefined>
): {
  entries: string[];
  values: Record<string, unknown>;
} {
  const entries: string[] = [];
  const values: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(definition.schema) as Array<
    [keyof S & string, S[keyof S & string]]
  >) {
    if (!field.env) {
      continue;
    }

    const value = coerceEnvValue(field.type, env[field.env]);
    if (value === undefined) {
      continue;
    }

    defineDataProperty(values, key, value);
    entries.push(`  ${field.env} = ${String(value)}`);
  }

  return { entries, values };
}

function defineDataProperty(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function coerceEnvValue(
  type: ConfigFieldType,
  raw: string | undefined
): unknown {
  if (raw === undefined) {
    return undefined;
  }

  if (type === "string") {
    return raw;
  }
  if (type === "number") {
    if (raw.length === 0) {
      return undefined;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (type === "json") {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  return undefined;
}

const EMPTY_DOCUMENT = `${JSON.stringify({}, null, 2)}\n`;
