import { posix } from "node:path";
import { types } from "node:util";
import type { CommandContext } from "../../contracts/command.js";
import { isErrnoCode, isFsError } from "../../contracts/errors.js";
import type { ByteSink } from "../../contracts/io.js";
import { NodeProfileError, nodeLimits, type NodeGrants, type NodeGuestError, type NodeHostRequest, type NodeHostResponse, type NodeReason } from "./types.js";
import { integer, NodeLedger, record, strings, text } from "./values.js";

export function fsDescriptor(error: unknown): NodeGuestError | undefined {
  try {
    if (error === null || typeof error !== "object" || types.isProxy(error) || Array.isArray(error)) return undefined;
    let prototype: object | null = error;
    let depth = 0;
    while (prototype !== null) {
      if (types.isProxy(prototype) || ++depth > 16) return undefined;
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
    if (!isFsError(error)) return undefined;
    const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(error)) {
      if (key === "stack" || key === "cause") continue;
      if (typeof key !== "string" || !["name", "message", "code", "errno", "path", "syscall", "dest"].includes(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(error, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
      fields[key] = descriptor.value;
    }
    const value = record(fields, ["name", "message", "code", "errno"], ["path", "syscall", "dest"]);
    if (value.name !== "FsError" || !isErrnoCode(value.code) || typeof value.errno !== "number" || !Number.isSafeInteger(value.errno) || value.errno >= 0) return undefined;
    const optional = (name: string): string | null => value[name] === undefined ? null : text(value[name], nodeLimits.errorBytes, "FS error field");
    return { name: "FsError", message: text(value.message, nodeLimits.errorBytes, "FS error message"), code: value.code, errno: value.errno, path: optional("path"), syscall: optional("syscall"), dest: optional("dest") };
  } catch { return undefined; }
}
function localError(code: string): NodeGuestError { return { name: "Error", message: code === "ERR_VNODE_DENIED" ? "Virtual capability denied" : "Unsupported restricted Node operation", code, errno: null, path: null, syscall: null, dest: null }; }
class FsOperationFailure { constructor(readonly reason: unknown) {} }
function response(sequence: number, kind: NodeHostResponse["kind"], value: string | null = null, cacheKey: NodeHostResponse["cacheKey"] = null, error: NodeGuestError | null = null): NodeHostResponse { return { sequence, kind, text: value, error, cacheKey }; }
export function readNodeHostRequest(value: unknown): NodeHostRequest {
  const item = record(value, ["sequence", "op", "authority", "path", "flag", "text", "moduleKey"]);
  const sequence = integer(item.sequence, nodeLimits.operations, "sequence");
  if (sequence === 0) throw new NodeProfileError("request sequence");
  let bytes = 0;
  for (const field of ["op", "authority", "path", "flag", "moduleKey"] as const) {
    if (item[field] !== null) { const entry = text(item[field], field === "path" ? nodeLimits.pathBytes : nodeLimits.metadataBytes, "request metadata"); bytes += Buffer.byteLength(entry); }
  }
  if (bytes > nodeLimits.metadataBytes) throw new NodeProfileError("request metadata");
  if (item.text !== null) text(item.text, nodeLimits.operationBytes, "request payload");
  const empty = item.path === null && item.flag === null;
  const noBody = item.text === null;
  const noModule = item.moduleKey === null;
  const valid = item.op === "authorizeModule" && item.authority === "module" && empty && noBody && ["fs", "path", "process"].includes(item.moduleKey as string)
    || item.op === "authorizeJson" && item.authority === "json" && typeof item.path === "string" && item.flag === "r" && noBody && noModule
    || item.op === "readText" && ["json", "data"].includes(item.authority as string) && typeof item.path === "string" && item.flag === "r" && noBody && noModule
    || item.op === "readText" && item.authority === "stdin" && item.path === null && item.flag === "r" && noBody && noModule
    || item.op === "writeText" && item.authority === "data" && typeof item.path === "string" && (item.flag === "w" || item.flag === "wx") && typeof item.text === "string" && noModule
    || item.op === "writeOutput" && ["stdout", "stderr"].includes(item.authority as string) && empty && typeof item.text === "string" && noModule
    || item.op === "path" && item.authority === "path" && empty && typeof item.text === "string" && ["join", "resolve", "normalize", "dirname", "basename", "extname", "relative", "isAbsolute"].includes(item.moduleKey as string);
  if (!valid) throw new TypeError("node protocol: operation shape");
  return Object.freeze(item) as unknown as NodeHostRequest;
}
export interface HostOwner {
  readonly signal: AbortSignal;
  readonly ledger: NodeLedger;
  readonly context: CommandContext;
  readonly isClosed: () => boolean;
  readonly check: () => void;
  readonly failure: (reason: unknown, origin?: "profile" | "execution") => void;
  readonly job: <Value>(start: () => Value | PromiseLike<Value>) => Promise<Value>;
}
export class NodeHost {
  #sequence = 0;
  #active = false;
  #pending: { sequence: number; release: () => void; response: NodeHostResponse | undefined; failure: NodeReason | undefined } | undefined;
  #stdinUsed = false;
  #stdinActive = false;
  #read = 0;
  #written = 0;
  #output = 0;
  #jsonBytes = 0;
  #authorized: string | undefined;
  #authorizationSequence = 0;
  #pulls = 0;
  constructor(readonly owner: HostOwner, readonly grants: Readonly<Required<NodeGrants>>, readonly cwd: string, readonly directory: string) {}
  #path(value: unknown, base = this.cwd): string {
    const source = text(value, nodeLimits.pathBytes, "path");
    if (source.includes("\0")) throw new TypeError("node protocol: NUL path");
    return text(posix.resolve(base, source), nodeLimits.pathBytes, "resolved path");
  }
  #check(): void { this.owner.check(); }
  #settled(): void { this.owner.context.signal.throwIfAborted(); this.owner.signal.throwIfAborted(); }
  #admit(value: unknown): NodeHostRequest {
    const item = readNodeHostRequest(value);
    if (item.sequence !== this.#sequence + 1 || this.#active || this.#pending) throw new NodeProfileError("request sequence/delivery");
    return item;
  }
  async #stdin(maximum: number): Promise<Uint8Array> {
    if (this.#stdinActive) throw new NodeProfileError("concurrent stdin");
    if (this.#stdinUsed) return new Uint8Array(0);
    this.#stdinUsed = true; this.#stdinActive = true;
    let storage: Uint8Array | undefined;
    const release = this.owner.ledger.reserve("stdin-collection", maximum);
    try {
      storage = new Uint8Array(maximum);
      let iterator: AsyncIterator<Uint8Array>;
      try { iterator = this.owner.context.stdin[Symbol.asyncIterator](); }
      catch (error) { this.owner.failure(error, "execution"); throw error; }
      let offset = 0;
      while (true) {
        this.#check();
        if (++this.#pulls > nodeLimits.steps) throw new NodeProfileError("stdin producer work");
        let item: IteratorResult<Uint8Array>;
        try { item = await this.owner.job(() => iterator.next()); }
        catch (error) { this.owner.failure(error, "execution"); throw error; }
        this.#check();
        if (item.done) break;
        const fragment = item.value;
        if (types.isProxy(fragment) || !types.isUint8Array(fragment)) throw new TypeError("node stdin requires bytes");
        if (fragment.byteLength > maximum - offset) throw new NodeProfileError("stdin bytes");
        storage.set(fragment, offset); offset += fragment.byteLength;
      }
      return storage.subarray(0, offset);
    } finally { storage = undefined; this.#stdinActive = false; release(); }
  }
  async source(filename: string | null): Promise<string> {
    if (!this.grants.sourceRead || filename === null && !this.grants.stdinRead) throw new NodeProfileError("source read grant");
    const release = this.owner.ledger.reserve("source-acquisition", nodeLimits.sourceBytes * 5);
    let bytes: Uint8Array | undefined;
    try {
      this.#check();
      if (filename === null) bytes = await this.#stdin(nodeLimits.sourceBytes);
      else {
        const selected = this.#path(filename);
        try { bytes = await this.owner.job(() => this.owner.context.fs.readFile(selected, { signal: this.owner.signal, maxBytes: nodeLimits.sourceBytes })); }
        catch (error) { this.owner.failure(error, "execution"); throw error; }
      }
      this.#check();
      if (types.isProxy(bytes) || !types.isUint8Array(bytes) || bytes.byteLength > nodeLimits.sourceBytes) throw new NodeProfileError("source bytes");
      const source = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      return text(source.startsWith("\ufeff") ? source.slice(1) : source, nodeLimits.sourceBytes, "decoded source");
    } finally { bytes = undefined; release(); }
  }
  async #fs<Value>(start: () => Promise<Value>): Promise<Value> { try { return await this.owner.job(start); } catch (error) { throw new FsOperationFailure(error); } }
  async #perform(item: NodeHostRequest): Promise<NodeHostResponse> {
    const deny = (): NodeHostResponse => response(item.sequence, "denied", null, null, localError("ERR_VNODE_DENIED"));
    const key = (path: string): { namespace: number; path: string } => ({ namespace: 1, path });
    if (item.op === "authorizeModule") return response(item.sequence, "void");
    if (item.op === "path") {
      const argumentsValue: unknown = JSON.parse(item.text!);
      const argumentsList = strings(argumentsValue, 16, nodeLimits.metadataBytes);
      if (argumentsList.some(value => value.includes("\0"))) throw new TypeError("node protocol: path NUL");
      const method = item.moduleKey!;
      const count = argumentsList.length;
      let output: string;
      if (method === "join") output = posix.join(...argumentsList);
      else if (method === "resolve") output = posix.resolve(this.cwd, ...argumentsList);
      else if (method === "basename" && (count === 1 || count === 2)) output = posix.basename(argumentsList[0]!, argumentsList[1]);
      else if (method === "relative" && count === 2) output = posix.relative(this.#path(argumentsList[0]), this.#path(argumentsList[1]));
      else if (count === 1 && method === "normalize") output = posix.normalize(argumentsList[0]!);
      else if (count === 1 && method === "dirname") output = posix.dirname(argumentsList[0]!);
      else if (count === 1 && method === "extname") output = posix.extname(argumentsList[0]!);
      else if (count === 1 && method === "isAbsolute") output = posix.isAbsolute(argumentsList[0]!) ? "true" : "false";
      else return response(item.sequence, "unsupported", null, null, localError("ERR_VNODE_UNSUPPORTED"));
      return response(item.sequence, "text", text(output, nodeLimits.pathBytes, "path result"));
    }
    if (item.op === "authorizeJson") {
      if (!this.grants.dataRead || !this.grants.jsonModules) return deny();
      const requested = item.path!;
      if (!(requested.startsWith("./") || requested.startsWith("../") || requested.startsWith("/")) || !requested.endsWith(".json")) return response(item.sequence, "unsupported", null, null, localError("ERR_VNODE_UNSUPPORTED"));
      const filename = this.#path(requested, this.directory);
      const canonical = await this.#fs(() => this.owner.context.fs.realpath(filename, { signal: this.owner.signal }));
      this.#settled();
      this.#authorized = this.#path(canonical);
      this.#authorizationSequence = item.sequence;
      return response(item.sequence, "text", "", key(this.#authorized));
    }
    if (item.op === "readText") {
      if (item.authority === "stdin" ? !this.grants.stdinRead : !this.grants.dataRead || item.authority === "json" && !this.grants.jsonModules) return deny();
      const filename = item.path === null ? null : this.#path(item.path);
      if (item.authority === "json" && (filename !== this.#authorized || item.sequence !== this.#authorizationSequence + 1)) throw new NodeProfileError("JSON authorization");
      if (item.authority === "json") this.#authorized = undefined;
      const remaining = Math.min(nodeLimits.operationBytes, nodeLimits.readBytes - this.#read, item.authority === "json" ? nodeLimits.jsonBytes - this.#jsonBytes : nodeLimits.operationBytes);
      let bytes: Uint8Array | undefined;
      try {
        bytes = filename === null ? await this.#stdin(remaining) : await this.#fs(() => this.owner.context.fs.readFile(filename, { signal: this.owner.signal, maxBytes: remaining }));
        this.#settled();
        if (types.isProxy(bytes) || !types.isUint8Array(bytes) || bytes.byteLength > remaining) throw new NodeProfileError("read bytes");
        this.#read += bytes.byteLength;
        if (item.authority === "json") {
          this.#jsonBytes += bytes.byteLength;
        }
        let decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
        if (item.authority === "json" && decoded.startsWith("\ufeff")) decoded = decoded.slice(1);
        text(decoded, nodeLimits.operationBytes, "decoded read result");
        return response(item.sequence, "text", decoded, item.authority === "json" ? key(filename!) : null);
      } finally { bytes = undefined; }
    }
    const payload = item.text!;
    const size = Buffer.byteLength(payload);
    if (item.op === "writeText") {
      if (!this.grants.dataWrite) return deny();
      if (size > nodeLimits.writeBytes - this.#written) throw new NodeProfileError("write bytes");
      const filename = this.#path(item.path);
      this.#written += size;
      let owned: Uint8Array | undefined = new TextEncoder().encode(payload);
      try { await this.#fs(() => this.owner.context.fs.writeFile(filename, owned!, { signal: this.owner.signal, flag: item.flag as "w" | "wx" })); this.#settled(); }
      finally { owned = undefined; }
      return response(item.sequence, "void");
    }
    if (item.authority === "stdout" ? !this.grants.stdoutWrite : !this.grants.stderrWrite) return deny();
    if (size > nodeLimits.outputBytes - this.#output) throw new NodeProfileError("output bytes");
    this.#output += size;
    await this.write(item.authority === "stdout" ? this.owner.context.stdout : this.owner.context.stderr, payload);
    return response(item.sequence, "void");
  }
  async write(sink: ByteSink, value: string): Promise<void> {
    let closed: AbortSignal | undefined;
    let observed: NodeReason | undefined;
    const onClosed = (): void => { observed ??= { present: true, value: closed!.reason }; this.owner.failure(observed.value); };
    let bytes: Uint8Array | undefined;
    try {
      const owned = sink.ownedOutput;
      const output = owned ?? sink;
      closed = owned?.consumerClosed;
      if (closed?.aborted) { onClosed(); throw observed!.value; }
      closed?.addEventListener("abort", onClosed, { once: true });
      bytes = new TextEncoder().encode(value);
      await this.owner.job(() => output.write(bytes!));
      if (observed) throw observed.value;
    } catch (error) { this.owner.failure(error, "execution"); throw error; }
    finally { bytes = undefined; closed?.removeEventListener("abort", onClosed); }
  }
  async diagnostic(value: string): Promise<void> {
    if (!this.grants.stderrWrite) return;
    const count = Buffer.byteLength(value);
    if (count > nodeLimits.outputBytes - this.#output) throw new NodeProfileError("diagnostic output bytes");
    this.#output += count;
    await this.write(this.owner.context.stderr, value);
  }
  async request(value: unknown): Promise<NodeHostResponse> {
    let item: NodeHostRequest;
    try { this.#check(); item = this.#admit(value); } catch (error) { this.owner.failure(error, "profile"); throw error; }
    this.#active = true; this.#sequence = item.sequence;
    let release: (() => void) | undefined;
    try {
      release = this.owner.ledger.reserve("operation-" + item.sequence, nodeLimits.operationBytes * 6 + nodeLimits.metadataBytes * 2);
      let result: NodeHostResponse;
      let failure: NodeReason | undefined;
      try { result = await this.#perform(item); }
      catch (error) {
        this.owner.context.signal.throwIfAborted(); this.owner.signal.throwIfAborted();
        const actual = error instanceof FsOperationFailure ? error.reason : error;
        const descriptor = error instanceof FsOperationFailure ? fsDescriptor(actual) : undefined;
        if (!descriptor) {
          if (error instanceof FsOperationFailure) this.owner.failure(actual, "execution");
          throw actual;
        }
        failure = { present: true, value: actual };
        result = response(item.sequence, "fsError", null, null, descriptor);
      }
      this.#pending = { sequence: item.sequence, response: result, failure, release };
      release = undefined;
      return result;
    } catch (error) { this.owner.failure(error, "profile"); throw error; }
    finally { this.#active = false; release?.(); }
  }
  delivered(sequence: number): void {
    const pending = this.#pending;
    if (!pending || sequence !== pending.sequence || this.#active) { const error = new NodeProfileError("postcopy delivery"); this.owner.failure(error, "profile"); throw error; }
    this.#pending = undefined;
    pending.response = undefined; pending.failure = undefined; pending.release();
  }
  retire(): NodeReason | undefined {
    const pending = this.#pending;
    this.#pending = undefined;
    if (!pending) return undefined;
    const failure = pending.failure;
    pending.response = undefined; pending.failure = undefined; pending.release();
    return failure;
  }
}
