import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import type { AuthStore } from "./types.js";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_VERSION = 1;
const ENCRYPTION_KEY_BYTES = 32;
const ENCRYPTION_IV_BYTES = 12;
const ENCRYPTION_AUTH_TAG_BYTES = 16;
const ENCRYPTION_SALT = "poe-code:encrypted-file-auth-store:v1";
const ENCRYPTION_FILE_MODE = 0o600;

interface EncryptedCredentialDocument {
  version: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface MachineIdentity {
  hostname: string;
  username: string;
}

export interface EncryptedFileAuthStoreFileSystem {
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

export interface EncryptedFileAuthStoreInput {
  fs?: EncryptedFileAuthStoreFileSystem;
  filePath?: string;
  getMachineIdentity?: () => MachineIdentity | Promise<MachineIdentity>;
  getHomeDirectory?: () => string;
  getRandomBytes?: (size: number) => Buffer;
}

export class EncryptedFileAuthStore implements AuthStore {
  private readonly fs: EncryptedFileAuthStoreFileSystem;
  private readonly filePath: string;
  private readonly getMachineIdentity: () => MachineIdentity | Promise<MachineIdentity>;
  private readonly getRandomBytes: (size: number) => Buffer;
  private keyPromise: Promise<Buffer> | null = null;

  constructor(input: EncryptedFileAuthStoreInput = {}) {
    this.fs = input.fs ?? fs;
    this.filePath = input.filePath ?? path.join(
      (input.getHomeDirectory ?? homedir)(),
      ".poe-code",
      "credentials.enc"
    );
    this.getMachineIdentity = input.getMachineIdentity ?? defaultMachineIdentity;
    this.getRandomBytes = input.getRandomBytes ?? randomBytes;
  }

  async getApiKey(): Promise<string | null> {
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

  async setApiKey(apiKey: string): Promise<void> {
    const key = await this.getEncryptionKey();
    const iv = this.getRandomBytes(ENCRYPTION_IV_BYTES);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(apiKey, "utf8"),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    const document: EncryptedCredentialDocument = {
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

  async deleteApiKey(): Promise<void> {
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
      this.keyPromise = deriveEncryptionKey(this.getMachineIdentity);
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
  getMachineIdentity: () => MachineIdentity | Promise<MachineIdentity>
): Promise<Buffer> {
  const machineIdentity = await getMachineIdentity();
  const secret = `${machineIdentity.hostname}:${machineIdentity.username}`;

  return await new Promise<Buffer>((resolve, reject) => {
    scrypt(secret, ENCRYPTION_SALT, ENCRYPTION_KEY_BYTES, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Buffer.from(derivedKey));
    });
  });
}

function parseEncryptedDocument(raw: string): EncryptedCredentialDocument | null {
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
