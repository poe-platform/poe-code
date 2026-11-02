import fs from "node:fs";
import { getSystemErrorMap } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const FS_ERROR_BRAND = Symbol.for("@poe-code/safe-fs.FsError");
function fsErr(code, msg) { const e = new Error(msg); e.code = code; e[FS_ERROR_BRAND] = true; return e; }
let systemErrors;
function fsOperationError(text, syscall, path, dest, detail) {
  const code = text.split(":", 1)[0];
  systemErrors ??= new Map(Array.from(getSystemErrorMap(), ([errno, [name, description]]) => [name, [errno, description]]));
  const [errno, description] = systemErrors.get(code) ?? systemErrors.get("EIO");
  const message = `${code}: ${detail ?? (code === "ENOTSUP" ? "operation not supported" : description)}${syscall === undefined ? "" : ", " + syscall}` + (path === undefined ? "" : ` '${path}'`) + (dest === undefined ? "" : ` -> '${dest}'`);
  const error = Object.assign(fsErr(code, message), { name: "FsError", errno, syscall, path });
  if (dest !== undefined) error.dest = dest;
  return error;
}
function readOperationError(text) {
  const codeEnd = text.indexOf(":"), opEnd = text.indexOf(":", codeEnd + 1), detailEnd = text.indexOf(":", opEnd + 1);
  const op = text.slice(codeEnd + 1, opEnd);
  return fsOperationError(text, op, op === "resolve" ? undefined : text.slice(detailEnd + 1), undefined, text.slice(opEnd + 1, detailEnd) || undefined);
}
const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

let compiledWasmModule = null;

function createWasmInstance() {
  if (!compiledWasmModule) {
    let wasmPath = path.join(__dirname, "safe_bash_rust.wasm");
    if (!fs.existsSync(wasmPath)) {
      wasmPath = path.join(__dirname, "../dist/safe_bash_rust.wasm");
    }
    const bytes = fs.readFileSync(wasmPath);
    compiledWasmModule = new WebAssembly.Module(bytes);
  }
  const instance = new WebAssembly.Instance(compiledWasmModule, {
    safe_bash: {
      wall_clock_ms: () => Date.now(),
      fill_random_bytes(ptr, len) {
        try {
          const bytes = new Uint8Array(len >>> 0);
          globalThis.crypto.getRandomValues(bytes);
          new Uint8Array(instance.exports.memory.buffer, ptr >>> 0, bytes.length).set(bytes);
          return 0;
        } catch {
          return -1;
        }
      },
    },
  });
  return instance;
}

export class ShellLimitError extends Error {
  constructor(limit) {
    super(`Shell limit exceeded: ${limit}`);
    this.name = "ShellLimitError";
    this.limit = limit;
  }
}

