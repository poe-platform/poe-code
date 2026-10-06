import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

let compiledWasmModule = null;
let sharedWasmInstance = null;

function getSharedWasmInstance() {
  if (!sharedWasmInstance) {
    if (!compiledWasmModule) {
      const wasmPath = path.join(__dirname, "safe_bash_rust.wasm");
      const bytes = fs.readFileSync(wasmPath);
      compiledWasmModule = new WebAssembly.Module(bytes);
    }
    sharedWasmInstance = new WebAssembly.Instance(compiledWasmModule, {});
  }
  return sharedWasmInstance;
}

export class RustWasmBash {
  constructor(options = {}) {
    this.instance = getSharedWasmInstance();
    this.exports = this.instance.exports;
    this.sessionId = this.exports.safe_bash_create_session();
    this.shell = this;
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
      }
    }
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        this.setEnv(k, v);
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
        throw new Error(`ENOENT: no such file or directory '${filePath}'`);
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
        return { stdout: "", stderr: "", exitCode: 1, cwd: this.state.cwd, env: this.state.env };
      }
      const view = new DataView(this.exports.memory.buffer, outPtr, outLen);
      const exitCode = view.getInt32(0, true);
      const stdoutLen = view.getUint32(4, true);
      const stderrLen = view.getUint32(8, true);
      const cwdLen = view.getUint32(12, true);
      let offset = outPtr + 16;
      const stdout = decoder.decode(new Uint8Array(this.exports.memory.buffer, offset, stdoutLen));
      offset += stdoutLen;
      const stderr = decoder.decode(new Uint8Array(this.exports.memory.buffer, offset, stderrLen));
      offset += stderrLen;
      const cwd = decoder.decode(new Uint8Array(this.exports.memory.buffer, offset, cwdLen));
      this.state.cwd = cwd;
      return {
        stdout,
        stderr,
        exitCode,
        cwd,
        env: this.state.env,
      };
    } finally {
      this._freeBytes(s);
      this._freeBytes(i);
    }
  }

  async exec(script, options = {}) {
    return this.execSync(script, options.stdin ?? "");
  }

  createSession(initialState) {
    if (initialState && initialState.rawHistory) {
      for (const cmd of initialState.rawHistory) {
        this.execSync(cmd);
      }
    }
    const self = this;
    const history = initialState?.rawHistory ? [...initialState.rawHistory] : [];
    return {
      get state() {
        return {
          ...self.state,
          rawHistory: history,
        };
      },
      async exec(script, opts = {}) {
        history.push(script);
        return self.execSync(script, opts.stdin ?? "");
      },
    };
  }

  dispose() {
    if (this.sessionId !== 0) {
      this.exports.safe_bash_destroy_session(this.sessionId);
      this.sessionId = 0;
    }
  }
}

export function createRustWasmBash(options = {}) {
  return new RustWasmBash(options);
}
