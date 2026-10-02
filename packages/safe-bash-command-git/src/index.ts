import { commandRuntimeIdentity, readBytes, writeBytes, type CommandDefinition, type VirtualShellPlugin } from 'safe-bash-contracts';
import type { FileSystem } from '@poe-code/safe-fs/core';
import { gitModule } from '#git-wasm';

export interface GitLimits { readonly maxEntries: number; readonly maxBytes: number; readonly maxDepth: number; readonly maxHttpRequests: number; readonly maxHttpBytes: number }
export interface GitHttpRequest { readonly url: string; readonly method: string; readonly headers: Readonly<Record<string,string>>; readonly body: Uint8Array; readonly signal: AbortSignal }
export interface GitHttpResponse { readonly status: number; readonly headers: Readonly<Record<string,string>>; readonly body: Uint8Array }
export interface GitCommandsOptions { readonly http?: (request:GitHttpRequest)=>Promise<GitHttpResponse>; readonly limits?: Partial<GitLimits>; readonly replace?: boolean; readonly wasmModule?: object }
interface Entry { path: string; kind: string; mode: number; data: string }
interface Result { needsStdin?: boolean; exitCode: number; stdout: string; stdoutBytes?: string | null; stderr: string; entries: Entry[] | null; request?: {url:string;method:string;headers:Record<string,string>;body:string} | null }
interface GitExports { memory: { readonly buffer: ArrayBufferLike }; git_alloc(length:number):number; git_free(ptr:number,length:number):void; git_execute(ptr:number,length:number):number; git_output_len():number }
const encoder=new TextEncoder(), decoder=new TextDecoder();
const HEX_PAIRS = Array.from({ length: 256 }, (_, i) => (i < 16 ? "0" : "") + i.toString(16));
function hexNibble(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 102) return code - 87;
  if (code >= 65 && code <= 70) return code - 55;
  return 0;
}
function encode(bytes: Uint8Array): string {
  const bufCtor = (globalThis as unknown as { Buffer?: { from(b: ArrayBufferLike, o: number, l: number): { toString(enc: "hex"): string } } }).Buffer;
  if (bufCtor) return bufCtor.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");
  const chunks: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    let chunk = "";
    const end = Math.min(i + 8192, bytes.byteLength);
    for (let j = i; j < end; j++) chunk += HEX_PAIRS[bytes[j]!]!;
    chunks.push(chunk);
  }
  return chunks.join("");
}
function decode(hex: string): Uint8Array {
  const bufCtor = (globalThis as unknown as { Buffer?: { from(s: string, enc: "hex"): Uint8Array } }).Buffer;
  if (bufCtor) {
    const b = bufCtor.from(hex, "hex");
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  const out = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < out.byteLength; i++) {
    out[i] = (hexNibble(hex.charCodeAt(i * 2)) << 4) | hexNibble(hex.charCodeAt(i * 2 + 1));
  }
  return out;
}

interface GitCommandMeta { readonly limits: GitLimits; readonly hasHttp: boolean; readonly wasmModule?: object | undefined }
const gitCommandMeta = new WeakMap<CommandDefinition["execute"], GitCommandMeta>();
function createDefaultGitExports(): GitExports {
  const module = gitModule();
  const wasm = (globalThis as unknown as { WebAssembly: { Instance: new (module: object) => { exports: GitExports } } }).WebAssembly;
  return new wasm.Instance(module).exports;
}

const CROSS_REPO_COMMANDS = new Set([
  "clone", "init", "submodule", "worktree", "remote", "fetch", "pull", "push", "bundle", "archive", "daemon", "verify-commit", "verify-tag"
]);

function normalizeScopedPath(baseCwd: string, rawPath: string): string | undefined {
  const combined = rawPath.startsWith("/") ? rawPath : `${baseCwd === "/" ? "" : baseCwd}/${rawPath}`;
  const parts = combined.split("/");
  const stack: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!p || p === ".") continue;
    if (p === "..") return undefined;
    stack.push(p);
  }
  return stack.length > 0 ? "/" + stack.join("/") : undefined;
}