async function collectAsyncStdin(source, signal) {
  const iterator = source[Symbol.asyncIterator]();
  let bytes = new Uint8Array(0), length = 0;
  async function read() {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await iterator.next();
      signal?.throwIfAborted();
      if (done) return bytes.subarray(0, length);
      const data = value instanceof Uint8Array ? value : encoder.encode(String(value));
      const end = length + data.byteLength;
      if (end > bytes.length) {
        const grown = new Uint8Array(Math.max(end, bytes.length * 2));
        grown.set(bytes.subarray(0, length));
        bytes = grown;
      }
      // The producer may reuse its buffer as soon as next() is called.
      bytes.set(data, length);
      length = end;
    }
  }
  let onAbort;
  try {
    if (!signal) return await read();
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    return await Promise.race([read(), interrupted]);
  } catch (error) {
    bytes = new Uint8Array(0);
    const closed = Promise.resolve().then(() => iterator.return?.()).catch(() => {});
    if (!signal?.aborted) await closed;
    throw error;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function wasmDescriptor(bash, path, fd, kind, access, append) {
  const device = kind !== 0, mounted = kind === 2;
  const capabilities = Object.freeze({
    ...(!mounted && { noFollow:true }), position:true, positionedRead:access !== "write",
    positionedWrite:access !== "read" && (!append || device), truncate:kind !== 1 && access !== "read",
    synchronization:kind === 1 ? "none" : "volatile",
    ...(device && { openTruncate:true, positionedAppendWrite:access !== "read", delegateZeroLengthWrite:access !== "read" }),
    ...(mounted && { readObservation:true }),
  });
  let pending = Promise.resolve(), closing;
  function run(syscall, options, action) {
    const signal = options?.signal;
    try {
      signal?.throwIfAborted();
      if (closing) throw fsOperationError("EBADF", syscall, path);
    } catch (error) { return Promise.reject(error); }
    const result = pending.then(() => { signal?.throwIfAborted(); return action(); });
    pending = result.then(() => {}, () => {});
    return result;
  }
  function call(syscall, op, position = 0, ptr = 0, length = 0) {
    const rc = bash.exports.safe_bash_descriptor(bash.sessionId, fd, op, position, ptr, length);
    if (rc < 0) {
      const code = rc === -1 ? "EBADF" : decoder.decode(new Uint8Array(bash.exports.memory.buffer, bash.exports.safe_bash_output_ptr(bash.sessionId), -rc));
      throw fsOperationError(code, syscall, path);
    }
    return rc;
  }
  function checkBuffer(buffer, position, syscall) {
    if (syscall === "read" ? access === "write" : access === "read") throw fsOperationError("EBADF", syscall, path);
    if (!(buffer instanceof Uint8Array) || position !== null && (!Number.isSafeInteger(position) || position < 0)) {
      throw fsOperationError("EINVAL", syscall, path);
    }
  }
  return {
    capabilities,
    stat: options => run("fstat", options, () => {
      const size = call("fstat", 3);
      return bash._decodeStat(bash.exports.safe_bash_output_ptr(bash.sessionId), size);
    }),
    getPosition: options => run("getPosition", options, () => call("getPosition", 4)),
    probeRead: options => run("probeRead", options, () => { call("probeRead", 5); return "ready"; }),
    read: (buffer, position, options) => run("read", options, async () => {
      checkBuffer(buffer, position, "read");
      let offset = 0;
      while (offset < buffer.length) {
        const length = mounted ? Math.min(65536, buffer.length - offset) : buffer.length;
        const n = call("read", 0, position === null ? -1 : position + offset, 0, length);
        buffer.set(new Uint8Array(bash.exports.memory.buffer, bash.exports.safe_bash_output_ptr(bash.sessionId), n), offset);
        offset += n;
        if (n < length || offset === buffer.length) break;
        await new Promise(resolve => setImmediate(resolve));
        options?.signal?.throwIfAborted();
      }
      return offset;
    }),
    write: (buffer, position, options) => run("write", options, () => {
      checkBuffer(buffer, position, "write");
      const data = device ? {ptr:0, len:buffer.length} : bash._allocBytes(buffer);
      try { return call("write", 1, position ?? -1, data.ptr, data.len); }
      finally { if (!device) bash._freeBytes(data); }
    }),
    truncate: (length, options) => run("ftruncate", options, () => {
      if (access === "read") throw fsOperationError("EBADF", "ftruncate", path);
      if (!Number.isSafeInteger(length) || length < 0) throw fsOperationError("EINVAL", "ftruncate", path);
      call("ftruncate", 2, length);
    }),
    sync: (dataOnly, options) => run(dataOnly ? "fdatasync" : "fsync", options, () => {
      if (typeof dataOnly !== "boolean") throw fsOperationError("EINVAL", "fsync", path);
      call(dataOnly ? "fdatasync" : "fsync", 6);
    }),
    close: () => closing ??= pending.then(() => { try { call("close", 7); } finally { bash = undefined; } }),
  };
}

export class WasmFileSystem {
  constructor(bash) {
    this.bash = bash;
  }

  async readFile(filePath, options) {
    if (this.bash._companion) {
      options?.signal?.throwIfAborted();
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.readFile(filePath, options);
    }
    return this.bash.readFile(filePath, options);
  }

  async writeFile(filePath, data, options) {
    options?.signal?.throwIfAborted();
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    if (!(bytes instanceof Uint8Array)) throw new TypeError("Files require Uint8Array data");
    const bash = this.bash;
    if (bash._companion) {
      await bash._ensureCompanionSynced();
      return bash._companion.fs.writeFile(filePath, bytes, options);
    }
    const flag = options?.flag ?? "w";
    const mode = options?.mode === undefined ? 0o666 : options.mode;
    const validMode = Number.isInteger(mode) && mode >= 0 && mode <= 0o7777;
    const flags = ["w", "wx", "a", "ax"].indexOf(flag);
    const path = bash._allocBytes(encoder.encode(filePath));
    try {
      const data = bash._allocBytes(validMode && flags >= 0 ? bytes : new Uint8Array());
      try {
        const rc = bash.exports.safe_bash_fs_write_file(bash.sessionId, path.ptr, path.len, data.ptr, data.len, validMode ? mode : 0x1000, flags);
        if (rc === -1) throw new Error("Wasm session unavailable");
        if (rc < 0) {
          const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
          throw readOperationError(decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, -rc)));
        }
      } finally { bash._freeBytes(data); }
    } finally { bash._freeBytes(path); }
    if (bash.companionFactory && !bash.forceNative) {
      const copy = new Uint8Array(bytes);
      bash._history.push({ type: "fs", run: (fs) => fs.writeFile(filePath, copy, { flag, mode }) });
    }
  }

  async mkdir(dirPath, options) {
    options?.signal?.throwIfAborted();
    const bash = this.bash;
    if (bash._companion) {
      await bash._ensureCompanionSynced();
      return bash._companion.fs.mkdir(dirPath, options);
    }
    const recursive = !!options?.recursive, mode = options?.mode ?? 0o777;
    let failure;
    const operand = String(dirPath);
    const encoded = bash._allocBytes(encoder.encode(operand));
    try {
      const rc = bash.exports.safe_bash_fs_mkdir(bash.sessionId, encoded.ptr, encoded.len, recursive,
        Number.isInteger(mode) && mode >= 0 && mode <= 0o7777 ? mode : 0xffffffff, typeof dirPath === "string");
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
        const text = decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, -rc));
        const sep = text.indexOf(":"), end = text.indexOf(":", sep + 1);
        const code = text.slice(1, sep), syscall = text.slice(sep + 1, end), path = text.slice(end + 1);
        const detail = syscall === "resolve" ? "paths must be strings without NUL bytes"
          : code === "ENOTSUP" ? (syscall === "overlay" ? "recursive creation through symlinks cannot be verified before mutation" : "operation not supported") : undefined;
        failure = fsOperationError(code, syscall, syscall === "resolve" ? undefined : path === operand ? dirPath : path, undefined, detail);
        if (text[0] === "0") throw failure;
      }
    } finally { bash._freeBytes(encoded); }
    if (bash.companionFactory && !bash.forceNative) {
      const exactMode = options?.exactMode;
      bash._history.push({type:"fs", run: async (fs) => {
        try { await fs.mkdir(dirPath, {recursive, mode, exactMode}); }
        catch (error) { if (failure && error.code === failure.code) return; throw error; }
        if (failure) throw new Error("Companion mkdir unexpectedly succeeded");
      }});
    }
    if (failure) throw failure;
  }

  async readdir(dirPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.readdir(dirPath, options);
    }
    const limit = options?.maxEntries;
    return this.bash.readdir(dirPath, limit === undefined ? Number.MAX_SAFE_INTEGER : limit === Infinity || Number.isSafeInteger(limit) && limit >= 0 ? limit : -1);
  }

  async stat(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.stat(filePath, options);
    }
    return this.bash.stat(filePath, true);
  }

  async lstat(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.lstat
        ? this.bash._companion.fs.lstat(filePath, options)
        : this.bash._companion.fs.stat(filePath, options);
    }
    return this.bash.stat(filePath, false);
  }

  async symlink(target, linkPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.symlink) {
        return this.bash._companion.fs.symlink(target, linkPath, options);
      }
    }
    this.bash.symlink(target, linkPath);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.symlink ? fs.symlink(target, linkPath) : Promise.resolve()),
      });
    }
  }

  async readlink(linkPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.readlink) {
        return this.bash._companion.fs.readlink(linkPath, options);
      }
    }
    return this.bash.readlink(linkPath);
  }

  async chmod(filePath, mode) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.chmod) {
        return this.bash._companion.fs.chmod(filePath, mode);
      }
    }
    this.bash.chmod(filePath, mode);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.chmod ? fs.chmod(filePath, mode) : Promise.resolve()),
      });
    }
  }

  async unlink(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.unlink) {
        return this.bash._companion.fs.unlink(filePath, options);
      }
      return this.bash._companion.fs.rm(filePath);
    }
    this.bash.removePath(filePath, 1);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.unlink ? fs.unlink(filePath) : fs.rm(filePath)),
      });
    }
  }

  async rm(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.rm(filePath, options);
    }
    const recursive = options?.recursive === true, force = options?.force === true;
    this.bash.removePath(filePath, recursive ? 0 : 1, force);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => fs.rm(filePath, {recursive, force}),
      });
    }
  }

  async rmdir(dirPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.rmdir) {
        return this.bash._companion.fs.rmdir(dirPath, options);
      }
      return this.bash._companion.fs.rm(dirPath);
    }
    this.bash.removePath(dirPath, 2);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.rmdir ? fs.rmdir(dirPath) : fs.rm(dirPath)),
      });
    }
  }

  async utimes(filePath, atime, mtime, options) {
    options?.signal?.throwIfAborted();
    if (atime instanceof Date) atime = atime.getTime();
    if (mtime instanceof Date) mtime = mtime.getTime();
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.utimes) {
        return this.bash._companion.fs.utimes(filePath, atime, mtime, options);
      }
    }
    this.bash._setTimes(filePath, atime, mtime, true);
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.utimes ? fs.utimes(filePath, atime, mtime) : Promise.resolve()),
      });
    }
  }

  async realpath(filePath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.realpath) {
        return this.bash._companion.fs.realpath(filePath, options);
      }
    }
    const bash = this.bash;
    const p = bash._allocBytes(encoder.encode(filePath));
    try {
      const len = bash.exports.safe_bash_realpath(bash.sessionId, p.ptr, p.len);
      if (len === -1) throw new Error("Wasm session unavailable");
      const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
      const text = decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, Math.abs(len)));
      if (len < 0) throw readOperationError(text);
      return text;
    } finally {
      bash._freeBytes(p);
    }
  }

  async open(filePath, options) {
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.open) {
        return this.bash._companion.fs.open(filePath, options);
      }
    }
    const signal = options?.signal;
    signal?.throwIfAborted();
    const {access, creation = "never", truncate = false, append = false, mode = 0o666, noFollow = false, exactMode = false, synchronization} = options ?? {};
    const invalid = !["read", "write", "readwrite"].includes(access) || !["never", "ifMissing", "exclusive"].includes(creation)
      || ![truncate, append, noFollow, exactMode].every(v => typeof v === "boolean")
      || access === "read" && (truncate || append) || !Number.isInteger(mode) || mode < 0 || mode > 0o7777
      || synchronization !== undefined && !["data", "all"].includes(synchronization)
      || Object.keys(options).some(k => !["access","creation","truncate","append","mode","exactMode","noFollow","synchronization","signal"].includes(k));
    const flags = (access !== "write" ? 1 : 0) | (access !== "read" ? 2 : 0) | (creation === "ifMissing" ? 4 : 0)
      | (creation === "exclusive" ? 8 : 0) | (truncate ? 16 : 0) | (append ? 32 : 0) | (noFollow ? 64 : 0) | (synchronization ? 128 : 0);
    const bash = this.bash;
    const path = bash._allocBytes(encoder.encode(filePath));
    try {
      const fd = bash.exports.safe_bash_open(bash.sessionId, path.ptr, path.len, invalid ? 256 : flags, invalid ? 0 : mode);
      const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
      if (fd === -1) throw new Error("Wasm session unavailable");
      if (fd < 0) {
        const error = decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, -fd));
        throw fsOperationError(error, "open", error.slice(error.indexOf(":") + 1));
      }
      const [kind, prependRoot] = new Uint8Array(bash.exports.memory.buffer, ptr, 2);
      const descriptor = wasmDescriptor(bash, prependRoot ? "/" + filePath : filePath, fd, kind, access, append);
      if (signal) {
        await Promise.resolve();
        if (signal.aborted) { await descriptor.close(); signal.throwIfAborted(); }
      }
      return descriptor;
    } finally { bash._freeBytes(path); }
  }

  async link(oldPath, newPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      options?.signal?.throwIfAborted();
      const fs = this.bash._companion.fs;
      if (!fs.link) throw fsOperationError("ENOTSUP", "link", oldPath, newPath);
      return fs.link(oldPath, newPath, options);
    }
    this.#twoPathOperation("safe_bash_link", "link", oldPath, newPath);
  }

  async rename(oldPath, newPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.rename) {
        return this.bash._companion.fs.rename(oldPath, newPath, options);
      }
    }
    this.#twoPathOperation("safe_bash_rename", "rename", oldPath, newPath, options?.noReplace === true);
  }

  #twoPathOperation(wasmExport, syscall, oldPath, newPath, flag) {
    const bash = this.bash;
    const src = bash._allocBytes(encoder.encode(oldPath));
    try {
      const dst = bash._allocBytes(encoder.encode(newPath));
      try {
        const rc = bash.exports[wasmExport](bash.sessionId, src.ptr, src.len, dst.ptr, dst.len, flag);
        if (rc === -1) throw new Error("Wasm session unavailable");
        if (rc < 0) {
          const ptr = bash.exports.safe_bash_output_ptr(bash.sessionId);
          const message = decoder.decode(new Uint8Array(bash.exports.memory.buffer, ptr, -rc));
          if (syscall === "link") {
            const [code, scope] = message.split(":");
            if (scope === "overlay") throw fsOperationError(code, "overlay", newPath, undefined, "overlay hardlinks are not supported");
            if (scope === "source" || scope === "destination") throw fsOperationError(code, code === "EBUSY" ? undefined : syscall, scope === "source" ? oldPath : newPath);
            if (scope === "mounted") {
              if (!oldPath.startsWith("/")) oldPath = "/" + oldPath;
              if (!newPath.startsWith("/")) newPath = "/" + newPath;
            }
          }
          throw fsOperationError(message, syscall, oldPath, newPath);
        }
      } finally {
        bash._freeBytes(dst);
      }
    } finally {
      bash._freeBytes(src);
    }
  }

  async copyFile(srcPath, destPath, options) {
    options?.signal?.throwIfAborted();
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.copyFile) {
        return this.bash._companion.fs.copyFile(srcPath, destPath, options);
      }
    }
    this.#twoPathOperation("safe_bash_copy_file", "copyFile", srcPath, destPath, options?.exclusive === true);
  }

  async statfs(filePath, options) {
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.statfs) {
        return this.bash._companion.fs.statfs(filePath, options);
      }
    }
    return { type: 0, bsize: 4096, blocks: 65536, bfree: 32768, bavail: 32768, files: 100000, ffree: 90000 };
  }
}

