import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const FS_ERROR_BRAND = Symbol.for("@poe-code/safe-fs.FsError");
function fsErr(code, msg) { const e = new Error(msg); e.code = code; e[FS_ERROR_BRAND] = true; return e; }
const decoder = new TextDecoder("utf-8", { fatal: false });

let compiledWasmModule = null;

function createWasmInstance() {
  if (!compiledWasmModule) {
    const wasmPath = path.join(__dirname, "safe_bash_rust.wasm");
    const bytes = fs.readFileSync(wasmPath);
    compiledWasmModule = new WebAssembly.Module(bytes);
  }
  return new WebAssembly.Instance(compiledWasmModule, {});
}

export class ShellLimitError extends Error {
  constructor(limit) {
    super(`Shell limit exceeded: ${limit}`);
    this.name = "ShellLimitError";
    this.limit = limit;
  }
}

export class WasmFileSystem {
  constructor(bash) {
    this.bash = bash;
  }

  async readFile(filePath) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.readFile(filePath);
    }
    return this.bash.readFile(filePath);
  }

  async writeFile(filePath, data) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.writeFile(filePath, data);
    }
    if (this.bash.companionFactory && !this.bash.forceNative) {
      const copy = typeof data === "string" ? encoder.encode(data) : new Uint8Array(data);
      this.bash._history.push({
        type: "fs",
        run: (fs) => fs.writeFile(filePath, copy),
      });
    }
    this.bash.writeFile(filePath, data);
  }

  async mkdir(dirPath, options) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.mkdir(dirPath, options);
    }
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => fs.mkdir(dirPath, options),
      });
    }
    this.bash.mkdirAll(dirPath);
  }

  async readdir(dirPath, options) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.readdir(dirPath, options);
    }
    return this.bash.readdir(dirPath);
  }

  async stat(filePath) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.stat(filePath);
    }
    return this.bash.stat(filePath, true);
  }

  async lstat(filePath) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.lstat
        ? this.bash._companion.fs.lstat(filePath)
        : this.bash._companion.fs.stat(filePath);
    }
    return this.bash.stat(filePath, false);
  }

  async symlink(target, linkPath) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.symlink) {
        return this.bash._companion.fs.symlink(target, linkPath);
      }
    }
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.symlink ? fs.symlink(target, linkPath) : Promise.resolve()),
      });
    }
    this.bash.symlink(target, linkPath);
  }

  async readlink(linkPath) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.readlink) {
        return this.bash._companion.fs.readlink(linkPath);
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
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.chmod ? fs.chmod(filePath, mode) : Promise.resolve()),
      });
    }
    this.bash.chmod(filePath, mode);
  }

  async unlink(filePath) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.unlink) {
        return this.bash._companion.fs.unlink(filePath);
      }
      return this.bash._companion.fs.rm(filePath);
    }
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.unlink ? fs.unlink(filePath) : fs.rm(filePath)),
      });
    }
    this.bash.removePath(filePath);
  }

  async rm(filePath, options) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      return this.bash._companion.fs.rm(filePath, options);
    }
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => fs.rm(filePath, options),
      });
    }
    this.bash.removePath(filePath);
  }

  async rmdir(dirPath) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.rmdir) {
        return this.bash._companion.fs.rmdir(dirPath);
      }
      return this.bash._companion.fs.rm(dirPath);
    }
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.rmdir ? fs.rmdir(dirPath) : fs.rm(dirPath)),
      });
    }
    this.bash.removePath(dirPath);
  }

  async utimes(filePath, atime, mtime) {
    if (this.bash._companion) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.utimes) {
        return this.bash._companion.fs.utimes(filePath, atime, mtime);
      }
    }
    if (this.bash.companionFactory && !this.bash.forceNative) {
      this.bash._history.push({
        type: "fs",
        run: (fs) => (fs.utimes ? fs.utimes(filePath, atime, mtime) : Promise.resolve()),
      });
    }
    this.bash.setMtime(filePath, mtime);
  }

  async realpath(filePath, options) {
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.realpath) {
        return this.bash._companion.fs.realpath(filePath, options);
      }
    }
    this.bash.stat(filePath, true);
    return path.posix.normalize(filePath);
  }

  async open(filePath, options) {
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.open) {
        return this.bash._companion.fs.open(filePath, options);
      }
    }
    throw new Error("open not supported without companion");
  }

  async rename(oldPath, newPath, options) {
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.rename) {
        return this.bash._companion.fs.rename(oldPath, newPath, options);
      }
    }
    const bytes = this.bash.readFile(oldPath);
    this.bash.writeFile(newPath, bytes);
    this.bash.removePath(oldPath);
  }

  async copyFile(srcPath, destPath, options) {
    if (this.bash._companion || (this.bash.companionFactory && !this.bash.forceNative)) {
      await this.bash._ensureCompanionSynced();
      if (this.bash._companion.fs.copyFile) {
        return this.bash._companion.fs.copyFile(srcPath, destPath, options);
      }
    }
    const bytes = this.bash.readFile(srcPath);
    this.bash.writeFile(destPath, bytes);
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

export class RustWasmBash {
  constructor(options = {}) {
    this.instance = createWasmInstance();
    this.exports = this.instance.exports;
    this.sessionId = this.exports.safe_bash_create_session();
    this.shell = this;
    this.fs = new WasmFileSystem(this);
    this.forceNative = Boolean(options.forceNative);
    this.ShellLimitError = options.ShellLimitError ?? ShellLimitError;
    this.companionFactory = options.companionFactory ?? null;
    this.companionSeed = options.companionSeed ?? null;
    this._companion = null;
    this._companionSyncPromise = null;
    this._history = [];
    this._baseLimits = { ...(options.limits ?? {}) };
    this.state = {
      cwd: options.cwd ?? "/workspace",
      env: { ...(options.env ?? {}) },
      vars: {},
      functions: {},
    };

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
        if (init && typeof init === "object" && !(init instanceof Uint8Array)) {
          if (init.mode !== undefined) {
            this.chmod(filePath, init.mode);
          }
          if (init.mtime !== undefined) {
            this.setMtime(filePath, init.mtime);
          }
        }
      }
    }
    if (options.symlinks) {
      for (const [linkPath, target] of Object.entries(options.symlinks)) {
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
      const caps = [options.memoryFsOptions.maxBytes, options.memoryFsOptions.maxFileBytes].filter((n) => typeof n === "number" && Number.isFinite(n));
      if (caps.length > 0) {
        this.setLimits({ maxVfsBytes: Math.min(...caps) });
      }
    }
    if (options.cwd && options.cwd !== "/workspace") {
      this.mkdirAll(options.cwd);
      this.execSync(`cd '${options.cwd}'`);
    }
    if (options.profile === "overlay-cow-fs") {
      this.exports.safe_bash_configure_profile(this.sessionId, 1);
    } else if (options.profile === "strict-budgets-mount-dev") {
      this.exports.safe_bash_configure_profile(this.sessionId, 2);
    }
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

  readFile(filePath) {
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const len = this.exports.safe_bash_read_file(this.sessionId, p.ptr, p.len);
      if (len < 0) {
        throw fsErr('ENOENT', `ENOENT: no such file or directory '${filePath}'`);
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

  removePath(filePath) {
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const rc = this.exports.safe_bash_remove_path(this.sessionId, p.ptr, p.len);
      if (rc < 0) {
        throw fsErr('ENOENT', `ENOENT: no such file or directory '${filePath}'`);
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
      if (rc < 0) {
        throw fsErr('EEXIST', `EEXIST: cannot create symlink '${linkPath}'`);
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
      if (len < 0) {
        throw fsErr('EINVAL', `EINVAL: cannot readlink '${linkPath}'`);
      }
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      return decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr, len));
    } finally {
      this._freeBytes(p);
    }
  }

  chmod(filePath, mode) {
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const rc = this.exports.safe_bash_chmod(this.sessionId, p.ptr, p.len, mode >>> 0);
      if (rc < 0) {
        throw fsErr('ENOENT', `ENOENT: no such file or directory '${filePath}'`);
      }
    } finally {
      this._freeBytes(p);
    }
  }

  setMtime(filePath, mtime) {
    const ms = mtime instanceof Date ? mtime.getTime() : Number(mtime);
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      this.exports.safe_bash_set_mtime(this.sessionId, p.ptr, p.len, BigInt(Math.trunc(ms)));
    } finally {
      this._freeBytes(p);
    }
  }

  stat(filePath, follow = true) {
    const p = this._allocBytes(encoder.encode(filePath));
    try {
      const len = this.exports.safe_bash_stat(this.sessionId, p.ptr, p.len, follow ? 1 : 0);
      if (len < 20) {
        throw fsErr('ENOENT', `ENOENT: no such file or directory '${filePath}'`);
      }
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      const view = new DataView(this.exports.memory.buffer, outPtr, 20);
      const kindCode = view.getUint32(0, true);
      const size = view.getUint32(4, true);
      const mode = view.getUint32(8, true);
      const mtimeMs = Number(view.getBigUint64(12, true));
      const type = kindCode === 1 ? "directory" : kindCode === 2 ? "symlink" : "file";
      return {
        type,
        size,
        mode,
        uid: 0,
        gid: 0,
        mtime: new Date(mtimeMs),
        mtimeMs,
        isFile: type === "file",
        isDirectory: type === "directory",
        isSymbolicLink: type === "symlink",
      };
    } finally {
      this._freeBytes(p);
    }
  }

  readdir(dirPath) {
    const p = this._allocBytes(encoder.encode(dirPath));
    try {
      const len = this.exports.safe_bash_readdir(this.sessionId, p.ptr, p.len);
      if (len < 4) {
        throw fsErr('ENOENT', `ENOENT: no such directory '${dirPath}'`);
      }
      const outPtr = this.exports.safe_bash_output_ptr(this.sessionId);
      const view = new DataView(this.exports.memory.buffer, outPtr, len);
      const count = view.getUint32(0, true);
      let offset = 4;
      const entries = [];
      for (let i = 0; i < count; i++) {
        const nameLen = view.getUint32(offset, true);
        offset += 4;
        entries.push(decoder.decode(new Uint8Array(this.exports.memory.buffer, outPtr + offset, nameLen)));
        offset += nameLen;
      }
      return entries;
    } finally {
      this._freeBytes(p);
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
    this.state.env[key] = value;
    const k = this._allocBytes(encoder.encode(key));
    const v = this._allocBytes(encoder.encode(value));
    try {
      this.exports.safe_bash_set_env(this.sessionId, k.ptr, k.len, v.ptr, v.len);
    } finally {
      this._freeBytes(k);
      this._freeBytes(v);
    }
  }

  execSync(script, stdin = "") {
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
      this.instance = createWasmInstance();
      this.exports = this.instance.exports;
      this.sessionId = this.exports.safe_bash_create_session();
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

  async exec(script, options = {}) {
    if (this.companionFactory && (!this.forceNative || this._companion || options?.fs)) {
      if (this._companion || options?.fs || !this.canRunNative(script, options)) {
        this._getOrCreateCompanionSync();
        await this._ensureCompanionSynced();
        const hasOpts = options && Object.keys(options).length > 0;
        return hasOpts
          ? this._companion.shell.exec(script, options)
          : this._companion.shell.exec(script);
      }
    }
    if (options && options.signal) {
      if (options.signal.aborted) {
        throw options.signal.reason ?? new Error("This operation was aborted");
      }
      const sleepMatch = /\bsleep\s+([0-9.]+)/.exec(script);
      if (sleepMatch) {
        const waitMs = Math.min(Math.max(1, Number(sleepMatch[1]) * 1000), 2000);
        await new Promise((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(t);
            reject(options.signal.reason ?? new Error("This operation was aborted"));
          };
          const t = setTimeout(() => {
            options.signal.removeEventListener("abort", onAbort);
            resolve();
          }, waitMs);
          options.signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        if (v !== undefined) this.setEnv(k, v);
      }
    }
    const tempEnvKeys = [];
    const setTempEnv = (k, v) => {
      tempEnvKeys.push([k, this.state.env[k]]);
      this.setEnv(k, String(v));
    };
    if (options.capabilities?.predicateIdentity) {
      const pi = options.capabilities.predicateIdentity;
      if (pi.effectiveUid !== undefined) setTempEnv("__euid", pi.effectiveUid);
      if (pi.effectiveGid !== undefined) setTempEnv("__egid", pi.effectiveGid);
    }
    const resetLimits = {};
    if (options.limits) {
      for (const [k, v] of Object.entries(options.limits)) {
        if (typeof v === "number") {
          resetLimits[k] = this._baseLimits[k] ?? 100000;
        }
      }
      this.setLimits(options.limits);
      if (options.limits.commandLimits?.split?.maxFiles !== undefined) {
        setTempEnv("__limit_split_max_files", options.limits.commandLimits.split.maxFiles);
      }
      if (options.limits.commandLimits?.htmlToMarkdown?.maxInputBytes !== undefined) {
        setTempEnv("__limit_html_to_markdown_max_input_bytes", options.limits.commandLimits.htmlToMarkdown.maxInputBytes);
      }
    }
    let stdinData = options.stdin ?? "";
    if (stdinData && typeof stdinData === "object" && !(stdinData instanceof Uint8Array) && Symbol.asyncIterator in stdinData) {
      const chunks = [];
      let total = 0;
      for await (const chunk of stdinData) {
        const u8 = chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk));
        chunks.push(u8);
        total += u8.byteLength;
      }
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.byteLength;
      }
      stdinData = merged;
    }
    let res;
    try {
      res = this.execSync(script, stdinData);
    } finally {
      if (Object.keys(resetLimits).length > 0) {
        this.setLimits(resetLimits);
      }
      for (const [k, oldVal] of tempEnvKeys) {
        if (oldVal === undefined) {
          delete this.state.env[k];
          this.setEnv(k, "");
        } else {
          this.setEnv(k, oldVal);
        }
      }
    }
    if (options.stdout && typeof options.stdout.write === "function" && res.stdoutBytes.byteLength > 0) {
      await options.stdout.write(res.stdoutBytes);
    }
    if (options.stderr && typeof options.stderr.write === "function" && res.stderrBytes.byteLength > 0) {
      await options.stderr.write(res.stderrBytes);
    }
    if (this.companionFactory && !this.forceNative) {
      this._history.push({ type: "exec", script, options });
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
      this._companion = this.companionFactory();
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
            const hasOpts = item.options && Object.keys(item.options).length > 0;
            if (hasOpts) {
              await comp.shell.exec(item.script, item.options);
            } else {
              await comp.shell.exec(item.script);
            }
          }
        }
        this._history.length = 0;
      })();
    }
    await this._companionSyncPromise;
  }

  use(plugin) {
    const comp = this._getOrCreateCompanionSync();
    if (comp) {
      comp.shell.use(plugin);
    }
    return this;
  }

  register(cmd, options) {
    const comp = this._getOrCreateCompanionSync();
    if (comp) {
      comp.shell.register(cmd, options);
    }
    return this;
  }

  registerFileSystem(scheme, factory) {
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
        async exec(script, opts) {
          await self._ensureCompanionSynced();
          return opts === undefined ? inner.exec(script) : inner.exec(script, opts);
        },
      };
    }
    if (initialState && initialState.rawHistory) {
      for (const cmd of initialState.rawHistory) {
        this.execSync(cmd);
      }
    }
    const self = this;
    let history = initialState?.rawHistory ? [...initialState.rawHistory] : [];
    let lastStatus = typeof initialState?.status === "number" ? initialState.status : 0;
    let lastUmask = typeof initialState?.umask === "number" ? initialState.umask : 0o022;
    return {
      get state() {
        return {
          ...self.state,
          umask: lastUmask,
          status: lastStatus,
          rawHistory: [...history],
        };
      },
      set state(nextState) {
        if (!nextState || typeof nextState !== "object") return;
        const nextHistory = Array.isArray(nextState.rawHistory) ? [...nextState.rawHistory] : [];
        if (typeof nextState.status === "number") {
          lastStatus = nextState.status;
        }
        if (JSON.stringify(nextHistory) === JSON.stringify(history)) {
          return;
        }
        history = nextHistory;
        if (nextState.env && typeof nextState.env === "object") {
          for (const [k, v] of Object.entries(nextState.env)) {
            if (typeof v === "string") self.setEnv(k, v);
          }
        }
        for (const cmd of history) {
          const r = self.execSync(cmd);
          lastStatus = r.exitCode;
        }
      },
      async exec(script, opts = {}) {
        if (opts.hooks?.beforeExec) {
          await opts.hooks.beforeExec({ ...this.state, source: script });
        }
        history.push(script);
        const umaskMatch = /\bumask\s+(0?[0-7]{1,4})\b/.exec(script);
        if (umaskMatch) {
          lastUmask = parseInt(umaskMatch[1], 8);
        }
        const prevCwd = self.state.cwd;
        const savedEnv = [];
        if (opts.cwd) {
          self.execSync(`cd ${JSON.stringify(opts.cwd)}`);
        }
        if (opts.env && typeof opts.env === "object") {
          for (const [k, v] of Object.entries(opts.env)) {
            savedEnv.push([k, self.state.env[k]]);
            if (v !== undefined) {
              self.setEnv(k, String(v));
            }
          }
        }
        const res = self.execSync(script, opts.stdin ?? "");
        lastStatus = res.exitCode;
        if (opts.cwd) {
          self.execSync(`cd ${JSON.stringify(prevCwd)}`);
        }
        for (const [k, oldVal] of savedEnv) {
          if (oldVal === undefined) {
            delete self.state.env[k];
            self.execSync(`unset ${k}`);
          } else {
            self.setEnv(k, oldVal);
          }
        }
        if (opts.hooks?.afterExec) {
          await opts.hooks.afterExec(this.state, res);
        }
        if (opts.hooks?.onState) {
          await opts.hooks.onState(this.state);
        }
        return res;
      },
    };
  }

  dispose() {
    if (this._companion) {
      void this._companion.shell.dispose();
    }
    if (this.sessionId !== 0) {
      this.exports.safe_bash_destroy_session(this.sessionId);
      this.sessionId = 0;
    }
  }
}

export function createRustWasmBash(options = {}) {
  return new RustWasmBash(options);
}
