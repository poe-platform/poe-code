import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import { hasOwnErrorCode } from "./error-codes.js";
import type { SecretStore } from "./types.js";

const derivedKeyCache = new Map<string, Promise<Buffer>>();

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_VERSION = 1;
const ENCRYPTION_KEY_BYTES = 32;
const ENCRYPTION_IV_BYTES = 12;
const ENCRYPTION_AUTH_TAG_BYTES = 16;
const ENCRYPTION_FILE_MODE = 0o600;

interface EncryptedDocument {
  version: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface MachineIdentity {
  hostname: string;
  username: string;
}

export interface EncryptedFileStoreFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(
    path: string,
    data: string | NodeJS.ArrayBufferView,
    options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void | string | undefined>;
  rename(oldPath: string, newPath: string): Promise<void>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
  unlink(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

export interface EncryptedFileStoreInput {
  fs?: EncryptedFileStoreFileSystem;
  filePath?: string;
  salt: string;
  defaultDirectory?: string;
  defaultFileName?: string;
  getMachineIdentity?: () => MachineIdentity | Promise<MachineIdentity>;
  getHomeDirectory?: () => string;
  getRandomBytes?: (size: number) => Buffer;
}

export class EncryptedFileStore implements SecretStore {
  private readonly fs: EncryptedFileStoreFileSystem;
  private readonly filePath: string;
  private readonly symbolicLinkCheckStartPath: string | null;
  private readonly salt: string;
  private readonly getMachineIdentity: () => MachineIdentity | Promise<MachineIdentity>;
  private readonly getRandomBytes: (size: number) => Buffer;
  private keyPromise: Promise<Buffer> | null = null;

  constructor(input: EncryptedFileStoreInput) {
    this.fs = input.fs ?? fs;
    this.salt = input.salt;
    if (input.filePath === undefined) {
      const homeDirectory = (input.getHomeDirectory ?? homedir)();
      const defaultDirectory = input.defaultDirectory ?? ".auth-store";
      this.filePath = path.join(
        homeDirectory,
        defaultDirectory,
        input.defaultFileName ?? "credentials.enc"
      );
      this.symbolicLinkCheckStartPath = resolveDefaultDirectoryCheckStart(
        homeDirectory,
        defaultDirectory
      );
    } else {
      this.filePath = input.filePath;
      this.symbolicLinkCheckStartPath = null;
    }
    this.getMachineIdentity = input.getMachineIdentity ?? defaultMachineIdentity;
    this.getRandomBytes = input.getRandomBytes ?? randomBytes;
  }

  async get(): Promise<string | null> {
    await this.assertCredentialPathHasNoSymbolicLinks(this.filePath);
    let rawDocument: string;
    try {
      rawDocument = await this.fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }

    const document = parseEncryptedDocument(rawDocument);
    if (!document) {
      return null;
    }

    const key = await this.getEncryptionKey();

    try {
      const iv = Buffer.from(document.iv, "base64");
      const authTag = Buffer.from(document.authTag, "base64");
      const ciphertext = Buffer.from(document.ciphertext, "base64");

      if (
        iv.byteLength !== ENCRYPTION_IV_BYTES ||
        authTag.byteLength !== ENCRYPTION_AUTH_TAG_BYTES
      ) {
        return null;
      }

      const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString("utf8");
    } catch {
      return null;
    }
  }

  async set(value: string): Promise<void> {
    await this.assertCredentialPathHasNoSymbolicLinks(this.filePath);
    const key = await this.getEncryptionKey();
    const iv = this.getRandomBytes(ENCRYPTION_IV_BYTES);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    const document: EncryptedDocument = {
      version: ENCRYPTION_VERSION,
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };

    await this.fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.assertCredentialPathHasNoSymbolicLinks(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryCreated = false;

    try {
      await this.assertCredentialPathHasNoSymbolicLinks(temporaryPath);
      await this.fs.writeFile(temporaryPath, JSON.stringify(document), {
        encoding: "utf8",
        flag: "wx",
        mode: ENCRYPTION_FILE_MODE
      });
      temporaryCreated = true;
      await this.fs.chmod(temporaryPath, ENCRYPTION_FILE_MODE);
      await this.fs.rename(temporaryPath, this.filePath);
    } catch (error) {
      if (temporaryCreated || !isAlreadyExistsError(error)) {
        await removeIfPresent(this.fs, temporaryPath).catch(() => undefined);
      }
      throw error;
    }
  }

  async delete(): Promise<void> {
    await this.assertCredentialPathHasNoSymbolicLinks(this.filePath);
    try {
      await this.fs.unlink(this.filePath);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  private async assertCredentialPathHasNoSymbolicLinks(targetPath: string): Promise<void> {
    const resolvedPath = path.resolve(targetPath);
    const protectedPaths = getProtectedCredentialPaths(
      resolvedPath,
      this.symbolicLinkCheckStartPath
    );

    for (const currentPath of protectedPaths) {
      try {
        const stats = await this.fs.lstat(currentPath);
        if (stats.isSymbolicLink()) {
          throw new Error(`Refusing to use encrypted credential path through symbolic link: ${currentPath}`);
        }
      } catch (error) {
        if (isNotFoundError(error)) {
          return;
        }
        throw error;
      }
    }
  }

  private getEncryptionKey(): Promise<Buffer> {
    if (!this.keyPromise) {
      const retryableKeyPromise = deriveEncryptionKey(this.getMachineIdentity, this.salt).catch((error) => {
        if (this.keyPromise === retryableKeyPromise) {
          this.keyPromise = null;
        }
        throw error;
      });
      this.keyPromise = retryableKeyPromise;
    }
    return this.keyPromise;
  }
}

function resolveDefaultDirectoryCheckStart(
  homeDirectory: string,
  defaultDirectory: string
): string {
  const [firstSegment] = defaultDirectory.split(/[\\/]+/).filter(Boolean);
  return path.resolve(homeDirectory, firstSegment ?? ".");
}

function getProtectedCredentialPaths(
  resolvedPath: string,
  symbolicLinkCheckStartPath: string | null
): string[] {
  if (symbolicLinkCheckStartPath === null) {
    return [path.dirname(resolvedPath), resolvedPath];
  }

  const resolvedStartPath = path.resolve(symbolicLinkCheckStartPath);
  if (!isPathInsideOrEqual(resolvedPath, resolvedStartPath)) {
    return [path.dirname(resolvedPath), resolvedPath];
  }

  const protectedPaths = [resolvedStartPath];
  let currentPath = resolvedStartPath;
  for (const segment of path.relative(resolvedStartPath, resolvedPath).split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    protectedPaths.push(currentPath);
  }
  return protectedPaths;
}

function isPathInsideOrEqual(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function removeIfPresent(fileSystem: EncryptedFileStoreFileSystem, filePath: string): Promise<void> {
  try {
    await fileSystem.unlink(filePath);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function defaultMachineIdentity(): MachineIdentity {
  return {
    hostname: hostname(),
    username: userInfo().username
  };
}

async function deriveEncryptionKey(
  getMachineIdentity: () => MachineIdentity | Promise<MachineIdentity>,
  salt: string
): Promise<Buffer> {
  const machineIdentity = await getMachineIdentity();
  const secret = `${machineIdentity.hostname}:${machineIdentity.username}`;
  const cacheKey = JSON.stringify([machineIdentity.hostname, machineIdentity.username, salt]);

  const cached = derivedKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const keyPromise = new Promise<Buffer>((resolve, reject) => {
    scrypt(secret, salt, ENCRYPTION_KEY_BYTES, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Buffer.from(derivedKey));
    });
  });

  derivedKeyCache.set(cacheKey, keyPromise);
  return keyPromise.catch((error) => {
    if (derivedKeyCache.get(cacheKey) === keyPromise) {
      derivedKeyCache.delete(cacheKey);
    }
    throw error;
  });
}

function parseEncryptedDocument(raw: string): EncryptedDocument | null {
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const version = getOwnEntry(parsed, "version");
    const iv = getOwnEntry(parsed, "iv");
    const authTag = getOwnEntry(parsed, "authTag");
    const ciphertext = getOwnEntry(parsed, "ciphertext");
    if (version !== ENCRYPTION_VERSION) {
      return null;
    }
    if (
      typeof iv !== "string" ||
      typeof authTag !== "string" ||
      typeof ciphertext !== "string"
    ) {
      return null;
    }
    return {
      version,
      iv,
      authTag,
      ciphertext
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getOwnEntry(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "ENOENT");
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}