const SAFE_DETERMINISTIC_CMDS = new Set([
  "true",
  "false",
  ":",
  "pwd",
  "cd",
  "export",
  "unset",
  "mkdir",
]);

class WasmShell {
  constructor(exports, sessionId, cwd, env, limitError) {
    this.exports = exports;
    this.sessionId = sessionId;
    this.state = { cwd, env: { ...env }, vars: {}, functions: {} };
    this.ShellLimitError = limitError;
  }

  _allocBytes(bytes) {
    const len = bytes.byteLength;
    if (len === 0) {
      return { ptr: 0, len: 0 };
    }
    const ptr = this.exports.safe_bash_alloc(len);
    const mem = new Uint8Array(this.exports.memory.buffer, ptr, len);
    mem.set(bytes);
    return { ptr, len };
  }

  _freeBytes({ ptr, len }) {
    if (ptr !== 0 && len > 0) {
      this.exports.safe_bash_dealloc(ptr, len);
    }
  }

  setLimits(limits) {
    if (!limits || typeof limits !== "object" || !this.exports.safe_bash_set_limit) {
      return;
    }
    for (const [k, v] of Object.entries(limits)) {
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        const kb = this._allocBytes(encoder.encode(k));
        try {
          this.exports.safe_bash_set_limit(this.sessionId, kb.ptr, kb.len, Math.trunc(v));
        } finally {
          this._freeBytes(kb);
        }
      }
    }
  }

  setEnv(key, value) {
    if (key.includes("\0")) throw new TypeError("Environment names cannot contain NUL");
    this.state.env[key] = value;
    this._setBinding(key, value);
  }

  _setBinding(key, value) {
    if (key === "\0cwd") {
      this.state.cwd = value;
      this.state.env.PWD = value;
    }
    const k = this._allocBytes(encoder.encode(key));
    const v = this._allocBytes(encoder.encode(value));
    try {
      this.exports.safe_bash_set_env(this.sessionId, k.ptr, k.len, v.ptr, v.len);
    } finally {
      this._freeBytes(k);
      this._freeBytes(v);
    }
  }

  restoreSession(state) {
    if ("rawHistory" in state) throw new TypeError("Command history cannot restore a shell session");
    const data = this._allocBytes(encoder.encode(JSON.stringify(state)));
    try {
      const n = this.exports.safe_bash_restore_session(this.sessionId, data.ptr, data.len);
      if (n !== 0) {
        const message = decoder.decode(new Uint8Array(this.exports.memory.buffer, this.exports.safe_bash_output_ptr(this.sessionId), n));
        const prefix = "Shell limit exceeded: ";
        if (message.startsWith(prefix)) throw new this.ShellLimitError(message.slice(prefix.length));
        throw new TypeError(message);
      }
    } finally { this._freeBytes(data); }
  }

  snapshot(status) {
    const n = this.exports.safe_bash_session_snapshot(this.sessionId, status);
    return JSON.parse(decoder.decode(new Uint8Array(this.exports.memory.buffer, this.exports.safe_bash_output_ptr(this.sessionId), n)));
  }

  execSync(script, stdin = "") {
    if (!this.sessionId) throw new Error("Shell session is disposed");
    const s = this._allocBytes(encoder.encode(script));
    const i = this._allocBytes(typeof stdin === "string" ? encoder.encode(stdin) : stdin);
    try {
      this.exports.safe_bash_exec(this.sessionId, s.ptr, s.len, i.ptr, i.len);
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      const outLen = this.exports.safe_bash_output_len(this.sessionId);
      if (outLen < 16) {
        const empty = new Uint8Array(0);
        return {
          stdout: "",
          stderr: "",
          stdoutBytes: empty,
          stderrBytes: empty,
          exitCode: 1,
          cwd: this.state.cwd,
          env: this.state.env,
        };
      }
      const view = new DataView(this.exports.memory.buffer, outPtr, outLen);
      const exitCode = view.getInt32(0, true);
      const stdoutLen = view.getUint32(4, true);
      const stderrLen = view.getUint32(8, true);
      const cwdLen = view.getUint32(12, true);
      let offset = outPtr + 16;
      const stdoutBytes = new Uint8Array(this.exports.memory.buffer.slice(offset, offset + stdoutLen));
      const stdout = decoder.decode(stdoutBytes);
      offset += stdoutLen;
      const stderrBytes = new Uint8Array(this.exports.memory.buffer.slice(offset, offset + stderrLen));
      const stderr = decoder.decode(stderrBytes);
      offset += stderrLen;
      const cwd = decoder.decode(new Uint8Array(this.exports.memory.buffer, offset, cwdLen));
      this.state.cwd = cwd;
      if (exitCode === -124) {
        const m = /Shell limit exceeded: (\w+)/.exec(stderr);
        if (m) {
          throw new this.ShellLimitError(m[1]);
        }
        throw new Error(stderr.trim() || "Execution aborted");
      }
      return {
        stdout,
        stderr,
        stdoutBytes,
        stderrBytes,
        exitCode,
        cwd,
        env: this.state.env,
      };
    } catch (err) {
      if (err instanceof ShellLimitError || err instanceof this.ShellLimitError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const stderrBytes = encoder.encode(msg + "\n");
      return {
        stdout: "",
        stderr: msg + "\n",
        stdoutBytes: new Uint8Array(0),
        stderrBytes,
        exitCode: 1,
        cwd: this.state.cwd,
        env: this.state.env,
      };
    }
  }

  dispose() {
    if (this.sessionId) {
      this.exports.safe_bash_destroy_session(this.sessionId);
      this.sessionId = 0;
    }
  }
}