function resolveGitInitTarget(
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (env && (env.GIT_DIR || env.GIT_WORK_TREE || env.GIT_COMMON_DIR || env.GIT_OBJECT_DIRECTORY || env.GIT_INDEX_FILE || env.GIT_CONFIG_GLOBAL || env.GIT_CONFIG_SYSTEM)) {
    return undefined;
  }
  if (!cwd.startsWith("/") || args.length === 0) return undefined;
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "-c") {
      i += 2;
      continue;
    }
    break;
  }
  if (args[i] !== "init") return undefined;
  i++;
  let dirArg: string | undefined;
  for (; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--bare" || a === "--template" || a === "--separate-git-dir" || a.startsWith("--template=") || a.startsWith("--separate-git-dir=")) {
      return undefined;
    }
    if (a === "-b" || a === "--initial-branch" || a === "--shared" || a === "--object-format" || a === "--ref-format") {
      i++;
      if (i >= args.length) return undefined;
      continue;
    }
    if (a === "-q" || a === "--quiet" || a.startsWith("--initial-branch=") || a.startsWith("--shared=") || a.startsWith("--object-format=") || a.startsWith("--ref-format=")) {
      continue;
    }
    if (a.startsWith("-")) return undefined;
    if (dirArg !== undefined) return undefined;
    dirArg = a;
  }
  return normalizeScopedPath(cwd, dirArg ?? ".");
}

function canScopeGitToRepoRoot(args: readonly string[], env?: Readonly<Record<string, string | undefined>>): boolean {
  if (env && (env.GIT_DIR || env.GIT_WORK_TREE || env.GIT_COMMON_DIR || env.GIT_OBJECT_DIRECTORY || env.GIT_INDEX_FILE || env.GIT_CONFIG_GLOBAL || env.GIT_CONFIG_SYSTEM)) {
    return false;
  }
  if (args.length === 0) return false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (CROSS_REPO_COMMANDS.has(a)) return false;
    if (a === "--global" || a === "--system" || a === "--bare" || a === "-C" || a === "--git-dir" || a === "--work-tree" || a === "-S" || a === "--gpg-sign" || a.startsWith("-S") || a.startsWith("--gpg-sign=")) return false;
    if (a.startsWith("--git-dir=") || a.startsWith("--work-tree=") || a.startsWith("-C")) return false;
    if (a.includes("..") || a.startsWith("/")) return false;
  }
  return true;
}

function ancestorDirs(targetPath: string): string[] {
  const parts = targetPath.split("/").filter(Boolean);
  const dirs: string[] = [];
  let cur = "";
  for (let i = 0; i < parts.length; i++) {
    cur += "/" + parts[i]!;
    dirs.push(cur);
  }
  return dirs;
}

