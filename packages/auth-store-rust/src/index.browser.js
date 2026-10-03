import { FsError } from "@poe-code/safe-fs/core";
import { policy } from "./portable-policy.js";

const ownCode = (error, code) => error instanceof Error && Object.hasOwn(error, "code") && error.code === code;
const primitive = value => ["string", "number", "boolean"].includes(typeof value) ? value : null;

/** Portable encrypted credentials; the caller supplies filesystem and key capabilities. */
export class SafeFsSecretStore {
  fs;
  filePath;
  key;
  constructor(input) {
    this.fs = input.fs;
    if (!input.filePath.startsWith("/")) throw new Error("Credential filePath must be absolute");
    const filePath = input.filePath;
    // Preserve the shared filesystem error identity at the host boundary.
    if (typeof filePath !== "string" || filePath.includes("\0")) {
      throw new FsError("EINVAL", { syscall: "resolve", message: "paths must be strings without NUL bytes" });
    }
    this.filePath = policy(0, filePath);
    this.key = input.key;
    for (const [index, read] of [
      () => this.key.type,
      () => this.key.algorithm.name,
      () => this.key.algorithm.length,
      () => Boolean(this.key.usages.includes("encrypt")),
      () => Boolean(this.key.usages.includes("decrypt"))
    ].entries()) {
      if (!policy(3, [index, primitive(read())])) throw new Error("Credential key must be an AES-256-GCM key with encrypt and decrypt usages");
    }
  }

  async get() {
    await this.assertSafePath();
    let bytes;
    try { bytes = await this.fs.readFile(this.filePath); }
    catch (error) { if (ownCode(error, "ENOENT")) return null; throw error; }
    try {
      const document = JSON.parse(new TextDecoder().decode(bytes));
      if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error();
      const fields = policy(4);
      if (!fields.every(field => Object.hasOwn(document, field))) throw new Error();
      for (const [index, field] of fields.entries()) {
        if (!policy(5, [index, primitive(document[field])])) throw new Error();
      }
      const iv = decodeBase64(document.iv);
      const tag = decodeBase64(document.authTag);
      const ciphertext = decodeBase64(document.ciphertext);
      if (!policy(6, [iv.length, tag.length])) throw new Error();
      const sealed = new Uint8Array(ciphertext.length + tag.length);
      sealed.set(ciphertext); sealed.set(tag, ciphertext.length);
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, sealed);
      return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    } catch {
      throw new Error("Invalid encrypted credential document; reset the store explicitly to recover");
    }
  }

  async set(value) {
    await this.assertSafePath();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, new TextEncoder().encode(value)));
    const document = JSON.stringify({ version: 1, iv: encodeBase64(iv), authTag: encodeBase64(sealed.subarray(sealed.length - 16)), ciphertext: encodeBase64(sealed.subarray(0, sealed.length - 16)) });
    await this.fs.mkdir(policy(2, this.filePath), { recursive: true, mode: 0o700 });
    await this.assertSafePath();
    const staging = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    await this.fs.writeFile(staging, new TextEncoder().encode(document), { flag: "wx", mode: 0o600 });
    try { await this.fs.rename(staging, this.filePath); }
    catch (error) {
      try { await this.fs.rm(staging); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Credential publication and cleanup failed"); }
      throw error;
    }
  }

  async delete() {
    await this.assertSafePath();
    try { await this.fs.rm(this.filePath); }
    catch (error) { if (!ownCode(error, "ENOENT")) throw error; }
  }

  async assertSafePath() {
    for (const current of policy(1, this.filePath)) {
      try {
        if ((await this.fs.lstat(current)).type === "symlink") throw new Error("Refusing encrypted credential path through symbolic link");
      } catch (error) { if (ownCode(error, "ENOENT")) return; throw error; }
    }
  }
}

function encodeBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decodeBase64(value) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }

export function key(providerId) { return policy(7, `${providerId}`); }

export class MigratingSecretStore {
  store;
  legacyStore;
  pendingMutation = Promise.resolve();
  constructor(store, legacyStore = null) { this.store = store; this.legacyStore = legacyStore; }
  async get(options = {}) {
    const value = await this.store.get();
    if (value !== null || !this.legacyStore) return value;
    const legacyValue = await this.legacyStore.get();
    if (legacyValue !== null && !options.readOnly) {
      await this.mutate(async () => {
        if (await this.store.get() === null) {
          try {
            if (policy(8, [true, await this.legacyStore?.get() === legacyValue])) await this.store.set(legacyValue);
          } catch { /* Keep a readable legacy value after failed migration. */ }
        }
      });
    }
    return legacyValue;
  }
  async set(value) {
    await this.mutate(async () => {
      const previous = await this.store.get();
      const legacy = await this.legacyStore?.get() ?? null;
      await this.store.set(value);
      try { await this.legacyStore?.set(value); }
      catch (error) {
        await restore(this.store, previous);
        if (this.legacyStore) await restore(this.legacyStore, legacy);
        throw error;
      }
    });
  }
  async delete() {
    await this.mutate(async () => {
      const previous = await this.store.get();
      const legacy = await this.legacyStore?.get() ?? null;
      await this.store.delete();
      try { await this.legacyStore?.delete(); }
      catch (error) {
        await restore(this.store, previous);
        if (this.legacyStore) await restore(this.legacyStore, legacy);
        throw error;
      }
    });
  }
  async mutate(action) {
    const operation = this.pendingMutation.then(action, action);
    this.pendingMutation = operation.catch(() => undefined);
    await operation;
  }
}
async function restore(store, value) {
  if (policy(9, [value === null, true, false])[0] === "delete") { await store.delete(); return; }
  await store.set(value);
}