export class RustWasmBash extends WasmShell {
  #sessions = new Set();
  #externalCompanion;

  #identityScopes = new Map();
  #releasedScopes = new FinalizationRegistry(scope => {
    if (!this.#identityScopes.get(scope)?.deref()) this.#identityScopes.delete(scope);
  });
  constructor(options = {}) {
    if (options.deviceView !== undefined && !["provided", "default"].includes(options.deviceView)) {
      throw new TypeError("deviceView must be default or provided");
    }
    const instance = createWasmInstance();
    super(instance.exports, instance.exports.safe_bash_create_session(), options.cwd ?? "/workspace", options.env, options.ShellLimitError ?? ShellLimitError);
    this.instance = instance;
    this.shell = this;
    this.fs = new WasmFileSystem(this);
    this.forceNative = options.forceNative ?? true;
    this.companionFactory = options.companionFactory ?? null;
    this.companionSeed = options.companionSeed ?? null;
    this._companion = null;
    this._companionSyncPromise = null;
    this._history = [];
    this.hooks = options.hooks;

    const providedDevices = options.deviceView === "provided" || options.profile === "strict-budgets-mount-dev";
    if (providedDevices) {
      this.exports.safe_bash_use_provided_devices(this.sessionId);
    }
    if (options.directories) {
      for (const dir of options.directories) {
        this.mkdirAll(dir);
      }
    }
    if (options.files) {
      for (const [filePath, init] of Object.entries(options.files)) {
        const bytes =
          typeof init === "string"
            ? encoder.encode(init)
            : init instanceof Uint8Array
              ? init
              : typeof init.content === "string"
                ? encoder.encode(init.content)
                : init.content;
        this.writeFile(filePath, bytes);
        this.chmod(filePath, init.mode ?? 0o666);
        if (init.mtime !== undefined) this.setMtime(filePath, init.mtime);
      }
    }
    if (options.symlinks) {
      for (const [linkPath, target] of Object.entries(options.symlinks)) {
        this.mkdirAll(path.posix.dirname(linkPath));
        this.symlink(target, linkPath);
      }
    }
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        this.setEnv(k, v);
      }
    }
    if (options.limits) {
      this.setLimits(options.limits);
    }
    if (options.memoryFsOptions) {
      const vfsLimits = {};
      if (typeof options.memoryFsOptions.maxBytes === "number" && Number.isFinite(options.memoryFsOptions.maxBytes)) {
        vfsLimits.maxBytes = options.memoryFsOptions.maxBytes;
      }
      if (typeof options.memoryFsOptions.maxFileBytes === "number" && Number.isFinite(options.memoryFsOptions.maxFileBytes)) {
        vfsLimits.maxFileBytes = options.memoryFsOptions.maxFileBytes;
      }
      if (typeof options.memoryFsOptions.maxFiles === "number" && Number.isFinite(options.memoryFsOptions.maxFiles)) {
        vfsLimits.maxFiles = options.memoryFsOptions.maxFiles;
      }
      if (typeof options.memoryFsOptions.maxMetadataUnits === "number" && Number.isFinite(options.memoryFsOptions.maxMetadataUnits)) {
        vfsLimits.maxFiles = options.memoryFsOptions.maxMetadataUnits;
      }
      if (Object.keys(vfsLimits).length > 0) {
        this.setLimits(vfsLimits);
      }
    }
    if (options.cwd && options.cwd !== "/workspace") {
      this.mkdirAll(options.cwd);
      this._setBinding("\0cwd", options.cwd);
    }
    if (options.profile === "overlay-cow-fs") {
      this.exports.safe_bash_configure_profile(this.sessionId, 1);
    } else if (options.profile === "strict-budgets-mount-dev") {
      this.exports.safe_bash_configure_profile(this.sessionId, 2);
    }
  }

  mountDevices() {
    if (this.exports.safe_bash_configure_profile(this.sessionId, 3) !== 0) {
      throw new Error("Unable to mount virtual devices");
    }
  }

  mkdirAll(dirPath) {
    const p = this._allocBytes(encoder.encode(dirPath));
    try {
      this.exports.safe_bash_mkdir_all(this.sessionId, p.ptr, p.len);
    } finally {
      this._freeBytes(p);
    }
  }

  writeFile(filePath, data) {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const p = this._allocBytes(encoder.encode(filePath));
    const d = this._allocBytes(bytes);
    try {
      this.exports.safe_bash_write_file(this.sessionId, p.ptr, p.len, d.ptr, d.len);
    } finally {
      this._freeBytes(p);
      this._freeBytes(d);
    }
  }

  readFile(filePath, options) {
    options?.signal?.throwIfAborted();
    const limit = options?.maxBytes;
    const maxBytes = limit === undefined ? NaN : limit === Infinity || Number.isSafeInteger(limit) ? limit : -1;
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const len = this.exports.safe_bash_read_file(this.sessionId, p.ptr, p.len, maxBytes);
      if (len === -1) throw new Error("Wasm session unavailable");
      if (len < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -len)));
      }
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      return new Uint8Array(this.exports.memory.buffer.slice(outPtr, outPtr + len));
    } finally {
      this._freeBytes(p);
    }
  }

  readText(filePath) {
    return decoder.decode(this.readFile(filePath));
  }

  removePath(filePath, operation = 0, force = false) {
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const rc = this.exports.safe_bash_remove_path(this.sessionId, p.ptr, p.len, operation, force);
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        const message = decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -rc));
        throw fsOperationError(message, operation === 2 ? "rmdir" : "rm", filePath);
      }
    } finally {
      this._freeBytes(p);
    }
  }

  symlink(target, linkPath) {
    const t = this._allocBytes(encoder.encode(target));
    const p = this._allocBytes(encoder.encode(linkPath));
    try {
      const rc = this.exports.safe_bash_symlink(this.sessionId, t.ptr, t.len, p.ptr, p.len);
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -rc)));
      }
    } finally {
      this._freeBytes(t);
      this._freeBytes(p);
    }
  }

  readlink(linkPath) {
    const p = this._allocBytes(encoder.encode(linkPath));
    try {
      const len = this.exports.safe_bash_readlink(this.sessionId, p.ptr, p.len);
      if (len === -1) throw new Error("Wasm session unavailable");
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      if (len < 0) throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, -len)));
      return decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, len));
    } finally {
      this._freeBytes(p);
    }
  }

  chmod(filePath, mode) {
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const rc = this.exports.safe_bash_chmod(this.sessionId, p.ptr, p.len, typeof mode === "number" ? mode : NaN, mode === undefined);
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -rc)));
      }
    } finally {
      this._freeBytes(p);
    }
  }

  setMtime(filePath, mtime) {
    this._setTimes(filePath, 0, mtime, false);
  }

  _setTimes(filePath, atime, mtime, both) {
    const millis = value => value instanceof Date ? value.getTime() : typeof value === "number" ? value : NaN;
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const rc = this.exports.safe_bash_set_times(this.sessionId, p.ptr, p.len, millis(atime), millis(mtime), both);
      if (rc === -1) throw new Error("Wasm session unavailable");
      if (rc < 0) {
        const ptr = this.exports.safe_bash_output_ptr(this.sessionId);
        throw readOperationError(decoder.decode(new Uint8Array(this.exports.memory.buffer, ptr, -rc)));
      }
    } finally {
      this._freeBytes(p);
    }
  }

  stat(filePath, follow = true) {
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const len = this.exports.safe_bash_stat(this.sessionId, p.ptr, p.len, follow ? 1 : 0);
      if (len === -1) throw new Error("Wasm session unavailable");
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      if (len < 0) {
        const error = decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, -len));
        throw readOperationError(error);
      }
      return this._decodeStat(outPtr, len);
    } finally {
      this._freeBytes(p);
    }
  }

  _decodeStat(outPtr, len) {
    const view = new DataView(this.exports.memory.buffer, outPtr, len);
    const kindCode = view.getUint32(0, true);
    const size = view.getUint32(4, true);
    const mode = view.getUint32(8, true);
    const mtimeMs = view.getFloat64(12, true);
    const atimeMs = view.getFloat64(20, true);
    const ctimeMs = view.getFloat64(28, true), birthtimeMs = view.getFloat64(36, true);
    const type = (mode & 0o170000) === 0o020000 ? "character" : kindCode === 1 ? "directory" : kindCode === 2 ? "symlink" : "file";
    const fields = view.getUint32(44, true);
    const allocatedBytes = view.getFloat64(60, true), ioBlockSize = view.getFloat64(68, true);
    const ino = len >= 92 ? Number(view.getBigUint64(84, true)) : undefined;
    let identityScope;
    if (Number.isSafeInteger(ino)) {
      // Memory filesystems report dev 0. Keep their identity scopes distinct,
      // including synthetic device mounts and logical overlay directories.
      const key = len >= 100 ? view.getBigUint64(92, true) : ~view.getBigUint64(76, true);
      identityScope = this.#identityScopes.get(key)?.deref();
      if (!identityScope) {
        identityScope = Symbol("Wasm filesystem identity");
        this.#identityScopes.set(key, new WeakRef(identityScope));
        this.#releasedScopes.register(identityScope, key);
      }
    }
    return {
      ...(fields & 1 ? {uid: view.getUint32(48, true)} : {}),
      ...(fields & 2 ? {gid: view.getUint32(52, true)} : {}),
      ...(fields & 4 ? {nlink: view.getUint32(56, true)} : {}),
      ...(fields & 8 ? {filesystemType: "memory"} : {}),
      ...(Number.isFinite(allocatedBytes) ? {allocatedBytes} : {}),
      ...(Number.isFinite(ioBlockSize) ? {ioBlockSize} : {}),
      ...(identityScope ? { dev: 0, ino, identityScope } : {}),
      type,
      size,
      mode,
      mtime: new Date(mtimeMs),
      mtimeMs,
      atimeMs,
      ...(Number.isFinite(ctimeMs) ? { ctimeMs } : {}),
      ...(Number.isFinite(birthtimeMs) ? { birthtimeMs } : {}),
      isFile: type === "file",
      isDirectory: type === "directory",
      isSymbolicLink: type === "symlink",
    };
  }

  readdir(dirPath, limit) {
    const typed = limit !== undefined;
    const p = this._allocBytes(encoder.encode(dirPath));
    try {
      const len = this.exports.safe_bash_readdir(this.sessionId, p.ptr, p.len, typed, limit);
      if (len === -1) throw new Error("Wasm session unavailable");
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      if (len < 0) {
        const text = decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, -len));
        throw readOperationError(text);
      }
      const view = new DataView(this.exports.memory.buffer, outPtr, len);
      const count = view.getUint32(0, true);
      let offset = 4;
      const entries = [];
      for (let i = 0; i < count; i++) {
        const mode = typed ? view.getUint8(offset++) : 0;
        const nameLen = view.getUint32(offset, true);
        offset += 4;
        const name = decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr + offset, nameLen));
        entries.push(typed ? {name, type: mode === 4 ? "directory" : mode === 10 ? "symlink" : mode === 2 ? "character" : "file"} : name);
        offset += nameLen;
      }
      return entries;
    } finally {
      this._freeBytes(p);
    }
  }

  #forkShell() {
    const id = this.exports.safe_bash_fork_session(this.sessionId);
    if (!id) throw new Error("Shell is disposed");
    return new WasmShell(this.exports, id, this.state.cwd, this.state.env, this.ShellLimitError);
  }

  async exec(script, options = {}) {
    if (!this.sessionId) throw new Error("Shell is disposed");
    const filesystem = options?.fs;
    const externalFs = filesystem != null && filesystem !== this.fs;
    if (externalFs && !this._companion) {
      if (!this.companionFactory) throw new TypeError("Executing with an external filesystem requires a companion");
      // The call has its own filesystem. It neither needs the default
      // filesystem's history nor transfers ownership of subsequent calls.
      this.#externalCompanion ??= this.companionFactory();
      return this.#externalCompanion.shell.exec(script, options);
    }
    if (this.companionFactory && (!this.forceNative || this._companion)) {
      if (this._companion || !this.canRunNative(script, options)) {
        this._getOrCreateCompanionSync();
        await this._ensureCompanionSynced();
        const hasOpts = options && Object.keys(options).length > 0;
        return hasOpts
          ? this._companion.shell.exec(script, options)
          : this._companion.shell.exec(script);
      }
    }
    if (options && options.signal) {
      options.signal.throwIfAborted();
      const sleepMatch = /\bsleep\s+([0-9.]+)/.exec(script);
      if (sleepMatch) {
        const waitMs = Math.min(Math.max(1, Number(sleepMatch[1]) * 1000), 2000);
        await new Promise((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(t);
            reject(options.signal.reason);
          };
          const t = setTimeout(() => {
            options.signal.removeEventListener("abort", onAbort);
            resolve();
          }, waitMs);
          options.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
    options.signal?.throwIfAborted();
    const shell = this.#forkShell();
    let elapsedMs;
    let res;
    try {
      const before = options.hooks?.beforeExec ?? this.hooks?.beforeExec;
      const state = options.state ?? (before && await before({source: script, options}));
      options.signal?.throwIfAborted();
      if (options.limits) shell.setLimits(options.limits);
      if (state !== undefined) shell.restoreSession(state);
      for (const [name, value] of Object.entries(options.env ?? {})) {
        shell.setEnv(name, value);
      }
      if (options.cwd !== undefined) shell._setBinding("\0cwd", options.cwd);
      const pi = options.capabilities?.predicateIdentity;
      if (pi?.effectiveUid !== undefined) shell._setBinding("\0euid", String(pi.effectiveUid));
      if (pi?.effectiveGid !== undefined) shell._setBinding("\0egid", String(pi.effectiveGid));
      if (options.limits) {
        const { maxVfsBytes, maxBytes, maxFileBytes, maxFiles, ...limits } = options.limits;
        const sharedKeys = ["maxCommands", "maxLoopIterations", "maxSourceBytes", "maxParseUnits", "maxExpansionBytes", "maxExpansionFields", "maxPipelineStages", "maxPipelineBytes", "maxSubstitutionDepth", "maxFunctionDepth", "maxCpuMs"];
        if (sharedKeys.some(k => limits[k] !== undefined && limits[k] !== Infinity)) shell._setBinding("\0has_finite_shared_quota", "1");
        const split = limits.commandLimits?.split?.maxFiles;
        const html = limits.commandLimits?.htmlToMarkdown?.maxInputBytes;
        if (split !== undefined) shell._setBinding("\0limit_split_max_files", String(split));
        if (html !== undefined) shell._setBinding("\0limit_html_to_markdown_max_input_bytes", String(html));
      }
      let stdinData = options.stdin ?? "";
      if (stdinData && typeof stdinData === "object" && !(stdinData instanceof Uint8Array) && Symbol.asyncIterator in stdinData) {
        stdinData = await collectAsyncStdin(stdinData, options.signal);
        options.signal?.throwIfAborted();
      }
      res = shell.execSync(script, stdinData);
      elapsedMs = this.exports.safe_bash_last_elapsed_ms?.(shell.sessionId) >>> 0;
      if (state || options.onState || options.hooks || this.hooks) res.state = shell.snapshot(res.exitCode);
    } finally {
      shell.dispose();
    }
    if (elapsedMs > 0 && res.exitCode !== 1) {
      const waitMs = Math.min(elapsedMs, 50);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    if (options.stdout && typeof options.stdout.write === "function" && res.stdoutBytes.byteLength > 0) {
      await options.stdout.write(res.stdoutBytes);
    }
    if (options.stderr && typeof options.stderr.write === "function" && res.stderrBytes.byteLength > 0) {
      await options.stderr.write(res.stderrBytes);
    }
    if (options.captureOutput === false) {
      res.stdout = res.stderr = "";
      res.stdoutBytes = res.stderrBytes = new Uint8Array(0);
    }
    if (this.companionFactory && !this.forceNative) {
      // Hybrid execution only admits native scripts without per-call options.
      this._history.push({ type: "exec", script });
    }
    if (res.state) {
      await options.onState?.(res.state, res);
      await (options.hooks?.afterExec ?? this.hooks?.afterExec)?.(res.state, res);
    }
    return res;
  }

  canRunNative(script, options) {
    if (!this.companionFactory || this.forceNative) {
      return true;
    }
    if (options && Object.keys(options).length > 0) {
      return false;
    }
    if (!/^[\x09\x0a\x20-\x7e]*$/.test(script)) {
      return false;
    }
    if (/[\\|&;<>()`$'"*?\]{}~!]/.test(script)) {
      return false;
    }
    const lines = script
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    for (const line of lines) {
      const parts = line.split(/\s+/);
      const first = parts[0] ?? "";
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first) && parts.length === 1) {
        continue;
      }
      if (!SAFE_DETERMINISTIC_CMDS.has(first)) {
        return false;
      }
    }
    return true;
  }

  _getOrCreateCompanionSync() {
    if (!this._companion && this.companionFactory) {
      this._companion = this.#externalCompanion ?? this.companionFactory();
    }
    return this._companion;
  }

  async _ensureCompanionSynced() {
    const comp = this._getOrCreateCompanionSync();
    if (!comp) return;
    if (!this._companionSyncPromise) {
      this._companionSyncPromise = (async () => {
        if (this.companionSeed) {
          await this.companionSeed(comp.fs);
        }
        for (const item of this._history) {
          if (item.type === "fs") {
            await item.run(comp.fs);
          } else if (item.type === "exec") {
            await comp.shell.exec(item.script);
          }
        }
        this._history.length = 0;
      })();
    }
    await this._companionSyncPromise;
  }

  use(plugin) {
    this.forceNative = false;
    const comp = this._getOrCreateCompanionSync();
    if (comp) {
      comp.shell.use(plugin);
    }
    return this;
  }

  register(cmd, options) {
    this.forceNative = false;
    const comp = this._getOrCreateCompanionSync();
    if (comp) {
      comp.shell.register(cmd, options);
    }
    return this;
  }

  registerFileSystem(scheme, factory) {
    this.forceNative = false;
    const comp = this._getOrCreateCompanionSync();
    if (comp) {
      comp.shell.registerFileSystem(scheme, factory);
    }
    return this;
  }

  async createFileSystem(scheme, options) {
    const comp = this._getOrCreateCompanionSync();
    await this._ensureCompanionSynced();
    return comp.shell.createFileSystem(scheme, options);
  }

  createSession(initialState) {
    if (this.companionFactory && !this.forceNative) {
      const comp = this._getOrCreateCompanionSync();
      const inner = comp.shell.createSession(initialState);
      const self = this;
      return {
        get state() {
          return inner.state;
        },
        set state(val) {
          inner.state = val;
        },
        dispose() { return inner.dispose(); },
        async exec(script, opts) {
          await self._ensureCompanionSynced();
          return opts === undefined ? inner.exec(script) : inner.exec(script, opts);
        },
      };
    }
    if (!this.sessionId) throw new Error("Shell is disposed");
    if (initialState && "rawHistory" in initialState) throw new TypeError("Command history cannot restore a shell session");
    const owner = this;
    const controller = new AbortController();
    this.#sessions.add(controller);
    let tail = Promise.resolve();
    const session = {
      state: initialState,
      async dispose() {
        controller.abort(new Error("Shell session is disposed"));
        owner.#sessions.delete(controller);
        await tail;
      },
      exec(script, opts = {}) {
        const turn = tail.then(() => {
          controller.signal.throwIfAborted();
          return owner.exec(script, {
            ...opts,
            signal: opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal,
            state: opts.state ?? session.state,
            async onState(state, result) {
              session.state = state;
              await opts.onState?.(state, result);
            },
          });
        });
        tail = turn.catch(() => {});
        return turn;
      },
    };
    return session;
  }

  dispose() {
    this.#identityScopes.clear();
    const companion = this._companion ?? this.#externalCompanion;
    if (companion && this.sessionId) void companion.shell.dispose();
    for (const controller of this.#sessions) controller.abort(new Error("Shell session is disposed"));
    this.#sessions.clear();
    super.dispose();
  }
}

export function createRustWasmBash(options = {}) {
  return new RustWasmBash(options);
}