async function resolveAsyncScopedRepoRoot(
  fs: FileSystem,
  cwd: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  signal: AbortSignal,
): Promise<string | undefined> {
  const initTarget = resolveGitInitTarget(cwd, args, env);
  if (initTarget) {
    try {
      const st = await fs.lstat(initTarget, { signal });
      if (st.type === "directory") return initTarget;
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (!canScopeGitToRepoRoot(args, env) || !cwd.startsWith("/") || cwd === "/") return undefined;
  let cur = cwd;
  while (cur && cur !== "/") {
    try {
      const gitStat = await fs.lstat(`${cur}/.git`, { signal });
      if (gitStat.type === "directory") {
        let hasExternal = false;
        try { await fs.lstat(`${cur}/.git/commondir`, { signal }); hasExternal = true; } catch { /* Unavailable optional markers do not enable external storage. */ }
        if (!hasExternal) {
          try { await fs.lstat(`${cur}/.git/objects/info/alternates`, { signal }); hasExternal = true; } catch { /* Unavailable optional markers do not enable external storage. */ }
        }
        return hasExternal ? undefined : cur;
      }
      return undefined;
    } catch {
      const idx = cur.lastIndexOf("/");
      cur = idx > 0 ? cur.slice(0, idx) : "/";
    }
  }
  return undefined;
}

function resolveSyncScopedRepoRoot(
  inspectNode: (path: string, follow: boolean) => SyncGitNodeInfo | undefined,
  cwd: string,
  args: readonly string[],
): string | undefined {
  const initTarget = resolveGitInitTarget(cwd, args);
  if (initTarget) {
    const st = inspectNode(initTarget, false);
    return st && st.type === "directory" ? initTarget : undefined;
  }
  if (!canScopeGitToRepoRoot(args) || !cwd.startsWith("/") || cwd === "/") return undefined;
  let cur = cwd;
  while (cur && cur !== "/") {
    const gitNode = inspectNode(`${cur}/.git`, false);
    if (gitNode) {
      if (gitNode.type === "directory" && !inspectNode(`${cur}/.git/commondir`, false) && !inspectNode(`${cur}/.git/objects/info/alternates`, false)) {
        return cur;
      }
      return undefined;
    }
    const idx = cur.lastIndexOf("/");
    cur = idx > 0 ? cur.slice(0, idx) : "/";
  }
  return undefined;
}

async function snapshot(
  fs: FileSystem,
  limits: GitLimits,
  signal: AbortSignal,
  cwd = "/",
  args: readonly string[] = [],
  env: Readonly<Record<string, string | undefined>> = {},
): Promise<Entry[]> {
  const entries: Entry[] = [];
  let total = 0;
  const unbounded = limits.maxEntries === Infinity && limits.maxBytes === Infinity && limits.maxDepth === Infinity;
  const scopedRoot = unbounded ? await resolveAsyncScopedRepoRoot(fs, cwd, args, env, signal) : undefined;
  const seenPaths = new Set<string>();
  if (scopedRoot) {
    for (const dir of ancestorDirs(scopedRoot)) {
      seenPaths.add(dir);
      entries.push({ path: dir, kind: "directory", mode: 0o755, data: "" });
    }
    const globalConfigs = ["/.gitconfig", ...(env.HOME && env.HOME.startsWith("/") && env.HOME !== "/" ? [`${env.HOME}/.gitconfig`] : [])];
    for (const cfg of globalConfigs) {
      try {
        const bytes = await fs.readFile(cfg, { signal });
        for (const dir of ancestorDirs(cfg.slice(0, cfg.lastIndexOf("/")) || "/")) {
          if (!seenPaths.has(dir)) {
            seenPaths.add(dir);
            entries.push({ path: dir, kind: "directory", mode: 0o755, data: "" });
          }
        }
        if (!seenPaths.has(cfg)) {
          seenPaths.add(cfg);
          entries.push({ path: cfg, kind: "file", mode: 0o644, data: encode(bytes) });
        }
      } catch {
        // Global configuration is best-effort in the scoped snapshot.
      }
    }
  }
  const startRoot = scopedRoot ?? "/";
  const startDepth = scopedRoot ? scopedRoot.split("/").filter(Boolean).length : 0;
  const pending = [{ path: startRoot, depth: startDepth }];
  while(pending.length) {
    const {path,depth}=pending.pop()!;
    signal.throwIfAborted();
    if(depth>limits.maxDepth) throw new Error('Git filesystem depth limit exceeded');
    for(const child of await fs.readdir(path,{signal,...(limits.maxEntries===Infinity ? {} : {maxEntries:limits.maxEntries-entries.length})})) {
      signal.throwIfAborted();
      if(entries.length>=limits.maxEntries) throw new Error('Git filesystem entry limit exceeded');
      const full=path==='/' ? `/${child.name}` : `${path}/${child.name}`;
      if (
        unbounded &&
        scopedRoot !== undefined &&
        child.type === "directory" &&
        full !== scopedRoot &&
        !full.includes("/.git/") &&
        !full.endsWith("/.git") &&
        cwd !== full &&
        !cwd.startsWith(`${full}/`)
      ) {
        try {
          const nestedGit = await fs.lstat(`${full}/.git`, { signal });
          if (nestedGit.type === "directory") {
            entries.push({ path: full, kind: "directory", mode: 0o755, data: "" });
            entries.push({ path: `${full}/.git`, kind: "directory", mode: 0o755, data: "" });
            try {
              const headBytes = await fs.readFile(`${full}/.git/HEAD`, { signal });
              entries.push({ path: `${full}/.git/HEAD`, kind: "file", mode: 0o644, data: encode(headBytes) });
            } catch {
              // Optional HEAD marker in nested repo.
            }
            continue;
          }
        } catch {
          // Not a nested git repository.
        }
      }
      if (unbounded && child.type === "directory") {
        pending.push({ path: full, depth: depth + 1 });
        entries.push({ path: full, kind: "directory", mode: 0o755, data: "" });
        continue;
      }
      if (unbounded && child.type === "file" && full.includes("/.git/") && !full.includes("/.git/hooks/")) {
        const bytes = await fs.readFile(full, { signal });
        entries.push({ path: full, kind: "file", mode: 0o644, data: encode(bytes) });
        continue;
      }
      const stat=await fs.lstat(full,{signal});
      if(stat.type==='character') continue;
      total+=encoder.encode(full).length;
      if(stat.type==='file' && total+stat.size>limits.maxBytes) throw new Error('Git filesystem byte limit exceeded');
      let bytes:Uint8Array=new Uint8Array();
      if(stat.type==='directory') pending.push({path:full,depth:depth+1});
      else if(stat.type==='symlink') { if(!fs.readlink) throw new Error('Git requires readlink for symlinks'); bytes=encoder.encode(await fs.readlink(full,{signal})); }
      else if(stat.type==='file') bytes=await fs.readFile(full,{signal,...(limits.maxBytes===Infinity ? {} : {maxBytes:limits.maxBytes-total})});
      else throw new Error('Git does not support device entries');
      total+=bytes.length;
      if(total>limits.maxBytes) throw new Error('Git filesystem byte limit exceeded');
      entries.push({path:full,kind:stat.type,mode:stat.mode,data:encode(bytes)});
    }
  }
  return entries;
}

async function publish(fs:FileSystem, before:Entry[], after:Entry[], signal:AbortSignal):Promise<void> {
  const prior=new Map(before.map(e=>[e.path,e]));
  const next=new Map(after.map(e=>[e.path,e]));
  const removed=before.filter(e=>!next.has(e.path) || next.get(e.path)!.kind!==e.kind).sort((a,b)=>b.path.length-a.path.length);
  for(const e of removed) {
    signal.throwIfAborted();
    if(e.kind==='directory') { if(!fs.rmdir) throw new Error('Git requires rmdir'); await fs.rmdir(e.path,{signal}); }
    else await fs.rm(e.path,{signal});
  }
  for(const e of after.filter(e=>e.kind==='directory').sort((a,b)=>a.path.length-b.path.length)) {
    if(prior.get(e.path)?.kind!=='directory') await fs.mkdir(e.path,{recursive:true,signal});
  }
  for(const e of after.filter(e=>e.kind!=='directory')) {
    signal.throwIfAborted();
    const old=prior.get(e.path);
    if(old?.data===e.data && old.kind===e.kind && (old.mode & 0o777)===(e.mode & 0o777)) continue;
    if(e.kind==='symlink') {
      if(!fs.symlink) throw new Error('Git requires symlink support');
      if(old?.kind===e.kind) await fs.rm(e.path,{signal});
      await fs.symlink(decoder.decode(decode(e.data)),e.path,{signal});
    } else {
      await fs.writeFile(e.path,decode(e.data),{signal,mode:e.mode & 0o777});
      if(fs.chmod && ((old?.mode ?? 0) & 0o777)!==(e.mode & 0o777)) await fs.chmod(e.path,e.mode & 0o777,{signal});
    }
  }
}

export function createGitCommand(options:GitCommandsOptions={}):CommandDefinition {
  const limits:GitLimits={maxEntries:Infinity,maxBytes:Infinity,maxDepth:Infinity,maxHttpRequests:Infinity,maxHttpBytes:Infinity,...options.limits};
  for(const [name,value] of Object.entries(limits)) if(value!==Infinity && (!Number.isSafeInteger(value) || value<1)) throw new Error(`${name} must be a positive safe integer or Infinity`);
  const def: CommandDefinition = {name:'git',runtimeIdentity:commandRuntimeIdentity,description:'Git repositories in the virtual filesystem',async execute(context) {
    try {
      if (context.args.length === 1 && (context.args[0] === "--version" || context.args[0] === "-v" || context.args[0] === "version")) {
        await writeBytes(context.stdout, encoder.encode("git version 0.0.0-development\n"), context.signal);
        return { exitCode: 0 };
      }
      let stdin: string | undefined;
      const env = {...context.env, POE_GIT_TIMESTAMP: String(Math.floor(Date.now()/1000))};
      const before=await snapshot(context.fs,limits,context.signal,context.cwd,context.args,env);
      const exports = options.wasmModule ? new ((globalThis as unknown as {WebAssembly:{Instance:new(mod:object)=>{exports:GitExports}}}).WebAssembly.Instance)(options.wasmModule).exports : createDefaultGitExports();
      const responses: {status:number;headers:Readonly<Record<string,string>>;body:string}[]=[];
      let httpBytes=0;
      let result:Result;
      for(;;) {
        context.signal.throwIfAborted();
        const input=encoder.encode(JSON.stringify({cwd:context.cwd,args:context.args,env,entries:before,responses,stdin}));
        const ptr=exports.git_alloc(input.length);
        try {
          new Uint8Array(exports.memory.buffer,ptr,input.length).set(input);
          const output=exports.git_execute(ptr,input.length);
          const length=exports.git_output_len();
          if(length>limits.maxBytes*3+limits.maxEntries*1024+limits.maxHttpBytes*2) throw new Error('Git output byte limit exceeded');
          result=JSON.parse(decoder.decode(new Uint8Array(exports.memory.buffer,output,length))) as Result;
        } finally { exports.git_free(ptr,input.length); }
        if(result.needsStdin) {
          if(stdin!==undefined) throw new Error('Git requested stdin more than once');
          const chunks:Uint8Array[]=[];
          let size=0;
          for await(const chunk of readBytes(context.stdin,context.signal)) {
            size+=chunk.length;
            if(size>limits.maxBytes) throw new Error('Git stdin byte limit exceeded');
            chunks.push(chunk);
          }
          const bytes=new Uint8Array(size);
          let offset=0;
          for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
          stdin=encode(bytes);
          continue;
        }
        if(!result.request) break;
        if(!options.http) throw new Error('Git network transport is not configured');
        if(responses.length>=limits.maxHttpRequests) throw new Error('Git HTTP request limit exceeded');
        const request=result.request;
        const body=decode(request.body);
        httpBytes+=body.length;
        if(httpBytes>limits.maxHttpBytes) throw new Error('Git HTTP byte limit exceeded');
        const response=await options.http({...request,body,signal:context.signal});
        context.signal.throwIfAborted();
        httpBytes+=response.body.length;
        if(httpBytes>limits.maxHttpBytes) throw new Error('Git HTTP byte limit exceeded');
        responses.push({...response,body:encode(response.body)});
      }
      if(result.entries!==null) {
        let size=0;
        if(result.entries.length>limits.maxEntries) throw new Error('Git output entry limit exceeded');
        for(const e of result.entries) size+=encoder.encode(e.path).length+e.data.length/2;
        if(size>limits.maxBytes) throw new Error('Git output filesystem byte limit exceeded');
        await publish(context.fs,before,result.entries,context.signal);
      }
      await writeBytes(context.stdout,typeof result.stdoutBytes==='string' ? decode(result.stdoutBytes) : encoder.encode(result.stdout),context.signal);
      await writeBytes(context.stderr,encoder.encode(result.stderr),context.signal);
      return {exitCode:result.exitCode};
    } catch(error) {
      context.signal.throwIfAborted();
      await writeBytes(context.stderr,encoder.encode(`fatal: ${error instanceof Error ? error.message : 'Git execution failed'}\n`),context.signal);
      return {exitCode:128};
    }
  }};
  gitCommandMeta.set(def.execute, { limits, hasHttp: Boolean(options.http), wasmModule: options.wasmModule });
  return def;
}
export function createGitCommands(options:GitCommandsOptions={}):readonly CommandDefinition[] { return [createGitCommand(options)]; }
export function gitCommands(options:GitCommandsOptions={}):VirtualShellPlugin {
  const command=createGitCommand(options);
  return {name:'git-commands',setup(host){host.commands.register(command,{replace:options.replace ?? false});}};
}

export interface SyncGitNodeInfo {
  readonly type: "file" | "directory" | "symlink";
  readonly mode: number;
  readonly target?: string;
  readonly children?: ReadonlyArray<{ readonly name: string }>;
}

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "rev-parse",
  "status",
  "branch",
  "log",
  "diff",
  "show",
  "ls-files",
  "ls-tree",
  "cat-file",
  "describe",
  "tag",
  "shortlog",
  "blame",
  "grep",
  "name-rev",
  "for-each-ref",
  "show-ref",
  "check-ignore",
  "check-attr",
  "var",
  "version",
  "help"
]);

