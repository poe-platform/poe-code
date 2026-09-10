import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { truncateCommand } from "../../src/commands/truncate.js";
import { FsError, type FileResizeOperation, type FileResizeOptions } from "../../src/contracts/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

function fixture() {
  const fs = new MemoryFileSystem();
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, retainedResize: false, atomicResize: true } });
  const calls: { path: string; operation: FileResizeOperation; options: FileResizeOptions }[] = [];
  const backend = Object.assign(fs, {
    async resizeFile(path: string, operation: FileResizeOperation, options: FileResizeOptions = {}) {
      options.signal?.throwIfAborted();
      calls.push({path, operation, options});
    },
  });
  const shell = new Shell({ fs: backend, cwd: "/" });
  shell.register(truncateCommand());
  return { backend, calls, shell };
}

for (const [argument, modifier, size] of [
  ["7", "absolute", 7n], ["+3", "relative", 3n], ["-9223372036854775808", "relative", -9223372036854775808n],
  ["<5", "maximum", 5n], [">8", "minimum", 8n], ["/4", "down", 4n], ["%4", "up", 4n],
] as const) test(`atomic resize receives exact ${argument} without resolving its final size`, async () => {
  const { calls, shell } = fixture();
  try {
    const result = await shell.exec(`truncate -s '${argument}' /target`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.path, "/target");
    assert.deepEqual(calls[0]!.operation, {size, modifier, ioBlocks: false});
    assert.equal(calls[0]!.options.create, true);
    assert.equal(calls[0]!.options.mode, 0o644);
  } finally { await shell.dispose(); }
});

test("atomic resize passes one reference snapshot and block intent to the backend", async () => {
  const { backend, calls, shell } = fixture();
  await backend.writeFile("/reference", new TextEncoder().encode("1234567"));
  try {
    const result = await shell.exec("truncate -o -r /reference -s +2 /first /second");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]!.operation, {size:2n, modifier:"relative", referenceSize:7n, ioBlocks:true});
    assert.deepEqual(calls[1]!.operation, calls[0]!.operation);
  } finally { await shell.dispose(); }
});

test("atomic no-create suppresses missing targets but reports other failures", async () => {
  const { backend, shell } = fixture();
  await backend.writeFile("/denied", new Uint8Array());
  backend.resizeFile = async path => { throw new FsError(path === "/missing" ? "ENOENT" : "EACCES"); };
  try {
    assert.equal((await shell.exec("truncate -c -s 0 /missing")).exitCode, 0);
    assert.equal((await shell.exec("truncate -c -s 0 /denied")).exitCode, 1);
  } finally { await shell.dispose(); }
});

test("retained resize remains preferred when both contracts are available", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new TextEncoder().encode("abcdef"));
  const backend = new Proxy(fs, {get(target,key) {
    if(key === "capabilities") return {...target.capabilities,atomicResize:true};
    if(key === "resizeFile") return async () => {throw new Error("atomic path must not replace retained semantics");};
    const value=Reflect.get(target,key,target);
    return typeof value === "function" ? value.bind(target) : value;
  }});
  const shell=new Shell({fs:backend,cwd:"/"}); shell.register(truncateCommand());
  try {
    assert.equal((await shell.exec("truncate -s 3 /file")).exitCode,0);
    assert.equal(new TextDecoder().decode(await fs.readFile("/file")),"abc");
  } finally {await shell.dispose();}
});

test("atomic resize refuses a capability without its method", async () => {
  const { backend, shell }=fixture(); Reflect.deleteProperty(backend,"resizeFile");
  try {assert.equal((await shell.exec("truncate -s 3 /file")).exitCode,1);}
  finally {await shell.dispose();}
});

test("cancellation awaits the admitted atomic mutation before shell settlement", async () => {
  const { backend,shell }=fixture(),controller=new AbortController();
  const started=deferred(),release=deferred();
  let observed:AbortSignal|undefined, settled=false;
  backend.resizeFile=async (_path,_operation,options={})=>{
    observed=options.signal; started.resolve(); await release.promise;
    options.signal?.throwIfAborted();
  };
  const result=shell.exec("truncate -s 3 /file",{signal:controller.signal});
  void result.then(()=>{settled=true;},()=>{settled=true;});
  await started.promise;
  const reason=new Error("cancel atomic resize"); controller.abort(reason);
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(observed?.aborted,true); assert.equal(settled,false);
  release.resolve();
  await assert.rejects(result,error=>error===reason);
  await shell.dispose();
});
