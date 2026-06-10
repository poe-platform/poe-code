import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolve, type FileSystem as ResolveFileSystem } from "@poe-code/config-extends";
import { createTimestamp, isNotFound, type FileSystem } from "@poe-code/config-mutations";
import { hasOwnErrorCode } from "./errors.js";
import type { ConfigDocument } from "./types.js";

export async function readDocument(fs: FileSystem, filePath: string): Promise<ConfigDocument> {
  await assertConfigPathSafe(fs, filePath);
  const document = await readStoredDocument(fs, filePath);
  return document.data;
}

export async function readDocumentReadonly(fs: FileSystem, filePath: string): Promise<ConfigDocument> {
  await assertConfigPathSafe(fs, filePath);
  const document = await readStoredDocument(fs, filePath, false);
  return document.data;
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
    defineDataProperty(document, scope, normalizedValues);
  }

  await writeDocument(fs, filePath, document);
}

export async function readMergedDocument(
  fs: FileSystem,
  globalPath: string,
  projectPath?: string
): Promise<ConfigDocument> {
  return readMergedStoredDocument(fs, globalPath, projectPath, true);
}

export async function readMergedDocumentReadonly(
  fs: FileSystem,
  globalPath: string,
  projectPath?: string
): Promise<ConfigDocument> {
  return readMergedStoredDocument(fs, globalPath, projectPath, false);
}

async function readMergedStoredDocument(
  fs: FileSystem,
  globalPath: string,
  projectPath: string | undefined,
  recoverInvalid: boolean
): Promise<ConfigDocument> {
  const globalDocument = await readStoredDocument(fs, globalPath, recoverInvalid);
  if (!projectPath || projectPath === globalPath) {
    return globalDocument.data;
  }

  const projectDocument = await readStoredDocument(fs, projectPath, recoverInvalid);
  const resolved = await resolve(
    [
      {
        source: "project",
        filePath: projectPath,
        content: projectDocument.content
      },
      {
        source: "base",
        path: path.dirname(globalPath)
      }
    ],
    {
      fs: createResolvedConfigFs(fs, globalPath, globalDocument.content),
      autoExtend: true
    }
  );

  return normalizeDocument(resolved.data);
}

async function readStoredDocument(
  fs: FileSystem,
  filePath: string,
  recoverInvalid = true
): Promise<{ content: string; data: ConfigDocument }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return await parseStoredDocument(fs, filePath, raw, recoverInvalid);
  } catch (error) {
    if (isNotFound(error)) {
      return {
        content: EMPTY_DOCUMENT,
        data: {}
      };
    }

    throw error;
  }
}

async function parseStoredDocument(
  fs: FileSystem,
  filePath: string,
  raw: string,
  recoverInvalid: boolean
): Promise<{ content: string; data: ConfigDocument }> {
  try {
    return {
      content: raw,
      data: normalizeDocument(JSON.parse(raw))
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      if (!recoverInvalid) {
        throw error;
      }
      await recoverInvalidDocument(fs, filePath, raw);
      return {
        content: EMPTY_DOCUMENT,
        data: {}
      };
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
      defineDataProperty(document, scope, normalizedValues);
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
      defineDataProperty(normalized, key, entry);
    }
  }

  return normalized;
}

function defineDataProperty(object: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function createResolvedConfigFs(
  fs: FileSystem,
  globalPath: string,
  globalContent: string
): ResolveFileSystem {
  return {
    readFile(filePath: string, _encoding: BufferEncoding) {
      if (filePath === globalPath) {
        return Promise.resolve(globalContent);
      }

      return fs.readFile(filePath, "utf8");
    }
  };
}

export async function writeDocument(
  fs: FileSystem,
  filePath: string,
  document: ConfigDocument
): Promise<void> {
  await assertConfigPathSafe(fs, filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await assertConfigPathSafe(fs, filePath);
  await writeFileAtomically(fs, filePath, `${JSON.stringify(document, null, 2)}\n`);
}

async function recoverInvalidDocument(
  fs: FileSystem,
  filePath: string,
  content: string
): Promise<void> {
  await assertConfigPathSafe(fs, filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await assertConfigPathSafe(fs, filePath);
  await writeInvalidBackup(fs, filePath, content);
  await writeFileAtomically(fs, filePath, EMPTY_DOCUMENT);
}

export async function assertConfigPathSafe(fs: FileSystem, filePath: string): Promise<void> {
  for (const target of [path.dirname(filePath), filePath]) {
    try {
      if ((await fs.lstat(target)).isSymbolicLink()) {
        throw new Error(`Refusing configuration access through symbolic link: ${target}`);
      }
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }
}

function createInvalidBackupPath(filePath: string): string {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  return path.join(directory, `${baseName}.invalid-${createTimestamp()}.json`);
}

async function writeInvalidBackup(fs: FileSystem, filePath: string, content: string): Promise<void> {
  const backupPath = createInvalidBackupPath(filePath);
  const backupStem = backupPath.slice(0, -".json".length);

  for (let suffix = 0; ; suffix += 1) {
    const candidate = suffix === 0 ? backupPath : `${backupStem}-${suffix}.json`;

    try {
      await fs.writeFile(candidate, content, { encoding: "utf8", flag: "wx" });
      return;
    } catch (error) {
      if (!isAlreadyExists(error)) {
        await fs.unlink(candidate).catch(() => undefined);
        throw error;
      }
    }
  }
}

async function writeFileAtomically(fs: FileSystem, filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let tempCreated = false;

  try {
    await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
    tempCreated = true;
    await fs.rename(tempPath, filePath);
  } catch (error) {
    if (tempCreated || !isAlreadyExists(error)) {
      await fs.unlink(tempPath).catch(() => undefined);
    }
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function resolveConfigPath(homeDir: string): string {
  return path.join(homeDir, ".poe-code", "config.json");
}

export function resolveServicesConfigPath(homeDir: string): string {
  return path.join(homeDir, ".config", "poe-code", "services.json");
}

export function resolveProjectConfigPath(cwd: string): string {
  return path.join(cwd, ".poe-code", "config.json");
}

const EMPTY_DOCUMENT = `${JSON.stringify({}, null, 2)}\n`;