const readOnlyGitResultCache = new Map<string, string>();

function isReadOnlyGitArgs(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "--version" || a === "-v" || a === "--help" || a === "-h") return true;
    if (a === "-C" || a === "-c" || a === "--git-dir" || a === "--work-tree") {
      i += 2;
      continue;
    }
    if (a.startsWith("--git-dir=") || a.startsWith("--work-tree=") || a === "--no-pager" || a === "-p" || a === "--paginate" || a === "--bare") {
      i++;
      continue;
    }
    if (a.startsWith("-")) return false;
    if (a === "config") {
      return args.slice(i + 1).some(x => x === "--get" || x === "--get-all" || x === "--list" || x === "-l");
    }
    if (a === "hash-object") {
      return !args.slice(i + 1).includes("-w");
    }
    if (a === "remote") {
      const rest = args.slice(i + 1);
      return rest.length === 0 || rest[0] === "-v" || rest[0] === "--verbose" || rest[0] === "get-url" || rest[0] === "show";
    }
    if (a === "stash" || a === "worktree") {
      const rest = args.slice(i + 1);
      return rest[0] === "list" || (a === "stash" && rest[0] === "show");
    }
    if (a === "branch" || a === "tag") {
      const rest = args.slice(i + 1);
      if (rest.length === 0) return true;
      if (rest[0] === "-l" || rest[0] === "--list" || rest[0] === "--contains" || rest[0] === "--points-at" || rest[0] === "--merged" || rest[0] === "--no-merged") return true;
      if (rest.length === 1 && (rest[0] === "--show-current" || rest[0] === "-a" || rest[0] === "-r" || rest[0] === "-v" || rest[0] === "-vv")) return true;
      return false;
    }
    return READ_ONLY_GIT_SUBCOMMANDS.has(a);
  }
  return false;
}

