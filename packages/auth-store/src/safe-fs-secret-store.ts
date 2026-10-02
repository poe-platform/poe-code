import { dirname, normalizePath, type FileSystem } from "@poe-code/safe-fs/core";
import { hasOwnErrorCode } from "./error-codes.js";
import type { SecretStore } from "./secret-store.js";

export interface SafeFsSecretStoreInput {
  /** Host-owned filesystem with exclusive creation and atomic rename support. */
  fs: FileSystem;
  /** Absolute path inside a trusted, host-controlled filesystem namespace. */
  filePath: string;
  /** Host-managed AES-256-GCM key, with encrypt and decrypt usages. */
  key: CryptoKey;
}

/** Portable encrypted storage. Hosts own key management and transaction coordination. */
export class SafeFsSecretStore implements SecretStore {
  private readonly fs: FileSystem;
  private readonly filePath: string;
  private readonly key: CryptoKey;

  constructor(input: SafeFsSecretStoreInput) {
    this.fs = input.fs;
    if (!input.filePath.startsWith("/")) throw new Error("Credential filePath must be absolute");
    this.filePath = normalizePath(input.filePath);
    if (this.filePath === "/") throw new Error("Credential filePath must name a file");
    this.key = input.key;
    if (this.key.type !== "secret" || this.key.algorithm.name !== "AES-GCM" ||
        (this.key.algorithm as AesKeyAlgorithm).length !== 256 ||
        !this.key.usages.includes("encrypt") || !this.key.usages.includes("decrypt")) {
      throw new Error("Credential key must be an AES-256-GCM key with encrypt and decrypt usages");
    }
  }

  async get(): Promise<string | null> {
    await this.assertSafePath();
    let bytes: Uint8Array;
    try { bytes = await this.fs.readFile(this.filePath); }
    catch (error) {
      if (hasOwnErrorCode(error, "ENOENT")) return null;
      throw error;
    }
    try {
      const document: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error();
      const record = document as Record<string, unknown>;
      if (!["version", "iv", "authTag", "ciphertext"].every(key => Object.hasOwn(record, key)) ||
          record.version !== 1 || typeof record.iv !== "string" ||
          typeof record.authTag !== "string" || typeof record.ciphertext !== "string") throw new Error();
      const iv = decodeBase64(record.iv);
      const tag = decodeBase64(record.authTag);
      const ciphertext = decodeBase64(record.ciphertext);
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const sealed = new Uint8Array(ciphertext.length + tag.length);
      sealed.set(ciphertext);
      sealed.set(tag, ciphertext.length);
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, sealed);
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch {
      throw new Error("Invalid encrypted credential document; reset the store explicitly to recover");
    }
  }

  async set(value: string): Promise<void> {
    await this.assertSafePath();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, this.key, new TextEncoder().encode(value),
    ));
    const document = JSON.stringify({
      version: 1, iv: encodeBase64(iv),
      authTag: encodeBase64(sealed.subarray(sealed.length - 16)),
      ciphertext: encodeBase64(sealed.subarray(0, sealed.length - 16)),
    });
    await this.fs.mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await this.assertSafePath();
    const staging = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    // Exclusive creation must succeed before this operation owns staging cleanup.
    await this.fs.writeFile(staging, new TextEncoder().encode(document), { flag: "wx", mode: 0o600 });
    try { await this.fs.rename(staging, this.filePath); }
    catch (error) {
      try { await this.fs.rm(staging); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Credential publication and cleanup failed"); }
      throw error;
    }
  }

  async delete(): Promise<void> {
    await this.assertSafePath();
    try { await this.fs.rm(this.filePath); }
    catch (error) { if (!hasOwnErrorCode(error, "ENOENT")) throw error; }
  }

  private async assertSafePath(): Promise<void> {
    let current = "";
    for (const segment of this.filePath.slice(1).split("/")) {
      current += `/${segment}`;
      try {
        if ((await this.fs.lstat(current)).type === "symlink") {
          throw new Error("Refusing encrypted credential path through symbolic link");
        }
      } catch (error) {
        if (hasOwnErrorCode(error, "ENOENT")) return;
        throw error;
      }
    }
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}
