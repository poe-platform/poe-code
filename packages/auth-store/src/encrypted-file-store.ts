import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
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
    options?: { encoding?: BufferEncoding }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void | string | undefined>;
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
  private readonly salt: string;
  private readonly getMachineIdentity: () => MachineIdentity | Promise<MachineIdentity>;
  private readonly getRandomBytes: (size: number) => Buffer;
  private keyPromise: Promise<Buffer> | null = null;

  constructor(input: EncryptedFileStoreInput) {
    this.fs = input.fs ?? fs;
    this.salt = input.salt;
    this.filePath = input.filePath ?? path.join(
      (input.getHomeDirectory ?? homedir)(),
      input.defaultDirectory ?? ".auth-store",
      input.defaultFileName ?? "credentials.enc"
    );
    this.getMachineIdentity = input.getMachineIdentity ?? defaultMachineIdentity;
    this.getRandomBytes = input.getRandomBytes ?? randomBytes;
  }

  async get(): Promise<string | null> {
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
    await this.fs.writeFile(this.filePath, JSON.stringify(document), {
      encoding: "utf8"
    });
    await this.fs.chmod(this.filePath, ENCRYPTION_FILE_MODE);
  }

  async delete(): Promise<void> {
    try {
      await this.fs.unlink(this.filePath);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  private getEncryptionKey(): Promise<Buffer> {
    if (!this.keyPromise) {
      this.keyPromise = deriveEncryptionKey(this.getMachineIdentity, this.salt);
    }
    return this.keyPromise;
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
  const cacheKey = `${secret}:${salt}`;

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
  return keyPromise;
}

function parseEncryptedDocument(raw: string): EncryptedDocument | null {
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    if (parsed.version !== ENCRYPTION_VERSION) {
      return null;
    }
    if (
      typeof parsed.iv !== "string" ||
      typeof parsed.authTag !== "string" ||
      typeof parsed.ciphertext !== "string"
    ) {
      return null;
    }
    return {
      version: parsed.version,
      iv: parsed.iv,
      authTag: parsed.authTag,
      ciphertext: parsed.ciphertext
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
