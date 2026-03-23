import path from "node:path";
import {
  createTimestamp,
  isNotFound,
  type FileSystem
} from "@poe-code/config-mutations";
import type { ConfigDocument } from "./types.js";

export async function readDocument(
  fs: FileSystem,
  filePath: string
): Promise<ConfigDocument> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return await parseDocument(fs, filePath, raw);
  } catch (error) {
    if (isNotFound(error)) {
      return {};
    }
    throw error;
  }
}

export async function writeScope(
  fs: FileSystem,
  filePath: string,
  scope: string,
  values: Record<string, unknown>
): Promise<void> {
  const document = await readDocument(fs, filePath);
  const normalizedValues = normalizeScopeValues(values);

  if (Object.keys(normalizedValues).length === 0) {
    delete document[scope];
  } else {
    document[scope] = normalizedValues;
  }

  await writeDocument(fs, filePath, document);
}

async function parseDocument(
  fs: FileSystem,
  filePath: string,
  raw: string
): Promise<ConfigDocument> {
  try {
    return normalizeDocument(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError) {
      await recoverInvalidDocument(fs, filePath, raw);
      return {};
    }
    throw error;
  }
}

function normalizeDocument(value: unknown): ConfigDocument {
  if (!isRecord(value)) {
    return {};
  }

  const document: ConfigDocument = {};
  for (const [scope, scopeValues] of Object.entries(value)) {
    const normalizedValues = normalizeScopeValues(scopeValues);
    if (Object.keys(normalizedValues).length > 0) {
      document[scope] = normalizedValues;
    }
  }

  return document;
}

function normalizeScopeValues(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      normalized[key] = entry;
    }
  }

  return normalized;
}

async function writeDocument(
  fs: FileSystem,
  filePath: string,
  document: ConfigDocument
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: "utf8"
  });
}

async function recoverInvalidDocument(
  fs: FileSystem,
  filePath: string,
  content: string
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const backupPath = createInvalidBackupPath(filePath);
  await fs.writeFile(backupPath, content, { encoding: "utf8" });
  await fs.writeFile(filePath, EMPTY_DOCUMENT, { encoding: "utf8" });
}

function createInvalidBackupPath(filePath: string): string {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  return path.join(directory, `${baseName}.invalid-${createTimestamp()}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function resolveConfigPath(homeDir: string): string {
  return path.join(homeDir, ".poe-code", "config.json");
}

const EMPTY_DOCUMENT = `${JSON.stringify({}, null, 2)}\n`;