function entriesUnchanged(before: readonly Entry[], after: readonly Entry[] | null): boolean {
  if (after === null) return true;
  if (before.length !== after.length) return false;
  const byPath = new Map<string, Entry>();
  for (let i = 0; i < before.length; i++) {
    const b = before[i]!;
    byPath.set(b.path, b);
  }
  for (let i = 0; i < after.length; i++) {
    const a = after[i]!;
    const b = byPath.get(a.path);
    if (!b || b.kind !== a.kind || (b.mode & 0o777) !== (a.mode & 0o777) || b.data !== a.data) {
      return false;
    }
  }
  return true;
}

export function evalSyncGit(
  stdinBytes: Uint8Array | undefined,
  args: readonly string[],
  cwd: string,
  inspectNode?: (path: string, follow: boolean) => SyncGitNodeInfo | undefined,
  readFile?: (path: string) => Uint8Array | undefined,
  executeFn?: CommandDefinition["execute"],
  writeFileSync?: (path: string, bytes: Uint8Array, mode?: number) => boolean,
  mkdirSync?: (path: string) => boolean,
  rmSync?: (path: string) => boolean,
): string | undefined {
  if (executeFn) {
    const meta = gitCommandMeta.get(executeFn);
    if (meta) {
      if (meta.hasHttp || meta.wasmModule) return undefined;
      const l = meta.limits;
      if (l.maxEntries !== Infinity || l.maxBytes !== Infinity || l.maxDepth !== Infinity || l.maxHttpRequests !== Infinity || l.maxHttpBytes !== Infinity) {
        return undefined;
      }
    }
  }
  const readOnly = isReadOnlyGitArgs(args);
  if (!readOnly && (!writeFileSync || !mkdirSync || !rmSync)) return undefined;
  if (args.length === 1 && (args[0] === "--version" || args[0] === "-v" || args[0] === "version")) {
    return "git version 0.0.0-development\n";
  }
  if (!inspectNode || !readFile) return undefined;

  const entries: Entry[] = [];
  let totalBytes = 0;
  const scopedRoot = resolveSyncScopedRepoRoot(inspectNode, cwd, args);
  const seenPaths = new Set<string>();
  if (scopedRoot) {
    for (const dir of ancestorDirs(scopedRoot)) {
      seenPaths.add(dir);
      entries.push({ path: dir, kind: "directory", mode: 0o755, data: "" });
    }
    for (const cfg of ["/.gitconfig", "/root/.gitconfig"]) {
      const fb = readFile(cfg);
      if (fb) {
        const parent = cfg.slice(0, cfg.lastIndexOf("/")) || "/";
        if (parent !== "/" && !seenPaths.has(parent)) {
          seenPaths.add(parent);
          entries.push({ path: parent, kind: "directory", mode: 0o755, data: "" });
        }
        seenPaths.add(cfg);
        entries.push({ path: cfg, kind: "file", mode: 0o644, data: encode(fb) });
      }
    }
  }
  const startRoot = scopedRoot ?? "/";
  const startDepth = scopedRoot ? scopedRoot.split("/").filter(Boolean).length : 0;
  const pending: Array<{ path: string; depth: number }> = [{ path: startRoot, depth: startDepth }];
  while (pending.length > 0) {
    const { path, depth } = pending.pop()!;
    if (depth > 32) return undefined;
    const dirNode = inspectNode(path, false);
    if (!dirNode || dirNode.type !== "directory" || !dirNode.children) return undefined;
    for (let i = 0; i < dirNode.children.length; i++) {
      const child = dirNode.children[i]!;
      if (entries.length >= 4096) return undefined;
      const full = path === "/" ? `/${child.name}` : `${path}/${child.name}`;
      const stat = inspectNode(full, false);
      if (!stat) continue;
      let bytes: Uint8Array;
      if (stat.type === "directory") {
        if (
          scopedRoot !== undefined &&
          full !== scopedRoot &&
          !full.includes("/.git/") &&
          !full.endsWith("/.git") &&
          cwd !== full &&
          !cwd.startsWith(`${full}/`)
        ) {
          const nestedGit = inspectNode(`${full}/.git`, false);
          if (nestedGit && nestedGit.type === "directory") {
            entries.push({ path: full, kind: "directory", mode: 0o755, data: "" });
            entries.push({ path: `${full}/.git`, kind: "directory", mode: 0o755, data: "" });
            const headBytes = readFile(`${full}/.git/HEAD`);
            if (headBytes) {
              entries.push({ path: `${full}/.git/HEAD`, kind: "file", mode: 0o644, data: encode(headBytes) });
            }
            continue;
          }
        }
        bytes = new Uint8Array(0);
        pending.push({ path: full, depth: depth + 1 });
      } else if (stat.type === "symlink") {
        bytes = encoder.encode(stat.target ?? "");
      } else if (stat.type === "file") {
        const fb = readFile(full);
        if (!fb) return undefined;
        bytes = fb;
      } else {
        return undefined;
      }
      totalBytes += full.length + bytes.byteLength;
      if (totalBytes > 512 * 1024) return undefined;
      entries.push({ path: full, kind: stat.type, mode: stat.mode, data: encode(bytes) });
    }
  }

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const stdinHex = stdinBytes && stdinBytes.byteLength > 0 ? encode(stdinBytes) : "";
  const inputJson = JSON.stringify({ cwd, args, entries, responses: [], stdin: stdinHex });
  const cached = readOnlyGitResultCache.get(inputJson);
  if (cached !== undefined) return cached;

  try {
    const exports = createDefaultGitExports();
    const input = encoder.encode(inputJson);
    const ptr = exports.git_alloc(input.length);
    let result: Result;
    try {
      new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
      const output = exports.git_execute(ptr, input.length);
      const length = exports.git_output_len();
      result = JSON.parse(decoder.decode(new Uint8Array(exports.memory.buffer, output, length))) as Result;
    } finally {
      exports.git_free(ptr, input.length);
    }
    if (result.exitCode !== 0 || result.stderr !== "" || result.request) return undefined;
    let outStr: string;
    if (typeof result.stdoutBytes === "string") {
      const rawBytes = decode(result.stdoutBytes);
      if (rawBytes.includes(0)) return undefined;
      try {
        outStr = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
      } catch {
        return undefined;
      }
    } else {
      outStr = result.stdout;
    }
    if (outStr.includes("\0")) return undefined;
    if (entriesUnchanged(entries, result.entries)) {
      if (readOnly && inputJson.length <= 65536) {
        if (readOnlyGitResultCache.size >= 16) {
          const oldest = readOnlyGitResultCache.keys().next().value;
          if (oldest !== undefined) readOnlyGitResultCache.delete(oldest);
        }
        readOnlyGitResultCache.set(inputJson, outStr);
      }
      return outStr;
    }
    if (!writeFileSync || !mkdirSync || !rmSync || !result.entries) return undefined;
    const prior = new Map(entries.map(e => [e.path, e]));
    const next = new Map(result.entries.map(e => [e.path, e]));
    for (const e of result.entries) {
      if (e.kind === "symlink" && prior.get(e.path)?.data !== e.data) return undefined;
    }
    const removed = entries.filter(e => !next.has(e.path) || next.get(e.path)!.kind !== e.kind).sort((a, b) => b.path.length - a.path.length);
    for (const e of removed) {
      if (!rmSync(e.path)) return undefined;
    }
    for (const e of result.entries.filter(e => e.kind === "directory").sort((a, b) => a.path.length - b.path.length)) {
      if (prior.get(e.path)?.kind !== "directory") {
        if (!mkdirSync(e.path)) return undefined;
      }
    }
    for (const e of result.entries.filter(e => e.kind === "file")) {
      const p = prior.get(e.path);
      if (!p || p.kind !== "file" || p.data !== e.data || p.mode !== e.mode) {
        if (!writeFileSync(e.path, decode(e.data), e.mode)) return undefined;
      }
    }
    readOnlyGitResultCache.clear();
    return outStr;
  } catch {
    return undefined;
  }
}
