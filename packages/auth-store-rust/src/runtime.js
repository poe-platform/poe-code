import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt
} from "node:crypto";
import { promises as defaultFs } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { withSecretStoreFileLock } from "./credential-transaction-lock.js";
// Bundled once alongside each consuming addon; no package import is needed.
export function createCredentialStoreBindings(native) {
  const derivedKeys = new native.NativeDerivedKeyCache();
  const derivations = new Map();
  function ownCode(error, code) {
    return error instanceof Error && Object.hasOwn(error, "code") && error.code === code;
  }
  function unwrap(result) {
    if (Object.hasOwn(result, "error")) throw new Error(result.error);
    return result.value;
  }

  function resolveSecretStoreBackend(input) {
    const variable = input.backendEnvVar ?? "AUTH_BACKEND";
    const ownEnv = (env) =>
      env !== undefined && Object.hasOwn(env, variable) ? env[variable] : undefined;
    return unwrap(native.selectBackend(input.backend ?? ownEnv(input.env) ?? ownEnv(process.env)));
  }
  function createSecretStore(input) {
    const backend = resolveSecretStoreBackend(input);
    const platform = input.platform ?? process.platform;
    if (backend === "keychain") unwrap(native.resolveBackend(backend, platform));
    const factories = {
      file: () => {
        if (!input.fileStore)
          throw new Error("fileStore configuration is required for file backend");
        return new EncryptedFileStore(input.fileStore);
      },
      keychain: () => {
        if (!input.keychainStore)
          throw new Error("keychainStore configuration is required for keychain backend");
        return new KeychainStore(input.keychainStore);
      }
    };
    return { backend, store: factories[backend]() };
  }

  class EncryptedFileStore {
    #fs;
    #filePath;
    #start;
    #salt;
    #identity;
    #random;
    #keyPromise = null;
    #throwOnInvalidDocument;
    constructor(input) {
      this.#fs = input.fs ?? defaultFs;
      this.#salt = input.salt;
      this.#throwOnInvalidDocument = input.throwOnInvalidDocument ?? false;
      if (input.filePath === undefined) {
        const home = (input.getHomeDirectory ?? homedir)();
        const directory = input.defaultDirectory ?? ".auth-store";
        const file = input.defaultFileName ?? "credentials.enc";
        try {
          native.validateDefaults(
            directory,
            path.isAbsolute(directory) || path.win32.isAbsolute(directory),
            file
          );
        } catch (error) {
          throw new Error(error.message);
        }
        this.#filePath = path.join(home, directory, file);
        const segments = directory
          .split("/")
          .flatMap((part) => part.split("\\"))
          .filter(Boolean);
        this.#start = path.resolve(home, segments[0] ?? ".");
      } else {
        this.#filePath = input.filePath;
        this.#start = null;
      }
      this.#identity =
        input.getMachineIdentity ??
        (() => ({ hostname: hostname(), username: userInfo().username }));
      this.#random = input.getRandomBytes ?? randomBytes;
    }
    async #assertPath(target) {
      const resolved = path.resolve(target);
      const relative = this.#start === null ? "" : path.relative(this.#start, resolved);
      const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
      const paths = native.protectedPaths(
        resolved,
        path.parse(resolved).root.length,
        path.sep.charCodeAt(0),
        this.#start,
        inside
      );
      for (const current of paths) {
        try {
          const stats = await this.#fs.lstat(current);
          if (stats.isSymbolicLink())
            throw new Error(
              `Refusing to use encrypted credential path through symbolic link: ${current}`
            );
        } catch (error) {
          if (ownCode(error, "ENOENT")) return;
          throw error;
        }
      }
    }
    async withLock(operation, options = {}) {
      await this.#assertPath(`${this.#filePath}.lock`);
      if (this.#fs.readdir === undefined)
        throw new Error("Secret-store transaction locks require filesystem readdir support");
      return withSecretStoreFileLock(this.#fs, `${this.#filePath}.lock`, operation, options);
    }
    #getKey() {
      if (this.#keyPromise === null) {
        const retryable = (async () => {
          const identity = await this.#identity();
          const cacheKey = JSON.stringify([identity.hostname, identity.username, this.#salt]);
          const cached = derivedKeys.lookup(cacheKey);
          if (cached !== null) return cached;
          if (derivations.has(cacheKey)) return derivations.get(cacheKey);
          const derivation = new Promise((resolve, reject) =>
            scrypt(`${identity.hostname}:${identity.username}`, this.#salt, 32, (error, key) =>
              error ? reject(error) : resolve(Buffer.from(key))
            )
          );
          derivations.set(cacheKey, derivation);
          try {
            const key = await derivation;
            derivedKeys.insert(cacheKey, key);
            return key;
          } finally {
            if (derivations.get(cacheKey) === derivation) derivations.delete(cacheKey);
          }
        })().catch((error) => {
          if (this.#keyPromise === retryable) this.#keyPromise = null;
          throw error;
        });
        this.#keyPromise = retryable;
      }
      return this.#keyPromise;
    }
    async get() {
      await this.#assertPath(this.#filePath);
      let raw;
      try {
        raw = await this.#fs.readFile(this.#filePath, "utf8");
      } catch (error) {
        if (ownCode(error, "ENOENT")) return null;
        throw error;
      }
      const document = native.parseDocument(raw);
      if (document === null) {
        if (this.#throwOnInvalidDocument)
          throw new Error(
            "Invalid encrypted credential document; reset the store explicitly to recover"
          );
        return null;
      }
      const key = await this.#getKey();
      try {
        const iv = Buffer.from(document.iv, "base64"),
          tag = Buffer.from(document.authTag, "base64"),
          ciphertext = Buffer.from(document.ciphertext, "base64");
        if (iv.byteLength !== 12 || tag.byteLength !== 16) {
          if (this.#throwOnInvalidDocument)
            throw new Error(
              "Invalid encrypted credential document; reset the store explicitly to recover"
            );
          return null;
        }
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        if (this.#throwOnInvalidDocument)
          throw new Error(
            "Invalid encrypted credential document; reset the store explicitly to recover"
          );
        return null;
      }
    }
    async set(value) {
      await this.#assertPath(this.#filePath);
      const key = await this.#getKey();
      const iv = this.#random(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      const document = {
        version: 1,
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64")
      };
      await this.#fs.mkdir(path.dirname(this.#filePath), { recursive: true });
      await this.#assertPath(this.#filePath);
      const temporary = `${this.#filePath}.${process.pid}.${randomUUID()}.tmp`;
      let created = false;
      try {
        await this.#assertPath(temporary);
        await this.#fs.writeFile(temporary, JSON.stringify(document), {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        });
        created = true;
        await this.#fs.chmod(temporary, 0o600);
        await this.#fs.rename(temporary, this.#filePath);
      } catch (error) {
        if (created || !ownCode(error, "EEXIST")) {
          try {
            await this.#fs.unlink(temporary);
          } catch {
            /* Preserve the write failure. */
          }
        }
        throw error;
      }
    }
    async delete() {
      await this.#assertPath(this.#filePath);
      try {
        await this.#fs.unlink(this.#filePath);
      } catch (error) {
        if (!ownCode(error, "ENOENT")) throw error;
      }
    }
  }

  class KeychainStore {
    #plan;
    #run;
    #lockFs;
    #lockDirectory;
    #lockIdentity;
    constructor(input) {
      try {
        this.#plan = new native.NativeKeychainPlan(input.service, input.account);
      } catch (error) {
        throw new Error(error.message);
      }
      this.#run = input.runCommand ?? runSecurityCommand;
      this.#lockFs = input.lock?.fs ?? defaultFs;
      this.#lockDirectory =
        input.lock?.directory ?? path.join(homedir(), ".auth-store", "keychain-locks");
      this.#lockIdentity = createHash("sha256")
        .update(JSON.stringify([input.service.trim(), input.account.trim()]))
        .digest("hex");
    }
    async withLock(operation, options = {}) {
      return withSecretStoreFileLock(
        this.#lockFs,
        path.join(this.#lockDirectory, this.#lockIdentity),
        operation,
        options
      );
    }
    async #execute(operation, value) {
      let args;
      try {
        args = this.#plan.command(operation, value);
      } catch (error) {
        throw new Error(error.message);
      }
      let result;
      try {
        result = await this.#run("security", args);
      } catch (error) {
        throw new Error(
          this.#plan.executionFailure(
            operation,
            error instanceof Error ? error.message : String(error)
          )
        );
      }
      const fields = {};
      for (const key of ["exitCode", "stdout", "stderr"]) {
        if (!Object.hasOwn(result, key)) continue;
        const value = result[key];
        if (typeof value === (key === "exitCode" ? "number" : "string")) fields[key] = value;
      }
      return JSON.stringify(fields);
    }
    async get() {
      return unwrap(this.#plan.complete("get", await this.#execute("get")));
    }
    async set(value) {
      unwrap(this.#plan.complete("set", await this.#execute("set", value)));
    }
    async delete() {
      unwrap(this.#plan.complete("delete", await this.#execute("delete")));
    }
  }
  function runSecurityCommand(command, args, options) {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        stdio: [options?.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"]
      });
      let stdout = "",
        stderr = "",
        stdinError;
      const append = (message) => {
        stderr =
          stderr.length === 0 ? message : `${stderr}${stderr.endsWith("\n") ? "" : "\n"}${message}`;
      };
      const flush = () => {
        if (stdinError !== undefined) {
          append(stdinError);
          stdinError = undefined;
        }
      };
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      if (options?.stdin !== undefined) {
        child.stdin?.once("error", (error) => {
          stdinError = error instanceof Error ? error.message : String(error);
        });
        child.stdin?.end(options.stdin);
      }
      child.on("error", (error) => {
        flush();
        append(error instanceof Error ? error.message : String(error ?? "Unknown error"));
        resolve({ stdout, stderr, exitCode: 127 });
      });
      child.on("close", (code) => {
        flush();
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
    });
  }

  const key = native.providerKey;
  class MigratingSecretStore {
    #store;
    #legacy;
    #pending = Promise.resolve();
    constructor(store, legacyStore = null) {
      this.#store = store;
      this.#legacy = legacyStore;
    }
    async get(options = {}) {
      const value = await this.#store.get();
      if (value !== null || !this.#legacy) return value;
      const legacy = await this.#legacy.get();
      if (legacy !== null && !options.readOnly) {
        await this.#mutate(async () => {
          const primary = await this.#store.get();
          if (primary !== null) return;
          try {
            if (native.migrationWriteNeeded(primary, legacy, await this.#legacy.get()))
              await this.#store.set(legacy);
          } catch {
            /* A readable legacy credential survives failed migration. */
          }
        });
      }
      return legacy;
    }
    async set(value) {
      await this.#mutate(() => this.#write("set", value));
    }
    async delete() {
      await this.#mutate(() => this.#write("delete"));
    }
    async #write(operation, value) {
      const previous = await this.#store.get();
      const legacy = (await this.#legacy?.get()) ?? null;
      const args = operation === "set" ? [value] : [];
      await this.#store[operation](...args);
      try {
        await this.#legacy?.[operation](...args);
      } catch (error) {
        for (const step of native.rollbackPlan(previous, legacy, this.#legacy !== null)) {
          const store = step.target === "primary" ? this.#store : this.#legacy;
          if (step.action === "set") await store.set(step.value);
          else await store.delete();
        }
        throw error;
      }
    }
    async #mutate(action) {
      const operation = this.#pending.then(action, action);
      this.#pending = operation.catch(() => undefined);
      await operation;
    }
  }
  return {
    createSecretStore,
    resolveSecretStoreBackend,
    EncryptedFileStore,
    KeychainStore,
    key,
    MigratingSecretStore
  };
}
